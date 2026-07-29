const RESEND_TIMEOUT_MS = 10000;
const ALLOWED_ORIGIN = "https://kafe-143b5.web.app";

// Orígenes permitidos para el endpoint /publish (panel admin).
// Incluye producción, el dominio alternativo de Firebase y los canales de
// preview (formato https://kafe-143b5--<canal>.web.app).
const ALLOWED_PUBLISH_ORIGIN_RE = /^https:\/\/kafe-143b5(--[a-z0-9-]+)?\.(web\.app|firebaseapp\.com)$/;

const FIREBASE_PROJECT_ID = "kafe-143b5";
const FIREBASE_ISSUER = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;
const GOOGLE_JWK_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const CLOCK_SKEW_SECONDS = 60;
const MAX_BODY_BYTES = 10 * 1024 * 1024; // ~10 MB

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function validateInput({ nombre, telefono, fecha, hora, personas, tipo }) {
  if (!nombre || typeof nombre !== 'string' || nombre.trim().length === 0 || nombre.length > 100)
    return 'nombre inválido';
  if (!telefono || !/^\d{9}$/.test(String(telefono).replace(/\s+/g, '')))
    return 'telefono inválido';
  if (!fecha || !/^\d{2}-\d{2}-\d{4}$/.test(String(fecha)))
    return 'fecha inválida';
  if (!hora || !/^\d{2}:\d{2}$/.test(String(hora)))
    return 'hora inválida';
  const p = Number(personas);
  if (!Number.isInteger(p) || p < 1 || p > 20)
    return 'personas inválido';
  if (tipo !== 'De Karta' && tipo !== 'Menú personalizado')
    return 'tipo inválido';
  return null;
}

// ---------------------------------------------------------------------------
// Utilidades base64url (JWT usa base64url, no base64 estándar)
// ---------------------------------------------------------------------------

function base64UrlToUint8Array(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlDecodeToString(base64url) {
  return new TextDecoder('utf-8').decode(base64UrlToUint8Array(base64url));
}

// ---------------------------------------------------------------------------
// Verificación de ID tokens de Firebase Auth (JWT RS256)
// Referencia: https://firebase.google.com/docs/auth/admin/verify-id-tokens
// ---------------------------------------------------------------------------

// Cachea las claves públicas JWK de Google respetando su Cache-Control.
// Usa la Cache API de Cloudflare (caches.default) para no golpear el
// endpoint de Google en cada request.
async function getGooglePublicKey(kid, ctx) {
  const cache = caches.default;
  const cacheKey = new Request("https://kafe-internal-cache.local/google-jwk");

  let response = await cache.match(cacheKey);
  if (!response) {
    response = await fetch(GOOGLE_JWK_URL);
    if (!response.ok) {
      throw new Error("No se pudieron obtener las claves públicas de Google");
    }
    // cache.put respeta el Cache-Control (max-age) que devuelve Google.
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    } else {
      await cache.put(cacheKey, response.clone());
    }
  }

  const jwks = await response.json();
  const jwk = (jwks.keys || []).find((k) => k.kid === kid);
  return jwk || null;
}

/**
 * Verifica un ID token de Firebase Auth (JWT RS256).
 * Devuelve el payload decodificado si la firma y los claims son válidos,
 * o null si la verificación falla por cualquier motivo (firma inválida,
 * claims incorrectos, token malformado, etc.).
 *
 * IMPORTANTE: nunca loguear el token completo ni partes sensibles.
 */
async function verifyFirebaseIdToken(idToken, ctx) {
  if (!idToken || typeof idToken !== 'string') return null;

  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  let header, payload;
  try {
    header = JSON.parse(base64UrlDecodeToString(headerB64));
    payload = JSON.parse(base64UrlDecodeToString(payloadB64));
  } catch {
    return null; // token malformado
  }

  if (header.alg !== 'RS256' || !header.kid) return null;

  let jwk;
  try {
    jwk = await getGooglePublicKey(header.kid, ctx);
  } catch {
    return null; // no se pudieron obtener las claves de Google
  }
  if (!jwk) return null; // kid desconocido (clave rotada / token no de Firebase)

  let cryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
  } catch {
    return null;
  }

  let signatureValid = false;
  try {
    const signatureBytes = base64UrlToUint8Array(signatureB64);
    const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    signatureValid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      signatureBytes,
      signedData
    );
  } catch {
    return null;
  }

  if (!signatureValid) return null; // firma NO válida → rechazar

  // --- Validación de claims (todos obligatorios) ---
  const now = Math.floor(Date.now() / 1000);

  if (payload.aud !== FIREBASE_PROJECT_ID) return null;
  if (payload.iss !== FIREBASE_ISSUER) return null;
  if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
  if (typeof payload.iat !== 'number' || payload.iat > now + CLOCK_SKEW_SECONDS) return null;
  if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.trim().length === 0) return null;

  return payload;
}

function isEmailAllowedToPublish(email, env) {
  // FALLA-CERRADO: el registro público de Firebase (Email/Password) está abierto
  // por defecto — cualquiera puede crearse una cuenta con el apiKey público y
  // obtener un token válido. Por eso, sin allowlist configurada NO se permite
  // publicar a nadie. ALLOWED_PUBLISHER_EMAILS es OBLIGATORIA.
  const allowlist = env.ALLOWED_PUBLISHER_EMAILS;
  if (!allowlist) return false; // sin allowlist = nadie publica (fail-closed)
  const allowed = allowlist
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return false; // allowlist vacía = nadie publica
  if (!email || typeof email !== 'string') return false;
  return allowed.includes(email.trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// CORS para /publish (origen dinámico + cabecera Authorization)
// ---------------------------------------------------------------------------

function isAllowedPublishOrigin(origin) {
  return typeof origin === 'string' && ALLOWED_PUBLISH_ORIGIN_RE.test(origin);
}

function publishCorsHeaders(origin) {
  if (!isAllowedPublishOrigin(origin)) return { "Vary": "Origin" };
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
  };
}

function publishJson(body, status, origin) {
  return Response.json(body, { status, headers: publishCorsHeaders(origin) });
}

// ---------------------------------------------------------------------------
// Commit atómico a GitHub vía Git Data API
// ---------------------------------------------------------------------------

async function githubRequest(url, { method = 'GET', token, body } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "kafe-admin-worker",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    // No filtrar el cuerpo de la respuesta de GitHub (podría incluir detalles
    // sensibles del repo); solo el status para diagnóstico interno.
    throw new Error(`GitHub API error (${res.status}) en ${method} ${url}`);
  }
  return res.json();
}

/**
 * Crea un único commit en GitHub con content.json actualizado y, si se
 * proporcionan, las imágenes nuevas/actualizadas. Un solo commit = un solo
 * despliegue vía GitHub Action.
 */
async function commitToGitHub({ contentString, images, env }) {
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || 'main';
  const token = env.GITHUB_TOKEN;

  if (!repo || !token) {
    throw new Error('Configuración de GitHub incompleta (GITHUB_REPO / GITHUB_TOKEN)');
  }

  const apiBase = `https://api.github.com/repos/${repo}`;

  // 1. Referencia de la rama → sha del commit base
  const refData = await githubRequest(`${apiBase}/git/ref/heads/${branch}`, { token });
  const baseCommitSha = refData.object.sha;

  // 2. Commit base → sha del árbol base
  const baseCommit = await githubRequest(`${apiBase}/git/commits/${baseCommitSha}`, { token });
  const baseTreeSha = baseCommit.tree.sha;

  // 3. Blobs: content.json + imágenes
  const treeEntries = [];

  const contentBlob = await githubRequest(`${apiBase}/git/blobs`, {
    method: 'POST',
    token,
    body: { content: contentString, encoding: 'utf-8' },
  });
  treeEntries.push({
    path: 'content.json',
    mode: '100644',
    type: 'blob',
    sha: contentBlob.sha,
  });

  for (const image of images) {
    const imageBlob = await githubRequest(`${apiBase}/git/blobs`, {
      method: 'POST',
      token,
      body: { content: image.base64, encoding: 'base64' },
    });
    treeEntries.push({
      path: image.path,
      mode: '100644',
      type: 'blob',
      sha: imageBlob.sha,
    });
  }

  // 4. Árbol nuevo sobre el árbol base
  const newTree = await githubRequest(`${apiBase}/git/trees`, {
    method: 'POST',
    token,
    body: { base_tree: baseTreeSha, tree: treeEntries },
  });

  // 5. Commit nuevo
  const newCommit = await githubRequest(`${apiBase}/git/commits`, {
    method: 'POST',
    token,
    body: {
      message: 'content: actualización desde panel admin',
      tree: newTree.sha,
      parents: [baseCommitSha],
    },
  });

  // 6. Mover la rama al nuevo commit
  await githubRequest(`${apiBase}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    token,
    body: { sha: newCommit.sha, force: false },
  });

  return newCommit.sha;
}

// ---------------------------------------------------------------------------
// Validación del body de /publish
// ---------------------------------------------------------------------------

function validateImagePath(path) {
  return typeof path === 'string' && path.startsWith('imagenes/') && !path.includes('..');
}

function validatePublishBody(body) {
  if (!body || typeof body !== 'object') return 'body inválido';
  if (!body.content || typeof body.content !== 'object' || Array.isArray(body.content)) {
    return 'content inválido';
  }
  if (Object.keys(body.content).length === 0) return 'content vacío';

  const images = body.images ?? [];
  if (!Array.isArray(images)) return 'images debe ser un array';
  for (const image of images) {
    if (!image || typeof image !== 'object') return 'imagen inválida';
    if (!validateImagePath(image.path)) return 'ruta de imagen inválida';
    if (!image.base64 || typeof image.base64 !== 'string') return 'imagen sin datos base64';
  }
  return null;
}

async function handlePublish(request, env, ctx) {
  const origin = request.headers.get('Origin');

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...publishCorsHeaders(origin),
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      },
    });
  }

  if (request.method !== 'POST') {
    return publishJson({ error: 'Method Not Allowed' }, 405, origin);
  }

  // --- Autenticación: verificar ID token de Firebase ---
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return publishJson({ error: 'No autorizado' }, 401, origin);
  }
  const idToken = authHeader.slice('Bearer '.length).trim();

  let payload;
  try {
    payload = await verifyFirebaseIdToken(idToken, ctx);
  } catch {
    payload = null;
  }
  if (!payload) {
    return publishJson({ error: 'No autorizado' }, 401, origin);
  }

  // --- Autorización: allowlist de publicadores ---
  if (!isEmailAllowedToPublish(payload.email, env)) {
    return publishJson({ error: 'Prohibido' }, 403, origin);
  }

  // --- Límite de tamaño del body ---
  const contentLengthHeader = request.headers.get('Content-Length');
  if (contentLengthHeader && Number(contentLengthHeader) > MAX_BODY_BYTES) {
    return publishJson({ error: 'Petición demasiado grande' }, 413, origin);
  }

  let rawBody;
  try {
    rawBody = await request.text();
  } catch {
    return publishJson({ error: 'Petición inválida' }, 400, origin);
  }
  if (rawBody.length > MAX_BODY_BYTES) {
    return publishJson({ error: 'Petición demasiado grande' }, 413, origin);
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return publishJson({ error: 'JSON inválido' }, 400, origin);
  }

  const validationError = validatePublishBody(body);
  if (validationError) {
    return publishJson({ error: validationError }, 400, origin);
  }

  const contentString = JSON.stringify(body.content, null, 2);
  const images = body.images ?? [];

  try {
    const commitSha = await commitToGitHub({ contentString, images, env });
    return publishJson({ success: true, commit: commitSha }, 200, origin);
  } catch {
    // No filtrar detalles internos (podrían revelar información del token/PAT).
    return publishJson({ error: 'Error al publicar los cambios' }, 502, origin);
  }
}

// ---------------------------------------------------------------------------
// Handler de reservas (lógica existente, sin cambios)
// ---------------------------------------------------------------------------

async function handleReservas(request, env) {
  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type",
        "Vary": "Origin",
      },
    });
  }

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let nombre, telefono, fecha, hora, personas, tipo;
  try {
    ({ nombre, telefono, fecha, hora, personas, tipo } = await request.json());
  } catch {
    return Response.json({ error: "Petición inválida" }, {
      status: 400,
      headers: { "Access-Control-Allow-Origin": ALLOWED_ORIGIN, "Vary": "Origin" },
    });
  }

  const validationError = validateInput({ nombre, telefono, fecha, hora, personas, tipo });
  if (validationError) {
    return Response.json({ error: validationError }, {
      status: 400,
      headers: { "Access-Control-Allow-Origin": ALLOWED_ORIGIN, "Vary": "Origin" },
    });
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
      body: JSON.stringify({
        from: "Reservas Kafe <onboarding@resend.dev>",
        to: "reservaskafebar@gmail.com",
        subject: `Nueva Reserva: ${escapeHtml(nombre)} — ${escapeHtml(fecha)}`,
        html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#f4f6f9;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f9;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <tr>
            <td style="background-color:#0d2137;padding:28px 32px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;letter-spacing:1px;">KAFÉ</h1>
              <p style="margin:6px 0 0;color:#3b9eff;font-size:13px;letter-spacing:2px;text-transform:uppercase;">Nueva Reserva</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 20px;color:#4a6080;font-size:14px;line-height:1.5;">
                Se ha recibido una nueva solicitud de reserva con los siguientes datos:
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                <tr>
                  <td style="padding:12px 16px;background-color:#f4f6f9;border-bottom:1px solid #e8ecf2;color:#4a6080;font-size:13px;width:120px;">Nombre</td>
                  <td style="padding:12px 16px;background-color:#f4f6f9;border-bottom:1px solid #e8ecf2;color:#0d2137;font-size:14px;font-weight:600;">${escapeHtml(nombre)}</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;border-bottom:1px solid #e8ecf2;color:#4a6080;font-size:13px;">Teléfono</td>
                  <td style="padding:12px 16px;border-bottom:1px solid #e8ecf2;color:#0d2137;font-size:14px;font-weight:600;">${escapeHtml(telefono)}</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;background-color:#f4f6f9;border-bottom:1px solid #e8ecf2;color:#4a6080;font-size:13px;">Fecha</td>
                  <td style="padding:12px 16px;background-color:#f4f6f9;border-bottom:1px solid #e8ecf2;color:#0d2137;font-size:14px;font-weight:600;">${escapeHtml(fecha)}</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;border-bottom:1px solid #e8ecf2;color:#4a6080;font-size:13px;">Hora</td>
                  <td style="padding:12px 16px;border-bottom:1px solid #e8ecf2;color:#0d2137;font-size:14px;font-weight:600;">${escapeHtml(hora)}</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;background-color:#f4f6f9;border-bottom:1px solid #e8ecf2;color:#4a6080;font-size:13px;">Personas</td>
                  <td style="padding:12px 16px;background-color:#f4f6f9;border-bottom:1px solid #e8ecf2;color:#0d2137;font-size:14px;font-weight:600;">${escapeHtml(String(personas))}</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;border-bottom:1px solid #e8ecf2;color:#4a6080;font-size:13px;">Tipo</td>
                  <td style="padding:12px 16px;border-bottom:1px solid #e8ecf2;color:#0d2137;font-size:14px;font-weight:600;">${escapeHtml(tipo)}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;background-color:#0d2137;text-align:center;">
              <p style="margin:0;color:#4a6080;font-size:12px;">Este correo fue generado automáticamente desde el sistema de reservas de Kafe.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
      }),
    });

    const data = await res.json();

    if (data.error) {
      return Response.json({ error: "Error al enviar la reserva" }, {
        status: 400,
        headers: {
          "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
          "Vary": "Origin",
        },
      });
    }

    return Response.json({ success: true }, {
      headers: {
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Vary": "Origin",
      },
    });
  } catch {
    return Response.json({ error: "Error al procesar la reserva" }, {
      status: 500,
      headers: {
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Vary": "Origin",
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/publish") {
      return handlePublish(request, env, ctx);
    }

    return handleReservas(request, env);
  },
};

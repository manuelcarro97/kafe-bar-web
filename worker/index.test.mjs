import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import worker from './index.js';

const PROJECT_ID = 'kafe-143b5';
const ISSUER = `https://securetoken.google.com/${PROJECT_ID}`;
const SITE = 'https://kafe-143b5.web.app';
const WORKER = 'https://kafe.example.workers.dev';
const KID = 'test-key';

const ENV = {
  ALLOWED_PUBLISHER_EMAILS: 'dueno@example.com, admin@example.com',
  GITHUB_REPO: 'owner/repo',
  GITHUB_TOKEN: 'test-token',
  RESEND_API_KEY: 'test-resend-key',
};

const RSA = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
const signingKeys = await crypto.subtle.generateKey(RSA, true, ['sign', 'verify']);
const otherKeys = await crypto.subtle.generateKey(RSA, true, ['sign', 'verify']);
const publicJwk = { ...(await crypto.subtle.exportKey('jwk', signingKeys.publicKey)), kid: KID };

const base64Url = (value) => Buffer.from(value).toString('base64url');

function validClaims(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return { aud: PROJECT_ID, iss: ISSUER, sub: 'user-1', iat: now - 10, exp: now + 3600, email: 'dueno@example.com', ...overrides };
}

async function signToken(claims = validClaims(), { key = signingKeys.privateKey, header = { alg: 'RS256', kid: KID } } = {}) {
  const signedPart = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signedPart));
  return `${signedPart}.${base64Url(new Uint8Array(signature))}`;
}

function publishRequest(token, { body = { content: { titulo: 'Kafé' } }, origin = SITE, headers = {}, rawBody } = {}) {
  return new Request(`${WORKER}/publish`, {
    method: 'POST',
    headers: { Origin: origin, Authorization: `Bearer ${token}`, ...headers },
    body: rawBody ?? JSON.stringify(body),
  });
}

function reservaRequest(body) {
  return new Request(`${WORKER}/`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
}

const VALID_RESERVA = { nombre: 'Ana', telefono: '600 123 456', fecha: '24-12-2026', hora: '21:30', personas: 4, tipo: 'De Karta' };

// Mocked outside world: Google keys, Resend and the GitHub Git Data API.
let calls;
let handlers;

beforeEach(() => {
  calls = [];
  handlers = {
    google: () => Response.json({ keys: [publicJwk] }),
    resend: () => Response.json({ id: 'email-1' }),
    github: (url, init) => {
      if (url.endsWith('/git/ref/heads/main')) return Response.json({ object: { sha: 'base-commit' } });
      if (url.endsWith('/git/commits/base-commit')) return Response.json({ tree: { sha: 'base-tree' } });
      if (url.endsWith('/git/blobs')) return Response.json({ sha: `blob-${calls.length}` });
      if (url.endsWith('/git/trees')) return Response.json({ sha: 'new-tree' });
      if (url.endsWith('/git/commits') && init.method === 'POST') return Response.json({ sha: 'new-commit' });
      if (url.endsWith('/git/refs/heads/main')) return Response.json({ object: { sha: 'new-commit' } });
      throw new Error(`Llamada a GitHub inesperada: ${url}`);
    },
  };
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method ?? 'GET', body: init.body });
    if (url.includes('googleapis.com')) return handlers.google();
    if (url.includes('api.resend.com')) return handlers.resend();
    if (url.includes('api.github.com')) return handlers.github(url, { method: init.method ?? 'GET' });
    throw new Error(`Llamada de red inesperada: ${url}`);
  };
});

const callsTo = (host) => calls.filter((call) => call.url.includes(host));

describe('POST /publish: autenticación', () => {
  it('acepta un token válido de un email autorizado', async () => {
    const res = await worker.fetch(publishRequest(await signToken()), ENV);
    assert.equal(res.status, 200);
  });

  it('rechaza una petición sin cabecera Bearer', async () => {
    const request = new Request(`${WORKER}/publish`, { method: 'POST', headers: { Origin: SITE }, body: '{}' });
    assert.equal((await worker.fetch(request, ENV)).status, 401);
  });

  it('rechaza un token malformado', async () => {
    assert.equal((await worker.fetch(publishRequest('no-es-un-jwt'), ENV)).status, 401);
  });

  it('rechaza una firma hecha con otra clave', async () => {
    const token = await signToken(validClaims(), { key: otherKeys.privateKey });
    assert.equal((await worker.fetch(publishRequest(token), ENV)).status, 401);
  });

  it('rechaza un payload modificado tras firmar', async () => {
    const [header, , signature] = (await signToken()).split('.');
    const forged = base64Url(JSON.stringify(validClaims({ email: 'admin@example.com', sub: 'otro' })));
    assert.equal((await worker.fetch(publishRequest(`${header}.${forged}.${signature}`), ENV)).status, 401);
  });

  it('rechaza alg distinto de RS256', async () => {
    const token = await signToken(validClaims(), { header: { alg: 'none', kid: KID } });
    assert.equal((await worker.fetch(publishRequest(token), ENV)).status, 401);
  });

  it('rechaza un kid desconocido', async () => {
    const token = await signToken(validClaims(), { header: { alg: 'RS256', kid: 'rotada' } });
    assert.equal((await worker.fetch(publishRequest(token), ENV)).status, 401);
  });

  it('rechaza si no se pueden obtener las claves de Google', async () => {
    handlers.google = () => new Response('', { status: 503 });
    assert.equal((await worker.fetch(publishRequest(await signToken()), ENV)).status, 401);
  });

  const now = Math.floor(Date.now() / 1000);
  const invalidClaims = {
    'aud de otro proyecto': { aud: 'otro-proyecto' },
    'iss de otro emisor': { iss: 'https://securetoken.google.com/otro-proyecto' },
    'token caducado': { exp: now - 1 },
    'iat en el futuro': { iat: now + 3600 },
    'sub vacío': { sub: '   ' },
  };
  for (const [name, overrides] of Object.entries(invalidClaims)) {
    it(`rechaza claims inválidos: ${name}`, async () => {
      const res = await worker.fetch(publishRequest(await signToken(validClaims(overrides))), ENV);
      assert.equal(res.status, 401);
    });
  }
});

describe('POST /publish: autorización', () => {
  it('sin allowlist nadie publica (fail-closed)', async () => {
    const res = await worker.fetch(publishRequest(await signToken()), { ...ENV, ALLOWED_PUBLISHER_EMAILS: undefined });
    assert.equal(res.status, 403);
  });

  it('con allowlist vacía nadie publica', async () => {
    const res = await worker.fetch(publishRequest(await signToken()), { ...ENV, ALLOWED_PUBLISHER_EMAILS: ' , ' });
    assert.equal(res.status, 403);
  });

  it('rechaza un email fuera de la lista', async () => {
    const token = await signToken(validClaims({ email: 'intruso@example.com' }));
    assert.equal((await worker.fetch(publishRequest(token), ENV)).status, 403);
    assert.equal(callsTo('api.github.com').length, 0);
  });

  it('compara emails sin distinguir mayúsculas', async () => {
    const token = await signToken(validClaims({ email: 'ADMIN@example.com' }));
    assert.equal((await worker.fetch(publishRequest(token), ENV)).status, 200);
  });
});

describe('POST /publish: validación del body', () => {
  const invalidBodies = {
    'content ausente': {},
    'content como array': { content: [] },
    'content vacío': { content: {} },
    'images no es array': { content: { a: 1 }, images: 'x' },
    'ruta fuera de imagenes/': { content: { a: 1 }, images: [{ path: 'index.html', base64: 'AA==' }] },
    'ruta con ..': { content: { a: 1 }, images: [{ path: 'imagenes/../index.html', base64: 'AA==' }] },
    'imagen sin datos': { content: { a: 1 }, images: [{ path: 'imagenes/a.webp' }] },
  };
  for (const [name, body] of Object.entries(invalidBodies)) {
    it(`rechaza ${name}`, async () => {
      const res = await worker.fetch(publishRequest(await signToken(), { body }), ENV);
      assert.equal(res.status, 400);
      assert.equal(callsTo('api.github.com').length, 0);
    });
  }

  it('rechaza JSON inválido', async () => {
    const res = await worker.fetch(publishRequest(await signToken(), { rawBody: '{roto' }), ENV);
    assert.equal(res.status, 400);
  });

  it('rechaza un body demasiado grande por Content-Length', async () => {
    const headers = { 'Content-Length': String(11 * 1024 * 1024) };
    const res = await worker.fetch(publishRequest(await signToken(), { headers }), ENV);
    assert.equal(res.status, 413);
  });
});

describe('POST /publish: commit en GitHub', () => {
  it('crea un único commit con content.json y las imágenes', async () => {
    const body = { content: { titulo: 'Kafé' }, images: [{ path: 'imagenes/nueva.webp', base64: 'AA==' }] };
    const res = await worker.fetch(publishRequest(await signToken(), { body }), ENV);

    assert.deepEqual(await res.json(), { success: true, commit: 'new-commit' });
    const github = callsTo('api.github.com');
    assert.equal(github.filter((call) => call.url.endsWith('/git/blobs')).length, 2);
    assert.equal(github.filter((call) => call.url.endsWith('/git/commits') && call.method === 'POST').length, 1);

    const tree = JSON.parse(github.find((call) => call.url.endsWith('/git/trees')).body);
    assert.equal(tree.base_tree, 'base-tree');
    assert.deepEqual(tree.tree.map((entry) => entry.path), ['content.json', 'imagenes/nueva.webp']);

    const update = github.at(-1);
    assert.equal(update.method, 'PATCH');
    assert.deepEqual(JSON.parse(update.body), { sha: 'new-commit', force: false });
  });

  it('un fallo de GitHub devuelve 502 sin filtrar detalles', async () => {
    handlers.github = () => new Response('token secreto en el error', { status: 500 });
    const res = await worker.fetch(publishRequest(await signToken()), ENV);
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: 'Error al publicar los cambios' });
  });

  it('sin GITHUB_TOKEN devuelve 502 y no llama a GitHub', async () => {
    const res = await worker.fetch(publishRequest(await signToken()), { ...ENV, GITHUB_TOKEN: undefined });
    assert.equal(res.status, 502);
    assert.equal(callsTo('api.github.com').length, 0);
  });
});

describe('/publish: CORS', () => {
  const preflight = (origin) => new Request(`${WORKER}/publish`, { method: 'OPTIONS', headers: { Origin: origin } });

  for (const origin of [SITE, 'https://kafe-143b5.firebaseapp.com', 'https://kafe-143b5--preview-1.web.app']) {
    it(`permite ${origin}`, async () => {
      const res = await worker.fetch(preflight(origin), ENV);
      assert.equal(res.status, 204);
      assert.equal(res.headers.get('Access-Control-Allow-Origin'), origin);
    });
  }

  for (const origin of ['https://evil.example', 'https://kafe-143b5.web.app.evil.example', 'http://kafe-143b5.web.app']) {
    it(`no permite ${origin}`, async () => {
      const res = await worker.fetch(preflight(origin), ENV);
      assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
    });
  }

  it('rechaza métodos distintos de POST', async () => {
    const res = await worker.fetch(new Request(`${WORKER}/publish`, { method: 'GET' }), ENV);
    assert.equal(res.status, 405);
  });
});

describe('Reservas', () => {
  it('envía el email con una reserva válida', async () => {
    const res = await worker.fetch(reservaRequest(VALID_RESERVA), ENV);
    assert.deepEqual(await res.json(), { success: true });
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), SITE);
    assert.equal(callsTo('api.resend.com').length, 1);
  });

  it('escapa el HTML de los datos del cliente', async () => {
    await worker.fetch(reservaRequest({ ...VALID_RESERVA, nombre: '<script>alert(1)</script>' }), ENV);
    const { html, subject } = JSON.parse(callsTo('api.resend.com')[0].body);
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(!subject.includes('<script>'));
  });

  const invalidReservas = {
    'nombre vacío': { nombre: '   ' },
    'nombre demasiado largo': { nombre: 'a'.repeat(101) },
    'teléfono corto': { telefono: '12345' },
    'fecha con otro formato': { fecha: '2026-12-24' },
    'hora con otro formato': { hora: '21h' },
    'cero personas': { personas: 0 },
    'demasiadas personas': { personas: 21 },
    'personas no entero': { personas: 2.5 },
    'tipo desconocido': { tipo: 'Otro' },
  };
  for (const [name, overrides] of Object.entries(invalidReservas)) {
    it(`rechaza ${name}`, async () => {
      const res = await worker.fetch(reservaRequest({ ...VALID_RESERVA, ...overrides }), ENV);
      assert.equal(res.status, 400);
      assert.equal(callsTo('api.resend.com').length, 0);
    });
  }

  it('rechaza JSON inválido', async () => {
    assert.equal((await worker.fetch(reservaRequest('{roto'), ENV)).status, 400);
  });

  it('un error de Resend devuelve 400', async () => {
    handlers.resend = () => Response.json({ error: 'fallo' });
    assert.equal((await worker.fetch(reservaRequest(VALID_RESERVA), ENV)).status, 400);
  });

  it('un fallo de red devuelve 500', async () => {
    handlers.resend = () => { throw new Error('sin red'); };
    assert.equal((await worker.fetch(reservaRequest(VALID_RESERVA), ENV)).status, 500);
  });

  it('responde al preflight de CORS', async () => {
    const res = await worker.fetch(new Request(`${WORKER}/`, { method: 'OPTIONS' }), ENV);
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), SITE);
  });

  it('rechaza métodos distintos de POST', async () => {
    assert.equal((await worker.fetch(new Request(`${WORKER}/`), ENV)).status, 405);
  });
});

// API de reservas: la pública (disponibilidad y alta, expuesta a internet) y la del panel
// (/api/admin/*, con datos personales). Valida todo aquí antes de llegar a rules.js
// (que asume entrada válida).

import { ALLOWED_PUBLISH_ORIGIN_RE, isEmailAllowedToPublish, verifyFirebaseIdToken } from '../index.js';
import { notifyNewReservation } from './mail.js';
import {
  TableTakenError,
  confirmReservation,
  countPending,
  countPendingByPhone,
  createReservation,
  getOverrides,
  listDay,
  listTaken,
  releaseReservation,
  setOverride,
} from './db.js';
import { TABLES, slotsFor, turnIsOver, turnsFor, validateSelection } from './rules.js';

const TURNSTILE_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 10 * 1024; // 10 KB
const MAX_PENDING_PER_PHONE = 2;
const MAX_NAME_LENGTH = 100;
const MAX_ADMIN_PEOPLE = 60;
const DEFAULT_ADMIN_TIME = { comida: '14:00', cena: '21:00' };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const PHONE_RE = /^\d{9}$/;
const TURNS = ['comida', 'cena'];
const OVERRIDE_KINDS = ['closed', 'open_sunday'];
const OVERRIDE_KEY_RE = /^(\d{4}-\d{2}-\d{2})(?:\|(comida|cena))?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ---------------------------------------------------------------------------
// Respuestas y CORS
// ---------------------------------------------------------------------------

function isAllowedOrigin(origin, env) {
  if (typeof origin !== 'string') return false;
  // DEV_ORIGIN solo existe en .dev.vars (pruebas en local); nunca se define en wrangler.toml.
  return ALLOWED_PUBLISH_ORIGIN_RE.test(origin) || (!!env.DEV_ORIGIN && origin === env.DEV_ORIGIN);
}

function corsHeaders(origin, env) {
  if (!isAllowedOrigin(origin, env)) return { 'Vary': 'Origin' };
  return { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' };
}

function json(body, status, origin, env) {
  return Response.json(body, { status, headers: corsHeaders(origin, env) });
}

// ---------------------------------------------------------------------------
// Validación de campos
// ---------------------------------------------------------------------------

function isRealDate(date) {
  if (typeof date !== 'string' || !DATE_RE.test(date)) return false;
  const [year, month, day] = date.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function isRealTime(time) {
  if (typeof time !== 'string' || !TIME_RE.test(time)) return false;
  const [hour, minute] = time.split(':').map(Number);
  return hour < 24 && minute < 60;
}

function isWeekday(date) {
  const [year, month, day] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return dow >= 1 && dow <= 5;
}

/** Devuelve { value } con el cuerpo limpio, o { error } con un mensaje apto para el cliente. */
function parseReservation(body) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { error: 'Petición inválida' };
  const { date, turn, time, tables, people, phone, menu, ack, turnstileToken } = body;
  const name = typeof body.name === 'string' ? body.name.trim() : '';

  if (!isRealDate(date)) return { error: 'Fecha inválida' };
  if (!TURNS.includes(turn)) return { error: 'Turno inválido' };
  if (!isRealTime(time)) return { error: 'Hora inválida' };
  if (typeof phone !== 'string' || !PHONE_RE.test(phone)) return { error: 'Teléfono inválido' };
  if (name.length < 1 || name.length > MAX_NAME_LENGTH) return { error: 'Nombre inválido' };
  if (!Number.isInteger(people)) return { error: 'Número de personas inválido' };
  if (!Array.isArray(tables) || !tables.every((t) => typeof t === 'string')) return { error: 'Mesas inválidas' };
  if (menu !== undefined && typeof menu !== 'boolean') return { error: 'Menú inválido' };
  if (ack !== true) return { error: 'Debes aceptar las condiciones de la reserva' };
  if (typeof turnstileToken !== 'string' || turnstileToken.length === 0) return { error: 'Verificación anti-robots fallida' };

  return { value: { date, turn, time, tables, people, name, phone, menu: menu === true, turnstileToken } };
}

async function readJsonBody(request) {
  const declared = Number(request.headers.get('Content-Length'));
  if (declared > MAX_BODY_BYTES) return { tooLarge: true };
  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_BODY_BYTES) return { tooLarge: true };
  try {
    return { body: JSON.parse(new TextDecoder().decode(raw)) };
  } catch {
    return { body: undefined };
  }
}

// ---------------------------------------------------------------------------
// Turnstile (falla cerrado: cualquier problema cuenta como verificación fallida)
// ---------------------------------------------------------------------------

async function verifyTurnstile(env, token, request) {
  if (!env.TURNSTILE_SECRET_KEY) return false;
  try {
    const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
    const ip = request.headers.get('CF-Connecting-IP');
    if (ip) form.set('remoteip', ip);
    const res = await fetch(TURNSTILE_URL, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.success === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// GET /api/disponibilidad?date=&turn=
// ---------------------------------------------------------------------------

async function handleAvailability(request, env, origin) {
  const params = new URL(request.url).searchParams;
  const date = params.get('date');
  const turn = params.get('turn');
  if (!isRealDate(date) || !TURNS.includes(turn)) return json({ error: 'Petición inválida' }, 400, origin, env);

  const now = new Date();
  const turns = turnsFor(date, await getOverrides(env.DB, date));
  const slots = turns.includes(turn) ? slotsFor(date, turn, now) : [];
  if (slots.length === 0) return json({ turns, slots: [], taken: [], closed: true }, 200, origin, env);

  // Solo etiqueta y estado: nunca nombre ni teléfono.
  const taken = (await listTaken(env.DB, date, turn, now)).map(({ label, status }) => ({ label, status }));
  return json({ turns, slots, taken, closed: false }, 200, origin, env);
}

// ---------------------------------------------------------------------------
// POST /api/reservas
// ---------------------------------------------------------------------------

async function handleCreate(request, env, ctx, origin) {
  if (env.RESERVAS_ABIERTAS !== 'true') {
    return json({ error: 'Las reservas online no están disponibles ahora mismo' }, 503, origin, env);
  }
  if (origin && !isAllowedOrigin(origin, env)) return json({ error: 'Origen no permitido' }, 403, origin, env);

  const { body, tooLarge } = await readJsonBody(request);
  if (tooLarge) return json({ error: 'Petición demasiado grande' }, 413, origin, env);

  const parsed = parseReservation(body);
  if (parsed.error) return json({ error: parsed.error }, 400, origin, env);
  const { turnstileToken, ...reservation } = parsed.value;

  const now = new Date();
  const turns = turnsFor(reservation.date, await getOverrides(env.DB, reservation.date));
  if (!turns.includes(reservation.turn)) return json({ error: 'Ese día no hay reservas en ese turno' }, 400, origin, env);
  if (!slotsFor(reservation.date, reservation.turn, now).includes(reservation.time)) {
    return json({ error: 'Hora no disponible' }, 400, origin, env);
  }
  const selectionError = validateSelection(reservation.tables, reservation.people);
  if (selectionError) return json({ error: selectionError }, 400, origin, env);

  if (!(await verifyTurnstile(env, turnstileToken, request))) {
    return json({ error: 'Verificación anti-robots fallida' }, 400, origin, env);
  }

  if ((await countPendingByPhone(env.DB, reservation.phone, now)) >= MAX_PENDING_PER_PHONE) {
    return json({ error: 'Ya tienes varias reservas pendientes. Llámanos para gestionarlas.' }, 429, origin, env);
  }

  // El menú solo existe en la comida de lunes a viernes.
  reservation.menu = reservation.menu && reservation.turn === 'comida' && isWeekday(reservation.date);

  let created;
  try {
    created = await createReservation(env.DB, reservation, now);
  } catch (error) {
    if (error instanceof TableTakenError) {
      return json({ error: 'Alguna de las mesas ya está reservada' }, 409, origin, env);
    }
    console.error(`Reserva: error al guardar (${error.name})`);
    return json({ error: 'Error al procesar la reserva' }, 500, origin, env);
  }

  ctx.waitUntil(notifyNewReservation(env, reservation));
  return json({ id: created.id, deadline: created.deadline }, 201, origin, env);
}

// ---------------------------------------------------------------------------
// Panel: /api/admin/*
// Devuelve nombres y teléfonos y modifica reservas: la autenticación y la autorización
// van siempre primero, antes de leer el cuerpo o tocar D1.
// ---------------------------------------------------------------------------

/** Devuelve una Response de error (401/403) o null si el token es válido y el email está permitido. */
async function authorizeAdmin(request, env, ctx, origin) {
  const match = /^Bearer (\S+)$/.exec(request.headers.get('Authorization') ?? '');
  const payload = match ? await verifyFirebaseIdToken(match[1], ctx) : null;
  if (!payload) return json({ error: 'No autenticado' }, 401, origin, env);
  if (!isEmailAllowedToPublish(payload.email, env)) return json({ error: 'No autorizado' }, 403, origin, env);
  return null;
}

/** Devuelve { value } con la reserva del bar limpia, o { error }. Sin reglas de pareja ni límites de la web. */
function parseAdminReservation(body) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { error: 'Petición inválida' };
  const { date, turn, tables, people, phone = '', time } = body;
  const name = body.name === undefined ? '' : body.name;

  if (!isRealDate(date)) return { error: 'Fecha inválida' };
  if (!TURNS.includes(turn)) return { error: 'Turno inválido' };
  if (time !== undefined && !isRealTime(time)) return { error: 'Hora inválida' };
  if (typeof phone !== 'string' || (phone !== '' && !PHONE_RE.test(phone))) return { error: 'Teléfono inválido' };
  if (typeof name !== 'string' || name.trim().length > MAX_NAME_LENGTH) return { error: 'Nombre inválido' };
  if (!Number.isInteger(people) || people < 1 || people > MAX_ADMIN_PEOPLE) return { error: 'Número de personas inválido' };
  const knownLabels = TABLES.map((t) => t.label);
  const validTables =
    Array.isArray(tables) &&
    tables.length > 0 &&
    tables.every((t) => knownLabels.includes(t)) &&
    new Set(tables).size === tables.length;
  if (!validTables) return { error: 'Mesas inválidas' };

  return {
    value: { date, turn, time: time ?? DEFAULT_ADMIN_TIME[turn], tables, people, name: name.trim(), phone, menu: false },
  };
}

/** Devuelve { value } con { key, kind, enabled } o { error }. open_sunday exige turno y domingo. */
function parseOverride(body) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { error: 'Petición inválida' };
  const { key, kind, enabled } = body;
  const match = typeof key === 'string' ? OVERRIDE_KEY_RE.exec(key) : null;
  if (!match || !isRealDate(match[1])) return { error: 'Clave inválida' };
  if (!OVERRIDE_KINDS.includes(kind)) return { error: 'Tipo inválido' };
  if (typeof enabled !== 'boolean') return { error: 'Valor inválido' };
  if (kind === 'open_sunday') {
    const [year, month, day] = match[1].split('-').map(Number);
    const isSunday = new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 0;
    if (!match[2] || !isSunday) return { error: 'Solo se puede abrir un turno de domingo' };
  }
  return { value: { key, kind, enabled } };
}

async function handleAdminDay(request, env, origin) {
  const date = new URL(request.url).searchParams.get('date');
  if (!isRealDate(date)) return json({ error: 'Petición inválida' }, 400, origin, env);

  const now = new Date();
  const [reservations, overrides, pendingCount] = await Promise.all([
    listDay(env.DB, date, now),
    getOverrides(env.DB, date),
    countPending(env.DB, now),
  ]);
  return json(
    {
      reservations,
      overrides: { closed: [...overrides.closed], openSunday: [...overrides.openSunday] },
      pendingCount,
    },
    200,
    origin,
    env,
  );
}

async function handleAdminCreate(request, env, origin) {
  const { body, tooLarge } = await readJsonBody(request);
  if (tooLarge) return json({ error: 'Petición demasiado grande' }, 413, origin, env);

  const parsed = parseAdminReservation(body);
  if (parsed.error) return json({ error: parsed.error }, 400, origin, env);

  const now = new Date();
  if (turnIsOver(parsed.value.date, parsed.value.turn, now)) {
    return json({ error: 'Ese turno ya ha pasado' }, 400, origin, env);
  }

  try {
    const created = await createReservation(env.DB, { ...parsed.value, status: 'confirmed' }, now);
    return json({ id: created.id }, 201, origin, env);
  } catch (error) {
    if (error instanceof TableTakenError) return json({ error: 'Alguna de las mesas ya está reservada' }, 409, origin, env);
    throw error;
  }
}

async function handleAdminConfirm(env, id, origin) {
  if (!(await confirmReservation(env.DB, id, new Date()))) {
    return json({ error: 'La reserva ya no se puede confirmar' }, 409, origin, env);
  }
  return json({ ok: true }, 200, origin, env);
}

async function handleAdminRelease(env, id, origin) {
  if (!(await releaseReservation(env.DB, id))) return json({ error: 'No encontrado' }, 404, origin, env);
  return json({ ok: true }, 200, origin, env);
}

async function handleAdminOverride(request, env, origin) {
  const { body, tooLarge } = await readJsonBody(request);
  if (tooLarge) return json({ error: 'Petición demasiado grande' }, 413, origin, env);

  const parsed = parseOverride(body);
  if (parsed.error) return json({ error: parsed.error }, 400, origin, env);
  const { key, kind, enabled } = parsed.value;
  await setOverride(env.DB, key, kind, enabled);
  return json({ ok: true }, 200, origin, env);
}

async function routeAdmin(request, env, ctx, url, origin) {
  // Origen ajeno fuera, también en GET: la respuesta lleva datos personales.
  if (origin && !isAllowedOrigin(origin, env)) return json({ error: 'Origen no permitido' }, 403, origin, env);

  const denied = await authorizeAdmin(request, env, ctx, origin);
  if (denied) return denied;

  const { pathname } = url;
  const { method } = request;
  if (pathname === '/api/admin/dia' && method === 'GET') return handleAdminDay(request, env, origin);
  if (pathname === '/api/admin/reservas' && method === 'POST') return handleAdminCreate(request, env, origin);
  if (pathname === '/api/admin/cierres' && method === 'PUT') return handleAdminOverride(request, env, origin);

  const byId = /^\/api\/admin\/reservas\/([^/]+)(\/confirmar)?$/.exec(pathname);
  if (byId && UUID_RE.test(byId[1])) {
    if (byId[2] && method === 'POST') return handleAdminConfirm(env, byId[1], origin);
    if (!byId[2] && method === 'DELETE') return handleAdminRelease(env, byId[1], origin);
  }
  return json({ error: 'No encontrado' }, 404, origin, env);
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

/** Atiende /api/*. Devuelve null si la ruta no es de la API de reservas. */
export async function handleReservasApi(request, env, ctx) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return null;
  const origin = request.headers.get('Origin');

  // Si algo revienta (p. ej. D1 caída) respondemos JSON con CORS en vez de un 1101 sin cabeceras.
  let response;
  try {
    response = await routeApi(request, env, ctx, url, origin);
  } catch (error) {
    console.error(`API reservas: error interno (${error.name})`);
    response = json({ error: 'Error al procesar la petición' }, 500, origin, env);
  }
  // Las respuestas del panel llevan datos personales: nada de cachés intermedias.
  if (url.pathname.startsWith('/api/admin/')) response.headers.set('Cache-Control', 'no-store');
  return response;
}

async function routeApi(request, env, ctx, url, origin) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders(origin, env),
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  if (url.pathname.startsWith('/api/admin/')) return routeAdmin(request, env, ctx, url, origin);

  if (url.pathname === '/api/disponibilidad' && request.method === 'GET') {
    return handleAvailability(request, env, origin);
  }
  if (url.pathname === '/api/reservas' && request.method === 'POST') {
    return handleCreate(request, env, ctx, origin);
  }
  return json({ error: 'No encontrado' }, 404, origin, env);
}

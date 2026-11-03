import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../index.js';
import { createReservation } from '../reservas/db.js';

const db = env.DB;
const NOW = new Date('2026-11-01T10:00:00Z'); // domingo
const DATE = '2026-11-06'; // viernes: comida y cena
const WEDNESDAY = '2026-11-04'; // solo comida
const SUNDAY = '2026-11-08'; // cerrado salvo apertura manual
const PHONE = '600000000';
const NAME = 'Cliente Prueba';
const ORIGIN = 'https://your-firebase-project.web.app';
const FOREIGN_ORIGIN = 'https://malo.example.test';
const ADMIN_EMAIL = 'admin@example.test';
const OTHER_EMAIL = 'otro@example.test';
const UNKNOWN_ID = '11111111-1111-4111-8111-111111111111';

const GOOGLE_JWK_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const KID = 'clave-de-prueba';

let signingKey;
let publicJwk;
let calls;

// Token RS256 real firmado con una clave generada aquí; solo se simula la descarga de JWK de Google.
function base64Url(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function makeToken({ email = ADMIN_EMAIL, aud = 'your-firebase-project' } = {}) {
  const nowSeconds = Math.floor(Date.now() / 1000); // sigue al reloj simulado
  const header = base64Url(JSON.stringify({ alg: 'RS256', kid: KID, typ: 'JWT' }));
  const claims = base64Url(JSON.stringify({
    aud,
    iss: 'https://securetoken.google.com/your-firebase-project',
    sub: 'usuario-de-prueba',
    email,
    iat: nowSeconds - 60,
    exp: nowSeconds + 3600,
  }));
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    signingKey,
    new TextEncoder().encode(`${header}.${claims}`),
  );
  return `${header}.${claims}.${base64Url(signature)}`;
}

function makeEnv(extra = {}) {
  return {
    DB: db,
    RESERVAS_ABIERTAS: 'false', // el panel no depende del interruptor público
    ALLOWED_PUBLISHER_EMAILS: ADMIN_EMAIL,
    ...extra,
  };
}

async function call(path, { method = 'GET', body, origin, headers = {}, rawBody } = {}) {
  const init = { method, headers: { ...headers } };
  if (origin) init.headers.Origin = origin;
  if (rawBody !== undefined) init.body = rawBody;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['Content-Type'] = 'application/json';
  }
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(`https://worker.test${path}`, init), makeEnv(), ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

// Llamada autenticada como administrador salvo que se indique otra cosa.
async function admin(path, { method = 'GET', body, origin = ORIGIN, token, ...rest } = {}) {
  const bearer = token ?? (await makeToken());
  return call(path, { method, body, origin, headers: { Authorization: `Bearer ${bearer}` }, ...rest });
}

async function rows(table) {
  const { results } = await db.prepare(`SELECT * FROM ${table}`).all();
  return results;
}

function seed(overrides = {}) {
  return createReservation(db, {
    date: DATE, turn: 'comida', time: '14:00', tables: ['1'], people: 3,
    name: NAME, phone: PHONE, menu: false, ...overrides,
  }, NOW);
}

function reservationBody(overrides = {}) {
  return { date: DATE, turn: 'comida', tables: ['3'], people: 2, name: 'Mesa del bar', phone: '', ...overrides };
}

// Todas las rutas del panel, con método, ruta y cuerpo de ejemplo.
const ADMIN_ROUTES = [
  { name: 'dia', method: 'GET', path: `/api/admin/dia?date=${DATE}` },
  { name: 'crear', method: 'POST', path: '/api/admin/reservas', body: reservationBody() },
  { name: 'confirmar', method: 'POST', path: `/api/admin/reservas/${UNKNOWN_ID}/confirmar` },
  { name: 'liberar', method: 'DELETE', path: `/api/admin/reservas/${UNKNOWN_ID}` },
  { name: 'cierres', method: 'PUT', path: '/api/admin/cierres', body: { key: DATE, kind: 'closed', enabled: true } },
  { name: 'ruta desconocida', method: 'GET', path: '/api/admin/nada' },
];

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  signingKey = pair.privateKey;
  publicJwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await db.batch([
    db.prepare('DELETE FROM reservation_tables'),
    db.prepare('DELETE FROM reservations'),
    db.prepare('DELETE FROM day_overrides'),
  ]);

  calls = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push(url);
    if (url === GOOGLE_JWK_URL) return Response.json({ keys: [publicJwk] });
    throw new Error(`fetch inesperado en test: ${url}`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('autenticación y autorización', () => {
  it.each(ADMIN_ROUTES)('admin_401_no_token: $name', async ({ method, path, body }) => {
    const response = await call(path, { method, body, origin: ORIGIN });
    expect(response.status).toBe(401);
  });

  it('admin_401_invalid_token', async () => {
    for (const authorization of ['Bearer basura', 'Bearer a.b.c', 'Basic abc', 'Bearer ']) {
      const response = await call(`/api/admin/dia?date=${DATE}`, { origin: ORIGIN, headers: { Authorization: authorization } });
      expect(response.status).toBe(401);
    }
  });

  it('admin_401_wrong_audience', async () => {
    const token = await makeToken({ aud: 'otro-proyecto' });
    for (const { method, path, body } of ADMIN_ROUTES) {
      const response = await admin(path, { method, body, token });
      expect(response.status).toBe(401);
    }
  });

  it.each(ADMIN_ROUTES)('admin_403_email_not_allowed: $name', async ({ method, path, body }) => {
    const token = await makeToken({ email: OTHER_EMAIL });
    const response = await admin(path, { method, body, token });
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain(NAME);
  });

  it('admin_403_does_not_touch_db', async () => {
    const token = await makeToken({ email: OTHER_EMAIL });
    await admin('/api/admin/reservas', { method: 'POST', body: reservationBody(), token });
    await admin('/api/admin/cierres', { method: 'PUT', body: { key: DATE, kind: 'closed', enabled: true }, token });
    expect(await rows('reservations')).toHaveLength(0);
    expect(await rows('day_overrides')).toHaveLength(0);
  });

  it('admin_403_with_empty_allowlist', async () => {
    const ctx = createExecutionContext();
    const request = new Request(`https://worker.test/api/admin/dia?date=${DATE}`, {
      headers: { Authorization: `Bearer ${await makeToken()}`, Origin: ORIGIN },
    });
    const response = await worker.fetch(request, makeEnv({ ALLOWED_PUBLISHER_EMAILS: '' }), ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(403);
  });

  it('admin_auth_before_body: cuerpo inválido con token ausente da 401, no 400', async () => {
    const response = await call('/api/admin/reservas', { method: 'POST', origin: ORIGIN, rawBody: '{no es json' });
    expect(response.status).toBe(401);
  });
});

describe('CORS y caché', () => {
  it('admin_preflight_needs_no_auth', async () => {
    const response = await call('/api/admin/cierres', { method: 'OPTIONS', origin: ORIGIN });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    const methods = response.headers.get('Access-Control-Allow-Methods');
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) expect(methods).toContain(method);
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
  });

  it('admin_foreign_origin_403_for_every_method', async () => {
    await seed();
    for (const { method, path, body } of ADMIN_ROUTES) {
      const response = await admin(path, { method, body, origin: FOREIGN_ORIGIN });
      expect(response.status).toBe(403);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect(await response.text()).not.toContain(NAME);
    }
    expect(await rows('reservations')).toHaveLength(1);
  });

  it('admin_responses_are_no_store', async () => {
    const ok = await admin(`/api/admin/dia?date=${DATE}`);
    const unauthorized = await call(`/api/admin/dia?date=${DATE}`, { origin: ORIGIN });
    const notFound = await admin('/api/admin/nada');
    const badRequest = await admin('/api/admin/dia');
    for (const response of [ok, unauthorized, notFound, badRequest]) {
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });

  it('admin_unknown_route_404_after_auth', async () => {
    const response = await admin('/api/admin/nada');
    expect(response.status).toBe(404);
  });
});

describe('GET /api/admin/dia', () => {
  it('admin_day_lists_all_turns_including_closed', async () => {
    await seed({ tables: ['1'], name: NAME, phone: PHONE });
    await seed({ turn: 'cena', time: '21:00', tables: ['2'], name: 'Otra Persona', phone: '600000001', status: 'confirmed' });
    // Cerrar la cena no la oculta del panel.
    await db.prepare('INSERT INTO day_overrides (key, kind) VALUES (?, ?)').bind(`${DATE}|cena`, 'closed').run();

    const response = await admin(`/api/admin/dia?date=${DATE}`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.reservations).toHaveLength(2);
    expect(data.reservations.map((r) => r.turn).sort()).toEqual(['cena', 'comida']);
    const comida = data.reservations.find((r) => r.turn === 'comida');
    expect(comida).toMatchObject({ name: NAME, phone: PHONE, tables: ['1'], status: 'pending' });
    expect(data.overrides.closed).toEqual([`${DATE}|cena`]);
    expect(data.overrides.openSunday).toEqual([]);
  });

  it('admin_pending_count_spans_all_days_and_skips_expired', async () => {
    await seed({ date: DATE, tables: ['1'] });
    await seed({ date: WEDNESDAY, tables: ['1'] });
    await seed({ date: DATE, turn: 'cena', time: '21:00', tables: ['2'], phone: '600000001' });
    await seed({ date: DATE, tables: ['3'], status: 'confirmed' });
    // Pendiente ya vencida: no cuenta.
    const { id } = await seed({ date: DATE, tables: ['5'], phone: '600000002' });
    await db.prepare('UPDATE reservations SET deadline = ? WHERE id = ?').bind('2026-11-01T09:00:00.000Z', id).run();

    const data = await (await admin(`/api/admin/dia?date=${WEDNESDAY}`)).json();
    expect(data.reservations).toHaveLength(1);
    expect(data.pendingCount).toBe(3);
  });

  it('admin_day_rejects_bad_date', async () => {
    for (const query of ['', '?date=2026-02-30', '?date=hoy']) {
      const response = await admin(`/api/admin/dia${query}`);
      expect(response.status).toBe(400);
    }
  });
});

describe('POST /api/admin/reservas', () => {
  it('admin_mark_table_4', async () => {
    const response = await admin('/api/admin/reservas', {
      method: 'POST',
      body: reservationBody({ tables: ['4'], people: 2, name: '', phone: '' }),
    });
    expect(response.status).toBe(201);
    const { id } = await response.json();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const [reservation] = await rows('reservations');
    expect(reservation).toMatchObject({ id, status: 'confirmed', deadline: null, name: '', phone: '', time: '14:00', menu: 0 });
    expect(await rows('reservation_tables')).toMatchObject([{ table_label: '4', status: 'confirmed' }]);
    expect(calls).not.toContain('https://challenges.cloudflare.com/turnstile/v0/siteverify');
  });

  it('admin_create_default_time_per_turn_and_explicit_time', async () => {
    await admin('/api/admin/reservas', { method: 'POST', body: reservationBody({ turn: 'cena', tables: ['1'] }) });
    await admin('/api/admin/reservas', { method: 'POST', body: reservationBody({ tables: ['2'], time: '13:15' }) });
    const times = (await rows('reservations')).map((r) => `${r.turn} ${r.time}`).sort();
    expect(times).toEqual(['cena 21:00', 'comida 13:15']);
  });

  it('admin_create_allows_closed_turn_sunday_and_any_group', async () => {
    // Domingo cerrado y sin reglas de pareja ni límite de la web: todo vale en el panel.
    const sunday = await admin('/api/admin/reservas', {
      method: 'POST',
      body: reservationBody({ date: SUNDAY, tables: ['1', '3', '5'], people: 40 }),
    });
    expect(sunday.status).toBe(201);
    const data = await (await admin(`/api/admin/dia?date=${SUNDAY}`)).json();
    expect(data.reservations[0].tables).toEqual(['1', '3', '5']);
  });

  it('admin_create_past_turn_400', async () => {
    // NOW = domingo 1 nov 2026, 11:00 Madrid.
    const pastDay = await admin('/api/admin/reservas', { method: 'POST', body: reservationBody({ date: '2026-10-31' }) });
    expect(pastDay.status).toBe(400);
    expect((await pastDay.json()).error).toBe('Ese turno ya ha pasado');
    expect(await rows('reservations')).toHaveLength(0);
  });

  it('admin_create_same_day_finished_turn_400_and_running_turn_ok', async () => {
    const mark = (overrides) => admin('/api/admin/reservas', { method: 'POST', body: reservationBody(overrides) });

    vi.setSystemTime(new Date('2026-11-06T15:00:00Z')); // viernes 16:00 Madrid: comida acabada
    const over = await mark({ date: '2026-11-06', turn: 'comida' });
    expect(over.status).toBe(400);
    expect((await over.json()).error).toBe('Ese turno ya ha pasado');
    expect((await mark({ date: '2026-11-06', turn: 'cena', tables: ['1'] })).status).toBe(201);

    vi.setSystemTime(new Date('2026-11-06T20:30:00Z')); // 21:30 justo: la cena sigue en curso
    expect((await mark({ date: '2026-11-06', turn: 'cena', tables: ['2'] })).status).toBe(201);

    vi.setSystemTime(new Date('2026-11-06T21:00:00Z')); // 22:00: cena acabada
    expect((await mark({ date: '2026-11-06', turn: 'cena', tables: ['3'] })).status).toBe(400);
    expect((await mark({ date: '2026-11-07', turn: 'comida', tables: ['3'] })).status).toBe(201); // mañana
  });

  it('admin_create_taken_table_409', async () => {
    await seed({ tables: ['1'] });
    const response = await admin('/api/admin/reservas', { method: 'POST', body: reservationBody({ tables: ['3', '1'] }) });
    expect(response.status).toBe(409);
    expect(await rows('reservations')).toHaveLength(1);
  });

  it.each([
    ['sin mesas', { tables: [] }],
    ['mesa inexistente', { tables: ['99'] }],
    ['mesa repetida', { tables: ['1', '1'] }],
    ['mesas no son texto', { tables: [1] }],
    ['0 personas', { people: 0 }],
    ['61 personas', { people: 61 }],
    ['personas decimal', { people: 2.5 }],
    ['personas texto', { people: '2' }],
    ['nombre largo', { name: 'x'.repeat(101) }],
    ['nombre no texto', { name: 5 }],
    ['teléfono corto', { phone: '60000000' }],
    ['teléfono con letras', { phone: '60000000a' }],
    ['hora inválida', { time: '25:00' }],
    ['hora mal formada', { time: '9:00' }],
    ['fecha inexistente', { date: '2026-02-30' }],
    ['turno inválido', { turn: 'desayuno' }],
  ])('admin_create_400: %s', async (_name, overrides) => {
    const response = await admin('/api/admin/reservas', { method: 'POST', body: reservationBody(overrides) });
    expect(response.status).toBe(400);
    expect(await rows('reservations')).toHaveLength(0);
  });

  it('admin_create_400_for_non_object_and_bad_json', async () => {
    const list = await admin('/api/admin/reservas', { method: 'POST', body: [] });
    const broken = await admin('/api/admin/reservas', { method: 'POST', rawBody: '{roto' });
    expect(list.status).toBe(400);
    expect(broken.status).toBe(400);
  });

  it('admin_create_413_when_body_too_large', async () => {
    const response = await admin('/api/admin/reservas', {
      method: 'POST',
      body: reservationBody({ name: 'x'.repeat(20 * 1024) }),
    });
    expect(response.status).toBe(413);
  });
});

describe('POST /api/admin/reservas/:id/confirmar', () => {
  it('admin_confirm_pending_200', async () => {
    const { id } = await seed();
    const response = await admin(`/api/admin/reservas/${id}/confirmar`, { method: 'POST' });
    expect(response.status).toBe(200);
    const [reservation] = await rows('reservations');
    expect(reservation).toMatchObject({ status: 'confirmed', deadline: null });
  });

  it('admin_confirm_expired_409', async () => {
    const { id } = await seed();
    await db.prepare('UPDATE reservations SET deadline = ? WHERE id = ?').bind('2026-11-01T09:00:00.000Z', id).run();
    const response = await admin(`/api/admin/reservas/${id}/confirmar`, { method: 'POST' });
    expect(response.status).toBe(409);
    expect((await rows('reservations'))[0].status).toBe('pending');
  });

  it('admin_confirm_not_pending_or_unknown_409', async () => {
    const { id } = await seed({ status: 'confirmed' });
    expect((await admin(`/api/admin/reservas/${id}/confirmar`, { method: 'POST' })).status).toBe(409);
    expect((await admin(`/api/admin/reservas/${UNKNOWN_ID}/confirmar`, { method: 'POST' })).status).toBe(409);
  });

  it('admin_confirm_non_uuid_id_404', async () => {
    const response = await admin('/api/admin/reservas/no-es-uuid/confirmar', { method: 'POST' });
    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/admin/reservas/:id', () => {
  it('admin_release_frees_table', async () => {
    const { id } = await seed({ tables: ['1'] });
    const response = await admin(`/api/admin/reservas/${id}`, { method: 'DELETE' });
    expect(response.status).toBe(200);
    expect((await rows('reservations'))[0].status).toBe('released');

    const again = await admin(`/api/admin/reservas/${id}`, { method: 'DELETE' });
    expect(again.status).toBe(404);

    const reuse = await admin('/api/admin/reservas', { method: 'POST', body: reservationBody({ tables: ['1'] }) });
    expect(reuse.status).toBe(201);
  });

  it('admin_release_unknown_or_non_uuid_404', async () => {
    expect((await admin(`/api/admin/reservas/${UNKNOWN_ID}`, { method: 'DELETE' })).status).toBe(404);
    expect((await admin('/api/admin/reservas/1', { method: 'DELETE' })).status).toBe(404);
  });
});

describe('PUT /api/admin/cierres', () => {
  const put = (body) => admin('/api/admin/cierres', { method: 'PUT', body });

  it('close_does_not_cancel_reservations', async () => {
    await seed({ tables: ['1'] });
    const response = await put({ key: DATE, kind: 'closed', enabled: true });
    expect(response.status).toBe(200);
    expect(await rows('day_overrides')).toEqual([{ key: DATE, kind: 'closed' }]);

    const reservations = await rows('reservations');
    expect(reservations).toHaveLength(1);
    expect(reservations[0].status).toBe('pending');
    const data = await (await admin(`/api/admin/dia?date=${DATE}`)).json();
    expect(data.reservations).toHaveLength(1);
    expect(data.reservations[0].name).toBe(NAME);
    expect(data.overrides.closed).toEqual([DATE]);
  });

  it('close_turn_and_reopen', async () => {
    await put({ key: `${DATE}|cena`, kind: 'closed', enabled: true });
    expect(await rows('day_overrides')).toHaveLength(1);
    const response = await put({ key: `${DATE}|cena`, kind: 'closed', enabled: false });
    expect(response.status).toBe(200);
    expect(await rows('day_overrides')).toHaveLength(0);
  });

  it('open_sunday_enables_turn', async () => {
    const before = await (await call(`/api/disponibilidad?date=${SUNDAY}&turn=comida`, { origin: ORIGIN })).json();
    expect(before.closed).toBe(true);

    const response = await put({ key: `${SUNDAY}|comida`, kind: 'open_sunday', enabled: true });
    expect(response.status).toBe(200);
    const after = await (await call(`/api/disponibilidad?date=${SUNDAY}&turn=comida`, { origin: ORIGIN })).json();
    expect(after.closed).toBe(false);
    expect(after.turns).toEqual(['comida']);
  });

  it.each([
    ['open_sunday sin turno', { key: SUNDAY, kind: 'open_sunday', enabled: true }],
    ['open_sunday en día que no es domingo', { key: `${DATE}|comida`, kind: 'open_sunday', enabled: true }],
    ['clave con espacios', { key: ` ${DATE}`, kind: 'closed', enabled: true }],
    ['fecha inexistente', { key: '2026-02-30', kind: 'closed', enabled: true }],
    ['turno inexistente', { key: `${DATE}|desayuno`, kind: 'closed', enabled: true }],
    ['clave con sufijo', { key: `${DATE}|comida|x`, kind: 'closed', enabled: true }],
    ['clave no es texto', { key: 5, kind: 'closed', enabled: true }],
    ['kind inválido', { key: DATE, kind: 'otro', enabled: true }],
    ['enabled no booleano', { key: DATE, kind: 'closed', enabled: 'true' }],
    ['enabled ausente', { key: DATE, kind: 'closed' }],
  ])('cierres_400: %s', async (_name, body) => {
    const response = await put(body);
    expect(response.status).toBe(400);
    expect(await rows('day_overrides')).toHaveLength(0);
  });
});

describe('API pública', () => {
  it('availability_still_public_without_personal_data', async () => {
    await seed({ tables: ['1'] });
    const response = await call(`/api/disponibilidad?date=${DATE}&turn=comida`, { origin: ORIGIN });
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).not.toContain(NAME);
    expect(text).not.toContain(PHONE);
    expect(JSON.parse(text).taken).toEqual([{ label: '1', status: 'pending' }]);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

const TURNSTILE_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const RESEND_URL = 'https://api.resend.com/emails';

let calls;
let turnstileHandler;
let resendHandler;

function makeEnv(extra = {}) {
  return {
    DB: db,
    RESERVAS_ABIERTAS: 'true',
    TURNSTILE_SECRET_KEY: 'secreto-de-prueba',
    RESEND_API_KEY: 're_prueba',
    MAIL_TO: 'bar@example.test',
    ...extra,
  };
}

async function call(path, { method = 'GET', body, origin, headers = {}, rawBody, envExtra } = {}) {
  const init = { method, headers: { ...headers } };
  if (origin) init.headers.Origin = origin;
  if (rawBody !== undefined) init.body = rawBody;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['Content-Type'] = 'application/json';
  }
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(`https://worker.test${path}`, init), makeEnv(envExtra), ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

function payload(overrides = {}) {
  return {
    date: DATE,
    turn: 'comida',
    time: '14:00',
    tables: ['1'],
    people: 3,
    name: NAME,
    phone: PHONE,
    menu: false,
    ack: true,
    turnstileToken: 'token-bueno',
    ...overrides,
  };
}

const post = (body, opts = {}) => call('/api/reservas', { method: 'POST', body, origin: ORIGIN, ...opts });

async function rows(table) {
  const { results } = await db.prepare(`SELECT * FROM ${table}`).all();
  return results;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await db.batch([
    db.prepare('DELETE FROM reservation_tables'),
    db.prepare('DELETE FROM reservations'),
    db.prepare('DELETE FROM day_overrides'),
  ]);

  calls = [];
  turnstileHandler = () => Response.json({ success: true });
  resendHandler = () => Response.json({ id: 'email-1' });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push({ url, init });
    if (url === TURNSTILE_URL) return turnstileHandler(init);
    if (url === RESEND_URL) return resendHandler(init);
    throw new Error(`fetch inesperado en test: ${url}`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('GET /api/disponibilidad', () => {
  it('availability_has_no_personal_data', async () => {
    await createReservation(db, {
      date: DATE, turn: 'comida', time: '14:00', tables: ['1'], people: 3,
      name: NAME, phone: PHONE, menu: false,
    }, NOW);
    // Reserva del bar ya confirmada en la mesa alta, con otro nombre.
    await createReservation(db, {
      date: DATE, turn: 'comida', time: '14:00', tables: ['4'], people: 2,
      name: 'Nombre Del Bar', phone: '600000009', menu: false, status: 'confirmed',
    }, NOW);

    const response = await call(`/api/disponibilidad?date=${DATE}&turn=comida`, { origin: ORIGIN });
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).not.toContain(NAME);
    expect(text).not.toContain(PHONE);
    expect(text).not.toContain('Nombre Del Bar');
    expect(text).not.toContain('600000009');

    const data = JSON.parse(text);
    expect(data.closed).toBe(false);
    expect(data.turns).toEqual(['comida', 'cena']);
    expect(data.slots).toContain('14:00');
    expect(data.taken).toHaveLength(2);
    expect(data.taken).toEqual(
      expect.arrayContaining([
        { label: '1', status: 'pending' },
        { label: '4', status: 'confirmed' },
      ]),
    );
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });

  it('works_with_reservations_flag_closed', async () => {
    const response = await call(`/api/disponibilidad?date=${DATE}&turn=comida`, {
      envExtra: { RESERVAS_ABIERTAS: 'false' },
    });
    expect(response.status).toBe(200);
    expect((await response.json()).slots.length).toBeGreaterThan(0);
  });

  it('reports_closed_day_without_slots', async () => {
    const response = await call(`/api/disponibilidad?date=${SUNDAY}&turn=comida`);
    const data = await response.json();
    expect(data).toEqual({ turns: [], slots: [], taken: [], closed: true });
  });

  it('rejects_bad_params', async () => {
    expect((await call('/api/disponibilidad?date=hoy&turn=comida')).status).toBe(400);
    expect((await call('/api/disponibilidad?date=2026-02-31&turn=comida')).status).toBe(400);
    expect((await call(`/api/disponibilidad?date=${DATE}&turn=desayuno`)).status).toBe(400);
  });
});

describe('POST /api/reservas', () => {
  it('creates_reservation_and_notifies', async () => {
    const response = await post(payload({ name: '  Ana <b>  ' }));
    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.id).toBeTruthy();
    expect(data.deadline).toBeTruthy();

    const [reservation] = await rows('reservations');
    expect(reservation.name).toBe('Ana <b>');
    expect(reservation.status).toBe('pending');

    const mail = calls.find((c) => c.url === RESEND_URL);
    expect(mail).toBeTruthy();
    const sent = JSON.parse(mail.init.body);
    expect(sent.to).toBe('bar@example.test');
    // Nombre y teléfono solo viven en el panel (se borran a los 30 días); el email no.
    expect(sent.html).not.toContain('Ana');
    expect(sent.html).not.toContain(PHONE);
    expect(sent.html).toContain('14:00');
    expect(sent.html).toContain('Sin menú del día');
    expect(sent.html).toContain('https://your-firebase-project.web.app/admin/reservas/');
    expect(sent.html).not.toContain(data.id);
  });

  it('menu_only_on_weekday_lunch', async () => {
    await post(payload({ date: WEDNESDAY, menu: true }));
    await post(payload({ date: DATE, turn: 'comida', time: '14:15', tables: ['3'], menu: true }));
    await post(payload({ date: DATE, turn: 'cena', time: '21:00', tables: ['5'], menu: true, phone: '600000002' }));
    const byKey = Object.fromEntries((await rows('reservations')).map((r) => [`${r.date}|${r.turn}`, r.menu]));
    expect(byKey[`${WEDNESDAY}|comida`]).toBe(1);
    expect(byKey[`${DATE}|comida`]).toBe(1);
    expect(byKey[`${DATE}|cena`]).toBe(0);
  });

  it('email_labels_menu', async () => {
    await post(payload({ date: WEDNESDAY, menu: true }));
    const sent = JSON.parse(calls.find((c) => c.url === RESEND_URL).init.body);
    expect(sent.html).toContain('Menú del día');
    expect(sent.html).not.toContain('Sin menú del día');
  });

  it('email_uses_panel_url_and_subject_prefix_from_env', async () => {
    const panel = 'https://your-firebase-project--pr1-abc.web.app/admin/reservas/';
    await post(payload(), { envExtra: { PANEL_URL: panel, MAIL_SUBJECT_PREFIX: '[PRUEBA] ' } });
    const sent = JSON.parse(calls.find((c) => c.url === RESEND_URL).init.body);
    expect(sent.html).toContain(`href="${panel}"`);
    expect(sent.html).not.toContain('https://your-firebase-project.web.app/admin/reservas/');
    expect(sent.subject).toBe('[PRUEBA] Nueva reserva online: 2026-11-06 14:00');
  });

  it('email_defaults_without_panel_url_or_prefix', async () => {
    await post(payload());
    const sent = JSON.parse(calls.find((c) => c.url === RESEND_URL).init.body);
    expect(sent.subject).toBe('Nueva reserva online: 2026-11-06 14:00');
    expect(sent.html).toContain('href="https://your-firebase-project.web.app/admin/reservas/"');
  });

  it('weekend_lunch_never_has_menu', async () => {
    await post(payload({ date: '2026-11-07', menu: true })); // sábado
    expect((await rows('reservations'))[0].menu).toBe(0);
  });

  it('post_503_when_closed_flag', async () => {
    const response = await post(payload(), { envExtra: { RESERVAS_ABIERTAS: 'false' } });
    expect(response.status).toBe(503);
    expect(await rows('reservations')).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it('post_requires_ack', async () => {
    expect((await post(payload({ ack: false }))).status).toBe(400);
    expect((await post(payload({ ack: undefined }))).status).toBe(400);
    expect((await post(payload({ ack: 'true' }))).status).toBe(400);
    expect(await rows('reservations')).toHaveLength(0);
  });

  it('post_rejects_bad_phone', async () => {
    for (const phone of ['12345', '6000000001', '60000000a', 600000000, '600 00 00 00']) {
      expect((await post(payload({ phone }))).status).toBe(400);
    }
    expect(await rows('reservations')).toHaveLength(0);
  });

  it('post_rejects_malformed_fields', async () => {
    const bad = [
      { date: '2026-02-31' },
      { date: '6/11/2026' },
      { turn: 'desayuno' },
      { time: '9:00' },
      { name: '   ' },
      { name: 'a'.repeat(101) },
      { name: 42 },
      { people: '3' },
      { people: 2.5 },
      { tables: '1' },
      { tables: [1] },
      { tables: [] },
      { menu: 'si' },
      { turnstileToken: undefined },
    ];
    for (const overrides of bad) {
      expect((await post(payload(overrides))).status, JSON.stringify(overrides)).toBe(400);
    }
    expect(await rows('reservations')).toHaveLength(0);
  });

  it('post_rejects_invalid_selection_and_time', async () => {
    expect((await post(payload({ tables: ['4'] }))).status).toBe(400); // mesa alta
    expect((await post(payload({ tables: ['1', '3'], people: 6 }))).status).toBe(400);
    expect((await post(payload({ people: 9 }))).status).toBe(400);
    expect((await post(payload({ time: '16:00' }))).status).toBe(400); // fuera de franjas
    expect(await rows('reservations')).toHaveLength(0);
  });

  it('post_rejects_closed_day', async () => {
    expect((await post(payload({ date: SUNDAY }))).status).toBe(400);
    expect((await post(payload({ date: WEDNESDAY, turn: 'cena', time: '20:00' }))).status).toBe(400);
    expect(await rows('reservations')).toHaveLength(0);
  });

  it('post_rejects_invalid_turnstile', async () => {
    turnstileHandler = () => Response.json({ success: false, 'error-codes': ['invalid-input-response'] });
    const response = await post(payload());
    expect(response.status).toBe(400);
    expect(await rows('reservations')).toHaveLength(0);
    expect(calls.some((c) => c.url === RESEND_URL)).toBe(false);
  });

  it('post_fails_closed_when_turnstile_is_down', async () => {
    turnstileHandler = () => new Response('boom', { status: 500 });
    expect((await post(payload())).status).toBe(400);
    turnstileHandler = () => { throw new Error('red caída'); };
    expect((await post(payload())).status).toBe(400);
    expect(await rows('reservations')).toHaveLength(0);
  });

  it('post_fails_closed_without_secret', async () => {
    const response = await post(payload(), { envExtra: { TURNSTILE_SECRET_KEY: undefined } });
    expect(response.status).toBe(400);
    expect(await rows('reservations')).toHaveLength(0);
  });

  it('sends_secret_and_token_to_turnstile', async () => {
    await post(payload());
    const verify = calls.find((c) => c.url === TURNSTILE_URL);
    const sent = new URLSearchParams(String(verify.init.body));
    expect(sent.get('secret')).toBe('secreto-de-prueba');
    expect(sent.get('response')).toBe('token-bueno');
  });

  it('post_409_on_taken', async () => {
    expect((await post(payload())).status).toBe(201);
    const response = await post(payload({ phone: '600000001' }));
    expect(response.status).toBe(409);
    expect(await rows('reservations')).toHaveLength(1);
  });

  it('post_429_third_pending_same_phone', async () => {
    expect((await post(payload({ tables: ['1'] }))).status).toBe(201);
    expect((await post(payload({ tables: ['3'] }))).status).toBe(201);
    const response = await post(payload({ tables: ['5'] }));
    expect(response.status).toBe(429);
    expect(await rows('reservations')).toHaveLength(2);
  });

  it('post_survives_email_failure', async () => {
    resendHandler = () => new Response('error', { status: 500 });
    expect((await post(payload())).status).toBe(201);
    resendHandler = () => { throw new Error('red caída'); };
    expect((await post(payload({ tables: ['3'] }))).status).toBe(201);
    expect(await rows('reservations')).toHaveLength(2);
  });

  it('email_failure_does_not_log_personal_data', async () => {
    const logs = [];
    for (const method of ['log', 'warn', 'error']) {
      vi.spyOn(console, method).mockImplementation((...args) => logs.push(args.join(' ')));
    }
    resendHandler = () => new Response(`fallo para ${NAME} ${PHONE}`, { status: 500 });
    await post(payload());
    expect(logs.join('\n')).not.toContain(NAME);
    expect(logs.join('\n')).not.toContain(PHONE);
  });

  it('bad_json_is_400', async () => {
    const response = await post(undefined, { rawBody: '{no es json' });
    expect(response.status).toBe(400);
  });

  it('rejects_oversized_body', async () => {
    const response = await post(payload({ name: 'a'.repeat(20000) }));
    expect(response.status).toBe(413);
    expect(await rows('reservations')).toHaveLength(0);
  });

  it('error_messages_have_no_internal_details', async () => {
    const response = await post(payload({ phone: 'x' }));
    const text = await response.text();
    expect(text).not.toMatch(/SQLITE|stack|at \w+\.|node_modules/i);
  });
});

describe('CORS', () => {
  it('cors_rejects_foreign_origin', async () => {
    const response = await post(payload(), { origin: 'https://malo.example' });
    expect(response.status).toBe(403);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(await rows('reservations')).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it('allows_preview_channel_origin', async () => {
    const preview = 'https://your-firebase-project--pr-12-abc.web.app';
    const response = await post(payload(), { origin: preview });
    expect(response.status).toBe(201);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(preview);
  });

  it('preflight_allowed_and_foreign', async () => {
    const ok = await call('/api/reservas', { method: 'OPTIONS', origin: ORIGIN });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(ok.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(ok.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');

    const bad = await call('/api/disponibilidad', { method: 'OPTIONS', origin: 'https://malo.example' });
    expect(bad.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('dev_origin_allowed_only_when_defined_and_exact', async () => {
    const dev = 'http://localhost:8080';
    const preflight = (origin, envExtra) => call('/api/reservas', { method: 'OPTIONS', origin, envExtra });

    const defined = await preflight(dev, { DEV_ORIGIN: dev });
    expect(defined.headers.get('Access-Control-Allow-Origin')).toBe(dev);

    const undefinedVar = await preflight(dev);
    expect(undefinedVar.headers.get('Access-Control-Allow-Origin')).toBeNull();

    const otherPort = await preflight('http://localhost:9999', { DEV_ORIGIN: dev });
    expect(otherPort.headers.get('Access-Control-Allow-Origin')).toBeNull();

    expect((await post(payload(), { origin: dev })).status).toBe(403);
    expect((await post(payload(), { origin: dev, envExtra: { DEV_ORIGIN: dev } })).status).toBe(201);
  });

  it('foreign_origin_get_has_no_acao', async () => {
    const response = await call(`/api/disponibilidad?date=${DATE}&turn=comida`, { origin: 'https://malo.example' });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('rutas existentes', () => {
  it('legacy_form_still_works', async () => {
    const response = await call('/', {
      method: 'POST',
      origin: ORIGIN,
      body: {
        nombre: 'Cliente Prueba', telefono: PHONE, fecha: '06-11-2026',
        hora: '14:00', personas: 3, tipo: 'De Karta',
      },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(calls.filter((c) => c.url === RESEND_URL)).toHaveLength(1);
    expect(await rows('reservations')).toHaveLength(0);
  });

  it('publish_route_unchanged', async () => {
    const noAuth = await call('/publish', { method: 'POST', origin: ORIGIN, body: {} });
    expect(noAuth.status).toBe(401);
    expect(noAuth.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);

    const preflight = await call('/publish', { method: 'OPTIONS', origin: ORIGIN });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toBe('Authorization, Content-Type');
  });

  it('unknown_api_path_is_404', async () => {
    expect((await call('/api/otra-cosa', { origin: ORIGIN })).status).toBe(404);
  });
});

describe('fallos internos', () => {
  const brokenDb = {
    prepare() { throw Object.assign(new Error(`detalle con ${NAME} ${PHONE}`), { name: 'FallaD1' }); },
    batch() { return this.prepare(); },
  };

  function captureErrors() {
    const logs = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => logs.push(args.join(' ')));
    return logs;
  }

  it('api_500_keeps_cors_when_d1_is_down', async () => {
    const logs = captureErrors();
    const get = await call(`/api/disponibilidad?date=${DATE}&turn=comida`, {
      origin: ORIGIN, envExtra: { DB: brokenDb },
    });
    expect(get.status).toBe(500);
    expect(get.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(await get.json()).toEqual({ error: 'Error al procesar la petición' });

    const created = await post(payload(), { envExtra: { DB: brokenDb } });
    expect(created.status).toBe(500);
    expect(created.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);

    expect(logs.join('\n')).toContain('FallaD1');
    expect(logs.join('\n')).not.toContain(NAME);
    expect(logs.join('\n')).not.toContain(PHONE);
  });

  it('scheduled_logs_error_name_and_rethrows', async () => {
    const logs = captureErrors();
    const ctx = createExecutionContext();
    await worker.scheduled({}, makeEnv({ DB: brokenDb }), ctx);
    await expect(waitOnExecutionContext(ctx)).rejects.toThrow();
    expect(logs.join('\n')).toContain('FallaD1');
    expect(logs.join('\n')).not.toContain(NAME);
  });
});

describe('scheduled', () => {
  it('runs_maintenance', async () => {
    await createReservation(db, {
      date: DATE, turn: 'comida', time: '14:00', tables: ['1'], people: 3,
      name: NAME, phone: PHONE, menu: false,
    }, NOW);
    vi.setSystemTime(new Date('2026-11-03T10:00:00Z')); // pasado el plazo
    const ctx = createExecutionContext();
    await worker.scheduled({}, makeEnv(), ctx);
    await waitOnExecutionContext(ctx);
    expect((await rows('reservations'))[0].status).toBe('expired');
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import {
  TableTakenError,
  createReservation,
  listTaken,
  listDay,
  confirmReservation,
  releaseReservation,
  getOverrides,
  setOverride,
  countPendingByPhone,
  runMaintenance,
} from '../reservas/db.js';

const db = env.DB;
const NOW = new Date('2026-11-01T10:00:00Z');
const DATE = '2026-11-06';
const PHONE = '600000000';

function input(overrides = {}) {
  return {
    date: DATE,
    turn: 'comida',
    time: '14:00',
    tables: ['1'],
    people: 3,
    name: 'Cliente Prueba',
    phone: PHONE,
    menu: false,
    ...overrides,
  };
}

const days = (n) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);
const justAfter = (iso) => new Date(new Date(iso).getTime() + 1000);

async function count(table) {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first();
  return row.n;
}

async function statusesOf(id) {
  const reservation = await db.prepare('SELECT status FROM reservations WHERE id = ?').bind(id).first();
  const table = await db.prepare('SELECT status FROM reservation_tables WHERE reservation_id = ?').bind(id).first();
  return { reservation: reservation.status, table: table.status };
}

beforeEach(async () => {
  await db.batch([
    db.prepare('DELETE FROM reservation_tables'),
    db.prepare('DELETE FROM reservations'),
    db.prepare('DELETE FROM day_overrides'),
  ]);
});

describe('createReservation', () => {
  it('create_two_same_table_conflict: la segunda lanza TableTakenError', async () => {
    const first = await createReservation(db, input(), NOW);
    expect(first.id).toEqual(expect.any(String));
    expect(first.deadline).toEqual(expect.any(String));
    await expect(createReservation(db, input({ phone: '600000001' }), NOW)).rejects.toBeInstanceOf(
      TableTakenError,
    );
  });

  it('create_pair_overlap_rolls_back: si una mesa del par está ocupada, la otra queda libre', async () => {
    await createReservation(db, input({ tables: ['2'] }), NOW);
    await expect(
      createReservation(db, input({ tables: ['1', '2'], people: 6 }), NOW),
    ).rejects.toBeInstanceOf(TableTakenError);

    expect(await listTaken(db, DATE, 'comida', NOW)).toEqual([{ label: '2', status: 'pending' }]);
    expect(await count('reservations')).toBe(1);
    expect(await count('reservation_tables')).toBe(1);
  });

  it('create_concurrent_one_wins: de 5 peticiones iguales solo una se cumple', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => createReservation(db, input(), NOW)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(4);
    for (const r of rejected) expect(r.reason).toBeInstanceOf(TableTakenError);
    expect(await count('reservations')).toBe(1);
  });

  it('otro turno o otra fecha no chocan', async () => {
    await createReservation(db, input(), NOW);
    await createReservation(db, input({ turn: 'cena', time: '21:00' }), NOW);
    await createReservation(db, input({ date: '2026-11-07' }), NOW);
    expect(await count('reservations')).toBe(3);
  });

  it('una reserva confirmada directa no tiene deadline', async () => {
    const { id, deadline } = await createReservation(db, input({ status: 'confirmed' }), NOW);
    expect(deadline).toBeNull();
    const row = await db
      .prepare('SELECT status, deadline FROM reservations WHERE id = ?')
      .bind(id)
      .first();
    expect(row).toEqual({ status: 'confirmed', deadline: null });
  });

  it('un expired anterior no impide confirmar otra reserva de la misma mesa', async () => {
    const old = await createReservation(db, input(), NOW);
    const later = justAfter(old.deadline);
    await createReservation(db, input({ status: 'confirmed' }), later);
    expect(await listTaken(db, DATE, 'comida', later)).toEqual([
      { label: '1', status: 'confirmed' },
    ]);
  });
});

describe('listTaken y listDay', () => {
  it('expired_pending_frees_table: pendiente vencida sin mantenimiento no aparece y se puede reservar', async () => {
    const { deadline } = await createReservation(db, input(), NOW);
    const after = justAfter(deadline);

    expect(await listTaken(db, DATE, 'comida', NOW)).toEqual([{ label: '1', status: 'pending' }]);
    expect(await listTaken(db, DATE, 'comida', after)).toEqual([]);
    expect(await listDay(db, DATE, after)).toEqual([]);

    await createReservation(db, input({ phone: '600000001' }), after);
    expect(await listTaken(db, DATE, 'comida', after)).toEqual([{ label: '1', status: 'pending' }]);
  });

  it('listDay devuelve las reservas activas con sus mesas', async () => {
    const { id } = await createReservation(
      db,
      input({ tables: ['10', '15'], people: 6, menu: true }),
      NOW,
    );
    const day = await listDay(db, DATE, NOW);
    expect(day).toHaveLength(1);
    expect(day[0]).toMatchObject({
      id,
      date: DATE,
      turn: 'comida',
      time: '14:00',
      people: 6,
      name: 'Cliente Prueba',
      phone: PHONE,
      menu: true,
      status: 'pending',
    });
    expect([...day[0].tables].sort()).toEqual(['10', '15']);
    expect(await listDay(db, '2026-11-07', NOW)).toEqual([]);
  });
});

describe('confirmReservation y releaseReservation', () => {
  it('confirm_keeps_table: confirmar mantiene la mesa ocupada y quita el deadline', async () => {
    const { id, deadline } = await createReservation(db, input(), NOW);
    expect(await confirmReservation(db, id, NOW)).toBe(true);

    expect(await listTaken(db, DATE, 'comida', justAfter(deadline))).toEqual([
      { label: '1', status: 'confirmed' },
    ]);
    const row = await db.prepare('SELECT deadline FROM reservations WHERE id = ?').bind(id).first();
    expect(row.deadline).toBeNull();
  });

  it('confirm_expired_returns_false: no se confirma una pendiente vencida ni una inexistente', async () => {
    const { id, deadline } = await createReservation(db, input(), NOW);
    expect(await confirmReservation(db, id, justAfter(deadline))).toBe(false);
    expect(await confirmReservation(db, 'no-existe', NOW)).toBe(false);
  });

  it('release_frees_table: liberar deja la mesa libre y no se libera dos veces', async () => {
    const { id } = await createReservation(db, input({ status: 'confirmed' }), NOW);
    expect(await releaseReservation(db, id)).toBe(true);
    expect(await listTaken(db, DATE, 'comida', NOW)).toEqual([]);
    expect(await releaseReservation(db, id)).toBe(false);
    expect(await releaseReservation(db, 'no-existe')).toBe(false);

    const rows = await db.prepare('SELECT status FROM reservation_tables').all();
    expect(rows.results).toEqual([{ status: 'released' }]);
    const parent = await db.prepare('SELECT status FROM reservations WHERE id = ?').bind(id).first();
    expect(parent.status).toBe('released');
    await createReservation(db, input({ phone: '600000001' }), NOW);
  });
});

describe('overrides', () => {
  it('setOverride y getOverrides guardan y quitan cierres de día y turno', async () => {
    await setOverride(db, DATE, 'closed', true);
    await setOverride(db, `${DATE}|cena`, 'closed', true);
    await setOverride(db, `${DATE}|comida`, 'open_sunday', true);
    await setOverride(db, '2026-11-07', 'closed', true);

    const overrides = await getOverrides(db, DATE);
    expect([...overrides.closed].sort()).toEqual([DATE, `${DATE}|cena`]);
    expect([...overrides.openSunday]).toEqual([`${DATE}|comida`]);

    await setOverride(db, DATE, 'closed', false);
    const after = await getOverrides(db, DATE);
    expect([...after.closed]).toEqual([`${DATE}|cena`]);
    expect([...(await getOverrides(db, '2026-11-07')).closed]).toEqual(['2026-11-07']);
  });
});

describe('countPendingByPhone', () => {
  it('cuenta solo pendientes no vencidas de ese teléfono', async () => {
    await createReservation(db, input({ tables: ['1'] }), NOW);
    await createReservation(db, input({ tables: ['2'] }), NOW);
    await createReservation(db, input({ tables: ['3'], status: 'confirmed' }), NOW);
    await createReservation(db, input({ tables: ['5'], phone: '600000001' }), NOW);

    expect(await countPendingByPhone(db, PHONE, NOW)).toBe(2);
    expect(await countPendingByPhone(db, '600000001', NOW)).toBe(1);
    expect(await countPendingByPhone(db, PHONE, days(2))).toBe(0);
  });
});

describe('runMaintenance', () => {
  it('marca vencidas como expired en ambas tablas', async () => {
    const { id, deadline } = await createReservation(db, input(), NOW);
    const keep = await createReservation(db, input({ tables: ['2'], status: 'confirmed' }), NOW);

    expect(await runMaintenance(db, justAfter(deadline))).toEqual({ expired: 1, purged: 0 });

    const reservation = await db.prepare('SELECT status FROM reservations WHERE id = ?').bind(id).first();
    const table = await db
      .prepare('SELECT status FROM reservation_tables WHERE reservation_id = ?')
      .bind(id)
      .first();
    expect(reservation.status).toBe('expired');
    expect(table.status).toBe('expired');
    const kept = await db.prepare('SELECT status FROM reservations WHERE id = ?').bind(keep.id).first();
    expect(kept.status).toBe('confirmed');
  });

  it('purge_after_30_days: borra nombre y teléfono de reservas con más de 30 días, en ambas tablas', async () => {
    await createReservation(db, input({ status: 'confirmed' }), NOW);
    const recent = await createReservation(db, input({ tables: ['2'], status: 'confirmed' }), days(10));

    expect(await runMaintenance(db, days(31))).toEqual({ expired: 0, purged: 1 });

    const reservations = await db.prepare('SELECT id FROM reservations').all();
    expect(reservations.results).toEqual([{ id: recent.id }]);
    const tables = await db.prepare('SELECT reservation_id FROM reservation_tables').all();
    expect(tables.results).toEqual([{ reservation_id: recent.id }]);
  });
});

describe('purga y casos límite', () => {
  it('purge_keeps_future_reservation: no borra una reserva futura aunque created_at tenga más de 30 días', async () => {
    const created = new Date('2026-11-01T09:00:00Z');
    const future = await createReservation(db, input({ date: '2026-12-05', status: 'confirmed' }), created);
    // Con fecha de hoy también se conserva: solo se purga lo anterior a hoy.
    const today = await createReservation(
      db,
      input({ date: '2026-12-01', tables: ['2'], status: 'confirmed' }),
      created,
    );
    const cron = new Date('2026-12-01T10:00:00Z');

    expect(await runMaintenance(db, cron)).toEqual({ expired: 0, purged: 0 });

    expect(await count('reservations')).toBe(2);
    expect(await count('reservation_tables')).toBe(2);
    expect(await listTaken(db, '2026-12-05', 'comida', cron)).toEqual([{ label: '1', status: 'confirmed' }]);
    expect((await listDay(db, '2026-12-05', cron)).map((r) => r.id)).toEqual([future.id]);
    expect((await listDay(db, '2026-12-01', cron)).map((r) => r.id)).toEqual([today.id]);
  });

  it('purge_keeps_today_reservation: usa la fecha de Madrid, no la de UTC', async () => {
    // 23:30 UTC del 1-dic son las 00:30 del 2-dic en Madrid.
    const cron = new Date('2026-12-01T23:30:00Z');
    const today = await createReservation(db, input({ date: '2026-12-02', tables: ['1'], status: 'confirmed' }), NOW);
    await createReservation(db, input({ date: '2026-12-01', tables: ['2'], status: 'confirmed' }), NOW);

    expect(await runMaintenance(db, cron)).toEqual({ expired: 0, purged: 1 });

    const rows = await db.prepare('SELECT id FROM reservations').all();
    expect(rows.results).toEqual([{ id: today.id }]);
    expect(await count('reservation_tables')).toBe(1);
  });

  it('una colisión de reservations.id no se toma por TableTakenError', async () => {
    const { id } = await createReservation(db, input({ tables: ['1'] }), NOW);
    const spy = vi.spyOn(crypto, 'randomUUID').mockReturnValue(id);
    try {
      const error = await createReservation(db, input({ tables: ['2'] }), NOW).catch((e) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(TableTakenError);
    } finally {
      spy.mockRestore();
    }
  });

  it('concurrencia con parejas solapadas: una sola cumplida y sin mesas huérfanas', async () => {
    const attempts = [
      ...Array.from({ length: 3 }, () => input({ tables: ['1', '2'], people: 6 })),
      ...Array.from({ length: 3 }, () => input({ tables: ['2'] })),
    ];
    const results = await Promise.allSettled(attempts.map((a) => createReservation(db, a, NOW)));

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
    for (const r of results.filter((x) => x.status === 'rejected')) {
      expect(r.reason).toBeInstanceOf(TableTakenError);
    }
    expect(await count('reservations')).toBe(1);
    const orphans = await db
      .prepare('SELECT COUNT(*) AS n FROM reservation_tables WHERE reservation_id NOT IN (SELECT id FROM reservations)')
      .first();
    expect(orphans.n).toBe(0);
    const day = await listDay(db, DATE, NOW);
    expect(await listTaken(db, DATE, 'comida', NOW)).toHaveLength(day[0].tables.length);
  });

  it('release sobre expired devuelve false', async () => {
    const { id, deadline } = await createReservation(db, input(), NOW);
    await runMaintenance(db, justAfter(deadline));
    expect(await releaseReservation(db, id)).toBe(false);
    expect(await statusesOf(id)).toEqual({ reservation: 'expired', table: 'expired' });
  });

  it('confirm sobre released devuelve false', async () => {
    const { id } = await createReservation(db, input(), NOW);
    expect(await releaseReservation(db, id)).toBe(true);
    expect(await confirmReservation(db, id, NOW)).toBe(false);
    expect(await statusesOf(id)).toEqual({ reservation: 'released', table: 'released' });
  });

  it('confirm sobre expired con la mesa ya reasignada devuelve false y no toca al nuevo dueño', async () => {
    const old = await createReservation(db, input(), NOW);
    const later = justAfter(old.deadline);
    const fresh = await createReservation(db, input({ phone: '600000001' }), later);

    expect(await confirmReservation(db, old.id, NOW)).toBe(false);

    const row = await db.prepare('SELECT status FROM reservations WHERE id = ?').bind(fresh.id).first();
    expect(row.status).toBe('pending');
    const tables = await db
      .prepare("SELECT reservation_id FROM reservation_tables WHERE status = 'pending'")
      .all();
    expect(tables.results).toEqual([{ reservation_id: fresh.id }]);
  });
});

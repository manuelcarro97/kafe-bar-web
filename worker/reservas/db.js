// Acceso a D1 para las reservas. Todas las funciones reciben `db` primero y el
// instante actual (`nowUtc`, un Date) por parámetro, para poder testearlas.
//
// Garantía anti doble reserva: el índice único parcial `one_booking_per_table`
// (ver migrations/0001_reservas.sql) y que cada escritura multi-sentencia va en un
// único `db.batch()`, que D1 ejecuta como transacción.

import { madridToday, pendingDeadline } from './rules.js';

const PURGE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export class TableTakenError extends Error {
  constructor() {
    super('Alguna de las mesas ya está reservada.');
    this.name = 'TableTakenError';
  }
}

function isUniqueViolation(error) {
  // Solo el índice de mesas: una colisión de reservations.id es otro error.
  const message = String(error?.message ?? error);
  return message.includes('UNIQUE constraint failed') && message.includes('reservation_tables');
}

// Pendiente vencida = pendiente cuyo deadline ya pasó, aunque el mantenimiento aún no la haya marcado.
const pendingExpiredSql = (param) => `r.status = 'pending' AND r.deadline <= ${param}`;

/**
 * Crea la reserva y sus mesas en una sola transacción. Antes de insertar caduca
 * las pendientes vencidas de esa fecha y turno, para que no bloqueen la mesa.
 * input: { date, turn, time, tables, people, name, phone, menu, status = 'pending' }.
 */
export async function createReservation(db, input, nowUtc) {
  const { date, turn, time, tables, people, name, phone, menu, status = 'pending' } = input;
  const now = nowUtc.toISOString();
  const id = crypto.randomUUID();
  const deadline = status === 'pending' ? pendingDeadline(nowUtc, date, time).toISOString() : null;

  const statements = [
    db
      .prepare(
        `UPDATE reservation_tables SET status = 'expired'
         WHERE date = ?1 AND turn = ?2 AND status = 'pending'
           AND reservation_id IN (
             SELECT r.id FROM reservations r
             WHERE r.date = ?1 AND r.turn = ?2 AND ${pendingExpiredSql('?3')})`,
      )
      .bind(date, turn, now),
    db
      .prepare(
        `UPDATE reservations AS r SET status = 'expired'
         WHERE r.date = ?1 AND r.turn = ?2 AND ${pendingExpiredSql('?3')}`,
      )
      .bind(date, turn, now),
    db
      .prepare(
        `INSERT INTO reservations (id, date, turn, time, people, name, phone, menu, status, deadline, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, date, turn, time, people, name, phone, menu ? 1 : 0, status, deadline, now),
    ...tables.map((label) =>
      db
        .prepare(
          `INSERT INTO reservation_tables (reservation_id, table_label, date, turn, status)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(id, label, date, turn, status),
    ),
  ];

  try {
    await db.batch(statements);
  } catch (error) {
    if (isUniqueViolation(error)) throw new TableTakenError();
    throw error;
  }
  return { id, deadline };
}

/** Mesas ocupadas en una fecha y turno, ignorando pendientes vencidas. */
export async function listTaken(db, date, turn, nowUtc) {
  const { results } = await db
    .prepare(
      `SELECT t.table_label AS label, t.status AS status
       FROM reservation_tables t JOIN reservations r ON r.id = t.reservation_id
       WHERE t.date = ?1 AND t.turn = ?2 AND t.status IN ('pending', 'confirmed')
         AND NOT (r.status = 'pending' AND r.deadline <= ?3)`,
    )
    .bind(date, turn, nowUtc.toISOString())
    .all();
  return results;
}

/** Reservas activas de un día (pendientes no vencidas y confirmadas), con sus mesas. */
export async function listDay(db, date, nowUtc) {
  const { results } = await db
    .prepare(
      `SELECT r.id, r.date, r.turn, r.time, r.people, r.name, r.phone, r.menu,
              r.status, r.deadline, r.created_at, t.table_label
       FROM reservations r JOIN reservation_tables t ON t.reservation_id = r.id
       WHERE r.date = ?1 AND r.status IN ('pending', 'confirmed')
         AND NOT (r.status = 'pending' AND r.deadline <= ?2)
       ORDER BY r.turn, r.time, r.created_at, t.table_label`,
    )
    .bind(date, nowUtc.toISOString())
    .all();

  const byId = new Map();
  for (const { table_label, menu, created_at, ...row } of results) {
    if (!byId.has(row.id)) {
      byId.set(row.id, { ...row, menu: menu === 1, createdAt: created_at, tables: [] });
    }
    byId.get(row.id).tables.push(table_label);
  }
  return [...byId.values()];
}

/** Pasa una pendiente no vencida a confirmada. false si no existe o ya no es confirmable. */
export async function confirmReservation(db, id, nowUtc) {
  const now = nowUtc.toISOString();
  const confirmable = "id = ?1 AND status = 'pending' AND deadline > ?2";
  const [, reservation] = await db.batch([
    db
      .prepare(
        `UPDATE reservation_tables SET status = 'confirmed'
         WHERE reservation_id = ?1 AND status = 'pending'
           AND EXISTS (SELECT 1 FROM reservations WHERE ${confirmable})`,
      )
      .bind(id, now),
    db
      .prepare(`UPDATE reservations SET status = 'confirmed', deadline = NULL WHERE ${confirmable}`)
      .bind(id, now),
  ]);
  return reservation.meta.changes > 0;
}

/** Libera una reserva activa (pendiente o confirmada). false si no existía o ya no estaba activa. */
export async function releaseReservation(db, id) {
  const active = "id = ?1 AND status IN ('pending', 'confirmed')";
  const [, reservation] = await db.batch([
    db
      .prepare(
        `UPDATE reservation_tables SET status = 'released'
         WHERE reservation_id = ?1 AND status IN ('pending', 'confirmed')
           AND EXISTS (SELECT 1 FROM reservations WHERE ${active})`,
      )
      .bind(id),
    db.prepare(`UPDATE reservations SET status = 'released' WHERE ${active}`).bind(id),
  ]);
  return reservation.meta.changes > 0;
}

/** Cierres y aperturas de domingo de una fecha, en el formato que espera `turnsFor`. */
export async function getOverrides(db, date) {
  const { results } = await db
    .prepare('SELECT key, kind FROM day_overrides WHERE key = ?1 OR key LIKE ?2')
    .bind(date, `${date}|%`)
    .all();
  const overrides = { closed: new Set(), openSunday: new Set() };
  for (const { key, kind } of results) {
    if (kind === 'closed') overrides.closed.add(key);
    else if (kind === 'open_sunday') overrides.openSunday.add(key);
  }
  return overrides;
}

/** Activa o quita un override. key: 'YYYY-MM-DD' o 'YYYY-MM-DD|turno'; kind: 'closed' | 'open_sunday'. */
export async function setOverride(db, key, kind, enabled) {
  if (enabled) {
    await db.prepare('INSERT OR REPLACE INTO day_overrides (key, kind) VALUES (?, ?)').bind(key, kind).run();
  } else {
    await db.prepare('DELETE FROM day_overrides WHERE key = ? AND kind = ?').bind(key, kind).run();
  }
}

/** Pendientes no vencidas de un teléfono (límite anti abuso). */
export async function countPendingByPhone(db, phone, nowUtc) {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM reservations WHERE phone = ? AND status = 'pending' AND deadline > ?")
    .bind(phone, nowUtc.toISOString())
    .first();
  return row.n;
}

/** Pendientes no vencidas de todos los días y turnos (aviso del panel). */
export async function countPending(db, nowUtc) {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM reservations WHERE status = 'pending' AND deadline > ?")
    .bind(nowUtc.toISOString())
    .first();
  return row.n;
}

/**
 * Mantenimiento horario: marca como expired las pendientes vencidas (en ambas
 * tablas) y borra por completo las reservas con más de 30 días desde created_at
 * cuya fecha ya pasó (día de Madrid), con lo que desaparecen también su nombre y su
 * teléfono. Las futuras no se tocan: borrarlas liberaría la mesa antes de la llegada.
 */
export async function runMaintenance(db, nowUtc) {
  const now = nowUtc.toISOString();
  const cutoff = new Date(nowUtc.getTime() - PURGE_AFTER_MS).toISOString();
  const today = madridToday(nowUtc);

  const [, expired, , purged] = await db.batch([
    db
      .prepare(
        `UPDATE reservation_tables SET status = 'expired'
         WHERE status = 'pending'
           AND reservation_id IN (SELECT r.id FROM reservations r WHERE ${pendingExpiredSql('?')})`,
      )
      .bind(now),
    db
      .prepare(`UPDATE reservations AS r SET status = 'expired' WHERE ${pendingExpiredSql('?')}`)
      .bind(now),
    // Primero las mesas (clave foránea) y luego las reservas.
    db
      .prepare('DELETE FROM reservation_tables WHERE reservation_id IN (SELECT id FROM reservations WHERE created_at < ? AND date < ?)')
      .bind(cutoff, today),
    db.prepare('DELETE FROM reservations WHERE created_at < ? AND date < ?').bind(cutoff, today),
  ]);
  return { expired: expired.meta.changes, purged: purged.meta.changes };
}

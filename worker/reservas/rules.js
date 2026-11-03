// Reglas puras de reservas: mesas, turnos, franjas y caducidad.
// Sin acceso a D1 ni a fetch: todo recibe sus datos por parámetro para poder testearlo.

const TIMEZONE = 'Europe/Madrid';
const SLOT_STEP_MINUTES = 15;
const MAX_DAYS_AHEAD = 30;
const MIN_LEAD_MS = 60 * 60 * 1000;
const PENDING_MAX_MS = 24 * 60 * 60 * 1000;
const PENDING_BEFORE_ARRIVAL_MS = 2 * 60 * 60 * 1000;
const PENDING_MIN_MS = 30 * 60 * 1000;

const CALL_MESSAGE = 'Para grupos grandes, llama al 981 31 82 60 y te confirmamos nosotros.';

// Plantilla sacada del plano: 15 mesas, 60 plazas.
// La 4 es la mesa alta (no reservable online) y la 8 es la de 6.
export const TABLES = [
  { label: '1', seats: 4, online: true },
  { label: '2', seats: 4, online: true },
  { label: '3', seats: 4, online: true },
  { label: '4', seats: 2, online: false },
  { label: '5', seats: 4, online: true },
  { label: '6', seats: 4, online: true },
  { label: '7', seats: 4, online: true },
  { label: '8', seats: 6, online: true },
  { label: '9', seats: 4, online: true },
  { label: '10', seats: 4, online: true },
  { label: '11', seats: 4, online: true },
  { label: '12', seats: 4, online: true },
  { label: '13', seats: 4, online: true },
  { label: '14', seats: 4, online: true },
  { label: '15', seats: 4, online: true },
];

// Únicas mesas que se pueden juntar.
export const PAIRS = [['1', '2'], ['10', '15'], ['11', '14'], ['12', '13']];

// Rangos de personas por tipo de selección.
const SINGLE_RANGE = { min: 1, max: 5 };
const TABLE_8_RANGE = { min: 1, max: 7 };
const PAIR_RANGE = { min: 5, max: 9 };

const TURN_HOURS = {
  comida: { start: '13:00', end: '15:30' },
  cena: { start: '20:00', end: '21:30' },
};

function isPair(a, b) {
  return PAIRS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

function inRange(people, { min, max }) {
  return people >= min && people <= max;
}

function rangeMessage(people, { min, max }) {
  return `Esta selección admite de ${min} a ${max} personas (has indicado ${people}).`;
}

/** Devuelve un mensaje de error en español, o null si la selección es válida. */
export function validateSelection(labels, people) {
  if (!Array.isArray(labels) || labels.length === 0) return 'Elige al menos una mesa.';
  if (!Number.isInteger(people) || people < 1) return 'Número de personas inválido.';
  if (labels.length > 2) return CALL_MESSAGE;

  const tables = labels.map((label) => TABLES.find((t) => t.label === label));
  if (tables.some((t) => !t)) return 'Mesa inexistente.';
  if (tables.some((t) => !t.online)) return 'Esa mesa no se puede reservar online.';

  if (labels.length === 2) {
    if (!isPair(labels[0], labels[1])) return 'Esas dos mesas no se pueden juntar.';
    return inRange(people, PAIR_RANGE) ? null : rangeMessage(people, PAIR_RANGE);
  }

  const range = labels[0] === '8' ? TABLE_8_RANGE : SINGLE_RANGE;
  return inRange(people, range) ? null : rangeMessage(people, range);
}

function parseDate(date) {
  const [year, month, day] = date.split('-').map(Number);
  return { year, month, day };
}

function parseTime(time) {
  const [hour, minute] = time.split(':').map(Number);
  return { hour, minute };
}

function pad(n) {
  return String(n).padStart(2, '0');
}

const madridParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIMEZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function partsOf(utcDate) {
  const parts = {};
  for (const { type, value } of madridParts.formatToParts(utcDate)) parts[type] = Number(value);
  return parts;
}

// Desfase de Madrid respecto a UTC en milisegundos para un instante dado.
function madridOffsetMs(utcDate) {
  const p = partsOf(utcDate);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(utcDate.getTime() / 1000) * 1000;
}

/** Fecha 'YYYY-MM-DD' y hora 'HH:MM' de Madrid -> instante UTC. */
export function madridToUtc(date, time) {
  const { year, month, day } = parseDate(date);
  const { hour, minute } = parseTime(time);
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  // Dos pasadas: la primera estima el desfase, la segunda lo corrige si
  // el resultado cae al otro lado de un cambio de hora.
  let result = wallAsUtc - madridOffsetMs(new Date(wallAsUtc));
  const corrected = wallAsUtc - madridOffsetMs(new Date(result));
  if (corrected !== result) result = corrected;
  return new Date(result);
}

export function madridToday(nowUtc) {
  const p = partsOf(nowUtc);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function addDays(date, days) {
  const { year, month, day } = parseDate(date);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function weekday(date) {
  const { year, month, day } = parseDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 = domingo
}

/**
 * Turnos con reservas ese día. Solo mira calendario y cierres.
 * overrides.closed: 'YYYY-MM-DD' (día) o 'YYYY-MM-DD|turno'.
 * overrides.openSunday: 'YYYY-MM-DD|turno'.
 */
export function turnsFor(date, overrides) {
  if (overrides.closed.has(date)) return [];

  const dow = weekday(date);
  let turns;
  if (dow === 0) {
    turns = ['comida', 'cena'].filter((turn) => overrides.openSunday.has(`${date}|${turn}`));
  } else if (dow === 5 || dow === 6) {
    turns = ['comida', 'cena'];
  } else {
    turns = ['comida'];
  }
  return turns.filter((turn) => !overrides.closed.has(`${date}|${turn}`));
}

/**
 * ¿Ya acabó el turno? Verdadero si el día es anterior a hoy en Madrid, o si es hoy y
 * ya pasó la última hora del turno. A esa hora justa el turno sigue en curso.
 */
export function turnIsOver(date, turn, nowUtc) {
  const today = madridToday(nowUtc);
  if (date < today) return true;
  if (date > today) return false;
  return nowUtc.getTime() > madridToUtc(date, TURN_HOURS[turn].end).getTime();
}

/**
 * Franjas reservables de un turno. Devuelve [] fuera de plazo:
 * más de 30 días vista o menos de 1 hora desde ahora.
 */
export function slotsFor(date, turn, nowUtc) {
  const hours = TURN_HOURS[turn];
  if (!hours) return [];
  if (date > addDays(madridToday(nowUtc), MAX_DAYS_AHEAD)) return [];

  const start = parseTime(hours.start);
  const end = parseTime(hours.end);
  const first = start.hour * 60 + start.minute;
  const last = end.hour * 60 + end.minute;
  const earliest = nowUtc.getTime() + MIN_LEAD_MS;

  const slots = [];
  for (let m = first; m <= last; m += SLOT_STEP_MINUTES) {
    const time = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
    if (madridToUtc(date, time).getTime() >= earliest) slots.push(time);
  }
  return slots;
}

/**
 * Cuándo caduca una reserva pendiente: lo primero entre 24 h desde ahora y
 * 2 h antes de llegar, con un mínimo de 30 min desde ahora.
 */
export function pendingDeadline(nowUtc, date, time) {
  const now = nowUtc.getTime();
  const arrival = madridToUtc(date, time).getTime();
  const deadline = Math.min(now + PENDING_MAX_MS, arrival - PENDING_BEFORE_ARRIVAL_MS);
  return new Date(Math.max(deadline, now + PENDING_MIN_MS));
}

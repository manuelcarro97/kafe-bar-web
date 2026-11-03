// Página pública de reservas: pinta el plano, pide la disponibilidad a la API y envía la solicitud.
// Las reglas de selección de RULES solo sirven para avisar antes de enviar: manda el Worker.

import { renderPlan, planFolder } from '../js/plano.js';
import { apiBase, turnstileSiteKey } from '../js/api-config.js';

const API_BASE = apiBase(location.hostname);
const TURNSTILE_SITE_KEY = turnstileSiteKey(location.hostname);

const PHONE = '981 31 82 60';
const TIMEZONE = 'Europe/Madrid';
const MAX_DAYS_AHEAD = 30;
const TURN_NAMES = { comida: 'Comida', cena: 'Cena' };

// Copia de las reglas de worker/reservas/rules.js (el frontend no puede importar worker/).
const RULES = {
  tables: Array.from({ length: 15 }, (_, i) => String(i + 1)),
  highTable: '4',
  bigTable: '8',
  pairs: [['1', '2'], ['10', '15'], ['11', '14'], ['12', '13']],
  singleRange: { min: 1, max: 5 },
  bigTableRange: { min: 1, max: 7 },
  pairRange: { min: 5, max: 9 },
};

const $ = (id) => document.getElementById(id);
const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const madridDate = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE });
const madridClock = new Intl.DateTimeFormat('es-ES', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const prettyOptions = { weekday: 'long', day: 'numeric', month: 'long' };

const todayIso = () => madridDate.format(new Date());
function addDays(iso, days) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
const dayOf = (date) => new Date(`${date}T12:00`).getDay();
const prettyDate = (date) => new Date(`${date}T12:00`).toLocaleDateString('es-ES', prettyOptions);

const ui = { date: todayIso(), turn: 'comida', time: '', people: 4, selected: [], notice: '', done: null, availability: null, loading: true, loadError: false, sending: false };
const form = { name: '', phone: '', menu: false, ack: false };
let loadSeq = 0;
let turnstileToken = '';
let turnstileWidget = null;
let scrollToNotice = false;

// ---------------------------------------------------------------------------
// Reglas de selección (solo avisos)
// ---------------------------------------------------------------------------

// Deja solo dígitos. Un prefijo 34 (o +34) se quita únicamente si deja exactamente 9 dígitos.
function cleanPhone(raw) {
  const digits = raw.replace(/\D/g, '');
  return (digits.length === 11 && digits.startsWith('34') ? digits.slice(2) : digits).slice(0, 11);
}

function partnerOf(label) {
  const pair = RULES.pairs.find((p) => p.includes(label));
  return pair ? pair.find((other) => other !== label) : null;
}

function peopleLimits() {
  if (ui.selected.length === 2) return RULES.pairRange;
  if (ui.selected.length === 1) return ui.selected[0] === RULES.bigTable ? RULES.bigTableRange : RULES.singleRange;
  return null;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchAvailability(date, turn) {
  const res = await fetch(`${API_BASE}/api/disponibilidad?date=${date}&turn=${turn}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Primer turno de los próximos días con horas libres; si no hay ninguno, hoy con su disponibilidad. */
async function findFirstOpenTurn() {
  const today = todayIso();
  let fallback = null;
  for (let i = 0; i <= MAX_DAYS_AHEAD; i++) {
    const date = addDays(today, i);
    const lunch = await fetchAvailability(date, 'comida');
    fallback ??= { date, turn: 'comida', data: lunch };
    if (lunch.slots.length) return { date, turn: 'comida', data: lunch };
    if (lunch.turns.includes('cena')) {
      const dinner = await fetchAvailability(date, 'cena');
      if (dinner.slots.length) return { date, turn: 'cena', data: dinner };
    }
  }
  return fallback;
}

async function loadAvailability() {
  const seq = ++loadSeq;
  ui.loading = true;
  ui.loadError = false;
  render();
  try {
    let turn = ui.turn;
    let data = await fetchAvailability(ui.date, turn);
    if (data.turns.length && !data.turns.includes(turn)) {
      turn = data.turns[0];
      data = await fetchAvailability(ui.date, turn);
    }
    if (seq !== loadSeq) return;
    ui.turn = turn;
    ui.availability = data;
  } catch {
    if (seq !== loadSeq) return;
    ui.loadError = true;
  }
  ui.loading = false;
  const takenLabels = new Set((ui.availability?.taken ?? []).map((t) => t.label));
  ui.selected = ui.selected.filter((label) => !takenLabels.has(label));
  render();
  // Si la carga no dejó ningún aviso que enseñar, no arrastramos la petición de scroll.
  scrollToNotice = false;
}

async function sendReservation(body) {
  try {
    const res = await fetch(`${API_BASE}/api/reservas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  } catch {
    return { status: 0, data: {} };
  }
}

// ---------------------------------------------------------------------------
// Turnstile
// ---------------------------------------------------------------------------

async function mountTurnstile() {
  // El script de Cloudflare carga async: index.html deja una promesa que resuelve cuando llega.
  await window.turnstileReady;
  turnstileWidget = window.turnstile.render('#turnstile', {
    sitekey: TURNSTILE_SITE_KEY,
    appearance: 'interaction-only',
    callback: (token) => { turnstileToken = token; },
    'expired-callback': () => { turnstileToken = ''; },
    'error-callback': () => { turnstileToken = ''; },
  });
}

// El token se gasta en cada intento de envío, haya salido bien o mal.
function resetTurnstile() {
  turnstileToken = '';
  if (turnstileWidget !== null) window.turnstile.reset(turnstileWidget);
}

// ---------------------------------------------------------------------------
// Estado del plano
// ---------------------------------------------------------------------------

function tableStates() {
  const states = {};
  const data = ui.availability;
  // Sin datos fiables (cargando o error) la sala se ve gris; cerrada, toda en rojo.
  const fill = ui.loading || ui.loadError || !data ? 'blocked' : data.closed ? 'confirmed' : null;
  const taken = new Map((data?.taken ?? []).map((t) => [t.label, t.status]));
  const partner = ui.selected.length === 1 ? partnerOf(ui.selected[0]) : null;
  for (const label of [...RULES.tables, RULES.highTable]) {
    if (fill) states[label] = fill;
    else if (ui.selected.includes(label)) states[label] = 'selected';
    else if (taken.has(label)) states[label] = taken.get(label);
    else if (label === RULES.highTable) states[label] = 'blocked';
    else if (label === partner) states[label] = 'partner';
  }
  return states;
}

function onTable(label) {
  ui.notice = '';
  ui.done = null;
  const data = ui.availability;
  if (ui.loading || ui.loadError || !data || data.closed) return render();
  if (label === RULES.highTable) ui.notice = 'La mesa alta no se reserva online.';
  else if (data.taken.some((t) => t.label === label)) ui.notice = 'Esa mesa ya no está disponible en este turno.';
  else if (ui.selected.includes(label)) ui.selected = ui.selected.filter((x) => x !== label);
  else if (ui.selected.length === 2) ui.notice = `Para grupos grandes, llama al ${PHONE} y te confirmamos nosotros.`;
  else if (ui.selected.length === 1 && partnerOf(ui.selected[0]) !== label) {
    ui.notice = 'Esas mesas no se pueden juntar. Se juntan 1 y 2, 10 y 15, 11 y 14, o 12 y 13.';
  } else ui.selected.push(label);
  render();
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

function dateTurnFields() {
  const today = todayIso();
  const turns = ui.availability?.turns ?? [];
  const options = turns.length
    ? turns.map((t) => `<option value="${t}" ${t === ui.turn ? 'selected' : ''}>${TURN_NAMES[t]}</option>`).join('')
    : `<option>${ui.loading ? TURN_NAMES[ui.turn] : 'Cerrado'}</option>`;
  const disabled = ui.loading || !turns.length ? 'disabled' : '';
  return `<div class="pair">
    <label class="field">Día<input id="fDate" type="date" min="${today}" max="${addDays(today, MAX_DAYS_AHEAD)}" value="${ui.date}"></label>
    <label class="field">Turno<select id="fTurn" ${disabled}>${options}</select></label>
  </div>`;
}

function deadlineText(deadline) {
  const date = new Date(deadline);
  const time = madridClock.format(date);
  if (madridDate.format(date) === todayIso()) return `las ${time}`;
  return `las ${time} del ${date.toLocaleDateString('es-ES', { ...prettyOptions, timeZone: TIMEZONE })}`;
}

function donePanel() {
  const { tables, date, time, people, deadline } = ui.done;
  return `<h2>Solicitud enviada</h2>
    <p class="small">Mesa ${esc(tables.join(' y '))}, ${esc(prettyDate(date))} a las ${esc(time)}, ${people} personas.</p>
    <p class="notice">Tu reserva no está completa hasta que el bar la confirme. Te avisaremos por WhatsApp. Si no sabes nada antes de ${esc(deadlineText(deadline))}, llama al ${PHONE}.</p>
    <button id="again" type="button">Hacer otra reserva</button>`;
}

function formPanel(data) {
  const times = data.slots;
  if (!times.includes(ui.time)) ui.time = times[0];
  const limits = peopleLimits();
  const showMenu = ui.turn === 'comida' && dayOf(ui.date) >= 1 && dayOf(ui.date) <= 5;
  const peopleOk = !limits || (ui.people >= limits.min && ui.people <= limits.max);
  const partner = ui.selected.length === 1 ? partnerOf(ui.selected[0]) : null;
  return `<div class="pair">
      <label class="field">Hora de llegada<select id="fTime">${times.map((t) => `<option ${t === ui.time ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="field">Personas<input id="fPeople" type="number" min="1" value="${ui.people}"></label>
    </div>
    <p class="chosen">${ui.selected.length ? `Mesa ${ui.selected.join(' y ')}` : fold.isOpen() ? 'Toca una mesa libre en el plano' : 'Abre el plano para elegir mesa'}</p>
    ${partner ? `<p class="small">Puedes juntarla con la ${partner}.</p>` : ''}
    ${ui.notice ? `<p class="notice" id="notice">${esc(ui.notice)}</p>` : ''}
    ${peopleOk ? '' : `<p class="notice">${ui.people > limits.max ? `Esta selección admite hasta ${limits.max} personas.` : 'Para dos mesas juntas, reserva para 5 personas o más.'} Para grupos mayores de 9, llama al ${PHONE}.</p>`}
    <label class="field">Nombre<input id="fName" autocomplete="name" maxlength="100" value="${esc(form.name)}"></label>
    <label class="field">Teléfono de contacto<input id="fPhone" type="tel" inputmode="numeric" pattern="[0-9]*" autocomplete="tel-national" value="${esc(form.phone)}"></label>
    ${showMenu ? `<label class="check"><input id="fMenu" type="checkbox" ${form.menu ? 'checked' : ''}><span>Queremos menú del día</span></label>` : ''}
    <label class="check"><input id="fAck" type="checkbox" ${form.ack ? 'checked' : ''}><span>Entiendo que mi reserva no está completa hasta que el bar la confirme.</span></label>
    <p class="small">Kafé usa tu nombre y teléfono solo para gestionar esta reserva. Puedes ejercer tus derechos escribiendo al bar. Más detalle en la <a href="/privacidad/">información de privacidad</a>.</p>
    <button id="send" class="primary" type="button" ${form.ack && !ui.sending ? '' : 'disabled'}>${ui.sending ? 'Enviando…' : 'Enviar solicitud de reserva'}</button>`;
}

function panelHtml() {
  if (ui.done) return donePanel();
  if (ui.loadError) {
    return `${dateTurnFields()}<p class="notice">No hemos podido cargar la disponibilidad. Inténtalo de nuevo o llama al ${PHONE}.</p>
      <button id="retry" type="button">Reintentar</button>`;
  }
  if (ui.loading || !ui.availability) return `${dateTurnFields()}<p class="small">Cargando disponibilidad…</p>`;
  const data = ui.availability;
  if (!data.turns.length) {
    const message = dayOf(ui.date) === 0 ? 'Los domingos no abrimos. Elige otro día.' : `Este día no admite reservas online. Elige otro o llama al ${PHONE}.`;
    return `${dateTurnFields()}<p class="notice">${message}</p>`;
  }
  if (data.closed) return `${dateTurnFields()}<p class="notice">Este turno no admite más reservas online. Elige otro o llama al ${PHONE}.</p>`;
  return dateTurnFields() + formPanel(data);
}

let plan;
let fold;

function render() {
  $('view').innerHTML = panelHtml();
  plan.paint(tableStates());
  // La carga intermedia ("Cargando") no tiene aviso: la petición espera al render que sí lo pinte.
  if (scrollToNotice && $('notice')) {
    $('notice').scrollIntoView({ block: 'center' });
    scrollToNotice = false;
  }
}

// ---------------------------------------------------------------------------
// Envío
// ---------------------------------------------------------------------------

function validationProblem() {
  const limits = peopleLimits();
  if (!limits) return 'Elige una mesa en el plano.';
  if (ui.people < limits.min || ui.people > limits.max) return 'Revisa el número de personas para esa mesa.';
  if (form.name.trim().length < 2) return 'Escribe tu nombre.';
  if (!/^\d{9}$/.test(form.phone)) return 'Escribe un teléfono de contacto válido, con 9 números.';
  if (!form.ack) return 'Marca que entiendes que el bar debe confirmar la reserva.';
  if (!turnstileToken) return `Estamos comprobando que no eres un robot. Espera un momento y vuelve a pulsar Enviar. Si no funciona, llama al ${PHONE}.`;
  return '';
}

const SEND_ERRORS = {
  0: `No hemos podido conectar con el servidor. Llámanos al ${PHONE} y reservamos por teléfono.`,
  403: `No se ha podido enviar la solicitud desde esta página. Llámanos al ${PHONE}.`,
  503: `Las reservas online no están disponibles ahora mismo. Llámanos al ${PHONE}.`,
};

async function submit() {
  const problem = validationProblem();
  if (problem) {
    ui.notice = problem;
    scrollToNotice = true;
    // Sin mesa no se puede avanzar: el plano se abre antes de centrar el aviso.
    if (!ui.selected.length) fold.setOpen(true);
    return render();
  }
  // Lo enviado se guarda antes del POST: la confirmación no puede describir lo que el usuario toque mientras tanto.
  const body = {
    date: ui.date,
    turn: ui.turn,
    time: ui.time,
    tables: [...ui.selected],
    people: ui.people,
    name: form.name.trim(),
    phone: form.phone,
    menu: form.menu,
    ack: form.ack,
    turnstileToken,
  };
  ui.sending = true;
  ui.notice = '';
  render();
  const { status, data } = await sendReservation(body);
  ui.sending = false;
  resetTurnstile();

  if (status === 201) {
    ui.done = { tables: body.tables, date: body.date, time: body.time, people: body.people, deadline: data.deadline };
    Object.assign(form, { name: '', phone: '', menu: false, ack: false });
    ui.selected = [];
    render();
    loadAvailability();
    return;
  }

  // Antes del aviso: si no, este repintado gastaría la petición de scroll y la carga movería la página.
  if (status === 409) fold.setOpen(true);
  scrollToNotice = true;
  if (status === 409) {
    ui.notice = 'Esa mesa acaba de reservarse. Elige otra.';
    return loadAvailability();
  }
  ui.notice = SEND_ERRORS[status] ?? data.error ?? `No se ha podido enviar la solicitud. Llámanos al ${PHONE}.`;
  render();
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

function changeDayOrTurn() {
  ui.selected = [];
  ui.notice = '';
  loadAvailability();
}

$('view').addEventListener('input', (event) => {
  const { id } = event.target;
  if (id === 'fName') form.name = event.target.value;
  if (id === 'fPhone') form.phone = event.target.value = cleanPhone(event.target.value);
});

$('view').addEventListener('change', (event) => {
  const { id, value, checked } = event.target;
  if (id === 'fDate' && value) {
    // iOS Safari puede ignorar el atributo min del input: aquí se impide elegir una fecha pasada.
    ui.date = value < todayIso() ? todayIso() : value;
    changeDayOrTurn();
  }
  if (id === 'fTurn') {
    ui.turn = value;
    changeDayOrTurn();
  }
  if (id === 'fTime') ui.time = value;
  if (id === 'fPeople') {
    ui.people = Number(value) || 1;
    ui.notice = ui.people > RULES.pairRange.max ? `Para grupos grandes, llama al ${PHONE} y te confirmamos nosotros.` : '';
    render();
  }
  if (id === 'fMenu') form.menu = checked;
  if (id === 'fAck') {
    form.ack = checked;
    $('send').disabled = !checked || ui.sending;
  }
});

$('view').addEventListener('click', (event) => {
  const { id } = event.target;
  if (id === 'send') submit();
  if (id === 'again') {
    ui.done = null;
    render();
  }
  if (id === 'retry') loadAvailability();
});

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

async function start() {
  plan = renderPlan($('plan'), { onTable });
  // Abierto de inicio: el cliente lo necesita para elegir mesa.
  fold = planFolder(document.querySelector('.wrap'), { open: true, onChange: render });
  mountTurnstile();
  render();
  // Si el usuario cambia día o turno mientras se busca, esa carga manda y esta se descarta.
  const seq = ++loadSeq;
  try {
    const first = await findFirstOpenTurn();
    if (seq !== loadSeq) return;
    Object.assign(ui, { date: first.date, turn: first.turn, availability: first.data });
    ui.loading = false;
  } catch {
    if (seq !== loadSeq) return;
    ui.loading = false;
    ui.loadError = true;
  }
  render();
}

start();

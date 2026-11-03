// Panel del bar: reservas del día sobre el plano, confirmación y avisos por WhatsApp.
// Manda el Worker: aquí solo se pinta lo que devuelve /api/admin/* y se envían las acciones.
// Nombres y teléfonos llegan de clientes: siempre pasan por esc() antes de entrar en innerHTML.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.3.1/firebase-app.js';
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from 'https://www.gstatic.com/firebasejs/11.3.1/firebase-auth.js';
import { FIREBASE_CONFIG } from '../firebase-config.js';
import { renderPlan, planFolder } from '../../js/plano.js';
import { apiBase } from '../../js/api-config.js';

const API_BASE = apiBase(location.hostname);

const PHONE = '981 31 82 60';
const TIMEZONE = 'Europe/Madrid';
const MAX_DAYS_AHEAD = 30;
const MAX_PEOPLE = 60;
const REQUEST_TIMEOUT_MS = 15000;
const TURNS = ['comida', 'cena'];
const TURN_NAMES = { comida: 'Comida', cena: 'Cena' };
const TABLE_LABELS = Array.from({ length: 15 }, (_, i) => String(i + 1));

const auth = getAuth(initializeApp(FIREBASE_CONFIG));

const $ = (id) => document.getElementById(id);
const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const madridDate = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE });
const madridClock = new Intl.DateTimeFormat('es-ES', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const prettyOptions = { weekday: 'long', day: 'numeric', month: 'long' };

const todayIso = () => madridDate.format(new Date());

// Última hora de cada turno. Igual que turnIsOver del Worker, que es quien manda.
const TURN_LAST_TIME = { comida: '15:30', cena: '21:30' };
function turnIsOver(date, turn) {
  const today = todayIso();
  if (date !== today) return date < today;
  return madridClock.format(new Date()) > TURN_LAST_TIME[turn];
}
function addDays(iso, days) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
const dayOf = (date) => new Date(`${date}T12:00`).getDay();
const prettyDate = (date) => new Date(`${date}T12:00`).toLocaleDateString('es-ES', prettyOptions);
const peopleText = (count) => `${count} ${count === 1 ? 'persona' : 'personas'}`;
// '3', '1 y 2', '1, 2 y 3'
const tablesText = (labels) => (labels.length < 2 ? labels.join('') : `${labels.slice(0, -1).join(', ')} y ${labels.at(-1)}`);

// Deja solo dígitos. Un prefijo 34 (o +34) se quita únicamente si deja exactamente 9 dígitos.
function cleanPhone(raw) {
  const digits = raw.replace(/\D/g, '');
  return (digits.length === 11 && digits.startsWith('34') ? digits.slice(2) : digits).slice(0, 11);
}

// day: lo último que devolvió /api/admin/dia para ui.date; null mientras carga o si falló.
const ui = {
  date: todayIso(),
  turn: 'comida',
  adminTables: [],
  closing: null,
  notice: '',
  followUps: [],
  day: null,
  pendingCount: 0,
  loading: true,
  loadError: false,
  busy: false,
};
const form = { name: '', people: 4, phone: '' };
let loadSeq = 0;
let followUpSeq = 0;
let scrollListToTop = false;
let expiring = false;
let plan = renderPlan($('plan'), { onTable });
const fold = planFolder($('app'), { open: true });

// ---------------------------------------------------------------------------
// Datos del día
// ---------------------------------------------------------------------------

const turnKey = (turn) => `${ui.date}|${turn}`;

function openTurns() {
  const weekday = dayOf(ui.date);
  if (weekday === 0) return TURNS.filter((turn) => ui.day?.openSunday.has(turnKey(turn)));
  return weekday === 5 || weekday === 6 ? [...TURNS] : ['comida'];
}

const noOpening = () => !openTurns().length;
const here = () => (ui.day?.reservations ?? []).filter((r) => r.turn === ui.turn);
const isClosed = () => ui.day.closed.has(ui.date) || ui.day.closed.has(turnKey(ui.turn));
/** Día cerrado de una vez o con todos sus turnos cerrados uno a uno: para el bar es lo mismo. */
const dayClosed = () => ui.day.closed.has(ui.date) || openTurns().every((turn) => ui.day.closed.has(turnKey(turn)));
const statusOf = (label) => here().find((r) => r.tables.includes(label))?.status ?? null;

/** Reservas de turnos que ya no se abren (por ejemplo, un domingo que se vuelve a cerrar). */
const orphanReservations = () => (ui.day?.reservations ?? []).filter((r) => !openTurns().includes(r.turn));

function affectedBy(key) {
  const turn = key.split('|')[1];
  return ui.day.reservations.filter((r) => !turn || r.turn === turn);
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Llama a /api/admin/*. 401 devuelve al login y 403 a la pantalla de sin permiso.
 * status 0 es fallo de red o timeout; sent dice si la petición llegó a salir (entonces el servidor
 * pudo guardarla aunque no tengamos respuesta).
 */
async function api(method, path, body) {
  let token;
  try {
    token = await auth.currentUser.getIdToken();
  } catch (err) {
    if (err?.code === 'auth/network-request-failed') return { status: 0, sent: false, data: {} };
    expireSession();
    return { status: 401, data: {} };
  }
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 401) expireSession();
    if (res.status === 403) showView('denied');
    return { status: res.status, data: await res.json().catch(() => ({})) };
  } catch {
    return { status: 0, sent: true, data: {} };
  }
}

/** Recarga ui.date. Con quiet no vacía el panel: se usa tras una acción. Devuelve si salió bien. */
async function loadDay({ quiet = false } = {}) {
  const seq = ++loadSeq;
  if (!quiet) {
    ui.loading = true;
    ui.loadError = false;
    render();
  }
  const { status, data } = await api('GET', `/api/admin/dia?date=${ui.date}`);
  if (seq !== loadSeq) return false;
  ui.loading = false;
  const ok = status === 200;
  if (ok) {
    ui.day = { reservations: data.reservations, closed: new Set(data.overrides.closed), openSunday: new Set(data.overrides.openSunday) };
    ui.pendingCount = data.pendingCount;
    // Tras un 409 o una recarga puede quedar seleccionada una mesa que ya se ha tomado.
    ui.adminTables = ui.adminTables.filter((label) => !statusOf(label));
  } else if (ui.day) {
    showNotice('No se ha podido actualizar la lista. Los datos pueden estar desfasados.');
  } else {
    ui.loadError = true;
  }
  render();
  return ok;
}

/**
 * Guarda los cambios en orden y para en el primer fallo. Cada PUT es independiente: quien llama
 * deja para el final el que abre, para que un fallo a medias deje el turno cerrado, nunca abierto.
 */
async function saveOverrides(changes) {
  ui.busy = true;
  for (const change of changes) {
    const { status } = await api('PUT', '/api/admin/cierres', change);
    if (status !== 200) {
      ui.busy = false;
      showNotice('No se ha guardado el cambio. Inténtalo de nuevo.');
      await loadDay({ quiet: true });
      return false;
    }
  }
  ui.busy = false;
  ui.closing = null;
  ui.adminTables = [];
  return loadDay({ quiet: true });
}

const setOverride = (key, kind, enabled) => saveOverrides([{ key, kind, enabled }]);

// ---------------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------------

const hasWhatsapp = (r) => /^\d{9}$/.test(r.phone);

const WHATSAPP_TEXTS = {
  info: (who, when) => `${who}, hemos recibido tu solicitud de reserva en Kafé ${when}.`,
  confirm: (who, when) => `${who}, tu reserva en Kafé ${when} está confirmada.`,
  reject: (who, when) => `${who}, sentimos no poder aceptar tu reserva en Kafé ${when}. Para cualquier duda, llámanos al ${PHONE}.`,
  cancel: (who, when) => `${who}, sentimos avisarte de que tenemos que cancelar tu reserva en Kafé ${when}. Para cualquier duda, llámanos al ${PHONE}.`,
};

/** Enlace wa.me con el texto de esa acción, o null si la acción no avisa o la reserva no tiene teléfono. */
function whatsappUrl(kind, r) {
  const text = WHATSAPP_TEXTS[kind];
  if (!text || !hasWhatsapp(r)) return null;
  const who = r.name ? `Hola ${r.name}` : 'Hola';
  const when = `del ${prettyDate(r.date)} a las ${r.time} para ${peopleText(r.people)}`;
  return `https://wa.me/34${r.phone}?text=${encodeURIComponent(text(who, when))}`;
}

// ---------------------------------------------------------------------------
// Pantallas y sesión
// ---------------------------------------------------------------------------

function showView(name) {
  for (const id of ['login', 'denied', 'app']) $(id).hidden = id !== name;
}

function showNotice(text) {
  ui.notice = text;
  scrollListToTop = true;
}

function loginMessage(err) {
  switch (err?.code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      return 'Correo o contraseña incorrectos.';
    case 'auth/too-many-requests':
      return 'Demasiados intentos fallidos. Espera un momento e inténtalo de nuevo.';
    case 'auth/network-request-failed':
      return 'Error de red. Comprueba tu conexión.';
    default:
      return 'No se ha podido iniciar sesión.';
  }
}

function showLoginError(text) {
  $('loginError').textContent = text;
  $('loginError').hidden = false;
}

async function expireSession() {
  if (expiring) return;
  expiring = true;
  await signOut(auth);
  showLoginError('La sesión ha caducado. Entra de nuevo.');
  expiring = false;
}

$('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('loginError').hidden = true;
  $('loginSubmit').disabled = true;
  $('loginSubmit').textContent = 'Entrando…';
  try {
    await signInWithEmailAndPassword(auth, $('loginEmail').value.trim(), $('loginPassword').value);
  } catch (err) {
    showLoginError(loginMessage(err));
  } finally {
    $('loginSubmit').disabled = false;
    $('loginSubmit').textContent = 'Entrar';
  }
});

for (const id of ['logout', 'deniedLogout']) $(id).addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  if (user) {
    $('loginError').hidden = true;
    $('loginForm').reset();
    showView('app');
    loadDay();
    return;
  }
  // Al salir no queda ningún dato personal en memoria ni en pantalla.
  loadSeq++;
  Object.assign(ui, { adminTables: [], closing: null, notice: '', followUps: [], day: null, pendingCount: 0, loading: true, loadError: false, busy: false });
  fold.setOpen(true);
  Object.assign(form, { name: '', people: 4, phone: '' });
  $('panel').innerHTML = '';
  showView('login');
});

// ---------------------------------------------------------------------------
// Plano
// ---------------------------------------------------------------------------

function tableStates() {
  const unreliable = ui.loading || ui.loadError || !ui.day;
  // Sin datos fiables la sala se ve gris; sin apertura o con el día o turno cerrado, toda en rojo.
  const fill = unreliable ? 'blocked' : noOpening() || isClosed() ? 'confirmed' : null;
  const states = {};
  for (const label of TABLE_LABELS) {
    if (fill) states[label] = fill;
    else if (ui.adminTables.includes(label)) states[label] = 'selected';
    else states[label] = statusOf(label) ?? 'free';
  }
  return states;
}

function onTable(label) {
  if (ui.loading || ui.loadError || !ui.day || ui.closing || ui.busy || noOpening() || isClosed()) return;
  ui.notice = '';
  if (statusOf(label)) {
    showNotice(`La mesa ${label} ya tiene reserva. Gestiónala en la lista.`);
    return render();
  }
  if (ui.adminTables.includes(label)) {
    ui.adminTables = ui.adminTables.filter((selected) => selected !== label);
  } else {
    ui.adminTables = [...ui.adminTables, label];
    // El formulario sale arriba de la lista: con el plano abierto queda poca altura para buscarlo.
    if (fold.isOpen()) scrollListToTop = true;
  }
  render();
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

function dateTurnFields() {
  const turns = openTurns();
  const options = turns.length
    ? turns.map((t) => `<option value="${t}" ${t === ui.turn ? 'selected' : ''}>${TURN_NAMES[t]}</option>`).join('')
    : `<option>${ui.day ? 'Cerrado' : TURN_NAMES[ui.turn]}</option>`;
  return `<div class="pair">
    <label class="field">Día<input id="fDate" type="date" max="${addDays(todayIso(), MAX_DAYS_AHEAD)}" value="${ui.date}" ${ui.busy ? 'disabled' : ''}></label>
    <label class="field">Turno<select id="fTurn" ${turns.length && !ui.busy ? '' : 'disabled'}>${options}</select></label>
  </div>`;
}

/** Día, turno, cierres y botón del plano. En móvil son la barra fija o van al hueco de la L. */
function controlsHtml(toggles) {
  return `<div class="controls">${dateTurnFields()}${toggles ? `<div class="closures">${toggles}</div>` : ''}${fold.buttonHtml()}</div>`;
}

function deadlineText(deadline) {
  const date = new Date(deadline);
  return `${date.toLocaleDateString('es-ES', { timeZone: TIMEZONE })} a las ${madridClock.format(date)}`;
}

function reservationCard(r) {
  const busy = ui.busy ? 'disabled' : '';
  const button = (kind, label, primary) => `<button ${primary ? 'class="primary"' : ''} data-act="${kind}" data-id="${esc(r.id)}" ${busy} type="button">${label}</button>`;
  const infoUrl = whatsappUrl('info', r);
  const buttons = r.status === 'pending'
    ? `${button('confirm', 'Confirmar', true)}${button('reject', 'Rechazar')}${infoUrl ? `<a class="action" href="${esc(infoUrl)}" target="_blank" rel="noopener">Avisar por WhatsApp</a>` : ''}`
    : `${hasWhatsapp(r) ? button('cancel', 'Cancelar y avisar') : ''}${button('release', r.tables.length === 1 ? 'Liberar mesa' : 'Liberar mesas')}`;
  return `<div class="res">
    <div class="row"><strong>${esc(r.time)} · ${r.tables.length === 1 ? 'Mesa' : 'Mesas'} ${esc(tablesText(r.tables))}</strong><span class="pill ${r.status}">${r.status === 'confirmed' ? 'Confirmada' : 'Pendiente'}</span></div>
    <div>${esc(r.name || 'Reserva del bar')}, ${peopleText(r.people)}${r.menu ? ', menú del día' : ''}${r.phone ? ` · ${esc(r.phone)}` : ''}</div>
    ${r.deadline && r.status === 'pending' ? `<div class="small">Se libera sola el ${esc(deadlineText(r.deadline))}</div>` : ''}
    <div class="row">${buttons}</div>
  </div>`;
}

/** Último error de una acción. Va arriba de la lista, que se desplaza a su inicio al mostrarlo. */
function messagesHtml() {
  return ui.notice ? `<p class="notice" role="alert">${esc(ui.notice)}</p>` : '';
}

/**
 * Avisos que el bar aún tiene que enviar a mano (pestaña bloqueada o respuesta perdida). Van en la
 * parte fija, siempre a la vista, y solo se quitan al pulsar el enlace o Cerrar.
 */
function followUpsHtml() {
  return ui.followUps.map((f) => `<div class="res followup">
      <p class="small">${esc(f.reason)}</p>
      <div class="row">
        <a class="action primary" data-followup="${esc(f.id)}" href="${esc(f.url)}" target="_blank" rel="noopener">Avisar${f.name ? ` a ${esc(f.name)}` : ''} por WhatsApp</a>
        <button data-close-followup="${esc(f.id)}" type="button">Cerrar</button>
      </div></div>`).join('');
}

function closureButton(id, closed, what) {
  return `<button id="${id}" class="${closed ? 'btn-open' : 'btn-close'}" type="button">${closed ? 'Abrir' : 'Cerrar'} ${what}</button>`;
}

function sundayButtons() {
  const button = (turn) => {
    const open = ui.day.openSunday.has(turnKey(turn));
    return `<button data-sunday="${turn}" class="${open ? 'btn-close' : 'btn-open'}" type="button">${open ? 'Cerrar' : 'Abrir'} ${TURN_NAMES[turn].toLowerCase()}</button>`;
  };
  return `<div class="row">${TURNS.map(button).join('')}</div>`;
}

function closingPanel() {
  const list = affectedBy(ui.closing.key);
  return `<div class="fixed-part">${followUpsHtml()}<div class="controls">${fold.buttonHtml()}</div><h2>${list.length ? `Hay ${list.length} ${list.length === 1 ? 'reserva' : 'reservas'}` : 'Sin reservas'}</h2>
    ${list.length ? '<p class="notice">Al cerrar, estas reservas no se cancelan solas. Avisa a cada cliente y libera su mesa.</p>' : ''}
    <div class="row">
      <button id="confirmClose" class="btn-close" ${ui.busy ? 'disabled' : ''} type="button">Sí, cerrar</button>
      <button id="cancelClose" type="button">Volver</button>
    </div></div>
    <div class="scroll-part">${messagesHtml()}${list.map(reservationCard).join('')}</div>`;
}

function orphanHtml() {
  const list = orphanReservations();
  return list.length
    ? `<p class="notice">Turno cerrado con ${list.length} ${list.length === 1 ? 'reserva activa' : 'reservas activas'}. Avisa al cliente y libera la mesa.</p>${list.map(reservationCard).join('')}`
    : '';
}

function phoneBookingForm() {
  if (turnIsOver(ui.date, ui.turn)) return '<p class="small">Este turno ya ha pasado.</p>';
  if (isClosed()) return '<p class="small">Cerrado. Ábrelo para marcar mesas como reservadas.</p>';
  const labels = ui.adminTables;
  if (!labels.length) return '<p class="small"><span class="hint-open">Toca una mesa del plano para marcarla como reservada.</span><span class="hint-closed">Abre el plano para marcar una mesa como reservada.</span></p>';
  return `<div class="res"><strong>${labels.length === 1 ? 'Mesa' : 'Mesas'} ${esc(tablesText(labels))}: reserva telefónica</strong>
    <div class="pair">
      <label class="field">Nombre (opcional)<input id="aName" maxlength="100" value="${esc(form.name)}"></label>
      <label class="field">Personas<input id="aPeople" type="number" min="1" max="${MAX_PEOPLE}" value="${esc(form.people)}"></label>
    </div>
    <label class="field">Teléfono (opcional, para poder avisar)<input id="aPhone" type="tel" inputmode="numeric" pattern="[0-9]*" value="${esc(form.phone)}"></label>
    <button id="aMark" class="primary" ${ui.busy ? 'disabled' : ''} type="button">${labels.length === 1 ? 'Marcar reservada' : 'Marcar reservadas'}</button></div>`;
}

function adminPanel() {
  if (ui.loadError) {
    return `<div class="fixed-part">${followUpsHtml()}${controlsHtml()}<p class="notice">No se ha podido cargar el día.</p>
      <button id="retry" type="button">Reintentar</button></div>`;
  }
  if (ui.loading || !ui.day) return `<div class="fixed-part">${followUpsHtml()}${controlsHtml()}<p class="small">Cargando reservas…</p></div>`;
  if (ui.closing) return closingPanel();
  if (noOpening()) {
    return `<div class="fixed-part">${followUpsHtml()}<h2>Domingo cerrado</h2>${controlsHtml(sundayButtons())}
      <p class="small">Los domingos están cerrados por defecto. Abre la comida, la cena o las dos solo para este domingo.</p></div>
      <div class="scroll-part">${messagesHtml()}${orphanHtml()}</div>`;
  }
  const list = here();
  const closed = isClosed();
  const toggles = dayOf(ui.date) === 0
    ? sundayButtons()
    : `<div class="row">
        ${closureButton('closeTurn', isClosed(), 'este turno')}
        ${closureButton('closeDay', dayClosed(), 'el día')}
      </div>`;
  return `<div class="fixed-part">${followUpsHtml()}<div class="row pending-count"><h2>${ui.pendingCount} por confirmar</h2><span class="small">en total, todos los días y turnos</span></div>
    ${controlsHtml(toggles)}</div>
    <div class="scroll-part">${messagesHtml()}${phoneBookingForm()}
    ${closed && list.length ? `<p class="notice">Cerrado con ${list.length} ${list.length === 1 ? 'reserva activa' : 'reservas activas'}. Avisa a cada cliente y libera su mesa.</p>` : ''}
    ${list.map(reservationCard).join('') || '<p class="small">Sin reservas en este turno.</p>'}
    ${orphanHtml()}</div>`;
}

function render() {
  const turns = openTurns();
  if (ui.day && turns.length && !turns.includes(ui.turn)) ui.turn = turns[0];
  const panel = $('panel');
  const listTop = scrollListToTop ? 0 : panel.querySelector('.scroll-part')?.scrollTop ?? 0;
  scrollListToTop = false;
  panel.innerHTML = adminPanel();
  const list = panel.querySelector('.scroll-part');
  if (list) list.scrollTop = listTop;
  plan.paint(tableStates());
}

// ---------------------------------------------------------------------------
// Acciones sobre una reserva
// ---------------------------------------------------------------------------

const ACTIONS = {
  confirm: { method: 'POST', path: (id) => `/api/admin/reservas/${id}/confirmar` },
  reject: { method: 'DELETE', path: (id) => `/api/admin/reservas/${id}` },
  cancel: { method: 'DELETE', path: (id) => `/api/admin/reservas/${id}` },
  release: { method: 'DELETE', path: (id) => `/api/admin/reservas/${id}` },
};

function addFollowUp(url, name, reason) {
  ui.followUps.push({ id: String(++followUpSeq), url, name, reason });
  // Con el plano abierto apenas queda altura: el enlace tiene que verse.
  fold.setOpen(false);
}

/** ¿La lista de su día ya refleja la acción? Confirmar la deja confirmada; las demás quitan la reserva. */
function wasApplied(kind, id, reservations) {
  const found = reservations.find((r) => r.id === id);
  return kind === 'confirm' ? found?.status === 'confirmed' : !found;
}

function failureText(kind, status) {
  const doNotSend = kind === 'release' ? '' : ' No envíes ningún mensaje.';
  if (status === 409) return `La reserva ha caducado y ya no se puede confirmar. Se ha actualizado la lista.${doNotSend}`;
  if (status === 404) return `Esa reserva ya no existe. Se ha actualizado la lista.${doNotSend}`;
  return `No se ha guardado.${doNotSend}`;
}

/**
 * Cambia la reserva y, solo si la API responde bien, abre WhatsApp. La pestaña se abre en el
 * propio clic para que el navegador no la bloquee; la URL se le asigna tras el OK, y si la API
 * falla se cierra sin haber cargado nada.
 */
async function runAction(kind, r) {
  const url = whatsappUrl(kind, r);
  const tab = url ? window.open('about:blank', '_blank') : null;
  if (tab) tab.opener = null;
  ui.notice = '';
  ui.busy = true;
  render();

  const { method, path } = ACTIONS[kind];
  const { status, sent } = await api(method, path(r.id));
  ui.busy = false;

  if (status === 200) {
    if (tab && !tab.closed) tab.location.href = url;
    else if (url) addFollowUp(url, r.name, 'Guardado. El navegador ha bloqueado WhatsApp.');
    await loadDay({ quiet: true });
    return;
  }
  if (status === 0 && sent) return resolveLostResponse(kind, r, url, tab);
  tab?.close();
  showNotice(failureText(kind, status));
  if (status === 409 || status === 404) await loadDay({ quiet: true });
  else render();
}

/**
 * Sin respuesta (red caída o timeout) el Worker pudo haber guardado. Se consulta el día de la propia
 * reserva (no el que haya en pantalla) y, si ya tiene el estado esperado, se ofrece el aviso como
 * enlace; si no se puede saber, se dice.
 */
async function resolveLostResponse(kind, r, url, tab) {
  tab?.close();
  const { status, data } = await api('GET', `/api/admin/dia?date=${r.date}`);
  const known = status === 200;
  const applied = known && wasApplied(kind, r.id, data.reservations);
  await loadDay({ quiet: true });
  if (!known) {
    showNotice(kind === 'release' ? 'No sabemos si se ha guardado. Revisa la lista.' : 'No sabemos si se ha guardado. Revisa la lista antes de enviar ningún mensaje.');
  } else if (!applied) {
    showNotice(failureText(kind, 0));
  } else if (url) {
    addFollowUp(url, r.name, 'Guardado, aunque la respuesta se perdió. Envía el aviso desde aquí.');
  } else {
    showNotice('Guardado, aunque la respuesta se perdió.');
  }
  render();
}

async function markReserved() {
  const people = Number(form.people);
  const problem = !Number.isInteger(people) || people < 1 || people > MAX_PEOPLE ? `Personas: entre 1 y ${MAX_PEOPLE}.`
    : form.phone && !/^\d{9}$/.test(form.phone) ? 'El teléfono debe tener 9 números, o déjalo vacío.'
    : '';
  if (problem) {
    showNotice(problem);
    return render();
  }
  ui.notice = '';
  ui.busy = true;
  render();
  const { status, sent, data } = await api('POST', '/api/admin/reservas', {
    date: ui.date,
    turn: ui.turn,
    tables: ui.adminTables,
    people,
    name: form.name.trim(),
    phone: form.phone,
  });
  ui.busy = false;
  if (status === 0 && sent) {
    await loadDay({ quiet: true });
    showNotice('No sabemos si se ha guardado. Revisa la lista antes de repetirlo.');
    return render();
  }
  if (status === 201) {
    Object.assign(form, { name: '', people: 4, phone: '' });
    ui.adminTables = [];
    return loadDay({ quiet: true });
  }
  showNotice(status === 409 ? 'Alguna mesa acaba de reservarse. Se ha actualizado la lista.' : data.error ?? 'No se ha guardado la reserva.');
  if (status === 409) return loadDay({ quiet: true });
  render();
}

// ---------------------------------------------------------------------------
// Cierres
// ---------------------------------------------------------------------------

/** Si el cierre afecta a reservas, pide confirmación con su lista; si no, lo aplica. */
async function requestClose(key, kind, enabled) {
  if (!(await loadDay({ quiet: true }))) return;
  if (affectedBy(key).length) {
    ui.closing = { key, kind, enabled };
    ui.adminTables = [];
    render();
  } else {
    await setOverride(key, kind, enabled);
  }
}

async function toggleSunday(turn) {
  const key = turnKey(turn);
  if (ui.day.openSunday.has(key)) return requestClose(key, 'open_sunday', false);
  ui.turn = turn;
  return setOverride(key, 'open_sunday', true);
}

const closedChange = (key, enabled) => ({ key, kind: 'closed', enabled });

/** Con el día cerrado, abrir un turno pasa el cierre a los demás turnos y quita el del día. */
async function openTurn(turn) {
  const key = turnKey(turn);
  if (!ui.day.closed.has(ui.date)) return setOverride(key, 'closed', false);
  const others = openTurns().filter((t) => t !== turn).map((t) => closedChange(turnKey(t), true));
  return saveOverrides([...others, closedChange(key, false), closedChange(ui.date, false)]);
}

/** Quita todos los cierres del día, el del día completo el último. */
async function openDay() {
  const turnKeys = [...ui.day.closed].filter((key) => key !== ui.date);
  return saveOverrides([...turnKeys, ...(ui.day.closed.has(ui.date) ? [ui.date] : [])].map((key) => closedChange(key, false)));
}

async function toggleTurn() {
  return isClosed() ? openTurn(ui.turn) : requestClose(turnKey(ui.turn), 'closed', true);
}

async function toggleDay() {
  return dayClosed() ? openDay() : requestClose(ui.date, 'closed', true);
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

$('panel').addEventListener('input', (event) => {
  const { id } = event.target;
  if (id === 'aName') form.name = event.target.value;
  if (id === 'aPeople') form.people = event.target.value;
  if (id === 'aPhone') form.phone = event.target.value = cleanPhone(event.target.value);
});

$('panel').addEventListener('change', (event) => {
  const { id, value } = event.target;
  // Con una acción en curso, fecha y turno no cambian; se repinta para que el control vuelva a su valor.
  if (ui.busy) return render();
  if (id === 'fDate' && value) {
    Object.assign(ui, { date: value, day: null, adminTables: [], closing: null, notice: '' });
    loadDay();
  }
  if (id === 'fTurn') {
    Object.assign(ui, { turn: value, adminTables: [], notice: '' });
    scrollListToTop = true;
    render();
  }
});

function dropFollowUp(id) {
  ui.followUps = ui.followUps.filter((f) => f.id !== id);
  render();
}

$('panel').addEventListener('click', (event) => {
  // El enlace abre WhatsApp por sí solo: se quita después, para no borrarlo antes de que navegue.
  const link = event.target.closest('a[data-followup]');
  if (link) return void setTimeout(() => dropFollowUp(link.dataset.followup));
  const el = event.target.closest('button');
  if (!el) return;
  if (el.dataset.closeFollowup) return dropFollowUp(el.dataset.closeFollowup);
  if (ui.busy) return;
  const { act, id: reservationId, sunday } = el.dataset;
  if (act) {
    const reservation = ui.day.reservations.find((r) => r.id === reservationId);
    if (reservation) runAction(act, reservation);
  }
  if (sunday) toggleSunday(sunday);
  if (el.id === 'closeTurn') toggleTurn();
  if (el.id === 'closeDay') toggleDay();
  if (el.id === 'confirmClose') setOverride(ui.closing.key, ui.closing.kind, ui.closing.enabled);
  if (el.id === 'cancelClose') {
    ui.closing = null;
    render();
  }
  if (el.id === 'aMark') markReserved();
  if (el.id === 'retry') loadDay();
});

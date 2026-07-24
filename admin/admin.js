// admin/admin.js
// Panel de administración de Kafe — edita content.json en el navegador.
// Fase 2: login + editor + descarga de content.json. NO publica (Fase 3).

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "kafe-143b5.firebaseapp.com",
  projectId: "kafe-143b5",
  storageBucket: "kafe-143b5.firebasestorage.app",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_FIREBASE_APP_ID",
  measurementId: "G-XXXXXXXXXX",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const PUBLISH_URL = "https://your-worker.your-account.workers.dev/publish";

// ---------------------------------------------------------------------------
// Referencias DOM
// ---------------------------------------------------------------------------

const loginScreen = document.getElementById("login-screen");
const loginForm = document.getElementById("login-form");
const loginEmail = document.getElementById("login-email");
const loginPassword = document.getElementById("login-password");
const loginSubmit = document.getElementById("login-submit");
const loginError = document.getElementById("login-error");

const editorScreen = document.getElementById("editor-screen");
const editorUser = document.getElementById("editor-user");
const logoutBtn = document.getElementById("logout-btn");
const downloadJsonBtn = document.getElementById("download-json-btn");
const publishBtn = document.getElementById("publish-btn");
const saveStatus = document.getElementById("save-status");
const loadError = document.getElementById("load-error");
const loadingMsg = document.getElementById("loading-msg");
const sectionsContainer = document.getElementById("sections-container");

// ---------------------------------------------------------------------------
// Estado en memoria
// ---------------------------------------------------------------------------

let originalContent = null; // tal cual vino de content.json, nunca se muta
let workingContent = null; // copia que se va editando en vivo
let contentLoaded = false;

// Referencia al <div class="kf-section-body"> de la sección "carta", para
// poder re-renderizarla sola cuando se añaden/quitan filas o secciones
// (evita reconstruir todo el editor y perder el estado de otras secciones).
let cartaBodyEl = null;

// Referencia al <div class="kf-section-body"> de la sección "horario", para
// poder re-renderizarla sola cuando se añaden/quitan filas (mismo patrón
// que cartaBodyEl / rerenderCarta).
let horarioBodyEl = null;

// path (string) -> { blob, filename, originalValue }
const imageEdits = new Map();

// ---------------------------------------------------------------------------
// Autenticación
// ---------------------------------------------------------------------------

loginForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  hideError(loginError);
  loginSubmit.disabled = true;
  loginSubmit.textContent = "Entrando…";
  try {
    await signInWithEmailAndPassword(auth, loginEmail.value.trim(), loginPassword.value);
    // onAuthStateChanged se encarga de mostrar el editor.
  } catch (err) {
    showError(loginError, mapAuthError(err));
  } finally {
    loginSubmit.disabled = false;
    loginSubmit.textContent = "Entrar";
  }
});

logoutBtn.addEventListener("click", async () => {
  await signOut(auth);
});

onAuthStateChanged(auth, (user) => {
  if (user) {
    loginScreen.hidden = true;
    editorScreen.hidden = false;
    editorUser.textContent = user.email ?? "";
    loginForm.reset();
    if (!contentLoaded) {
      loadContent();
    }
  } else {
    editorScreen.hidden = true;
    loginScreen.hidden = false;
    contentLoaded = false;
    originalContent = null;
    workingContent = null;
    imageEdits.clear();
    sectionsContainer.innerHTML = "";
  }
});

function mapAuthError(err) {
  const code = err && err.code ? err.code : "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Correo o contraseña incorrectos.";
    case "auth/invalid-email":
      return "El correo introducido no es válido.";
    case "auth/too-many-requests":
      return "Demasiados intentos fallidos. Espera un momento e inténtalo de nuevo.";
    case "auth/user-disabled":
      return "Esta cuenta está deshabilitada.";
    case "auth/network-request-failed":
      return "Error de red. Comprueba tu conexión.";
    default:
      return `No se pudo iniciar sesión (${code || "error desconocido"}).`;
  }
}

function showError(el, msg) {
  el.textContent = msg;
  el.hidden = false;
}

function hideError(el) {
  el.hidden = true;
  el.textContent = "";
}

// ---------------------------------------------------------------------------
// Carga de content.json
// ---------------------------------------------------------------------------

async function loadContent() {
  hideError(loadError);
  loadingMsg.hidden = false;
  sectionsContainer.innerHTML = "";
  try {
    const res = await fetch("../content.json", { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const json = await res.json();
    originalContent = json;
    workingContent = JSON.parse(JSON.stringify(json));
    contentLoaded = true;
    renderAllSections();
  } catch (err) {
    showError(loadError, `No se pudo cargar content.json: ${err.message}`);
  } finally {
    loadingMsg.hidden = true;
  }
}

// ---------------------------------------------------------------------------
// Utilidades de rutas (paths tipo ["carta", "categorias", 0, "items", 2, "precio"])
// ---------------------------------------------------------------------------

function getAtPath(obj, path) {
  return path.reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

function setAtPath(obj, path, value) {
  let node = obj;
  for (let i = 0; i < path.length - 1; i++) {
    node = node[path[i]];
  }
  node[path[path.length - 1]] = value;
}

function pathToLabel(path) {
  return path.join(" › ");
}

// Los pathKey del Map imageEdits se generan con path.join("."), aquí se
// deshace esa unión reconstruyendo el array de path (índices numéricos
// de array vueltos a Number para que setAtPath/getAtPath funcionen igual).
function pathKeyToPath(pathKey) {
  return pathKey.split(".").map((segment) => {
    return /^\d+$/.test(segment) ? Number(segment) : segment;
  });
}

// ---------------------------------------------------------------------------
// Nombres legibles para las secciones de primer nivel
// ---------------------------------------------------------------------------

const SECTION_TITLES = {
  nav: "Navegación",
  hero: "Portada (Hero)",
  desayunos: "Desayunos (bloque SEO)",
  nosotros: "Nosotros",
  carta: "Karta",
  menu: "Menú destacado",
  info: "Información / Kontacto",
  footer: "Pie de página",
  reserva: "Formulario de reserva",
  resenas: "Reseñas",
  site: "Sitio (SEO / metadatos)",
  images: "Imágenes",
  horario: "Horario",
  alerta: "Alerta / Aviso (barra superior)",
};

// Orden en que se muestran las secciones en el editor, siguiendo el orden de
// lectura real de los bloques en la web: nav → hero → desayunos (bloque SEO) →
// karta → info/kontacto → nosotros → pie. "horario" alimenta la tarjeta de
// info y el footer, se coloca junto a info por cercanía visual. "images"
// (agrupador de fotos) va al final. Las claves no listadas se añaden al final
// como cola de seguridad para que nada desaparezca si se añade una sección
// nueva al JSON.
const SECTION_ORDER = ["nav", "hero", "desayunos", "carta", "info", "horario", "nosotros", "footer", "images", "alerta"];

// Claves puramente estructurales que nunca se muestran como campo editable,
// pero que se conservan intactas en workingContent (no se tocan, así que
// sobreviven al export tal cual estaban en el original).
const SKIP_KEYS = new Set(["id", "labelKey", "titleKey"]);

// Secciones de primer nivel que NO se renderizan en el editor, pero que se
// conservan intactas en workingContent/originalContent (se actualizan por
// otra vía, no desde este panel).
// Secciones que NO se editan desde el panel:
// - resenas: se actualiza por script, no a mano.
// - reserva: la UI de reservas está oculta en la web (editarla no se refleja).
// - site: metadatos técnicos SEO/schema (dominio, geo, descripción) que no debe tocar el cliente.
const HIDDEN_SECTIONS = new Set(["resenas", "reserva", "site"]);

// Etiquetas legibles para claves frecuentes dentro de "carta" (mejora la
// lectura de los formularios generados genéricamente por renderNode).
const CARTA_FIELD_LABELS = {
  tag: "Etiqueta superior",
  title: "Título",
  desc: "Descripción",
  more: "Botón 'Ver más'",
  footer: "Texto de pie de carta",
  cat1: "Tarjeta 1",
  cat2: "Tarjeta 2",
  cat3: "Tarjeta 3",
  label: "Nombre de la tarjeta",
  categorias: "Categorías destacadas (tarjetas de la home)",
  menuCompleto: "Carta completa (imprimible)",
  columna1: "Columna 1",
  columna2: "Columna 2",
  seccion: "Nombre de la sección",
  items: "Platos",
  subcategorias: "Subcategorías",
  nombre: "Nombre",
  precio: "Precio",
};

// Claves de carta que son la cabecera (etiqueta + título) de una tarjeta
// destacada de la home. Se enlazan por posición con categorias[] (cat1 ↔
// categorias[0], cat2 ↔ [1], cat3 ↔ [2]) y es lo que la web traduce vía
// data-i18n. NO se muestran en el bloque de "textos" de carta: van dentro de
// su propia tarjeta agrupada (ver renderHomeCardBlock).
const CARD_HEADER_KEYS = new Set(["cat1", "cat2", "cat3"]);

// Etiquetas legibles para las claves de la sección "images". Las tarjetas de
// la home (tapas/desayunos/postres) se muestran como "Tarjeta 1/2/3" porque su
// contenido puede cambiar; la clave del JSON no se toca (la usan la plantilla y
// categorias[].image).
const IMAGES_FIELD_LABELS = {
  logo: "Logo",
  heroDish: "Foto principal (portada)",
  tapas: "Tarjeta 1 (foto)",
  desayunos: "Tarjeta 2 (foto)",
  postres: "Tarjeta 3 (foto)",
  nosotros: "Nosotros (foto)",
  desayunosSeo1: "Bloque desayunos — foto 1",
  desayunosSeo2: "Bloque desayunos — foto 2",
  desayunosSeo3: "Bloque desayunos — foto 3",
};

// Etiquetas legibles para la sección "alerta" (barra de aviso).
const ALERTA_FIELD_LABELS = {
  activa: "Mostrar aviso en la web",
  texto: "Texto del aviso",
};

// Textos de carta que NO se muestran como campo editable en el admin (reducen
// ruido). Se conservan intactos en content.json y siguen apareciendo en la
// web: solo dejan de ser editables desde el panel.
//  - more:   "... y muchos más" (adorno bajo las tarjetas).
//  - footer: pie de carta (text/pdf/cta), incluye el CTA de reserva que está
//            oculto en la web.
const CARTA_HIDDEN_TEXT_KEYS = new Set(["more", "footer"]);

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderAllSections() {
  sectionsContainer.innerHTML = "";
  cartaBodyEl = null;
  horarioBodyEl = null;

  // Orden web (SECTION_ORDER) primero; cualquier clave no listada se añade al
  // final para no perderla nunca.
  const keys = Object.keys(workingContent);
  const orderedKeys = [
    ...SECTION_ORDER.filter((k) => keys.includes(k)),
    ...keys.filter((k) => !SECTION_ORDER.includes(k)),
  ];

  for (const topKey of orderedKeys) {
    // Reseñas: no se renderiza en el editor, pero se conserva intacta en
    // workingContent/originalContent (se actualiza por otro script).
    if (HIDDEN_SECTIONS.has(topKey)) continue;

    // Alerta: panel plano (NO desplegable) con toggle + estado + texto.
    if (topKey === "alerta") {
      const panel = document.createElement("section");
      panel.className = "kf-section kf-section-flat";
      const title = document.createElement("div");
      title.className = "kf-flat-title";
      title.textContent = SECTION_TITLES.alerta;
      panel.appendChild(title);
      const body = document.createElement("div");
      body.className = "kf-section-body";
      panel.appendChild(body);
      renderAlertaSection(body, [topKey]);
      sectionsContainer.appendChild(panel);
      continue;
    }

    const details = document.createElement("details");
    details.className = "kf-section";
    const summary = document.createElement("summary");
    summary.textContent = SECTION_TITLES[topKey] || topKey;
    details.appendChild(summary);

    const body = document.createElement("div");
    body.className = "kf-section-body";
    details.appendChild(body);

    if (topKey === "carta") {
      cartaBodyEl = body;
      renderCartaSection(body, [topKey]);
    } else if (topKey === "horario") {
      horarioBodyEl = body;
      renderHorarioSection(body, [topKey]);
    } else {
      // En "images"/"alerta" pasamos keyLabel null para que cada campo muestre
      // solo su etiqueta legible sin el prefijo "images ›" / "alerta ›".
      const topLabel = topKey === "images" || topKey === "alerta" ? null : topKey;
      renderNode(body, workingContent[topKey], [topKey], topLabel, false);
    }

    sectionsContainer.appendChild(details);
  }
}

/**
 * Renderiza la sección "alerta" como panel plano (sin desplegable):
 *  - toggle activar/desactivar,
 *  - línea de estado que indica en claro si está activo AHORA mismo,
 *  - texto del aviso (bilingüe).
 */
function renderAlertaSection(container, path) {
  const alerta = getAtPath(workingContent, path);

  const toggleRow = document.createElement("label");
  toggleRow.className = "kf-check kf-alerta-toggle";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = !!alerta.activa;
  const span = document.createElement("span");
  span.textContent = "Mostrar aviso en la web";
  toggleRow.appendChild(input);
  toggleRow.appendChild(span);

  const status = document.createElement("div");
  status.className = "kf-alerta-status";
  const pendingNote = document.createElement("div");
  pendingNote.className = "kf-alerta-pending";

  // El estado refleja lo PUBLICADO en la web (originalContent), no el toggle:
  // cambiar el toggle no activa nada hasta pulsar "Publicar". Si el toggle
  // difiere de lo publicado, se avisa de que hay un cambio pendiente.
  const paintStatus = () => {
    const live = !!getAtPath(originalContent, [...path, "activa"]);
    const pending = !!getAtPath(workingContent, [...path, "activa"]);
    status.classList.toggle("is-on", live);
    status.classList.toggle("is-off", !live);
    status.textContent = live
      ? "En la web ahora mismo: ACTIVO — el aviso se está mostrando."
      : "En la web ahora mismo: INACTIVO — el aviso no se muestra.";
    if (pending !== live) {
      pendingNote.hidden = false;
      pendingNote.textContent = pending
        ? "Cambio sin publicar: has activado el aviso. Pulsa «Publicar» para que salga en la web."
        : "Cambio sin publicar: has desactivado el aviso. Pulsa «Publicar» para retirarlo de la web.";
    } else {
      pendingNote.hidden = true;
      pendingNote.textContent = "";
    }
  };

  input.addEventListener("change", () => {
    setAtPath(workingContent, [...path, "activa"], input.checked);
    paintStatus();
    flashSaveStatus();
  });

  container.appendChild(toggleRow);
  container.appendChild(status);
  container.appendChild(pendingNote);
  paintStatus();

  renderBilingualField(container, [...path, "texto"], "Texto del aviso");
}

/**
 * Re-renderiza SOLO el contenido de la sección "horario" (tras un add/remove
 * de filas), igual que rerenderCarta() para "carta".
 */
function rerenderHorario() {
  if (!horarioBodyEl) return;
  renderHorarioSection(horarioBodyEl, ["horario"]);
  flashSaveStatus();
}

/**
 * Renderiza el bloque "horario": una fila editable por franja (días ES/GL +
 * horas) con botón "−" para eliminarla, y un botón "+ Añadir fila" al final.
 * Alimenta a la vez la tarjeta de info y el footer (ver build.js), así que
 * una sola edición aquí se refleja en ambos sitios tras el build.
 */
function renderHorarioSection(body, path) {
  const horario = getAtPath(workingContent, path);
  body.innerHTML = "";

  horario.forEach((row, idx) => {
    const rowPath = [...path, idx];

    const rowWrap = document.createElement("div");
    rowWrap.className = "kf-item-row";

    const fields = document.createElement("div");
    fields.className = "kf-item-row-fields";

    renderBilingualField(fields, [...rowPath, "dias"], "Días");
    renderPlainField(fields, [...rowPath, "horas"], "Horas");

    rowWrap.appendChild(fields);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "kf-btn-remove-item";
    removeBtn.title = "Eliminar fila";
    removeBtn.textContent = "−";
    removeBtn.addEventListener("click", () => {
      horario.splice(idx, 1);
      rerenderHorario();
    });
    rowWrap.appendChild(removeBtn);

    body.appendChild(rowWrap);
  });

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "kf-btn-add-item";
  addBtn.textContent = "+ Añadir fila";
  addBtn.addEventListener("click", () => {
    horario.push({ dias: { es: "", gl: "" }, horas: "" });
    rerenderHorario();
  });
  body.appendChild(addBtn);
}

/**
 * Re-renderiza SOLO el contenido de la sección "carta" (tras un add/remove
 * de items o secciones), preservando el estado abierto/cerrado de sus dos
 * sub-bloques colapsables.
 */
function rerenderCarta() {
  if (!cartaBodyEl) return;
  renderCartaSection(cartaBodyEl, ["carta"]);
  flashSaveStatus();
}

/**
 * Renderiza la sección "carta" con dos sub-bloques colapsables, separados
 * con claridad:
 *  - "Menú destacado (web)": textos de carta (tag/title/desc/cat1-3/more/
 *    footer) + los bloques "categorias" (tarjetas de la home).
 *  - "Carta completa (imprimible)": menuCompleto (columna1 + columna2).
 */
function renderCartaSection(body, path) {
  const carta = getAtPath(workingContent, path);

  const prevOpenA = body.querySelector(":scope > .kf-carta-sub-destacado")?.open;
  const prevOpenB = body.querySelector(":scope > .kf-carta-sub-completa")?.open;
  const prevOpenC = body.querySelector(":scope > .kf-carta-sub-desayunos")?.open;
  // Estado abierto/cerrado de cada tarjeta (por id) para no cerrarlas al
  // re-renderizar tras añadir/quitar un plato (rerenderCarta reconstruye todo).
  const prevCardOpen = {};
  body.querySelectorAll(".kf-card-block").forEach((d) => {
    prevCardOpen[d.dataset.card] = d.open;
  });
  body.innerHTML = "";

  // --- Sub-bloque A: Menú destacado (web) ---
  const subA = document.createElement("details");
  subA.className = "kf-subsection kf-carta-sub-destacado";
  subA.open = prevOpenA === undefined ? true : prevOpenA;
  const summaryA = document.createElement("summary");
  summaryA.textContent = "Menú destacado (web)";
  subA.appendChild(summaryA);

  const bodyA = document.createElement("div");
  bodyA.className = "kf-subsection-body";
  subA.appendChild(bodyA);

  const textsHeading = document.createElement("div");
  textsHeading.className = "kf-subsection-heading";
  textsHeading.textContent = "Textos de la sección Karta";
  bodyA.appendChild(textsHeading);

  for (const k of Object.keys(carta)) {
    if (k === "categorias" || k === "menuCompleto" || k === "menuDesayunos") continue;
    // cat1/cat2/cat3 (etiqueta + título de cada tarjeta) NO van aquí: se
    // muestran dentro de su propia tarjeta agrupada, junto a sus platos.
    if (CARD_HEADER_KEYS.has(k)) continue;
    // more / footer: ocultos del editor (se conservan en el JSON).
    if (CARTA_HIDDEN_TEXT_KEYS.has(k)) continue;
    if (SKIP_KEYS.has(k)) continue;
    renderNode(bodyA, carta[k], [...path, k], CARTA_FIELD_LABELS[k] || k);
  }

  const cardsHeading = document.createElement("div");
  cardsHeading.className = "kf-subsection-heading kf-subsection-heading-spaced";
  cardsHeading.textContent = "Tarjetas de la home (etiqueta + título + platos)";
  bodyA.appendChild(cardsHeading);

  carta.categorias.forEach((cat, i) => {
    renderHomeCardBlock(bodyA, path, cat, i, prevCardOpen);
  });

  body.appendChild(subA);

  // --- Sub-bloque B: Carta completa (imprimible) ---
  const subB = document.createElement("details");
  subB.className = "kf-subsection kf-carta-sub-completa";
  subB.open = prevOpenB === undefined ? false : prevOpenB;
  const summaryB = document.createElement("summary");
  summaryB.textContent = "Carta completa (imprimible)";
  subB.appendChild(summaryB);

  const bodyB = document.createElement("div");
  bodyB.className = "kf-subsection-body";
  subB.appendChild(bodyB);

  renderMenuCompleto(bodyB, [...path, "menuCompleto"], carta.menuCompleto);

  body.appendChild(subB);

  // --- Sub-bloque C: Carta de desayunos (imprimible) ---
  // Misma estructura y controles que "Carta completa": columnas + secciones +
  // platos con +/-. Alimenta la página imprimible menu-printable-desayunos.html.
  const subC = document.createElement("details");
  subC.className = "kf-subsection kf-carta-sub-desayunos";
  subC.open = prevOpenC === undefined ? false : prevOpenC;
  const summaryC = document.createElement("summary");
  summaryC.textContent = "Carta desayunos (imprimible)";
  subC.appendChild(summaryC);

  const bodyC = document.createElement("div");
  bodyC.className = "kf-subsection-body";
  subC.appendChild(bodyC);

  renderMenuCompleto(bodyC, [...path, "menuDesayunos"], carta.menuDesayunos);

  body.appendChild(subC);
}

/**
 * Renderiza UNA tarjeta destacada de la home como bloque agrupado y colapsable:
 * etiqueta + título (cabecera, vive en carta.catN) + platos (viven en
 * categorias[idx]). Así el cliente ve y edita cada tarjeta como una unidad,
 * en vez de tener los títulos por un lado y los platos por otro.
 *
 * La cabecera se lee de carta["cat"+(idx+1)] porque es lo que la web traduce
 * (data-i18n); el label/title inline de la categoría no se usa en la web. Los
 * platos y subcategorías sí viven en categorias[idx]. setAtPath escribe cada
 * campo en su ruta real del JSON: la agrupación es solo visual.
 *
 * @param {Object} prevCardOpen  Mapa id→open para conservar el estado
 *   abierto/cerrado de cada tarjeta al re-renderizar (rerenderCarta).
 */
function renderHomeCardBlock(container, cartaPath, cat, idx, prevCardOpen) {
  const cardId = cat.id || String(idx);
  const catPath = [...cartaPath, "categorias", idx];
  const headerPath = [...cartaPath, `cat${idx + 1}`];
  const header = getAtPath(workingContent, headerPath);

  const block = document.createElement("details");
  block.className = "kf-card-block";
  block.dataset.card = cardId;
  block.open = prevCardOpen[cardId] === undefined ? false : prevCardOpen[cardId];

  const summary = document.createElement("summary");
  summary.textContent = `Tarjeta ${idx + 1}`;
  block.appendChild(summary);

  const cardBody = document.createElement("div");
  cardBody.className = "kf-card-block-body";
  block.appendChild(cardBody);

  // Cabecera de la tarjeta (etiqueta + título).
  if (header && typeof header === "object") {
    renderBilingualField(cardBody, [...headerPath, "label"], "Etiqueta (subtítulo)");
    renderBilingualField(cardBody, [...headerPath, "title"], "Título");
  } else {
    // Fallback defensivo: tarjeta sin cabecera carta.catN (no ocurre con las
    // 3 tarjetas actuales). Usa el label/title inline de la categoría.
    if (cat.label != null) renderPlainField(cardBody, [...catPath, "label"], "Etiqueta (subtítulo)");
    if (cat.title != null) renderPlainField(cardBody, [...catPath, "title"], "Título");
  }

  // Foto de la tarjeta: referencia de solo lectura (se cambia en "Imágenes").
  if (typeof cat.image === "string") {
    renderReadonlyField(cardBody, "Foto (se cambia en la sección Imágenes)", cat.image);
  }

  // Platos: lista plana (items) o subcategorías (p. ej. Tostas/Baggels).
  if (Array.isArray(cat.subcategorias)) {
    cat.subcategorias.forEach((sub, j) => {
      const subPath = [...catPath, "subcategorias", j];
      renderPlainField(cardBody, [...subPath, "nombre"], "Subcategoría");
      renderItemsArray(cardBody, [...subPath, "items"], sub.items, "Platos");
    });
  } else if (Array.isArray(cat.items)) {
    renderItemsArray(cardBody, [...catPath, "items"], cat.items, "Platos");
  }

  container.appendChild(block);
}

/**
 * Renderiza menuCompleto: dos columnas lado a lado, cada una con sus
 * secciones (nombre editable + platos + eliminar sección), y un control
 * para añadir una sección nueva a la columna elegida (por defecto la que
 * tenga menos secciones, para equilibrar).
 */
function renderMenuCompleto(container, path, menuCompleto) {
  const columnsWrap = document.createElement("div");
  columnsWrap.className = "kf-menu-columns";

  for (const colKey of ["columna1", "columna2"]) {
    const colBlock = document.createElement("div");
    colBlock.className = "kf-menu-column";

    const colTitle = document.createElement("div");
    colTitle.className = "kf-menu-column-title";
    colTitle.textContent = CARTA_FIELD_LABELS[colKey] || colKey;
    colBlock.appendChild(colTitle);

    renderSeccionesArray(colBlock, [...path, colKey], menuCompleto[colKey]);

    columnsWrap.appendChild(colBlock);
  }

  container.appendChild(columnsWrap);

  const addRow = document.createElement("div");
  addRow.className = "kf-add-section-row";

  const select = document.createElement("select");
  const optCol1 = document.createElement("option");
  optCol1.value = "columna1";
  optCol1.textContent = "Columna 1";
  const optCol2 = document.createElement("option");
  optCol2.value = "columna2";
  optCol2.textContent = "Columna 2";
  select.appendChild(optCol1);
  select.appendChild(optCol2);
  select.value = menuCompleto.columna1.length <= menuCompleto.columna2.length ? "columna1" : "columna2";

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "kf-btn-add-section";
  addBtn.textContent = "+ Añadir sección";
  addBtn.addEventListener("click", () => {
    const colKey = select.value;
    menuCompleto[colKey].push({
      seccion: "Nueva sección",
      items: [{ nombre: "", precio: "" }],
    });
    rerenderCarta();
  });

  addRow.appendChild(select);
  addRow.appendChild(addBtn);
  container.appendChild(addRow);
}

/**
 * Renderiza la lista de secciones de una columna de menuCompleto: cada
 * sección es un bloque separado con su nombre editable, sus platos
 * (con +/-) y un botón para eliminar la sección entera.
 */
function renderSeccionesArray(container, path, secciones) {
  secciones.forEach((sec, idx) => {
    const secPath = [...path, idx];

    const block = document.createElement("div");
    block.className = "kf-seccion-block";

    const header = document.createElement("div");
    header.className = "kf-seccion-header";

    const nameInput = makeTextInput(sec.seccion, [...secPath, "seccion"]);
    nameInput.classList.add("kf-seccion-name-input");
    header.appendChild(nameInput);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "kf-btn-remove-section";
    removeBtn.textContent = "Eliminar sección";
    removeBtn.addEventListener("click", () => {
      if (!confirm(`¿Eliminar la sección "${sec.seccion}" y todos sus platos?`)) return;
      secciones.splice(idx, 1);
      rerenderCarta();
    });
    header.appendChild(removeBtn);

    block.appendChild(header);

    renderItemsArray(block, [...secPath, "items"], sec.items, "Platos");

    container.appendChild(block);
  });
}

/**
 * Renderiza una lista de items (platos) con botón "−" por fila y botón
 * "+ Añadir plato" al final. Se usa tanto para categorias[].items /
 * categorias[].subcategorias[].items como para menuCompleto.columnaX[].items.
 */
function renderItemsArray(container, path, items, keyLabel) {
  const wrap = document.createElement("div");
  wrap.className = "kf-items-array";

  const title = document.createElement("div");
  title.className = "kf-array-title";
  title.textContent = keyLabel || "Platos";
  wrap.appendChild(title);

  items.forEach((item, idx) => {
    const itemPath = [...path, idx];
    const row = document.createElement("div");
    row.className = "kf-item-row";

    const content = document.createElement("div");
    content.className = "kf-item-content";

    // Fila superior: nombre + precio (rejilla 2fr / 1fr).
    const topFields = document.createElement("div");
    topFields.className = "kf-item-row-fields";
    renderPlainField(topFields, [...itemPath, "nombre"], "Nombre");
    renderPlainField(topFields, [...itemPath, "precio"], "Precio");
    content.appendChild(topFields);

    // Descripción (si existe): campo a ancho completo, DEBAJO de nombre/precio,
    // con un botón "−" para quitarla.
    const hasDesc = Object.prototype.hasOwnProperty.call(item, "descripcion");
    if (hasDesc) {
      const descWrap = document.createElement("div");
      descWrap.className = "kf-item-desc-wrap";
      renderPlainField(descWrap, [...itemPath, "descripcion"], "Descripción");
      const rmDescBtn = document.createElement("button");
      rmDescBtn.type = "button";
      rmDescBtn.className = "kf-btn-desc-remove";
      rmDescBtn.title = "Quitar descripción";
      rmDescBtn.textContent = "−";
      rmDescBtn.addEventListener("click", () => {
        delete item.descripcion;
        rerenderCarta();
      });
      descWrap.appendChild(rmDescBtn);
      content.appendChild(descWrap);
    }

    row.appendChild(content);

    // Acciones a la derecha: eliminar plato + (si no tiene) añadir descripción.
    const actions = document.createElement("div");
    actions.className = "kf-item-actions";

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "kf-btn-remove-item";
    removeBtn.title = "Eliminar plato";
    removeBtn.textContent = "−";
    removeBtn.addEventListener("click", () => {
      items.splice(idx, 1);
      rerenderCarta();
    });
    actions.appendChild(removeBtn);

    if (!hasDesc) {
      const addDescBtn = document.createElement("button");
      addDescBtn.type = "button";
      addDescBtn.className = "kf-btn-add-desc";
      addDescBtn.title = "Añadir descripción";
      addDescBtn.textContent = "✎";
      addDescBtn.addEventListener("click", () => {
        item.descripcion = "";
        rerenderCarta();
      });
      actions.appendChild(addDescBtn);
    }

    row.appendChild(actions);
    wrap.appendChild(row);
  });

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "kf-btn-add-item";
  addBtn.textContent = "+ Añadir plato";
  addBtn.addEventListener("click", () => {
    const newItem = { nombre: "", precio: "" };
    if (items.length > 0 && Object.prototype.hasOwnProperty.call(items[0], "desc")) {
      newItem.desc = "";
    }
    items.push(newItem);
    rerenderCarta();
  });
  wrap.appendChild(addBtn);

  container.appendChild(wrap);
}

/**
 * Renderiza recursivamente cualquier nodo del JSON.
 * @param {HTMLElement} container  Dónde añadir el/los campo(s).
 * @param {*} node                 Valor actual (se lee de workingContent vía path).
 * @param {(string|number)[]} path Ruta completa hasta este nodo.
 * @param {string|null} keyLabel   Etiqueta legible acumulada (o null si no debe mostrarse).
 * @param {boolean} wrapGroup      Si true, envuelve en un <fieldset> con leyenda.
 */
function renderNode(container, node, path, keyLabel, wrapGroup = true) {
  if (Array.isArray(node)) {
    renderArray(container, node, path, keyLabel);
    return;
  }

  if (node !== null && typeof node === "object") {
    const keys = Object.keys(node);
    const isBilingual =
      keys.length > 0 &&
      keys.every((k) => k === "es" || k === "gl") &&
      (Object.prototype.hasOwnProperty.call(node, "es") ||
        Object.prototype.hasOwnProperty.call(node, "gl"));

    if (isBilingual) {
      renderBilingualField(container, path, keyLabel);
      return;
    }

    const target = wrapGroup ? document.createElement("fieldset") : container;
    if (wrapGroup) {
      target.className = "kf-group";
      const legend = document.createElement("legend");
      legend.textContent = keyLabel || path.join(" › ");
      target.appendChild(legend);
      container.appendChild(target);
    }

    for (const k of keys) {
      if (SKIP_KEYS.has(k)) continue;

      const val = node[k];

      // Referencia interna tipo "images.tapas": solo lectura, se conserva intacta.
      if (k === "image" && typeof val === "string" && val.startsWith("images.")) {
        renderReadonlyField(target, "image (referencia)", val);
        continue;
      }

      const friendlyK =
        path[0] === "carta"
          ? CARTA_FIELD_LABELS[k] || k
          : path[0] === "images"
            ? IMAGES_FIELD_LABELS[k] || k
            : path[0] === "alerta"
              ? ALERTA_FIELD_LABELS[k] || k
              : k;
      const childLabel = keyLabel ? `${keyLabel} › ${friendlyK}` : friendlyK;
      renderNode(target, val, [...path, k], childLabel);
    }
    return;
  }

  // Booleano: checkbox (p. ej. alerta.activa).
  if (typeof node === "boolean") {
    renderBooleanField(container, path, keyLabel);
    return;
  }

  // Nodo primitivo: string / number.
  const underImages = path[0] === "images";
  if (typeof node === "string" && (node.startsWith("imagenes/") || underImages)) {
    renderImageField(container, path, keyLabel);
    return;
  }

  renderPlainField(container, path, keyLabel);
}

function renderArray(container, arr, path, keyLabel) {
  // Dentro de "carta", las listas de items (platos) llevan botones +/- para
  // añadir/quitar filas. Se detecta por el nombre de la última clave del path.
  const lastKey = path[path.length - 1];
  if (path[0] === "carta" && lastKey === "items") {
    renderItemsArray(container, path, arr, keyLabel);
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "kf-array";

  const title = document.createElement("div");
  title.className = "kf-array-title";
  title.textContent = keyLabel || path.join(" › ");
  wrap.appendChild(title);

  arr.forEach((item, idx) => {
    const rowWrap = document.createElement("div");
    rowWrap.className = "kf-array-item";
    const indexTag = document.createElement("div");
    indexTag.className = "kf-array-index";
    indexTag.textContent = `#${idx + 1}`;
    rowWrap.appendChild(indexTag);

    renderNode(rowWrap, item, [...path, idx], null, false);

    wrap.appendChild(rowWrap);
  });

  container.appendChild(wrap);
}

function renderBilingualField(container, path, keyLabel) {
  const row = document.createElement("div");
  row.className = "kf-field kf-field-bilingual";

  const label = document.createElement("label");
  label.className = "kf-label";
  label.textContent = keyLabel || path.join(" › ");
  row.appendChild(label);

  const langs = document.createElement("div");
  langs.className = "kf-langs";

  for (const lang of ["es", "gl"]) {
    const langPath = [...path, lang];
    const value = getAtPath(workingContent, langPath) ?? "";

    const sub = document.createElement("div");
    sub.className = "kf-lang";
    const tag = document.createElement("span");
    tag.className = "kf-lang-tag";
    tag.textContent = lang.toUpperCase();
    sub.appendChild(tag);

    const input = makeTextInput(value, langPath);
    sub.appendChild(input);
    langs.appendChild(sub);
  }

  row.appendChild(langs);
  container.appendChild(row);
}

function renderBooleanField(container, path, keyLabel) {
  const value = !!getAtPath(workingContent, path);

  const row = document.createElement("div");
  row.className = "kf-field kf-field-boolean";

  const label = document.createElement("label");
  label.className = "kf-check";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = value;
  input.addEventListener("change", () => {
    setAtPath(workingContent, path, input.checked);
    flashSaveStatus();
  });

  const span = document.createElement("span");
  span.textContent = keyLabel || path.join(" › ");

  label.appendChild(input);
  label.appendChild(span);
  row.appendChild(label);
  container.appendChild(row);
}

function renderPlainField(container, path, keyLabel) {
  const value = getAtPath(workingContent, path);

  const row = document.createElement("div");
  row.className = "kf-field";

  const label = document.createElement("label");
  label.className = "kf-label";
  label.textContent = keyLabel || path.join(" › ");
  row.appendChild(label);

  const input = makeTextInput(value, path);
  row.appendChild(input);

  container.appendChild(row);
}

function renderReadonlyField(container, label, value) {
  const row = document.createElement("div");
  row.className = "kf-readonly-field";
  row.innerHTML = `${escapeHtml(label)}: <code>${escapeHtml(String(value))}</code>`;
  container.appendChild(row);
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isLongOrHtml(value) {
  return typeof value === "string" && (value.length > 60 || value.includes("<"));
}

function makeTextInput(value, path) {
  const strValue = value == null ? "" : String(value);
  const isNumber = typeof value === "number";
  let el;
  if (isLongOrHtml(strValue)) {
    el = document.createElement("textarea");
    el.value = strValue;
  } else {
    el = document.createElement("input");
    el.type = isNumber ? "number" : "text";
    if (isNumber) el.step = "any";
    el.value = strValue;
  }
  el.addEventListener("input", () => {
    const raw = el.value;
    const newValue = isNumber ? (raw === "" ? "" : Number(raw)) : raw;
    setAtPath(workingContent, path, newValue);
    flashSaveStatus();
  });
  return el;
}

// ---------------------------------------------------------------------------
// Campos de imagen: preview + compresión en canvas + descarga
// ---------------------------------------------------------------------------

function renderImageField(container, path, keyLabel) {
  const originalValue = getAtPath(workingContent, path);
  const pathKey = path.join(".");

  const wrap = document.createElement("div");
  wrap.className = "kf-image-field";

  const img = document.createElement("img");
  img.className = "kf-image-preview";
  img.alt = keyLabel || pathKey;
  img.src = resolveImageSrc(originalValue);
  wrap.appendChild(img);

  const info = document.createElement("div");
  info.className = "kf-image-info";

  const label = document.createElement("div");
  label.className = "kf-label";
  label.textContent = keyLabel || pathKey;
  info.appendChild(label);

  const pathLine = document.createElement("div");
  pathLine.className = "kf-image-path";
  pathLine.textContent = originalValue;
  info.appendChild(pathLine);

  const actions = document.createElement("div");
  actions.className = "kf-image-actions";

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.hidden = true;

  const changeBtn = document.createElement("button");
  changeBtn.type = "button";
  changeBtn.textContent = "Cambiar foto";
  changeBtn.addEventListener("click", () => fileInput.click());

  const downloadBtn = document.createElement("button");
  downloadBtn.type = "button";
  downloadBtn.textContent = "Descargar imagen comprimida";
  downloadBtn.disabled = true;

  const changedTag = document.createElement("span");
  changedTag.className = "kf-image-changed-tag";
  changedTag.hidden = true;
  changedTag.textContent = "✓ imagen nueva lista";

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    try {
      const blob = await compressImage(file, 1600, 0.8);
      const filename = suggestFilename(originalValue, file.name);
      imageEdits.set(pathKey, { blob, filename, originalValue });
      img.src = URL.createObjectURL(blob);
      downloadBtn.disabled = false;
      changedTag.hidden = false;
      flashSaveStatus();
    } catch (err) {
      alert(`No se pudo procesar la imagen: ${err.message}`);
    }
  });

  downloadBtn.addEventListener("click", () => {
    const entry = imageEdits.get(pathKey);
    if (!entry) return;
    const url = URL.createObjectURL(entry.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = entry.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });

  actions.appendChild(changeBtn);
  actions.appendChild(downloadBtn);
  actions.appendChild(changedTag);
  info.appendChild(actions);

  wrap.appendChild(info);
  wrap.appendChild(fileInput);
  container.appendChild(wrap);
}

function resolveImageSrc(value) {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  // Las rutas locales (imagenes/...) son relativas a la raíz del sitio;
  // desde /admin/ hay que subir un nivel.
  return `../${value}`;
}

function suggestFilename(originalPath, uploadedName) {
  if (originalPath && originalPath.includes("/")) {
    return originalPath.split("/").pop();
  }
  return uploadedName || "imagen.jpg";
}

function compressImage(file, maxWidth, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Archivo de imagen no válido"));
      image.onload = () => {
        const scale = Math.min(1, maxWidth / image.width);
        const w = Math.round(image.width * scale);
        const h = Math.round(image.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0, w, h);
        canvas.toBlob(
          (blob) => {
            if (!blob) reject(new Error("Fallo al comprimir"));
            else resolve(blob);
          },
          "image/jpeg",
          quality
        );
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Descarga de content.json
// ---------------------------------------------------------------------------

downloadJsonBtn.addEventListener("click", () => {
  if (!workingContent) return;
  const json = JSON.stringify(workingContent, null, 2) + "\n";
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "content.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});

// ---------------------------------------------------------------------------
// Publicación real contra el Worker de Cloudflare
// ---------------------------------------------------------------------------

// Convierte un Blob a base64 puro (sin el prefijo "data:...;base64,").
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
    reader.onload = () => {
      const dataUrl = reader.result;
      const commaIdx = dataUrl.indexOf(",");
      resolve(commaIdx === -1 ? dataUrl : dataUrl.slice(commaIdx + 1));
    };
    reader.readAsDataURL(blob);
  });
}

function sanitizeFilename(name) {
  const cleaned = (name || "").replace(/[^a-zA-Z0-9._-]/g, "");
  return cleaned || `imagen-${Date.now()}.jpg`;
}

async function buildImagesPayload() {
  const images = [];
  for (const [pathKey, entry] of imageEdits.entries()) {
    const { blob, filename, originalValue } = entry;
    let path;
    if (typeof originalValue === "string" && originalValue.startsWith("imagenes/")) {
      path = originalValue;
    } else {
      path = `imagenes/${sanitizeFilename(filename)}`;
      // La referencia original no apuntaba a un fichero local (p.ej. URL
      // externa): actualizamos workingContent para que apunte a la nueva
      // ruta local publicada.
      setAtPath(workingContent, pathKeyToPath(pathKey), path);
    }
    const base64 = await blobToBase64(blob);
    images.push({ path, base64 });
  }
  return images;
}

publishBtn.addEventListener("click", async () => {
  if (!workingContent || !auth.currentUser) {
    alert("Sesión expirada, vuelve a entrar.");
    return;
  }

  publishBtn.disabled = true;
  const originalLabel = publishBtn.textContent;
  publishBtn.textContent = "Publicando…";
  saveStatus.hidden = false;
  saveStatus.textContent = "Publicando…";

  try {
    const images = await buildImagesPayload();
    const token = await auth.currentUser.getIdToken();

    const res = await fetch(PUBLISH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: workingContent, images }),
    });

    if (res.ok) {
      imageEdits.clear();
      saveStatus.textContent = "✓ Publicado. Los cambios saldrán en la web en 1-2 minutos.";
    } else if (res.status === 401) {
      saveStatus.textContent = "No autorizado (vuelve a iniciar sesión).";
    } else if (res.status === 403) {
      saveStatus.textContent = "Tu usuario no tiene permiso para publicar.";
    } else {
      saveStatus.textContent = "Error al publicar, inténtalo de nuevo.";
    }
  } catch (err) {
    saveStatus.textContent = "Error al publicar, inténtalo de nuevo.";
  } finally {
    publishBtn.disabled = false;
    publishBtn.textContent = originalLabel;
  }
});

let flashTimer = null;
function flashSaveStatus() {
  saveStatus.hidden = false;
  saveStatus.textContent = "Cambios sin exportar…";
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    saveStatus.hidden = true;
  }, 2500);
}

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
  nosotros: "Nosotros",
  carta: "Karta",
  menu: "Menú destacado",
  info: "Información / Kontacto",
  footer: "Pie de página",
  reserva: "Formulario de reserva",
  resenas: "Reseñas",
  site: "Sitio (SEO / metadatos)",
  images: "Imágenes",
};

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

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderAllSections() {
  sectionsContainer.innerHTML = "";
  cartaBodyEl = null;
  for (const topKey of Object.keys(workingContent)) {
    // Reseñas: no se renderiza en el editor, pero se conserva intacta en
    // workingContent/originalContent (se actualiza por otro script).
    if (HIDDEN_SECTIONS.has(topKey)) continue;

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
    } else {
      renderNode(body, workingContent[topKey], [topKey], topKey, false);
    }

    sectionsContainer.appendChild(details);
  }
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
    if (k === "categorias" || k === "menuCompleto") continue;
    if (SKIP_KEYS.has(k)) continue;
    renderNode(bodyA, carta[k], [...path, k], CARTA_FIELD_LABELS[k] || k);
  }

  const cardsHeading = document.createElement("div");
  cardsHeading.className = "kf-subsection-heading kf-subsection-heading-spaced";
  cardsHeading.textContent = "Tarjetas de la home (categorías destacadas y sus platos)";
  bodyA.appendChild(cardsHeading);

  renderNode(bodyA, carta.categorias, [...path, "categorias"], CARTA_FIELD_LABELS.categorias);

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
    const row = document.createElement("div");
    row.className = "kf-item-row";

    const fields = document.createElement("div");
    fields.className = "kf-item-row-fields";
    for (const k of Object.keys(item)) {
      renderNode(fields, item[k], [...path, idx, k], CARTA_FIELD_LABELS[k] || k);
    }
    row.appendChild(fields);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "kf-btn-remove-item";
    removeBtn.title = "Eliminar plato";
    removeBtn.textContent = "−";
    removeBtn.addEventListener("click", () => {
      items.splice(idx, 1);
      rerenderCarta();
    });
    row.appendChild(removeBtn);

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

      const friendlyK = path[0] === "carta" ? CARTA_FIELD_LABELS[k] || k : k;
      const childLabel = keyLabel ? `${keyLabel} › ${friendlyK}` : friendlyK;
      renderNode(target, val, [...path, k], childLabel);
    }
    return;
  }

  // Nodo primitivo: string / number / boolean.
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

#!/usr/bin/env node
/**
 * build.js
 *
 * Genera, a partir de `content.json` + `build.config.js`:
 *   - js/translations.generated.js  (window.translations = { es:{...}, gl:{...} })
 *   - index.html                    (desde templates/index.template.html)
 *   - menu-printable.html           (desde templates/menu-printable.template.html)
 *
 * Sin dependencias externas: solo módulos built-in de Node.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Resuelve una ruta con puntos ("info.direccion.calle") dentro de un objeto. */
function getPath(obj, dottedPath) {
  const value = dottedPath.split('.').reduce((acc, part) => {
    if (acc === undefined || acc === null) return undefined;
    return acc[part];
  }, obj);
  if (value === undefined) {
    throw new Error(`Marcador "{{${dottedPath}}}" no existe en content.json`);
  }
  return value;
}

/** Reemplaza todos los {{ruta.al.valor}} de una plantilla con datos de content.json. */
function renderMarkers(templateText, content) {
  return templateText.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, dottedPath) => {
    const value = getPath(content, dottedPath);
    return String(value);
  });
}

/**
 * Sincroniza el texto (ES) de cada elemento `data-i18n="clave"` presente en el HTML
 * con el valor `.es` del keyMap. Las claves del keyMap sin elemento correspondiente
 * se ignoran (solo alimentan translations.generated.js); los elementos data-i18n
 * sin entrada en el keyMap se dejan intactos (p. ej. el `resenas.titulo` huérfano,
 * ver build.config.js).
 */
function syncDataI18n(htmlText, keyMap) {
  let html = htmlText;
  for (const [key, value] of Object.entries(keyMap)) {
    // Captura la etiqueta de apertura completa (con el resto de atributos) y su
    // contenido hasta el cierre de la MISMA etiqueta (backreference \1).
    // Válido aquí porque ningún elemento data-i18n anida un hijo de igual etiqueta.
    const re = new RegExp(
      `(<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*\\bdata-i18n="${escapeRegExp(key)}"[^>]*>)[\\s\\S]*?(</\\2>)`,
      'g'
    );
    const before = html;
    html = html.replace(re, (_m, openTag, _tag, closeTag) => `${openTag}${value.es}${closeTag}`);
    if (html === before) {
      // No hay elemento con esta clave en esta plantilla; no es un error (una
      // misma clave puede no existir, p. ej., en menu-printable.html).
    }
  }
  return html;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Renderiza un único plato de la carta printable (menu-printable.html). */
function renderMenuItem(item) {
  const desc = item.descripcion ? `<span class="item-desc">${item.descripcion}</span>` : '';
  return (
    '                    <div class="item">\n' +
    `                        <div class="item-info"><span class="item-name">${item.nombre}</span>${desc}</div>` +
    `<span class="item-price">${item.precio}</span>\n` +
    '                    </div>'
  );
}

/** Renderiza una sección (h2 + items) de la carta printable. */
function renderMenuSection(section) {
  const items = section.items.map(renderMenuItem).join('\n');
  return (
    '                <section>\n' +
    `                    <h2>${section.seccion}</h2>\n` +
    `${items}\n` +
    '                </section>'
  );
}

/** Renderiza una columna completa (varias secciones) de la carta printable. */
function renderMenuColumn(sections) {
  return sections.map(renderMenuSection).join('\n\n');
}

/** Renderiza un plato de las tarjetas destacadas de la home (index.html). */
function renderHomeItem(item) {
  return (
    '                        <div class="menu-item">\n' +
    '                            <div class="menu-item-info">\n' +
    `                                <span class="menu-item-name">${item.nombre}</span>\n` +
    '                            </div>\n' +
    `                            <span class="menu-item-price">${item.precio}</span>\n` +
    '                        </div>'
  );
}

const HOME_MENU_DIVIDER = '                        <div class="menu-divider"></div>';

function renderHomeItems(items) {
  return (items || []).map(renderHomeItem).join('\n' + HOME_MENU_DIVIDER + '\n');
}

/**
 * Renderiza los platos de una categoría destacada de la home. Soporta tanto
 * `items` (lista plana) como `subcategorias` (con encabezado `menu-subcat`,
 * p. ej. Tostas/Baggels en desayunos).
 */
function renderHomeCategoria(cat) {
  if (Array.isArray(cat.subcategorias)) {
    return cat.subcategorias
      .map((sub) => `                        <p class="menu-subcat">${sub.nombre}</p>\n` + renderHomeItems(sub.items))
      .join('\n');
  }
  return renderHomeItems(cat.items);
}

function buildTranslationsGenerated(keyMap) {
  const es = {};
  const gl = {};
  for (const [key, value] of Object.entries(keyMap)) {
    es[key] = value.es;
    gl[key] = value.gl;
  }
  const out =
    '/* Generado automáticamente por build.js a partir de content.json. NO editar a mano. */\n' +
    'window.translations = ' +
    JSON.stringify({ es, gl }, null, 2) +
    ';\n';
  fs.writeFileSync(path.join(ROOT, 'js', 'translations.generated.js'), out);
}

function buildHtmlFile(templateName, outputName, content, keyMap) {
  const templatePath = path.join(ROOT, 'templates', templateName);
  let html = fs.readFileSync(templatePath, 'utf8');
  html = renderMarkers(html, content);
  html = syncDataI18n(html, keyMap);
  fs.writeFileSync(path.join(ROOT, outputName), html);
}

function main() {
  const content = readJson(path.join(ROOT, 'content.json'));
  const keyMap = require(path.join(ROOT, 'build.config.js'))(content);

  // Pre-renderiza el HTML de cada columna de la carta printable y lo cuelga
  // del propio objeto `content` para que renderMarkers() lo resuelva como un
  // marcador más ({{carta.menuCompleto.columnaNHtml}}).
  content.carta.menuCompleto.columna1Html = renderMenuColumn(content.carta.menuCompleto.columna1);
  content.carta.menuCompleto.columna2Html = renderMenuColumn(content.carta.menuCompleto.columna2);

  // Pre-renderiza los platos de cada tarjeta destacada de la home y los cuelga
  // como marcador {{carta.categorias.N.homeHtml}} en la plantilla.
  content.carta.categorias.forEach((cat) => {
    cat.homeHtml = renderHomeCategoria(cat);
  });

  buildTranslationsGenerated(keyMap);
  buildHtmlFile('index.template.html', 'index.html', content, keyMap);
  buildHtmlFile('menu-printable.template.html', 'menu-printable.html', content, keyMap);

  console.log('Build OK:');
  console.log('  - js/translations.generated.js');
  console.log('  - index.html');
  console.log('  - menu-printable.html');
}

main();

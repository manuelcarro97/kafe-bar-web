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
  const desc = item.descripcion
    ? `\n                                <span class="menu-item-desc">${item.descripcion}</span>`
    : '';
  return (
    '                        <div class="menu-item">\n' +
    '                            <div class="menu-item-info">\n' +
    `                                <span class="menu-item-name">${item.nombre}</span>${desc}\n` +
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

/** Renderiza una fila de horario de la tarjeta info (index.html). */
function renderHorarioInfoRow(row, i) {
  return (
    '                            <div class="horario-row">\n' +
    `                                <span class="horario-dia" data-i18n="horario.${i}.dias">${row.dias.es}</span>\n` +
    `                                <span class="horario-hora">${row.horas}</span>\n` +
    '                            </div>'
  );
}

/** Renderiza el bloque completo de horario para la tarjeta info. */
function renderHorarioInfoHtml(horario) {
  return horario.map((row, i) => renderHorarioInfoRow(row, i)).join('\n');
}

/** Renderiza el bloque completo de horario para el footer. */
function renderHorarioFooterHtml(horario) {
  return horario
    .map(
      (row, i) =>
        `                <p data-i18n="horario.${i}.footer">${row.dias.es}: ${row.horas}</p>`
    )
    .join('\n');
}

/**
 * Genera las claves i18n dinámicas ('horario.N.dias' y 'horario.N.footer')
 * a partir de content.horario, para fusionarlas en el keyMap ANTES de
 * buildTranslationsGenerated()/syncDataI18n(). Así el toggle ES/GL y la
 * sincronización ES funcionan igual que con las claves estáticas del keyMap.
 */
function buildHorarioKeyMap(horario) {
  const map = {};
  horario.forEach((row, i) => {
    map[`horario.${i}.dias`] = { es: row.dias.es, gl: row.dias.gl };
    map[`horario.${i}.footer`] = {
      es: `${row.dias.es}: ${row.horas}`,
      gl: `${row.dias.gl}: ${row.horas}`,
    };
  });
  return map;
}

/**
 * Renderiza la barra de aviso (marquee bajo el nav). Devuelve '' si no está
 * activa, de modo que la barra no aparece en la web. El texto se repite dentro
 * de un "grupo" y el grupo se duplica: animando el track a translateX(-50%) se
 * consigue un bucle infinito sin cortes. Los <span> llevan data-i18n para que
 * el toggle ES/GL y la sincronización ES funcionen como el resto.
 */
function renderAlertaHtml(alerta) {
  if (!alerta || !alerta.activa) return '';
  const item =
    '<span class="alerta-item" data-i18n="alerta.texto">' + alerta.texto.es + '</span>' +
    '<span class="alerta-sep" aria-hidden="true">✦</span>';
  // Cada "grupo" se repite muchas veces para que su ancho supere el de la
  // pantalla; con dos grupos idénticos y animación a -50% el bucle es continuo
  // (tipo rueda) sin hueco al reiniciar, sea cual sea el ancho del monitor.
  const group = '<div class="alerta-group">' + item.repeat(12) + '</div>';
  return (
    '<div class="alerta-bar" role="status" aria-live="polite">\n' +
    '        <div class="alerta-track">' + group + group + '</div>\n' +
    '    </div>'
  );
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

  // Ídem para la carta imprimible de desayunos/brunch (menuDesayunos), misma
  // estructura que menuCompleto → se reutiliza renderMenuColumn.
  content.carta.menuDesayunos.columna1Html = renderMenuColumn(content.carta.menuDesayunos.columna1);
  content.carta.menuDesayunos.columna2Html = renderMenuColumn(content.carta.menuDesayunos.columna2);

  // Pre-renderiza los platos de cada tarjeta destacada de la home y los cuelga
  // como marcador {{carta.categorias.N.homeHtml}} en la plantilla.
  content.carta.categorias.forEach((cat) => {
    cat.homeHtml = renderHomeCategoria(cat);
  });

  // Pre-renderiza el bloque de horario (tarjeta info + footer) a partir de
  // content.horario y fusiona sus claves i18n dinámicas en el keyMap ANTES
  // de generar translations.generated.js y sincronizar el HTML, para que el
  // toggle ES/GL y el texto ES inicial cuadren con el mismo array.
  content.horarioInfoHtml = renderHorarioInfoHtml(content.horario);
  content.horarioFooterHtml = renderHorarioFooterHtml(content.horario);
  Object.assign(keyMap, buildHorarioKeyMap(content.horario));

  // Barra de aviso (marquee bajo el nav). '' si no está activa.
  content.alertaHtml = renderAlertaHtml(content.alerta);
  // Clase en <body> cuando la alerta está activa: la barra vive dentro del
  // header fijo, así que el hero necesita algo más de padding-top para no
  // quedar tapado.
  content.alertaBodyClass = content.alerta && content.alerta.activa ? 'has-alerta' : '';

  buildTranslationsGenerated(keyMap);
  buildHtmlFile('index.template.html', 'index.html', content, keyMap);
  buildHtmlFile('menu-printable.template.html', 'menu-printable.html', content, keyMap);
  buildHtmlFile('desayunos-printable.template.html', 'menu-printable-desayunos.html', content, keyMap);

  console.log('Build OK:');
  console.log('  - js/translations.generated.js');
  console.log('  - index.html');
  console.log('  - menu-printable.html');
  console.log('  - menu-printable-desayunos.html');
}

main();

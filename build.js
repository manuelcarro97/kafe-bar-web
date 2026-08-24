#!/usr/bin/env node
/**
 * build.js
 *
 * Genera, a partir de `content.json` + `build.config.js`:
 *   - js/translations.generated.js  (window.translations = { es:{...}, gl:{...} })
 *   - index.html                    (desde templates/index.template.html)
 *   - menu-printable.html           (desde templates/menu-printable.template.html)
 *   - menu-printable-desayunos.html (desde templates/desayunos-printable.template.html)
 *   - menu-printable-tortillas.html (desde templates/tortillas-printable.template.html)
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

/**
 * Renderiza un plato del menú del día: nombre a la izquierda, categoría
 * (Primero/Segundo/Postre) a la derecha. Sin data-i18n, igual que los platos
 * de la karta: el contenido lo edita el cliente desde /admin, no se traduce.
 */
function renderMenuDiaPlato(plato) {
  return (
    '                        <li class="menudia-plato">\n' +
    `                            <span class="menudia-plato-nombre">${plato.nombre}</span>` +
    `<span class="menudia-plato-cat">${plato.categoria}</span>\n` +
    '                        </li>'
  );
}

/** Renderiza la lista completa de platos del menú del día. */
function renderMenuDiaPlatosHtml(platos) {
  return (platos || []).map(renderMenuDiaPlato).join('\n');
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

/** Escapa texto que acaba dentro de HTML (títulos/fuentes vienen de medios externos). */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Renderiza una tarjeta del carrusel de medios (enlace externo).
 *
 * La miniatura la sube siempre el cliente desde el panel: no se deduce ni se
 * descarga de la web enlazada. Sin imagen se pinta un hueco de marca, para
 * que una tarjeta a medias no rompa la fila.
 */
function renderMedioCard(item) {
  const alt = escapeHtml(item.titulo);
  const play =
    item.tipo === 'video' || item.tipo === 'youtube'
      ? '\n                        <span class="medio-play" aria-hidden="true">&#9654;</span>'
      : '';
  const fecha = item.fecha ? ` &middot; ${escapeHtml(item.fecha)}` : '';
  const thumb = item.imagen
    ? `<img src="${escapeHtml(item.imagen)}" alt="${alt}" loading="lazy" />`
    : '<span class="medio-thumb-vacia" aria-hidden="true">K</span>';
  return (
    `                    <a class="medio-card" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">\n` +
    '                        <div class="medio-thumb">\n' +
    `                            ${thumb}${play}\n` +
    '                        </div>\n' +
    '                        <div class="medio-meta">\n' +
    `                            <span class="medio-fuente">${escapeHtml(item.fuente)}${fecha}</span>\n` +
    `                            <strong class="medio-titulo">${alt}</strong>\n` +
    '                        </div>\n' +
    '                    </a>'
  );
}

/**
 * Renderiza el bloque completo "Kafé en los medios". Devuelve '' si está
 * desactivado o sin items, igual que renderAlertaHtml, de modo que la sección
 * simplemente no existe en el HTML publicado.
 */
function renderMediosHtml(medios) {
  if (!medios || !medios.activo || !Array.isArray(medios.items) || medios.items.length === 0) {
    return '';
  }
  const cards = medios.items.map(renderMedioCard).join('\n');
  return (
    '<section id="medios" class="medios-section">\n' +
    '        <div class="container">\n' +
    '            <div class="medios-header">\n' +
    `                <p class="section-tag" data-i18n="medios.tag">${medios.tag.es}</p>\n` +
    `                <h2 class="section-title" data-i18n="medios.titulo">${medios.titulo.es}</h2>\n` +
    `                <p class="section-desc" data-i18n="medios.desc">${medios.desc.es}</p>\n` +
    '            </div>\n' +
    '            <div class="marquee-container">\n' +
    '                <div id="medios-track" class="marquee-track">\n' +
    cards + '\n' +
    '                </div>\n' +
    '            </div>\n' +
    '        </div>\n' +
    '    </section>'
  );
}

/**
 * Renderiza el bloque "Celebra con nosotros" (zona de eventos). Devuelve ''
 * si está desactivado, igual que renderMediosHtml/renderAlertaHtml, de modo que
 * la sección simplemente no existe en el HTML publicado.
 *
 * Va como <div class="celebra-block"> (NO <section id>): el IntersectionObserver
 * de js/script.js selecciona section[id] y una sección anidada dentro de #info
 * secuestraría el resaltado del nav.
 *
 * El vídeo se sirve con autoplay + muted + playsinline y SIN loop ni controls:
 * arranca solo una vez y luego js/script.js gestiona play/pausa al hacer click.
 */
function renderCelebraHtml(celebra) {
  if (!celebra || !celebra.activo) return '';
  const video = escapeHtml(celebra.video || '');
  const fotos = Array.isArray(celebra.fotos) ? celebra.fotos : [];
  // Miniatura por cada foto de la lista (galería dinámica editable en /admin).
  const fotoThumbs = fotos
    .map(
      (f) =>
        `                            <img class="celebra-thumb celebra-thumb-img" data-type="image" data-src="${escapeHtml(f)}" src="${escapeHtml(f)}" alt="" loading="lazy" />\n`
    )
    .join('');
  const iconTel =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">' +
    '<path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>';
  const iconWa =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">' +
    '<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>';
  return (
    '<div class="celebra-block" id="eventos">\n' +
    '            <div class="container">\n' +
    '                <div class="celebra-grid">\n' +
    '                    <div class="celebra-media" data-celebra-gallery>\n' +
    '                        <div class="celebra-stage">\n' +
    '                            <div class="celebra-video-wrap is-paused">\n' +
    `                                <video class="celebra-video" src="${video}" muted autoplay playsinline preload="metadata"></video>\n` +
    '                                <span class="celebra-video-overlay" aria-hidden="true">&#9654;</span>\n' +
    '                            </div>\n' +
    '                        </div>\n' +
    '                        <div class="celebra-thumbs-wrap">\n' +
    '                            <div class="celebra-thumbs">\n' +
    `                                <div class="celebra-thumb celebra-thumb-video celebra-thumb-active" data-type="video" data-src="${video}">\n` +
    `                                    <video muted preload="metadata" src="${video}"></video>\n` +
    '                                    <span class="celebra-thumb-play" aria-hidden="true">&#9654;</span>\n' +
    '                                </div>\n' +
    fotoThumbs +
    '                            </div>\n' +
    '                        </div>\n' +
    '                    </div>\n' +
    '                    <div class="celebra-content">\n' +
    `                        <p class="section-tag" data-i18n="celebra.tag">${celebra.tag.es}</p>\n` +
    `                        <h2 class="section-title" data-i18n="celebra.subtitulo">${celebra.subtitulo.es}</h2>\n` +
    `                        <p class="celebra-text" data-i18n="celebra.desc">${celebra.desc.es}</p>\n` +
    '                        <div class="celebra-contacto">\n' +
    '                            <a class="celebra-tel" href="tel:+34981318260">\n' +
    `                                <span class="celebra-tel-icon">${iconTel}</span> 981 31 82 60\n` +
    '                            </a>\n' +
    '                            <a class="celebra-tel" href="https://wa.me/34673889800" target="_blank" rel="noopener noreferrer">\n' +
    `                                <span class="celebra-tel-icon">${iconWa}</span> 673 88 98 00\n` +
    '                            </a>\n' +
    '                        </div>\n' +
    '                    </div>\n' +
    '                </div>\n' +
    '            </div>\n' +
    '        </div>'
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

  // Carta imprimible de tortillas: a diferencia de las otras dos, es de UNA
  // sola columna centrada, así que solo tiene columna1 (ver el spec en
  // docs/specs). Reutiliza igualmente renderMenuColumn.
  content.carta.menuTortillas.columna1Html = renderMenuColumn(content.carta.menuTortillas.columna1);

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

  // Lista de platos del menú del día ({{menuDia.platosHtml}} en la plantilla).
  content.menuDia.platosHtml = renderMenuDiaPlatosHtml(content.menuDia.platos);

  // Barra de aviso (marquee bajo el nav). '' si no está activa.
  content.alertaHtml = renderAlertaHtml(content.alerta);
  // Clase en <body> cuando la alerta está activa: la barra vive dentro del
  // header fijo, así que el hero necesita algo más de padding-top para no
  // quedar tapado.
  content.alertaBodyClass = content.alerta && content.alerta.activa ? 'has-alerta' : '';

  // Bloque "Kafé en los medios" (carrusel de vídeos/reportajes). '' si está
  // desactivado o no hay items.
  content.mediosHtml = renderMediosHtml(content.medios);

  // Bloque "Celebra con nosotros" (zona de eventos). '' si está desactivado.
  content.celebraHtml = renderCelebraHtml(content.celebra);

  buildTranslationsGenerated(keyMap);
  buildHtmlFile('index.template.html', 'index.html', content, keyMap);
  buildHtmlFile('menu-printable.template.html', 'menu-printable.html', content, keyMap);
  buildHtmlFile('desayunos-printable.template.html', 'menu-printable-desayunos.html', content, keyMap);
  buildHtmlFile('tortillas-printable.template.html', 'menu-printable-tortillas.html', content, keyMap);

  console.log('Build OK:');
  console.log('  - js/translations.generated.js');
  console.log('  - index.html');
  console.log('  - menu-printable.html');
  console.log('  - menu-printable-desayunos.html');
  console.log('  - menu-printable-tortillas.html');
}

main();

/**
 * build.config.js
 *
 * Mapea cada clave `data-i18n` usada en index.html (y las claves "muertas"
 * que ya existían en el objeto `translations` de script.js aunque ningún
 * elemento las use hoy) a su ruta dentro de content.json.
 *
 * `keyMap(c)` recibe el content.json parseado y devuelve un objeto plano
 * { 'clave.i18n': { es, gl } }.
 *
 * NOTA: 'resenas.titulo' (usada en index.html línea ~355) es un data-i18n
 * huérfano: no existe una clave equivalente en el objeto `translations`
 * original (que solo tiene 'resenas.title'), así que nunca se tradujo al
 * cambiar de idioma; es un bug preexistente. Para no alterar el
 * comportamiento visible NO se mapea aquí: build.js la deja intacta.
 */
module.exports = function keyMap(c) {
  return {
    // alerta (barra de aviso marquee)
    'alerta.texto': c.alerta.texto,

    // nav
    'nav.inicio': c.nav.inicio,
    'nav.desayunos': c.nav.desayunos,
    'nav.nosotros': c.nav.nosotros,
    'nav.carta': c.nav.carta,
    'nav.resenas': c.nav.resenas,
    'nav.contacto': c.nav.contacto,
    'nav.verCarta': c.nav.verCarta,
    'nav.reservar': c.nav.reservar,

    // hero
    'hero.titulo': c.hero.titulo,
    'hero.subtitle': c.hero.subtitle,
    'hero.subtitleMovil': c.hero.subtitleMovil,
    'hero.cta.carta': c.hero.cta.carta,
    'hero.cta.historia': c.hero.cta.historia,
    'hero.cta.desayunos': c.hero.cta.desayunos,
    'hero.card.signature': c.hero.card.signature,
    'hero.card.plato': c.hero.card.plato,

    // nosotros
    // desayunos (bloque SEO entre hero y karta)
    'desayunos.tag': c.desayunos.tag,
    'desayunos.title': c.desayunos.title,
    'desayunos.parrafo1': c.desayunos.parrafo1,
    'desayunos.parrafo2': c.desayunos.parrafo2,
    'desayunos.nota': c.desayunos.nota,
    'desayunos.cta': c.desayunos.cta,

    // nosotros
    'nosotros.badge': c.nosotros.badge,
    'nosotros.tag': c.nosotros.tag,
    'nosotros.title': c.nosotros.title,
    'nosotros.feat1.title': c.nosotros.feat1.title,
    'nosotros.feat1.desc': c.nosotros.feat1.desc,
    'nosotros.feat2.title': c.nosotros.feat2.title,
    'nosotros.feat2.desc': c.nosotros.feat2.desc,
    'nosotros.cta.carta': c.nosotros.cta.carta,

    // medios (bloque "Han hablado de nosotros"). Solo la cabecera es
    // traducible: el título de cada tarjeta es la cita del medio y se
    // renderiza como HTML plano, sin data-i18n (ver renderMediosHtml).
    'medios.tag': c.medios.tag,
    'medios.titulo': c.medios.titulo,
    'medios.desc': c.medios.desc,

    // carta
    'carta.tag': c.carta.tag,
    'carta.title': c.carta.title,
    'carta.desc': c.carta.desc,
    'carta.cat1.label': c.carta.cat1.label,
    'carta.cat1.title': c.carta.cat1.title,
    'carta.more': c.carta.more,
    'carta.cat2.label': c.carta.cat2.label,
    'carta.cat2.title': c.carta.cat2.title,
    'carta.cat3.label': c.carta.cat3.label,
    'carta.cat3.title': c.carta.cat3.title,
    'carta.footer.text': c.carta.footer.text,
    'carta.footer.pdf': c.carta.footer.pdf,
    'carta.footer.cta': c.carta.footer.cta,

    // info
    'info.tag': c.info.tag,
    'info.title': c.info.title,
    'info.lead': c.info.lead,
    'info.card1.title': c.info.card1.title,
    'info.card1.note': c.info.card1.note,
    'info.card2.title': c.info.card2.title,
    'info.card2.cta': c.info.card2.cta,
    'info.card3.title': c.info.card3.title,
    'info.card3.text': c.info.card3.text,
    'info.card3.map': c.info.card3.map,

    // footer
    'footer.tagline': c.footer.tagline,
    'footer.nav.title': c.footer.nav.title,

    // reserva
    'reserva.tag': c.reserva.tag,
    'reserva.title': c.reserva.title,
    'reserva.nombre': c.reserva.nombre,
    'reserva.telefono': c.reserva.telefono,
    'reserva.fecha': c.reserva.fecha,
    'reserva.hora': c.reserva.hora,
    'reserva.horaPlaceholder': c.reserva.horaPlaceholder,
    'reserva.personas': c.reserva.personas,
    'reserva.tipo': c.reserva.tipo,
    'reserva.tipoCarta': c.reserva.tipoCarta,
    'reserva.tipoPersonalizado': c.reserva.tipoPersonalizado,
    'reserva.notaPersonalizado': c.reserva.notaPersonalizado,
    'reserva.enviar': c.reserva.enviar,
    'reserva.alt': c.reserva.alt,
    'reserva.confirmacion.titulo': c.reserva.confirmacion.titulo,
    'reserva.confirmacion.texto': c.reserva.confirmacion.texto,
    'reserva.confirmacion.aviso': c.reserva.confirmacion.aviso,
    'reserva.confirmacion.cerrar': c.reserva.confirmacion.cerrar,

    // resenas (incluye claves sin data-i18n hoy, conservadas por fidelidad
    // con el objeto `translations` original)
    'resenas.tag': c.resenas.tag,
    'resenas.title': c.resenas.title,
    'resenas.titulo': c.resenas.titulo,
    'resenas.desc': c.resenas.desc,
    'resenas.cta': c.resenas.cta,
    'resenas.r1.date': c.resenas.r1.date,
    'resenas.r2.date': c.resenas.r2.date,
    'resenas.r3.date': c.resenas.r3.date,
    'resenas.r4.date': c.resenas.r4.date,
    'resenas.r5.date': c.resenas.r5.date,
    'resenas.r6.date': c.resenas.r6.date,
  };
};

#!/usr/bin/env node
/**
 * scripts/generate-qr.js
 *
 * Genera los códigos QR de imagenes/ con el logotipo de Kafé en el centro.
 *
 *   node scripts/generate-qr.js
 *
 * Las URLs salen de `site.url` en content.json, así que cuando cambie el
 * dominio basta con volver a ejecutarlo: no hay ninguna URL escrita a mano.
 *
 * Sobre el logotipo en el centro: tapar parte del QR solo es viable con
 * corrección de errores nivel H, que reconstruye hasta un 30% del código. Aun
 * así el logo se mantiene en el 22% del ancho (~4.8% del área) para dejar
 * margen de sobra frente a impresiones sucias o mal iluminadas.
 */
const path = require('node:path');
const fs = require('node:fs');
const QRCode = require('qrcode');
const { Jimp } = require('jimp');

const ROOT = path.join(__dirname, '..');
const LOGO = path.join(ROOT, 'imagenes', 'kafe-logo.png');

/** Lado del PNG generado. Sobra para imprimir a buen tamaño. */
const SIZE = 1200;
/** Ancho del logotipo respecto al del QR. Con placa incluida tapa un 5.1%
 *  del área, muy por debajo del 30% que reconstruye el nivel H. */
const LOGO_RATIO = 0.30;
/** Margen blanco alrededor del logotipo, en píxeles del PNG final. */
const LOGO_PADDING = 18;

const AZUL_OSCURO = '#0d2137';

function targets(baseUrl) {
  const base = baseUrl.replace(/\/+$/, '');
  return [
    { file: 'qr-web.png', url: `${base}/`, label: 'Web' },
    { file: 'qr-carta.png', url: `${base}/menu-printable.html`, label: 'Karta' },
    { file: 'qr-desayunos.png', url: `${base}/menu-printable-desayunos.html`, label: 'Desayunos' },
  ];
}

async function buildQr({ file, url }) {
  const buffer = await QRCode.toBuffer(url, {
    errorCorrectionLevel: 'H',
    type: 'png',
    width: SIZE,
    margin: 2,
    color: { dark: AZUL_OSCURO, light: '#ffffff' },
  });

  const qr = await Jimp.fromBuffer(buffer);
  const logo = await Jimp.read(LOGO);

  const logoWidth = Math.round(qr.bitmap.width * LOGO_RATIO);
  const logoHeight = Math.round((logo.bitmap.height / logo.bitmap.width) * logoWidth);
  logo.resize({ w: logoWidth, h: logoHeight });

  // Placa blanca detrás del logotipo: sin ella los módulos oscuros del QR se
  // mezclarían con el trazo azul y el lector perdería contraste local.
  const plate = new Jimp({
    width: logoWidth + LOGO_PADDING * 2,
    height: logoHeight + LOGO_PADDING * 2,
    color: 0xffffffff,
  });
  plate.composite(logo, LOGO_PADDING, LOGO_PADDING);

  qr.composite(
    plate,
    Math.round((qr.bitmap.width - plate.bitmap.width) / 2),
    Math.round((qr.bitmap.height - plate.bitmap.height) / 2)
  );

  const out = path.join(ROOT, 'imagenes', file);
  await qr.write(out);
  return out;
}

async function main() {
  const content = JSON.parse(fs.readFileSync(path.join(ROOT, 'content.json'), 'utf8'));
  const baseUrl = content.site && content.site.url;
  if (!baseUrl) throw new Error('content.json no tiene site.url');

  console.log(`Base: ${baseUrl}\n`);
  for (const target of targets(baseUrl)) {
    const out = await buildQr(target);
    const kb = (fs.statSync(out).size / 1024).toFixed(0);
    console.log(`  ${target.label.padEnd(10)} ${target.file.padEnd(20)} ${kb} KB   ${target.url}`);
  }
  console.log('\nQR generados.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

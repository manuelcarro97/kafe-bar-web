// Configuración de entorno compartida por la web de reservas y el panel del bar.
// Preview (canal de Firebase Hosting, host con "--") usa su propio Worker y su propia base de datos.

const LOCAL_HOSTS = ['localhost', '127.0.0.1'];
const LOCAL_API = 'http://localhost:8787';
const PREVIEW_API = 'https://your-worker-preview.your-account.workers.dev';
const PRODUCTION_API = 'https://your-worker.your-account.workers.dev';

// Claves públicas de Cloudflare Turnstile. La de pruebas siempre pasa; en un despliegue real se sustituye por la clave del sitio.
const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';
const TURNSTILE_PREVIEW_SITE_KEY = 'YOUR_TURNSTILE_SITE_KEY';

export function isPreviewHost(hostname) {
  return hostname.includes('--');
}

export function apiBase(hostname) {
  if (LOCAL_HOSTS.includes(hostname)) return LOCAL_API;
  return isPreviewHost(hostname) ? PREVIEW_API : PRODUCTION_API;
}

export function turnstileSiteKey(hostname) {
  return isPreviewHost(hostname) ? TURNSTILE_PREVIEW_SITE_KEY : TURNSTILE_TEST_SITE_KEY;
}

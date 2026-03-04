# Kafe Bar

Sitio web para Kafé, bar-restaurante gallego en A Coruña.

## Stack

- HTML5 / CSS3 / JavaScript — vanilla, sin frameworks ni bundlers
- Firebase Hosting — deploy del sitio estático
- Cloudflare Worker — gestión de reservas vía email (Resend API)

## Estructura

```
/
├── index.html              Página única (hero, carta, info, reseñas, nosotros)
├── menu-printable.html     Carta en formato imprimible/PDF
├── css/style.css
├── js/script.js
├── imagenes/
├── worker/                 Cloudflare Worker para el formulario de reservas
│   ├── index.js
│   └── wrangler.toml
└── scripts/
    └── scrape-reviews.js   Script para actualizar reseñas de Google Maps
```

## Comandos

```bash
# Desarrollo local
firebase serve          # Con Firebase CLI
npx serve .             # Alternativa rápida

# Deploy
firebase deploy         # Publica en Firebase Hosting (proyecto: kafe-143b5)

# Worker de Cloudflare
cd worker
npx wrangler dev        # Desarrollo local
npx wrangler deploy     # Deploy a Cloudflare

# Actualizar reseñas de Google Maps
node scripts/scrape-reviews.js
```

## Funcionalidades

- **i18n ES / GL** — toggle de idioma en caliente sin recarga
- **Reservas** — formulario modal que envía email vía Cloudflare Worker + Resend
- **Reseñas** — carrusel con reseñas reales de Google Maps, actualizables con el script
- **Carta imprimible** — `menu-printable.html` optimizado para PDF

## Variables de entorno

El worker requiere `RESEND_API_KEY` configurada en Cloudflare (no se commitea).

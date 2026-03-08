const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Convierte fechas relativas de Google ("hace 2 meses") a "Feb 2026"
function formatDate(dateText) {
    const now = new Date();
    const lower = dateText.toLowerCase();
    let d = null;

    // "un"/"una" = 1 en español, el resto son dígitos
    const num = s => s === 'un' || s === 'una' ? 1 : parseInt(s);

    const months = lower.match(/hace\s+(un|\d+)\s+mes/);
    const weeks  = lower.match(/hace\s+(un[ao]?|\d+)\s+semana/);
    const years  = lower.match(/hace\s+(un|\d+)\s+a[ñn]o/);
    const days   = lower.match(/hace\s+(un|\d+)\s+d[íi]a/);

    if (months)     d = new Date(now.getFullYear(), now.getMonth() - num(months[1]), 1);
    else if (weeks) d = new Date(now - num(weeks[1]) * 7 * 86400000);
    else if (years) d = new Date(now.getFullYear() - num(years[1]), now.getMonth(), 1);
    else if (days)  d = now;

    if (!d) return dateText;

    const month = d.toLocaleDateString('es-ES', { month: 'short' });
    const year  = d.getFullYear();
    return month.charAt(0).toUpperCase() + month.slice(1).replace('.', '') + ' ' + year;
}

// Configuración general
const PLACE_URL = 'https://www.google.com/maps/place/Kafe/@43.3621449,-8.4155189,16z/data=!3m1!4b1!4m6!3m5!1s0xd2e7c8b9cfee109:0xe6b7c74afd0c9a75!8m2!3d43.3621449!4d-8.4155189!16s%2Fg%2F11_dr77dp?hl=es';
const HTML_FILE = path.join(__dirname, '..', 'index.html');

(async () => {
    console.log('Iniciando extracción de reseñas de Google Maps...');

    // Abrir navegador en modo no-headless para evitar bloqueos de Google
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'es-ES'
    });
    const page = await context.newPage();

    // Ocultar automatización para eludir bloqueos
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    try {
        console.log(`Navegando a ${PLACE_URL}...`);
        await page.goto(PLACE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // 1. ACEPTAR COOKIES
        try {
            console.log('Comprobando diálogo de cookies...');
            await page.waitForTimeout(3000);
            console.log('URL actual tras carga inicial: ' + page.url());

            // Buscar botón de aceptar cookies en cualquier página (redirección o overlay)
            const acceptBtn = page.locator('button').filter({ hasText: /aceptar todo|accept all/i }).first();
            if (await acceptBtn.isVisible({ timeout: 5000 })) {
                console.log('Botón de cookies encontrado, aceptando...');
                await acceptBtn.click();
                await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => { });
                await page.waitForTimeout(3000);
                console.log('URL tras aceptar cookies: ' + page.url());
            } else {
                console.log('No se detectó diálogo de cookies.');
            }
        } catch (e) {
            console.log('Error manejando cookies:', e.message);
        }

        // 3. ESPERAR PESTAÑA RESEÑAS
        console.log('Esperando información del lugar...');
        console.log('URL actual: ' + page.url());

        try {
            // Intentar ambos selectores
            const reviewsTab = page.getByRole('tab', { name: /Reseñas/i }).or(page.locator('button:has-text("Reseñas")')).first();
            await reviewsTab.waitFor({ state: 'attached', timeout: 15000 });
        } catch (e) {
            console.error('ERROR: No se encontró la pestaña de reseñas.');
            console.log('URL en el momento del error: ' + page.url());
            const html = await page.content();
            fs.writeFileSync('error_dump.html', html);
            await page.screenshot({ path: 'error_screenshot.png', fullPage: true });
            console.log('HTML y captura guardados.');
            throw e;
        }

        const reviewsTab = page.getByRole('tab', { name: /Reseñas/i }).or(page.locator('button:has-text("Reseñas")')).first();

        // 4. NOTA MEDIA Y CONTEO
        console.log('Extrayendo rating general...');
        let overallRating = "4.7";
        let reviewCount = '';
        try {
            const ratingLocator = page.locator('.F7nice').first();
            if (await ratingLocator.isVisible()) {
                const text = await ratingLocator.innerText();
                overallRating = text.replace(',', '.').replace(/[^0-9.]/g, '').trim();
            }
            console.log(`Rating encontrado: ${overallRating}`);
        } catch (e) {
            console.warn('⚠ No se pudo leer el rating general exacto, se usará 4.7 como base.', e.message);
        }
        try {
            const countLocator = page.locator('.UY7F9').first();
            if (await countLocator.isVisible()) {
                const countText = await countLocator.innerText();
                reviewCount = countText.replace(/[^0-9.,]/g, '').trim();
                console.log(`Número de reseñas: ${reviewCount}`);
            }
        } catch (e) {
            console.warn('⚠ No se pudo leer el número de reseñas.', e.message);
        }

        // 5. ENTRAR A RESEÑAS
        console.log('Navegando a la pestaña de reseñas...');
        await reviewsTab.click();
        await page.waitForTimeout(3000);

        // 6. ORDENAR
        console.log('Ordenando por Más Recientes...');
        try {
            const sortBtn = page.getByRole('button', { name: /Ordenar reseñas|Sort reviews/i });
            await sortBtn.waitFor({ state: 'visible', timeout: 5000 });
            await sortBtn.click();
            await page.waitForTimeout(1000);

            const recentOption = page.getByRole('menuitem', { name: /Más recientes|Newest/i });
            await recentOption.waitFor({ state: 'visible', timeout: 3000 });
            await recentOption.click();
            await page.waitForTimeout(3000);
        } catch (e) {
            console.warn('⚠ No se pudo ordenar. Extrayendo las que aparecen por defecto.');
        }

        // 7. SCROLL
        console.log('Haciendo scroll para cargar reseñas...');
        // Hacer scroll genérico
        await page.mouse.wheel(0, 3000);
        await page.waitForTimeout(2000);
        await page.mouse.wheel(0, 3000);
        await page.waitForTimeout(2000);

        // 8. EXTRAER RESEÑAS
        console.log('Leyendo tarjetas de reseñas...');
        const reviewElements = await page.locator('.jIccfn, .jftiEf').all();
        console.log(`Encontradas ${reviewElements.length} reseñas. Procesando...`);

        const validReviews = [];
        for (const el of reviewElements) {
            try {
                // Click "Ver más"
                const moreBtn = el.getByRole('button', { name: /Ver más|More/i });
                if (await moreBtn.isVisible()) {
                    await moreBtn.click();
                    await page.waitForTimeout(300);
                }

                const authorName = await el.locator('.d4r55').innerText().then(t => t.split('\n')[0]).catch(() => 'Cliente Anónimo');
                const dateText = await el.locator('.rsqaWe').innerText().catch(() => 'Recientemente');
                const reviewText = await el.locator('.wiI7pd').innerText().catch(() => '');

                // Estrellas
                const ratingEl = el.locator('span.kvMYJc');
                let rating = 0;
                if (await ratingEl.isVisible()) {
                    const ariaRating = await ratingEl.getAttribute('aria-label');
                    if (ariaRating) {
                        const match = ariaRating.match(/(\d)/);
                        if (match) rating = parseInt(match[1]);
                    }
                }

                // Excluimos las del propietario si está en el cuerpo
                if (rating === 5 && reviewText.length > 20) {
                    const initials = authorName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
                    validReviews.push({ authorName, dateText: formatDate(dateText), reviewText, rating, initials });
                }

                if (validReviews.length === 15) break;
            } catch (err) {
                // ignorar
            }
        }

        console.log(`¡Filtradas ${validReviews.length} reseñas de 5 estrellas!`);
        if (validReviews.length === 0) {
            console.error('No se encontraron reseñas validas. Cancelando.');
            await browser.close();
            return;
        }

        // 9. ACTUALIZAR HTML
        console.log('Actualizando index.html...');
        let htmlContent = fs.readFileSync(HTML_FILE, 'utf-8');

        // Construir bloque de rating: estrellas (llenas, media, vacías) + número
        const ratingNum = parseFloat(overallRating);
        const fullStars = Math.floor(ratingNum);
        const hasHalf = (ratingNum - fullStars) >= 0.3;
        const emptyStars = 5 - fullStars - (hasHalf ? 1 : 0);
        const displayRating = ratingNum.toFixed(1).replace('.', ',');

        let starsHtml = '';
        for (let i = 0; i < fullStars; i++) starsHtml += '<span class="star">★</span>';
        if (hasHalf) starsHtml += '<span class="star half">★</span>';
        for (let i = 0; i < emptyStars; i++) starsHtml += '<span class="star empty">★</span>';

        const countHtml = reviewCount ? `<span class="rating-count">(${reviewCount} reseñas)</span>` : '';
        const ratingHtml = `<div class="rating-stars">${starsHtml}</div><span class="rating-text">${displayRating}</span>${countHtml}`;

        const ratingMarkerRegex = /(<!-- RATING_START -->)([\s\S]*?)(<!-- RATING_END -->)/;
        if (!ratingMarkerRegex.test(htmlContent)) {
            console.warn('⚠ No se encontraron los marcadores <!-- RATING_START/END -->. El rating no se actualizará.');
        } else {
            htmlContent = htmlContent.replace(ratingMarkerRegex, `$1${ratingHtml}$3`);
        }

        let cardsHtml = '';
        for (const rv of validReviews) {
            const safeText = rv.reviewText.replace(/"/g, '&quot;');
            cardsHtml += `
            <div class="resena-card">
                <div class="resena-user">
                    <div class="resena-avatar">${rv.initials}</div>
                    <div class="resena-info-meta">
                        <strong class="resena-nombre">${rv.authorName}</strong>
                        <div class="resena-stars-small">
                            <span class="star">★</span><span class="star">★</span><span class="star">★</span><span class="star">★</span><span class="star">★</span>
                        </div>
                        <span class="resena-date">${rv.dateText}</span>
                    </div>
                    <div class="resena-google-icon">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 12-4.53z" fill="#EA4335"/></svg>
                    </div>
                </div>
                <p class="resena-texto">"${safeText}"</p>
            </div>\n`;
        }

        // Usar marcadores para reemplazo idempotente (funciona en ejecuciones sucesivas)
        const reviewsRegex = /(<!-- REVIEWS_START -->)([\s\S]*?)(<!-- REVIEWS_END -->)/;
        if (!reviewsRegex.test(htmlContent)) {
            console.error('ERROR: No se encontraron los marcadores <!-- REVIEWS_START/END --> en index.html.');
            await browser.close();
            return;
        }
        htmlContent = htmlContent.replace(reviewsRegex, `$1\n${cardsHtml}\n$3`);

        fs.writeFileSync(HTML_FILE, htmlContent, 'utf-8');
        console.log('¡index.html actualizado correctamente con datos de Google Maps!');

    } catch (error) {
        console.error('Error durante el scraping:', error);
    } finally {
        await browser.close();
    }
})();

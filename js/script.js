/* ===================================================
   KAFE – JavaScript
   - Cabecera sticky con sombra al scroll
   - Navegación activa por sección visible
   - Scroll suave (nativo via CSS, refuerzo JS para IE)
   - Animaciones de entrada con IntersectionObserver
   - Menú hamburguesa móvil
   - Toggle de idioma ES / GL
   =================================================== */

/* =====================================================
   TRADUCCIONES
   ===================================================== */
document.documentElement.classList.add('js');

// Las traducciones se generan a partir de content.json vía `node build.js`
// (ver build.config.js) y se cargan antes de este script como
// js/translations.generated.js, que define window.translations.
const translations = window.translations;

/* =====================================================
   FUNCIÓN APLICAR IDIOMA
   ===================================================== */
let currentLang = 'es';
let i18nElements = null;
let langOpts = null;

function applyLanguage(lang) {
  currentLang = lang;
  const t = translations[lang];

  if (!i18nElements) i18nElements = document.querySelectorAll('[data-i18n]');
  // Se usa innerHTML (no textContent) porque algunas claves contienen HTML intencional:
  // - 'hero.subtitle': <br /> para salto de línea
  // - 'nosotros.title': <br /> y <em> para énfasis
  // La fuente es el objeto `translations` hardcodeado en este mismo archivo,
  // nunca datos externos, por lo que el riesgo XSS real es cero.
  // IMPORTANTE: si en el futuro las traducciones vienen de una API o localStorage,
  // hay que escapar los valores antes de asignarlos con innerHTML.
  i18nElements.forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (t[key] !== undefined) {
      el.innerHTML = t[key];
    }
  });

  // Mover clase active entre las dos opciones
  if (!langOpts) langOpts = document.querySelectorAll('#lang-toggle .lang-opt');
  langOpts.forEach((opt, i) => {
    opt.classList.toggle('active', (i === 0 && lang === 'es') || (i === 1 && lang === 'gl'));
  });

  document.documentElement.lang = lang === 'gl' ? 'gl' : 'es';
}

/* =====================================================
   DOM READY
   ===================================================== */
document.addEventListener('DOMContentLoaded', () => {

  /* ---------- 0. Animación Intro: taza de café ---------- */
  (function introAnimation() {
    const heroIntro = document.querySelector('.hero-intro');
    const heroContent = document.querySelector('.hero-content');
    const heroImageWrap = document.querySelector('.hero-image-wrap');
    const cup = document.getElementById('intro-cup');
    const brand = document.getElementById('intro-brand');
    const tagline = document.getElementById('intro-tagline');

    if (!cup) return;

    // Saltar animación si ya se mostró (la clase intro-skip en <html> ya oculta el overlay)
    if (sessionStorage.getItem('kafe_intro_shown')) {
      if (heroIntro) heroIntro.style.display = 'none';
      if (heroContent) heroContent.classList.add('show');
      if (heroImageWrap) heroImageWrap.classList.add('show');
      return;
    }

    // 1. Taza aparece centrada en pantalla
    setTimeout(() => { cup.classList.add('visible'); }, 250);

    // 2. Líquido sube
    setTimeout(() => { cup.classList.add('filling'); }, 550);

    // 3. Vapor aparece mientras se llena
    setTimeout(() => { cup.classList.add('steaming'); }, 750);

    // 4. Nombre se desliza desde la izquierda (vapor sigue durante el reveal)
    setTimeout(() => {
      if (brand) brand.classList.add('reveal');
    }, 1700);

    // 5. Tagline aparece mientras el nombre todavía se desliza
    setTimeout(() => {
      if (tagline) tagline.classList.add('reveal');
    }, 2100);

    // 6. Vapor para: estado final [Kafe ☕] estático y limpio
    setTimeout(() => {
      cup.classList.remove('steaming');
    }, 3000);

    // 7. Hero empieza a aparecer (cross-fade)
    setTimeout(() => {
      if (heroContent) heroContent.classList.add('show');
      if (heroImageWrap) heroImageWrap.classList.add('show');
    }, 3700);

    // 8. Intro overlay desaparece
    setTimeout(() => {
      if (heroIntro) heroIntro.classList.add('fade-out');
      sessionStorage.setItem('kafe_intro_shown', '1');
    }, 3900);
  })();

  /* ---------- Referencias ---------- */
  const cabecera = document.getElementById('cabecera');
  const navLinks = document.querySelectorAll('.nav-link');
  const sections = document.querySelectorAll('section[id]');
  const hamburger = document.getElementById('hamburger');
  const navList = document.querySelector('.nav-list');
  const langToggle = document.getElementById('lang-toggle');

  /* ---------- 1. Sombra de cabecera al scroll ---------- */
  const onScroll = () => {
    if (window.scrollY > 20) {
      cabecera.classList.add('scrolled');
    } else {
      cabecera.classList.remove('scrolled');
    }

    // Barra de progreso de scroll
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const progress = docHeight > 0 ? Math.round((window.scrollY / docHeight) * 100) : 0;
    cabecera.style.setProperty('--scroll-progress', progress + '%');

    updateActiveNav();
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- 2. Navegación activa según sección visible ---------- */
  function updateActiveNav() {
    const scrollY = window.scrollY + 100;

    let currentId = sections[0].id;

    sections.forEach(section => {
      const top = section.offsetTop;
      if (scrollY >= top) {
        currentId = section.id;
      }
    });

    navLinks.forEach(link => {
      link.classList.remove('active');
      if (link.getAttribute('href') === `#${currentId}`) {
        link.classList.add('active');
      }
    });
  }

  /* ---------- 3. Scroll suave al hacer clic en nav ---------- */
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', e => {
      const targetId = anchor.getAttribute('href');
      if (targetId === '#') return;

      const target = document.querySelector(targetId);
      if (!target) return;

      e.preventDefault();

      navList.classList.remove('open');
      hamburger.setAttribute('aria-expanded', 'false');
      hamburgerSpans.forEach(s => { s.style.transform = ''; s.style.opacity = ''; });

      const offset = cabecera.offsetHeight;
      const top = target.getBoundingClientRect().top + window.scrollY - offset;

      window.scrollTo({ top, behavior: 'smooth' });
    });
  });

  /* ---------- 4. Menú hamburguesa móvil ---------- */
  const hamburgerSpans = hamburger.querySelectorAll('span');

  hamburger.addEventListener('click', () => {
    const isOpen = navList.classList.toggle('open');
    hamburger.setAttribute('aria-expanded', String(isOpen));

    if (isOpen) {
      hamburgerSpans[0].style.transform = 'rotate(45deg) translate(5px, 5px)';
      hamburgerSpans[1].style.opacity = '0';
      hamburgerSpans[2].style.transform = 'rotate(-45deg) translate(5px, -5px)';
    } else {
      hamburgerSpans[0].style.transform = '';
      hamburgerSpans[1].style.opacity = '';
      hamburgerSpans[2].style.transform = '';
    }
  });

  document.addEventListener('click', e => {
    if (navList.classList.contains('open') &&
      !navList.contains(e.target) &&
      !hamburger.contains(e.target)) {
      navList.classList.remove('open');
      hamburger.setAttribute('aria-expanded', 'false');
      hamburgerSpans.forEach(s => {
        s.style.transform = '';
        s.style.opacity = '';
      });
    }
  });

  /* ---------- 5. Toggle de idioma ---------- */
  langToggle.addEventListener('click', () => {
    const newLang = currentLang === 'es' ? 'gl' : 'es';
    applyLanguage(newLang);
    if (typeof gtag !== 'undefined') gtag('event', 'language_change', { language: newLang });
  });

  /* ---------- 6. Animaciones de entrada fade-up ---------- */
  const fadeElements = document.querySelectorAll(
    '.nosotros-img-wrap, .nosotros-content, ' +
    '.carta-block, .info-card, ' +
    '.carta-header, .info-header, ' +
    '.resenas-header, .resenas-cta, ' +
    '.medios-header'
  );

  fadeElements.forEach(el => el.classList.add('fade-up'));

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.12,
      rootMargin: '0px 0px -60px 0px'
    });

    fadeElements.forEach(el => observer.observe(el));
  } else {
    fadeElements.forEach(el => el.classList.add('visible'));
  }

  // Asignar transition-delay a precios según índice real de .menu-item
  document.querySelectorAll('.carta-block').forEach(block => {
    block.querySelectorAll('.menu-item').forEach((item, i) => {
      const price = item.querySelector('.menu-item-price');
      if (price) price.style.transitionDelay = (0.3 + i * 0.15) + 's';
    });
  });

  /* ---------- 7. Delay escalonado en info-cards ---------- */
  document.querySelectorAll('.info-card').forEach((card, i) => {
    card.style.transitionDelay = `${i * 0.12}s`;
  });


  /* ---------- 8a. Parallax sutil en hero ---------- */
  const heroBg = document.querySelector('.hero-bg');
  if (heroBg) {
    window.addEventListener('scroll', () => {
      const scrollY = window.scrollY;
      if (scrollY < window.innerHeight) {
        heroBg.style.transform = `translateY(${scrollY * 0.3}px)`;
      }
    }, { passive: true });
  }

  /* ---------- 8b. Counter animado en badge ---------- */
  const badgeNum = document.querySelector('.badge-num');
  if (badgeNum && 'IntersectionObserver' in window) {
    const targetNum = parseInt(badgeNum.textContent.replace('+', ''), 10);
    let counted = false;

    const counterObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !counted) {
          counted = true;
          counterObserver.unobserve(entry.target);
          animateCounter(badgeNum, targetNum);
        }
      });
    }, { threshold: 0.5 });

    counterObserver.observe(badgeNum);

    function animateCounter(el, target) {
      el.classList.add('counting');
      let current = 0;
      const duration = 1200;
      const stepTime = duration / target;

      const timer = setInterval(() => {
        current++;
        el.textContent = '+' + current;
        if (current >= target) {
          clearInterval(timer);
          el.classList.remove('counting');
        }
      }, stepTime);
    }
  }

  // Inicializar idioma
  applyLanguage(currentLang);

  /* ---------- Analytics: clicks en enlaces clave ---------- */
  if (typeof gtag !== 'undefined') {
    const trackLinks = (selector, eventName) => {
      document.querySelectorAll(selector).forEach(el => {
        el.addEventListener('click', () => gtag('event', eventName));
      });
    };
    trackLinks('a[href^="tel:"]', 'click_phone');
    trackLinks('a[href^="mailto:"]', 'click_email');
    trackLinks('a[href*="instagram.com"]', 'click_instagram');
    trackLinks('a[href*="maps.google.com"]', 'click_maps');
    trackLinks('a[href*="menu-printable"]', 'view_full_menu');
  }

  /* ---------- 8. Carrusel infinito (reseñas + medios) ---------- */
  /**
   * Convierte un track de tarjetas en un carrusel infinito con auto-scroll y
   * arrastre. Las tarjetas son HTML estático generado por build.js (medios) o
   * por scripts/scrape-reviews.js (reseñas): aquí solo se clonan para el bucle.
   *
   * Opciones:
   *   sets              nº de copias del set de tarjetas (ancho del bucle)
   *   speed             px por frame del auto-scroll (~60fps)
   *   pauseOnHover      pausa al pasar el ratón o al enfocar con teclado
   *   clickable         suprime el click si el puntero se ha movido (arrastre)
   *   respectReducedMotion  sin animación si el usuario la ha desactivado
   */
  function initMarquee(track, options) {
    if (!track) return;
    const opts = Object.assign(
      { sets: 4, speed: 0.5, pauseOnHover: false, clickable: false, respectReducedMotion: false },
      options
    );

    const originalCards = Array.from(track.children);
    if (originalCards.length === 0) return;

    const container = track.parentElement;

    // Sin animación: se deja el set original y se permite scroll manual.
    if (opts.respectReducedMotion &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      container.classList.add('static');
      return;
    }

    const SETS = opts.sets;
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < SETS; i++) {
      originalCards.forEach(card => {
        const clone = card.cloneNode(true);
        // Solo el primer set es navegable: los demás son duplicados visuales,
        // así los enlaces no aparecen N veces en el orden de tabulación.
        if (i > 0) {
          clone.setAttribute('aria-hidden', 'true');
          const links = clone.matches('a') ? [clone] : Array.from(clone.querySelectorAll('a'));
          links.forEach(link => link.setAttribute('tabindex', '-1'));
        }
        fragment.appendChild(clone);
      });
    }
    track.innerHTML = '';
    track.appendChild(fragment);

    // Reemplazar animación CSS con scroll controlado por JS
    track.style.animation = 'none';
    track.style.willChange = 'transform';

    const AUTO_SPEED = opts.speed; // px por frame (~30px/s a 60fps con 0.5)
    let pos = 0;
    let velocity = 0;
    let isDragging = false;
    let isPaused = false;
    let dragStartX = 0;
    let posOnDragStart = 0;
    let lastDragX = 0;
    let dragDistance = 0;

    function getLoopWidth() {
      return track.scrollWidth / SETS;
    }

    function wrap(p) {
      const lw = getLoopWidth();
      return ((p % lw) + lw) % lw;
    }

    function tick() {
      if (!isDragging && !isPaused) {
        velocity *= 0.92;
        if (Math.abs(velocity) < 0.01) velocity = 0;
        pos += AUTO_SPEED + velocity;
      }
      pos = wrap(pos);
      track.style.transform = `translateX(${-pos}px)`;
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    container.style.cursor = 'grab';

    function onDragStart(clientX) {
      isDragging = true;
      dragStartX = clientX;
      posOnDragStart = pos;
      lastDragX = clientX;
      dragDistance = 0;
      velocity = 0;
      container.style.cursor = 'grabbing';
    }

    function onDragMove(clientX) {
      velocity = lastDragX - clientX;
      lastDragX = clientX;
      dragDistance = Math.abs(clientX - dragStartX);
      pos = wrap(posOnDragStart + (dragStartX - clientX));
    }

    function onDragEnd() {
      isDragging = false;
      container.style.cursor = 'grab';
    }

    // Mouse
    container.addEventListener('mousedown', e => { onDragStart(e.clientX); e.preventDefault(); });
    document.addEventListener('mousemove', e => { if (isDragging) onDragMove(e.clientX); });
    document.addEventListener('mouseup', onDragEnd);

    // Touch (móvil). El gesto se clasifica antes de actuar: si es vertical, se
    // suelta el carrusel y el dedo scrollea la página como siempre. Sin esto,
    // el handler intentaba cancelar scrolls verticales ya iniciados y Chrome
    // los descartaba avisando ("Ignored attempt to cancel a touchmove event").
    const TOUCH_AXIS_THRESHOLD = 8; // px antes de decidir la dirección
    let touchAxis = null;           // 'x' | 'y' | null (sin decidir)
    let touchStartY = 0;

    container.addEventListener('touchstart', e => {
      touchAxis = null;
      touchStartY = e.touches[0].clientY;
      onDragStart(e.touches[0].clientX);
    }, { passive: true });

    container.addEventListener('touchmove', e => {
      if (!isDragging) return;
      const touch = e.touches[0];
      if (touchAxis === null) {
        const dx = Math.abs(touch.clientX - dragStartX);
        const dy = Math.abs(touch.clientY - touchStartY);
        if (dx < TOUCH_AXIS_THRESHOLD && dy < TOUCH_AXIS_THRESHOLD) return;
        touchAxis = dx > dy ? 'x' : 'y';
        if (touchAxis === 'y') {
          onDragEnd(); // scroll vertical: el carrusel se aparta
          return;
        }
      }
      onDragMove(touch.clientX);
      // cancelable=false cuando el scroll ya está en marcha: no se toca.
      if (e.cancelable) e.preventDefault();
    }, { passive: false });

    container.addEventListener('touchend', onDragEnd);

    if (opts.pauseOnHover) {
      const pause = () => { isPaused = true; };
      const resume = () => { isPaused = false; };
      container.addEventListener('mouseenter', pause);
      container.addEventListener('mouseleave', resume);
      container.addEventListener('focusin', pause);
      container.addEventListener('focusout', resume);
    }

    if (opts.clickable) {
      // Con tarjetas-enlace, arrastrar el carrusel terminaría abriendo el
      // enlace al soltar. Si el puntero se ha movido más que el umbral, se
      // trata como arrastre y se cancela el click.
      const DRAG_THRESHOLD = 5; // px
      container.addEventListener('click', e => {
        if (dragDistance > DRAG_THRESHOLD) {
          e.preventDefault();
          e.stopPropagation();
        }
      }, true);
    }
  }

  // Reseñas: comportamiento original (tarjetas no clicables, sin pausa).
  initMarquee(document.getElementById('resenas-track'));

  // Medios: tarjetas-enlace → umbral de arrastre, pausa al hover/foco y
  // respeto por prefers-reduced-motion.
  initMarquee(document.getElementById('medios-track'), {
    speed: 0.4,
    pauseOnHover: true,
    clickable: true,
    respectReducedMotion: true,
  });

  /* ---------- 8. Modal de Reserva ---------- */
  (function reservaModal() {
    const modal = document.getElementById('modal-reserva');
    const form = document.getElementById('reserva-form');
    const closeBtn = document.getElementById('modal-close');
    const fechaInput = document.getElementById('reserva-fecha');
    const horaHidden = document.getElementById('reserva-hora');
    const horaSelect = document.getElementById('hora-select');
    const horaTrigger = document.getElementById('hora-trigger');
    const horaLabel = document.getElementById('hora-label');
    const horaDropdown = document.getElementById('hora-dropdown');
    const notaPersonalizado = document.getElementById('nota-personalizado');
    const radios = document.querySelectorAll('input[name="tipo-comida"]');

    if (!modal || !form) return;

    // Función de reserva apuntando al Cloudflare Worker
    const API_URL = 'https://your-worker.your-account.workers.dev';

    const confirmacion = document.getElementById('reserva-confirmacion');
    const btnCerrarConfirmacion = document.getElementById('btn-cerrar-confirmacion');
    var enConfirmacion = false;

    // Abrir modal
    document.querySelectorAll('.btn-abrir-reserva').forEach(btn => {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        openModal();
      });
    });

    function generarHoras() {
      const date = new Date(fechaInput.value + 'T00:00:00');
      const day = date.getDay();

      let startHour, startMin, endHour, endMin;

      if (day === 0) {
        startHour = 10; startMin = 0; endHour = 15; endMin = 45;
      } else if (day === 6) {
        startHour = 10; startMin = 0; endHour = 22; endMin = 30;
      } else {
        startHour = 7; startMin = 15; endHour = 22; endMin = 30;
      }

      horaDropdown.innerHTML = '';
      horaHidden.value = '';
      horaLabel.textContent = 'Selecciona hora';
      horaLabel.classList.add('placeholder');

      const now = new Date();
      const isToday = fechaInput.value === now.toISOString().slice(0, 10);
      const nowMinutes = isToday ? now.getHours() * 60 + now.getMinutes() : -1;

      for (let h = startHour; h <= endHour; h++) {
        for (let m = (h === startHour ? startMin : 0); m < 60; m += 30) {
          if (h === endHour && m > endMin) break;
          if (isToday && h * 60 + m <= nowMinutes) continue;
          const hh = String(h).padStart(2, '0');
          const mm = String(m).padStart(2, '0');
          const val = hh + ':' + mm;
          const opt = document.createElement('div');
          opt.className = 'custom-select-option';
          opt.textContent = val;
          opt.dataset.value = val;
          opt.addEventListener('click', function () {
            horaHidden.value = val;
            horaLabel.textContent = val;
            horaLabel.classList.remove('placeholder');
            horaDropdown.querySelectorAll('.custom-select-option').forEach(function (o) { o.classList.remove('selected'); });
            opt.classList.add('selected');
            horaSelect.classList.remove('open');
            horaSelect.classList.remove('error');
          });
          horaDropdown.appendChild(opt);
        }
      }
    }

    // Toggle dropdown
    horaTrigger.addEventListener('click', function () {
      horaSelect.classList.toggle('open');
    });

    // Cerrar al hacer click fuera
    document.addEventListener('click', function (e) {
      if (!horaSelect.contains(e.target)) {
        horaSelect.classList.remove('open');
      }
    });

    function openModal() {
      modal.classList.add('active');
      modal.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      if (typeof gtag !== 'undefined') gtag('event', 'reservation_open');
      // Fecha mínima = hoy, pre-seleccionar hoy
      const today = new Date().toISOString().split('T')[0];
      fechaInput.min = today;
      fechaInput.value = today;
      generarHoras();
    }

    function closeModal() {
      modal.classList.remove('active');
      modal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      horaSelect.classList.remove('open');
    }

    // Cerrar con botón X (solo si no estamos en confirmación)
    closeBtn.addEventListener('click', function () {
      if (enConfirmacion) {
        if (!document.getElementById('check-entendido').checked) flashAviso();
      } else {
        closeModal();
      }
    });

    const avisoEl = document.querySelector('.confirmacion-aviso');
    function flashAviso() {
      avisoEl.classList.remove('flash');
      void avisoEl.offsetWidth; // reinicia la animación si ya está activa
      avisoEl.classList.add('flash');
      avisoEl.addEventListener('animationend', () => avisoEl.classList.remove('flash'), { once: true });
    }

    // Cerrar con click fuera (solo si no estamos en confirmación)
    modal.addEventListener('click', function (e) {
      if (e.target !== modal) return;
      if (enConfirmacion) {
        if (!document.getElementById('check-entendido').checked) flashAviso();
      } else {
        closeModal();
      }
    });

    // Cerrar con Escape (solo si no estamos en confirmación)
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !modal.classList.contains('active')) return;
      if (enConfirmacion) {
        if (!document.getElementById('check-entendido').checked) flashAviso();
      } else {
        closeModal();
      }
    });

    // Regenerar horarios al cambiar fecha
    fechaInput.addEventListener('change', generarHoras);

    // Validación teléfono en tiempo real
    const telefonoInput = document.getElementById('reserva-telefono');
    telefonoInput.addEventListener('input', function () {
      // Solo dígitos
      const limpio = this.value.replace(/\D/g, '').slice(0, 9);
      // Formatear 3-2-2-2
      let formateado = '';
      if (limpio.length > 0) formateado = limpio.slice(0, 3);
      if (limpio.length > 3) formateado += ' ' + limpio.slice(3, 5);
      if (limpio.length > 5) formateado += ' ' + limpio.slice(5, 7);
      if (limpio.length > 7) formateado += ' ' + limpio.slice(7, 9);
      this.value = formateado;
      // Validar
      if (limpio.length === 0 || (limpio.length === 9 && /^[679]/.test(limpio))) {
        this.classList.remove('invalid');
      } else {
        this.classList.add('invalid');
      }
    });

    // Mostrar/ocultar nota de menú personalizado
    radios.forEach(radio => {
      radio.addEventListener('change', function () {
        notaPersonalizado.hidden = this.value !== 'personalizado';
      });
    });

    // Enviar formulario -> EmailJS
    const btnEnviar = document.getElementById('btn-enviar-reserva');

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      // Validar teléfono español
      const telLimpio = telefonoInput.value.replace(/\s+/g, '');
      if (!/^[679]\d{8}$/.test(telLimpio)) {
        telefonoInput.classList.add('invalid');
        telefonoInput.focus();
        return;
      }

      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      const nombre = document.getElementById('reserva-nombre').value.trim();
      const telefono = document.getElementById('reserva-telefono').value.trim();
      const fecha = fechaInput.value;
      const hora = horaHidden.value;

      if (!hora) {
        horaSelect.classList.add('error');
        horaTrigger.focus();
        return;
      }
      horaSelect.classList.remove('error');
      const personas = document.getElementById('reserva-personas').value;
      const tipo = document.querySelector('input[name="tipo-comida"]:checked').value;

      // Formatear fecha a DD-MM-YYYY
      const [y, m, d] = fecha.split('-');
      const fechaFormateada = d + '-' + m + '-' + y;

      const tipoTexto = tipo === 'karta' ? 'De Karta' : 'Menú personalizado';

      // Deshabilitar botón mientras envía
      btnEnviar.disabled = true;
      btnEnviar.textContent = 'Enviando...';

      fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          nombre: nombre,
          telefono: telefono,
          fecha: fechaFormateada,
          hora: hora,
          personas: personas,
          tipo: tipoTexto
        })
      })
        .then(response => {
          if (!response.ok) throw new Error('Error en el envío');
          return response.json();
        })
        .then(data => {
          if (typeof gtag !== 'undefined') {
            gtag('event', 'reservation_submit', {
              personas: document.getElementById('reserva-personas').value,
              tipo: document.querySelector('input[name="tipo-comida"]:checked').value
            });
          }
          // Limpiar error si lo había y mostrar confirmación
          const errEl = document.getElementById('reserva-error');
          if (errEl) errEl.hidden = true;
          form.hidden = true;
          confirmacion.hidden = false;
          enConfirmacion = true;
          closeBtn.style.display = 'none';
          form.reset();
          notaPersonalizado.hidden = true;
          btnEnviar.disabled = false;
          btnEnviar.textContent = 'Enviar Reserva →';
        })
        .catch(error => {
          console.error("Error reserva:", error);
          btnEnviar.disabled = false;
          btnEnviar.textContent = 'Enviar Reserva →';
          const errEl = document.getElementById('reserva-error');
          if (errEl) {
            errEl.textContent = 'Error al enviar. Inténtalo de nuevo o llama al 981 31 82 60.';
            errEl.hidden = false;
          }
        });
    });

    // Checkbox habilita botón de cerrar
    document.getElementById('check-entendido').addEventListener('change', function () {
      btnCerrarConfirmacion.classList.toggle('btn-inactive', !this.checked);
    });

    // Cerrar confirmación
    btnCerrarConfirmacion.addEventListener('click', function () {
      if (!document.getElementById('check-entendido').checked) {
        flashAviso();
        return;
      }
      enConfirmacion = false;
      closeBtn.style.display = '';
      closeModal();
      // Resetear para próxima apertura
      setTimeout(function () {
        form.hidden = false;
        confirmacion.hidden = true;
        document.getElementById('check-entendido').checked = false;
        btnCerrarConfirmacion.classList.add('btn-inactive');
      }, 300);
    });
  })();

});

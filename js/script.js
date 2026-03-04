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
const translations = {
  es: {
    'nav.inicio': 'Inicio',
    'nav.nosotros': 'Nosotros',
    'nav.carta': 'Karta',
    'nav.resenas': 'Reseñas',
    'nav.contacto': 'Kontacto',
    'nav.verCarta': 'Ver Karta →',
    'nav.reservar': 'Reservar',

    'hero.subtitle': 'Vive la esencia de la kocina gallega en un ambiente perfecto.<br />El mejor Kafé y las recetas de toda la vida.',
    'hero.cta.carta': 'Ver Karta →',
    'hero.cta.historia': 'Nuestra Historia',

    'nosotros.badge': 'experiencia kombinada',
    'nosotros.tag': '♥ Quiénes somos',
    'nosotros.title': 'Sumérgete en una<br /><em>experiencia gallega.</em>',
    'nosotros.feat1.title': 'Producto Gallego',
    'nosotros.feat1.desc': 'Trabajamos con productores gallegos y del entorno para garantizar la máxima freskura y kalidad en cada plato.',
    'nosotros.feat2.title': 'La Visión del Chef',
    'nosotros.feat2.desc': 'Kafé apuesta por la riqueza del kafé y la tierra gallega, con elaboraciones honestas y llenas de sabor.',
    'nosotros.cta.carta': 'Ver la Karta',

    'carta.tag': '♥ Nuestra Karta',
    'carta.title': 'Platos Estrella',
    'carta.desc': 'Nuestra selección más querida de la karta tradicional.',
    'carta.cat1.label': '♥ TAPAS Y ENTRANTES',
    'carta.cat1.title': 'Nuestras Tapas',
    'carta.more': '... y muchos más',
    'carta.cat2.label': '♥ NUESTROS DESAYUNOS',
    'carta.cat2.title': 'Empezar Bien el Día',
    'menu.tosta.title': 'Tosta de Aguacate',
    'menu.tosta.desc': 'Pan artesano, aguacate, huevo poché y semillas',
    'menu.churros.title': 'Churros con Chocolate',
    'menu.churros.desc': 'Churros kaseros krujientes con chocolate kaliente',
    'menu.bolleria.title': 'Bollería del Día',
    'menu.bolleria.desc': 'Croissants, napolitanas y bizcochos kaseros',
    'menu.yogur.title': 'Yogur con Granola',
    'menu.yogur.desc': 'Yogur griego, miel, fruta fresca y granola kasera',
    'carta.footer.text': '¿Quieres ver la karta kompleta?',
    'carta.footer.pdf': 'Ver Karta Kompleta',
    'carta.footer.cta': 'Reserva una Mesa',

    'info.tag': '♥ Encuéntranos',
    'info.title': 'Ven a Visitarnos',
    'info.lead': 'Estamos en el centro de A Coruña, esperándote con una mesa y un kafé.',
    'info.card1.title': 'Horario',
    'info.card1.note': 'Las kocinas cierran 30 min antes del cierre.',
    'info.horario.lv': 'Lun – Vie',
    'info.horario.sab': 'Sábado',
    'info.horario.dom': 'Domingo',
    'info.card2.title': 'Kontacto',
    'info.card2.cta': 'Escríbenos',
    'info.card3.title': 'Cómo Llegar',
    'info.card3.text': 'Estamos en el centro de A Coruña. Varias líneas de bus paran cerca y hay parking disponible en los alrededores.',
    'info.card3.map': 'Ver en Google Maps ↗',

    'footer.tagline': 'Celebrando el alma kulinaria de Galicia a través de la honestidad, el producto y la maestría.',
    'footer.nav.title': 'Navegación',
    'footer.hours.lv': 'Lun – Vie: 7:15 – 23:00',
    'footer.hours.sab': 'Sáb: 10:00 – 23:00',
    'footer.hours.dom': 'Dom: 10:00 – 16:15',

    'reserva.tag': '♥ Reserva',
    'reserva.title': 'Reserva tu Mesa',
    'reserva.nombre': 'Nombre',
    'reserva.telefono': 'Teléfono',
    'reserva.fecha': 'Fecha',
    'reserva.hora': 'Hora',
    'reserva.horaPlaceholder': 'Selecciona hora',
    'reserva.personas': 'Personas',
    'reserva.tipo': 'Tipo de komida',
    'reserva.tipoCarta': 'De Karta',
    'reserva.tipoPersonalizado': 'Menú personalizado',
    'reserva.notaPersonalizado': 'Para konkretar los detalles del menú personalizado, kontacta kon nosotros por teléfono al <a href="tel:+34981318260">981 31 82 60</a>.',
    'reserva.enviar': 'Enviar Reserva →',
    'reserva.alt': 'Si lo prefieres, también puedes reservar llamando al <a href="tel:+34981318260">981 31 82 60</a>',
    'reserva.confirmacion.titulo': 'Solicitud recibida',
    'reserva.confirmacion.texto': 'Te llamaremos lo antes posible para konfirmar tu reserva.',
    'reserva.confirmacion.aviso': 'Entiendo que esto es una solicitud de reserva, no una konfirmación. Mi reserva será konfirmada cuando el restaurante me kontacte.',
    'reserva.confirmacion.cerrar': 'Entendido',

    'resenas.tag': '♥ Lo Que Dicen de Nosotros',
    'resenas.title': 'Nuestros Klientes Hablan',
    'resenas.desc': 'Reseñas reales de Google Maps. ¡Gracias a todos!',
    'resenas.cta': 'Ver Más en Google Maps ↗',
    'resenas.r1.date': 'Febrero 2026',
    'resenas.r2.date': 'Enero 2026',
    'resenas.r3.date': 'Noviembre 2025',
    'resenas.r4.date': 'Octubre 2025',
    'resenas.r5.date': 'Septiembre 2025',
    'resenas.r6.date': 'Diciembre 2025',
  },
  gl: {
    'nav.inicio': 'Inicio',
    'nav.nosotros': 'Nós',
    'nav.carta': 'Karta',
    'nav.resenas': 'Reseñas',
    'nav.contacto': 'Kontacto',
    'nav.verCarta': 'Ver Karta →',
    'nav.reservar': 'Reservar',

    'hero.subtitle': 'Vive a esencia da kociña galega nun ambiente perfecto.<br />O mellor Kafé e as receitas de toda a vida.',
    'hero.cta.carta': 'Ver Karta →',
    'hero.cta.historia': 'A Nosa Historia',

    'nosotros.badge': 'experiencia kombinada',
    'nosotros.tag': '♥ Quen somos',
    'nosotros.title': 'Mergúllate nunha<br /><em>experiencia galega.</em>',
    'nosotros.feat1.title': 'Produto Galego',
    'nosotros.feat1.desc': 'Traballamos con produtores galegos e do entorno para garantir a máxima frescura e kalidade en cada prato.',
    'nosotros.feat2.title': 'A Visión do Chef',
    'nosotros.feat2.desc': 'Kafé aposta pola riqueza do kafé e da terra galega, con elaboracións honestas e cheas de sabor.',
    'nosotros.cta.carta': 'Ver a Karta',

    'carta.tag': '♥ A Nosa Karta',
    'carta.title': 'Pratos Estrela',
    'carta.desc': 'A nosa selección máis querida da karta tradicional.',
    'carta.cat1.label': '♥ TAPAS E ENTRANTES',
    'carta.cat1.title': 'As Nosas Tapas',
    'carta.more': '... e moitos máis',
    'carta.cat2.label': '♥ OS NOSOS ALMORZOS',
    'carta.cat2.title': 'Comezar Ben o Día',
    'menu.tosta.title': 'Tosta de Aguacate',
    'menu.tosta.desc': 'Pan artesán, aguacate, ovo poché e sementes',
    'menu.churros.title': 'Churros con Chocolate',
    'menu.churros.desc': 'Churros caseiros krokantes con chocolate quente',
    'menu.bolleria.title': 'Bolaría do Día',
    'menu.bolleria.desc': 'Croissants, napolitanas e biscoitos kaseiros',
    'menu.yogur.title': 'Iogur con Granola',
    'menu.yogur.desc': 'Iogur grego, mel, froita fresca e granola kaseira',
    'carta.footer.text': 'Queres ver a karta completa?',
    'carta.footer.pdf': 'Ver Karta Kompleta',
    'carta.footer.cta': 'Reserva unha Mesa',

    'info.tag': '♥ Atópanos',
    'info.title': 'Visítanos',
    'info.lead': 'Estamos no centro de A Coruña, agardándote cunha mesa e un kafé.',
    'info.card1.title': 'Horario',
    'info.card1.note': 'As kociñas pechan 30 min antes do peche.',
    'info.horario.lv': 'Lun – Ven',
    'info.horario.sab': 'Sábado',
    'info.horario.dom': 'Domingo',
    'info.card2.title': 'Contacto',
    'info.card2.cta': 'Escríbenos',
    'info.card3.title': 'Como Chegar',
    'info.card3.text': 'Estamos no centro de A Coruña. Varias liñas de bus paran preto e hai parking dispoñible nos arredores.',
    'info.card3.map': 'Ver en Google Maps ↗',

    'footer.tagline': 'Celebrando a alma kulinaria de Galicia a través da honestidade, o produto e a maestría.',
    'footer.nav.title': 'Navegación',
    'footer.hours.lv': 'Lun – Ven: 7:15 – 23:00',
    'footer.hours.sab': 'Sáb: 10:00 – 23:00',
    'footer.hours.dom': 'Dom: 10:00 – 16:15',

    'reserva.tag': '♥ Reserva',
    'reserva.title': 'Reserva a túa Mesa',
    'reserva.nombre': 'Nome',
    'reserva.telefono': 'Teléfono',
    'reserva.fecha': 'Data',
    'reserva.hora': 'Hora',
    'reserva.horaPlaceholder': 'Selecciona hora',
    'reserva.personas': 'Persoas',
    'reserva.tipo': 'Tipo de komida',
    'reserva.tipoCarta': 'De Karta',
    'reserva.tipoPersonalizado': 'Menú personalizado',
    'reserva.notaPersonalizado': 'Para konkretar os detalles do menú personalizado, kontacta con nós por teléfono ao <a href="tel:+34981318260">981 31 82 60</a>.',
    'reserva.enviar': 'Enviar Reserva →',
    'reserva.alt': 'Se o prefires, tamén podes reservar chamando ao <a href="tel:+34981318260">981 31 82 60</a>',
    'reserva.confirmacion.titulo': 'Solicitude recibida',
    'reserva.confirmacion.texto': 'Chamarémoste o antes posible para konfirmar a túa reserva.',
    'reserva.confirmacion.aviso': 'Entendo que isto é unha solicitude de reserva, non unha konfirmación. A miña reserva será konfirmada cando o restaurante me kontacte.',
    'reserva.confirmacion.cerrar': 'Entendido',

    'resenas.tag': '♥ O Que Din de Nós',
    'resenas.title': 'Os Nosos Klientes Falan',
    'resenas.desc': 'Recensións reais de Google Maps. Grazas a todos!',
    'resenas.cta': 'Ver Máis en Google Maps ↗',
    'resenas.r1.date': 'Febreiro 2026',
    'resenas.r2.date': 'Xaneiro 2026',
    'resenas.r3.date': 'Novembro 2025',
    'resenas.r4.date': 'Outubro 2025',
    'resenas.r5.date': 'Setembro 2025',
    'resenas.r6.date': 'Decembro 2025',
  }
};

/* =====================================================
   FUNCIÓN APLICAR IDIOMA
   ===================================================== */
let currentLang = 'es';

function applyLanguage(lang) {
  currentLang = lang;
  const t = translations[lang];

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (t[key] !== undefined) {
      el.innerHTML = t[key];
    }
  });

  // Mover clase active entre las dos opciones
  const opts = document.querySelectorAll('#lang-toggle .lang-opt');
  opts.forEach((opt, i) => {
    opt.classList.toggle('active', (i === 0 && lang === 'es') || (i === 1 && lang === 'gl'));
  });

  document.documentElement.lang = lang === 'gl' ? 'gl' : 'es';
}

/* =====================================================
   DOM READY
   ===================================================== */
document.addEventListener('DOMContentLoaded', () => {

  /* ---------- 0. Animación Intro: ciclo de fuentes en la K ---------- */
  (function introAnimation() {
    const kEl = document.getElementById('intro-k');
    const introLogo = document.querySelector('.intro-logo');
    const textWrap = document.querySelector('.intro-text-wrap');
    const heroIntro = document.querySelector('.hero-intro');
    const heroContent = document.querySelector('.hero-content');
    const heroImageWrap = document.querySelector('.hero-image-wrap');

    if (!kEl) return;

    const fonts = [
      { family: "'Bebas Neue', sans-serif", weight: 400 },
      { family: "'Lobster', cursive", weight: 400 },
      { family: "'Permanent Marker', cursive", weight: 400 },
      { family: "'Abril Fatface', serif", weight: 400 },
      { family: "'Dancing Script', cursive", weight: 700 },
      { family: "'Russo One', sans-serif", weight: 400 },
      { family: "'Righteous', sans-serif", weight: 400 },
      { family: "'Pacifico', cursive", weight: 400 },
      { family: "Georgia, serif", weight: 700 },
      { family: "Impact, sans-serif", weight: 400 },
      { family: "'Courier New', monospace", weight: 700 },
      { family: "'Playfair Display', Georgia, serif", weight: 700 },
    ];

    const finalFont = fonts[fonts.length - 1];
    let cycleIndex = 0;
    let cycleSpeed = 100;
    const totalCycles = 18;
    let cycleCount = 0;

    // Mostrar la K con la primera fuente
    setTimeout(() => {
      kEl.style.fontFamily = fonts[0].family;
      kEl.style.fontWeight = fonts[0].weight;
      kEl.classList.add('visible');
    }, 200);

    // Empezar a ciclar fuentes
    setTimeout(() => {
      function cycle() {
        cycleCount++;
        cycleIndex = (cycleIndex + 1) % (fonts.length - 1); // No incluir la final en el ciclo
        const font = fonts[cycleIndex];

        kEl.style.fontFamily = font.family;
        kEl.style.fontWeight = font.weight;
        kEl.classList.remove('switching');
        void kEl.offsetWidth; // Force reflow
        kEl.classList.add('switching');

        if (cycleCount >= totalCycles) {
          // Fijar fuente definitiva
          setTimeout(() => {
            kEl.style.fontFamily = finalFont.family;
            kEl.style.fontWeight = finalFont.weight;
            kEl.classList.remove('switching');
            kEl.classList.add('locked');

            // Revelar "afé" y deslizar
            setTimeout(() => {
              textWrap.classList.add('reveal');
              introLogo.classList.add('slide');

              // Hacer fadeout del intro y mostrar hero
              setTimeout(() => {
                heroIntro.classList.add('fade-out');
                if (heroContent) heroContent.classList.add('show');
                if (heroImageWrap) heroImageWrap.classList.add('show');
              }, 1200);
            }, 400);
          }, 150);
          return;
        }

        // Desacelerar progresivamente
        if (cycleCount > totalCycles * 0.6) {
          cycleSpeed += 30;
        }

        setTimeout(cycle, cycleSpeed);
      }

      cycle();
    }, 600);
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

      const offset = cabecera.offsetHeight;
      const top = target.getBoundingClientRect().top + window.scrollY - offset;

      window.scrollTo({ top, behavior: 'smooth' });
    });
  });

  /* ---------- 4. Menú hamburguesa móvil ---------- */
  hamburger.addEventListener('click', () => {
    const isOpen = navList.classList.toggle('open');
    hamburger.setAttribute('aria-expanded', String(isOpen));

    const spans = hamburger.querySelectorAll('span');
    if (isOpen) {
      spans[0].style.transform = 'rotate(45deg) translate(5px, 5px)';
      spans[1].style.opacity = '0';
      spans[2].style.transform = 'rotate(-45deg) translate(5px, -5px)';
    } else {
      spans[0].style.transform = '';
      spans[1].style.opacity = '';
      spans[2].style.transform = '';
    }
  });

  document.addEventListener('click', e => {
    if (navList.classList.contains('open') &&
      !navList.contains(e.target) &&
      !hamburger.contains(e.target)) {
      navList.classList.remove('open');
      hamburger.setAttribute('aria-expanded', 'false');
      hamburger.querySelectorAll('span').forEach(s => {
        s.style.transform = '';
        s.style.opacity = '';
      });
    }
  });

  /* ---------- 5. Toggle de idioma ---------- */
  langToggle.addEventListener('click', () => {
    applyLanguage(currentLang === 'es' ? 'gl' : 'es');
  });

  /* ---------- 6. Animaciones de entrada fade-up ---------- */
  const fadeElements = document.querySelectorAll(
    '.nosotros-img-wrap, .nosotros-content, ' +
    '.carta-block, .info-card, ' +
    '.carta-header, .info-header, ' +
    '.resenas-header, .resenas-cta'
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

  /* ---------- 8. Carrusel de Reseñas (scroll JS + drag) ---------- */
  (function initReviewsMarquee() {
    const track = document.getElementById('resenas-track');
    if (!track) return;

    // Las tarjetas son HTML estático generado por scripts/scrape-reviews.js
    // Este bloque solo clona las tarjetas existentes para el scroll infinito
    const originalCards = Array.from(track.children);
    if (originalCards.length === 0) return;

    const SETS = 4;
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < SETS; i++) {
      originalCards.forEach(card => fragment.appendChild(card.cloneNode(true)));
    }
    track.innerHTML = '';
    track.appendChild(fragment);

    // Reemplazar animación CSS con scroll controlado por JS
    track.style.animation = 'none';
    track.style.willChange = 'transform';

    const AUTO_SPEED = 0.5; // px por frame (~30px/s a 60fps)
    let pos = 0;
    let velocity = 0;
    let isDragging = false;
    let dragStartX = 0;
    let posOnDragStart = 0;
    let lastDragX = 0;

    function getLoopWidth() {
      return track.scrollWidth / SETS;
    }

    function wrap(p) {
      const lw = getLoopWidth();
      return ((p % lw) + lw) % lw;
    }

    function tick() {
      if (!isDragging) {
        velocity *= 0.92;
        if (Math.abs(velocity) < 0.01) velocity = 0;
        pos += AUTO_SPEED + velocity;
      }
      pos = wrap(pos);
      track.style.transform = `translateX(${-pos}px)`;
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    const container = track.parentElement;
    container.style.cursor = 'grab';

    function onDragStart(clientX) {
      isDragging = true;
      dragStartX = clientX;
      posOnDragStart = pos;
      lastDragX = clientX;
      velocity = 0;
      container.style.cursor = 'grabbing';
    }

    function onDragMove(clientX) {
      velocity = lastDragX - clientX;
      lastDragX = clientX;
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

    // Touch (móvil)
    container.addEventListener('touchstart', e => { onDragStart(e.touches[0].clientX); }, { passive: true });
    container.addEventListener('touchmove', e => {
      if (isDragging) { onDragMove(e.touches[0].clientX); e.preventDefault(); }
    }, { passive: false });
    container.addEventListener('touchend', onDragEnd);
  })();

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
    const API_URL = 'https://kafe-reservas.reservaskafebar.workers.dev';

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

      for (let h = startHour; h <= endHour; h++) {
        for (let m = (h === startHour ? startMin : 0); m < 60; m += 30) {
          if (h === endHour && m > endMin) break;
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
      if (!enConfirmacion) closeModal();
    });

    // Cerrar con click fuera (solo si no estamos en confirmación)
    modal.addEventListener('click', function (e) {
      if (e.target === modal && !enConfirmacion) closeModal();
    });

    // Cerrar con Escape (solo si no estamos en confirmación)
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('active') && !enConfirmacion) closeModal();
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
      if (limpio.length === 0) {
        this.classList.remove('invalid');
      } else if (limpio.length === 9 && /^[679]/.test(limpio)) {
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
          // Mostrar confirmación
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
          alert('Error al enviar. Inténtalo de nuevo o llama al 981 31 82 60.');
        });
    });

    // Checkbox habilita botón de cerrar
    document.getElementById('check-entendido').addEventListener('change', function () {
      btnCerrarConfirmacion.disabled = !this.checked;
    });

    // Cerrar confirmación
    btnCerrarConfirmacion.addEventListener('click', function () {
      enConfirmacion = false;
      closeBtn.style.display = '';
      closeModal();
      // Resetear para próxima apertura
      setTimeout(function () {
        form.hidden = false;
        confirmacion.hidden = true;
        document.getElementById('check-entendido').checked = false;
        btnCerrarConfirmacion.disabled = true;
      }, 300);
    });
  })();

});

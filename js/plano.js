// Plano de mesas de Kafé. Solo dibuja y pinta estados: no sabe de turnos, parejas ni
// límites de personas. Lo usan la página pública y el panel del bar.

const WALLS = '0,1283 0,218 168,0 1077,0 1077,443 658,443 566,554 566,1283';
const WINDOWS = [[26, 179, 152, 22], [0, 320, 0, 440], [0, 595, 0, 714], [0, 819, 0, 998], [0, 1072, 0, 1190], [40, 1283, 380, 1283]];

const TABLES = [
  ['9', 425, 105, 0], ['10', 590, 105, 0], ['11', 760, 105, 0], ['12', 940, 105, 0], ['15', 585, 265, 0], ['14', 760, 265, 0], ['13', 945, 265, 0],
  ['7', 80, 380, 90], ['6', 80, 585, 90], ['5', 80, 795, 90], ['3', 80, 995, 90], ['2', 85, 1185, 90], ['1', 235, 1180, 90],
].map(([label, x, y, rot]) => ({ label, x, y, rot, w: 80, h: 120, seats: 4 }));
TABLES.push({ label: '8', x: 167, y: 168, rot: 126, w: 90, h: 160, seats: 6 });
TABLES.push({ label: '4', x: 245, y: 1000, rot: 90, w: 60, h: 60, seats: 2, high: true });

const STATE_WORDS = {
  free: 'libre',
  selected: 'seleccionada',
  partner: 'libre, se puede juntar con la seleccionada',
  pending: 'pendiente',
  confirmed: 'reservada',
  blocked: 'no disponible',
};

function chairs(t) {
  const long = t.h >= t.w;
  const length = long ? t.h : t.w;
  const across = (long ? t.w : t.h) / 2 + 17;
  const each = t.seats / 2;
  let out = '';
  for (const sign of [-1, 1]) {
    for (let i = 0; i < each; i++) {
      const along = length * ((i + 0.5) / each - 0.5);
      const [x, y] = long ? [sign * across, along] : [along, sign * across];
      out += t.high
        ? `<circle class="seat-box seat" cx="${x}" cy="${y}" r="16"/>`
        : `<g class="seat" transform="translate(${x} ${y}) rotate(${long ? -sign * 90 : sign < 0 ? 180 : 0})"><rect class="seat-box" x="-17" y="-16" width="34" height="33" rx="10"/><path class="seat-back" d="M-18 15 Q0 27 18 15"/></g>`;
    }
  }
  return out;
}

function planks(x, y, vertical) {
  let s = `<rect x="${x}" y="${y}" width="100" height="100" fill="${vertical ? '#1f4469' : '#1a3a5c'}"/>`;
  for (let i = 20; i < 100; i += 20) {
    s += vertical
      ? `<line x1="${x + i}" y1="${y}" x2="${x + i}" y2="${y + 100}" stroke="#16324f" stroke-width="1.5"/>`
      : `<line x1="${x}" y1="${y + i}" x2="${x + 100}" y2="${y + i}" stroke="#16324f" stroke-width="1.5"/>`;
  }
  return s;
}

function gradient(id, from, to) {
  return `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>`;
}

function buildDefs() {
  return `<defs><pattern id="floor" width="200" height="200" patternUnits="userSpaceOnUse">${planks(0, 0, false)}${planks(100, 0, true)}${planks(0, 100, true)}${planks(100, 100, false)}</pattern>${gradient('tabletop', '#ffffff', '#e8ecf2')}${gradient('cushion', '#3b9eff', '#1e6fbf')}${gradient('bartop', '#2f83d6', '#1e6fbf')}<filter id="wood"><feTurbulence type="fractalNoise" baseFrequency="0.015 0.3" numOctaves="3" seed="4" result="n"/><feColorMatrix in="n" values="0 0 0 0 0.12 0 0 0 0 0.44 0 0 0 0 0.75 0 0 0 0.5 -0.15"/><feComposite in2="SourceGraphic" operator="in" result="g"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="g"/></feMerge></filter><clipPath id="room"><polygon points="${WALLS}"/></clipPath></defs>`;
}

function buildRoom() {
  const room = `<polygon class="wall-stone" points="${WALLS}"/><polygon fill="url(#floor)" points="${WALLS}"/><polygon class="wall-band" clip-path="url(#room)" points="${WALLS}"/><polygon class="wall-line" points="${WALLS}"/>`;
  const windows = WINDOWS.map(([a, b, c, d]) => `<line class="glass-frame" x1="${a}" y1="${b}" x2="${c}" y2="${d}"/><line class="glass" x1="${a}" y1="${b}" x2="${c}" y2="${d}"/>`).join('');
  const door = '<line stroke="#4a6080" stroke-width="26" x1="416" y1="1283" x2="498" y2="1283"/><path class="door" d="M416 1283 A82 82 0 0 1 498 1201 L498 1283"/>';
  const bar = '<g transform="translate(-10 -50)" class="shadow"><rect x="510" y="600" width="44" height="440" rx="4" fill="#12293f" stroke="#081626" stroke-width="2"/><path fill="url(#bartop)" stroke="#4a6080" stroke-width="2.5" stroke-linejoin="round" d="M344 563 H488 V603 H384 V925 H476 V1105 H556 V1145 H436 V965 H344 Z"/><text class="tag" font-size="18" x="364" y="764" transform="rotate(-90 364 764)">Barra</text></g>';
  return room + windows + door + bar;
}

function buildTables() {
  return TABLES.map((t) => `<g class="t free" data-label="${t.label}" tabindex="0" role="button"><g class="shadow" transform="translate(${t.x} ${t.y}) rotate(${t.rot})">${chairs(t)}<rect class="top" rx="7" x="${-t.w / 2}" y="${-t.h / 2}" width="${t.w}" height="${t.h}"/></g><circle class="badge" cx="${t.x}" cy="${t.y}" r="20"/><text class="tag" x="${t.x}" y="${t.y}">${t.label}</text></g>`).join('');
}

/**
 * Dibuja el plano dentro de `svg` y devuelve `paint`, que pinta cada mesa según su estado:
 * free, selected, partner, pending, confirmed o blocked. Las mesas que no aparecen en
 * `states` quedan libres. `onTable(label)` se llama al hacer clic o pulsar Enter/Espacio.
 */
export function renderPlan(svg, { onTable }) {
  svg.setAttribute('viewBox', '-40 -40 1160 1365');
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', 'Plano de mesas');
  svg.classList.add('plano');
  svg.innerHTML = buildDefs() + buildRoom() + buildTables();

  svg.addEventListener('click', (event) => {
    const table = event.target.closest('.t');
    if (table) onTable(table.dataset.label);
  });
  svg.addEventListener('keydown', (event) => {
    const table = event.target.closest('.t');
    if (table && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      onTable(table.dataset.label);
    }
  });

  const nodes = new Map(TABLES.map((t) => [t.label, svg.querySelector(`.t[data-label="${t.label}"]`)]));

  function paint(states) {
    for (const t of TABLES) {
      const state = states[t.label] ?? 'free';
      const node = nodes.get(t.label);
      node.setAttribute('class', `t ${state}`);
      node.setAttribute('aria-label', `Mesa ${t.label}, ${t.seats} plazas, ${STATE_WORDS[state]}`);
    }
  }

  return { paint };
}

/**
 * Plano plegable en móvil: `root` lleva la clase plan-closed y css/plano.css oculta el plano solo
 * por debajo de 760 px. Los botones [data-plan-toggle] pueden repintarse: el estado vive aquí y
 * `buttonHtml` lo devuelve al día. El estado no se guarda: al recargar vuelve a `open`.
 */
export function planFolder(root, { open = false, onChange } = {}) {
  let isOpen = open;
  const label = () => (isOpen ? 'Ocultar plano' : 'Ver plano');

  function sync() {
    root.classList.toggle('plan-closed', !isOpen);
    for (const button of root.querySelectorAll('[data-plan-toggle]')) {
      button.textContent = label();
      button.setAttribute('aria-expanded', String(isOpen));
    }
  }

  function setOpen(next) {
    if (next === isOpen) return;
    isOpen = next;
    sync();
    onChange?.();
  }

  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-plan-toggle]')) setOpen(!isOpen);
  });
  sync();

  return {
    isOpen: () => isOpen,
    setOpen,
    buttonHtml: () => `<button class="plan-toggle" type="button" data-plan-toggle aria-controls="plan" aria-expanded="${isOpen}">${label()}</button>`,
  };
}

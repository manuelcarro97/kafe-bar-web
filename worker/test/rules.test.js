import { describe, it, expect } from 'vitest';
import {
  TABLES,
  PAIRS,
  validateSelection,
  turnsFor,
  slotsFor,
  pendingDeadline,
  madridToUtc,
  turnIsOver,
} from '../reservas/rules.js';

const noOverrides = () => ({ closed: new Set(), openSunday: new Set() });
const NOW = new Date('2026-11-01T00:00:00Z');
const ANY_ERROR = expect.any(String);

describe('TABLES y PAIRS', () => {
  it('hay 15 mesas y 60 plazas', () => {
    expect(TABLES).toHaveLength(15);
    expect(TABLES.reduce((sum, t) => sum + t.seats, 0)).toBe(60);
  });

  it('mesa 8 de 6 plazas y mesa 4 de 2 no online; el resto de 4', () => {
    const byLabel = Object.fromEntries(TABLES.map((t) => [t.label, t]));
    expect(byLabel['8'].seats).toBe(6);
    expect(byLabel['4']).toMatchObject({ seats: 2, online: false });
    const others = TABLES.filter((t) => t.label !== '8' && t.label !== '4');
    expect(others.every((t) => t.seats === 4 && t.online)).toBe(true);
  });

  it('parejas del plano', () => {
    expect(PAIRS).toEqual([['1', '2'], ['10', '15'], ['11', '14'], ['12', '13']]);
  });
});

describe('validateSelection', () => {
  it('pareja de 5 a 9 personas', () => {
    expect(validateSelection(['1', '2'], 5)).toBeNull();
    expect(validateSelection(['1', '2'], 9)).toBeNull();
    expect(validateSelection(['1', '2'], 4)).toEqual(ANY_ERROR);
    expect(validateSelection(['1', '2'], 10)).toEqual(ANY_ERROR);
  });

  it('dos mesas que no son pareja dan error', () => {
    expect(validateSelection(['1', '5'], 6)).toEqual(ANY_ERROR);
  });

  it('la pareja vale en cualquier orden', () => {
    expect(validateSelection(['2', '1'], 6)).toBeNull();
  });

  it('tercera mesa: mensaje de llamar', () => {
    expect(validateSelection(['1', '2', '3'], 6)).toBe(
      'Para grupos grandes, llama al 981 31 82 60 y te confirmamos nosotros.'
    );
  });

  it('mesa 4 no es reservable online', () => {
    expect(validateSelection(['4'], 2)).toEqual(ANY_ERROR);
  });

  it('mesa 8 de 1 a 7', () => {
    expect(validateSelection(['8'], 7)).toBeNull();
    expect(validateSelection(['8'], 8)).toEqual(ANY_ERROR);
  });

  it('mesa de 4 de 1 a 5', () => {
    expect(validateSelection(['3'], 1)).toBeNull();
    expect(validateSelection(['3'], 5)).toBeNull();
    expect(validateSelection(['3'], 6)).toEqual(ANY_ERROR);
    expect(validateSelection(['3'], 0)).toEqual(ANY_ERROR);
  });

  it('selección vacía o mesa inexistente dan error', () => {
    expect(validateSelection([], 2)).toEqual(ANY_ERROR);
    expect(validateSelection(['99'], 2)).toEqual(ANY_ERROR);
  });
});

describe('turnsFor', () => {
  it('lunes a jueves solo comida', () => {
    expect(turnsFor('2026-11-02', noOverrides())).toEqual(['comida']);
    expect(turnsFor('2026-11-05', noOverrides())).toEqual(['comida']);
  });

  it('viernes y sábado comida y cena', () => {
    expect(turnsFor('2026-11-06', noOverrides())).toEqual(['comida', 'cena']);
    expect(turnsFor('2026-11-07', noOverrides())).toEqual(['comida', 'cena']);
  });

  it('domingo sin aperturas devuelve []', () => {
    expect(turnsFor('2026-11-08', noOverrides())).toEqual([]);
  });

  it('domingo con apertura de cena devuelve [cena]', () => {
    const o = { closed: new Set(), openSunday: new Set(['2026-11-08|cena']) };
    expect(turnsFor('2026-11-08', o)).toEqual(['cena']);
  });

  it('día cerrado devuelve []', () => {
    const o = { closed: new Set(['2026-11-06']), openSunday: new Set() };
    expect(turnsFor('2026-11-06', o)).toEqual([]);
  });

  it('turno cerrado se quita y el otro queda', () => {
    const o = { closed: new Set(['2026-11-06|cena']), openSunday: new Set() };
    expect(turnsFor('2026-11-06', o)).toEqual(['comida']);
  });
});

describe('slotsFor', () => {
  it('cena: 7 franjas de 20:00 a 21:30', () => {
    const slots = slotsFor('2026-11-06', 'cena', NOW);
    expect(slots).toHaveLength(7);
    expect(slots[0]).toBe('20:00');
    expect(slots[6]).toBe('21:30');
  });

  it('comida: 11 franjas de 13:00 a 15:30', () => {
    const slots = slotsFor('2026-11-06', 'comida', NOW);
    expect(slots).toHaveLength(11);
    expect(slots[0]).toBe('13:00');
    expect(slots[10]).toBe('15:30');
  });

  it('más de 30 días devuelve []', () => {
    expect(slotsFor('2026-12-04', 'comida', NOW)).toEqual([]);
  });

  it('exactamente a 30 días todavía hay franjas', () => {
    expect(slotsFor('2026-12-01', 'comida', NOW)).toHaveLength(11);
  });

  it('descarta franjas con menos de 1 hora desde ahora', () => {
    // 12:30 en Madrid: 13:00 y 13:15 quedan a menos de 1 hora; 13:30 sí.
    const now = madridToUtc('2026-11-06', '12:30');
    const slots = slotsFor('2026-11-06', 'comida', now);
    expect(slots[0]).toBe('13:30');
    expect(slots).toHaveLength(9);
  });

  it('día pasado devuelve []', () => {
    expect(slotsFor('2026-10-30', 'comida', NOW)).toEqual([]);
  });

  it('día de cambio a verano (2026-03-29, CEST): la hora de corte usa UTC+2', () => {
    // 12:30 CEST = 10:30Z. Corte: 11:30Z = 13:30 CEST, así que 13:00 y 13:15 fuera.
    // Con UTC+1 por error, 13:00 (12:00Z) sí entraría.
    const now = new Date('2026-03-29T10:30:00Z');
    const slots = slotsFor('2026-03-29', 'comida', now);
    expect(slots[0]).toBe('13:30');
    expect(slots).toHaveLength(9);
  });
});

describe('pendingDeadline', () => {
  it('2 horas antes de llegar si es lo primero', () => {
    const now = madridToUtc('2026-11-06', '12:00');
    expect(pendingDeadline(now, '2026-11-06', '13:30')).toEqual(madridToUtc('2026-11-06', '12:30'));
  });

  it('24 horas si la llegada está lejos', () => {
    const now = madridToUtc('2026-11-04', '10:00');
    expect(pendingDeadline(now, '2026-11-10', '14:00')).toEqual(madridToUtc('2026-11-05', '10:00'));
  });

  it('día de cambio a invierno (2026-10-25, CET): 2 horas antes de llegar', () => {
    // Llegada 13:30 CET = 12:30Z. Ahora 09:00Z (10:00 CEST). Caduca 10:30Z = 11:30 CET.
    const now = new Date('2026-10-25T09:00:00Z');
    expect(pendingDeadline(now, '2026-10-25', '13:30').toISOString()).toBe('2026-10-25T10:30:00.000Z');
  });

  it('mínimo 30 minutos desde ahora', () => {
    const now = madridToUtc('2026-11-06', '12:50');
    expect(pendingDeadline(now, '2026-11-06', '13:30')).toEqual(madridToUtc('2026-11-06', '13:20'));
  });
});

describe('madridToUtc', () => {
  it('horario de verano (CEST, UTC+2)', () => {
    expect(madridToUtc('2026-03-29', '13:00').toISOString()).toBe('2026-03-29T11:00:00.000Z');
  });

  it('horario de invierno (CET, UTC+1) tras el cambio de octubre', () => {
    expect(madridToUtc('2026-10-25', '13:00').toISOString()).toBe('2026-10-25T12:00:00.000Z');
  });

  it('invierno normal', () => {
    expect(madridToUtc('2026-11-06', '20:00').toISOString()).toBe('2026-11-06T19:00:00.000Z');
  });
});

describe('turnIsOver', () => {
  const at = (iso) => new Date(iso);

  it('fecha anterior a hoy en Madrid: acabado', () => {
    expect(turnIsOver('2026-11-05', 'cena', at('2026-11-06T10:00:00Z'))).toBe(true);
    expect(turnIsOver('2026-11-05', 'comida', at('2026-11-06T10:00:00Z'))).toBe(true);
  });

  it('hoy con la comida ya terminada (tras 15:30 Madrid)', () => {
    expect(turnIsOver('2026-11-06', 'comida', at('2026-11-06T15:00:00Z'))).toBe(true);
    expect(turnIsOver('2026-11-06', 'comida', at('2026-11-06T14:31:00Z'))).toBe(true);
  });

  it('hoy justo a la última hora del turno: sigue en curso', () => {
    expect(turnIsOver('2026-11-06', 'comida', at('2026-11-06T14:30:00Z'))).toBe(false); // 15:30 Madrid
    expect(turnIsOver('2026-11-06', 'cena', at('2026-11-06T20:30:00Z'))).toBe(false); // 21:30 Madrid
  });

  it('hoy con la cena terminada (tras 21:30 Madrid)', () => {
    expect(turnIsOver('2026-11-06', 'cena', at('2026-11-06T20:31:00Z'))).toBe(true);
    expect(turnIsOver('2026-11-06', 'cena', at('2026-11-06T21:00:00Z'))).toBe(true); // 22:00 Madrid
  });

  it('hoy con el turno en curso o por empezar', () => {
    expect(turnIsOver('2026-11-06', 'comida', at('2026-11-06T13:30:00Z'))).toBe(false); // 14:30
    expect(turnIsOver('2026-11-06', 'cena', at('2026-11-06T11:00:00Z'))).toBe(false); // 12:00, aún por empezar
  });

  it('mañana: nunca acabado', () => {
    expect(turnIsOver('2026-11-07', 'comida', at('2026-11-06T23:00:00Z'))).toBe(false);
  });

  it('usa el día de Madrid, no el de UTC', () => {
    // 23:30 UTC del 5 = 00:30 del 6 en Madrid: el día 5 ya es pasado.
    expect(turnIsOver('2026-11-05', 'cena', at('2026-11-05T23:30:00Z'))).toBe(true);
    expect(turnIsOver('2026-11-06', 'comida', at('2026-11-05T23:30:00Z'))).toBe(false);
  });

  it('horario de verano (CEST, UTC+2)', () => {
    expect(turnIsOver('2026-07-06', 'comida', at('2026-07-06T13:30:00Z'))).toBe(false); // 15:30 Madrid
    expect(turnIsOver('2026-07-06', 'comida', at('2026-07-06T13:31:00Z'))).toBe(true);
  });
});

// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import { useState, useEffect } from 'react';
import { useT } from '../i18n.jsx';

const DOW = [
  ['mon', 'L', 'Lunes'], ['tue', 'M', 'Martes'], ['wed', 'X', 'Miércoles'], ['thu', 'J', 'Jueves'],
  ['fri', 'V', 'Viernes'], ['sat', 'S', 'Sábado'], ['sun', 'D', 'Domingo'],
];
const pad2 = (n) => String(n).padStart(2, '0');

function parseSchedule(raw) {
  const v = (raw ?? '').trim();
  const base = { time: '00:00', days: ['mon'], monthDays: ['1'], raw: v };
  if (!v) return { ...base, mode: 'off' };
  if (v === 'daily') return { ...base, mode: 'daily' };
  if (v === 'weekly') return { ...base, mode: 'weekly' };
  if (v === 'monthly') return { ...base, mode: 'monthly' };

  let m;
  if ((m = v.match(/^(\d{2}:\d{2})$/))) return { ...base, mode: 'daily', time: m[1] };
  if ((m = v.match(/^\*-\*-\*\s+(\d{2}:\d{2})$/))) return { ...base, mode: 'daily', time: m[1] };
  if ((m = v.match(/^\*-\*-([\d,]+)\s+(\d{2}:\d{2})$/))) {
    const monthDays = m[1].split(',').map((d) => String(Number(d)));
    if (monthDays.every((d) => Number(d) >= 1 && Number(d) <= 31)) return { ...base, mode: 'monthly', monthDays, time: m[2] };
  }
  if ((m = v.match(/^([a-z]{3}(?:,[a-z]{3})*)\s+(\d{2}:\d{2})$/))) {
    const days = m[1].split(',');
    if (days.every((d) => DOW.some(([k]) => k === d))) return { ...base, mode: 'weekly', days, time: m[2] };
  }
  return { ...base, mode: 'custom' };
}

function buildSchedule(state) {
  const { mode, time, days, monthDays, raw } = state;
  if (mode === 'off') return '';
  if (mode === 'custom') return raw;
  if (mode === 'daily') return time;
  if (mode === 'weekly') return `${(days.length ? days : ['mon']).join(',')} ${time}`;
  if (mode === 'monthly') return `*-*-${(monthDays.length ? monthDays : ['1']).map(pad2).join(',')} ${time}`;
  return raw;
}

/**
 * Selector guiado de programación (calendar-event de systemd/PBS): diario/semanal/mensual
 * con día(s) y hora, más un modo "Personalizado" en texto libre para expresiones avanzadas
 * (rangos, varias franjas…) que el modo guiado no cubre. `allowOff` añade un modo "Desactivado"
 * que produce cadena vacía (usado por el GC, que puede no estar programado).
 */
export default function ScheduleField({ label, value, onChange, placeholder, allowOff }) {
  const t = useT();
  const [state, setState] = useState(() => parseSchedule(value));

  useEffect(() => { setState(parseSchedule(value)); }, [value]);

  function update(patch) {
    const next = { ...state, ...patch };
    setState(next);
    onChange(buildSchedule(next));
  }
  function setMode(mode) {
    update(mode === 'custom' ? { mode, raw: buildSchedule(state) } : { mode });
  }
  function toggleDay(d) {
    const days = state.days.includes(d) ? state.days.filter((x) => x !== d) : [...state.days, d];
    update({ days });
  }

  const MODES = [
    ...(allowOff ? [['off', t('Desactivado')]] : []),
    ['daily', t('Diario')],
    ['weekly', t('Semanal')],
    ['monthly', t('Mensual')],
    ['custom', t('Personalizado')],
  ];

  return (
    <div className="field">
      {label && <label>{label}</label>}
      <div className="seg" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
        {MODES.map(([k, l]) => (
          <button key={k} type="button" className={state.mode === k ? 'active' : ''} onClick={() => setMode(k)}>{l}</button>
        ))}
      </div>

      {state.mode === 'weekly' && (
        <div className="btn-row" style={{ marginBottom: 8 }}>
          {DOW.map(([k, l, full]) => (
            <button key={k} type="button" className="btn sm" title={t(full)}
              style={state.days.includes(k) ? { background: 'var(--brand)', color: '#fff', borderColor: 'var(--brand)' } : {}}
              onClick={() => toggleDay(k)}>
              {l}
            </button>
          ))}
        </div>
      )}

      {state.mode === 'monthly' && (
        <div className="field" style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 11.5, color: 'var(--text-2)' }}>{t('Día del mes (1-31, separados por coma)')}</label>
          <input className="input" style={{ maxWidth: 180 }} value={state.monthDays.join(',')}
            onChange={(e) => update({ monthDays: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
        </div>
      )}

      {state.mode === 'custom' && (
        <input className="input" value={state.raw} placeholder={placeholder} onChange={(e) => update({ raw: e.target.value })} />
      )}
      {(state.mode === 'daily' || state.mode === 'weekly' || state.mode === 'monthly') && (
        <input className="input" type="time" style={{ maxWidth: 140 }} value={state.time} onChange={(e) => update({ time: e.target.value })} />
      )}
    </div>
  );
}

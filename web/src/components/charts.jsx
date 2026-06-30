// Gráficas SVG ligeras (sin librerías externas).
import { tg } from '../i18n.jsx';

/** Gráfica de área para la tendencia de transferencia diaria. */
export function AreaChart({ data, color = 'var(--brand)', format = (v) => v, height = 220 }) {
  const W = 760, H = height;
  const padL = 52, padR = 14, padT = 14, padB = 28;
  const pw = W - padL - padR;
  const ph = H - padT - padB;

  const vals = data.map((d) => d.value);
  const max = Math.max(1, ...vals);
  const niceMax = niceCeil(max);

  const x = (i) => padL + (data.length <= 1 ? pw / 2 : (i / (data.length - 1)) * pw);
  const y = (v) => padT + ph - (v / niceMax) * ph;

  const linePts = data.map((d, i) => `${x(i)},${y(d.value)}`).join(' ');
  const areaPts = `${padL},${padT + ph} ${linePts} ${padL + pw},${padT + ph}`;

  const ticks = [0, niceMax / 2, niceMax];

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Rejilla + etiquetas Y */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={padL + pw} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
            <text x={padL - 8} y={y(t) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--text-3)" fontFamily="var(--mono)">
              {format(t)}
            </text>
          </g>
        ))}

        {/* Área + línea */}
        <polygon points={areaPts} fill="url(#areaGrad)" />
        <polyline points={linePts} fill="none" stroke={color} strokeWidth="2.2"
          strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />

        {/* Puntos + etiquetas X */}
        {data.map((d, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(d.value)} r="2.6" fill="var(--surface)" stroke={color} strokeWidth="1.8" />
            {(data.length <= 10 || i % 2 === 0) && (
              <text x={x(i)} y={H - 9} textAnchor="middle" fontSize="10" fill="var(--text-3)" fontFamily="var(--mono)">
                {d.label}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

/** Donut de porcentaje de uso. Con `label`/`sub` muestra texto central propio. */
export function Donut({ percent, size = 132, color, label, sub }) {
  const r = size / 2 - 12;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, percent));
  const stroke = color || (pct >= 90 ? 'var(--err)' : pct >= 75 ? 'var(--warn)' : 'var(--ok)');
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth="11" />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={stroke} strokeWidth="11"
        strokeDasharray={`${(pct / 100) * c} ${c}`} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray .5s ease' }}
      />
      <text x="50%" y="48%" textAnchor="middle" fontSize={label != null ? 18 : 26} fontWeight="600" fill="var(--text)" fontFamily="var(--mono)">
        {label != null ? label : `${Math.round(pct)}%`}
      </text>
      <text x="50%" y="63%" textAnchor="middle" fontSize="11" fill="var(--text-3)">{sub != null ? sub : tg('usado')}</text>
    </svg>
  );
}

function niceCeil(n) {
  if (n <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(n)));
  const f = n / mag;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * mag;
}

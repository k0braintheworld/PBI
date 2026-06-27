import { api, fmtBytes, fmtDate, fmtAgo } from '../api.js';
import { useAsync, Loading, ErrorBox, VerifyBadge, taskTypeLabel } from './common.jsx';
import { useGuestNames } from '../guestNames.js';
import { Icon } from './icons.jsx';
import { AreaChart, Donut } from './charts.jsx';
import { useT } from '../i18n.jsx';

/** Dashboard estilo Active Backup / Veeam: visión general densa y profesional. */
export default function Dashboard({ goTo }) {
  const t = useT();
  const { loading, error, data } = useAsync(() => api.dashboard(), []);
  const names = useGuestNames();

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const { counters, storage, calendar, transfer, lastBackups, recentTasks } = data;
  const totalPct = storage.totalCapacity ? (storage.totalUsed / storage.totalCapacity) * 100 : 0;

  return (
    <div className="rise">
      {/* ---- Tira de KPIs ---- */}
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Kpi icon="database" tone="brand" value={counters.datastores} label={t('Datastores')} />
        <Kpi icon="shield" tone="ok" value={counters.groups.total} label={t('Grupos protegidos')} />
        <Kpi icon="layers" tone="" value={counters.snapshots} label={t('Snapshots totales')} />
        <Kpi icon="x" tone={counters.failedVerifications ? 'err' : 'ok'} value={counters.failedVerifications} label={t('Verificaciones con fallo')} />
      </div>

      {/* ---- Cuadrícula principal ---- */}
      <div className="dash">
        {/* Grupos por tipo */}
        <div className="card">
          <div className="panel-head"><h3>{t('Dispositivos protegidos')}</h3></div>
          <div className="type-chips" style={{ paddingTop: 16 }}>
            <TypeChip icon="server" label="VM" value={counters.groups.vm} />
            <TypeChip icon="file" label="CT" value={counters.groups.ct} />
            <TypeChip icon="desktop" label="Host" value={counters.groups.host} />
            {counters.groups.other > 0 && <TypeChip icon="layers" label={t('Otros')} value={counters.groups.other} />}
          </div>
          <div className="panel-body" style={{ borderTop: '1px solid var(--border)' }}>
            <button className="btn sm" onClick={() => goTo('backups')}>{t('Ver backups →')}</button>
          </div>
        </div>

        {/* Calendario de copias */}
        <div className="card span-2">
          <div className="panel-head">
            <h3>{t('Calendario de copias de seguridad')}</h3>
            <span className="muted" style={{ fontSize: 11.5 }}>{t('últimas 5 semanas')}</span>
          </div>
          <Calendar calendar={calendar} />
          <div className="cal-legend">
            <span><i style={{ background: 'var(--ok)' }} /> {t('Correcta')}</span>
            <span><i style={{ background: 'var(--warn)' }} /> {t('Parcial')}</span>
            <span><i style={{ background: 'var(--err)' }} /> {t('Con fallo')}</span>
            <span><i style={{ background: 'var(--surface-3)', border: '1.5px solid #dde3ec' }} /> {t('Sin copia')}</span>
          </div>
        </div>

        {/* Almacenamiento */}
        <div className="card">
          <div className="panel-head"><h3>{t('Estado de almacenamiento')}</h3></div>
          <div style={{ display: 'grid', placeItems: 'center', padding: '14px 0 6px' }}>
            <Donut percent={totalPct} />
          </div>
          <div className="storage-tot">
            <div className="big">{fmtBytes(storage.totalUsed)}</div>
            <div className="cap">{t('de')} {fmtBytes(storage.totalCapacity)} {t('disponibles')}</div>
          </div>
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 12 }}>
            {storage.perDatastore.map((d) => {
              const pct = d.total ? Math.round((d.used / d.total) * 100) : 0;
              const cls = pct >= 90 ? 'high' : pct >= 75 ? 'mid' : '';
              return (
                <div className="storage-row" key={d.store}>
                  <div className="flex-between">
                    <strong style={{ fontSize: 13 }}>{d.store}</strong>
                    <span className="muted mono" style={{ fontSize: 12 }}>{fmtBytes(d.used)} / {fmtBytes(d.total)}</span>
                  </div>
                  <div className="bar"><span className={cls} style={{ width: `${pct}%` }} /></div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Últimas copias */}
        <div className="card span-2">
          <div className="panel-head">
            <h3>{t('Últimas copias de seguridad')}</h3>
            <button className="act" onClick={() => goTo('backups')}>{t('Ver todo')}</button>
          </div>
          <div className="panel-body flush">
            <table>
              <thead>
                <tr><th>{t('Grupo')}</th><th>Datastore</th><th className="num">{t('Tamaño')}</th><th>{t('Verificación')}</th><th className="num">{t('Última copia')}</th></tr>
              </thead>
              <tbody>
                {lastBackups.slice(0, 8).map((b, i) => (
                  <tr key={i}>
                    <td>
                      <span className="badge muted plain">{b.type}</span> <strong>{b.id}</strong>
                      {b.type !== 'host' && names[String(b.id)] && <span className="muted"> · {names[String(b.id)]}</span>}
                    </td>
                    <td className="muted">{b.store}</td>
                    <td className="num">{fmtBytes(b.size)}</td>
                    <td><VerifyBadge state={b.verify} /></td>
                    <td className="num" title={fmtDate(b.time)}>{fmtAgo(b.time)}</td>
                  </tr>
                ))}
                {!lastBackups.length && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 22 }}>{t('Sin copias todavía')}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {/* Actividad reciente */}
        <div className="card">
          <div className="panel-head">
            <h3>{t('Actividad reciente')}</h3>
            <button className="act" onClick={() => goTo('tasks')}>{t('Ver tareas')}</button>
          </div>
          <div>
            {recentTasks.slice(0, 7).map((tk) => {
              const running = tk.endtime == null;
              const ok = tk.status === 'OK';
              const tone = running ? 'run' : ok ? 'ok' : 'err';
              const IcoC = running ? Icon.clock : ok ? Icon.check : Icon.x;
              return (
                <div className="evt" key={tk.upid}>
                  <span className={`ico ${tone}`}><IcoC /></span>
                  <div className="msg">
                    <div className="t">{labelTask(tk, t)}</div>
                    <div className="d">{fmtDate(tk.starttime)}</div>
                  </div>
                </div>
              );
            })}
            {!recentTasks.length && <div className="panel-body muted">{t('Sin actividad reciente')}</div>}
          </div>
        </div>

        {/* Tendencia de transferencia */}
        <div className="card span-2">
          <div className="panel-head">
            <h3>{t('Tendencia de transferencia')}</h3>
            <span className="muted" style={{ fontSize: 11.5 }}>{t('tamaño de copias por día · 14 días')}</span>
          </div>
          <AreaChart
            data={transfer.map((p) => ({ label: ddmm(p.date), value: p.bytes }))}
            format={(v) => fmtBytes(v)}
          />
        </div>
      </div>
    </div>
  );
}

function Kpi({ icon, tone, value, label }) {
  const I = Icon[icon];
  return (
    <div className="card kpi">
      <div className={`kpi-icon ${tone}`}><I /></div>
      <div>
        <div className="num">{value}</div>
        <div className="lbl">{label}</div>
      </div>
    </div>
  );
}

function TypeChip({ icon, label, value }) {
  const I = Icon[icon];
  return (
    <div className="type-chip">
      <span style={{ color: 'var(--text-3)' }}><I width={18} height={18} /></span>
      <div>
        <div className="v">{value}</div>
        <div className="t">{label}</div>
      </div>
    </div>
  );
}

function Calendar({ calendar }) {
  const t = useT();
  const todayKey = calendar[calendar.length - 1]?.date;
  // Alinear a columnas Dom..Sáb
  const cells = calendar.map((c) => ({ ...c, dow: new Date(c.date + 'T00:00:00').getDay() }));
  const padFront = cells.length ? cells[0].dow : 0;
  const padded = [...Array(padFront).fill(null), ...cells];
  while (padded.length % 7 !== 0) padded.push(null);
  const weeks = [];
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));

  return (
    <div className="cal">
      <div className="cal-head">
        <span />
        {(t('D,L,M,X,J,V,S').split(',')).map((d, i) => <span key={i}>{d}</span>)}
      </div>
      {weeks.map((wk, wi) => {
        const real = wk.filter(Boolean);
        const isThis = real.some((c) => c.date === todayKey);
        const label = isThis ? t('Esta sem.') : real.length ? ddmm(real[0].date) : '';
        return (
          <div className="cal-row" key={wi}>
            <span className="wk">{label}</span>
            {wk.map((c, ci) => (
              <div className="cal-cell" key={ci}>
                {c && (
                  <div
                    className={`cal-dot ${c.status} ${c.date === todayKey ? 'today' : ''}`}
                    title={`${c.date} · ${statusText(c, t)}`}
                  />
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function statusText(c, t) {
  if (c.status === 'ok') return `${c.total} ${t('copias correctas')}`;
  if (c.status === 'failed') return `${c.failed} ${t('fallos')}`;
  if (c.status === 'partial') return `${c.total} ${t('copias')}, ${c.failed} ${t('con fallo')}`;
  return t('sin copias');
}

function labelTask(task, t) {
  return `${t(taskTypeLabel(task.type))}${task.id ? ` · ${task.id}` : ''}`;
}

const ddmm = (iso) => {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
};

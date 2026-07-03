// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import { useState, useEffect } from 'react';
import { api, fmtBytes, fmtDate, fmtAgo } from '../api.js';
import { useAsync, Loading, ErrorBox, VerifyBadge, taskTypeLabel } from './common.jsx';
import { useGuestNames } from '../guestNames.js';
import { Icon } from './icons.jsx';
import { AreaChart, Donut } from './charts.jsx';
import { useT } from '../i18n.jsx';

/** Dashboard estilo Active Backup / Veeam: visión general densa y profesional. */
export default function Dashboard({ goTo, user }) {
  const t = useT();
  const { loading, error, data, reload } = useAsync(() => api.dashboard(), []);
  const names = useGuestNames();
  const [month, setMonth] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [excluded, setExcluded] = useState([]);
  const canEdit = user?.role !== 'viewer';

  const loadExcluded = () => api.excludedVms().then(setExcluded).catch(() => {});
  useEffect(() => { loadExcluded(); }, []);

  async function excludeVm(g) {
    try { await api.excludedVmAdd({ vmid: g.vmid, name: g.name }); await loadExcluded(); reload(); }
    catch { /* ignore */ }
  }
  async function restoreVm(vmid) {
    try { await api.excludedVmRemove(vmid); await loadExcluded(); reload(); }
    catch { /* ignore */ }
  }

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const { counters, storage, transfer, lastBackups, recentTasks } = data;
  const unprotected = data.unprotected || [];
  const totalPct = storage.totalCapacity ? (storage.totalUsed / storage.totalCapacity) * 100 : 0;
  const logical = storage.logical || 0;
  // Físico para el factor: preferimos disk-bytes de GC (exacto); si no, el usado del NAS.
  const physical = storage.dedupPhysical || storage.totalUsed || 0;
  const dedup = physical > 0 && logical > 0 ? logical / physical : 0;
  // El dato de GC es autoritativo; la suma de snapshots no es fiable. Mostramos el
  // factor solo si viene de GC y es >= 1.05 (dedup apreciable).
  const gcBased = storage.logicalSource === 'gc';
  const dedupReliable = gcBased && dedup >= 1.05;
  const savingsPct = dedupReliable ? Math.max(0, (1 - physical / logical) * 100) : 0;

  return (
    <div className="rise">
      {/* ---- Tira de KPIs ---- */}
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Kpi icon="database" tone="brand" value={counters.datastores} label={t('Datastores')} />
        <Kpi icon="shield" tone="ok" value={counters.groups.total} label={t('Grupos protegidos')} />
        <Kpi icon="layers" tone="" value={counters.snapshots} label={t('Snapshots totales')} />
        <Kpi icon="search" tone={counters.failedVerifications ? 'err' : 'ok'} value={counters.failedVerifications} label={t('Verificaciones con fallo')} />
      </div>

      {/* ---- Cuadrícula principal ---- */}
      <div className="dash">
        {/* ---- Columna izquierda (estrecha) ---- */}
        <div className="dash-col">
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

          {/* Máquinas sin proteger */}
          {unprotected.length > 0 && (
            <div className="card">
              <div className="panel-head">
                <h3 style={{ color: 'var(--warn)' }}>⚠ {t('Máquinas sin proteger')}</h3>
                <span className="badge warn">{unprotected.length}</span>
              </div>
              <div className="panel-body" style={{ fontSize: 12.5 }}>
                {unprotected.slice(0, 12).map((g) => (
                  <div key={g.vmid} className="flex-between" style={{ padding: '3px 0', gap: 8 }}>
                    <span><span className="badge muted plain">{g.type === 'lxc' ? 'ct' : 'vm'}</span> <b>{g.vmid}</b>{g.name ? <span className="muted"> · {g.name}</span> : null}</span>
                    {canEdit && (
                      <button className="btn sm ghost" title={t('Marcar como sin copia necesaria (no volverá a avisar)')}
                        onClick={() => excludeVm(g)} style={{ padding: '1px 7px', fontSize: 11 }}>{t('no requiere copia')}</button>
                    )}
                  </div>
                ))}
                {unprotected.length > 12 && <div className="muted" style={{ paddingTop: 4 }}>+{unprotected.length - 12} {t('más')}</div>}
                <p className="muted" style={{ fontSize: 11.5, margin: '8px 0 0' }}>{t('Máquinas de Proxmox VE sin ninguna copia en este PBS.')}</p>
              </div>
            </div>
          )}

          {/* VMs marcadas como sin copia necesaria (restaurables) */}
          {excluded.length > 0 && (
            <div className="card">
              <details>
                <summary className="panel-head" style={{ cursor: 'pointer', listStyle: 'revert' }}>
                  <h3 style={{ display: 'inline' }}>{t('Sin copia necesaria')}</h3>
                  <span className="badge muted" style={{ marginLeft: 6 }}>{excluded.length}</span>
                </summary>
                <div className="panel-body" style={{ fontSize: 12.5 }}>
                  <p className="muted" style={{ fontSize: 11.5, margin: '0 0 8px' }}>{t('Excluidas de las alertas de «sin proteger» (panel, email e informes).')}</p>
                  {excluded.map((g) => (
                    <div key={g.vmid} className="flex-between" style={{ padding: '3px 0', gap: 8 }}>
                      <span><b>{g.vmid}</b>{g.name ? <span className="muted"> · {g.name}</span> : null}</span>
                      {canEdit && <button className="btn sm ghost" onClick={() => restoreVm(g.vmid)} style={{ padding: '1px 7px', fontSize: 11 }}>{t('volver a vigilar')}</button>}
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}

          {/* Almacenamiento */}
          <div className="card">
            <div className="panel-head"><h3>{t('Estado de almacenamiento')}</h3></div>
            <div className="donut-duo">
              <div className="donut-cell">
                <div className="donut-lbl">{t('Uso del NAS')}</div>
                <Donut percent={totalPct} size={112} />
                <div className="cap"><b className="mono">{fmtBytes(storage.totalUsed)}</b> {t('de')} {fmtBytes(storage.totalCapacity)}</div>
              </div>
              <div className="donut-cell">
                <div className="donut-lbl">{t('Datos protegidos')}</div>
                {dedupReliable ? (
                  <Donut percent={savingsPct} size={112} color="var(--info)" label={fmtBytes(logical)} sub={t('en copias')} />
                ) : (
                  // Sin dato de dedup fiable (GC no ejecutada o PBS no reporta tamaños):
                  // anillo neutro con el tamaño, en vez de un donut a 0% que parece roto.
                  <Donut percent={100} size={112} color="var(--surface-3)" label={logical > 0 ? fmtBytes(logical) : fmtBytes(storage.totalUsed)} sub={t('en copias')} />
                )}
                <div className="cap">{dedupReliable
                  ? <><b className="mono">≈ {dedup.toFixed(1)}×</b> {t('deduplicado')}</>
                  : <span className="muted">{gcBased ? t('tamaño lógico') : t('ejecuta un GC para ver la deduplicación')}</span>}</div>
              </div>
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
        </div>

        {/* ---- Columna derecha (ancha) ---- */}
        <div className="dash-col">
          {/* Calendario de copias */}
          <div className="card">
            <div className="panel-head">
              <h3>{t('Calendario de copias de seguridad')}</h3>
              <MonthNav month={month} setMonth={setMonth} t={t} />
            </div>
            <Calendar month={month} />
            <div className="cal-legend">
              <span><i style={{ background: 'var(--ok)' }} /> {t('Correcta')}</span>
              <span><i style={{ background: 'var(--warn)' }} /> {t('Parcial')}</span>
              <span><i style={{ background: 'var(--err)' }} /> {t('Con fallo')}</span>
              <span><i style={{ background: 'var(--surface-3)', border: '1.5px solid #dde3ec' }} /> {t('Sin copia')}</span>
            </div>
          </div>

          {/* Últimas copias */}
          <div className="card">
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

          {/* Tendencia de transferencia */}
          <div className="card">
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

function MonthNav({ month, setMonth, t }) {
  const lang = (typeof localStorage !== 'undefined' && localStorage.getItem('pbi_lang')) || 'es';
  const locale = lang === 'en' ? 'en-US' : 'es-ES';
  const label = new Date(month.y, month.m, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const cap = label.charAt(0).toUpperCase() + label.slice(1);
  const now = new Date();
  const isCurrent = month.y === now.getFullYear() && month.m === now.getMonth();
  const shift = (delta) => setMonth((mm) => { const d = new Date(mm.y, mm.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  return (
    <div className="cal-nav">
      <button className="btn sm ghost icon" onClick={() => shift(-1)} aria-label={t('Mes anterior')}><Icon.arrowLeft width={16} height={16} /></button>
      <span className="cal-month">{cap}</span>
      <button className="btn sm ghost icon" onClick={() => shift(1)} disabled={isCurrent} aria-label={t('Mes siguiente')}><Icon.chevronRight width={16} height={16} /></button>
    </div>
  );
}

function Calendar({ month }) {
  const t = useT();
  // Inicio de semana configurable (Configuración › Preferencias). Por defecto, lunes.
  const weekStart = (typeof localStorage !== 'undefined' && localStorage.getItem('pbi_week_start')) || 'mon';
  const colOf = (dow) => (weekStart === 'mon' ? (dow + 6) % 7 : dow); // dow: 0=Dom
  const [data, setData] = useState(null);

  useEffect(() => {
    const mm = String(month.m + 1).padStart(2, '0');
    const lastDay = new Date(month.y, month.m + 1, 0).getDate();
    const from = `${month.y}-${mm}-01`;
    const to = `${month.y}-${mm}-${String(lastDay).padStart(2, '0')}`;
    let cancelled = false;
    api.calendar(from, to).then((d) => { if (!cancelled) setData(d || []); }).catch(() => { if (!cancelled) setData([]); });
    return () => { cancelled = true; };
  }, [month.y, month.m]);

  const todayKey = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local
  const cells = (data || []).map((c) => ({ ...c, dow: new Date(c.date + 'T00:00:00').getDay() }));
  const padFront = cells.length ? colOf(cells[0].dow) : 0;
  const padded = [...Array(padFront).fill(null), ...cells];
  while (padded.length % 7 !== 0) padded.push(null);
  const weeks = [];
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));
  // Cabecera traducible (Dom..Sáb) rotada si la semana empieza en lunes
  const base = t('D,L,M,X,J,V,S').split(',');
  const headers = weekStart === 'mon' ? [...base.slice(1), base[0]] : base;

  return (
    <div className="cal">
      <div className="cal-head">
        <span />
        {headers.map((d, i) => <span key={i}>{d}</span>)}
      </div>
      {weeks.map((wk, wi) => {
        const real = wk.filter(Boolean);
        const isThis = real.some((c) => c.date === todayKey);
        const label = isThis ? t('Esta sem.') : real.length ? ddmm(real[0].date) : '';
        return (
          <div className="cal-row" key={wi}>
            <span className="wk">{label}</span>
            {wk.map((c, ci) => (
              <div className={`cal-cell ${c && c.date === todayKey ? 'today' : ''}`} key={ci}>
                {c && (
                  <div
                    className={`cal-sq ${c.status} ${c.date === todayKey ? 'today' : ''}`}
                    title={`${c.date} · ${statusText(c, t)}`}
                  >
                    {calCount(c)}
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// Número a mostrar en cada día: total de copias (o nº de fallos si el día falló)
function calCount(c) {
  if (c.status === 'none') return '';
  if (c.status === 'failed') return c.failed;
  return c.total;
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

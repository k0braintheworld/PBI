import { useEffect, useState } from 'react';
import { api, fmtBytes } from '../api.js';
import { useAsync, Loading, ErrorBox } from './common.jsx';
import { Icon } from './icons.jsx';

/** Informes: resumen ejecutivo + descargas CSV. */
export default function Reports() {
  const { loading, error, data } = useAsync(() => api.reportSummary(), []);
  const ds = useAsync(() => api.datastores(), []);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const { totals, tasks, datastores, generatedAt } = data;
  const successRate = tasks.ok + tasks.failed > 0
    ? Math.round((tasks.ok / (tasks.ok + tasks.failed)) * 100)
    : 100;

  return (
    <div className="rise" style={{ display: 'grid', gap: 16 }}>
      <div className="grid cols-4">
        <Kpi icon="activity" tone={successRate >= 95 ? 'ok' : successRate >= 80 ? 'warn' : 'err'} value={`${successRate}%`} label="Tasa de éxito" />
        <Kpi icon="check" tone="ok" value={tasks.ok} label="Tareas correctas" />
        <Kpi icon="x" tone={tasks.failed ? 'err' : 'ok'} value={tasks.failed} label="Tareas con fallo" />
        <Kpi icon="shield" tone={totals.failedVerifications ? 'err' : 'ok'} value={totals.failedVerifications} label="Verif. fallidas" />
      </div>

      <div className="card">
        <div className="panel-head">
          <h3>Estado por datastore</h3>
          <span className="muted" style={{ fontSize: 11.5 }}>
            generado {generatedAt ? new Date(generatedAt).toLocaleString('es-ES') : '—'}
          </span>
        </div>
        <table>
          <thead>
            <tr><th>Datastore</th><th className="num">Snapshots</th><th className="num">Usado</th><th className="num">Capacidad</th><th className="num">% Uso</th><th className="num">Verif. fallidas</th></tr>
          </thead>
          <tbody>
            {datastores.map((d) => {
              const pct = d.status?.total ? Math.round((d.status.used / d.status.total) * 100) : 0;
              return (
                <tr key={d.store}>
                  <td><strong>{d.store}</strong></td>
                  <td className="num">{d.snapshotCount}</td>
                  <td className="num">{fmtBytes(d.status?.used)}</td>
                  <td className="num">{fmtBytes(d.status?.total)}</td>
                  <td className="num">{pct}%</td>
                  <td className="num">{d.failedVerifications || 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card card-pad">
        <h3>Exportar datos</h3>
        <p className="muted" style={{ marginTop: -6 }}>Descarga informes en CSV para hoja de cálculo o archivado.</p>
        <div className="btn-row">
          <a className="btn primary sm" href={api.csvUrl('tasks')}><Icon.download width={14} height={14} /> Historial de tareas</a>
          <a className="btn sm" href={api.csvUrl('snapshots')}><Icon.download width={14} height={14} /> Todos los snapshots</a>
          {(ds.data || []).map((d) => (
            <a key={d.store} className="btn sm" href={api.csvUrl('snapshots', d.store)}><Icon.download width={14} height={14} /> Snapshots: {d.store}</a>
          ))}
        </div>
      </div>

      <ReportSchedule />
      <CustomReport />
    </div>
  );
}

const fmtLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function CustomReport() {
  const today = new Date();
  const [from, setFrom] = useState(fmtLocal(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(fmtLocal(today));
  const [sede, setSede] = useState('');
  const [title, setTitle] = useState('');
  const [responsable, setResponsable] = useState('');
  const [restoreTest, setRestoreTest] = useState('');
  const [machines, setMachines] = useState(null);
  const [selected, setSelected] = useState(() => new Set());

  useEffect(() => {
    api.reportMachines().then((m) => {
      setMachines(m);
      setSelected(new Set(m.map((x) => x.id))); // todas por defecto
    }).catch(() => setMachines([]));
  }, []);

  const allSelected = machines && selected.size === machines.length;
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected((s) => (machines && s.size === machines.length ? new Set() : new Set(machines.map((x) => x.id))));

  function openReport(pdf) {
    const params = { from, to };
    if (sede) params.sede = sede;
    if (title) params.title = title;
    if (responsable) params.responsable = responsable;
    if (restoreTest) params.restoreTest = restoreTest;
    if (machines && !allSelected && selected.size) params.vmids = [...selected].join(',');
    window.open(api.reportCustomUrl(params, pdf), '_blank', 'noopener');
  }

  const canRun = from && to && (!machines || selected.size > 0);

  return (
    <div className="card card-pad">
      <h3 style={{ marginTop: 0 }}>Informe de evidencia de copias (apoyo ISO 27001 / ENS)</h3>
      <p className="muted" style={{ marginTop: -4 }}>
        Informe completo para un rango de fechas y máquinas concretos, con metadatos de auditoría, alcance, política por máquina (RPO/retención/modo), estado de cifrado y copia externa, declaración y referencia a controles. Es evidencia para auditoría, no una certificación.
      </p>

      <div className="row">
        <div className="field"><label>Desde</label><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="field"><label>Hasta</label><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>
      <div className="row">
        <div className="field"><label>Sede</label><input className="input" placeholder="Oficina Central" value={sede} onChange={(e) => setSede(e.target.value)} /></div>
        <div className="field"><label>Responsable (opcional)</label><input className="input" placeholder="Nombre del responsable" value={responsable} onChange={(e) => setResponsable(e.target.value)} /></div>
      </div>
      <div className="row">
        <div className="field"><label>Título (opcional)</label><input className="input" placeholder="Informe de copias de seguridad" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="field"><label>Última prueba de restauración (opcional)</label><input className="input" type="date" value={restoreTest} onChange={(e) => setRestoreTest(e.target.value)} /></div>
      </div>

      <div className="field">
        <div className="flex-between">
          <label style={{ margin: 0 }}>Máquinas a incluir</label>
          {machines && <button type="button" className="btn sm ghost" onClick={toggleAll}>{allSelected ? 'Quitar todas' : 'Todas'}</button>}
        </div>
        {machines === null ? <Loading /> : !machines.length ? (
          <p className="muted" style={{ fontSize: 12.5 }}>No hay máquinas con copias.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, maxHeight: 170, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
            {machines.map((m) => (
              <label key={m.id} style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 13 }}>
                <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} />
                <span className="badge muted plain">{m.type}</span> <span className="mono">{m.id}</span>
                <span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="btn-row" style={{ marginTop: 4 }}>
        <button className="btn" disabled={!canRun} onClick={() => openReport(false)}><Icon.report width={14} height={14} /> Vista previa</button>
        <button className="btn primary" disabled={!canRun} onClick={() => openReport(true)}><Icon.download width={14} height={14} /> Descargar PDF</button>
      </div>
    </div>
  );
}

const FREQS = [['daily', 'Diario'], ['weekly', 'Semanal'], ['monthly', 'Mensual']];
const WEEKDAYS = [['1', 'Lunes'], ['2', 'Martes'], ['3', 'Miércoles'], ['4', 'Jueves'], ['5', 'Viernes'], ['6', 'Sábado'], ['7', 'Domingo']];

function ReportSchedule() {
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [sent, setSent] = useState(null);

  useEffect(() => { api.reportConfigGet().then(setCfg).catch(() => setCfg(false)); }, []);
  if (cfg === null) return <div className="card card-pad"><Loading /></div>;
  if (cfg === false) return null;

  const set = (k, v) => setCfg((c) => ({ ...c, [k]: v }));

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const { smtpReady, ...body } = cfg;
      const saved = await api.reportConfigSave(body);
      setCfg((c) => ({ ...saved, smtpReady: c.smtpReady }));
      setMsg('Configuración guardada.');
    } catch (e) { setMsg(`Error: ${e.message}`); }
    finally { setBusy(false); }
  }
  async function sendNow() {
    setSent({ loading: true });
    try { const r = await api.reportSendNow(); setSent(r); }
    catch (e) { setSent({ ok: false, error: e.message }); }
  }

  return (
    <div className="card card-pad">
      <div className="flex-between">
        <h3 style={{ margin: 0 }}>Informe periódico por email</h3>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => set('enabled', e.target.checked)} />
          <span className="muted">Envío automático</span>
        </label>
      </div>
      <p className="muted" style={{ marginTop: 6 }}>
        Un informe profesional con KPIs, almacenamiento, copias por máquina e incidencias del periodo. El email incluye el informe en HTML y el <b>PDF adjunto</b>.
      </p>

      {!cfg.smtpReady && (
        <div className="banner">Configura primero el servidor SMTP y un destinatario en <b>Configuración → Notificaciones</b>.</div>
      )}

      <div className="row">
        <div className="field"><label>Sede (aparece en la cabecera)</label>
          <input className="input" placeholder="Oficina Central / Sede Madrid…" value={cfg.sede} onChange={(e) => set('sede', e.target.value)} />
        </div>
        <div className="field"><label>Destinatario (vacío = el de Notificaciones)</label>
          <input className="input" placeholder="direccion@empresa.com" value={cfg.to} onChange={(e) => set('to', e.target.value)} />
        </div>
      </div>

      <div className="row">
        <div className="field"><label>Frecuencia</label>
          <select value={cfg.frequency} onChange={(e) => set('frequency', e.target.value)}>
            {FREQS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        {cfg.frequency === 'monthly' && (
          <div className="field"><label>Día del mes</label>
            <input className="input" type="number" min="1" max="28" value={cfg.dayOfMonth} onChange={(e) => set('dayOfMonth', Number(e.target.value))} />
          </div>
        )}
        {cfg.frequency === 'weekly' && (
          <div className="field"><label>Día de la semana</label>
            <select value={String(cfg.weekday)} onChange={(e) => set('weekday', Number(e.target.value))}>
              {WEEKDAYS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
        )}
        <div className="field"><label>Hora de envío</label>
          <input className="input" type="number" min="0" max="23" value={cfg.hour} onChange={(e) => set('hour', Number(e.target.value))} />
        </div>
      </div>

      {sent && !sent.loading && (sent.ok
        ? <div className="banner">✓ Informe enviado a {sent.to}</div>
        : <div className="error-box">✕ {sent.error}</div>)}
      {msg && <div className="banner">{msg}</div>}

      <div className="btn-row" style={{ marginTop: 6 }}>
        <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
        <a className="btn" href={api.reportPreviewUrl()} target="_blank" rel="noreferrer"><Icon.report width={14} height={14} /> Vista previa</a>
        <a className="btn" href={api.reportPreviewPdfUrl()} target="_blank" rel="noreferrer"><Icon.download width={14} height={14} /> Descargar PDF</a>
        <button className="btn" onClick={sendNow} disabled={sent?.loading || !cfg.smtpReady}><Icon.bolt width={14} height={14} /> {sent?.loading ? 'Enviando…' : 'Enviar ahora'}</button>
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

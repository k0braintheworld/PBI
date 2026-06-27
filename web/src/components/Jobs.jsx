import { useState } from 'react';
import { api } from '../api.js';
import { useAsync, Loading, ErrorBox, confirmDialog } from './common.jsx';
import { Icon } from './icons.jsx';
import BackupJobs from './BackupJobs.jsx';

const TABS = [
  { key: 'backups', label: 'Copias de seguridad' },
  { key: 'prune', label: 'Prune (PBS)' },
  { key: 'verify', label: 'Verificación (PBS)' },
  { key: 'sync', label: 'Sincronización (PBS)' },
];

// Campos editables por tipo de job
const FIELDS = {
  prune: [
    { name: 'id', label: 'ID del job', required: true },
    { name: 'store', label: 'Datastore', required: true },
    { name: 'schedule', label: 'Programación (calendar event)', placeholder: 'daily, weekly, 02:30…' },
    { name: 'keep-last', label: 'Mantener últimas', type: 'number' },
    { name: 'keep-daily', label: 'Mantener diarios', type: 'number' },
    { name: 'keep-weekly', label: 'Mantener semanales', type: 'number' },
    { name: 'keep-monthly', label: 'Mantener mensuales', type: 'number' },
    { name: 'keep-yearly', label: 'Mantener anuales', type: 'number' },
    { name: 'comment', label: 'Comentario' },
  ],
  verify: [
    { name: 'id', label: 'ID del job', required: true },
    { name: 'store', label: 'Datastore', required: true },
    { name: 'schedule', label: 'Programación', placeholder: 'daily' },
    { name: 'outdated-after', label: 'Re-verificar tras (días)', type: 'number' },
    { name: 'ignore-verified', label: 'Ignorar ya verificados', type: 'checkbox' },
    { name: 'comment', label: 'Comentario' },
  ],
  sync: [
    { name: 'id', label: 'ID del job', required: true },
    { name: 'store', label: 'Datastore local', required: true },
    { name: 'remote', label: 'Remoto', required: true },
    { name: 'remote-store', label: 'Datastore remoto', required: true },
    { name: 'schedule', label: 'Programación', placeholder: 'weekly' },
    { name: 'comment', label: 'Comentario' },
  ],
};

// Explicación breve de cada tipo de tarea de mantenimiento
const TASK_INFO = {
  prune: {
    title: 'Prune (retención)',
    desc: 'Decide cuántas copias conservar y elimina las antiguas según reglas (últimas, diarias, semanales, mensuales, anuales). Solo borra del índice: el espacio físico lo libera después el Garbage Collection del datastore.',
  },
  verify: {
    title: 'Verificación (integridad)',
    desc: 'Re-lee los datos guardados y valida sus sumas de verificación para detectar corrupción o errores de disco. «Ignorar ya verificados» evita repetir los correctos; «Re-verificar tras N días» fuerza un repaso periódico.',
  },
  sync: {
    title: 'Sincronización (réplica)',
    desc: 'Copia backups desde un PBS remoto a un datastore local (copia externa, estrategia 3-2-1). Requiere tener dado de alta un «remoto» en PBS y su datastore de origen.',
  },
};

// Plantillas predefinidas por tipo de tarea
const TEMPLATES = {
  prune: [
    { label: 'Diario · 7', values: { schedule: 'daily', 'keep-last': '', 'keep-daily': 7, 'keep-weekly': '', 'keep-monthly': '', 'keep-yearly': '' } },
    { label: 'GFS · 7d/4s/6m', values: { schedule: 'daily', 'keep-last': '', 'keep-daily': 7, 'keep-weekly': 4, 'keep-monthly': 6, 'keep-yearly': '' } },
    { label: 'Conservador · 14d/8s/12m', values: { schedule: 'daily', 'keep-last': '', 'keep-daily': 14, 'keep-weekly': 8, 'keep-monthly': 12, 'keep-yearly': '' } },
    { label: 'Mínimo · últimas 3', values: { schedule: 'daily', 'keep-last': 3, 'keep-daily': '', 'keep-weekly': '', 'keep-monthly': '', 'keep-yearly': '' } },
  ],
  verify: [
    { label: 'Diaria (rápida)', values: { schedule: 'daily', 'ignore-verified': true, 'outdated-after': 30 } },
    { label: 'Semanal completa', values: { schedule: 'weekly', 'ignore-verified': false, 'outdated-after': '' } },
    { label: 'Mensual', values: { schedule: 'monthly', 'ignore-verified': true, 'outdated-after': 30 } },
  ],
  sync: [
    { label: 'Diaria', values: { schedule: 'daily' } },
    { label: 'Semanal', values: { schedule: 'weekly' } },
  ],
};

export default function Jobs() {
  const [tab, setTab] = useState('backups');
  return (
    <div className="rise">
      <div className="seg pagehead" style={{ flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>
      {tab === 'backups' ? <BackupJobs /> : <PbsJobs kind={tab} />}
    </div>
  );
}

function PbsJobs({ kind }) {
  const jobs = useAsync(() => api.jobs(kind), [kind]);
  const [editing, setEditing] = useState(null); // null | {} (nuevo) | job (editar)
  const [msg, setMsg] = useState(null);

  async function run(id) {
    setMsg(null);
    try {
      const { upid } = await api.runJob(kind, id);
      setMsg(`Job "${id}" lanzado. Tarea: ${upid}`);
    } catch (err) {
      setMsg(`Error: ${err.message}`);
    }
  }

  async function remove(id) {
    if (!(await confirmDialog({ message: `¿Eliminar el job "${id}"?`, danger: true, confirmLabel: 'Eliminar' }))) return;
    try {
      await api.deleteJob(kind, id);
      jobs.reload();
    } catch (err) {
      setMsg(`Error: ${err.message}`);
    }
  }

  const info = TASK_INFO[kind];

  return (
    <div>
      {info && (
        <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', background: 'var(--info-soft)', border: '1px solid #cfe0fb', color: '#2257c4', padding: '10px 13px', borderRadius: 8, fontSize: 12.5, marginBottom: 14 }}>
          <span style={{ flexShrink: 0, marginTop: 1 }}><Icon.report width={16} height={16} /></span>
          <span><b>{info.title}.</b> {info.desc}</span>
        </div>
      )}
      <div className="flex-between" style={{ marginBottom: 14 }}>
        <span className="muted" style={{ fontSize: 13 }}>Trabajos de mantenimiento de PBS</span>
        <button className="btn primary sm" onClick={() => setEditing({})}><Icon.bolt width={14} height={14} /> Nuevo job</button>
      </div>

      {msg && <div className="banner">{msg}</div>}

      <div className="card">
        {jobs.loading ? (
          <Loading />
        ) : jobs.error ? (
          <div className="card-pad"><ErrorBox error={jobs.error} /></div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>ID</th><th>Datastore</th><th>Programación</th><th>Estado</th>
                <th>Comentario</th><th style={{ width: 1 }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {jobs.data.map((j) => (
                <tr key={j.id}>
                  <td><strong>{j.id}</strong></td>
                  <td>{j.store}{j.remote ? ` ← ${j.remote}` : ''}</td>
                  <td><span className="badge info plain">{j.schedule || 'manual'}</span></td>
                  <td>
                    {j.disable
                      ? <span className="badge muted">deshabilitado</span>
                      : <span className="badge ok">activo</span>}
                  </td>
                  <td className="muted">{j.comment || '—'}</td>
                  <td>
                    <div className="btn-row" style={{ flexWrap: 'nowrap' }}>
                      <button className="btn sm" onClick={() => run(j.id)} title="Ejecutar ahora"><Icon.play width={13} height={13} /></button>
                      <button className="btn sm ghost" onClick={() => setEditing(j)}>Editar</button>
                      <button className="btn sm ghost danger" onClick={() => remove(j.id)}>Eliminar</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!jobs.data.length && (
                <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 28 }}>No hay jobs de este tipo. Crea uno con «Nuevo job».</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <JobModal
          kind={kind}
          job={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); jobs.reload(); }}
          onError={(m) => setMsg(`Error: ${m}`)}
        />
      )}
    </div>
  );
}

function JobModal({ kind, job, onClose, onSaved, onError }) {
  const isNew = !job.id;
  const [form, setForm] = useState(() => ({ ...job }));
  const [busy, setBusy] = useState(false);
  const fields = FIELDS[kind];

  const set = (name, type) => (e) => {
    const v = type === 'checkbox' ? e.target.checked : type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value;
    setForm((f) => ({ ...f, [name]: v }));
  };
  const applyTemplate = (t) => setForm((f) => ({ ...f, ...t.values }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      // Limpia vacíos
      const body = {};
      for (const [k, v] of Object.entries(form)) {
        if (v !== '' && v !== undefined && v !== null) body[k] = v;
      }
      if (isNew) await api.createJob(kind, body);
      else {
        const { id, ...rest } = body;
        await api.updateJob(kind, job.id, rest);
      }
      onSaved();
    } catch (err) {
      onError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{isNew ? 'Nuevo' : 'Editar'} job de {kind}</h3>
        {TEMPLATES[kind] && (
          <>
            <label style={{ fontSize: 12.5, color: 'var(--text-2)', fontWeight: 500 }}>Plantillas</label>
            <div className="btn-row" style={{ margin: '6px 0 14px' }}>
              {TEMPLATES[kind].map((t) => (
                <button key={t.label} type="button" className="btn sm" onClick={() => applyTemplate(t)}>{t.label}</button>
              ))}
            </div>
          </>
        )}
        <form onSubmit={save}>
          {fields.map((f) => (
            <div className="field" key={f.name}>
              {f.type === 'checkbox' ? (
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--text)' }}>
                  <input type="checkbox" checked={!!form[f.name]} onChange={set(f.name, 'checkbox')} />
                  {f.label}
                </label>
              ) : (
                <>
                  <label>{f.label}{f.required && ' *'}</label>
                  <input
                    className="input"
                    type={f.type === 'number' ? 'number' : 'text'}
                    placeholder={f.placeholder || ''}
                    value={form[f.name] ?? ''}
                    onChange={set(f.name, f.type)}
                    required={f.required}
                    disabled={f.name === 'id' && !isNew}
                  />
                </>
              )}
            </div>
          ))}
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
            <input type="checkbox" checked={!!form.disable} onChange={set('disable', 'checkbox')} />
            <span className="muted">Deshabilitado</span>
          </label>
          <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
            <button className="btn primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

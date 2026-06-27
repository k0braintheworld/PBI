import { useEffect, useRef, useState } from 'react';
import { api, fmtDate, fmtDuration, fmtAgo } from '../api.js';
import { useAsync, Loading, ErrorBox, TaskBadge, taskTypeLabel, parseProgress } from './common.jsx';
import { useGuestNames, vmidFromTaskId } from '../guestNames.js';
import { Icon } from './icons.jsx';

const FILTERS = [
  { key: '', label: 'Todas' },
  { key: 'backup', label: 'Copias' },
  { key: 'verify', label: 'Verificación' },
  { key: 'prune', label: 'Prune' },
  { key: 'sync', label: 'Sync' },
  { key: 'garbage_collection', label: 'GC' },
];

/** Monitor de tareas con filtros, auto-refresco y visor de log por tarea. */
export default function Tasks() {
  const [type, setType] = useState('');
  const [onlyRunning, setOnlyRunning] = useState(false);
  const [auto, setAuto] = useState(true);
  const [selected, setSelected] = useState(null);
  const names = useGuestNames();

  const tasks = useAsync(
    () => api.tasks({ limit: 300, ...(onlyRunning ? { running: '1' } : {}) }),
    [onlyRunning],
  );

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => tasks.reload(), 5000);
    return () => clearInterval(t);
  }, [auto, tasks]);

  const rows = (tasks.data || []).filter((t) => !type || t.type === type);
  const running = (tasks.data || []).filter((t) => t.endtime == null);

  return (
    <div className="rise">
      <div className="flex-between pagehead" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="seg">
          {FILTERS.map((f) => (
            <button key={f.key} className={type === f.key ? 'active' : ''} onClick={() => setType(f.key)}>{f.label}</button>
          ))}
        </div>
        <div className="btn-row" style={{ alignItems: 'center' }}>
          <label style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 13, color: 'var(--text-2)' }}>
            <input type="checkbox" checked={onlyRunning} onChange={(e) => setOnlyRunning(e.target.checked)} /> Solo en ejecución
          </label>
          <label style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 13, color: 'var(--text-2)' }}>
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-refresco
          </label>
          <button className="btn sm" onClick={() => tasks.reload()}><Icon.refresh width={14} height={14} /> Refrescar</button>
          <a className="btn sm" href={api.csvUrl('tasks')}><Icon.download width={14} height={14} /> CSV</a>
        </div>
      </div>

      {running.length > 0 && (
        <div className="banner" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon.clock width={15} height={15} /> {running.length} tarea(s) en ejecución ahora mismo.
        </div>
      )}

      <div className="card">
        {tasks.loading ? (
          <Loading />
        ) : tasks.error ? (
          <div className="card-pad"><ErrorBox error={tasks.error} /></div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Tipo</th><th>Objetivo</th><th>Usuario</th><th>Inicio</th>
                <th>Duración</th><th>Estado</th><th style={{ width: 1 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.upid}>
                  <td><span className="badge muted plain">{taskTypeLabel(t.type)}</span></td>
                  <td className="mono" style={{ fontSize: 12.5 }}>
                    {t.id || '—'}
                    {(() => { const v = vmidFromTaskId(t.id); return v && names[v] ? <span className="muted"> · {names[v]}</span> : null; })()}
                  </td>
                  <td className="muted">{t.user}</td>
                  <td title={fmtDate(t.starttime)}>{fmtAgo(t.starttime)}</td>
                  <td className="mono">{fmtDuration(t.starttime, t.endtime)}</td>
                  <td>{t.endtime == null ? <RunningProgress upid={t.upid} /> : <TaskBadge task={t} />}</td>
                  <td><button className="btn sm ghost" onClick={() => setSelected(t)}>Ver log</button></td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 28 }}>No hay tareas que mostrar</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {selected && <TaskLogModal task={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

/** Lee el log de una tarea en curso y muestra una barra de progreso (si el log lo reporta). */
function RunningProgress({ upid }) {
  const [pct, setPct] = useState(null);
  useEffect(() => {
    let stop = false; let timer;
    async function tick() {
      try { const log = await api.taskLog(upid); if (!stop) setPct(parseProgress(log)); } catch { /* ignore */ }
      if (!stop) timer = setTimeout(tick, 3000);
    }
    tick();
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [upid]);

  if (pct == null) return <span className="badge run">en ejecución</span>;
  return (
    <div style={{ minWidth: 96 }}>
      <div className="bar" style={{ marginTop: 0 }}><span style={{ width: `${pct}%`, background: 'var(--info)' }} /></div>
      <div style={{ fontSize: 10.5, color: 'var(--info)', marginTop: 2, fontFamily: 'var(--mono)', fontWeight: 600 }}>{pct}% · en curso</div>
    </div>
  );
}

function TaskLogModal({ task, onClose }) {
  const log = useAsync(() => api.taskLog(task.upid), [task.upid]);
  const running = task.endtime == null;
  const pct = running ? parseProgress(log.data) : null;
  const logRef = useRef(null);
  const names = useGuestNames();
  const vmid = vmidFromTaskId(task.id);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => log.reload(), 3000);
    return () => clearInterval(t);
  }, [running, log]);

  // Auto-scroll al final cuando llega salida nueva
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log.data]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 820 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex-between">
          <h3 style={{ margin: 0 }}>
            {taskTypeLabel(task.type)} {task.id && <span className="mono muted" style={{ fontSize: 14 }}>· {task.id}</span>}
            {vmid && names[vmid] && <span className="muted" style={{ fontSize: 14 }}> · {names[vmid]}</span>}
          </h3>
          <TaskBadge task={task} />
        </div>
        <p className="muted mono" style={{ fontSize: 11.5, wordBreak: 'break-all', margin: '4px 0 12px' }}>{task.upid}</p>
        {pct != null && (
          <div style={{ margin: '0 0 12px' }}>
            <div className="flex-between" style={{ fontSize: 12, color: 'var(--info)', marginBottom: 4 }}><span>Progreso</span><span className="mono" style={{ fontWeight: 600 }}>{pct}%</span></div>
            <div className="bar" style={{ height: 9 }}><span style={{ width: `${pct}%`, background: 'var(--info)' }} /></div>
          </div>
        )}
        {log.loading ? (
          <Loading />
        ) : log.error ? (
          <ErrorBox error={log.error} />
        ) : (
          <div className="log" ref={logRef}>
            {(log.data || []).map((l) => l.t).join('\n') || '(sin salida)'}
          </div>
        )}
        <div className="btn-row" style={{ justifyContent: 'space-between', marginTop: 14 }}>
          <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>{running ? 'Actualizándose cada 3 s…' : `Finalizada · ${fmtDate(task.endtime)}`}</span>
          <button className="btn" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

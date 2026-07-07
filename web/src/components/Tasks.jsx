// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import { useEffect, useRef, useState } from 'react';
import { api, fmtDate, fmtDuration, fmtAgo } from '../api.js';
import { useAsync, Loading, ErrorBox, TaskBadge, taskTypeLabel, parseProgress, confirmDialog } from './common.jsx';
import { useGuestNames, vmidFromTaskId } from '../guestNames.js';
import { Icon } from './icons.jsx';
import { useT } from '../i18n.jsx';

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
  const tr = useT();
  const [type, setType] = useState('');
  const [onlyRunning, setOnlyRunning] = useState(false);
  const [auto, setAuto] = useState(true);
  const [selected, setSelected] = useState(null);
  const names = useGuestNames();

  const [pveId, setPveId] = useState(null);
  const [pveRunningTasks, setPveRunningTasks] = useState([]);
  const [stopMsg, setStopMsg] = useState(null);
  const [stopping, setStopping] = useState(null); // upid en curso de detención

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
  const hasRunningBackup = running.some((t) => t.type === 'backup');

  // Conexión PVE por defecto (para enriquecer los backups en curso con su tarea vzdump)
  useEffect(() => {
    api.pveList().then((l) => {
      const def = (l || []).find((p) => p.isDefault) || (l || [])[0];
      setPveId(def ? def.id : null);
    }).catch(() => {});
  }, []);

  // Mientras haya un backup en marcha, sondear las tareas vzdump en ejecución de PVE
  useEffect(() => {
    if (!pveId || !hasRunningBackup) { setPveRunningTasks([]); return undefined; }
    let stop = false; let timer;
    async function tick() {
      try {
        const list = await api.pveTasks(pveId, { running: 1, type: 'vzdump' });
        if (!stop) setPveRunningTasks(Array.isArray(list) ? list : []);
      } catch { /* ignore */ }
      if (!stop) timer = setTimeout(tick, 5000);
    }
    tick();
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [pveId, hasRunningBackup]);

  // Empareja un backup PBS en curso con su tarea vzdump de PVE (por VMID; si solo
  // hay una vzdump activa, se usa esa). Devuelve { id, upid } para leer su log/%.
  function matchPve(task) {
    if (!pveId || task.endtime != null || task.type !== 'backup' || !pveRunningTasks.length) return null;
    const vmid = vmidFromTaskId(task.id);
    const m = pveRunningTasks.find((p) => p.id === vmid)
      || (pveRunningTasks.length === 1 ? pveRunningTasks[0] : null);
    return m ? { id: pveId, upid: m.upid } : null;
  }

  // Detener una tarea en marcha. Si es un backup con su vzdump de PVE emparejado,
  // se detiene la tarea de PVE (la que realmente hace el trabajo); si no, la de PBS.
  async function stop(task) {
    const pve = matchPve(task);
    const what = `${tr(taskTypeLabel(task.type))}${task.id ? ` · ${task.id}` : ''}`;
    if (!(await confirmDialog({
      message: `${tr('¿Detener la tarea en curso?')} ${what}. ${tr('Se abortará y quedará marcada como fallida/cancelada.')}`,
      danger: true, confirmLabel: tr('Detener'),
    }))) return;
    setStopMsg(null); setStopping(task.upid);
    try {
      if (pve) await api.pveTaskStop(pve.id, pve.upid);
      else await api.taskStop(task.upid);
      setStopMsg(`${tr('Solicitada la detención de')} ${what}.`);
      setTimeout(() => tasks.reload(), 1200);
    } catch (e) {
      setStopMsg(`Error: ${e.message}`);
    } finally { setStopping(null); }
  }

  return (
    <div className="rise">
      <div className="flex-between pagehead" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="seg">
          {FILTERS.map((f) => (
            <button key={f.key} className={type === f.key ? 'active' : ''} onClick={() => setType(f.key)}>{tr(f.label)}</button>
          ))}
        </div>
        <div className="btn-row" style={{ alignItems: 'center' }}>
          <label style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 13, color: 'var(--text-2)' }}>
            <input type="checkbox" checked={onlyRunning} onChange={(e) => setOnlyRunning(e.target.checked)} /> {tr('Solo en ejecución')}
          </label>
          <label style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 13, color: 'var(--text-2)' }}>
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> {tr('Auto-refresco')}
          </label>
          <button className="btn sm" onClick={() => tasks.reload()}><Icon.refresh width={14} height={14} /> {tr('Refrescar')}</button>
          <a className="btn sm" href={api.csvUrl('tasks')}><Icon.download width={14} height={14} /> CSV</a>
        </div>
      </div>

      {running.length > 0 && (
        <div className="banner" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon.clock width={15} height={15} /> {running.length} {tr('tarea(s) en ejecución ahora mismo.')}
        </div>
      )}
      {stopMsg && <div className="banner" style={{ marginTop: running.length ? 8 : 0 }}>{stopMsg}</div>}

      <div className="card">
        {tasks.loading ? (
          <Loading />
        ) : tasks.error ? (
          <div className="card-pad"><ErrorBox error={tasks.error} /></div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{tr('Tipo')}</th><th>{tr('Objetivo')}</th><th>{tr('Usuario')}</th><th>{tr('Inicio')}</th>
                <th>{tr('Duración')}</th><th>{tr('Estado')}</th><th style={{ width: 1 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.upid}>
                  <td><span className="badge muted plain">{tr(taskTypeLabel(t.type))}</span></td>
                  <td className="mono" style={{ fontSize: 12.5 }}>
                    {t.id || '—'}
                    {(() => { const v = vmidFromTaskId(t.id); return v && names[v] ? <span className="muted"> · {names[v]}</span> : null; })()}
                  </td>
                  <td className="muted">{t.user}</td>
                  <td title={fmtDate(t.starttime)}>{fmtAgo(t.starttime)}</td>
                  <td className="mono">{fmtDuration(t.starttime, t.endtime)}</td>
                  <td>{t.endtime == null ? <RunningProgress upid={t.upid} pve={matchPve(t)} /> : <TaskBadge task={t} />}</td>
                  <td>
                    <div className="btn-row" style={{ flexWrap: 'nowrap' }}>
                      <button className="btn sm ghost" onClick={() => setSelected(t)}>{tr('Ver log')}</button>
                      {t.endtime == null && (
                        <button className="btn sm ghost danger" disabled={stopping === t.upid} onClick={() => stop(t)}>
                          {stopping === t.upid ? tr('Deteniendo…') : tr('Detener')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 28 }}>{tr('No hay tareas que mostrar')}</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <TaskLogModal
          task={selected} pve={matchPve(selected)}
          onStop={selected.endtime == null ? async () => { await stop(selected); setSelected(null); } : null}
          stopping={stopping === selected.upid}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

/** Lee el log de una tarea en curso y muestra una barra de progreso (si el log lo reporta). */
function RunningProgress({ upid, pve }) {
  const tr = useT();
  const [pct, setPct] = useState(null);
  useEffect(() => {
    let stop = false; let timer;
    async function tick() {
      try {
        const log = pve ? await api.pveTaskLog(pve.id, pve.upid) : await api.taskLog(upid);
        if (!stop) setPct(parseProgress(log));
      } catch { /* ignore */ }
      if (!stop) timer = setTimeout(tick, 3000);
    }
    tick();
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [upid, pve?.id, pve?.upid]);

  if (pct == null) return <span className="badge run">{tr('en ejecución')}</span>;
  return (
    <div style={{ minWidth: 96 }}>
      <div className="bar" style={{ marginTop: 0 }}><span style={{ width: `${pct}%`, background: 'var(--info)' }} /></div>
      <div style={{ fontSize: 10.5, color: 'var(--info)', marginTop: 2, fontFamily: 'var(--mono)', fontWeight: 600 }}>{pct}% · {tr('en curso')}</div>
    </div>
  );
}

function TaskLogModal({ task, pve, onClose, onStop, stopping }) {
  const tr = useT();
  const log = useAsync(
    () => (pve ? api.pveTaskLog(pve.id, pve.upid) : api.taskLog(task.upid)),
    [task.upid, pve?.id, pve?.upid],
  );
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
            {tr(taskTypeLabel(task.type))} {task.id && <span className="mono muted" style={{ fontSize: 14 }}>· {task.id}</span>}
            {vmid && names[vmid] && <span className="muted" style={{ fontSize: 14 }}> · {names[vmid]}</span>}
          </h3>
          <TaskBadge task={task} />
        </div>
        <p className="muted mono" style={{ fontSize: 11.5, wordBreak: 'break-all', margin: '4px 0 12px' }}>{task.upid}</p>
        {pct != null && (
          <div style={{ margin: '0 0 12px' }}>
            <div className="flex-between" style={{ fontSize: 12, color: 'var(--info)', marginBottom: 4 }}><span>{tr('Progreso')}</span><span className="mono" style={{ fontWeight: 600 }}>{pct}%</span></div>
            <div className="bar" style={{ height: 9 }}><span style={{ width: `${pct}%`, background: 'var(--info)' }} /></div>
          </div>
        )}
        {log.loading ? (
          <Loading />
        ) : log.error ? (
          <ErrorBox error={log.error} />
        ) : (
          <div className="log" ref={logRef}>
            {(log.data || []).map((l) => l.t).join('\n') || tr('(sin salida)')}
          </div>
        )}
        <div className="btn-row" style={{ justifyContent: 'space-between', marginTop: 14 }}>
          <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>{running ? (pve ? tr('Log de PVE (vzdump) · actualizándose cada 3 s…') : tr('Actualizándose cada 3 s…')) : `${tr('Finalizada')} · ${fmtDate(task.endtime)}`}</span>
          <div className="btn-row">
            {onStop && (
              <button className="btn danger" style={{ background: 'var(--err)', borderColor: 'var(--err)', color: '#fff' }} disabled={stopping} onClick={onStop}>
                <Icon.x width={14} height={14} /> {stopping ? tr('Deteniendo…') : tr('Detener tarea')}
              </button>
            )}
            <button className="btn" onClick={onClose}>{tr('Cerrar')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import { useEffect, useState } from 'react';
import { api, fmtDate } from '../api.js';
import { Loading, ErrorBox, confirmDialog } from './common.jsx';
import { Icon } from './icons.jsx';
import { useT } from '../i18n.jsx';

const FREQS = [['daily', 'Diario'], ['weekly', 'Semanal'], ['monthly', 'Mensual']];
const WEEKDAYS = [['1', 'Lunes'], ['2', 'Martes'], ['3', 'Miércoles'], ['4', 'Jueves'], ['5', 'Viernes'], ['6', 'Sábado'], ['7', 'Domingo']];

/** Restauraciones programadas: tests periódicos y restauraciones puntuales. */
export default function RestoreJobs() {
  const tr = useT();
  const [pveList, setPveList] = useState(null);
  const [jobs, setJobs] = useState(null);
  const [editing, setEditing] = useState(null);
  const [msg, setMsg] = useState(null);

  function load() { api.restoreJobs().then(setJobs).catch((e) => setMsg(`Error: ${e.message}`)); }
  useEffect(() => { api.pveList().then(setPveList).catch(() => setPveList([])); load(); }, []);

  async function run(j) {
    if (!(await confirmDialog({ message: `${tr('¿Lanzar ahora la restauración')} «${j.name}»? ${tr('Es una acción destructiva sobre la VM destino.')}`, danger: true, confirmLabel: tr('Lanzar') }))) return;
    setMsg(null);
    try { const r = await api.restoreJobRun(j.id); setMsg(`${tr('Restauración lanzada. Tarea:')} ${r.upid}`); }
    catch (e) { setMsg(`Error: ${e.message}`); }
  }
  async function remove(j) {
    if (!(await confirmDialog({ message: `${tr('¿Eliminar el trabajo')} «${j.name}»?`, danger: true, confirmLabel: tr('Eliminar') }))) return;
    try { await api.restoreJobDelete(j.id); load(); } catch (e) { setMsg(`Error: ${e.message}`); }
  }

  if (pveList === null || jobs === null) return <Loading />;
  if (!pveList.length) {
    return <div className="card card-pad muted">{tr('Añade una conexión Proxmox VE en Configuración para programar restauraciones.')}</div>;
  }
  const pveName = (id) => pveList.find((p) => p.id === id)?.name || id;

  return (
    <div>
      <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', background: 'var(--info-soft)', border: '1px solid #cfe0fb', color: '#2257c4', padding: '10px 13px', borderRadius: 8, fontSize: 12.5, marginBottom: 14 }}>
        <span style={{ flexShrink: 0, marginTop: 1 }}><Icon.restore width={16} height={16} /></span>
        <span>{tr('Programa restauraciones del ')}<b>{tr('último backup')}</b>{tr(' de una VM: de forma recurrente (prueba de restauración para validar tus copias) o puntual. Restaura a la VMID destino indicada y avisa por email al terminar. ')}<b>{tr('Si marcas «sobrescribir», reemplaza la VM destino: úsalo con cuidado.')}</b></span>
      </div>

      <div className="flex-between" style={{ marginBottom: 14 }}>
        <span className="muted" style={{ fontSize: 13 }}>{tr('Trabajos de restauración programada')}</span>
        <button className="btn primary sm" onClick={() => setEditing({})}><Icon.bolt width={14} height={14} /> {tr('Nueva restauración programada')}</button>
      </div>

      {msg && <div className="banner">{msg}</div>}

      <div className="card">
        <table>
          <thead>
            <tr><th>{tr('Nombre')}</th><th>{tr('Origen → Destino')}</th><th>{tr('Programación')}</th><th>{tr('Último resultado')}</th><th>{tr('Estado')}</th><th style={{ width: 1 }}>{tr('Acciones')}</th></tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td><strong>{j.name}</strong><div className="muted" style={{ fontSize: 11 }}>{pveName(j.pveId)}</div></td>
                <td className="mono" style={{ fontSize: 12 }}>
                  {(j.type === 'lxc' ? 'CT' : 'VM')} {j.sourceVmid} → {j.targetVmid}
                  {j.force && <span className="badge err" style={{ marginLeft: 6 }}>{tr('sobrescribe')}</span>}
                </td>
                <td style={{ fontSize: 12.5 }}>{scheduleSummary(j, tr)}</td>
                <td>{resultBadge(j.lastResult, tr)}</td>
                <td>{j.enabled ? <span className="badge ok">{tr('activo')}</span> : <span className="badge muted">{tr('deshabilitado')}</span>}</td>
                <td>
                  <div className="btn-row" style={{ flexWrap: 'nowrap' }}>
                    <button className="btn sm" onClick={() => run(j)} title={tr('Lanzar ahora')}><Icon.play width={13} height={13} /></button>
                    <button className="btn sm ghost" onClick={() => setEditing(j)}>{tr('Editar')}</button>
                    <button className="btn sm ghost danger" onClick={() => remove(j)}>{tr('Eliminar')}</button>
                  </div>
                </td>
              </tr>
            ))}
            {!jobs.length && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 28 }}>{tr('No hay restauraciones programadas.')}</td></tr>}
          </tbody>
        </table>
      </div>

      {editing && <RestoreJobModal pveList={pveList} job={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} onError={(m) => setMsg(`Error: ${m}`)} />}
    </div>
  );
}

function scheduleSummary(j, tr) {
  const s = j.schedule || {};
  if (s.type === 'oneoff') return `${tr('Puntual')} · ${s.runAt ? s.runAt.replace('T', ' ') : '—'}`;
  const fq = { daily: tr('Diario'), weekly: tr('Semanal'), monthly: tr('Mensual') }[s.frequency] || s.frequency;
  const when = s.frequency === 'weekly' ? ` · ${(WEEKDAYS.find(([k]) => k === String(s.weekday)) || [, ''])[1] && tr((WEEKDAYS.find(([k]) => k === String(s.weekday)))[1])}`
    : s.frequency === 'monthly' ? ` · ${tr('día')} ${s.dayOfMonth}` : '';
  return `${fq}${when} · ${String(s.hour).padStart(2, '0')}:00`;
}

function resultBadge(r, tr) {
  if (!r) return <span className="muted">—</span>;
  if (r.status === 'error') return <span className="badge err" title={r.error}>{tr('error')}</span>;
  if (r.ok) return <span className="badge ok" title={r.upid}>OK · {fmtDate(r.at)}</span>;
  return <span className="badge err" title={r.upid}>{r.status} · {fmtDate(r.at)}</span>;
}

function RestoreJobModal({ pveList, job, onClose, onSaved, onError }) {
  const tr = useT();
  const isNew = !job.id;
  const [form, setForm] = useState(() => ({
    name: job.name || '', enabled: job.enabled !== false,
    pveId: job.pveId || pveList[0]?.id || '', node: job.node || '', storage: job.storage || '',
    type: job.type || 'vm', sourceVmid: job.sourceVmid || '', targetVmid: job.targetVmid || '',
    targetStorage: job.targetStorage || '', force: !!job.force, start: !!job.start,
    schedule: {
      type: job.schedule?.type || 'recurring', frequency: job.schedule?.frequency || 'weekly',
      weekday: job.schedule?.weekday || 1, dayOfMonth: job.schedule?.dayOfMonth || 1,
      hour: job.schedule?.hour ?? 3, runAt: job.schedule?.runAt || '',
    },
  }));
  const [nodes, setNodes] = useState([]);
  const [storages, setStorages] = useState([]);
  const [guests, setGuests] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setSch = (k, v) => setForm((f) => ({ ...f, schedule: { ...f.schedule, [k]: v } }));

  // Cargar nodos + guests al cambiar de PVE
  useEffect(() => {
    if (!form.pveId) return;
    api.pveNodes(form.pveId).then((n) => { setNodes(n || []); if (!form.node && n?.[0]) set('node', n[0].node); }).catch(() => setNodes([]));
    api.pveGuests(form.pveId).then((g) => setGuests((g || []).slice().sort((a, b) => a.vmid - b.vmid))).catch(() => setGuests([]));
    // eslint-disable-next-line
  }, [form.pveId]);

  // Cargar almacenamientos al cambiar de nodo
  useEffect(() => {
    if (!form.pveId || !form.node) return;
    api.pveStorages(form.pveId, form.node).then((st) => {
      setStorages(st || []);
      if (!form.storage) { const pbs = (st || []).find((s) => s.type === 'pbs'); if (pbs) set('storage', pbs.storage); }
    }).catch(() => setStorages([]));
    // eslint-disable-next-line
  }, [form.pveId, form.node]);

  const pbsStores = storages.filter((s) => s.type === 'pbs');
  const diskStores = storages.filter((s) => (s.content || '').includes('images') && s.type !== 'pbs');

  async function save(e) {
    e.preventDefault();
    if (!form.sourceVmid) { onError(tr('Indica la VM origen')); return; }
    if (!form.targetVmid) { onError(tr('Indica la VMID destino')); return; }
    if (!form.storage || !form.targetStorage) { onError(tr('Selecciona el almacenamiento de backups y el de destino')); return; }
    if (form.schedule.type === 'oneoff' && !form.schedule.runAt) { onError(tr('Indica la fecha y hora de la restauración puntual')); return; }
    setBusy(true);
    try {
      if (isNew) await api.restoreJobCreate(form); else await api.restoreJobUpdate(job.id, form);
      onSaved();
    } catch (err) { onError(err.message); setBusy(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
        <h3>{isNew ? tr('Nueva') : tr('Editar')} {tr('restauración programada')}</h3>
        <form onSubmit={save}>
          <div className="field"><label>{tr('Nombre')}</label>
            <input className="input" value={form.name} placeholder={tr('Test de restauración semanal')} onChange={(e) => set('name', e.target.value)} />
          </div>

          <div className="row">
            <div className="field"><label>{tr('Servidor Proxmox VE')}</label>
              <select value={form.pveId} onChange={(e) => { set('pveId', e.target.value); set('node', ''); set('storage', ''); set('targetStorage', ''); }}>
                {pveList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="field"><label>{tr('Nodo')}</label>
              <select value={form.node} onChange={(e) => { set('node', e.target.value); set('storage', ''); set('targetStorage', ''); }}>
                {nodes.map((n) => <option key={n.node} value={n.node}>{n.node}</option>)}
              </select>
            </div>
          </div>

          <div className="row">
            <div className="field"><label>{tr('Tipo')}</label>
              <select value={form.type} onChange={(e) => set('type', e.target.value)}>
                <option value="vm">VM (QEMU)</option><option value="lxc">CT (LXC)</option>
              </select>
            </div>
            <div className="field"><label>{tr('VM origen (de la que restaurar el último backup)')}</label>
              <input className="input" list="restore-guests" value={form.sourceVmid} placeholder="103" onChange={(e) => set('sourceVmid', e.target.value.replace(/\D/g, ''))} />
              <datalist id="restore-guests">{guests.map((g) => <option key={g.vmid} value={g.vmid}>{g.name}</option>)}</datalist>
            </div>
          </div>

          <div className="field"><label>{tr('Almacenamiento de backups (PBS)')}</label>
            <select value={form.storage} onChange={(e) => set('storage', e.target.value)} required>
              <option value="">{tr('— elegir —')}</option>
              {pbsStores.map((s) => <option key={s.storage} value={s.storage}>{s.storage}</option>)}
              {form.storage && !pbsStores.some((s) => s.storage === form.storage) && <option value={form.storage}>{form.storage}</option>}
            </select>
          </div>

          <div className="row">
            <div className="field"><label>{tr('VMID destino')}</label>
              <input className="input" value={form.targetVmid} placeholder="999" onChange={(e) => set('targetVmid', e.target.value.replace(/\D/g, ''))} />
            </div>
            <div className="field"><label>{tr('Almacenamiento destino (discos)')}</label>
              <select value={form.targetStorage} onChange={(e) => set('targetStorage', e.target.value)} required>
                <option value="">{tr('— elegir —')}</option>
                {diskStores.map((s) => <option key={s.storage} value={s.storage}>{s.storage}</option>)}
                {form.targetStorage && !diskStores.some((s) => s.storage === form.targetStorage) && <option value={form.targetStorage}>{form.targetStorage}</option>}
              </select>
            </div>
          </div>

          <div className="btn-row" style={{ gap: 18, margin: '2px 0 12px' }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={form.force} onChange={(e) => set('force', e.target.checked)} />
              <span style={{ color: form.force ? 'var(--err)' : 'var(--text-2)', fontWeight: form.force ? 600 : 400 }}>{tr('Sobrescribir la VM destino si existe (destructivo)')}</span>
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={form.start} onChange={(e) => set('start', e.target.checked)} /><span className="muted">{tr('Arrancar tras restaurar')}</span>
            </label>
          </div>

          <div className="field"><label>{tr('Programación')}</label>
            <div className="seg" style={{ marginBottom: 8 }}>
              <button type="button" className={form.schedule.type === 'recurring' ? 'active' : ''} onClick={() => setSch('type', 'recurring')}>{tr('Recurrente')}</button>
              <button type="button" className={form.schedule.type === 'oneoff' ? 'active' : ''} onClick={() => setSch('type', 'oneoff')}>{tr('Puntual')}</button>
            </div>
            {form.schedule.type === 'oneoff' ? (
              <input className="input" type="datetime-local" value={form.schedule.runAt} onChange={(e) => setSch('runAt', e.target.value)} />
            ) : (
              <div className="row">
                <div className="field" style={{ margin: 0 }}><label>{tr('Frecuencia')}</label>
                  <select value={form.schedule.frequency} onChange={(e) => setSch('frequency', e.target.value)}>
                    {FREQS.map(([k, l]) => <option key={k} value={k}>{tr(l)}</option>)}
                  </select>
                </div>
                {form.schedule.frequency === 'weekly' && (
                  <div className="field" style={{ margin: 0 }}><label>{tr('Día de la semana')}</label>
                    <select value={String(form.schedule.weekday)} onChange={(e) => setSch('weekday', Number(e.target.value))}>
                      {WEEKDAYS.map(([k, l]) => <option key={k} value={k}>{tr(l)}</option>)}
                    </select>
                  </div>
                )}
                {form.schedule.frequency === 'monthly' && (
                  <div className="field" style={{ margin: 0 }}><label>{tr('Día del mes')}</label>
                    <input className="input" type="number" min="1" max="28" value={form.schedule.dayOfMonth} onChange={(e) => setSch('dayOfMonth', Number(e.target.value))} />
                  </div>
                )}
                <div className="field" style={{ margin: 0 }}><label>{tr('Hora')}</label>
                  <input className="input" type="number" min="0" max="23" value={form.schedule.hour} onChange={(e) => setSch('hour', Number(e.target.value))} />
                </div>
              </div>
            )}
          </div>

          <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0 16px' }}>
            <input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} /><span className="muted">{tr('Trabajo habilitado')}</span>
          </label>

          <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={onClose}>{tr('Cancelar')}</button>
            <button className="btn primary" disabled={busy}>{busy ? tr('Guardando…') : tr('Guardar')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

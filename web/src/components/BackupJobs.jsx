import { useEffect, useState } from 'react';
import { api, fmtDate } from '../api.js';
import { Loading, ErrorBox, confirmDialog } from './common.jsx';
import { Icon } from './icons.jsx';
import { useT } from '../i18n.jsx';

const KEEP_FIELDS = [
  ['last', 'Últimas'], ['daily', 'Diarias'], ['weekly', 'Semanales'],
  ['monthly', 'Mensuales'], ['yearly', 'Anuales'],
];

const TEMPLATES = [
  { key: 'daily7', label: 'Diaria · 7 días', desc: 'Cada día a las 02:00, conserva 7', schedule: '02:00', mode: 'snapshot', keep: { daily: 7 } },
  { key: 'weekly4', label: 'Semanal · 4 semanas', desc: 'Domingos 03:00, conserva 4', schedule: 'sun 03:00', mode: 'snapshot', keep: { weekly: 4 } },
  { key: 'gfs', label: 'GFS · 7d / 4s / 6m', desc: 'Abuelo-padre-hijo', schedule: '02:00', mode: 'snapshot', keep: { daily: 7, weekly: 4, monthly: 6 } },
  { key: 'last3', label: 'Mínima · últimas 3', desc: 'Diaria, solo 3 copias', schedule: '02:00', mode: 'snapshot', keep: { last: 3 } },
];

const emptyKeep = { last: '', daily: '', weekly: '', monthly: '', yearly: '' };

const pruneSummary = (pb, tr) => {
  if (!pb) return '—';
  const obj = typeof pb === 'string' ? Object.fromEntries(pb.split(',').map((p) => p.split('='))) : pb;
  const parts = KEEP_FIELDS.map(([k, label]) => (obj[`keep-${k}`] ? `${obj[`keep-${k}`]} ${tr(label).toLowerCase()}` : null)).filter(Boolean);
  return parts.length ? parts.join(' · ') : '—';
};

/** Trabajos de copia de seguridad de Proxmox VE (vzdump). */
export default function BackupJobs() {
  const tr = useT();
  const [pveList, setPveList] = useState(null);
  const [pveId, setPveId] = useState('');
  const [jobs, setJobs] = useState(null);
  const [guests, setGuests] = useState([]);
  const [storages, setStorages] = useState([]);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    api.pveList().then((l) => {
      setPveList(l);
      setPveId(l.find((x) => x.isDefault)?.id || l[0]?.id || '');
    }).catch((e) => setErr(e.message));
  }, []);

  async function load() {
    if (!pveId) return;
    setLoading(true); setErr(null);
    try {
      const [j, g] = await Promise.all([api.pveBackupJobs(pveId), api.pveGuests(pveId).catch(() => [])]);
      setJobs(j || []);
      setGuests((g || []).slice().sort((a, b) => a.vmid - b.vmid));
      // almacenamientos PBS (del primer nodo)
      try {
        const nodes = await api.pveNodes(pveId);
        const node = nodes?.[0]?.node;
        if (node) {
          const st = await api.pveStorages(pveId, node);
          setStorages((st || []).filter((s) => s.type === 'pbs'));
        }
      } catch { /* opcional */ }
    } catch (e) { setErr(e.message); setJobs([]); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [pveId]);

  async function remove(job) {
    if (!(await confirmDialog({ message: `${tr('¿Eliminar el trabajo de copia')} "${job.comment || job.id}"?`, danger: true, confirmLabel: tr('Eliminar') }))) return;
    try { await api.pveDeleteBackupJob(pveId, job.id); load(); }
    catch (e) { setMsg(`Error: ${e.message}`); }
  }

  if (pveList === null) return <Loading />;
  if (!pveList.length) {
    return <div className="card card-pad muted">{tr('Añade una conexión Proxmox VE en Configuración para gestionar los trabajos de copia.')}</div>;
  }

  const guestName = (vmid) => guests.find((g) => String(g.vmid) === String(vmid))?.name || '';

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div className="field" style={{ margin: 0, minWidth: 220 }}>
          <label style={{ fontSize: 11 }}>{tr('Servidor Proxmox VE')}</label>
          <select value={pveId} onChange={(e) => setPveId(e.target.value)}>
            {pveList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <button className="btn primary sm" onClick={() => setEditing({})} style={{ alignSelf: 'flex-end' }}>
          <Icon.bolt width={14} height={14} /> {tr('Nuevo trabajo')}
        </button>
      </div>

      {msg && <div className="banner">{msg}</div>}
      {err && <ErrorBox error={err} />}

      <div className="card">
        {loading ? <Loading /> : (
          <table>
            <thead>
              <tr><th>{tr('Trabajo')}</th><th>{tr('Máquinas')}</th><th>{tr('Programación')}</th><th>{tr('Retención')}</th><th>{tr('Destino')}</th><th>{tr('Estado')}</th><th style={{ width: 1 }}>{tr('Acciones')}</th></tr>
            </thead>
            <tbody>
              {(jobs || []).map((j) => (
                <tr key={j.id}>
                  <td>
                    <strong>{j.comment || tr('(sin nombre)')}</strong>
                    <div className="muted mono" style={{ fontSize: 11 }}>{j.id}</div>
                  </td>
                  <td>
                    {j.all ? <span className="badge info plain">{tr('todas')}</span>
                      : String(j.vmid || '').split(',').map((v) => (
                        <span key={v} className="badge muted plain" style={{ marginRight: 4 }} title={guestName(v)}>{v}{guestName(v) ? ` · ${guestName(v)}` : ''}</span>
                      ))}
                  </td>
                  <td><span className="badge info plain">{j.schedule || 'manual'}</span>{j['next-run'] && <div className="muted" style={{ fontSize: 11 }}>{tr('próx.')} {fmtDate(j['next-run'])}</div>}</td>
                  <td className="muted" style={{ fontSize: 12.5 }}>{pruneSummary(j['prune-backups'], tr)}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{j.storage}</td>
                  <td>{j.enabled ? <span className="badge ok">{tr('activo')}</span> : <span className="badge muted">{tr('deshabilitado')}</span>}</td>
                  <td>
                    <div className="btn-row" style={{ flexWrap: 'nowrap' }}>
                      <button className="btn sm ghost" onClick={() => setEditing(j)}>{tr('Editar')}</button>
                      <button className="btn sm ghost danger" onClick={() => remove(j)}>{tr('Eliminar')}</button>
                    </div>
                  </td>
                </tr>
              ))}
              {jobs && !jobs.length && (
                <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 28 }}>{tr('No hay trabajos de copia. Crea uno con «Nuevo trabajo».')}</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <JobModal
          pveId={pveId} job={editing} guests={guests} storages={storages}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
          onError={(m) => setMsg(`Error: ${m}`)}
        />
      )}
    </div>
  );
}

function JobModal({ pveId, job, guests, storages, onClose, onSaved, onError }) {
  const tr = useT();
  const isNew = !job.id;
  const init = () => {
    const pb = job['prune-backups'];
    const obj = !pb ? {} : (typeof pb === 'string' ? Object.fromEntries(pb.split(',').map((p) => p.split('='))) : pb);
    const keep = { ...emptyKeep };
    for (const [k] of KEEP_FIELDS) if (obj[`keep-${k}`]) keep[k] = obj[`keep-${k}`];
    return {
      comment: job.comment || '',
      schedule: job.schedule || '02:00',
      storage: job.storage || storages[0]?.storage || '',
      mode: job.mode || 'snapshot',
      enabled: job.enabled === undefined ? true : !!job.enabled,
      selAll: !!job.all,
      vmids: new Set(job.vmid ? String(job.vmid).split(',') : []),
      keep,
    };
  };
  const [form, setForm] = useState(init);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggleVm = (vmid) => setForm((f) => {
    const s = new Set(f.vmids);
    s.has(String(vmid)) ? s.delete(String(vmid)) : s.add(String(vmid));
    return { ...f, vmids: s };
  });
  const applyTemplate = (t) => setForm((f) => ({ ...f, schedule: t.schedule, mode: t.mode, keep: { ...emptyKeep, ...t.keep } }));

  async function save(e) {
    e.preventDefault();
    if (!form.selAll && form.vmids.size === 0) { onError(tr('Selecciona al menos una máquina o marca «Todas»')); return; }
    if (!form.storage) { onError(tr('Selecciona el almacenamiento destino')); return; }
    setBusy(true);
    try {
      const prune = KEEP_FIELDS.map(([k]) => (form.keep[k] ? `keep-${k}=${form.keep[k]}` : null)).filter(Boolean).join(',');
      const body = {
        schedule: form.schedule,
        storage: form.storage,
        mode: form.mode,
        enabled: form.enabled ? 1 : 0,
        comment: form.comment,
        compress: 'zstd',
      };
      if (prune) body['prune-backups'] = prune;
      const del = [];
      if (form.selAll) { body.all = 1; del.push('vmid', 'pool'); }
      else { body.vmid = [...form.vmids].join(','); del.push('all', 'pool'); }
      if (!prune && !isNew) del.push('prune-backups');
      if (!form.comment && !isNew) del.push('comment');
      if (!isNew && del.length) body.delete = del.filter((d) => d !== 'comment' || !form.comment).join(',');

      if (isNew) await api.pveCreateBackupJob(pveId, body);
      else await api.pveUpdateBackupJob(pveId, job.id, body);
      onSaved();
    } catch (err) { onError(err.message); setBusy(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
        <h3>{isNew ? tr('Nuevo') : tr('Editar')} {tr('trabajo de copia de seguridad')}</h3>

        <label style={{ fontSize: 12.5, color: 'var(--text-2)', fontWeight: 500 }}>{tr('Plantillas')}</label>
        <div className="btn-row" style={{ margin: '6px 0 14px' }}>
          {TEMPLATES.map((t) => (
            <button key={t.key} type="button" className="btn sm" onClick={() => applyTemplate(t)} title={tr(t.desc)}>{tr(t.label)}</button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', background: 'var(--info-soft)', border: '1px solid #cfe0fb', color: '#2257c4', padding: '9px 12px', borderRadius: 8, fontSize: 12.5, marginBottom: 16 }}>
          <span style={{ flexShrink: 0, marginTop: 1 }}><Icon.shield width={16} height={16} /></span>
          <span>{tr('Las copias a PBS son ')}<b>{tr('incrementales y deduplicadas')}</b>{tr(' por diseño: tras la primera, solo se suben los bloques que cambian. Cada punto de restauración es completo. La retención de abajo solo decide cuántos puntos se conservan.')}</span>
        </div>

        <form onSubmit={save}>
          <div className="field"><label>{tr('Nombre / comentario')}</label>
            <input className="input" value={form.comment} placeholder={tr('Copia diaria servidores')} onChange={(e) => set('comment', e.target.value)} />
          </div>

          <div className="row">
            <div className="field"><label>{tr('Programación (calendar event)')}</label>
              <input className="input" value={form.schedule} placeholder="02:00 · sun 03:00 · mon..fri 22:00" onChange={(e) => set('schedule', e.target.value)} required />
            </div>
            <div className="field"><label>{tr('Modo')}</label>
              <select value={form.mode} onChange={(e) => set('mode', e.target.value)}>
                <option value="snapshot">{tr('snapshot (en caliente)')}</option>
                <option value="suspend">suspend</option>
                <option value="stop">stop</option>
              </select>
            </div>
          </div>

          {form.mode !== 'snapshot' && (
            <div style={{ background: 'var(--warn-soft)', border: '1px solid #f0d9a8', color: '#a06806', padding: '8px 12px', borderRadius: 8, fontSize: 12.5, marginBottom: 14 }}>
              {tr('⚠ En modo «')}{form.mode}{tr('» no se usa el ')}<b>dirty-bitmap</b>{tr(': cada copia re-lee el disco entero (a PBS sigue subiendo solo los cambios, pero es más lento). Para incremental rápido, usa ')}<b>snapshot</b>.
            </div>
          )}

          <div className="field"><label>{tr('Almacenamiento destino (PBS)')}</label>
            <select value={form.storage} onChange={(e) => set('storage', e.target.value)} required>
              <option value="">{tr('— elegir —')}</option>
              {storages.map((s) => <option key={s.storage} value={s.storage}>{s.storage}</option>)}
              {form.storage && !storages.some((s) => s.storage === form.storage) && <option value={form.storage}>{form.storage}</option>}
            </select>
          </div>

          <div className="field">
            <label>{tr('Máquinas a respaldar')}</label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 400, color: 'var(--text)' }}>
              <input type="checkbox" checked={form.selAll} onChange={(e) => set('selAll', e.target.checked)} /> {tr('Todas las máquinas del cluster')}
            </label>
            {!form.selAll && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8, maxHeight: 160, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
                {guests.map((g) => (
                  <label key={g.vmid} style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 13 }}>
                    <input type="checkbox" checked={form.vmids.has(String(g.vmid))} onChange={() => toggleVm(g.vmid)} />
                    <span className="mono">{g.vmid}</span> <span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="field">
            <label>{tr('Retención (cuántas copias conservar)')}</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
              {KEEP_FIELDS.map(([k, lbl]) => (
                <div key={k}>
                  <div className="muted" style={{ fontSize: 11, marginBottom: 3 }}>{tr(lbl)}</div>
                  <input className="input" type="number" min="0" value={form.keep[k]} onChange={(e) => set('keep', { ...form.keep, [k]: e.target.value })} />
                </div>
              ))}
            </div>
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

// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import { useEffect, useState } from 'react';
import { api, fmtDate } from '../api.js';
import { Loading, ErrorBox, confirmDialog } from './common.jsx';
import { Icon } from './icons.jsx';
import { useT } from '../i18n.jsx';
import ScheduleField from './ScheduleField.jsx';

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
  const [fleeceStores, setFleeceStores] = useState([]);
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
          // Para el fleecing hace falta un almacenamiento LOCAL que admita imágenes
          // (no el destino PBS): dir/lvm/lvmthin/zfs/btrfs… con content «images».
          setFleeceStores((st || []).filter((s) => s.type !== 'pbs' && String(s.content || '').includes('images')));
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

  async function run(job) {
    if (!(await confirmDialog({ message: `${tr('¿Lanzar ahora la copia de seguridad')} «${job.comment || job.id}»?`, confirmLabel: tr('Lanzar') }))) return;
    setMsg(null);
    try {
      const r = await api.pveRunBackupJob(pveId, job.id);
      const upids = (r.results || []).filter((x) => x.upid).map((x) => x.upid);
      const errs = (r.results || []).filter((x) => x.error);
      setMsg(`${tr('Copia lanzada.')}${upids.length ? ` ${tr('Tarea:')} ${upids.join(', ')}` : ''}${errs.length ? ` · ${errs.map((e) => `${e.node}: ${e.error}`).join('; ')}` : ''}`);
    } catch (e) { setMsg(`Error: ${e.message}`); }
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
                  <td className="mono" style={{ fontSize: 12 }}>
                    {j.storage}
                    {j.encrypt ? <span className="badge ok plain" style={{ marginLeft: 6, fontSize: 11 }}>&#128274; {tr('cifrado')}</span> : null}
                  </td>
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
              {jobs && !jobs.length && (
                <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 28 }}>{tr('No hay trabajos de copia. Crea uno con «Nuevo trabajo».')}</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <JobModal
          pveId={pveId} job={editing} guests={guests} storages={storages} fleeceStores={fleeceStores}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
          onError={(m) => setMsg(`Error: ${m}`)}
        />
      )}
    </div>
  );
}

// Parseo de property-strings de PVE ("clave=valor,clave=valor").
const parsePropStr = (s) => (!s ? {} : Object.fromEntries(String(s).split(',').map((p) => p.split('=')).filter((kv) => kv[0])));

function JobModal({ pveId, job, guests, storages, fleeceStores = [], onClose, onSaved, onError }) {
  const tr = useT();
  const isNew = !job.id;
  const init = () => {
    const pb = job['prune-backups'];
    const obj = !pb ? {} : (typeof pb === 'string' ? Object.fromEntries(pb.split(',').map((p) => p.split('='))) : pb);
    const keep = { ...emptyKeep };
    for (const [k] of KEEP_FIELDS) if (obj[`keep-${k}`]) keep[k] = obj[`keep-${k}`];
    const fl = parsePropStr(job.fleecing);
    const perf = parsePropStr(job.performance);
    return {
      comment: job.comment || '',
      schedule: job.schedule || '02:00',
      storage: job.storage || storages[0]?.storage || '',
      mode: job.mode || 'snapshot',
      enabled: job.enabled === undefined ? true : !!job.enabled,
      encrypt: !!job.encrypt,
      selAll: !!job.all,
      vmids: new Set(job.vmid ? String(job.vmid).split(',') : []),
      keep,
      // Rendimiento (opcional)
      bwlimit: job.bwlimit ? String(job.bwlimit) : '',
      fleecing: fl.enabled === '1' || fl.enabled === 1,
      fleeceStorage: fl.storage || '',
      maxWorkers: perf['max-workers'] ? String(perf['max-workers']) : '',
    };
  };
  const [form, setForm] = useState(init);
  const [busy, setBusy] = useState(false);
  const [encryptHelp, setEncryptHelp] = useState(false);
  const [info, setInfo] = useState(null); // { title, body } para el popup de ayuda "i"
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
    if (!form.schedule.trim()) { onError(tr('Indica una programación')); return; }
    if (form.fleecing && !form.fleeceStorage) { onError(tr('Elige el almacenamiento local para el fleecing')); return; }
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
      if (form.encrypt) body.encrypt = 1;
      if (prune) body['prune-backups'] = prune;
      // Rendimiento (opcional)
      const bw = parseInt(form.bwlimit, 10);
      if (Number.isFinite(bw) && bw > 0) body.bwlimit = bw;
      if (form.fleecing) body.fleecing = `enabled=1,storage=${form.fleeceStorage}`;
      const mw = parseInt(form.maxWorkers, 10);
      if (Number.isFinite(mw) && mw > 0) body.performance = `max-workers=${mw}`;
      // Selección de máquinas (all vs vmid): siempre se fija una.
      if (form.selAll) body.all = 1;
      else body.vmid = [...form.vmids].join(',');

      // Campos opcionales a limpiar cuando quedan vacíos/desactivados. Solo se envían
      // en `delete` los que REALMENTE existían en el trabajo: PVE rechaza borrar una
      // opción que el job no tiene (p. ej. `delete: unknown option 'encrypt'`).
      const has = (k) => job[k] !== undefined && job[k] !== null && job[k] !== '';
      const maybeDelete = [];
      if (form.selAll) maybeDelete.push('vmid', 'pool'); else maybeDelete.push('all', 'pool');
      if (!prune) maybeDelete.push('prune-backups');
      if (!form.comment) maybeDelete.push('comment');
      if (!form.encrypt) maybeDelete.push('encrypt');
      if (!(Number.isFinite(bw) && bw > 0)) maybeDelete.push('bwlimit');
      if (!form.fleecing) maybeDelete.push('fleecing');
      if (!(Number.isFinite(mw) && mw > 0)) maybeDelete.push('performance');
      if (!isNew) {
        const del = maybeDelete.filter(has);
        if (del.length) body.delete = del.join(',');
      }

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
            <ScheduleField label={tr('Programación')} value={form.schedule} onChange={(v) => set('schedule', v)} placeholder="02:00 · sun 03:00 · mon..fri 22:00" />
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

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '4px 0 16px', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}>
                <input type="checkbox" checked={form.encrypt} onChange={(e) => set('encrypt', e.target.checked)} />
                <span style={{ fontWeight: 500 }}>{tr('Cifrar los datos (encrypt)')}</span>
              </label>
              <button type="button" className="btn sm ghost" title={tr('Cómo configurar el cifrado')} onClick={() => setEncryptHelp(true)}
                style={{ padding: '2px 7px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Icon.info width={13} height={13} /> {tr('Ayuda')}
              </button>
            </div>
            {form.encrypt && (
              <p style={{ margin: 0, color: 'var(--text-2)', fontSize: 12 }}>
                {tr('Requiere clave de cifrado configurada en PVE para el almacenamiento PBS seleccionado.')}
              </p>
            )}
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} />
              <span className="muted">{tr('Trabajo habilitado')}</span>
            </label>
          </div>

          <div style={{ margin: '4px 0 16px', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8 }}>
            <div style={{ fontWeight: 500, fontSize: 13.5, marginBottom: 2 }}>{tr('Rendimiento (opcional)')}</div>
            <p className="muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 10 }}>
              {tr('Ajustes para reducir el impacto de la copia en el rendimiento de la máquina (útil en VMs grandes o primeros backups largos).')}
            </p>

            <div className="row">
              <div className="field">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {tr('Límite de velocidad')}
                  <InfoDot onClick={() => setInfo(INFO.bwlimit(tr))} tr={tr} />
                  {form.bwlimit !== '' && <ResetBtn onClick={() => set('bwlimit', '')} tr={tr} />}
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input className="input" type="number" min="0" placeholder="0" value={form.bwlimit} onChange={(e) => set('bwlimit', e.target.value)} />
                  <span className="muted" style={{ fontSize: 12 }}>KiB/s</span>
                </div>
              </div>
              <div className="field">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {tr('Lectores en paralelo')}
                  <InfoDot onClick={() => setInfo(INFO.maxWorkers(tr))} tr={tr} />
                  {form.maxWorkers !== '' && <ResetBtn onClick={() => set('maxWorkers', '')} tr={tr} />}
                </label>
                <input className="input" type="number" min="1" max="32" placeholder={tr('por defecto 16')} value={form.maxWorkers} onChange={(e) => set('maxWorkers', e.target.value)} />
              </div>
            </div>

            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
              <input type="checkbox" checked={form.fleecing} onChange={(e) => set('fleecing', e.target.checked)} />
              <span>{tr('Backup fleecing')}</span>
              <InfoDot onClick={() => setInfo(INFO.fleecing(tr))} tr={tr} />
              <span className="muted" style={{ fontSize: 11.5 }}>{tr('(PVE 8.2+)')}</span>
              {form.fleecing && <ResetBtn onClick={() => { set('fleecing', false); set('fleeceStorage', ''); }} tr={tr} />}
            </label>
            {form.fleecing && (
              <div className="field" style={{ marginTop: 8 }}>
                <label>{tr('Almacenamiento local para el fleecing')}</label>
                <select value={form.fleeceStorage} onChange={(e) => set('fleeceStorage', e.target.value)}>
                  <option value="">{tr('— elegir —')}</option>
                  {fleeceStores.map((s) => <option key={s.storage} value={s.storage}>{`${s.storage} (${s.type})`}</option>)}
                  {form.fleeceStorage && !fleeceStores.some((s) => s.storage === form.fleeceStorage) && <option value={form.fleeceStorage}>{form.fleeceStorage}</option>}
                </select>
                {!fleeceStores.length && <p className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>{tr('No se han detectado almacenamientos locales con soporte de imágenes; escribe el nombre si sabes cuál usar.')}</p>}
              </div>
            )}
          </div>

          {encryptHelp && <EncryptHelpModal onClose={() => setEncryptHelp(false)} storage={form.storage} tr={tr} />}
          {info && <InfoModal info={info} onClose={() => setInfo(null)} tr={tr} />}

          <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={onClose}>{tr('Cancelar')}</button>
            <button className="btn primary" disabled={busy}>{busy ? tr('Guardando…') : tr('Guardar')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Botón "i" redondo que abre el popup de ayuda de una característica.
function InfoDot({ onClick, tr }) {
  return (
    <button type="button" onClick={onClick} aria-label={tr('Más información')} title={tr('Más información')}
      style={{ flexShrink: 0, width: 16, height: 16, lineHeight: '15px', textAlign: 'center', borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-2)', fontSize: 11, fontStyle: 'italic', fontWeight: 700, cursor: 'pointer', padding: 0, fontFamily: 'Georgia, serif' }}>
      i
    </button>
  );
}

// Botón pequeño para restablecer un ajuste a su valor por defecto de Proxmox.
function ResetBtn({ onClick, tr }) {
  return (
    <button type="button" className="btn sm ghost" onClick={onClick} title={tr('Volver al valor por defecto')}
      style={{ padding: '1px 7px', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <Icon.refresh width={11} height={11} /> {tr('Por defecto')}
    </button>
  );
}

// Contenido de los popups de ayuda de cada ajuste de rendimiento. Cada uno incluye
// un valor recomendado para VMs críticas cuyo rendimiento no debe verse mermado.
const INFO = {
  bwlimit: (tr) => ({
    title: tr('Límite de velocidad (bwlimit)'),
    body: tr('Limita la velocidad de la copia, en KiB/s. Suaviza el impacto de la copia en el rendimiento de la máquina a cambio de que tarde más. 0 (o vacío) = sin límite propio (usa el valor global de Proxmox). Referencia: 102400 KiB/s ≈ 100 MiB/s.'),
    rec: tr('VM crítica: limita a una fracción de tu disco/red, por ejemplo 30–50 MiB/s (30720–51200 KiB/s). La copia irá más lenta, pero la VM seguirá funcionando con normalidad.'),
  }),
  maxWorkers: (tr) => ({
    title: tr('Lectores en paralelo (max-workers)'),
    body: tr('Número de hilos que leen el disco a la vez durante la copia (por defecto 16 en QEMU). Bajarlo reduce la presión de I/O sobre el almacenamiento y el impacto en la máquina en marcha, a cambio de ir más lento. Vacío = valor por defecto de Proxmox.'),
    rec: tr('VM crítica: 1 (un solo lector). Minimiza la contención de disco; la copia tarda más, pero la VM apenas nota que se está copiando.'),
  }),
  fleecing: (tr) => ({
    title: tr('Backup fleecing (PVE 8.2+)'),
    body: tr('Guarda temporalmente, en un almacenamiento local, los bloques que la máquina sobrescribe mientras se hace la copia. Así las escrituras del sistema operativo no tienen que esperar al ritmo del backup, reduciendo mucho el impacto en el rendimiento de la VM durante la copia (sobre todo con destinos lentos o primeros backups largos). Necesita un almacenamiento local rápido con espacio para imágenes; esa área temporal se libera al terminar.'),
    rec: tr('VM crítica: actívalo con un almacenamiento local rápido. Es lo que más protege el rendimiento: la VM sigue funcionando con normalidad aunque la copia tarde más.'),
  }),
};

function InfoModal({ info, onClose, tr }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>{info.title}</h3>
        <p style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--text)' }}>{info.body}</p>
        {info.rec && (
          <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', background: 'var(--info-soft)', border: '1px solid #cfe0fb', color: '#2257c4', padding: '9px 12px', borderRadius: 8, fontSize: 12.5 }}>
            <span style={{ flexShrink: 0, marginTop: 1 }}><Icon.shield width={15} height={15} /></span>
            <span><b>{tr('Recomendado')}</b> · {info.rec}</span>
          </div>
        )}
        <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="btn primary" onClick={onClose}>{tr('Entendido')}</button>
        </div>
      </div>
    </div>
  );
}

function EncryptHelpModal({ onClose, storage, tr }) {
  const store = storage || '<nombre-del-storage>';
  const C = ({ children }) => (
    <code style={{ background: 'var(--surface-2)', borderRadius: 4, padding: '1px 5px', fontSize: 12, fontFamily: 'monospace' }}>{children}</code>
  );
  const Pre = ({ children }) => (
    <pre style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', fontSize: 12, overflowX: 'auto', margin: '8px 0 0', lineHeight: 1.6 }}>{children}</pre>
  );
  const Step = ({ n, children }) => (
    <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
      <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: '50%', background: 'var(--brand)', color: '#fff', fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{n}</span>
      <span style={{ fontSize: 13.5, paddingTop: 2 }}>{children}</span>
    </div>
  );

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1100 }}>
      <div className="modal" style={{ maxWidth: 580, maxHeight: '85vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <Icon.lock width={20} height={20} style={{ color: 'var(--brand)', flexShrink: 0 }} />
          <h3 style={{ margin: 0 }}>{tr('Configurar cifrado PBS en PVE')}</h3>
          <button type="button" className="btn sm ghost" style={{ marginLeft: 'auto' }} onClick={onClose}><Icon.x width={15} height={15} /></button>
        </div>

        <p style={{ margin: '0 0 16px', color: 'var(--text-2)', fontSize: 13.5 }}>
          {tr('El cifrado de PBS es del lado del cliente: la clave vive en el nodo PVE y los datos se cifran antes de enviarse al servidor PBS. Solo hay que configurarlo una vez por storage.')}
        </p>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 9px', fontSize: 12 }}>A</span>
            {tr('Interfaz gráfica de Proxmox VE')}
          </div>
          <Step n="1">{tr('Abre la WebUI de PVE')} → <b>Datacenter → Storage → <C>{store}</C></b></Step>
          <Step n="2">{tr('Haz clic en')} <b>Edit</b></Step>
          <Step n="3">{tr('En el campo')} <b>Encryption Key</b>{tr(', haz clic en')} <b>Generate</b> — {tr('PVE genera y guarda la clave automáticamente en')} <C>/etc/pve/priv/</C></Step>
          <Step n="4">{tr('Guarda los cambios. A partir de ahora todos los backups a este storage van cifrados.')}</Step>
        </div>

        <div style={{ borderTop: '1px solid var(--border)', margin: '0 0 20px' }} />

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 9px', fontSize: 12 }}>B</span>
            {tr('Consola (SSH en el nodo PVE)')}
          </div>
          <Pre>{`# 1. Genera la clave de cifrado
proxmox-backup-client key create /etc/pve/priv/pbs-enc.json

# 2. Asigna la clave al storage PBS
pvesm set ${store} --encryption-key /etc/pve/priv/pbs-enc.json

# 3. (Recomendado) Exporta copia imprimible de la clave
proxmox-backup-client key paperkey /etc/pve/priv/pbs-enc.json > ~/pbs-enc-paperkey.txt`}</Pre>
        </div>

        <div style={{ borderTop: '1px solid var(--border)', margin: '0 0 20px' }} />

        {/* Restauración */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 9px', fontSize: 12 }}>C</span>
            {tr('Restauración con copias cifradas')}
          </div>
          <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-2)' }}>
            {tr('Las restauraciones (VM completa y ficheros) van a través de PVE, que descifra automáticamente usando la clave del storage. No es necesario introducir la clave manualmente.')}
          </p>
          <p style={{ margin: '0 0 6px', fontSize: 13, color: 'var(--text-2)' }}>
            {tr('Si restauras en un PVE diferente al que hizo la copia, ese PVE necesita la misma clave:')}
          </p>
          <Pre>{`# Copia la clave al nuevo nodo PVE (desde el original o desde el paperkey)
# y asígnala al storage PBS en el nuevo PVE:
pvesm set ${store} --encryption-key /etc/pve/priv/pbs-enc.json`}</Pre>
        </div>

        <div style={{ background: 'var(--warn-soft)', border: '1px solid #f0d9a8', color: '#a06806', padding: '10px 14px', borderRadius: 8, fontSize: 12.5, display: 'flex', gap: 8 }}>
          <span style={{ flexShrink: 0 }}>⚠</span>
          <span><b>{tr('Guarda la clave en un lugar seguro.')}</b> {tr('Si la pierdes, los backups cifrados son irrecuperables. Se recomienda guardar la «paperkey» impresa o en un gestor de contraseñas.')}</span>
        </div>

        <div style={{ textAlign: 'right', marginTop: 18 }}>
          <button className="btn primary" onClick={onClose}>{tr('Entendido')}</button>
        </div>
      </div>
    </div>
  );
}

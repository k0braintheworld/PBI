// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import { useState, useEffect } from 'react';
import { api, fmtBytes, fmtDate, fmtAgo } from '../api.js';
import { useAsync, Loading, ErrorBox, confirmDialog, NsBadge } from './common.jsx';
import { Icon } from './icons.jsx';
import { useT } from '../i18n.jsx';
import ScheduleField from './ScheduleField.jsx';

const keyOf = (g) => `${g.store}/${g.ns || ''}/${g.type}/${g.id}`;

/** Limpieza: borrar grupos de backup que ya no se necesitan (huérfanos, etc.). */
export default function Cleanup() {
  const t = useT();
  const data = useAsync(() => api.cleanupGroups(), []);
  const [sel, setSel] = useState(new Set());
  const [onlyOrphans, setOnlyOrphans] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [gcMsg, setGcMsg] = useState(null);
  const [gcConfirm, setGcConfirm] = useState(null);
  const [gcBusy, setGcBusy] = useState(false);
  const [viewGroup, setViewGroup] = useState(null);

  if (data.loading) return <Loading />;
  if (data.error) return <ErrorBox error={data.error} />;

  const DELETE_WORD = t('ELIMINAR');
  const groups = data.data.groups || [];
  const pveKnown = data.data.pveKnown;
  const stores = [...new Set(groups.map((g) => g.store))];
  const rows = onlyOrphans ? groups.filter((g) => g.orphan) : groups;
  const selGroups = groups.filter((g) => sel.has(keyOf(g)));
  const selSize = selGroups.reduce((a, g) => a + (g.size || 0), 0);

  const toggle = (g) => setSel((s) => { const n = new Set(s); const k = keyOf(g); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const selectOrphans = () => setSel(new Set(groups.filter((g) => g.orphan).map(keyOf)));

  async function doDelete() {
    setBusy(true); setMsg(null);
    let ok = 0; const errs = [];
    for (const g of selGroups) {
      try { await api.cleanupDeleteGroup({ store: g.store, type: g.type, id: g.id, ns: g.ns }); ok += 1; }
      catch (e) { errs.push(`${g.type}/${g.id}: ${e.message}`); }
    }
    setBusy(false); setConfirm(false); setConfirmText(''); setSel(new Set());
    setMsg(`${t('Eliminados')} ${ok} ${t('grupo(s)')}${errs.length ? ` · ${errs.length} ${t('con error')}: ${errs.join('; ')}` : ''}. ${t('Ejecuta «Liberar espacio» para reclamar el disco.')}`);
    data.reload();
  }

  async function runGc() {
    const store = gcConfirm;
    setGcBusy(true); setGcMsg(null);
    try {
      const r = await api.cleanupGc(store);
      setGcMsg(`${t('Garbage Collection iniciado en')} «${store}» (${t('tarea')} ${r.upid}). ${t('Sigue su progreso en Monitor de tareas; puede tardar varios minutos.')}`);
    } catch (e) {
      setGcMsg(`${t('Error al iniciar el Garbage Collection')}: ${e.message}`);
    } finally {
      setGcBusy(false); setGcConfirm(null);
    }
  }

  return (
    <div className="rise">
      <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', background: 'var(--info-soft)', border: '1px solid #cfe0fb', color: '#2257c4', padding: '10px 13px', borderRadius: 8, fontSize: 12.5, marginBottom: 14 }}>
        <span style={{ flexShrink: 0, marginTop: 1 }}><Icon.broom width={16} height={16} /></span>
        <span>{t('Los datos de backup viven en ')}<b>PBS</b>{t(': al borrar un grupo aquí desaparece también de la vista de Proxmox. El borrado quita las copias del índice; el ')}<b>{t('espacio en disco')}</b>{t(' se recupera al ejecutar ')}<b>{t('«Liberar espacio» (Garbage Collection)')}</b>{'. '}{pveKnown ? t('Las copias cuya VM ya no existe en Proxmox VE se marcan como ') : t('Conecta Proxmox VE para detectar ')}<b>{t('huérfanas')}</b>.</span>
      </div>

      {msg && <div className="banner">{msg}</div>}
      {gcMsg && <div className="banner">{gcMsg}</div>}

      <div className="flex-between pagehead" style={{ gap: 10, flexWrap: 'wrap' }}>
        <div className="btn-row" style={{ alignItems: 'center' }}>
          <label style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 13, color: 'var(--text-2)' }}>
            <input type="checkbox" checked={onlyOrphans} onChange={(e) => setOnlyOrphans(e.target.checked)} /> {t('Solo huérfanas')}
          </label>
          {groups.some((g) => g.orphan) && <button className="btn sm ghost" onClick={selectOrphans}>{t('Seleccionar huérfanas')}</button>}
        </div>
        <button className="btn danger" disabled={!selGroups.length} onClick={() => setConfirm(true)}>
          <Icon.trash width={14} height={14} /> {t('Eliminar seleccionados')} {selGroups.length ? `(${selGroups.length} · ${fmtBytes(selSize)})` : ''}
        </button>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th style={{ width: 1 }}></th><th>{t('Tipo')}</th><th>{t('Máquina')}</th><th>{t('Estado')}</th>
              <th>Datastore</th><th className="num">{t('Copias')}</th><th className="num">{t('Tamaño')}</th><th className="num">{t('Última copia')}</th><th style={{ width: 1 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={keyOf(g)} style={{ background: sel.has(keyOf(g)) ? 'var(--surface-2)' : '' }}>
                <td>
                  <input type="checkbox" checked={sel.has(keyOf(g))} disabled={g.protected} onChange={() => toggle(g)} title={g.protected ? t('Protegido: desprotégelo en PBS para poder borrarlo') : ''} />
                </td>
                <td><span className="badge muted plain">{g.type}</span></td>
                <td><strong>{g.id}</strong>{g.name && <span className="muted"> · {g.name}</span>}</td>
                <td>
                  {g.protected ? <span className="badge warn">{t('protegido')}</span>
                    : g.orphan ? <span className="badge err">{t('huérfana')}</span>
                      : g.orphan === false ? <span className="badge ok">{t('activa')}</span>
                        : <span className="badge muted">—</span>}
                </td>
                <td className="mono" style={{ fontSize: 12 }}>{g.store}<NsBadge ns={g.ns} /></td>
                <td className="num">{g.count}</td>
                <td className="num">{fmtBytes(g.size)}</td>
                <td className="num" title={fmtDate(g.last)}>{fmtAgo(g.last)}</td>
                <td><button className="btn sm ghost" onClick={() => setViewGroup(g)}>{t('Ver copias')}</button></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={9} className="muted" style={{ textAlign: 'center', padding: 28 }}>{onlyOrphans ? t('No hay copias huérfanas.') : t('No hay grupos de backup.')}</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card card-pad" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>{t('Liberar espacio en disco (Garbage Collection)')}</h3>
        <p className="muted" style={{ marginTop: -4 }}>{t('Tras borrar copias, ejecuta el Garbage Collection del datastore para que PBS reclame el espacio físico de los datos ya no referenciados. El GC también es lo que calcula el factor de deduplicación que ves en el panel.')}</p>
        {stores.map((s) => <GcStore key={s} store={s} onRun={() => setGcConfirm(s)} t={t} />)}
      </div>

      {confirm && (
        <div className="modal-overlay" onClick={() => !busy && setConfirm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t('Eliminar copias de seguridad')}</h3>
            <div className="error-box">
              {t('⚠ ')}<b>{t('Acción destructiva e irreversible')}</b>{t('. Se eliminarán ')}<b>{selGroups.length}</b>{t(' grupo(s) de backup (')}{selGroups.reduce((a, g) => a + g.count, 0)} {t('copias · ')}{fmtBytes(selSize)}{t(') del PBS.')}
            </div>
            <div style={{ maxHeight: 160, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 10, marginBottom: 12 }}>
              {selGroups.map((g) => (
                <div key={keyOf(g)} style={{ fontSize: 12.5, padding: '2px 0' }}>
                  <span className="badge muted plain">{g.type}</span> <b>{g.id}</b>{g.name ? ` · ${g.name}` : ''} <span className="muted">— {g.count} {t('copias · ')}{fmtBytes(g.size)} · {g.store}</span>
                </div>
              ))}
            </div>
            <div className="field">
              <label>{t('Escribe')} <b>{DELETE_WORD}</b> {t('para confirmar')}</label>
              <input className="input" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoFocus />
            </div>
            <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setConfirm(false)} disabled={busy}>{t('Cancelar')}</button>
              <button className="btn danger" style={{ background: 'var(--err)', borderColor: 'var(--err)', color: '#fff' }} disabled={confirmText !== DELETE_WORD || busy} onClick={doDelete}>
                {busy ? t('Eliminando…') : t('Eliminar definitivamente')}
              </button>
            </div>
          </div>
        </div>
      )}

      {gcConfirm && (
        <div className="modal-overlay" onClick={() => !gcBusy && setGcConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t('Liberar espacio en')} «{gcConfirm}»</h3>
            <p className="muted">
              {t('El Garbage Collection recorre el datastore y elimina los bloques de datos que ya no referencia ninguna copia, recuperando el espacio en disco. Es ')}<b>{t('seguro')}</b>{t(' (no afecta a las copias existentes), pero puede tardar varios minutos.')}
            </p>
            <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setGcConfirm(null)} disabled={gcBusy}>{t('Cancelar')}</button>
              <button className="btn primary" onClick={runGc} disabled={gcBusy}>{gcBusy ? t('Iniciando…') : t('Ejecutar Garbage Collection')}</button>
            </div>
          </div>
        </div>
      )}

      {viewGroup && <SnapshotModal group={viewGroup} onClose={() => setViewGroup(null)} onChanged={() => data.reload()} />}
    </div>
  );
}

/** Fila por datastore: estado del GC programado + editor de programación + ejecutar. */
function GcStore({ store, onRun, t }) {
  const [schedule, setSchedule] = useState(null); // guardado en PBS
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState('');

  useEffect(() => {
    api.gcScheduleGet(store)
      .then((r) => { setSchedule(r.schedule); setVal(r.schedule); })
      .catch(() => setSchedule(''));
  }, [store]);

  async function save() {
    setBusy(true); setSaved('');
    try {
      const r = await api.gcScheduleSet(store, val.trim());
      setSchedule(r.schedule); setVal(r.schedule);
      setSaved(t('Guardado')); setTimeout(() => setSaved(''), 1800);
    } catch (e) { setSaved(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ padding: '10px 0', borderTop: '1px solid var(--border)' }}>
      <div className="flex-between" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <div>
          <b className="mono">{store}</b>
          <div className="muted" style={{ fontSize: 11.5 }}>
            {schedule === null ? '…' : schedule ? <>{t('GC programado')}: <b className="mono">{schedule}</b></> : t('GC no programado')}
          </div>
        </div>
        <button className="btn sm ghost" onClick={onRun}><Icon.broom width={13} height={13} /> {t('Ejecutar ahora')}</button>
      </div>
      <div className="btn-row" style={{ alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
        <ScheduleField value={val} onChange={setVal} allowOff placeholder="mon..fri 02:30" />
        <button className="btn sm" style={{ marginBottom: 14 }} onClick={save} disabled={busy || val === (schedule ?? '')}>{busy ? t('Guardando…') : t('Guardar')}</button>
        {saved && <span className="muted" style={{ fontSize: 11.5, marginBottom: 14 }}>{saved}</span>}
      </div>
    </div>
  );
}

/** Lista las copias (snapshots) de un grupo y permite borrar las seleccionadas. */
function SnapshotModal({ group, onClose, onChanged }) {
  const t = useT();
  const snaps = useAsync(() => api.snapshots(group.store), [group.store]);
  const [sel, setSel] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [cutoff, setCutoff] = useState('');
  const cutoffEpoch = cutoff ? Math.floor(new Date(`${cutoff}T00:00:00`).getTime() / 1000) : null;
  const isOld = (s) => cutoffEpoch != null && (s['backup-time'] || 0) < cutoffEpoch;
  const selectOld = () => setSel(new Set(list.filter((s) => !s.protected && isOld(s)).map((s) => s['backup-time'])));

  const list = (snaps.data || [])
    .filter((s) => s['backup-type'] === group.type && String(s['backup-id']) === group.id
      && String(s.ns || '') === String(group.ns || '')) // mismo namespace que el grupo
    .sort((a, b) => (b['backup-time'] || 0) - (a['backup-time'] || 0));
  const selList = list.filter((s) => sel.has(s['backup-time']));
  const selSize = selList.reduce((a, s) => a + (s.size || 0), 0);
  const toggle = (tm) => setSel((s) => { const n = new Set(s); n.has(tm) ? n.delete(tm) : n.add(tm); return n; });
  const allSel = list.length && list.filter((s) => !s.protected).every((s) => sel.has(s['backup-time']));
  const toggleAll = () => setSel(allSel ? new Set() : new Set(list.filter((s) => !s.protected).map((s) => s['backup-time'])));

  async function del() {
    if (!(await confirmDialog({ message: `${t('¿Eliminar')} ${selList.length} ${t('copia(s) de')} ${group.type}/${group.id}? ${t('Es irreversible.')}`, danger: true, confirmLabel: t('Eliminar') }))) return;
    setBusy(true); let ok = 0; const errs = [];
    for (const s of selList) {
      try { await api.cleanupDeleteSnapshot({ store: group.store, type: group.type, id: group.id, time: s['backup-time'], ns: group.ns }); ok += 1; }
      catch (e) { errs.push(e.message); }
    }
    setBusy(false); setSel(new Set());
    setMsg(`${t('Eliminadas')} ${ok} ${t('copia(s)')}${errs.length ? ` · ${errs.length} ${t('con error')}` : ''}. ${t('Ejecuta «Liberar espacio» para reclamar el disco.')}`);
    snaps.reload(); onChanged?.();
  }

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal" style={{ maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex-between">
          <h3 style={{ margin: 0 }}>{t('Copias de')} {group.type.toUpperCase()} {group.id}{group.name ? ` · ${group.name}` : ''}</h3>
          {list.length > 0 && <button className="btn sm ghost" onClick={toggleAll}>{allSel ? t('Quitar todas') : t('Seleccionar todas')}</button>}
        </div>
        <p className="muted" style={{ marginTop: 4, fontSize: 12.5 }}>
          {t('Usa la ')}<b>{t('fecha')}</b>{t(' y el ')}<b>{t('comentario')}</b>{t(' para distinguir las copias antiguas (de una VM eliminada que reutilizó este ID) de las actuales, y borra solo las que sobren.')}
        </p>

        <div className="flex-between" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', margin: '4px 0 10px', flexWrap: 'wrap', gap: 8 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--text-2)' }}>
            {t('Resaltar copias anteriores a:')}
            <input className="input" type="date" style={{ width: 160 }} value={cutoff} onChange={(e) => setCutoff(e.target.value)} />
          </label>
          <button className="btn sm" disabled={!cutoffEpoch} onClick={selectOld}>{t('Seleccionar anteriores')}</button>
        </div>

        {msg && <div className="banner">{msg}</div>}

        {snaps.loading ? <Loading /> : snaps.error ? <ErrorBox error={snaps.error} /> : (
          <div style={{ maxHeight: 360, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            <table>
              <thead><tr><th style={{ width: 1 }}></th><th>{t('Fecha')}</th><th className="num">{t('Tamaño')}</th><th>{t('Verif.')}</th><th>{t('Comentario')}</th></tr></thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s['backup-time']} style={{ background: sel.has(s['backup-time']) ? 'var(--surface-2)' : isOld(s) ? 'var(--warn-soft)' : '' }}>
                    <td><input type="checkbox" checked={sel.has(s['backup-time'])} disabled={s.protected} onChange={() => toggle(s['backup-time'])} title={s.protected ? t('Protegido') : ''} /></td>
                    <td>{fmtDate(s['backup-time'])}
                      {isOld(s) && <span className="badge warn" style={{ marginLeft: 6 }}>{t('antigua')}</span>}
                      {s.protected && <span className="badge warn" style={{ marginLeft: 6 }}>{t('protegido')}</span>}
                    </td>
                    <td className="num">{fmtBytes(s.size)}</td>
                    <td>{s.verification?.state === 'ok' ? <span className="badge ok">ok</span> : s.verification?.state === 'failed' ? <span className="badge err">{t('fallo')}</span> : <span className="muted">—</span>}</td>
                    <td className="muted" style={{ fontSize: 12, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.comment || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="btn-row" style={{ justifyContent: 'space-between', marginTop: 14 }}>
          <button className="btn" onClick={onClose} disabled={busy}>{t('Cerrar')}</button>
          <button className="btn danger" style={{ background: 'var(--err)', borderColor: 'var(--err)', color: '#fff' }} disabled={!selList.length || busy} onClick={del}>
            <Icon.trash width={14} height={14} /> {busy ? t('Eliminando…') : `${t('Eliminar')} ${selList.length || ''} ${t('copia(s)')}${selList.length ? ` · ${fmtBytes(selSize)}` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

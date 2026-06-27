import { useEffect, useRef, useState } from 'react';
import { api, fmtBytes, fmtDate } from '../api.js';
import { Loading, ErrorBox } from './common.jsx';
import { useGuestNames } from '../guestNames.js';
import { Icon } from './icons.jsx';

const typeFromVolid = (volid) => {
  const m = /backup\/(vm|ct|lxc)\//.exec(volid || '');
  return m ? (m[1] === 'ct' ? 'lxc' : m[1]) : 'vm';
};

/** Menú de Recuperación: orquesta restauraciones a través de Proxmox VE. */
export default function Restore({ goTo }) {
  const [pve, setPve] = useState(null); // lista
  const [pveId, setPveId] = useState('');
  const [node, setNode] = useState('');
  const [storage, setStorage] = useState('');
  const [nodes, setNodes] = useState([]);
  const [storages, setStorages] = useState([]);
  const [backups, setBackups] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState({});
  const names = useGuestNames();

  const [vmid, setVmid] = useState(null);       // máquina seleccionada
  const [point, setPoint] = useState(null);     // backup (volid) seleccionado
  const [mode, setMode] = useState(null);       // 'full' | 'files'

  // Cargar conexiones PVE
  useEffect(() => {
    api.pveList().then((l) => {
      setPve(l);
      const def = l.find((x) => x.isDefault)?.id || l[0]?.id || '';
      setPveId(def);
    }).catch((e) => setErr(e.message));
  }, []);

  // Al cambiar de PVE -> cargar nodos
  useEffect(() => {
    if (!pveId) return;
    setNodes([]); setNode(''); setStorages([]); setStorage(''); setBackups(null); reset();
    setLoading((s) => ({ ...s, nodes: true }));
    api.pveNodes(pveId)
      .then((n) => { const arr = n || []; setNodes(arr); setNode(arr[0]?.node || ''); })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading((s) => ({ ...s, nodes: false })));
  }, [pveId]);

  // Al cambiar de nodo -> cargar almacenamientos
  useEffect(() => {
    if (!pveId || !node) return;
    setStorages([]); setStorage(''); setBackups(null); reset();
    setLoading((s) => ({ ...s, st: true }));
    api.pveStorages(pveId, node)
      .then((st) => {
        const arr = st || [];
        setStorages(arr);
        const pbs = arr.find((x) => x.type === 'pbs');
        setStorage(pbs?.storage || arr[0]?.storage || '');
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading((s) => ({ ...s, st: false })));
  }, [pveId, node]);

  // Al elegir almacenamiento -> cargar backups disponibles
  useEffect(() => {
    if (!pveId || !node || !storage) return;
    setBackups(null); reset(); setErr(null);
    setLoading((s) => ({ ...s, bk: true }));
    api.pveBackups(pveId, node, storage)
      .then((b) => setBackups(b || []))
      .catch((e) => setErr(e.message))
      .finally(() => setLoading((s) => ({ ...s, bk: false })));
  }, [pveId, node, storage]);

  function reset() { setVmid(null); setPoint(null); setMode(null); }

  if (pve === null) return <Loading />;

  if (!pve.length) {
    return (
      <div className="card card-pad rise" style={{ textAlign: 'center', padding: 40 }}>
        <div style={{ color: 'var(--brand)', marginBottom: 10 }}><Icon.restore width={34} height={34} /></div>
        <h3 style={{ margin: '0 0 6px' }}>Conecta un servidor Proxmox VE</h3>
        <p className="muted" style={{ maxWidth: 460, margin: '0 auto 16px' }}>
          Las restauraciones (VM completa o ficheros) las ejecuta Proxmox VE. Añade una conexión
          PVE con un API token para poder restaurar desde aquí.
        </p>
        <button className="btn primary" onClick={() => goTo('settings')}>Ir a Configuración → Proxmox VE</button>
      </div>
    );
  }

  // Agrupar backups por máquina (vmid)
  const machines = [];
  if (backups) {
    const map = new Map();
    for (const b of backups) {
      const id = String(b.vmid ?? typeFromVolid(b.volid));
      const m = map.get(id) || { vmid: id, type: typeFromVolid(b.volid), count: 0, latest: 0 };
      m.count += 1;
      m.latest = Math.max(m.latest, b.ctime || 0);
      map.set(id, m);
    }
    machines.push(...[...map.values()].sort((a, b) => b.latest - a.latest));
  }
  const points = backups
    ? backups.filter((b) => String(b.vmid) === String(vmid)).sort((a, b) => (b.ctime || 0) - (a.ctime || 0))
    : [];

  return (
    <div className="rise">
      {/* Barra de destino */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Servidor Proxmox VE</label>
            <select value={pveId} onChange={(e) => setPveId(e.target.value)}>
              {pve.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Nodo</label>
            <select value={node} onChange={(e) => setNode(e.target.value)} disabled={!nodes.length}>
              {nodes.map((n) => <option key={n.node} value={n.node}>{n.node}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Almacenamiento de backups (PBS)</label>
            <select value={storage} onChange={(e) => setStorage(e.target.value)} disabled={!storages.length}>
              {storages.filter((s) => s.type === 'pbs').map((s) => <option key={s.storage} value={s.storage}>{s.storage}</option>)}
              {!storages.some((s) => s.type === 'pbs') && storages.map((s) => <option key={s.storage} value={s.storage}>{s.storage} ({s.type})</option>)}
            </select>
          </div>
          {(loading.nodes || loading.st || loading.bk) && <span className="muted" style={{ fontSize: 12, paddingBottom: 9 }}>cargando…</span>}
        </div>
        {!loading.st && node && storages.length === 0 && (
          <p className="muted" style={{ marginTop: 10, marginBottom: 0, fontSize: 12.5 }}>
            ⚠ El API token de Proxmox VE no ve ningún almacenamiento en <b>{node}</b>. Suele ser por permisos del token:
            desmarca «Separación de privilegios» al crearlo, o asígnale un rol (p. ej. Administrator) sobre la ruta «/».
          </p>
        )}
        {!loading.st && node && storages.length > 0 && !storages.some((s) => s.type === 'pbs') && (
          <p className="muted" style={{ marginTop: 10, marginBottom: 0, fontSize: 12.5 }}>
            ⚠ No hay ningún almacenamiento de tipo <b>PBS</b> en <b>{node}</b>. Añade tu Proxmox Backup Server como
            almacenamiento en Proxmox VE (Datacenter → Storage → Add → Proxmox Backup Server).
          </p>
        )}
      </div>

      {err && <ErrorBox error={err} />}

      <div className="dash" style={{ gridTemplateColumns: '320px 1fr', alignItems: 'start' }}>
        {/* Paso 1: máquina */}
        <div className="card">
          <div className="panel-head"><h3>1 · Máquina</h3></div>
          {loading.bk ? <Loading /> : !machines.length ? (
            <div className="panel-body muted">No hay backups en este almacenamiento.</div>
          ) : (
            <div>
              {machines.map((m) => (
                <button
                  key={m.vmid}
                  className="evt"
                  style={{ width: '100%', textAlign: 'left', background: vmid === m.vmid ? 'var(--surface-2)' : 'none', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                  onClick={() => { setVmid(m.vmid); setPoint(null); setMode(null); }}
                >
                  <span className="ico ok" style={{ background: 'var(--info-soft)', color: 'var(--info)' }}><Icon.cpu width={13} height={13} /></span>
                  <span className="msg">
                    <span className="t">
                      <strong>{m.type.toUpperCase()} {m.vmid}</strong>
                      {names[String(m.vmid)] && <span className="muted"> · {names[String(m.vmid)]}</span>}
                    </span>
                    <span className="d">{m.count} puntos · último {fmtDate(m.latest)}</span>
                  </span>
                  {vmid === m.vmid && <Icon.chevronRight width={16} height={16} />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Pasos 2-4 */}
        <div style={{ display: 'grid', gap: 16 }}>
          {!vmid ? (
            <div className="card card-pad muted" style={{ textAlign: 'center', padding: 34 }}>
              Selecciona una máquina para ver sus puntos de restauración.
            </div>
          ) : (
            <>
              {/* Paso 2: punto */}
              <div className="card">
                <div className="panel-head"><h3>2 · Punto de restauración</h3><span className="muted" style={{ fontSize: 11.5 }}>{points.length} disponibles</span></div>
                <div className="panel-body flush" style={{ maxHeight: 230, overflow: 'auto' }}>
                  <table>
                    <tbody>
                      {points.map((p) => (
                        <tr key={p.volid} style={{ cursor: 'pointer', background: point?.volid === p.volid ? 'var(--surface-2)' : '' }} onClick={() => setPoint(p)}>
                          <td style={{ width: 18 }}>
                            <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', border: '2px solid', borderColor: point?.volid === p.volid ? 'var(--brand)' : 'var(--border-strong)', background: point?.volid === p.volid ? 'var(--brand)' : 'transparent' }} />
                          </td>
                          <td>{fmtDate(p.ctime)}</td>
                          <td className="num">{fmtBytes(p.size)}</td>
                          <td className="muted mono" style={{ fontSize: 11 }}>{p.format || ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Paso 3: modo */}
              {point && (
                <div className="card card-pad">
                  <h3 style={{ marginTop: 0 }}>3 · Tipo de recuperación</h3>
                  <div className="row">
                    <ModeCard active={mode === 'full'} onClick={() => setMode('full')} icon="cpu"
                      title="VM completa" desc="Restaura la máquina entera a un nodo y almacenamiento." />
                    <ModeCard active={mode === 'files'} onClick={() => setMode('files')} icon="folder"
                      title="Ficheros (granular)" desc="Explora el interior del backup y descarga archivos concretos." />
                  </div>
                </div>
              )}

              {/* Paso 4 */}
              {point && mode === 'full' && (
                <FullRestore pveId={pveId} node={node} storages={storages} point={point} defaultVmid={vmid} goTo={goTo} />
              )}
              {point && mode === 'files' && (
                <FileRestore pveId={pveId} node={node} storage={storage} point={point} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ModeCard({ active, onClick, icon, title, desc }) {
  const I = Icon[icon];
  return (
    <button onClick={onClick} className="card card-pad" style={{
      textAlign: 'left', cursor: 'pointer', borderColor: active ? 'var(--brand)' : 'var(--border)',
      boxShadow: active ? '0 0 0 3px var(--brand-soft)' : 'none', background: 'var(--surface)',
    }}>
      <div style={{ color: active ? 'var(--brand)' : 'var(--text-2)', marginBottom: 8 }}><I width={22} height={22} /></div>
      <div style={{ fontWeight: 600, marginBottom: 3 }}>{title}</div>
      <div className="muted" style={{ fontSize: 12.5 }}>{desc}</div>
    </button>
  );
}

/** Restauración de VM completa. */
function FullRestore({ pveId, node, storages, point, defaultVmid, goTo }) {
  const diskStores = storages.filter((s) => (s.content || '').includes('images') && s.type !== 'pbs');
  const [target, setTarget] = useState(diskStores[0]?.storage || '');
  const [vmid, setVmid] = useState(defaultVmid);
  const [force, setForce] = useState(false);
  const [start, setStart] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);
  const type = typeFromVolid(point.volid);

  async function doRestore() {
    setBusy(true); setErr(null);
    try {
      const r = await api.pveRestore(pveId, { node, type, vmid, archive: point.volid, storage: target, force, start });
      setResult(r.upid);
      setConfirm(false);
    } catch (e) {
      setErr(e.message); setConfirm(false);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return <PveTaskPanel pveId={pveId} upid={result} vmid={vmid} node={node} />;
  }

  return (
    <div className="card card-pad">
      <h3 style={{ marginTop: 0 }}>4 · Restaurar VM completa</h3>
      {err && <ErrorBox error={err} />}
      <div className="row">
        <div className="field">
          <label>Almacenamiento destino (discos)</label>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {diskStores.map((s) => <option key={s.storage} value={s.storage}>{s.storage}</option>)}
            {!diskStores.length && <option value="">(ninguno con «images»)</option>}
          </select>
        </div>
        <div className="field">
          <label>VMID destino</label>
          <input className="input" value={vmid} onChange={(e) => setVmid(e.target.value)} />
        </div>
      </div>
      <div className="btn-row" style={{ gap: 18, margin: '4px 0 16px' }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
          <span className="muted">Sobrescribir si la VMID ya existe</span>
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={start} onChange={(e) => setStart(e.target.checked)} />
          <span className="muted">Arrancar tras restaurar</span>
        </label>
      </div>
      <button className="btn primary" onClick={() => setConfirm(true)} disabled={!target || !vmid}>
        <Icon.restore width={15} height={15} /> Restaurar VM {vmid}
      </button>

      {confirm && (
        <div className="modal-overlay" onClick={() => setConfirm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Confirmar restauración</h3>
            <div className="error-box">
              ⚠ Acción destructiva. {force
                ? <>Se <b>sobrescribirá</b> la VM <b>{vmid}</b> si ya existe en el nodo <b>{node}</b>.</>
                : <>Se creará la VM <b>{vmid}</b> en el nodo <b>{node}</b>. Si ya existe, fallará (marca «sobrescribir»).</>}
            </div>
            <table style={{ marginBottom: 14 }}>
              <tbody>
                <tr><td className="muted">Backup</td><td className="mono" style={{ fontSize: 12 }}>{point.volid}</td></tr>
                <tr><td className="muted">Fecha</td><td>{fmtDate(point.ctime)}</td></tr>
                <tr><td className="muted">Destino discos</td><td>{target}</td></tr>
                <tr><td className="muted">Arrancar</td><td>{start ? 'sí' : 'no'}</td></tr>
              </tbody>
            </table>
            <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setConfirm(false)}>Cancelar</button>
              <button className="btn primary danger" style={{ background: 'var(--err)', borderColor: 'var(--err)', color: '#fff' }} onClick={doRestore} disabled={busy}>
                {busy ? 'Restaurando…' : 'Sí, restaurar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Sigue en vivo una tarea de restauración de PVE (estado + log). */
function PveTaskPanel({ pveId, upid, vmid, node }) {
  const [status, setStatus] = useState(null);
  const [log, setLog] = useState([]);
  const [err, setErr] = useState(null);
  const logRef = useRef(null);
  const timer = useRef(null);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const s = await api.pveTaskStatus(pveId, upid);
        if (cancelled) return;
        setStatus(s);
        try { const l = await api.pveTaskLog(pveId, upid); if (!cancelled) setLog(l || []); } catch { /* log puede no estar listo */ }
        if (!cancelled && s.status === 'running') timer.current = setTimeout(tick, 2500);
      } catch (e) {
        if (cancelled) return;
        setErr(e.message);
        timer.current = setTimeout(tick, 4000);
      }
    }
    tick();
    return () => { cancelled = true; if (timer.current) clearTimeout(timer.current); };
  }, [pveId, upid]);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);

  const running = !status || status.status === 'running';
  const ok = status?.exitstatus === 'OK';

  return (
    <div className="card">
      <div className="panel-head">
        <h3>Restaurando VM {vmid}</h3>
        {running
          ? <span className="badge run">en ejecución</span>
          : ok ? <span className="badge ok">completada</span> : <span className="badge err">con errores</span>}
      </div>
      <div className="panel-body">
        <p className="mono muted" style={{ fontSize: 11.5, wordBreak: 'break-all', marginTop: 0 }}>{upid}</p>
        {err && <ErrorBox error={err} />}
        <div className="log" ref={logRef}>
          {log.length ? log.map((l) => l.t).join('\n') : 'Iniciando tarea en Proxmox VE…'}
        </div>
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
          {running
            ? <>Ejecutándose en el nodo <b>{node}</b> · actualizándose cada 2,5 s…</>
            : ok
              ? <>✓ La VM <b>{vmid}</b> se ha restaurado correctamente en <b>{node}</b>.</>
              : <>La tarea terminó con estado <b>{status?.exitstatus}</b>. Revisa el log.</>}
        </p>
      </div>
    </div>
  );
}

/** Restauración granular de ficheros (file-restore de PVE).
 *  PVE codifica los `filepath` en base64; navegamos con una pila que guarda el
 *  nombre legible y el filepath real, sin reconstruir rutas a mano. */
function FileRestore({ pveId, node, storage, point }) {
  const [stack, setStack] = useState([{ name: 'raíz', filepath: '/' }]);
  const [entries, setEntries] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const cur = stack[stack.length - 1].filepath;

  useEffect(() => {
    setLoading(true); setErr(null);
    api.pveFileList(pveId, { node, storage, volume: point.volid, filepath: cur })
      .then((e) => setEntries(e || []))
      .catch((e) => { setErr(e.message); setEntries(null); })
      .finally(() => setLoading(false));
  }, [pveId, node, storage, point.volid, cur]);

  const enter = (e) => setStack((s) => [...s, { name: e.text, filepath: e.filepath }]);
  const goTo = (i) => setStack((s) => s.slice(0, i + 1));
  const iconFor = (e) => (e.type === 'v' ? Icon.hdd : e.type === 'd' ? Icon.folder : Icon.file);
  const navigable = (e) => e.leaf === 0 || e.leaf === false || e.type === 'd' || e.type === 'v';
  const downloadable = (e) => e.type === 'f' || e.type === 'd' || e.leaf === 1 || e.leaf === true;

  return (
    <div className="card">
      <div className="panel-head">
        <h3>4 · Ficheros del backup</h3>
        <span className="muted" style={{ fontSize: 11.5 }}>file-restore de PVE</span>
      </div>
      <div className="panel-body" style={{ borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        {stack.map((s, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {i > 0 && <Icon.chevronRight width={13} height={13} style={{ color: 'var(--text-3)' }} />}
            <button className="btn sm ghost" style={{ fontWeight: i === stack.length - 1 ? 600 : 400 }} disabled={i === stack.length - 1} onClick={() => goTo(i)}>{s.name}</button>
          </span>
        ))}
      </div>

      {loading ? <Loading label="Montando el backup en PVE…" /> : err ? (
        <div className="card-pad">
          <ErrorBox error={err} />
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
            La exploración de ficheros monta el disco en una <b>VM auxiliar de file-restore con memoria propia y
            limitada</b> (independiente de la RAM libre de <b>{node}</b>). El error <b>«No space left on device»</b> lo
            genera esa VM auxiliar al indexar sistemas de ficheros grandes —típico en discos <b>Windows/NTFS</b>: su
            índice en RAM se llena. Funciona bien con discos Linux pequeños. Para VMs Windows grandes usa
            <b> «VM completa»</b> (no usa esta VM auxiliar). Es una limitación de Proxmox VE, no del gestor.
          </p>
        </div>
      ) : (
        <table>
          <tbody>
            {(entries || []).map((e, i) => (
              <tr key={i}>
                <td style={{ width: 20, color: navigable(e) ? 'var(--brand)' : 'var(--text-3)' }}>
                  {(() => { const I = iconFor(e); return <I width={16} height={16} />; })()}
                </td>
                <td>
                  {navigable(e)
                    ? <button className="btn sm ghost" style={{ fontWeight: 600 }} onClick={() => enter(e)}>{e.text}</button>
                    : <span>{e.text}</span>}
                </td>
                <td className="num">{e.size != null ? fmtBytes(e.size) : ''}</td>
                <td style={{ width: 1 }}>
                  {downloadable(e) && (
                    <a className="btn sm" href={api.pveFileDownloadUrl(pveId, { node, storage, volume: point.volid, filepath: e.filepath })}>
                      <Icon.download width={13} height={13} /> {e.type === 'd' ? 'ZIP' : 'Descargar'}
                    </a>
                  )}
                </td>
              </tr>
            ))}
            {entries && !entries.length && <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 22 }}>Carpeta vacía</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

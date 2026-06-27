import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAsync, Loading, ErrorBox, confirmDialog } from './common.jsx';
import { Icon } from './icons.jsx';

/** Configuración: conexiones a Proxmox Backup Server y a Proxmox VE. */
export default function Settings({ onHostsChanged, user }) {
  const [section, setSection] = useState('pbs');
  const isAdmin = user?.role === 'admin';
  return (
    <div className="rise">
      <div className="seg pagehead">
        <button className={section === 'pbs' ? 'active' : ''} onClick={() => setSection('pbs')}>Proxmox Backup Server</button>
        <button className={section === 'pve' ? 'active' : ''} onClick={() => setSection('pve')}>Proxmox VE (recuperación)</button>
        <button className={section === 'notify' ? 'active' : ''} onClick={() => setSection('notify')}>Notificaciones</button>
        {isAdmin && <button className={section === 'users' ? 'active' : ''} onClick={() => setSection('users')}>Usuarios</button>}
        <button className={section === 'account' ? 'active' : ''} onClick={() => setSection('account')}>Mi cuenta</button>
      </div>
      {section === 'pbs' && <PbsHosts onHostsChanged={onHostsChanged} />}
      {section === 'pve' && <PveHosts />}
      {section === 'notify' && <NotifySettings />}
      {section === 'users' && isAdmin && <UserManagement currentUser={user} />}
      {section === 'account' && <AccountSettings />}
    </div>
  );
}

/* ===================== Proxmox Backup Server ===================== */

function PbsHosts({ onHostsChanged }) {
  const hosts = useAsync(() => api.hosts(), []);
  const [editing, setEditing] = useState(null);
  const [testing, setTesting] = useState({});

  function refresh() { hosts.reload(); onHostsChanged?.(); }

  async function test(id) {
    setTesting((t) => ({ ...t, [id]: { loading: true } }));
    try { const r = await api.testHost(id); setTesting((t) => ({ ...t, [id]: r })); }
    catch (err) { setTesting((t) => ({ ...t, [id]: { ok: false, error: err.message } })); }
  }
  async function makeDefault(id) { await api.setDefaultHost(id); refresh(); }
  async function remove(id, name) { if (await confirmDialog({ message: `¿Eliminar el host "${name}"?`, danger: true, confirmLabel: 'Eliminar' })) { await api.deleteHost(id); refresh(); } }

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 16 }}>
        <p className="muted" style={{ margin: 0 }}>Servidores Proxmox Backup guardados de forma persistente.</p>
        <button className="btn primary" onClick={() => setEditing({})}>+ Añadir host</button>
      </div>

      {hosts.loading ? <Loading /> : hosts.error ? <ErrorBox error={hosts.error} /> : !hosts.data.length ? (
        <div className="card card-pad" style={{ textAlign: 'center', padding: 40 }}>
          <p className="muted">No hay hosts configurados.</p>
          <button className="btn primary" onClick={() => setEditing({})}>+ Añadir tu primer host PBS</button>
        </div>
      ) : (
        <div className="grid cols-2">
          {hosts.data.map((h) => {
            const t = testing[h.id];
            return (
              <div className="card card-pad" key={h.id}>
                <div className="flex-between">
                  <h3 style={{ margin: 0 }}>{h.name} {h.isDefault && <span className="badge ok" style={{ marginLeft: 6 }}>por defecto</span>}</h3>
                  <span className="badge info">{h.authMode === 'token' ? 'API token' : 'usuario/contraseña'}</span>
                </div>
                <table style={{ marginTop: 10 }}>
                  <tbody>
                    <tr><td className="muted">Host</td><td className="mono" style={{ fontSize: 12 }}>{h.host}</td></tr>
                    <tr><td className="muted">Nodo</td><td>{h.node}</td></tr>
                    <tr><td className="muted">Credencial</td><td>{h.authMode === 'token' ? h.tokenId : h.username} {h.hasSecret ? '••••' : <span className="badge err">sin secreto</span>}</td></tr>
                  </tbody>
                </table>
                {t && !t.loading && (t.ok
                  ? <div className="banner" style={{ marginTop: 12 }}>✓ Conexión OK — PBS {t.version?.version}</div>
                  : <div className="error-box" style={{ marginTop: 12 }}>✕ {t.error}</div>)}
                <div className="btn-row" style={{ marginTop: 14 }}>
                  <button className="btn sm" onClick={() => test(h.id)} disabled={t?.loading}><Icon.bolt width={13} height={13} /> {t?.loading ? 'Probando…' : 'Probar'}</button>
                  {!h.isDefault && <button className="btn sm" onClick={() => makeDefault(h.id)}>Predeterminado</button>}
                  <button className="btn sm ghost" onClick={() => setEditing(h)}>Editar</button>
                  <button className="btn sm ghost danger" onClick={() => remove(h.id, h.name)}>Eliminar</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && <HostModal host={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
    </div>
  );
}

function HostModal({ host, onClose, onSaved }) {
  const isNew = !host.id;
  const [form, setForm] = useState(() => ({
    name: host.name || '', host: host.host || '', node: host.node || 'localhost',
    verifyTls: !!host.verifyTls, authMode: host.authMode || 'token',
    tokenId: host.tokenId || '', secret: '', username: host.username || '', password: '',
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function save(e) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const body = { ...form };
      if (!isNew && !body.secret) delete body.secret;
      if (!isNew && !body.password) delete body.password;
      if (isNew) await api.addHost(body); else await api.updateHost(host.id, body);
      onSaved();
    } catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{isNew ? 'Añadir' : 'Editar'} host PBS</h3>
        <ErrorBox error={error} />
        <form onSubmit={save}>
          <div className="field"><label>Nombre</label><input className="input" placeholder="PBS Producción" value={form.name} onChange={set('name')} /></div>
          <div className="row">
            <div className="field" style={{ flex: 2 }}><label>Host *</label><input className="input" placeholder="https://192.168.1.10:8007" value={form.host} onChange={set('host')} required /></div>
            <div className="field"><label>Nodo</label><input className="input" placeholder="localhost" value={form.node} onChange={set('node')} /></div>
          </div>
          <div className="field"><label>Modo de autenticación</label>
            <select value={form.authMode} onChange={set('authMode')}><option value="token">API Token</option><option value="ticket">Usuario / Contraseña</option></select>
          </div>
          {form.authMode === 'token' ? (
            <>
              <div className="field"><label>Token ID</label><input className="input" placeholder="root@pam!mitoken" value={form.tokenId} onChange={set('tokenId')} autoComplete="off" /></div>
              <div className="field"><label>Secret {!isNew && <span className="muted">(vacío = conservar)</span>}</label><input className="input" type="password" value={form.secret} onChange={set('secret')} autoComplete="off" /></div>
            </>
          ) : (
            <>
              <div className="field"><label>Usuario</label><input className="input" placeholder="root@pam" value={form.username} onChange={set('username')} autoComplete="off" /></div>
              <div className="field"><label>Contraseña {!isNew && <span className="muted">(vacío = conservar)</span>}</label><input className="input" type="password" value={form.password} onChange={set('password')} autoComplete="off" /></div>
            </>
          )}
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0 16px' }}>
            <input type="checkbox" checked={form.verifyTls} onChange={set('verifyTls')} /><span className="muted">Verificar certificado TLS</span>
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

/* ===================== Proxmox VE ===================== */

function PveHosts() {
  const list = useAsync(() => api.pveList(), []);
  const [editing, setEditing] = useState(null);
  const [testing, setTesting] = useState({});

  async function test(id) {
    setTesting((t) => ({ ...t, [id]: { loading: true } }));
    try { const r = await api.pveTest(id); setTesting((t) => ({ ...t, [id]: r })); }
    catch (err) { setTesting((t) => ({ ...t, [id]: { ok: false, error: err.message } })); }
  }
  async function makeDefault(id) { await api.pveSetDefault(id); list.reload(); }
  async function remove(id, name) { if (await confirmDialog({ message: `¿Eliminar la conexión "${name}"?`, danger: true, confirmLabel: 'Eliminar' })) { await api.pveDelete(id); list.reload(); } }

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 16 }}>
        <p className="muted" style={{ margin: 0, maxWidth: 560 }}>
          Conexiones a Proxmox VE para ejecutar restauraciones. Crea un API token en PVE
          (Datacenter → Permisos → API Tokens) con permisos sobre VMs y almacenamiento.
        </p>
        <button className="btn primary" onClick={() => setEditing({})}>+ Añadir Proxmox VE</button>
      </div>

      {list.loading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : !list.data.length ? (
        <div className="card card-pad" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ color: 'var(--brand)', marginBottom: 8 }}><Icon.restore width={30} height={30} /></div>
          <p className="muted">Sin conexiones Proxmox VE. Añade una para habilitar la recuperación.</p>
          <button className="btn primary" onClick={() => setEditing({})}>+ Añadir Proxmox VE</button>
        </div>
      ) : (
        <div className="grid cols-2">
          {list.data.map((h) => {
            const t = testing[h.id];
            return (
              <div className="card card-pad" key={h.id}>
                <div className="flex-between">
                  <h3 style={{ margin: 0 }}>{h.name} {h.isDefault && <span className="badge ok" style={{ marginLeft: 6 }}>por defecto</span>}</h3>
                  <span className="badge info">API token</span>
                </div>
                <table style={{ marginTop: 10 }}>
                  <tbody>
                    <tr><td className="muted">Host</td><td className="mono" style={{ fontSize: 12 }}>{h.host}</td></tr>
                    <tr><td className="muted">Token</td><td>{h.tokenId} {h.hasSecret ? '••••' : <span className="badge err">sin secreto</span>}</td></tr>
                  </tbody>
                </table>
                {t && !t.loading && (t.ok
                  ? <div className="banner" style={{ marginTop: 12 }}>✓ Conexión OK — PVE {t.version?.version}</div>
                  : <div className="error-box" style={{ marginTop: 12 }}>✕ {t.error}</div>)}
                <div className="btn-row" style={{ marginTop: 14 }}>
                  <button className="btn sm" onClick={() => test(h.id)} disabled={t?.loading}><Icon.bolt width={13} height={13} /> {t?.loading ? 'Probando…' : 'Probar'}</button>
                  {!h.isDefault && <button className="btn sm" onClick={() => makeDefault(h.id)}>Predeterminado</button>}
                  <button className="btn sm ghost" onClick={() => setEditing(h)}>Editar</button>
                  <button className="btn sm ghost danger" onClick={() => remove(h.id, h.name)}>Eliminar</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && <PveModal pve={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />}
    </div>
  );
}

function PveModal({ pve, onClose, onSaved }) {
  const isNew = !pve.id;
  const [form, setForm] = useState(() => ({
    name: pve.name || '', host: pve.host || '', verifyTls: !!pve.verifyTls,
    tokenId: pve.tokenId || '', secret: '',
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function save(e) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const body = { ...form };
      if (!isNew && !body.secret) delete body.secret;
      if (isNew) await api.pveAdd(body); else await api.pveUpdate(pve.id, body);
      onSaved();
    } catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{isNew ? 'Añadir' : 'Editar'} Proxmox VE</h3>
        <ErrorBox error={error} />
        <form onSubmit={save}>
          <div className="field"><label>Nombre</label><input className="input" placeholder="PVE Producción" value={form.name} onChange={set('name')} /></div>
          <div className="field"><label>Host *</label><input className="input" placeholder="https://192.168.86.9:8006" value={form.host} onChange={set('host')} required /></div>
          <div className="field"><label>Token ID *</label><input className="input" placeholder="root@pam!gestor" value={form.tokenId} onChange={set('tokenId')} autoComplete="off" required /></div>
          <div className="field"><label>Secret {!isNew && <span className="muted">(vacío = conservar)</span>}</label><input className="input" type="password" placeholder="xxxxxxxx-xxxx-xxxx" value={form.secret} onChange={set('secret')} autoComplete="off" /></div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0 16px' }}>
            <input type="checkbox" checked={form.verifyTls} onChange={set('verifyTls')} /><span className="muted">Verificar certificado TLS (desmarcar si es autofirmado)</span>
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

/* ===================== Notificaciones (email) ===================== */

const NOTIFY_TYPES = [
  ['backup', 'Copias de seguridad'],
  ['verify', 'Verificación'],
  ['prune', 'Prune'],
  ['sync', 'Sincronización'],
  ['garbage_collection', 'Garbage collection'],
];

function NotifySettings() {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [test, setTest] = useState(null);
  const [silence, setSilence] = useState(null);

  useEffect(() => {
    api.notifyGet().then((c) => setForm({
      enabled: c.enabled, notifyOk: c.notifyOk, notifyFail: c.notifyFail,
      silenceProxmox: !!c.silenceProxmox,
      types: c.types || [], hasPass: c.smtp?.hasPass,
      smtp: { host: c.smtp?.host || '', port: c.smtp?.port || 587, secure: !!c.smtp?.secure, user: c.smtp?.user || '', pass: '', from: c.smtp?.from || '', to: c.smtp?.to || '' },
    })).catch(() => setForm(false));
  }, []);

  if (form === null) return <Loading />;
  if (form === false) return <ErrorBox error="No se pudo cargar la configuración" />;

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setSmtp = (k, v) => setForm((f) => ({ ...f, smtp: { ...f.smtp, [k]: v } }));
  const toggleType = (t) => setForm((f) => ({ ...f, types: f.types.includes(t) ? f.types.filter((x) => x !== t) : [...f.types, t] }));

  function payload() {
    const body = { enabled: form.enabled, notifyOk: form.notifyOk, notifyFail: form.notifyFail, types: form.types, smtp: { ...form.smtp } };
    if (!body.smtp.pass) delete body.smtp.pass; // conservar la guardada
    return body;
  }

  async function save() {
    setBusy(true); setMsg(null);
    try { await api.notifySave(payload()); setMsg('Configuración guardada.'); setForm((f) => ({ ...f, hasPass: f.smtp.pass ? true : f.hasPass, smtp: { ...f.smtp, pass: '' } })); }
    catch (e) { setMsg(`Error: ${e.message}`); }
    finally { setBusy(false); }
  }

  async function sendTest() {
    setTest({ loading: true });
    try { const r = await api.notifyTest({ smtp: form.smtp }); setTest(r); }
    catch (e) { setTest({ ok: false, error: e.message }); }
  }

  async function applySilence() {
    setSilence({ loading: true });
    try { const r = await api.notifySilenceProxmox(form.silenceProxmox); setSilence(r); }
    catch (e) { setSilence({ error: e.message }); }
  }

  return (
    <div className="grid" style={{ gap: 16, maxWidth: 720 }}>
      <div className="card card-pad">
        <div className="flex-between">
          <h3 style={{ margin: 0 }}>Notificaciones por email</h3>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} />
            <span className="muted">Activadas</span>
          </label>
        </div>
        <p className="muted" style={{ marginTop: 6 }}>
          El gestor vigila las tareas finalizadas en el PBS por defecto y envía un email limpio y estructurado al terminar cada una.
        </p>

        <div className="row" style={{ marginTop: 6 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={form.notifyOk} onChange={(e) => set('notifyOk', e.target.checked)} /><span className="muted">Avisar de éxitos</span>
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={form.notifyFail} onChange={(e) => set('notifyFail', e.target.checked)} /><span className="muted">Avisar de fallos</span>
          </label>
        </div>

        <div className="field" style={{ marginTop: 10 }}>
          <label>Tipos de tarea a notificar</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {NOTIFY_TYPES.map(([k, lbl]) => (
              <label key={k} style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 13 }}>
                <input type="checkbox" checked={form.types.includes(k)} onChange={() => toggleType(k)} /> {lbl}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <h3 style={{ marginTop: 0 }}>Servidor SMTP</h3>
        <div className="row">
          <div className="field" style={{ flex: 2 }}><label>Host *</label><input className="input" placeholder="smtp.gmail.com" value={form.smtp.host} onChange={(e) => setSmtp('host', e.target.value)} /></div>
          <div className="field"><label>Puerto</label><input className="input" type="number" value={form.smtp.port} onChange={(e) => setSmtp('port', Number(e.target.value))} /></div>
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '2px 0 12px' }}>
          <input type="checkbox" checked={form.smtp.secure} onChange={(e) => setSmtp('secure', e.target.checked)} />
          <span className="muted">Conexión SSL/TLS directa (puerto 465). Desmarcado = STARTTLS (587/25)</span>
        </label>
        <div className="row">
          <div className="field"><label>Usuario</label><input className="input" value={form.smtp.user} onChange={(e) => setSmtp('user', e.target.value)} autoComplete="off" /></div>
          <div className="field"><label>Contraseña {form.hasPass && <span className="muted">(vacío = conservar)</span>}</label><input className="input" type="password" value={form.smtp.pass} onChange={(e) => setSmtp('pass', e.target.value)} autoComplete="off" /></div>
        </div>
        <div className="row">
          <div className="field"><label>Remitente (From)</label><input className="input" placeholder="pbsmanager@midominio.com" value={form.smtp.from} onChange={(e) => setSmtp('from', e.target.value)} /></div>
          <div className="field"><label>Destinatario (To) *</label><input className="input" placeholder="admin@midominio.com" value={form.smtp.to} onChange={(e) => setSmtp('to', e.target.value)} /></div>
        </div>

        {test && !test.loading && (test.ok
          ? <div className="banner" style={{ marginTop: 4 }}>✓ Email de prueba enviado a {form.smtp.to}</div>
          : <div className="error-box" style={{ marginTop: 4 }}>✕ {test.error}</div>)}
        {msg && <div className="banner" style={{ marginTop: 4 }}>{msg}</div>}

        <div className="btn-row" style={{ marginTop: 14 }}>
          <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
          <button className="btn" onClick={sendTest} disabled={test?.loading}><Icon.bolt width={14} height={14} /> {test?.loading ? 'Enviando…' : 'Enviar email de prueba'}</button>
        </div>
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>Consejo: guarda primero la configuración; la prueba usa el host/usuario indicados (y la contraseña guardada si dejas el campo vacío).</p>
      </div>

      <div className="card card-pad">
        <h3 style={{ marginTop: 0 }}>Evitar emails duplicados de Proxmox</h3>
        <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', margin: '2px 0 10px' }}>
          <input type="checkbox" checked={form.silenceProxmox} onChange={(e) => set('silenceProxmox', e.target.checked)} style={{ marginTop: 3 }} />
          <span className="muted">
            Silenciar las notificaciones <b>nativas de Proxmox</b> para que PBI sea la única fuente de emails.
            En <b>Proxmox VE</b> pone en silencio los trabajos de copia; en <b>PBS</b> deshabilita su <i>matcher</i> de email
            (esto silencia <b>todos</b> los emails que origina PBS, no solo los de tareas). Reversible al desmarcar y volver a aplicar.
          </span>
        </label>

        {silence && !silence.loading && (
          silence.error
            ? <div className="error-box">✕ {silence.error}</div>
            : <div className="banner">
                {silence.enable ? 'Silenciado aplicado' : 'Notificaciones de Proxmox restauradas'} ·
                PVE: {silence.pve?.error ? `error (${silence.pve.error})` : `${silence.pve?.changed ?? 0}/${silence.pve?.total ?? 0} trabajos`} ·
                PBS: {silence.pbs?.error ? `error (${silence.pbs.error})` : 'OK'}
              </div>
        )}

        <button className="btn primary" onClick={applySilence} disabled={silence?.loading}>
          {silence?.loading ? 'Aplicando…' : form.silenceProxmox ? 'Aplicar (silenciar Proxmox)' : 'Aplicar (restaurar Proxmox)'}
        </button>
      </div>
    </div>
  );
}

/* ===================== Usuarios ===================== */

function UserManagement({ currentUser }) {
  const users = useAsync(() => api.usersList(), []);
  const [editing, setEditing] = useState(null); // {} nuevo | user editar
  const [msg, setMsg] = useState(null);

  async function remove(u) {
    if (!(await confirmDialog({ message: `¿Eliminar al usuario "${u.username}"?`, danger: true, confirmLabel: 'Eliminar' }))) return;
    try { await api.userDelete(u.id); users.reload(); }
    catch (e) { setMsg(`Error: ${e.message}`); }
  }
  async function setRole(u, role) {
    try { await api.userUpdate(u.id, { role }); users.reload(); }
    catch (e) { setMsg(`Error: ${e.message}`); }
  }

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 16 }}>
        <p className="muted" style={{ margin: 0, maxWidth: 560 }}>
          Cuentas con acceso al panel. Los <b>administradores</b> gestionan usuarios y configuración; los <b>operadores</b> usan el panel.
        </p>
        <button className="btn primary" onClick={() => setEditing({})}>+ Añadir usuario</button>
      </div>

      {msg && <div className="banner">{msg}</div>}

      <div className="card">
        {users.loading ? <Loading /> : users.error ? <div className="card-pad"><ErrorBox error={users.error} /></div> : (
          <table>
            <thead><tr><th>Usuario</th><th>Rol</th><th>Creado</th><th style={{ width: 1 }}>Acciones</th></tr></thead>
            <tbody>
              {users.data.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.username}</strong>
                    {u.id === currentUser.id && <span className="badge muted plain" style={{ marginLeft: 6 }}>tú</span>}
                    {u.totpEnabled && <span className="badge ok" style={{ marginLeft: 6 }}>2FA</span>}
                  </td>
                  <td>
                    <select value={u.role} onChange={(e) => setRole(u, e.target.value)} style={{ width: 130 }} disabled={u.id === currentUser.id}>
                      <option value="admin">Administrador</option>
                      <option value="operator">Operador</option>
                    </select>
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>{u.createdAt ? new Date(u.createdAt).toLocaleDateString('es-ES') : '—'}</td>
                  <td>
                    <div className="btn-row" style={{ flexWrap: 'nowrap' }}>
                      <button className="btn sm ghost" onClick={() => setEditing(u)}>Editar</button>
                      <button className="btn sm ghost danger" onClick={() => remove(u)} disabled={u.id === currentUser.id}>Eliminar</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <UserModal user={editing} isSelf={editing.id === currentUser.id} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); users.reload(); }} onError={(m) => setMsg(`Error: ${m}`)} />
      )}
    </div>
  );
}

function UserModal({ user, onClose, onSaved, onError, isSelf }) {
  const isNew = !user.id;
  const [form, setForm] = useState({ username: user.username || '', password: '', role: user.role || 'operator', resetTotp: false });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function save(e) {
    e.preventDefault(); setBusy(true);
    try {
      if (isNew) {
        await api.userCreate({ username: form.username, password: form.password, role: form.role });
      } else {
        const body = { username: form.username, role: form.role, resetTotp: form.resetTotp };
        if (form.password) body.password = form.password;
        await api.userUpdate(user.id, body);
      }
      onSaved();
    } catch (err) { onError(err.message); setBusy(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <h3>{isNew ? 'Nuevo usuario' : `Editar usuario · ${user.username}`}</h3>
        <form onSubmit={save}>
          <div className="field"><label>Usuario</label>
            <input className="input" value={form.username} onChange={set('username')} autoComplete="off" required />
          </div>
          <div className="field"><label>Rol</label>
            <select value={form.role} onChange={set('role')} disabled={isSelf}>
              <option value="operator">Operador</option><option value="admin">Administrador</option>
            </select>
            {isSelf && <span className="muted" style={{ fontSize: 11.5 }}>No puedes cambiar tu propio rol.</span>}
          </div>
          <div className="field"><label>{isNew ? 'Contraseña (mín. 6)' : 'Nueva contraseña'} {!isNew && <span className="muted">(vacío = conservar)</span>}</label>
            <input className="input" type="password" value={form.password} onChange={set('password')} autoComplete="new-password" required={isNew} minLength={6} />
          </div>
          {!isNew && user.totpEnabled && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '2px 0 14px' }}>
              <input type="checkbox" checked={form.resetTotp} onChange={set('resetTotp')} style={{ marginTop: 3 }} />
              <span className="muted">Restablecer (desactivar) la 2FA de este usuario. Tendrá que volver a configurarla desde «Mi cuenta».</span>
            </label>
          )}
          <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
            <button className="btn primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ===================== Mi cuenta (contraseña + 2FA) ===================== */

function AccountSettings() {
  const acc = useAsync(() => api.accountGet(), []);
  const [pw, setPw] = useState({ current: '', next: '', next2: '' });
  const [pwMsg, setPwMsg] = useState(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [tfaMsg, setTfaMsg] = useState(null);
  const [tfaBusy, setTfaBusy] = useState(false);

  if (acc.loading) return <Loading />;
  if (acc.error) return <ErrorBox error={acc.error} />;
  const enabled = acc.data.totpEnabled;

  async function changePw(e) {
    e.preventDefault();
    if (pw.next !== pw.next2) { setPwMsg('Las contraseñas nuevas no coinciden'); return; }
    setPwBusy(true); setPwMsg(null);
    try { await api.accountPassword({ currentPassword: pw.current, newPassword: pw.next }); setPwMsg('Contraseña actualizada.'); setPw({ current: '', next: '', next2: '' }); }
    catch (e) { setPwMsg(`Error: ${e.message}`); } finally { setPwBusy(false); }
  }
  async function startSetup() { setTfaMsg(null); try { setSetup(await api.account2faSetup()); } catch (e) { setTfaMsg(e.message); } }
  async function enable() { setTfaBusy(true); setTfaMsg(null); try { await api.account2faEnable(code); setSetup(null); setCode(''); acc.reload(); } catch (e) { setTfaMsg(e.message); } finally { setTfaBusy(false); } }
  async function disable() { setTfaBusy(true); setTfaMsg(null); try { await api.account2faDisable(disableCode); setDisableCode(''); acc.reload(); } catch (e) { setTfaMsg(e.message); } finally { setTfaBusy(false); } }

  return (
    <div className="grid" style={{ gap: 16, maxWidth: 580 }}>
      <div className="card card-pad">
        <h3 style={{ marginTop: 0 }}>Mi cuenta</h3>
        <p className="muted" style={{ margin: 0 }}>{acc.data.username} · {acc.data.role === 'admin' ? 'Administrador' : 'Operador'}</p>
      </div>

      <div className="card card-pad">
        <h3 style={{ marginTop: 0 }}>Cambiar contraseña</h3>
        {pwMsg && <div className="banner">{pwMsg}</div>}
        <form onSubmit={changePw}>
          <div className="field"><label>Contraseña actual</label><input className="input" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" required /></div>
          <div className="row">
            <div className="field"><label>Nueva (mín. 6)</label><input className="input" type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" minLength={6} required /></div>
            <div className="field"><label>Repetir nueva</label><input className="input" type="password" value={pw.next2} onChange={(e) => setPw({ ...pw, next2: e.target.value })} autoComplete="new-password" required /></div>
          </div>
          <button className="btn primary" disabled={pwBusy}>{pwBusy ? 'Guardando…' : 'Cambiar contraseña'}</button>
        </form>
      </div>

      <div className="card card-pad">
        <h3 style={{ marginTop: 0 }}>Verificación en dos pasos (2FA)</h3>
        {tfaMsg && <div className="error-box">{tfaMsg}</div>}
        {enabled ? (
          <>
            <div className="banner">✓ La 2FA está activada en tu cuenta.</div>
            <p className="muted">Para desactivarla, introduce un código actual de tu app de autenticación:</p>
            <div className="row" style={{ maxWidth: 360 }}>
              <input className="input" inputMode="numeric" placeholder="123456" maxLength={6} value={disableCode} onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ''))} />
              <button className="btn danger" onClick={disable} disabled={tfaBusy || disableCode.length < 6}>Desactivar</button>
            </div>
          </>
        ) : setup ? (
          <>
            <p className="muted">Escanea el código con Google Authenticator, Authy, FreeOTP… (o introduce la clave manual) y confirma con un código.</p>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <img src={setup.qr} alt="Código QR 2FA" width={160} height={160} style={{ border: '1px solid var(--border)', borderRadius: 8 }} />
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Clave manual:</div>
                <code style={{ fontSize: 12.5, wordBreak: 'break-all' }}>{setup.secret}</code>
              </div>
            </div>
            <div className="field" style={{ marginTop: 12, maxWidth: 220 }}><label>Código de verificación</label>
              <input className="input" inputMode="numeric" placeholder="123456" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
            </div>
            <div className="btn-row">
              <button className="btn primary" onClick={enable} disabled={tfaBusy || code.length < 6}>{tfaBusy ? 'Activando…' : 'Activar 2FA'}</button>
              <button className="btn" onClick={() => { setSetup(null); setCode(''); }}>Cancelar</button>
            </div>
          </>
        ) : (
          <>
            <p className="muted">Añade una capa extra de seguridad: además de la contraseña, al iniciar sesión te pedirá un código de tu móvil.</p>
            <button className="btn primary" onClick={startSetup}>Activar 2FA</button>
          </>
        )}
      </div>
    </div>
  );
}

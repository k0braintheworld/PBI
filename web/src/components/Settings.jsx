import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAsync, Loading, ErrorBox, confirmDialog } from './common.jsx';
import { Icon } from './icons.jsx';
import { useT } from '../i18n.jsx';

/** Configuración: conexiones a Proxmox Backup Server y a Proxmox VE. */
export default function Settings({ onHostsChanged, user }) {
  const tr = useT();
  const [section, setSection] = useState('pbs');
  const isAdmin = user?.role === 'admin';
  return (
    <div className="rise">
      <div className="seg pagehead">
        <button className={section === 'pbs' ? 'active' : ''} onClick={() => setSection('pbs')}>Proxmox Backup Server</button>
        <button className={section === 'pve' ? 'active' : ''} onClick={() => setSection('pve')}>{tr('Proxmox VE (recuperación)')}</button>
        <button className={section === 'notify' ? 'active' : ''} onClick={() => setSection('notify')}>{tr('Notificaciones')}</button>
        {isAdmin && <button className={section === 'users' ? 'active' : ''} onClick={() => setSection('users')}>{tr('Usuarios')}</button>}
        <button className={section === 'prefs' ? 'active' : ''} onClick={() => setSection('prefs')}>{tr('Preferencias')}</button>
        <button className={section === 'account' ? 'active' : ''} onClick={() => setSection('account')}>{tr('Mi cuenta')}</button>
      </div>
      {section === 'pbs' && <PbsHosts onHostsChanged={onHostsChanged} />}
      {section === 'pve' && <PveHosts />}
      {section === 'notify' && <NotifySettings />}
      {section === 'prefs' && <Preferences isAdmin={isAdmin} />}
      {section === 'users' && isAdmin && <UserManagement currentUser={user} />}
      {section === 'account' && <AccountSettings />}
    </div>
  );
}

/* ===================== Preferencias de interfaz ===================== */
function Preferences({ isAdmin }) {
  const tr = useT();
  const [weekStart, setWeekStart] = useState(
    (typeof localStorage !== 'undefined' && localStorage.getItem('pbi_week_start')) || 'mon',
  );
  function change(v) {
    setWeekStart(v);
    try { localStorage.setItem('pbi_week_start', v); } catch { /* ignore */ }
  }

  const [idle, setIdle] = useState(null); // minutos (null = cargando)
  const [savedMsg, setSavedMsg] = useState('');
  useEffect(() => {
    api.security().then((s) => setIdle(Number(s?.sessionIdleMinutes) || 0)).catch(() => setIdle(0));
  }, []);
  async function saveIdle() {
    const v = Math.max(0, Math.min(1440, Number(idle) || 0));
    setIdle(v);
    try {
      await api.setSecurity({ sessionIdleMinutes: v });
      setSavedMsg(tr('Guardado')); setTimeout(() => setSavedMsg(''), 1800);
    } catch { /* ignore */ }
  }

  return (
    <>
      <div className="card card-pad" style={{ maxWidth: 520 }}>
        <h3 style={{ marginTop: 0 }}>{tr('Preferencias de interfaz')}</h3>
        <label style={{ fontSize: 13, color: 'var(--text-2)' }}>{tr('Inicio de semana')}</label>
        <div style={{ marginTop: 6 }}>
          <select className="input" value={weekStart} onChange={(e) => change(e.target.value)} style={{ maxWidth: 220 }}>
            <option value="mon">{tr('Lunes')}</option>
            <option value="sun">{tr('Domingo')}</option>
          </select>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>{tr('Afecta al calendario de copias del panel. Se guarda en este navegador.')}</p>
      </div>

      {isAdmin && (
        <div className="card card-pad" style={{ maxWidth: 520, marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>{tr('Seguridad')}</h3>
          <label style={{ fontSize: 13, color: 'var(--text-2)' }}>{tr('Cierre de sesión por inactividad (minutos)')}</label>
          <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
            <input
              className="input" type="number" min="0" max="1440" style={{ maxWidth: 120 }}
              value={idle == null ? '' : idle}
              onChange={(e) => setIdle(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
            />
            <button className="btn primary" onClick={saveIdle} disabled={idle == null}>{tr('Guardar')}</button>
            {savedMsg && <span className="muted" style={{ fontSize: 12 }}>{savedMsg}</span>}
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>{tr('0 = desactivado. Se aplica a todos los usuarios. La sesión se cierra tras ese tiempo sin actividad.')}</p>
        </div>
      )}
    </>
  );
}

/* ===================== Proxmox Backup Server ===================== */

function PbsHosts({ onHostsChanged }) {
  const tr = useT();
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
  async function remove(id, name) { if (await confirmDialog({ message: `${tr('¿Eliminar el host')} "${name}"?`, danger: true, confirmLabel: tr('Eliminar') })) { await api.deleteHost(id); refresh(); } }

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 16 }}>
        <p className="muted" style={{ margin: 0 }}>{tr('Servidores Proxmox Backup guardados de forma persistente.')}</p>
        <button className="btn primary" onClick={() => setEditing({})}>{tr('+ Añadir host')}</button>
      </div>

      {hosts.loading ? <Loading /> : hosts.error ? <ErrorBox error={hosts.error} /> : !hosts.data.length ? (
        <div className="card card-pad" style={{ textAlign: 'center', padding: 40 }}>
          <p className="muted">{tr('No hay hosts configurados.')}</p>
          <button className="btn primary" onClick={() => setEditing({})}>{tr('+ Añadir tu primer host PBS')}</button>
        </div>
      ) : (
        <div className="grid cols-2">
          {hosts.data.map((h) => {
            const t = testing[h.id];
            return (
              <div className="card card-pad" key={h.id}>
                <div className="flex-between">
                  <h3 style={{ margin: 0 }}>{h.name} {h.isDefault && <span className="badge ok" style={{ marginLeft: 6 }}>{tr('por defecto')}</span>}</h3>
                  <span className="badge info">{h.authMode === 'token' ? 'API token' : tr('usuario/contraseña')}</span>
                </div>
                <table style={{ marginTop: 10 }}>
                  <tbody>
                    <tr><td className="muted">Host</td><td className="mono" style={{ fontSize: 12 }}>{h.host}</td></tr>
                    <tr><td className="muted">{tr('Nodo')}</td><td>{h.node}</td></tr>
                    <tr><td className="muted">{tr('Credencial')}</td><td>{h.authMode === 'token' ? h.tokenId : h.username} {h.hasSecret ? '••••' : <span className="badge err">{tr('sin secreto')}</span>}</td></tr>
                  </tbody>
                </table>
                {t && !t.loading && (t.ok
                  ? <div className="banner" style={{ marginTop: 12 }}>{tr('✓ Conexión OK — PBS')} {t.version?.version}</div>
                  : <div className="error-box" style={{ marginTop: 12 }}>✕ {t.error}</div>)}
                <div className="btn-row" style={{ marginTop: 14 }}>
                  <button className="btn sm" onClick={() => test(h.id)} disabled={t?.loading}><Icon.bolt width={13} height={13} /> {t?.loading ? tr('Probando…') : tr('Probar')}</button>
                  {!h.isDefault && <button className="btn sm" onClick={() => makeDefault(h.id)}>{tr('Predeterminado')}</button>}
                  <button className="btn sm ghost" onClick={() => setEditing(h)}>{tr('Editar')}</button>
                  <button className="btn sm ghost danger" onClick={() => remove(h.id, h.name)}>{tr('Eliminar')}</button>
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
  const tr = useT();
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
        <h3>{isNew ? tr('Añadir') : tr('Editar')} {tr('host PBS')}</h3>
        <ErrorBox error={error} />
        <form onSubmit={save}>
          <div className="field"><label>{tr('Nombre')}</label><input className="input" placeholder={tr('PBS Producción')} value={form.name} onChange={set('name')} /></div>
          <div className="row">
            <div className="field" style={{ flex: 2 }}><label>Host *</label><input className="input" placeholder="https://192.168.1.10:8007" value={form.host} onChange={set('host')} required /></div>
            <div className="field"><label>{tr('Nodo')}</label><input className="input" placeholder="localhost" value={form.node} onChange={set('node')} /></div>
          </div>
          <div className="field"><label>{tr('Modo de autenticación')}</label>
            <select value={form.authMode} onChange={set('authMode')}><option value="token">API Token</option><option value="ticket">{tr('Usuario / Contraseña')}</option></select>
          </div>
          {form.authMode === 'token' ? (
            <>
              <div className="field"><label>Token ID</label><input className="input" placeholder="root@pam!mitoken" value={form.tokenId} onChange={set('tokenId')} autoComplete="off" /></div>
              <div className="field"><label>Secret {!isNew && <span className="muted">{tr('(vacío = conservar)')}</span>}</label><input className="input" type="password" value={form.secret} onChange={set('secret')} autoComplete="off" /></div>
            </>
          ) : (
            <>
              <div className="field"><label>{tr('Usuario')}</label><input className="input" placeholder="root@pam" value={form.username} onChange={set('username')} autoComplete="off" /></div>
              <div className="field"><label>{tr('Contraseña')} {!isNew && <span className="muted">{tr('(vacío = conservar)')}</span>}</label><input className="input" type="password" value={form.password} onChange={set('password')} autoComplete="off" /></div>
            </>
          )}
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0 16px' }}>
            <input type="checkbox" checked={form.verifyTls} onChange={set('verifyTls')} /><span className="muted">{tr('Verificar certificado TLS')}</span>
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

/* ===================== Proxmox VE ===================== */

function PveHosts() {
  const tr = useT();
  const list = useAsync(() => api.pveList(), []);
  const [editing, setEditing] = useState(null);
  const [testing, setTesting] = useState({});

  async function test(id) {
    setTesting((t) => ({ ...t, [id]: { loading: true } }));
    try { const r = await api.pveTest(id); setTesting((t) => ({ ...t, [id]: r })); }
    catch (err) { setTesting((t) => ({ ...t, [id]: { ok: false, error: err.message } })); }
  }
  async function makeDefault(id) { await api.pveSetDefault(id); list.reload(); }
  async function remove(id, name) { if (await confirmDialog({ message: `${tr('¿Eliminar la conexión')} "${name}"?`, danger: true, confirmLabel: tr('Eliminar') })) { await api.pveDelete(id); list.reload(); } }

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 16 }}>
        <p className="muted" style={{ margin: 0, maxWidth: 560 }}>
          {tr('Conexiones a Proxmox VE para ejecutar restauraciones. Crea un API token en PVE (Datacenter → Permisos → API Tokens) con permisos sobre VMs y almacenamiento.')}
        </p>
        <button className="btn primary" onClick={() => setEditing({})}>{tr('+ Añadir Proxmox VE')}</button>
      </div>

      {list.loading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : !list.data.length ? (
        <div className="card card-pad" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ color: 'var(--brand)', marginBottom: 8 }}><Icon.restore width={30} height={30} /></div>
          <p className="muted">{tr('Sin conexiones Proxmox VE. Añade una para habilitar la recuperación.')}</p>
          <button className="btn primary" onClick={() => setEditing({})}>{tr('+ Añadir Proxmox VE')}</button>
        </div>
      ) : (
        <div className="grid cols-2">
          {list.data.map((h) => {
            const t = testing[h.id];
            return (
              <div className="card card-pad" key={h.id}>
                <div className="flex-between">
                  <h3 style={{ margin: 0 }}>{h.name} {h.isDefault && <span className="badge ok" style={{ marginLeft: 6 }}>{tr('por defecto')}</span>}</h3>
                  <span className="badge info">API token</span>
                </div>
                <table style={{ marginTop: 10 }}>
                  <tbody>
                    <tr><td className="muted">Host</td><td className="mono" style={{ fontSize: 12 }}>{h.host}</td></tr>
                    <tr><td className="muted">Token</td><td>{h.tokenId} {h.hasSecret ? '••••' : <span className="badge err">{tr('sin secreto')}</span>}</td></tr>
                  </tbody>
                </table>
                {t && !t.loading && (t.ok
                  ? <div className="banner" style={{ marginTop: 12 }}>{tr('✓ Conexión OK — PVE')} {t.version?.version}</div>
                  : <div className="error-box" style={{ marginTop: 12 }}>✕ {t.error}</div>)}
                <div className="btn-row" style={{ marginTop: 14 }}>
                  <button className="btn sm" onClick={() => test(h.id)} disabled={t?.loading}><Icon.bolt width={13} height={13} /> {t?.loading ? tr('Probando…') : tr('Probar')}</button>
                  {!h.isDefault && <button className="btn sm" onClick={() => makeDefault(h.id)}>{tr('Predeterminado')}</button>}
                  <button className="btn sm ghost" onClick={() => setEditing(h)}>{tr('Editar')}</button>
                  <button className="btn sm ghost danger" onClick={() => remove(h.id, h.name)}>{tr('Eliminar')}</button>
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
  const tr = useT();
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
        <h3>{isNew ? tr('Añadir') : tr('Editar')} Proxmox VE</h3>
        <ErrorBox error={error} />
        <form onSubmit={save}>
          <div className="field"><label>{tr('Nombre')}</label><input className="input" placeholder={tr('PVE Producción')} value={form.name} onChange={set('name')} /></div>
          <div className="field"><label>Host *</label><input className="input" placeholder="https://192.168.86.9:8006" value={form.host} onChange={set('host')} required /></div>
          <div className="field"><label>Token ID *</label><input className="input" placeholder="root@pam!gestor" value={form.tokenId} onChange={set('tokenId')} autoComplete="off" required /></div>
          <div className="field"><label>Secret {!isNew && <span className="muted">{tr('(vacío = conservar)')}</span>}</label><input className="input" type="password" placeholder="xxxxxxxx-xxxx-xxxx" value={form.secret} onChange={set('secret')} autoComplete="off" /></div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0 16px' }}>
            <input type="checkbox" checked={form.verifyTls} onChange={set('verifyTls')} /><span className="muted">{tr('Verificar certificado TLS (desmarcar si es autofirmado)')}</span>
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

/* ===================== Notificaciones (email) ===================== */

const NOTIFY_TYPES = [
  ['backup', 'Copias de seguridad'],
  ['verify', 'Verificación'],
  ['prune', 'Prune'],
  ['sync', 'Sincronización'],
  ['garbage_collection', 'Garbage collection'],
];

function NotifySettings() {
  const tr = useT();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [test, setTest] = useState(null);
  const [silence, setSilence] = useState(null);

  useEffect(() => {
    api.notifyGet().then((c) => setForm({
      enabled: c.enabled, notifyOk: c.notifyOk, notifyFail: c.notifyFail,
      notifyRestore: c.notifyRestore !== false,
      silenceProxmox: !!c.silenceProxmox,
      types: c.types || [], hasPass: c.smtp?.hasPass,
      smtp: { host: c.smtp?.host || '', port: c.smtp?.port || 587, secure: !!c.smtp?.secure, user: c.smtp?.user || '', pass: '', from: c.smtp?.from || '', to: c.smtp?.to || '' },
    })).catch(() => setForm(false));
  }, []);

  if (form === null) return <Loading />;
  if (form === false) return <ErrorBox error={tr('No se pudo cargar la configuración')} />;

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setSmtp = (k, v) => setForm((f) => ({ ...f, smtp: { ...f.smtp, [k]: v } }));
  const toggleType = (t) => setForm((f) => ({ ...f, types: f.types.includes(t) ? f.types.filter((x) => x !== t) : [...f.types, t] }));

  function payload() {
    const body = { enabled: form.enabled, notifyOk: form.notifyOk, notifyFail: form.notifyFail, notifyRestore: form.notifyRestore, types: form.types, smtp: { ...form.smtp } };
    if (!body.smtp.pass) delete body.smtp.pass; // conservar la guardada
    return body;
  }

  async function save() {
    setBusy(true); setMsg(null);
    try { await api.notifySave(payload()); setMsg(tr('Configuración guardada.')); setForm((f) => ({ ...f, hasPass: f.smtp.pass ? true : f.hasPass, smtp: { ...f.smtp, pass: '' } })); }
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
          <h3 style={{ margin: 0 }}>{tr('Notificaciones por email')}</h3>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} />
            <span className="muted">{tr('Activadas')}</span>
          </label>
        </div>
        <p className="muted" style={{ marginTop: 6 }}>
          {tr('El gestor vigila las tareas finalizadas en el PBS por defecto y envía un email limpio y estructurado al terminar cada una.')}
        </p>

        <div className="row" style={{ marginTop: 6 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={form.notifyOk} onChange={(e) => set('notifyOk', e.target.checked)} /><span className="muted">{tr('Avisar de éxitos')}</span>
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={form.notifyFail} onChange={(e) => set('notifyFail', e.target.checked)} /><span className="muted">{tr('Avisar de fallos')}</span>
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={form.notifyRestore} onChange={(e) => set('notifyRestore', e.target.checked)} /><span className="muted">{tr('Avisar de restauraciones')}</span>
          </label>
        </div>

        <div className="field" style={{ marginTop: 10 }}>
          <label>{tr('Tipos de tarea a notificar')}</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {NOTIFY_TYPES.map(([k, lbl]) => (
              <label key={k} style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 13 }}>
                <input type="checkbox" checked={form.types.includes(k)} onChange={() => toggleType(k)} /> {tr(lbl)}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <h3 style={{ marginTop: 0 }}>{tr('Servidor SMTP')}</h3>
        <div className="row">
          <div className="field" style={{ flex: 2 }}><label>Host *</label><input className="input" placeholder="smtp.gmail.com" value={form.smtp.host} onChange={(e) => setSmtp('host', e.target.value)} /></div>
          <div className="field"><label>{tr('Puerto')}</label><input className="input" type="number" value={form.smtp.port} onChange={(e) => setSmtp('port', Number(e.target.value))} /></div>
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '2px 0 12px' }}>
          <input type="checkbox" checked={form.smtp.secure} onChange={(e) => setSmtp('secure', e.target.checked)} />
          <span className="muted">{tr('Conexión SSL/TLS directa (puerto 465). Desmarcado = STARTTLS (587/25)')}</span>
        </label>
        <div className="row">
          <div className="field"><label>{tr('Usuario')}</label><input className="input" value={form.smtp.user} onChange={(e) => setSmtp('user', e.target.value)} autoComplete="off" /></div>
          <div className="field"><label>{tr('Contraseña')} {form.hasPass && <span className="muted">{tr('(vacío = conservar)')}</span>}</label><input className="input" type="password" value={form.smtp.pass} onChange={(e) => setSmtp('pass', e.target.value)} autoComplete="off" /></div>
        </div>
        <div className="row">
          <div className="field"><label>{tr('Remitente (From)')}</label><input className="input" placeholder="pbi@midominio.com" value={form.smtp.from} onChange={(e) => setSmtp('from', e.target.value)} /></div>
          <div className="field"><label>{tr('Destinatario (To) *')}</label><input className="input" placeholder="admin@midominio.com" value={form.smtp.to} onChange={(e) => setSmtp('to', e.target.value)} /></div>
        </div>

        {test && !test.loading && (test.ok
          ? <div className="banner" style={{ marginTop: 4 }}>{tr('✓ Email de prueba enviado a')} {form.smtp.to}</div>
          : <div className="error-box" style={{ marginTop: 4 }}>✕ {test.error}</div>)}
        {msg && <div className="banner" style={{ marginTop: 4 }}>{msg}</div>}

        <div className="btn-row" style={{ marginTop: 14 }}>
          <button className="btn primary" onClick={save} disabled={busy}>{busy ? tr('Guardando…') : tr('Guardar')}</button>
          <button className="btn" onClick={sendTest} disabled={test?.loading}><Icon.bolt width={14} height={14} /> {test?.loading ? tr('Enviando…') : tr('Enviar email de prueba')}</button>
        </div>
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>{tr('Consejo: guarda primero la configuración; la prueba usa el host/usuario indicados (y la contraseña guardada si dejas el campo vacío).')}</p>
      </div>

      <div className="card card-pad">
        <h3 style={{ marginTop: 0 }}>{tr('Evitar emails duplicados de Proxmox')}</h3>
        <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', margin: '2px 0 10px' }}>
          <input type="checkbox" checked={form.silenceProxmox} onChange={(e) => set('silenceProxmox', e.target.checked)} style={{ marginTop: 3 }} />
          <span className="muted">
            {tr('Silenciar ')}<b>{tr('todas las notificaciones nativas de Proxmox')}</b>{tr(' para que PBI sea la única fuente de emails. Desactiva ')}<b>{tr('todos los avisos')}</b>{tr(' de trabajos en ambos lados —copia, verificación, prune, GC, sync, replicación…— deshabilitando los ')}<i>matchers</i>{tr(' de notificación de ')}<b>Proxmox VE</b>{tr(' y de ')}<b>PBS</b>{tr(' (se respetan los que ya tuvieras desactivados y se restauran exactamente los mismos al desmarcar). Reversible.')}
          </span>
        </label>

        {silence && !silence.loading && (
          silence.error
            ? <div className="error-box">✕ {silence.error}</div>
            : <div className="banner">
                {silence.enable ? tr('Silenciado aplicado') : tr('Notificaciones de Proxmox restauradas')} ·
                PVE: {silence.pve?.error ? `${tr('error')} (${silence.pve.error})` : `${silence.pve?.changed ?? 0}/${silence.pve?.total ?? 0} ${tr('trabajos')} · ${silence.pve?.matchers ?? 0} ${tr('aviso(s)')}${silence.pve?.matchersSupported === false ? ` (${tr('sin API de avisos')})` : ''}`} ·
                PBS: {silence.pbs?.error ? `${tr('error')} (${silence.pbs.error})` : `${silence.pbs?.matchers ?? 0} ${tr('aviso(s)')}`}
              </div>
        )}

        <button className="btn primary" onClick={applySilence} disabled={silence?.loading}>
          {silence?.loading ? tr('Aplicando…') : form.silenceProxmox ? tr('Aplicar (silenciar Proxmox)') : tr('Aplicar (restaurar Proxmox)')}
        </button>
      </div>
    </div>
  );
}

/* ===================== Usuarios ===================== */

function UserManagement({ currentUser }) {
  const tr = useT();
  const users = useAsync(() => api.usersList(), []);
  const [editing, setEditing] = useState(null); // {} nuevo | user editar
  const [msg, setMsg] = useState(null);

  async function remove(u) {
    if (!(await confirmDialog({ message: `${tr('¿Eliminar al usuario')} "${u.username}"?`, danger: true, confirmLabel: tr('Eliminar') }))) return;
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
          {tr('Cuentas con acceso al panel. Los ')}<b>{tr('administradores')}</b>{tr(' gestionan usuarios y configuración; los ')}<b>{tr('operadores')}</b>{tr(' usan el panel; los ')}<b>{tr('visores')}</b>{tr(' solo pueden consultar (solo lectura).')}
        </p>
        <button className="btn primary" onClick={() => setEditing({})}>{tr('+ Añadir usuario')}</button>
      </div>

      {msg && <div className="banner">{msg}</div>}

      <div className="card">
        {users.loading ? <Loading /> : users.error ? <div className="card-pad"><ErrorBox error={users.error} /></div> : (
          <table>
            <thead><tr><th>{tr('Usuario')}</th><th>{tr('Rol')}</th><th>{tr('Creado')}</th><th style={{ width: 1 }}>{tr('Acciones')}</th></tr></thead>
            <tbody>
              {users.data.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.username}</strong>
                    {u.id === currentUser.id && <span className="badge muted plain" style={{ marginLeft: 6 }}>{tr('tú')}</span>}
                    {u.totpEnabled && <span className="badge ok" style={{ marginLeft: 6 }}>2FA</span>}
                  </td>
                  <td>
                    <select value={u.role} onChange={(e) => setRole(u, e.target.value)} style={{ width: 130 }} disabled={u.id === currentUser.id}>
                      <option value="admin">{tr('Administrador')}</option>
                      <option value="operator">{tr('Operador')}</option>
                      <option value="viewer">{tr('Visor')}</option>
                    </select>
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}</td>
                  <td>
                    <div className="btn-row" style={{ flexWrap: 'nowrap' }}>
                      <button className="btn sm ghost" onClick={() => setEditing(u)}>{tr('Editar')}</button>
                      <button className="btn sm ghost danger" onClick={() => remove(u)} disabled={u.id === currentUser.id}>{tr('Eliminar')}</button>
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
  const tr = useT();
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
        <h3>{isNew ? tr('Nuevo usuario') : `${tr('Editar usuario')} · ${user.username}`}</h3>
        <form onSubmit={save}>
          <div className="field"><label>{tr('Usuario')}</label>
            <input className="input" value={form.username} onChange={set('username')} autoComplete="off" required />
          </div>
          <div className="field"><label>{tr('Rol')}</label>
            <select value={form.role} onChange={set('role')} disabled={isSelf}>
              <option value="operator">{tr('Operador')}</option>
              <option value="admin">{tr('Administrador')}</option>
              <option value="viewer">{tr('Visor')}</option>
            </select>
            {isSelf && <span className="muted" style={{ fontSize: 11.5 }}>{tr('No puedes cambiar tu propio rol.')}</span>}
          </div>
          <div className="field"><label>{isNew ? tr('Contraseña (mín. 10)') : tr('Nueva contraseña')} {!isNew && <span className="muted">{tr('(vacío = conservar)')}</span>}</label>
            <input className="input" type="password" value={form.password} onChange={set('password')} autoComplete="new-password" required={isNew} minLength={10} />
          </div>
          {!isNew && user.totpEnabled && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '2px 0 14px' }}>
              <input type="checkbox" checked={form.resetTotp} onChange={set('resetTotp')} style={{ marginTop: 3 }} />
              <span className="muted">{tr('Restablecer (desactivar) la 2FA de este usuario. Tendrá que volver a configurarla desde «Mi cuenta».')}</span>
            </label>
          )}
          <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={onClose}>{tr('Cancelar')}</button>
            <button className="btn primary" disabled={busy}>{busy ? tr('Guardando…') : tr('Guardar')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ===================== Mi cuenta (contraseña + 2FA) ===================== */

function AccountSettings() {
  const tr = useT();
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
    if (pw.next !== pw.next2) { setPwMsg(tr('Las contraseñas nuevas no coinciden')); return; }
    setPwBusy(true); setPwMsg(null);
    try { await api.accountPassword({ currentPassword: pw.current, newPassword: pw.next }); setPwMsg(tr('Contraseña actualizada.')); setPw({ current: '', next: '', next2: '' }); }
    catch (e) { setPwMsg(`Error: ${e.message}`); } finally { setPwBusy(false); }
  }
  async function startSetup() { setTfaMsg(null); try { setSetup(await api.account2faSetup()); } catch (e) { setTfaMsg(e.message); } }
  async function enable() { setTfaBusy(true); setTfaMsg(null); try { await api.account2faEnable(code); setSetup(null); setCode(''); acc.reload(); } catch (e) { setTfaMsg(e.message); } finally { setTfaBusy(false); } }
  async function disable() { setTfaBusy(true); setTfaMsg(null); try { await api.account2faDisable(disableCode); setDisableCode(''); acc.reload(); } catch (e) { setTfaMsg(e.message); } finally { setTfaBusy(false); } }

  return (
    <div className="grid" style={{ gap: 16, maxWidth: 580 }}>
      <div className="card card-pad">
        <h3 style={{ marginTop: 0 }}>{tr('Mi cuenta')}</h3>
        <p className="muted" style={{ margin: 0 }}>{acc.data.username} · {acc.data.role === 'admin' ? tr('Administrador') : acc.data.role === 'viewer' ? tr('Visor') : tr('Operador')}</p>
      </div>

      <div className="card card-pad">
        <h3 style={{ marginTop: 0 }}>{tr('Cambiar contraseña')}</h3>
        {pwMsg && <div className="banner">{pwMsg}</div>}
        <form onSubmit={changePw}>
          <div className="field"><label>{tr('Contraseña actual')}</label><input className="input" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" required /></div>
          <div className="row">
            <div className="field"><label>{tr('Nueva (mín. 10)')}</label><input className="input" type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" minLength={10} required /></div>
            <div className="field"><label>{tr('Repetir nueva')}</label><input className="input" type="password" value={pw.next2} onChange={(e) => setPw({ ...pw, next2: e.target.value })} autoComplete="new-password" required /></div>
          </div>
          <button className="btn primary" disabled={pwBusy}>{pwBusy ? tr('Guardando…') : tr('Cambiar contraseña')}</button>
        </form>
      </div>

      <div className="card card-pad">
        <h3 style={{ marginTop: 0 }}>{tr('Verificación en dos pasos (2FA)')}</h3>
        {tfaMsg && <div className="error-box">{tfaMsg}</div>}
        {enabled ? (
          <>
            <div className="banner">{tr('✓ La 2FA está activada en tu cuenta.')}</div>
            <p className="muted">{tr('Para desactivarla, introduce un código actual de tu app de autenticación:')}</p>
            <div className="row" style={{ maxWidth: 360 }}>
              <input className="input" inputMode="numeric" placeholder="123456" maxLength={6} value={disableCode} onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ''))} />
              <button className="btn danger" onClick={disable} disabled={tfaBusy || disableCode.length < 6}>{tr('Desactivar')}</button>
            </div>
          </>
        ) : setup ? (
          <>
            <p className="muted">{tr('Escanea el código con Google Authenticator, Authy, FreeOTP… (o introduce la clave manual) y confirma con un código.')}</p>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <img src={setup.qr} alt={tr('Código QR 2FA')} width={160} height={160} style={{ border: '1px solid var(--border)', borderRadius: 8 }} />
              <div>
                <div className="muted" style={{ fontSize: 12 }}>{tr('Clave manual:')}</div>
                <code style={{ fontSize: 12.5, wordBreak: 'break-all' }}>{setup.secret}</code>
              </div>
            </div>
            <div className="field" style={{ marginTop: 12, maxWidth: 220 }}><label>{tr('Código de verificación')}</label>
              <input className="input" inputMode="numeric" placeholder="123456" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
            </div>
            <div className="btn-row">
              <button className="btn primary" onClick={enable} disabled={tfaBusy || code.length < 6}>{tfaBusy ? tr('Activando…') : tr('Activar 2FA')}</button>
              <button className="btn" onClick={() => { setSetup(null); setCode(''); }}>{tr('Cancelar')}</button>
            </div>
          </>
        ) : (
          <>
            <p className="muted">{tr('Añade una capa extra de seguridad: además de la contraseña, al iniciar sesión te pedirá un código de tu móvil.')}</p>
            <button className="btn primary" onClick={startSetup}>{tr('Activar 2FA')}</button>
          </>
        )}
      </div>
    </div>
  );
}

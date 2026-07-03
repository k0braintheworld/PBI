import { useEffect, useState, useCallback, useRef } from 'react';
import { api, getActiveHost, setActiveHost } from './api.js';
import { Icon } from './components/icons.jsx';
import { ConfirmHost } from './components/common.jsx';
import Logo from './components/Logo.jsx';
import Dashboard from './components/Dashboard.jsx';
import Backups from './components/Backups.jsx';
import Restore from './components/Restore.jsx';
import Jobs from './components/Jobs.jsx';
import Tasks from './components/Tasks.jsx';
import Reports from './components/Reports.jsx';
import Cleanup from './components/Cleanup.jsx';
import Settings from './components/Settings.jsx';
import Audit from './components/Audit.jsx';
import About from './components/About.jsx';
import UpdateModal from './components/UpdateModal.jsx';
import Login from './components/Login.jsx';
import { APP_VERSION, APP_COPYRIGHT, APP_TAGLINE, cmpVersion } from './version.js';
import { useT, LangSwitch } from './i18n.jsx';

const NAV_ALL = [
  { key: 'dashboard', label: 'Información general', icon: 'dashboard' },
  { key: 'backups', label: 'Backups', icon: 'database' },
  { key: 'restore', label: 'Recuperación', icon: 'restore', minRole: 'operator' },
  { key: 'jobs', label: 'Tareas programadas', icon: 'jobs', minRole: 'operator' },
  { key: 'tasks', label: 'Monitor de tareas', icon: 'activity' },
  { key: 'reports', label: 'Informes', icon: 'report' },
  { key: 'cleanup', label: 'Limpieza', icon: 'broom', minRole: 'operator' },
  { key: 'audit', label: 'Auditoría', icon: 'audit', minRole: 'admin' },
  { key: 'settings', label: 'Configuración', icon: 'settings', minRole: 'operator' },
  { key: 'about', label: 'Acerca de', icon: 'info' },
];

// minRole: undefined=todos, 'operator'=operator+admin, 'admin'=solo admin
function navAllowed(item, role) {
  if (!item.minRole) return true;
  if (item.minRole === 'admin') return role === 'admin';
  if (item.minRole === 'operator') return role === 'admin' || role === 'operator';
  return false;
}

const TITLES = {
  dashboard: 'Resumen general',
  backups: 'Backups',
  restore: 'Recuperación',
  jobs: 'Gestión de tareas programadas',
  tasks: 'Monitor de tareas',
  reports: 'Informes',
  cleanup: 'Limpieza de copias',
  audit: 'Auditoría',
  settings: 'Configuración de hosts PBS',
  about: 'Acerca de PBI',
};

export default function App() {
  const t = useT();
  const [auth, setAuth] = useState(undefined); // undefined=cargando

  const refresh = useCallback(() => {
    api.authState().then(setAuth).catch(() => setAuth({ needsSetup: false, authenticated: false, user: null }));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const onUnauth = () => setAuth((a) => (a ? { ...a, authenticated: false, user: null } : a));
    window.addEventListener('pbp-unauthorized', onUnauth);
    return () => window.removeEventListener('pbp-unauthorized', onUnauth);
  }, []);

  async function logout() {
    await api.authLogout().catch(() => {});
    setAuth({ needsSetup: false, authenticated: false, user: null });
  }

  if (auth === undefined) {
    return <div className="spinner" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>{t('Cargando…')}</div>;
  }
  if (!auth.authenticated) {
    return <Login needsSetup={auth.needsSetup} onDone={() => refresh()} />;
  }
  return <AppShell user={auth.user} onLogout={logout} />;
}

function AppShell({ user, onLogout }) {
  const t = useT();
  const [hosts, setHosts] = useState(undefined); // undefined=cargando
  const [showUpdate, setShowUpdate] = useState(false);
  const [activeId, setActiveId] = useState(getActiveHost());
  const [view, setView] = useState('dashboard');
  const [latestVer, setLatestVer] = useState(null);

  const loadHosts = useCallback(async () => {
    try {
      const list = await api.hosts();
      setHosts(list);
      // Determinar host activo: el guardado si sigue existiendo, o el predeterminado
      const stored = getActiveHost();
      const valid = list.find((h) => h.id === stored);
      const chosen = valid ? stored : list.find((h) => h.isDefault)?.id || list[0]?.id || '';
      setActiveHost(chosen);
      setActiveId(chosen);
    } catch {
      setHosts([]);
    }
  }, []);

  useEffect(() => { loadHosts(); }, [loadHosts]);

  // --- Cierre de sesión por inactividad (configurable en Configuración › Seguridad) ---
  const [idleMin, setIdleMin] = useState(0);
  const logoutRef = useRef(onLogout);
  useEffect(() => { logoutRef.current = onLogout; });
  useEffect(() => {
    api.security().then((s) => setIdleMin(Number(s?.sessionIdleMinutes) || 0)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!idleMin) return undefined;
    const idleMs = idleMin * 60 * 1000;
    let last = Date.now();
    const bump = () => { last = Date.now(); };
    const evts = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
    evts.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const id = setInterval(() => {
      if (Date.now() - last > idleMs) {
        clearInterval(id);
        try { sessionStorage.setItem('pbi_idle_logout', '1'); } catch { /* ignore */ }
        logoutRef.current?.();
      }
    }, 15000);
    return () => { evts.forEach((e) => window.removeEventListener(e, bump)); clearInterval(id); };
  }, [idleMin]);

  // Comprobación automática de actualizaciones: consulta GitHub Releases en segundo
  // plano (cacheada 3 h en localStorage para no abusar de la API) y vuelve a mirar
  // cada 6 h mientras el panel siga abierto. Si falla (sin red / rate limit) se ignora.
  useEffect(() => {
    let stop = false;
    async function check() {
      try {
        const now = Date.now();
        const last = Number(localStorage.getItem('pbi_upd_ts') || 0);
        const cached = localStorage.getItem('pbi_upd_latest') || '';
        if (cached && now - last < 3 * 3600 * 1000) { if (!stop) setLatestVer(cached); return; }
        const r = await fetch('https://api.github.com/repos/k0braintheworld/PBI/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
        if (!r.ok) return;
        const rel = await r.json();
        const ver = (rel.tag_name || '').replace(/^v/i, '');
        if (ver) {
          localStorage.setItem('pbi_upd_ts', String(now));
          localStorage.setItem('pbi_upd_latest', ver);
          if (!stop) setLatestVer(ver);
        }
      } catch { /* sin conexión o límite de la API: ignorar */ }
    }
    check();
    const id = setInterval(check, 6 * 3600 * 1000);
    return () => { stop = true; clearInterval(id); };
  }, []);

  const updateAvailable = latestVer ? cmpVersion(latestVer, APP_VERSION) > 0 : false;

  function changeHost(id) {
    setActiveHost(id);
    setActiveId(id);
  }

  if (hosts === undefined) {
    return <div className="spinner" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>{t('Cargando…')}</div>;
  }

  const noHosts = hosts.length === 0;
  const NAV = NAV_ALL.filter((n) => navAllowed(n, user.role));
  const effectiveView = noHosts ? (user.role === 'viewer' ? 'dashboard' : 'settings') : view;

  const activeHost = hosts.find((h) => h.id === activeId);

  return (
    <div className="app">
      <ConfirmHost />
      {showUpdate && <UpdateModal onClose={() => setShowUpdate(false)} />}
      <aside className="sidebar">
        <div className="brand">
          <Logo size={38} />
          <div style={{ lineHeight: 1.05, textAlign: 'center' }}>
            <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: 3, paddingLeft: 3 }}>PBI</span>
            <small>{APP_TAGLINE}</small>
          </div>
        </div>
        <div className="nav-section">{t('Gestión')}</div>
        {NAV.map((n) => {
          const I = Icon[n.icon];
          return (
            <button
              key={n.key}
              className={`nav-item ${effectiveView === n.key ? 'active' : ''}`}
              onClick={() => setView(n.key)}
              disabled={noHosts && n.key !== 'settings'}
            >
              <I /> {t(n.label)}
            </button>
          );
        })}
        <div className="nav-spacer" />
        <div className="nav-section">{t('Servidor activo')}</div>
        <div style={{ padding: '0 8px', color: 'var(--sb-text)', fontSize: 12 }}>
          {activeHost ? (
            <>
              <div style={{ color: '#cfd8e4', fontWeight: 500 }}>{activeHost.name}</div>
              <div className="mono" style={{ fontSize: 11, opacity: .7, wordBreak: 'break-all' }}>{activeHost.host}</div>
            </>
          ) : <span style={{ opacity: .6 }}>{t('sin configurar')}</span>}
        </div>
        <div className="nav-section">{t('Sesión')}</div>
        <div style={{ padding: '0 8px 6px', fontSize: 12 }}>
          <span style={{ color: '#cfd8e4', fontWeight: 500 }}>{user.username}</span>
          <span style={{ color: 'var(--sb-text)' }}> · {user.role === 'admin' ? t('admin') : user.role === 'viewer' ? t('visor') : t('operador')}</span>
        </div>
        <button className="nav-item" onClick={() => setShowUpdate(true)}>
          <Icon.refresh /> {t('Actualizaciones')}
          {updateAvailable && <span className="upd-dot" title={`${t('Actualización disponible')}: v${latestVer}`} />}
        </button>
        <button className="nav-item" onClick={onLogout}><Icon.x /> {t('Cerrar sesión')}</button>
        <div style={{ padding: '8px 8px 0', display: 'flex', justifyContent: 'center' }}><LangSwitch /></div>
        <button onClick={() => setView('about')} style={{ background: 'none', border: 'none', color: 'var(--sb-text)', opacity: .65, fontSize: 10.5, textAlign: 'center', cursor: 'pointer', padding: '8px 4px 2px', width: '100%' }}>
          {APP_COPYRIGHT} · GPLv3 · v{APP_VERSION}
        </button>
      </aside>

      <main className="main">
        <div className="topbar">
          <div>
            <h1>{t(TITLES[effectiveView])}</h1>
            <div className="sub">
              {activeHost ? <>{t('Conectado a')} <b>{activeHost.host}</b> · {t('servidor PBS')} <b>{activeHost.node}</b></> : t('Sin host seleccionado')}
            </div>
          </div>
          {!noHosts && (
            <div className="field" style={{ margin: 0, minWidth: 230 }}>
              <label style={{ fontSize: 11 }}>{t('Host activo')}</label>
              <select value={activeId} onChange={(e) => changeHost(e.target.value)}>
                {hosts.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}{h.isDefault ? ` (${t('por defecto')})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="content">
          {noHosts && (
            <div className="banner">
              {t('👋 Bienvenido. Aún no hay ningún servidor PBS configurado. Añade tu primer host para empezar.')}
            </div>
          )}

          {/* key={activeId} fuerza recargar los datos al cambiar de host */}
          <div key={activeId}>
            {effectiveView === 'dashboard' && <Dashboard goTo={setView} user={user} />}
            {effectiveView === 'backups' && <Backups />}
            {effectiveView === 'restore' && <Restore goTo={setView} />}
            {effectiveView === 'jobs' && <Jobs />}
            {effectiveView === 'tasks' && <Tasks />}
            {effectiveView === 'reports' && <Reports />}
            {effectiveView === 'cleanup' && <Cleanup />}
            {effectiveView === 'audit' && <Audit />}
            {effectiveView === 'settings' && <Settings onHostsChanged={loadHosts} user={user} />}
            {effectiveView === 'about' && <About />}
          </div>
        </div>
      </main>
    </div>
  );
}

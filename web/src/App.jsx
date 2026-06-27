import { useEffect, useState, useCallback } from 'react';
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
import About from './components/About.jsx';
import Login from './components/Login.jsx';
import { APP_VERSION, APP_COPYRIGHT, APP_TAGLINE } from './version.js';

const NAV = [
  { key: 'dashboard', label: 'Información general', icon: 'dashboard' },
  { key: 'backups', label: 'Backups', icon: 'database' },
  { key: 'restore', label: 'Recuperación', icon: 'restore' },
  { key: 'jobs', label: 'Tareas programadas', icon: 'jobs' },
  { key: 'tasks', label: 'Monitor de tareas', icon: 'activity' },
  { key: 'reports', label: 'Informes', icon: 'report' },
  { key: 'cleanup', label: 'Limpieza', icon: 'broom' },
  { key: 'settings', label: 'Configuración', icon: 'settings' },
  { key: 'about', label: 'Acerca de', icon: 'info' },
];

const TITLES = {
  dashboard: 'Resumen general',
  backups: 'Backups',
  restore: 'Recuperación',
  jobs: 'Gestión de tareas programadas',
  tasks: 'Monitor de tareas',
  reports: 'Informes',
  cleanup: 'Limpieza de copias',
  settings: 'Configuración de hosts PBS',
  about: 'Acerca de PBI',
};

export default function App() {
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
    return <div className="spinner" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>Cargando…</div>;
  }
  if (!auth.authenticated) {
    return <Login needsSetup={auth.needsSetup} onDone={() => refresh()} />;
  }
  return <AppShell user={auth.user} onLogout={logout} />;
}

function AppShell({ user, onLogout }) {
  const [hosts, setHosts] = useState(undefined); // undefined=cargando
  const [activeId, setActiveId] = useState(getActiveHost());
  const [view, setView] = useState('dashboard');

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

  function changeHost(id) {
    setActiveHost(id);
    setActiveId(id);
  }

  if (hosts === undefined) {
    return <div className="spinner" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>Cargando…</div>;
  }

  const noHosts = hosts.length === 0;
  const effectiveView = noHosts ? 'settings' : view;

  const activeHost = hosts.find((h) => h.id === activeId);

  return (
    <div className="app">
      <ConfirmHost />
      <aside className="sidebar">
        <div className="brand">
          <Logo size={38} />
          <div style={{ lineHeight: 1.05, textAlign: 'center' }}>
            <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: 3, paddingLeft: 3 }}>PBI</span>
            <small>{APP_TAGLINE}</small>
          </div>
        </div>
        <div className="nav-section">Gestión</div>
        {NAV.map((n) => {
          const I = Icon[n.icon];
          return (
            <button
              key={n.key}
              className={`nav-item ${effectiveView === n.key ? 'active' : ''}`}
              onClick={() => setView(n.key)}
              disabled={noHosts && n.key !== 'settings'}
            >
              <I /> {n.label}
            </button>
          );
        })}
        <div className="nav-spacer" />
        <div className="nav-section">Servidor activo</div>
        <div style={{ padding: '0 8px', color: 'var(--sb-text)', fontSize: 12 }}>
          {activeHost ? (
            <>
              <div style={{ color: '#cfd8e4', fontWeight: 500 }}>{activeHost.name}</div>
              <div className="mono" style={{ fontSize: 11, opacity: .7, wordBreak: 'break-all' }}>{activeHost.host}</div>
            </>
          ) : <span style={{ opacity: .6 }}>sin configurar</span>}
        </div>
        <div className="nav-section">Sesión</div>
        <div style={{ padding: '0 8px 6px', fontSize: 12 }}>
          <span style={{ color: '#cfd8e4', fontWeight: 500 }}>{user.username}</span>
          <span style={{ color: 'var(--sb-text)' }}> · {user.role === 'admin' ? 'admin' : 'operador'}</span>
        </div>
        <button className="nav-item" onClick={onLogout}><Icon.x /> Cerrar sesión</button>
        <button onClick={() => setView('about')} style={{ background: 'none', border: 'none', color: 'var(--sb-text)', opacity: .65, fontSize: 10.5, textAlign: 'center', cursor: 'pointer', padding: '8px 4px 2px', width: '100%' }}>
          {APP_COPYRIGHT} · GPLv3 · v{APP_VERSION}
        </button>
      </aside>

      <main className="main">
        <div className="topbar">
          <div>
            <h1>{TITLES[effectiveView]}</h1>
            <div className="sub">
              {activeHost ? <>Conectado a <b>{activeHost.host}</b> · servidor PBS <b>{activeHost.node}</b></> : 'Sin host seleccionado'}
            </div>
          </div>
          {!noHosts && (
            <div className="field" style={{ margin: 0, minWidth: 230 }}>
              <label style={{ fontSize: 11 }}>Host activo</label>
              <select value={activeId} onChange={(e) => changeHost(e.target.value)}>
                {hosts.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}{h.isDefault ? ' (por defecto)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="content">
          {noHosts && (
            <div className="banner">
              👋 Bienvenido. Aún no hay ningún servidor PBS configurado. Añade tu primer host para empezar.
            </div>
          )}

          {/* key={activeId} fuerza recargar los datos al cambiar de host */}
          <div key={activeId}>
            {effectiveView === 'dashboard' && <Dashboard goTo={setView} />}
            {effectiveView === 'backups' && <Backups />}
            {effectiveView === 'restore' && <Restore goTo={setView} />}
            {effectiveView === 'jobs' && <Jobs />}
            {effectiveView === 'tasks' && <Tasks />}
            {effectiveView === 'reports' && <Reports />}
            {effectiveView === 'cleanup' && <Cleanup />}
            {effectiveView === 'settings' && <Settings onHostsChanged={loadHosts} user={user} />}
            {effectiveView === 'about' && <About />}
          </div>
        </div>
      </main>
    </div>
  );
}

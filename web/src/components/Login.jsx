import { useState } from 'react';
import { api } from '../api.js';
import Logo from './Logo.jsx';
import { APP_TAGLINE } from '../version.js';

/** Pantalla de acceso: login normal o creación del primer administrador (setup). */
export default function Login({ needsSetup, onDone }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (needsSetup && password !== password2) { setError('Las contraseñas no coinciden'); return; }
    setBusy(true);
    try {
      if (needsSetup) {
        const res = await api.authSetup({ username, password });
        onDone(res.user);
        return;
      }
      const res = await api.authLogin({ username, password, totp: needTotp ? totp : undefined });
      if (res.twofaRequired) { setNeedTotp(true); setBusy(false); return; }
      onDone(res.user);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)', padding: 20 }}>
      <div className="card" style={{ width: '100%', maxWidth: 380, padding: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 6 }}>
          <Logo size={44} />
          <div style={{ lineHeight: 1.1, textAlign: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: 21, letterSpacing: 3, paddingLeft: 3 }}>PBI</div>
            <div className="muted" style={{ fontSize: 11.5 }}>{APP_TAGLINE}</div>
          </div>
        </div>

        <h3 style={{ margin: '18px 0 4px', fontSize: 16 }}>{needsSetup ? 'Crear administrador' : 'Iniciar sesión'}</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          {needsSetup ? 'Es el primer acceso: crea la cuenta de administrador del panel.' : 'Introduce tus credenciales para acceder.'}
        </p>

        {error && <div className="error-box">{error}</div>}

        <form onSubmit={submit}>
          <div className="field">
            <label>Usuario</label>
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" required />
          </div>
          <div className="field">
            <label>Contraseña</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={needsSetup ? 'new-password' : 'current-password'} required />
          </div>
          {needsSetup && (
            <div className="field">
              <label>Repetir contraseña</label>
              <input className="input" type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" required />
            </div>
          )}
          {needTotp && (
            <div className="field">
              <label>Código de verificación (2FA)</label>
              <input className="input" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" maxLength={6}
                value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))} autoFocus required />
              <span className="muted" style={{ fontSize: 11.5 }}>Introduce el código de 6 dígitos de tu app de autenticación.</span>
            </div>
          )}
          <button className="btn primary" style={{ width: '100%', justifyContent: 'center', marginTop: 4 }} disabled={busy}>
            {busy ? 'Accediendo…' : needsSetup ? 'Crear y acceder' : needTotp ? 'Verificar' : 'Acceder'}
          </button>
        </form>
      </div>
    </div>
  );
}

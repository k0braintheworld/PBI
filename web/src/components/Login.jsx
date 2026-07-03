// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import { useState } from 'react';
import { api } from '../api.js';
import Logo from './Logo.jsx';
import { APP_TAGLINE } from '../version.js';
import { useT } from '../i18n.jsx';

/** Pantalla de acceso: login normal o creación del primer administrador (setup). */
export default function Login({ needsSetup, onDone }) {
  const t = useT();
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
    if (needsSetup && password !== password2) { setError(t('Las contraseñas no coinciden')); return; }
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 11, marginBottom: 6 }}>
          <Logo size={44} />
          <div style={{ lineHeight: 1.1, textAlign: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: 21, letterSpacing: 3, paddingLeft: 3 }}>PBI</div>
            <div className="muted" style={{ fontSize: 11.5 }}>{APP_TAGLINE}</div>
          </div>
        </div>

        <h3 style={{ margin: '18px 0 4px', fontSize: 16, textAlign: 'center' }}>{needsSetup ? t('Crear administrador') : t('Iniciar sesión')}</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 13, textAlign: 'center' }}>
          {needsSetup ? t('Es el primer acceso: crea la cuenta de administrador del panel.') : t('Introduce tus credenciales para acceder.')}
        </p>

        {!needsSetup && typeof sessionStorage !== 'undefined' && sessionStorage.getItem('pbi_idle_logout') && (() => { try { sessionStorage.removeItem('pbi_idle_logout'); } catch { /* ignore */ } return true; })() && (
          <div className="banner" style={{ marginBottom: 12 }}>{t('Sesión cerrada por inactividad.')}</div>
        )}

        {error && <div className="error-box">{error}</div>}

        <form onSubmit={submit}>
          <div className="field">
            <label>{t('Usuario')}</label>
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" required />
          </div>
          <div className="field">
            <label>{t('Contraseña')}</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={needsSetup ? 'new-password' : 'current-password'} required />
          </div>
          {needsSetup && (
            <div className="field">
              <label>{t('Repetir contraseña')}</label>
              <input className="input" type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" required />
            </div>
          )}
          {needTotp && (
            <div className="field">
              <label>{t('Código de verificación (2FA)')}</label>
              <input className="input" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" maxLength={6}
                value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))} autoFocus required />
              <span className="muted" style={{ fontSize: 11.5 }}>{t('Introduce el código de 6 dígitos de tu app de autenticación.')}</span>
            </div>
          )}
          <button className="btn primary" style={{ width: '100%', justifyContent: 'center', marginTop: 4 }} disabled={busy}>
            {busy ? t('Accediendo…') : needsSetup ? t('Crear y acceder') : needTotp ? t('Verificar') : t('Acceder')}
          </button>
        </form>
      </div>
    </div>
  );
}

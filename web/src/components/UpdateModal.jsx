// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import { useEffect, useState } from 'react';
import { APP_VERSION } from '../version.js';
import { api } from '../api.js';
import { useT } from '../i18n.jsx';
import { Icon } from './icons.jsx';

const REPO = 'k0braintheworld/PBI';

/** Compara versiones tipo "1.5.3" / "v1.5.3". Devuelve -1, 0, 1. */
function cmpVer(a, b) {
  const pa = String(a).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

const fmtMB = (n) => `${(Number(n || 0) / 1048576).toFixed(1)} MB`;

/** Barra de progreso de la auto-instalación: descarga real (%) + fases de instalación. */
function InstallProgress({ install, debSize, t }) {
  const phase = install.phase || 'download';
  const dlPct = debSize ? Math.min(90, Math.round((install.bytes / debSize) * 90)) : 45;
  const pct = phase === 'download' ? dlPct : phase === 'verify' ? 92 : phase === 'wait' ? 94 : phase === 'install' ? 97 : 20;
  const label = phase === 'download'
    ? `${t('Descargando el paquete…')} ${fmtMB(install.bytes)}${debSize ? ` / ${fmtMB(debSize)}` : ''}`
    : phase === 'verify' ? t('Verificando integridad (SHA-256)…')
      : phase === 'wait' ? t('Esperando al gestor de paquetes (ocupado)…')
        : phase === 'install' ? t('Instalando el paquete…')
          : t('Preparando…');
  return (
    <div>
      <div className="flex-between" style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 5 }}>
        <span>{label}</span>
        {phase === 'download' && <span className="mono" style={{ fontWeight: 600 }}>{dlPct}%</span>}
      </div>
      <div className="bar" style={{ height: 9 }}><span style={{ width: `${pct}%`, background: 'var(--info)', transition: 'width .4s ease' }} /></div>
      <span className="muted" style={{ fontSize: 11.5, marginTop: 8, display: 'inline-block' }}>
        {t('No cierres esta ventana. Al terminar la instalación el servicio se reiniciará y la página se recargará.')}
      </span>
    </div>
  );
}

function CopyBox({ value, multiline, t }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { try { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } };
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      {multiline
        ? <textarea className="input mono" readOnly value={value} rows={value.split('\n').length} style={{ fontSize: 12, resize: 'none' }} onFocus={(e) => e.target.select()} />
        : <input className="input mono" readOnly value={value} style={{ fontSize: 12.5 }} onFocus={(e) => e.target.select()} />}
      <button className="btn sm" type="button" onClick={copy}>{copied ? t('Copiado') : t('Copiar')}</button>
    </div>
  );
}

/** Comprueba la última release de GitHub; permite descargar, instalar (1 click) o ver la guía manual. */
export default function UpdateModal({ onClose }) {
  const t = useT();
  const [state, setState] = useState({ loading: true });
  const [cap, setCap] = useState({});
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [install, setInstall] = useState(null);
  const [guide, setGuide] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.updateCapability().then((c) => { if (!cancelled) setCap(c || {}); }).catch(() => {});
    fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
      .then((r) => { if (!r.ok) throw new Error(`GitHub HTTP ${r.status}`); return r.json(); })
      .then((rel) => {
        if (cancelled) return;
        const deb = (rel.assets || []).find((a) => /\.deb$/i.test(a.name));
        const sha = (String(rel.body || '').match(/\b[a-f0-9]{64}\b/i) || [])[0] || '';
        setState({
          loading: false, latest: (rel.tag_name || '').replace(/^v/i, ''),
          notes: rel.body || '', url: rel.html_url,
          debUrl: deb?.browser_download_url, debName: deb?.name, sha256: sha, debSize: deb?.size || 0,
        });
      })
      .catch((e) => { if (!cancelled) setState({ loading: false, error: e.message }); });
    return () => { cancelled = true; };
  }, []);

  const cmp = state.latest ? cmpVer(state.latest, APP_VERSION) : 0;
  const canInstall = cmp > 0 && cap.selfUpdate && !!state.debUrl && !!state.sha256;
  const needsTool = cmp > 0 && cap.updater && !cap.downloader; // instalado por .deb pero falta curl/wget

  const guideCmds = [
    state.debUrl ? `wget ${state.debUrl}` : `# descarga el .deb de ${state.url || 'la release'}`,
    state.debName ? `sha256sum ${state.debName}` : 'sha256sum pbi_*.deb',
    state.sha256 ? `# esperado: ${state.sha256}` : null,
    `dpkg -i ${state.debName || 'pbi_*.deb'}`,
  ].filter(Boolean).join('\n');

  async function doInstall() {
    setInstall({ busy: true, phase: 'apply' });
    try {
      await api.updateApply({ password: pw, url: state.debUrl, sha256: state.sha256 });
      setPw('');
      pollStatus(); // seguimiento real del instalador (en vez de recargar a ciegas)
    } catch (e) {
      setInstall({ error: e.message });
    }
  }

  // Sondea /update/status hasta ver un resultado. En éxito el servicio se reinicia
  // (las peticiones empiezan a fallar) → recargamos. Si el instalador reporta error
  // (p. ej. gestor de paquetes ocupado), lo mostramos para que el usuario reintente.
  function pollStatus() {
    const started = Date.now();
    let netFails = 0;
    const reload = () => setTimeout(() => { try { window.location.reload(); } catch { /* ignore */ } }, 4000);
    const tick = async () => {
      if (Date.now() - started > 7 * 60 * 1000) { setInstall({ timeout: true }); return; }
      try {
        const s = await api.updateStatus();
        netFails = 0;
        if (s.state === 'ok') { setInstall({ ok: true }); reload(); return; }
        if (s.state === 'error') { setInstall({ error: s.phase || t('La instalación falló.') }); return; }
        setInstall({ busy: true, phase: s.phase || 'download', bytes: s.bytes || 0 });
        setTimeout(tick, s.phase === 'download' ? 1000 : 3000);
      } catch {
        // Sin respuesta: lo normal es que el servicio se esté reiniciando (éxito).
        netFails += 1;
        if (netFails >= 4) { setInstall({ ok: true }); reload(); return; }
        setTimeout(tick, 4000);
      }
    };
    setTimeout(tick, 3000);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 580 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>{t('Actualizaciones')}</h3>
        <p className="muted" style={{ marginTop: -4 }}>{t('Versión instalada')}: <b>v{APP_VERSION}</b></p>

        {state.loading ? (
          <div className="spinner">{t('Comprobando…')}</div>
        ) : state.error ? (
          <div className="error-box">{t('No se pudo comprobar (¿sin acceso a GitHub?).')} <span className="muted">{state.error}</span></div>
        ) : cmp <= 0 ? (
          <div className="banner">{cmp < 0 ? <>{t('Tu versión es más reciente que la última publicada')} (v{state.latest}).</> : <>{t('Estás en la última versión.')} (v{state.latest})</>}</div>
        ) : (
          <>
            <div className="banner" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon.bolt width={15} height={15} /> {t('Actualización disponible')}: <b>v{state.latest}</b>
            </div>
            {state.notes && (
              <div style={{ maxHeight: 150, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', margin: '4px 0 12px', fontSize: 12.5, whiteSpace: 'pre-wrap', color: 'var(--text-2)' }}>
                {state.notes.slice(0, 1000)}{state.notes.length > 1000 ? '…' : ''}
              </div>
            )}

            {install?.ok ? (
              <div className="banner">✓ {t('Actualización instalada. La página se recargará automáticamente.')}</div>
            ) : install?.timeout ? (
              <div style={{ background: 'var(--warn-soft)', border: '1px solid #f0d9a8', color: '#a06806', padding: '9px 12px', borderRadius: 8, fontSize: 12.5 }}>
                {t('Está tardando más de lo normal (el gestor de paquetes puede estar ocupado). Comprueba la versión en unos minutos; si no cambió, vuelve a intentarlo.')}
              </div>
            ) : (
              <>
                <div className="btn-row" style={{ marginBottom: 10 }}>
                  {canInstall && !pwOpen && <button className="btn primary" onClick={() => { setPwOpen(true); setInstall(null); }}><Icon.bolt width={14} height={14} /> {t('Instalar ahora')}</button>}
                  {state.debUrl && <a className="btn" href={state.debUrl}><Icon.download width={14} height={14} /> {t('Descargar .deb')}</a>}
                  <a className="btn ghost" href={state.url} target="_blank" rel="noreferrer">{t('Ver release')}</a>
                </div>

                {pwOpen && (
                  <div className="card card-pad" style={{ margin: '4px 0 12px' }}>
                    {install?.busy ? (
                      <InstallProgress install={install} debSize={state.debSize} t={t} />
                    ) : (
                      <>
                        <label style={{ fontSize: 13 }}>{t('Confirma con tu contraseña de PBI para instalar:')}</label>
                        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                          <input className="input" type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} placeholder={t('Contraseña')}
                            onKeyDown={(e) => { if (e.key === 'Enter' && pw) doInstall(); }} />
                          <button className="btn primary" disabled={!pw} onClick={doInstall}>{t('Instalar')}</button>
                          <button className="btn" onClick={() => { setPwOpen(false); setPw(''); setInstall(null); }}>{t('Cancelar')}</button>
                        </div>
                        {install?.error && <div className="error-box" style={{ marginTop: 8 }}>{install.error} <span className="muted">{t('Puedes volver a intentarlo.')}</span></div>}
                      </>
                    )}
                  </div>
                )}

                {needsTool && (
                  <div style={{ background: 'var(--warn-soft)', border: '1px solid #f0d9a8', color: '#a06806', padding: '9px 12px', borderRadius: 8, fontSize: 12.5, marginBottom: 10 }}>
                    {t('Para instalar desde el panel necesitas «curl» (o «wget») en el servidor. Instálalo (o usa la guía manual de abajo):')}
                    <div style={{ marginTop: 6 }}><CopyBox value="apt install -y curl" t={t} /></div>
                  </div>
                )}

                <button className="btn sm ghost" type="button" onClick={() => setGuide((g) => !g)}>
                  {guide ? t('Ocultar guía manual (SSH)') : t('Ver guía de actualización manual (SSH)')}
                </button>
                {guide && (
                  <div className="card card-pad" style={{ marginTop: 8 }}>
                    <p className="muted" style={{ marginTop: 0, fontSize: 12.5 }}>{t('Conéctate por SSH al servidor PBI (como root) y ejecuta:')}</p>
                    <CopyBox value={guideCmds} multiline t={t} />
                    <span className="muted" style={{ fontSize: 11.5 }}>{t('Verifica que el SHA-256 coincide antes de instalar. Se instala encima sin perder configuración ni datos.')}</span>
                  </div>
                )}
              </>
            )}
          </>
        )}

        <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="btn" onClick={onClose}>{t('Cerrar')}</button>
        </div>
      </div>
    </div>
  );
}

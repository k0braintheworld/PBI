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

/** Comprueba la última release de GitHub; permite descargar o instalar (1 click). */
export default function UpdateModal({ onClose }) {
  const t = useT();
  const [state, setState] = useState({ loading: true });
  const [capable, setCapable] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [install, setInstall] = useState(null); // {busy} | {ok,msg} | {error}

  useEffect(() => {
    let cancelled = false;
    api.updateCapability().then((c) => { if (!cancelled) setCapable(!!c.selfUpdate); }).catch(() => {});
    fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
      .then((r) => { if (!r.ok) throw new Error(`GitHub HTTP ${r.status}`); return r.json(); })
      .then((rel) => {
        if (cancelled) return;
        const deb = (rel.assets || []).find((a) => /\.deb$/i.test(a.name));
        const sha = (String(rel.body || '').match(/\b[a-f0-9]{64}\b/i) || [])[0] || '';
        setState({
          loading: false, latest: (rel.tag_name || '').replace(/^v/i, ''),
          notes: rel.body || '', url: rel.html_url,
          debUrl: deb?.browser_download_url, debName: deb?.name, sha256: sha,
        });
      })
      .catch((e) => { if (!cancelled) setState({ loading: false, error: e.message }); });
    return () => { cancelled = true; };
  }, []);

  const cmp = state.latest ? cmpVer(state.latest, APP_VERSION) : 0;
  const cmd = state.debName ? `sudo dpkg -i ${state.debName}` : '';
  const canInstall = cmp > 0 && capable && !!state.debUrl && !!state.sha256;
  const copy = () => { try { navigator.clipboard.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } };

  async function doInstall() {
    setInstall({ busy: true });
    try {
      const r = await api.updateApply({ password: pw, url: state.debUrl, sha256: state.sha256 });
      setInstall({ ok: true, msg: r.message });
      setPw('');
      setTimeout(() => { try { window.location.reload(); } catch { /* ignore */ } }, 25000);
    } catch (e) {
      setInstall({ error: e.message });
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>{t('Actualizaciones')}</h3>
        <p className="muted" style={{ marginTop: -4 }}>{t('Versión instalada')}: <b>v{APP_VERSION}</b></p>

        {state.loading ? (
          <div className="spinner">{t('Comprobando…')}</div>
        ) : state.error ? (
          <div className="error-box">{t('No se pudo comprobar (¿sin acceso a GitHub?).')} <span className="muted">{state.error}</span></div>
        ) : cmp > 0 ? (
          <>
            <div className="banner" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon.bolt width={15} height={15} /> {t('Actualización disponible')}: <b>v{state.latest}</b>
            </div>
            {state.notes && (
              <div style={{ maxHeight: 170, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', margin: '4px 0 12px', fontSize: 12.5, whiteSpace: 'pre-wrap', color: 'var(--text-2)' }}>
                {state.notes.slice(0, 1200)}{state.notes.length > 1200 ? '…' : ''}
              </div>
            )}

            {install?.ok ? (
              <div className="banner">✓ {install.msg} {t('La página se recargará automáticamente.')}</div>
            ) : (
              <>
                <div className="btn-row" style={{ marginBottom: 10 }}>
                  {canInstall && !pwOpen && <button className="btn primary" onClick={() => { setPwOpen(true); setInstall(null); }}><Icon.bolt width={14} height={14} /> {t('Instalar ahora')}</button>}
                  {state.debUrl && <a className="btn" href={state.debUrl}><Icon.download width={14} height={14} /> {t('Descargar .deb')}</a>}
                  <a className="btn ghost" href={state.url} target="_blank" rel="noreferrer">{t('Ver release')}</a>
                </div>

                {pwOpen && (
                  <div className="card card-pad" style={{ margin: '4px 0 12px' }}>
                    <label style={{ fontSize: 13 }}>{t('Confirma con tu contraseña de PBI para instalar:')}</label>
                    <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                      <input className="input" type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} placeholder={t('Contraseña')}
                        onKeyDown={(e) => { if (e.key === 'Enter' && pw && !install?.busy) doInstall(); }} />
                      <button className="btn primary" disabled={!pw || install?.busy} onClick={doInstall}>{install?.busy ? t('Instalando…') : t('Instalar')}</button>
                      <button className="btn" disabled={install?.busy} onClick={() => { setPwOpen(false); setPw(''); setInstall(null); }}>{t('Cancelar')}</button>
                    </div>
                    {install?.error && <div className="error-box" style={{ marginTop: 8 }}>{install.error}</div>}
                    {install?.busy && <span className="muted" style={{ fontSize: 11.5 }}>{t('Descargando, verificando e instalando… el servicio se reiniciará.')}</span>}
                  </div>
                )}

                {cmd && (
                  <div className="field">
                    <label>{canInstall ? t('O instálalo a mano en el servidor:') : t('Instala en el servidor PBI (requiere root):')}</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input className="input mono" readOnly value={cmd} style={{ fontSize: 12.5 }} onFocus={(e) => e.target.select()} />
                      <button className="btn sm" type="button" onClick={copy}>{copied ? t('Copiado') : t('Copiar')}</button>
                    </div>
                    <span className="muted" style={{ fontSize: 11.5 }}>{t('Se instala encima sin perder la configuración ni los datos.')}</span>
                  </div>
                )}
              </>
            )}
          </>
        ) : cmp < 0 ? (
          <div className="banner">{t('Tu versión es más reciente que la última publicada')} (v{state.latest}).</div>
        ) : (
          <div className="banner">{t('Estás en la última versión.')} (v{state.latest})</div>
        )}

        <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="btn" onClick={onClose}>{t('Cerrar')}</button>
        </div>
      </div>
    </div>
  );
}

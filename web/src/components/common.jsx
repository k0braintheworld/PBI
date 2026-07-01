import { useEffect, useState, useCallback } from 'react';
import { useT } from '../i18n.jsx';

/* ---- Diálogo de confirmación propio (sustituye a window.confirm, que algunos
   entornos bloquean silenciosamente) ---- */
let _showConfirm = null;

/** Devuelve una promesa que resuelve true/false. Acepta string u objeto. */
export function confirmDialog(opts) {
  const o = typeof opts === 'string' ? { message: opts } : (opts || {});
  return new Promise((resolve) => {
    if (!_showConfirm) { resolve(window.confirm(o.message || '¿Confirmar?')); return; }
    _showConfirm({ ...o, resolve });
  });
}

/** Montar una sola vez en la raíz de la app. */
export function ConfirmHost() {
  const t = useT();
  const [state, setState] = useState(null);
  useEffect(() => { _showConfirm = setState; return () => { _showConfirm = null; }; }, []);
  if (!state) return null;
  const close = (val) => { state.resolve(val); setState(null); };
  return (
    <div className="modal-overlay" onClick={() => close(false)}>
      <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>{state.title || t('Confirmar')}</h3>
        <p className="muted" style={{ marginTop: 0 }}>{state.message}</p>
        <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => close(false)}>{t('Cancelar')}</button>
          <button
            className="btn"
            style={state.danger ? { background: 'var(--err)', borderColor: 'var(--err)', color: '#fff' } : { background: 'var(--brand)', borderColor: 'var(--brand)', color: '#fff' }}
            onClick={() => close(true)}
          >{state.confirmLabel || t('Aceptar')}</button>
        </div>
      </div>
    </div>
  );
}

/** Extrae el % de progreso de las líneas de log de una tarea (heurístico).
   Cubre patrones de backup/verify/GC/restauración de PBS y PVE. */
export function parseProgress(lines) {
  if (!lines || !lines.length) return null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const s = lines[i]?.t || '';
    const m = /percentage done:\s*([\d.]+)\s*%/i.exec(s)
      || /progress[:\s]+([\d.]+)\s*%/i.exec(s)
      || /([\d.]{1,5})%\s*\(/.exec(s)
      || /^\s*(?:INFO:\s*)?([\d.]{1,5})\s*%/.exec(s);
    if (m) {
      const p = parseFloat(m[1]);
      if (p >= 0 && p <= 100) return Math.round(p);
    }
  }
  return null;
}

/** Hook simple para cargar datos asíncronos con estados loading/error/reload. */
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ loading: true, error: null, data: null });

  const run = useCallback(async () => {
    // Solo mostramos el spinner en la carga inicial (sin datos). En los refrescos
    // (auto-refresco) mantenemos los datos en pantalla y solo los intercambiamos
    // cuando llegan los nuevos → sin parpadeo del panel.
    setState((s) => ({ ...s, loading: s.data == null }));
    try {
      const data = await fn();
      setState({ loading: false, error: null, data });
    } catch (err) {
      // Fallo en un refresco con datos previos: conservarlos (blip transitorio de
      // red) sin vaciar el panel. En la carga inicial sí se muestra el error.
      setState((s) => (s.data == null
        ? { loading: false, error: err.message || 'Error', data: null }
        : { ...s, loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    run();
  }, [run]);

  return { ...state, reload: run };
}

export function Loading({ label }) {
  const t = useT();
  return <div className="spinner">{label || t('Cargando…')}</div>;
}

export function ErrorBox({ error }) {
  if (!error) return null;
  return <div className="error-box">⚠ {error}</div>;
}

/** Badge de estado de verificación de un snapshot. */
export function VerifyBadge({ state }) {
  const t = useT();
  if (state === 'ok') return <span className="badge ok">{t('verificado')}</span>;
  if (state === 'failed') return <span className="badge err">{t('fallido')}</span>;
  return <span className="badge muted">{t('sin verificar')}</span>;
}

const TASK_LABELS = {
  backup: 'Copia', verify: 'Verificación', prune: 'Prune',
  garbage_collection: 'Garbage collection', sync: 'Sincronización',
  reader: 'Lectura/restauración', aptupdate: 'Actualización APT',
  logrotate: 'Rotación de logs',
};
export const taskTypeLabel = (type) => TASK_LABELS[type] || type;

/** Badge de estado de una tarea. */
export function TaskBadge({ task }) {
  const t = useT();
  if (task.endtime == null) return <span className="badge run">{t('en ejecución')}</span>;
  if (task.status === 'OK') return <span className="badge ok">OK</span>;
  if (/^WARNINGS/i.test(task.status || '')) return <span className="badge warn" title={task.status}>{t('avisos')}</span>;
  return <span className="badge err" title={task.status}>{t('error')}</span>;
}

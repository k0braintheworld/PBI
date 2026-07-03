// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';
import { Loading, ErrorBox } from './common.jsx';
import { useT } from '../i18n.jsx';

const PAGE_SIZE = 100;

const RESULT_COLORS = { ok: 'var(--green)', fail: 'var(--red)', error: 'var(--red)' };

// Etiquetas legibles de las acciones (se traducen con t()). Si un código no está
// en el mapa, se muestra tal cual.
const ACTION_LABELS = {
  'auth.login': 'Inicio de sesión',
  'auth.logout': 'Cierre de sesión',
  'auth.setup': 'Alta de administrador',
  'user.create': 'Crear usuario',
  'user.update': 'Editar usuario',
  'user.delete': 'Borrar usuario',
  'account.password': 'Cambio de contraseña',
  'account.2fa_enable': 'Activar 2FA',
  'account.2fa_disable': 'Desactivar 2FA',
  'host.create': 'Crear host PBS',
  'host.update': 'Editar host PBS',
  'host.delete': 'Borrar host PBS',
  'pve.create': 'Crear conexión PVE',
  'pve.update': 'Editar conexión PVE',
  'pve.delete': 'Borrar conexión PVE',
  'backupjob.create': 'Crear trabajo de copia',
  'backupjob.update': 'Editar trabajo de copia',
  'backupjob.delete': 'Borrar trabajo de copia',
  'backupjob.run': 'Lanzar trabajo de copia',
  restore: 'Restauración',
  'job.create': 'Crear job PBS',
  'job.update': 'Editar job PBS',
  'job.delete': 'Borrar job PBS',
  'job.run': 'Lanzar job PBS',
  'cleanup.delete_group': 'Borrar grupo de copias',
  'cleanup.delete_snapshot': 'Borrar snapshot',
  'cleanup.gc': 'Garbage Collection',
  'notify.update': 'Config. notificaciones',
  'notify.silence_proxmox': 'Silenciar avisos de Proxmox',
  'report.update': 'Config. informes',
  'report.send': 'Enviar informe',
  'security.update': 'Config. de seguridad',
  'config.export': 'Exportar configuración',
  'config.import': 'Restaurar configuración',
  'central.update': 'Config. PBI Central',
  'central.test': 'Prueba de envío a Central',
  'central.unlock': 'Desbloquear PBI Central',
  'central.lock': 'Bloquear PBI Central',
  'central.enroll': 'Importar paquete de sede',
  'excluded_vm.add': 'Marcar VM sin copia',
  'excluded_vm.remove': 'Reactivar vigilancia de VM',
};
const actionLabel = (code) => ACTION_LABELS[code] || code;

function fmtTs(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
}

function ResultBadge({ result }) {
  const color = RESULT_COLORS[result] || 'var(--muted)';
  return (
    <span style={{ color, fontWeight: 600, fontSize: 12 }}>{result}</span>
  );
}

export default function Audit() {
  const t = useT();
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showCfg, setShowCfg] = useState(false);

  // Filtros
  const [filterUser, setFilterUser] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  // Opciones de filtro (usuarios y acciones únicos del log)
  const [users, setUsers] = useState([]);
  const [actions, setActions] = useState([]);

  // Configuración de rotación
  const [cfg, setCfg] = useState({ maxSizeMb: 10, maxFiles: 5 });
  const [cfgSaving, setCfgSaving] = useState(false);
  const [cfgMsg, setCfgMsg] = useState('');

  const load = useCallback(async (p = page) => {
    setLoading(true);
    setError(null);
    try {
      const params = { page: p, limit: PAGE_SIZE };
      if (filterUser) params.user = filterUser;
      if (filterAction) params.action = filterAction;
      if (filterFrom) params.from = new Date(filterFrom).toISOString();
      if (filterTo) {
        const d = new Date(filterTo);
        d.setHours(23, 59, 59, 999);
        params.to = d.toISOString();
      }
      const r = await api.auditList(params);
      setEntries(r.entries || []);
      setTotal(r.total || 0);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [page, filterUser, filterAction, filterFrom, filterTo]);

  // Cargar opciones de filtro (sin filtros, primera página grande)
  useEffect(() => {
    api.auditList({ limit: 500, page: 1 }).then((r) => {
      const us = [...new Set((r.entries || []).map((e) => e.user))].sort();
      const as = [...new Set((r.entries || []).map((e) => e.action))].sort();
      setUsers(us);
      setActions(as);
    }).catch(() => {});
  }, []);

  useEffect(() => { load(page); }, [page]); // eslint-disable-line

  useEffect(() => {
    api.auditConfig().then(setCfg).catch(() => {});
  }, []);

  function applyFilters() { setPage(1); load(1); }

  function clearFilters() {
    setFilterUser(''); setFilterAction(''); setFilterFrom(''); setFilterTo('');
    setPage(1);
    setTimeout(() => load(1), 0);
  }

  async function saveCfg() {
    setCfgSaving(true); setCfgMsg('');
    try {
      await api.auditConfigSave(cfg);
      setCfgMsg(t('Guardado'));
    } catch (e) {
      setCfgMsg(e.message);
    } finally {
      setCfgSaving(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="rise">

      {/* Configuración de rotación */}
      <div className="seg" style={{ marginBottom: 16 }}>
        <div className="flex-between" style={{ cursor: 'pointer' }} onClick={() => setShowCfg((v) => !v)}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{t('Rotación de logs')}</span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{showCfg ? '▲' : '▼'}</span>
        </div>
        {showCfg && (
          <div style={{ marginTop: 12, display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="field" style={{ margin: 0 }}>
              <label>{t('Tamaño máximo por fichero (MB)')}</label>
              <input className="input" type="number" min="1" max="1000" style={{ width: 90 }}
                value={cfg.maxSizeMb}
                onChange={(e) => setCfg((c) => ({ ...c, maxSizeMb: Number(e.target.value) }))} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>{t('Ficheros de rotación a conservar')}</label>
              <input className="input" type="number" min="1" max="20" style={{ width: 70 }}
                value={cfg.maxFiles}
                onChange={(e) => setCfg((c) => ({ ...c, maxFiles: Number(e.target.value) }))} />
            </div>
            <button className="btn primary" onClick={saveCfg} disabled={cfgSaving}>{cfgSaving ? t('Guardando…') : t('Guardar')}</button>
            {cfgMsg && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{cfgMsg}</span>}
          </div>
        )}
      </div>

      {/* Filtros */}
      <div className="seg" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
        <div className="field" style={{ margin: 0, minWidth: 130 }}>
          <label>{t('Usuario')}</label>
          <select className="input" value={filterUser} onChange={(e) => setFilterUser(e.target.value)}>
            <option value="">{t('Todos')}</option>
            {users.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div className="field" style={{ margin: 0, minWidth: 160 }}>
          <label>{t('Acción')}</label>
          <select className="input" value={filterAction} onChange={(e) => setFilterAction(e.target.value)}>
            <option value="">{t('Todas')}</option>
            {actions.map((a) => <option key={a} value={a}>{t(actionLabel(a))}</option>)}
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>{t('Desde')}</label>
          <input className="input" type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} style={{ width: 140 }} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>{t('Hasta')}</label>
          <input className="input" type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} style={{ width: 140 }} />
        </div>
        <button className="btn primary" onClick={applyFilters}>{t('Filtrar')}</button>
        <button className="btn" onClick={clearFilters}>{t('Limpiar')}</button>
      </div>

      {/* Tabla */}
      <div className="seg" style={{ padding: 0 }}>
        {loading ? <div style={{ padding: 32 }}><Loading /></div>
          : error ? <div style={{ padding: 16 }}><ErrorBox error={error} /></div>
          : entries.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
              {t('No hay registros de auditoría.')}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ width: '100%', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: 150 }}>{t('Fecha / Hora')}</th>
                    <th>{t('Usuario')}</th>
                    <th>{t('Rol')}</th>
                    <th>{t('Acción')}</th>
                    <th style={{ minWidth: 140 }}>{t('Recurso')}</th>
                    <th>{t('IP')}</th>
                    <th>{t('Resultado')}</th>
                    <th style={{ minWidth: 180 }}>{t('Detalle')}</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e, i) => (
                    <tr key={i}>
                      <td className="mono" style={{ whiteSpace: 'nowrap' }}>{fmtTs(e.ts)}</td>
                      <td style={{ fontWeight: 600 }}>{e.user}</td>
                      <td><RoleBadge role={e.role} /></td>
                      <td title={e.action}>{t(actionLabel(e.action))}</td>
                      <td className="mono" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.resource}>{e.resource || '—'}</td>
                      <td className="mono" style={{ opacity: .7 }}>{e.ip || '—'}</td>
                      <td><ResultBadge result={e.result} /></td>
                      <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: .8 }} title={e.detail}>{e.detail || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>

      {/* Paginación */}
      {!loading && total > PAGE_SIZE && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: 12, fontSize: 13 }}>
          <button className="btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>‹ {t('Anterior')}</button>
          <span style={{ color: 'var(--muted)' }}>{t('Página')} {page} {t('de')} {totalPages} · {total} {t('registros')}</span>
          <button className="btn" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>{t('Siguiente')} ›</button>
        </div>
      )}
      {!loading && total <= PAGE_SIZE && total > 0 && (
        <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
          {total} {t('registros')}
        </div>
      )}
    </div>
  );
}

function RoleBadge({ role }) {
  const colors = { admin: '#c084fc', operator: '#60a5fa', viewer: '#6ee7b7' };
  return (
    <span style={{ color: colors[role] || 'var(--muted)', fontWeight: 600, fontSize: 11 }}>{role}</span>
  );
}

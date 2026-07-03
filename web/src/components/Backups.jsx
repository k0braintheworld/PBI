import { useState } from 'react';
import { api, fmtBytes, fmtDate, fmtAgo } from '../api.js';
import { useAsync, Loading, ErrorBox, VerifyBadge } from './common.jsx';
import { useGuestNames } from '../guestNames.js';
import { Icon } from './icons.jsx';
import { useT } from '../i18n.jsx';

const snapCryptMode = (snap) => {
  const files = snap.files || [];
  if (files.some(f => f['crypt-mode'] === 'encrypt')) return 'encrypt';
  if (files.some(f => f['crypt-mode'] === 'sign-only')) return 'sign-only';
  return 'none';
};

/** Explorador de backups: selecciona datastore y lista sus snapshots. */
export default function Backups() {
  const t = useT();
  const ds = useAsync(() => api.datastores(), []);
  const names = useGuestNames();
  const [store, setStore] = useState(null);
  const [filter, setFilter] = useState('');

  const active = store || ds.data?.[0]?.store;
  const snaps = useAsync(() => (active ? api.snapshots(active) : Promise.resolve([])), [active]);

  if (ds.loading) return <Loading />;
  if (ds.error) return <ErrorBox error={ds.error} />;
  if (!ds.data.length) return <div className="card card-pad muted">{t('No hay datastores en este servidor.')}</div>;

  const all = snaps.data || [];
  const rows = all.filter((s) => {
    if (!filter) return true;
    const hay = `${s['backup-type']}/${s['backup-id']} ${names[String(s['backup-id'])] || ''} ${s.comment || ''} ${s.owner || ''}`.toLowerCase();
    return hay.includes(filter.toLowerCase());
  });

  const totalSize = all.reduce((a, s) => a + (s.size || 0), 0);
  const groups = new Set(all.map((s) => `${s['backup-type']}/${s['backup-id']}`)).size;
  const failed = all.filter((s) => s.verification?.state === 'failed').length;
  const encryptedCount = all.filter((s) => snapCryptMode(s) === 'encrypt').length;

  return (
    <div className="rise">
      <div className="flex-between pagehead" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="seg">
          {ds.data.map((d) => (
            <button key={d.store} className={active === d.store ? 'active' : ''} onClick={() => setStore(d.store)}>{d.store}</button>
          ))}
        </div>
        <a className="btn sm" href={api.csvUrl('snapshots', active)}><Icon.download width={14} height={14} /> {t('Exportar CSV')}</a>
      </div>

      <div className="grid cols-5" style={{ marginBottom: 16 }}>
        <MiniStat label="Snapshots" value={all.length} />
        <MiniStat label={t('Grupos')} value={groups} />
        <MiniStat label={t('Tamaño total')} value={fmtBytes(totalSize)} />
        <MiniStat label={t('Cifradas')} value={encryptedCount} tone={encryptedCount ? 'ok' : null} />
        <MiniStat label={t('Verif. con fallo')} value={failed} tone={failed ? 'err' : 'ok'} />
      </div>

      <div className="card">
        <div className="panel-head">
          <h3>Snapshots · {active}</h3>
          <input
            className="input"
            style={{ maxWidth: 280 }}
            placeholder={t('Filtrar por id, propietario, comentario…')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        {snaps.loading ? (
          <Loading />
        ) : snaps.error ? (
          <div className="card-pad"><ErrorBox error={snaps.error} /></div>
        ) : (
          <GroupedSnapshots rows={rows} all={all} names={names} t={t} />
        )}
      </div>
    </div>
  );
}

/** Tabla agrupada por máquina (grupo type/id) con filas colapsables. */
function GroupedSnapshots({ rows, all, names, t }) {
  const [open, setOpen] = useState(() => new Set());
  const toggle = (k) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  // Agrupar los snapshots (ya filtrados) por type/id, ordenados por última copia
  const byGroup = new Map();
  for (const s of rows) {
    const k = `${s['backup-type']}/${s['backup-id']}`;
    if (!byGroup.has(k)) byGroup.set(k, []);
    byGroup.get(k).push(s);
  }
  const groups = [...byGroup.entries()].map(([k, snaps]) => {
    const sorted = [...snaps].sort((a, b) => (b['backup-time'] || 0) - (a['backup-time'] || 0));
    return {
      key: k,
      type: sorted[0]['backup-type'],
      id: String(sorted[0]['backup-id']),
      snaps: sorted,
      last: sorted[0]['backup-time'],
      size: sorted.reduce((a, s) => a + (s.size || 0), 0),
      encrypted: sorted.filter((s) => snapCryptMode(s) === 'encrypt').length,
      failed: sorted.filter((s) => s.verification?.state === 'failed').length,
      verified: sorted.filter((s) => s.verification?.state === 'ok').length,
    };
  }).sort((a, b) => (b.last || 0) - (a.last || 0));

  return (
    <table>
      <thead>
        <tr>
          <th style={{ width: 1 }}></th><th>{t('Tipo')}</th><th>ID</th><th className="num">{t('Puntos')}</th>
          <th>{t('Última copia')}</th><th className="num">{t('Tamaño')}</th>
          <th>{t('Cifrado')}</th><th>{t('Verificación')}</th><th>{t('Comentario')}</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => {
          const isOpen = open.has(g.key);
          return [
            <tr key={g.key} onClick={() => toggle(g.key)} style={{ cursor: 'pointer' }} title={isOpen ? t('Contraer') : t('Expandir')}>
              <td style={{ color: 'var(--text-3)' }}>
                <Icon.chevronRight width={13} height={13} style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }} />
              </td>
              <td><span className="badge muted plain">{g.type}</span></td>
              <td>
                <strong>{g.id}</strong>
                {g.type !== 'host' && names[g.id] && <span className="muted"> · {names[g.id]}</span>}
              </td>
              <td className="num"><span className="badge info plain">{g.snaps.length}</span></td>
              <td title={fmtDate(g.last)}>{fmtAgo(g.last)}</td>
              <td className="num">{fmtBytes(g.size)}</td>
              <td>
                {g.encrypted === g.snaps.length ? <CryptBadge mode="encrypt" t={t} />
                  : g.encrypted > 0 ? <span className="badge warn plain">{g.encrypted}/{g.snaps.length} 🔒</span>
                  : <span className="muted">—</span>}
              </td>
              <td>
                {g.failed > 0 ? <VerifyBadge state="failed" />
                  : g.verified === g.snaps.length ? <VerifyBadge state="ok" />
                  : g.verified > 0 ? <span className="muted" style={{ fontSize: 12 }}>{g.verified}/{g.snaps.length}</span>
                  : <VerifyBadge state={null} />}
              </td>
              <td className="muted" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.snaps[0].comment || '—'}</td>
            </tr>,
            ...(isOpen ? g.snaps.map((s, i) => (
              <tr key={`${g.key}#${i}`} style={{ background: 'var(--surface-2, #fafbfd)' }}>
                <td></td>
                <td></td>
                <td style={{ paddingLeft: 26 }} title={fmtDate(s['backup-time'])}>
                  <span className="mono" style={{ fontSize: 12 }}>{fmtDate(s['backup-time'])}</span>
                  <span className="muted" style={{ fontSize: 11.5 }}> · {s.owner}</span>
                </td>
                <td></td>
                <td className="muted" style={{ fontSize: 12 }}>{fmtAgo(s['backup-time'])}</td>
                <td className="num">{fmtBytes(s.size)}</td>
                <td><CryptBadge mode={snapCryptMode(s)} t={t} /></td>
                <td><VerifyBadge state={s.verification?.state} /></td>
                <td className="muted">{s.comment || '—'}</td>
              </tr>
            )) : []),
          ];
        })}
        {!groups.length && (
          <tr><td colSpan={9} className="muted" style={{ textAlign: 'center', padding: 28 }}>
            {all.length ? t('Ningún snapshot coincide con el filtro') : t('Sin snapshots en este datastore')}
          </td></tr>
        )}
      </tbody>
    </table>
  );
}

function CryptBadge({ mode, t }) {
  if (mode === 'encrypt') return (
    <span className="badge ok plain" title={t('Cifrada')} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <Icon.lock width={11} height={11} /> {t('Cifrada')}
    </span>
  );
  if (mode === 'sign-only') return (
    <span className="badge warn plain" title={t('Solo firmada')} style={{ fontSize: 11 }}>{t('Firmada')}</span>
  );
  return <span className="muted">—</span>;
}

function MiniStat({ label, value, tone }) {
  const color = tone === 'err' ? 'var(--err)' : tone === 'ok' ? 'var(--ok)' : 'var(--text)';
  return (
    <div className="card card-pad stat">
      <div className="label">{label}</div>
      <div className="value sm" style={{ color }}>{value}</div>
    </div>
  );
}

import { useState } from 'react';
import { api, fmtBytes, fmtDate, fmtAgo } from '../api.js';
import { useAsync, Loading, ErrorBox, VerifyBadge } from './common.jsx';
import { useGuestNames } from '../guestNames.js';
import { Icon } from './icons.jsx';
import { useT } from '../i18n.jsx';

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

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <MiniStat label="Snapshots" value={all.length} />
        <MiniStat label={t('Grupos')} value={groups} />
        <MiniStat label={t('Tamaño total')} value={fmtBytes(totalSize)} />
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
          <table>
            <thead>
              <tr>
                <th>{t('Tipo')}</th><th>ID</th><th>{t('Fecha')}</th><th className="num">{t('Tamaño')}</th>
                <th>{t('Propietario')}</th><th>{t('Verificación')}</th><th>{t('Comentario')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s, i) => (
                <tr key={i}>
                  <td><span className="badge muted plain">{s['backup-type']}</span></td>
                  <td>
                    <strong>{s['backup-id']}</strong>
                    {s['backup-type'] !== 'host' && names[String(s['backup-id'])] && (
                      <span className="muted"> · {names[String(s['backup-id'])]}</span>
                    )}
                  </td>
                  <td title={fmtDate(s['backup-time'])}>{fmtAgo(s['backup-time'])}</td>
                  <td className="num">{fmtBytes(s.size)}</td>
                  <td className="muted">{s.owner}</td>
                  <td><VerifyBadge state={s.verification?.state} /></td>
                  <td className="muted">{s.comment || '—'}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 28 }}>
                  {all.length ? t('Ningún snapshot coincide con el filtro') : t('Sin snapshots en este datastore')}
                </td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
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

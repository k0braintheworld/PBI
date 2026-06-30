import { listTasks, listDatastores, getDatastoreStatus, listSnapshots } from './pbsService.js';

/**
 * Construye un informe de copias para un rango [from, to] (epoch s).
 * Devuelve { subject, html, range }.
 */

const isOk = (s) => s === 'OK' || /^WARNINGS/i.test(s || '');
const vmidFromId = (id) => { const m = /(?:vm|ct|qemu|lxc)[/-](\d+)/i.exec(id || ''); return m ? m[1] : null; };

const fmtBytes = (n) => {
  if (n == null) return '—';
  const u = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']; let i = 0; let v = Number(n);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
};
const dt = (e) => (e ? new Date(e * 1000).toLocaleString('es-ES') : '—');
const d = (e) => (e ? new Date(e * 1000).toLocaleDateString('es-ES') : '—');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function computeReport(auth, { from, to }, { sede = '', hostName = '', names = {}, title = 'Informe de copias de seguridad', vmids = null, meta = null, policies = null, offsite = null } = {}) {
  const vmidSet = vmids && vmids.length ? new Set(vmids.map(String)) : null;
  // Almacenamiento actual + snapshots
  const datastores = await listDatastores(auth);
  const perDatastore = [];
  const allSnaps = [];
  for (const ds of datastores) {
    const [status, snaps] = await Promise.all([
      getDatastoreStatus(auth, ds.store).catch(() => null),
      listSnapshots(auth, ds.store).catch(() => []),
    ]);
    perDatastore.push({ store: ds.store, used: status?.used ?? null, total: status?.total ?? null });
    for (const s of snaps) allSnaps.push({ ...s, store: ds.store });
  }
  // Último snapshot por grupo (para tamaño/verificación)
  const lastSnap = new Map();
  for (const s of allSnaps) {
    const k = String(s['backup-id']);
    const prev = lastSnap.get(k);
    if (!prev || (s['backup-time'] || 0) > (prev['backup-time'] || 0)) lastSnap.set(k, s);
  }

  // Tareas del periodo
  let tasks = [];
  try { tasks = await listTasks(auth, { limit: 5000, since: from }); } catch { tasks = []; }
  const inRange = (tasks || []).filter((t) => t.starttime >= from && t.starttime <= to && t.endtime != null);
  let backups = inRange.filter((t) => t.type === 'backup');
  if (vmidSet) backups = backups.filter((t) => vmidSet.has(String(vmidFromId(t.id) || t.id)));
  const okCount = backups.filter((t) => isOk(t.status)).length;
  const failCount = backups.length - okCount;
  const successRate = backups.length ? Math.round((okCount / backups.length) * 100) : 100;

  // Por máquina (vmid)
  const perVm = new Map();
  for (const t of backups) {
    const vmid = vmidFromId(t.id) || t.id;
    const m = perVm.get(vmid) || { vmid, count: 0, ok: 0, fail: 0, last: 0 };
    m.count += 1; if (isOk(t.status)) m.ok += 1; else m.fail += 1;
    m.last = Math.max(m.last, t.endtime || 0);
    perVm.set(vmid, m);
  }
  const vms = [...perVm.values()].sort((a, b) => (a.fail !== b.fail ? b.fail - a.fail : b.last - a.last));

  let failPool = inRange.filter((t) => !isOk(t.status));
  if (vmidSet) failPool = failPool.filter((t) => { const v = vmidFromId(t.id); return v ? vmidSet.has(String(v)) : false; });
  const failures = failPool.sort((a, b) => (b.endtime || 0) - (a.endtime || 0)).slice(0, 25);
  const totalUsed = perDatastore.reduce((a, x) => a + (x.used || 0), 0);
  const totalCap = perDatastore.reduce((a, x) => a + (x.total || 0), 0);
  // Tamaño lógico total de las copias (suma de snapshots) y factor de deduplicación
  const backupsLogical = allSnaps.reduce((a, s) => a + (s.size || 0), 0);
  const dedup = totalUsed > 0 ? backupsLogical / totalUsed : 0;

  // Calendario diario: estado de las copias por día del periodo
  const ymd = (dd) => `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')}`;
  const dayMap = new Map();
  for (const t of backups) {
    const k = ymd(new Date(t.starttime * 1000));
    const b = dayMap.get(k) || { ok: 0, fail: 0, total: 0 };
    b.total += 1; if (isOk(t.status)) b.ok += 1; else b.fail += 1;
    dayMap.set(k, b);
  }
  const calendar = [];
  const start = new Date(from * 1000); start.setHours(0, 0, 0, 0);
  const end = new Date(to * 1000);
  for (let dd = new Date(start); dd < end; dd.setDate(dd.getDate() + 1)) {
    const b = dayMap.get(ymd(dd));
    const status = b ? (b.fail > 0 && b.ok > 0 ? 'partial' : b.fail > 0 ? 'failed' : 'ok') : 'none';
    calendar.push({ day: dd.getDate(), weekday: (dd.getDay() + 6) % 7, status, total: b?.total || 0, failed: b?.fail || 0 });
  }
  const monthLabel = new Date(from * 1000).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

  const scope = vmidSet
    ? [...vmidSet].map((v) => ({ vmid: v, name: names[v] || '' }))
    : [...new Set(backups.map((t) => String(vmidFromId(t.id) || t.id)))].map((v) => ({ vmid: v, name: names[v] || '' }));

  // Estado de cifrado (crypt-mode de los ficheros de las copias)
  let encrypted = false; const cryptModes = new Set();
  for (const s of allSnaps) for (const f of s.files || []) {
    if (f['crypt-mode']) { cryptModes.add(f['crypt-mode']); if (f['crypt-mode'] === 'encrypt') encrypted = true; }
  }
  const encryption = { encrypted, modes: [...cryptModes] };

  const subject = `[PBI] ${title}${sede ? ` · ${sede}` : ''} · ${d(from)}–${d(to)}`;
  return { title, sede, hostName, from, to, perDatastore, totalUsed, totalCap, backupsLogical, dedup, vms, names, lastSnap, backups: backups.length, okCount, failCount, successRate, failures, calendar, monthLabel, scope, meta, encryption, policies, offsite, subject };
}

export async function buildReport(auth, range, opts) {
  const r = await computeReport(auth, range, opts);
  return { subject: r.subject, html: renderHtml(r), range };
}

/** Rango [from, to] del periodo COMPLETO anterior según la frecuencia. */
export function periodRange(frequency, now = new Date()) {
  const startOfDay = (date) => { const x = new Date(date); x.setHours(0, 0, 0, 0); return Math.floor(x.getTime() / 1000); };
  if (frequency === 'daily') {
    const today = startOfDay(now);
    return { from: today - 86400, to: today };
  }
  if (frequency === 'weekly') {
    const x = new Date(now);
    const dow = (x.getDay() + 6) % 7; // 0 = lunes
    const thisMon = startOfDay(new Date(x.getFullYear(), x.getMonth(), x.getDate() - dow));
    return { from: thisMon - 7 * 86400, to: thisMon };
  }
  // monthly: mes natural anterior
  const startThis = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
  const startPrev = Math.floor(new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime() / 1000);
  return { from: startPrev, to: startThis };
}

// --- Plantilla HTML profesional -------------------------------------------

function kpi(value, label, color) {
  return `<td width="25%" style="padding:6px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f9fc;border:1px solid #e8edf3;border-radius:10px">
      <tr><td style="padding:14px 14px 4px;font-size:26px;font-weight:700;color:${color};font-family:Consolas,monospace;letter-spacing:-1px">${value}</td></tr>
      <tr><td style="padding:0 14px 14px;font-size:11.5px;color:#6b7685;text-transform:uppercase;letter-spacing:.4px">${label}</td></tr>
    </table></td>`;
}

function bar(pct, color) {
  const w = Math.max(0, Math.min(100, pct));
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;border-radius:5px;height:8px"><tr>
    <td width="${w}%" style="background:${color};height:8px;border-radius:5px;font-size:0;line-height:0">&nbsp;</td>
    <td style="font-size:0;line-height:0">&nbsp;</td></tr></table>`;
}

export const CAL_COLORS = { ok: '#1f9d57', partial: '#d4880a', failed: '#d83a34', none: '#eef2f7' };

/** Agrupa el calendario en semanas (alineadas a lunes; null en huecos). */
export function calendarWeeks(calendar) {
  if (!calendar || !calendar.length) return [];
  const padded = [...Array(calendar[0].weekday).fill(null), ...calendar];
  while (padded.length % 7) padded.push(null);
  const weeks = [];
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));
  return weeks;
}

function calendarHtml(r) {
  const weeks = calendarWeeks(r.calendar);
  if (!weeks.length) return '';
  const wd = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const head = wd.map((x) => `<td align="center" style="font-size:10px;color:#8b95a3;font-weight:600;padding-bottom:4px">${x}</td>`).join('');
  const rows = weeks.map((week) => `<tr>${week.map((c) => {
    if (!c) return '<td style="padding:3px"><div style="height:20px">&nbsp;</div></td>';
    const isNone = c.status === 'none';
    const col = isNone ? '#eef2f7' : CAL_COLORS[c.status];
    const count = isNone ? '' : (c.status === 'failed' ? c.failed : c.total);
    const title = c.status === 'ok' ? `${c.total} correcta(s)` : c.status === 'failed' ? `${c.failed} fallo(s)` : c.status === 'partial' ? `${c.total} copias, ${c.failed} con fallo` : 'sin copias';
    return `<td align="center" width="14.28%" style="padding:3px">
      <div style="font-size:9px;color:#9aa3b0;line-height:1;margin-bottom:3px">${c.day}</div>
      <div title="${title}" style="width:26px;height:20px;line-height:20px;border-radius:5px;background:${col};color:#fff;font-size:11px;font-weight:600;margin:0 auto;${isNone ? 'border:1px solid #dde3ec;' : ''}">${count}</div>
    </td>`;
  }).join('')}</tr>`).join('');

  return `<tr><td style="padding:14px 22px 4px">
      <div style="font-size:15px;font-weight:600;color:#1b2430">Calendario de copias · <span style="text-transform:capitalize">${esc(r.monthLabel)}</span></div>
    </td></tr>
    <tr><td style="padding:2px 22px 8px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fafbfd;border:1px solid #eef1f5;border-radius:8px;padding:6px">
        <tr>${head}</tr>${rows}
      </table>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:8px"><tr>
        ${[['ok', 'Correcta'], ['partial', 'Parcial'], ['failed', 'Con fallo'], ['none', 'Sin copia']].map(([k, l]) =>
    `<td style="padding-right:14px;font-size:11px;color:#56616f"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${CAL_COLORS[k]};${k === 'none' ? 'border:1px solid #dde3ec;' : ''}vertical-align:middle;margin-right:5px"></span>${l}</td>`).join('')}
      </tr></table>
    </td></tr>`;
}

function metaStrip(r) {
  const m = r.meta || {};
  const cell = (label, val) => (val ? `<td style="padding:5px 14px;font-size:11.5px;color:#6b7685">${label}: <b style="color:#1b2430">${esc(val)}</b></td>` : '');
  return `<tr><td style="padding:8px 8px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f9fc;border:1px solid #eef1f5;border-radius:8px"><tr>
      ${cell('Informe nº', m.reportId)}${cell('Emitido', m.emittedAt)}${cell('Generado por', m.generatedBy)}${cell('Responsable', m.responsable)}
    </tr></table></td></tr>`;
}

function scopeBlock(r) {
  const list = (r.scope || []).map((s) => `${esc(s.vmid)}${s.name ? ` (${esc(s.name)})` : ''}`).join(' · ');
  return `<tr><td style="padding:12px 22px 2px"><div style="font-size:14px;font-weight:600;color:#1b2430">Alcance del informe</div></td></tr>
    <tr><td style="padding:2px 22px 6px;font-size:12.5px;color:#56616f">
      <b>${(r.scope || []).length || '—'}</b> máquina(s): ${list || 'todas las máquinas con copias en el periodo'}
    </td></tr>`;
}

function complianceBlock(r) {
  const yesno = (b) => (b ? '<span style="color:#157a42;font-weight:600">Sí</span>' : '<span style="color:#b62a25;font-weight:600">No</span>');
  const m = r.meta || {};
  const off = r.offsite;
  const polRows = (r.scope || []).map((s) => {
    const p = (r.policies && (r.policies[s.vmid] || r.policies['*'])) || null;
    return `<tr>
      <td style="padding:7px 12px;border-bottom:1px solid #eef1f5;font-size:12.5px"><b>${esc(s.vmid)}</b>${s.name ? ` · ${esc(s.name)}` : ''}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #eef1f5;font-size:12.5px">${p ? esc(p.schedule) : '—'}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #eef1f5;font-size:12.5px">${p ? esc(p.retention) : '—'}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #eef1f5;font-size:12.5px">${p ? esc(p.mode) : '—'}</td>
    </tr>`;
  }).join('');
  return `
    <tr><td style="padding:14px 22px 4px"><div style="font-size:15px;font-weight:600;color:#1b2430">Cumplimiento y política de copias</div></td></tr>
    <tr><td style="padding:2px 22px 8px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eef1f5;border-radius:8px;overflow:hidden">
        <tr style="background:#f7f9fc">
          <td style="padding:7px 12px;font-size:11px;color:#6b7685;text-transform:uppercase">Máquina</td>
          <td style="padding:7px 12px;font-size:11px;color:#6b7685;text-transform:uppercase">RPO (programación)</td>
          <td style="padding:7px 12px;font-size:11px;color:#6b7685;text-transform:uppercase">Retención</td>
          <td style="padding:7px 12px;font-size:11px;color:#6b7685;text-transform:uppercase">Modo</td>
        </tr>
        ${polRows || '<tr><td colspan="4" style="padding:10px 12px;color:#8b95a3;font-size:12px">Sin política de copia detectada para el alcance.</td></tr>'}
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;font-size:12px;color:#56616f">
        <tr>
          <td style="padding:3px 0;width:50%">Cifrado de las copias: ${yesno(r.encryption?.encrypted)}</td>
          <td style="padding:3px 0">Copia externa (3-2-1): ${off && off.configured ? `Sí${off.remotes && off.remotes.length ? ` (${esc(off.remotes.join(', '))})` : ''}` : 'No configurada'}</td>
        </tr>
        <tr>
          <td style="padding:3px 0">Última prueba de restauración: <b>${m.restoreTest ? esc(m.restoreTest) : 'no registrada'}</b></td>
          <td style="padding:3px 0">Controles: ISO/IEC 27001:2022 — 8.13 · ENS (RD 311/2022) — mp.info.6</td>
        </tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px">
        <tr>
          <td style="font-size:12px;color:#56616f;border-top:1px solid #e8edf3;padding-top:14px;width:55%">Responsable: <b>${esc(m.responsable || '____________________')}</b></td>
          <td style="font-size:12px;color:#56616f;border-top:1px solid #e8edf3;padding-top:14px;text-align:right">Firma: ____________________&nbsp;&nbsp;&nbsp;Fecha: __________</td>
        </tr>
      </table>
    </td></tr>`;
}

export function renderHtml(r) {
  const okColor = r.successRate >= 95 ? '#157a42' : r.successRate >= 80 ? '#a06806' : '#b62a25';
  const storageRows = r.perDatastore.map((x) => {
    const pct = x.total ? Math.round((x.used / x.total) * 100) : 0;
    const c = pct >= 90 ? '#d83a34' : pct >= 75 ? '#d4880a' : '#1f9d57';
    return `<tr><td style="padding:8px 0">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font-size:13px;font-weight:600;color:#1b2430">${esc(x.store)}</td>
        <td align="right" style="font-size:12px;color:#6b7685;font-family:Consolas,monospace">${fmtBytes(x.used)} / ${fmtBytes(x.total)} (${pct}%)</td>
      </tr></table>
      <div style="margin-top:6px">${bar(pct, c)}</div>
    </td></tr>`;
  }).join('');

  const vmRows = r.vms.map((m) => {
    const snap = r.lastSnap.get(String(m.vmid));
    const verify = snap?.verification?.state;
    const vBadge = verify === 'ok'
      ? '<span style="background:#e6f4ec;color:#157a42;border-radius:20px;padding:2px 9px;font-size:11px;font-weight:600">verificado</span>'
      : verify === 'failed'
        ? '<span style="background:#fae9e8;color:#b62a25;border-radius:20px;padding:2px 9px;font-size:11px;font-weight:600">fallido</span>'
        : '<span style="color:#8b95a3;font-size:11px">sin verificar</span>';
    const name = r.names[String(m.vmid)] ? ` · ${esc(r.names[String(m.vmid)])}` : '';
    const status = m.fail > 0
      ? `<span style="color:#b62a25;font-weight:600">${m.ok} OK / ${m.fail} fallo</span>`
      : `<span style="color:#157a42">${m.ok} OK</span>`;
    return `<tr>
      <td style="padding:9px 12px;border-bottom:1px solid #eef1f5;font-size:13px"><strong>${esc(m.vmid)}</strong><span style="color:#6b7685">${name}</span></td>
      <td style="padding:9px 12px;border-bottom:1px solid #eef1f5;font-size:13px;text-align:center">${m.count}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #eef1f5;font-size:12.5px">${status}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #eef1f5;font-size:12.5px;color:#56616f">${dt(m.last)}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #eef1f5;font-size:12.5px;font-family:Consolas,monospace;text-align:right">${fmtBytes(snap?.size)}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #eef1f5">${vBadge}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="6" style="padding:18px;text-align:center;color:#8b95a3">No hubo copias en el periodo.</td></tr>`;

  const failBlock = r.failures.length ? `
    <tr><td style="padding:18px 22px 4px"><div style="font-size:15px;font-weight:600;color:#b62a25">⚠ Incidencias del periodo (${r.failures.length})</div></td></tr>
    <tr><td style="padding:6px 22px 8px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #f1c4c1;border-radius:8px;overflow:hidden">
        ${r.failures.map((t) => `<tr>
          <td style="padding:7px 12px;border-bottom:1px solid #fae9e8;font-size:12px;color:#1b2430">${esc(t.type)} · ${esc(t.id || '—')}</td>
          <td style="padding:7px 12px;border-bottom:1px solid #fae9e8;font-size:11.5px;color:#6b7685">${dt(t.endtime)}</td>
          <td style="padding:7px 12px;border-bottom:1px solid #fae9e8;font-size:11.5px;color:#b62a25;font-family:Consolas,monospace">${esc((t.status || '').slice(0, 60))}</td>
        </tr>`).join('')}
      </table>
    </td></tr>` : `
    <tr><td style="padding:14px 22px"><div style="background:#e6f4ec;color:#157a42;border-radius:8px;padding:12px 14px;font-size:13px;font-weight:600">✓ Sin incidencias: todas las copias del periodo finalizaron correctamente.</div></td></tr>`;

  return `<!doctype html><html><body style="margin:0;background:#eef1f5;padding:24px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="680" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0">
      <tr><td style="background:#131c28;padding:24px 26px">
        <table role="presentation" width="100%"><tr>
          <td>
            <div style="font-size:11px;color:#e8730c;font-weight:700;letter-spacing:1px;text-transform:uppercase">PBI</div>
            <div style="font-size:22px;color:#fff;font-weight:600;margin-top:3px">${esc(r.title)}</div>
            <div style="font-size:13px;color:#9fabbb;margin-top:5px">Periodo: <span style="color:#cfd8e4">${d(r.from)} – ${d(r.to)}</span></div>
          </td>
          <td align="right" valign="top">
            ${r.sede ? `<div style="font-size:11px;color:#9fabbb;text-transform:uppercase;letter-spacing:.5px">Sede</div><div style="font-size:16px;color:#fff;font-weight:600">${esc(r.sede)}</div>` : ''}
            ${r.hostName ? `<div style="font-size:11.5px;color:#7e8b9c;margin-top:6px">${esc(r.hostName)}</div>` : ''}
          </td>
        </tr></table>
      </td></tr>

      ${r.meta ? metaStrip(r) : ''}

      <tr><td style="padding:16px 16px 4px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          ${kpi(r.backups, 'Copias realizadas', '#1b2430')}
          ${kpi(`${r.successRate}%`, 'Tasa de éxito', okColor)}
          ${kpi(r.failCount, 'Con fallo', r.failCount ? '#b62a25' : '#157a42')}
          ${kpi(fmtBytes(r.totalUsed), 'Datos almacenados', '#1b2430')}
        </tr></table>
      </td></tr>

      ${scopeBlock(r)}

      ${r.calendar && r.calendar.length > 1 ? calendarHtml(r) : ''}

      <tr><td style="padding:14px 22px 4px"><div style="font-size:15px;font-weight:600;color:#1b2430">Estado de almacenamiento</div></td></tr>
      <tr><td style="padding:2px 22px 8px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f9fc;border:1px solid #eef1f5;border-radius:8px"><tr>
          <td align="center" style="padding:8px 14px;font-size:12px;color:#6b7685">Tamaño total de copias (lógico): <b style="color:#1b2430;font-family:Consolas,monospace">${fmtBytes(r.backupsLogical)}</b>${r.dedup >= 1 ? ` &nbsp;·&nbsp; Deduplicación: <b style="color:#157a42;font-family:Consolas,monospace">${r.dedup.toFixed(1)}×</b>` : ''}</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:0 22px 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${storageRows}</table></td></tr>

      <tr><td style="padding:14px 22px 4px"><div style="font-size:15px;font-weight:600;color:#1b2430">Copias por máquina</div></td></tr>
      <tr><td style="padding:4px 22px 8px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eef1f5;border-radius:8px;overflow:hidden">
          <tr style="background:#f7f9fc">
            <td style="padding:8px 12px;font-size:11px;color:#6b7685;text-transform:uppercase;letter-spacing:.4px;font-weight:600">Máquina</td>
            <td style="padding:8px 12px;font-size:11px;color:#6b7685;text-transform:uppercase;text-align:center">Copias</td>
            <td style="padding:8px 12px;font-size:11px;color:#6b7685;text-transform:uppercase">Resultado</td>
            <td style="padding:8px 12px;font-size:11px;color:#6b7685;text-transform:uppercase">Última copia</td>
            <td style="padding:8px 12px;font-size:11px;color:#6b7685;text-transform:uppercase;text-align:right">Tamaño</td>
            <td style="padding:8px 12px;font-size:11px;color:#6b7685;text-transform:uppercase">Verif.</td>
          </tr>
          ${vmRows}
        </table>
      </td></tr>

      ${failBlock}

      ${r.meta ? complianceBlock(r) : ''}

      <tr><td style="padding:14px 22px 2px;font-size:11px;color:#56616f;line-height:1.5">
        <b>Declaración:</b> este informe constituye evidencia del estado de las copias de seguridad gestionadas mediante Proxmox Backup Server para el periodo y alcance indicados, en apoyo de los controles ISO/IEC 27001:2022 (8.13) y ENS RD 311/2022 (mp.info.6). Los datos proceden directamente de los registros del sistema de copia de seguridad. Este documento aporta evidencia para auditoría; no constituye por sí mismo una certificación de cumplimiento.
      </td></tr>
      <tr><td style="padding:10px 22px 16px;background:#f7f9fc;border-top:1px solid #eef1f5;color:#8b95a3;font-size:11.5px">
        Informe generado automáticamente por PBI${r.sede ? ` · Sede ${esc(r.sede)}` : ''} · ${dt(Math.floor(Date.now() / 1000))}
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

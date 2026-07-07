// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import nodemailer from 'nodemailer';

/**
 * Envío de correo (SMTP) y plantilla HTML limpia para notificar el estado
 * de una tarea. Pensada para ser legible de un vistazo (a diferencia de los
 * correos por defecto de Proxmox).
 */

const TASK_LABELS = {
  backup: 'Copia de seguridad', verify: 'Verificación', prune: 'Prune',
  garbage_collection: 'Garbage collection', sync: 'Sincronización',
  reader: 'Lectura/restauración', qmrestore: 'Restauración VM',
};
const taskLabel = (t) => TASK_LABELS[t] || t;

const fmtDate = (e) => (e ? new Date(e * 1000).toLocaleString('es-ES') : '—');
const fmtDur = (s, e) => {
  if (!s || !e) return '—';
  const d = e - s;
  if (d < 60) return `${d}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m ${d % 60}s`;
  return `${Math.floor(d / 3600)}h ${Math.floor((d % 3600) / 60)}m`;
};
const vmidFromId = (id) => {
  const m = /(?:vm|ct|qemu|lxc)[/-](\d+)/i.exec(id || '');
  return m ? m[1] : null;
};

function statusOf(task) {
  if (task.status === 'OK') return { kind: 'ok', label: 'Correcta', color: '#157a42', bg: '#e6f4ec', icon: '✓', emoji: '✅' };
  if (/^WARNINGS/i.test(task.status || '')) return { kind: 'warn', label: 'Con avisos', color: '#a06806', bg: '#fbf2dd', icon: '!', emoji: '⚠️' };
  return { kind: 'fail', label: 'Fallida', color: '#b62a25', bg: '#fae9e8', icon: '✕', emoji: '❌' };
}

export function makeTransport(smtp) {
  return nodemailer.createTransport({
    host: smtp.host,
    port: Number(smtp.port) || 587,
    secure: !!smtp.secure, // true => 465; false => STARTTLS en 587/25
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
}

export async function sendMail(smtp, { subject, html, text, attachments }) {
  const transport = makeTransport(smtp);
  await transport.sendMail({
    from: smtp.from || smtp.user,
    to: smtp.to,
    subject,
    text,
    html,
    attachments,
  });
}

function row(label, value) {
  return `<tr>
    <td style="padding:8px 14px;color:#6b7685;font-size:13px;border-bottom:1px solid #eef1f5;white-space:nowrap;vertical-align:top">${label}</td>
    <td style="padding:8px 14px;color:#1b2430;font-size:13px;border-bottom:1px solid #eef1f5;font-weight:500">${value}</td>
  </tr>`;
}

// Extrae el tipo de backup de PBS (vm/ct/host/file) del task.id "store:type/id"
const pbsBackupType = (id) => {
  const m = /[^:]+:(vm|ct|host|file)\//.exec(id || '');
  if (!m) return null;
  return { vm: 'VM', ct: 'CT', host: 'Host', file: 'Ficheros' }[m[1]] || m[1].toUpperCase();
};

/** Construye {subject, html, text} para una tarea finalizada. */
export function buildTaskEmail(task, { hostName, names = {}, sede, backupMode, encrypted } = {}) {
  const st = statusOf(task);
  const site = sede || 'PBI';
  const vmid = vmidFromId(task.id);
  const name = vmid && names[vmid] ? names[vmid] : '';
  const target = task.id ? `${task.id}${name ? ` · ${name}` : ''}` : '—';
  const subject = `[${site}] ${st.emoji} ${taskLabel(task.type)} ${st.label.toLowerCase()}${name ? ` · ${name}` : (task.id ? ` · ${task.id}` : '')}`;

  // Fila de tipo de copia: categoría PBS + modo full/incremental si disponible
  const btype = task.type === 'backup' ? pbsBackupType(task.id) : null;
  const bmode = backupMode ? (backupMode === 'incremental' ? 'Incremental' : 'Completa') : null;
  const backupTypeLabel = [btype, bmode].filter(Boolean).join(' · ');
  const encLabel = encrypted != null ? (encrypted ? 'Sí &#128274;' : 'No') : null;

  const html = `<!doctype html><html><body style="margin:0;background:#eef1f5;padding:24px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
      <tr><td style="background:${st.bg};padding:18px 22px;border-bottom:3px solid ${st.color}">
        <div style="font-size:13px;color:${st.color};font-weight:600;letter-spacing:.4px;text-transform:uppercase">${escapeHtml(site)} · Notificación de tarea</div>
        <div style="font-size:20px;color:#1b2430;font-weight:600;margin-top:4px">
          <span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border-radius:50%;background:${st.color};color:#fff;font-size:13px;margin-right:8px">${st.icon}</span>
          ${taskLabel(task.type)} ${st.label.toLowerCase()}
        </div>
      </td></tr>
      <tr><td style="padding:6px 8px 14px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${row('Estado', `<span style="color:${st.color}">${st.label}</span>`)}
          ${row('Tipo de tarea', taskLabel(task.type))}
          ${backupTypeLabel ? row('Tipo de copia', escapeHtml(backupTypeLabel)) : ''}
          ${encLabel != null ? row('Cifrado', `<span style="color:${encrypted ? '#157a42' : '#6b7685'};font-weight:${encrypted ? 600 : 400}">${encLabel}</span>`) : ''}
          ${row('Máquina / objetivo', target)}
          ${row('Servidor PBS', hostName || '—')}
          ${row('Inicio', fmtDate(task.starttime))}
          ${row('Fin', fmtDate(task.endtime))}
          ${row('Duración', fmtDur(task.starttime, task.endtime))}
          ${row('Resultado', `<code style="font-size:12px;color:${st.kind === 'fail' ? st.color : '#1b2430'}">${escapeHtml(task.status || '—')}</code>`)}
        </table>
      </td></tr>
      <tr><td style="padding:12px 22px;background:#f7f9fc;border-top:1px solid #eef1f5;color:#8b95a3;font-size:11.5px">
        Enviado por ${escapeHtml(site)} · ${fmtDate(Math.floor(Date.now() / 1000))}
      </td></tr>
    </table>
  </td></tr></table></body></html>`;

  const text = [
    `${site} — ${taskLabel(task.type)} ${st.label}`,
    `Estado:    ${st.label} (${task.status || '—'})`,
    backupTypeLabel ? `Tipo copia: ${backupTypeLabel}` : '',
    encrypted != null ? `Cifrado:   ${encrypted ? 'Sí' : 'No'}` : '',
    `Objetivo:  ${target}`,
    `Servidor:  ${hostName || '—'}`,
    `Inicio:    ${fmtDate(task.starttime)}`,
    `Fin:       ${fmtDate(task.endtime)}`,
    `Duración:  ${fmtDur(task.starttime, task.endtime)}`,
  ].filter(Boolean).join('\n');

  return { subject, html, text };
}

/** Construye {subject, html, text} para una restauración de VM/CT finalizada. */
export function buildRestoreEmail(info, result, { sede } = {}) {
  const site = sede || 'PBI';
  const ok = result.exitstatus === 'OK';
  const st = ok
    ? { label: 'Correcta', color: '#157a42', bg: '#e6f4ec', icon: '✓', emoji: '✅' }
    : { label: 'Fallida', color: '#b62a25', bg: '#fae9e8', icon: '✕', emoji: '❌' };
  const kind = info.kind === 'scheduled' ? 'Programada' : 'Manual';
  const tgt = `${(info.type === 'lxc' ? 'CT' : 'VM')} ${info.targetVmid}`;
  const subject = `[${site}] ${st.emoji} Restauración ${st.label.toLowerCase()} · ${tgt}${info.jobName ? ` · ${info.jobName}` : ''}`;

  const html = `<!doctype html><html><body style="margin:0;background:#eef1f5;padding:24px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
      <tr><td style="background:${st.bg};padding:18px 22px;border-bottom:3px solid ${st.color}">
        <div style="font-size:13px;color:${st.color};font-weight:600;letter-spacing:.4px;text-transform:uppercase">${escapeHtml(site)} · Restauración (${kind})</div>
        <div style="font-size:20px;color:#1b2430;font-weight:600;margin-top:4px">
          <span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border-radius:50%;background:${st.color};color:#fff;font-size:13px;margin-right:8px">${st.icon}</span>
          Restauración ${st.label.toLowerCase()}
        </div>
      </td></tr>
      <tr><td style="padding:6px 8px 14px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${row('Estado', `<span style="color:${st.color}">${st.label}</span>`)}
          ${row('Destino', `${tgt}${info.node ? ` · nodo ${escapeHtml(info.node)}` : ''}`)}
          ${info.sourceVmid && info.sourceVmid !== info.targetVmid ? row('Origen', `VM ${escapeHtml(info.sourceVmid)}`) : ''}
          ${row('Punto de restauración', `<span style="font-family:monospace;font-size:12px">${escapeHtml(info.point || '—')}</span>${info.ctime ? ` · ${fmtDate(info.ctime)}` : ''}`)}
          ${row('Servidor PVE', escapeHtml(info.pveName || '—'))}
          ${info.jobName ? row('Trabajo', escapeHtml(info.jobName)) : ''}
          ${row('Inicio', fmtDate(result.start))}
          ${row('Fin', fmtDate(result.end))}
          ${row('Duración', fmtDur(result.start, result.end))}
          ${row('Resultado', `<code style="font-size:12px;color:${ok ? '#1b2430' : st.color}">${escapeHtml(result.exitstatus || '—')}</code>`)}
        </table>
      </td></tr>
      <tr><td style="padding:12px 22px;background:#f7f9fc;border-top:1px solid #eef1f5;color:#8b95a3;font-size:11.5px">
        Enviado por ${escapeHtml(site)} · ${fmtDate(Math.floor(Date.now() / 1000))}
      </td></tr>
    </table>
  </td></tr></table></body></html>`;

  const text = [
    `${site} — Restauración ${st.label} (${kind})`,
    `Destino:   ${tgt}${info.node ? ` · nodo ${info.node}` : ''}`,
    `Punto:     ${info.point || '—'}`,
    `Servidor:  ${info.pveName || '—'}`,
    info.jobName ? `Trabajo:   ${info.jobName}` : '',
    `Inicio:    ${fmtDate(result.start)}`,
    `Fin:       ${fmtDate(result.end)}`,
    `Duración:  ${fmtDur(result.start, result.end)}`,
    `Resultado: ${result.exitstatus || '—'}`,
  ].filter(Boolean).join('\n');

  return { subject, html, text };
}

const fmtBytes = (n) => {
  if (n == null) return '—';
  const u = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']; let i = 0; let v = Number(n);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
};

/** Envoltorio común de los emails de aviso/resumen. */
function shell({ site, header, headerColor, headerBg, bodyHtml }) {
  return `<!doctype html><html><body style="margin:0;background:#eef1f5;padding:24px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
      <tr><td style="background:${headerBg};padding:18px 22px;border-bottom:3px solid ${headerColor}">
        <div style="font-size:13px;color:${headerColor};font-weight:600;letter-spacing:.4px;text-transform:uppercase">${escapeHtml(site)}</div>
        <div style="font-size:19px;color:#1b2430;font-weight:600;margin-top:4px">${header}</div>
      </td></tr>
      <tr><td style="padding:12px 22px 16px">${bodyHtml}</td></tr>
      <tr><td style="padding:12px 22px;background:#f7f9fc;border-top:1px solid #eef1f5;color:#8b95a3;font-size:11.5px">
        Enviado por ${escapeHtml(site)} · ${fmtDate(Math.floor(Date.now() / 1000))}
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

/** Aviso de máquinas fuera de RPO (sin copia reciente). */
export function buildRpoEmail(machines, { sede, hours, names = {} } = {}) {
  const site = sede || 'PBI';
  const subject = `[${site}] ⏰ ${machines.length} máquina(s) sin copia reciente (> ${hours} h)`;
  const rows = machines.map((m) => {
    const name = names[m.id] ? ` · ${escapeHtml(names[m.id])}` : '';
    return `<tr>
      <td style="padding:7px 10px;border-bottom:1px solid #eef1f5;font-size:13px"><b>${escapeHtml(m.type)} ${escapeHtml(m.id)}</b>${name}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #eef1f5;font-size:12.5px;color:#b62a25">${m.last ? fmtDate(m.last) : 'sin copias'}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #eef1f5;font-size:12px;color:#6b7685">${escapeHtml(m.host || '')}</td>
    </tr>`;
  }).join('');
  const bodyHtml = `
    <p style="font-size:13px;color:#56616f;margin:4px 0 10px">Estas máquinas llevan más de <b>${hours} horas</b> sin una copia de seguridad completada:</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eef1f5;border-radius:8px;overflow:hidden">
      <tr style="background:#f7f9fc">
        <td style="padding:6px 10px;font-size:11px;color:#6b7685;text-transform:uppercase">Máquina</td>
        <td style="padding:6px 10px;font-size:11px;color:#6b7685;text-transform:uppercase">Última copia</td>
        <td style="padding:6px 10px;font-size:11px;color:#6b7685;text-transform:uppercase">Servidor</td>
      </tr>${rows}
    </table>
    <p style="font-size:12px;color:#8b95a3;margin:10px 0 0">Revisa el trabajo de copia, el programador o la conectividad con PBS.</p>`;
  const html = shell({ site, header: '⏰ Copias fuera de plazo (RPO)', headerColor: '#a06806', headerBg: '#fbf2dd', bodyHtml });
  const text = [`${site} — Máquinas sin copia reciente (> ${hours} h):`,
    ...machines.map((m) => ` - ${m.type} ${m.id}${names[m.id] ? ` (${names[m.id]})` : ''}: última ${m.last ? fmtDate(m.last) : 'nunca'} [${m.host || ''}]`)].join('\n');
  return { subject, html, text };
}

/** Aviso de datastores por encima del umbral de ocupación. */
export function buildStorageEmail(stores, { sede, percent } = {}) {
  const site = sede || 'PBI';
  const subject = `[${site}] 💾 ${stores.length} datastore(s) por encima del ${percent}% de ocupación`;
  const rows = stores.map((s) => `<tr>
      <td style="padding:7px 10px;border-bottom:1px solid #eef1f5;font-size:13px"><b>${escapeHtml(s.store)}</b></td>
      <td style="padding:7px 10px;border-bottom:1px solid #eef1f5;font-size:12.5px;color:${s.pct >= 95 ? '#b62a25' : '#a06806'};font-family:Consolas,monospace"><b>${s.pct}%</b> · ${fmtBytes(s.used)} / ${fmtBytes(s.total)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #eef1f5;font-size:12px;color:#6b7685">${escapeHtml(s.host || '')}</td>
    </tr>`).join('');
  const bodyHtml = `
    <p style="font-size:13px;color:#56616f;margin:4px 0 10px">Ocupación por encima del umbral configurado (<b>${percent}%</b>). Si un datastore se llena, las copias fallarán:</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eef1f5;border-radius:8px;overflow:hidden">
      <tr style="background:#f7f9fc">
        <td style="padding:6px 10px;font-size:11px;color:#6b7685;text-transform:uppercase">Datastore</td>
        <td style="padding:6px 10px;font-size:11px;color:#6b7685;text-transform:uppercase">Uso</td>
        <td style="padding:6px 10px;font-size:11px;color:#6b7685;text-transform:uppercase">Servidor</td>
      </tr>${rows}
    </table>
    <p style="font-size:12px;color:#8b95a3;margin:10px 0 0">Considera ampliar el almacenamiento, ajustar la retención (prune) o ejecutar Garbage Collection.</p>`;
  const html = shell({ site, header: '💾 Almacenamiento al límite', headerColor: '#a06806', headerBg: '#fbf2dd', bodyHtml });
  const text = [`${site} — Datastores por encima del ${percent}%:`,
    ...stores.map((s) => ` - ${s.store}: ${s.pct}% (${fmtBytes(s.used)} / ${fmtBytes(s.total)}) [${s.host || ''}]`)].join('\n');
  return { subject, html, text };
}

/** Resumen diario: estado de las últimas 24 h en todos los servidores. */
export function buildDigestEmail({ sections = [], unprotected = [], names = {} }, { sede, blocks } = {}) {
  const b = { tasks: true, rpo: true, storage: true, unprotected: true, ...(blocks || {}) };
  const site = sede || 'PBI';
  const totalFail = b.tasks ? sections.reduce((a, s) => a + s.fail, 0) : 0;
  const totalRpo = b.rpo ? sections.reduce((a, s) => a + (s.outOfRpo?.length || 0), 0) : 0;
  const okAll = totalFail === 0 && totalRpo === 0 && (!b.unprotected || unprotected.length === 0);
  const today = new Date().toLocaleDateString('es-ES');
  const subject = `[${site}] ${okAll ? '✅' : '⚠️'} Resumen diario de copias — ${today}`;

  const secHtml = sections.map((s) => {
    const failRows = (b.tasks ? (s.failures || []) : []).map((f) => `<div style="font-size:12px;color:#b62a25;padding:2px 0">✕ ${escapeHtml(f.type)} · ${escapeHtml(f.id || '—')} — <span style="font-family:Consolas,monospace">${escapeHtml((f.status || '').slice(0, 60))}</span></div>`).join('');
    const rpoRows = (b.rpo ? (s.outOfRpo || []) : []).map((m) => `<div style="font-size:12px;color:#a06806;padding:2px 0">⏰ ${escapeHtml(m.type)} ${escapeHtml(m.id)}${names[m.id] ? ` · ${escapeHtml(names[m.id])}` : ''} — última: ${m.last ? fmtDate(m.last) : 'nunca'}</div>`).join('');
    const storage = (b.storage ? (s.storage || []) : []).map((d) => `<span style="font-size:12px;color:${d.pct >= 90 ? '#b62a25' : d.pct >= 75 ? '#a06806' : '#56616f'};padding-right:12px">${escapeHtml(d.store)}: <b>${d.pct}%</b></span>`).join('');
    return `<div style="border:1px solid #eef1f5;border-radius:8px;padding:10px 14px;margin-bottom:10px">
      <div style="font-size:13px;font-weight:600;color:#1b2430;margin-bottom:4px">${escapeHtml(s.host)}</div>
      ${b.tasks ? `<div style="font-size:12.5px;color:#56616f">Copias 24 h: <b style="color:#157a42">${s.ok} OK</b>${s.fail ? ` · <b style="color:#b62a25">${s.fail} con fallo</b>` : ''}</div>` : ''}
      ${failRows}${rpoRows}
      ${storage ? `<div style="margin-top:5px">${storage}</div>` : ''}
    </div>`;
  }).join('');

  const unpHtml = b.unprotected && unprotected.length
    ? `<div style="background:#fbf2dd;border:1px solid #f0d9a8;border-radius:8px;padding:9px 13px;font-size:12.5px;color:#a06806;margin-bottom:10px">
        ⚠ <b>${unprotected.length} máquina(s) sin proteger</b> (sin ninguna copia en PBS): ${unprotected.slice(0, 10).map((g) => `${escapeHtml(String(g.vmid))}${g.name ? ` (${escapeHtml(g.name)})` : ''}`).join(' · ')}${unprotected.length > 10 ? ' …' : ''}
      </div>` : '';

  const bodyHtml = `${okAll ? '<p style="font-size:13px;color:#157a42;font-weight:600;margin:4px 0 10px">✓ Todo en orden: sin fallos, sin máquinas fuera de plazo.</p>' : ''}${unpHtml}${secHtml}`;
  const html = shell({
    site, header: `📋 Resumen diario — ${today}`,
    headerColor: okAll ? '#157a42' : '#a06806', headerBg: okAll ? '#e6f4ec' : '#fbf2dd', bodyHtml,
  });
  const text = [
    `${site} — Resumen diario ${today}`,
    ...sections.map((s) => `${s.host}: ${b.tasks ? `${s.ok} OK, ${s.fail} fallo(s)` : ''}${b.rpo ? ` ${s.outOfRpo?.length || 0} fuera de RPO` : ''}`.trim()),
    b.unprotected && unprotected.length ? `Sin proteger: ${unprotected.map((g) => g.vmid).join(', ')}` : '',
  ].filter(Boolean).join('\n');
  return { subject, html, text };
}

/**
 * Resumen agrupado de un grupo de tareas: un único email cuando todos los
 * miembros del grupo han terminado (o al vencer la espera). `summary` es el
 * objeto que produce taskGroups.collectDue(): { groupName, complete, members:[
 * { kind, label, ok:[unidades], fail:[{id,status}], pending:[...], done } ],
 * totOk, totFail }. `names` mapea VMID → nombre de máquina.
 */
export function buildGroupSummaryEmail(summary, { sede, names = {} } = {}) {
  const site = sede || 'PBI';
  const nm = (v) => (names[v] ? ` (${escapeHtml(names[v])})` : '');
  const anyFail = summary.totFail > 0;
  const anyPending = summary.members.some((m) => m.pending.length);
  const emoji = anyFail ? '⚠️' : anyPending ? '⏳' : '✅';
  const headerColor = anyFail ? '#b62a25' : anyPending ? '#a06806' : '#157a42';
  const headerBg = anyFail ? '#fdeceb' : anyPending ? '#fbf2dd' : '#e6f4ec';
  const subject = `[${site}] ${emoji} Resumen «${summary.groupName}»`
    + ` — ${summary.totOk} OK${summary.totFail ? `, ${summary.totFail} con fallo` : ''}${!summary.complete ? ' (parcial)' : ''}`;

  const memHtml = summary.members.map((m) => {
    const head = `<div style="font-size:13px;font-weight:600;color:#1b2430;margin-bottom:3px">${taskLabel(m.kind)} · ${escapeHtml(m.label)}
      <span style="font-weight:400;color:${m.done ? '#157a42' : '#a06806'}">— ${m.done ? 'terminado' : 'pendiente'}</span></div>`;
    const okLine = m.ok.length
      ? `<div style="font-size:12px;color:#157a42;padding:1px 0">✓ ${m.ok.length} correcta(s): ${m.ok.map((v) => `${escapeHtml(String(v))}${nm(v)}`).join(', ')}</div>` : '';
    const failLine = m.fail.length
      ? m.fail.map((f) => `<div style="font-size:12px;color:#b62a25;padding:1px 0">✕ ${escapeHtml(String(f.id))}${nm(f.id)} — <span style="font-family:Consolas,monospace">${escapeHtml(String(f.status || '').slice(0, 60))}</span></div>`).join('') : '';
    const pendLine = m.pending.length
      ? `<div style="font-size:12px;color:#a06806;padding:1px 0">⏳ ${m.pending.length} sin ejecutar: ${m.pending.map((v) => `${escapeHtml(String(v))}${nm(v)}`).join(', ')}</div>` : '';
    return `<div style="border:1px solid #eef1f5;border-radius:8px;padding:10px 14px;margin-bottom:10px">${head}${okLine}${failLine}${pendLine}</div>`;
  }).join('');

  const intro = summary.complete
    ? `<p style="font-size:13px;color:${headerColor};font-weight:600;margin:2px 0 12px">${anyFail ? '⚠ El grupo ha terminado con fallos.' : '✓ El grupo ha terminado correctamente.'}</p>`
    : `<p style="font-size:13px;color:#a06806;font-weight:600;margin:2px 0 12px">⏳ Resumen parcial: se agotó el tiempo de espera y algunos miembros no llegaron a ejecutarse.</p>`;

  const html = shell({
    site, header: `📦 Resumen de grupo · ${escapeHtml(summary.groupName)}`,
    headerColor, headerBg, bodyHtml: `${intro}${memHtml}`,
  });

  const text = [
    `${site} — Resumen del grupo "${summary.groupName}" ${summary.complete ? '' : '(parcial)'}`,
    `${summary.totOk} correcta(s), ${summary.totFail} con fallo`,
    '',
    ...summary.members.map((m) => {
      const parts = [`${taskLabel(m.kind)} · ${m.label}: ${m.done ? 'terminado' : 'pendiente'}`];
      if (m.ok.length) parts.push(`  OK: ${m.ok.join(', ')}`);
      if (m.fail.length) parts.push(`  Fallo: ${m.fail.map((f) => `${f.id} (${f.status})`).join(', ')}`);
      if (m.pending.length) parts.push(`  Sin ejecutar: ${m.pending.join(', ')}`);
      return parts.join('\n');
    }),
  ].join('\n');

  return { subject, html, text };
}

/**
 * Aviso de que hay una versión nueva de PBI publicada. Incluye la versión, la
 * versión actual y las notas del release (texto tal cual de GitHub, sin ejecutar
 * ni interpretar nada: se muestra escapado).
 */
export function buildUpdateEmail({ version, current, notes, url }, { sede } = {}) {
  const site = sede || 'PBI';
  const subject = `[${site}] ⬆️ Nueva versión de PBI disponible: v${version}`;
  const notesText = String(notes || '').trim();
  const notesHtml = notesText
    ? `<div style="white-space:pre-wrap;font-family:Consolas,monospace;font-size:12px;color:#1b2430;background:#f7f9fc;border:1px solid #eef1f5;border-radius:8px;padding:12px 14px;max-height:none">${escapeHtml(notesText.slice(0, 8000))}</div>`
    : '<p style="font-size:13px;color:#6b7685">(El release no incluye notas.)</p>';

  const bodyHtml = `
    <p style="font-size:13.5px;color:#1b2430;margin:2px 0 12px">
      Hay una versión más reciente de <b>PBI</b> publicada.
      Tu versión actual es <b>v${escapeHtml(String(current || '—'))}</b> y la última es <b>v${escapeHtml(String(version))}</b>.
    </p>
    <div style="font-size:12.5px;color:#56616f;margin-bottom:6px;text-transform:uppercase;letter-spacing:.4px;font-weight:600">Novedades</div>
    ${notesHtml}
    ${url ? `<p style="font-size:12.5px;margin:12px 0 0"><a href="${escapeHtml(url)}" style="color:#2257c4">Ver el release en GitHub</a></p>` : ''}
    <p style="font-size:12px;color:#8b95a3;margin:12px 0 0">Puedes actualizar desde el propio panel (botón de actualización) o instalando el .deb.</p>`;

  const html = shell({ site, header: `⬆️ PBI v${version} disponible`, headerColor: '#2257c4', headerBg: '#e9f0fb', bodyHtml });
  const text = [
    `${site} — Nueva versión de PBI: v${version} (actual: v${current || '—'})`,
    '',
    'Novedades:',
    notesText || '(sin notas)',
    '',
    url ? `Release: ${url}` : '',
    'Actualiza desde el panel o instalando el .deb.',
  ].filter(Boolean).join('\n');

  return { subject, html, text };
}

/** Email de prueba. */
export function buildTestEmail({ hostName, sede } = {}) {
  const site = sede || 'PBI';
  const now = Math.floor(Date.now() / 1000);
  const sample = {
    type: 'backup', id: 'ejemplo-store:vm/999',
    starttime: now - 184, endtime: now, status: 'OK',
  };
  const m = buildTaskEmail(sample, {
    hostName: hostName || '—',
    names: { 999: 'ejemplo-vm' },
    sede,
    backupMode: 'incremental',
  });
  // Añadir banner de prueba al principio del HTML
  const banner = `<tr><td colspan="2" style="background:#fffbe6;border:1.5px solid #f0c050;border-radius:8px;padding:10px 16px;font-size:12.5px;color:#7a5c00;font-weight:600;text-align:center;margin-bottom:8px">
    &#9888;&#65039; Este es un email de PRUEBA generado por PBI. Las notificaciones reales incluirán los datos reales de tus tareas.
  </td></tr>`;
  const html = m.html.replace(
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">',
    `${banner}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">`,
  );
  const text = `[EMAIL DE PRUEBA — los datos siguientes son de muestra]\n\n${m.text}`;
  return { html, text, subject: `[${site}] Email de prueba ✅` };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

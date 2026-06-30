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

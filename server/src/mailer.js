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

/** Construye {subject, html, text} para una tarea finalizada. */
export function buildTaskEmail(task, { hostName, names = {} } = {}) {
  const st = statusOf(task);
  const vmid = vmidFromId(task.id);
  const name = vmid && names[vmid] ? names[vmid] : '';
  const target = task.id ? `${task.id}${name ? ` · ${name}` : ''}` : '—';
  const subject = `[PBI] ${st.emoji} ${taskLabel(task.type)} ${st.label.toLowerCase()}${name ? ` · ${name}` : (task.id ? ` · ${task.id}` : '')}`;

  const html = `<!doctype html><html><body style="margin:0;background:#eef1f5;padding:24px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
      <tr><td style="background:${st.bg};padding:18px 22px;border-bottom:3px solid ${st.color}">
        <div style="font-size:13px;color:${st.color};font-weight:600;letter-spacing:.4px;text-transform:uppercase">PBI · Notificación de tarea</div>
        <div style="font-size:20px;color:#1b2430;font-weight:600;margin-top:4px">
          <span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border-radius:50%;background:${st.color};color:#fff;font-size:13px;margin-right:8px">${st.icon}</span>
          ${taskLabel(task.type)} ${st.label.toLowerCase()}
        </div>
      </td></tr>
      <tr><td style="padding:6px 8px 14px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${row('Estado', `<span style="color:${st.color}">${st.label}</span>`)}
          ${row('Tipo de tarea', taskLabel(task.type))}
          ${row('Máquina / objetivo', target)}
          ${row('Servidor PBS', hostName || '—')}
          ${row('Usuario', task.user || '—')}
          ${row('Inicio', fmtDate(task.starttime))}
          ${row('Fin', fmtDate(task.endtime))}
          ${row('Duración', fmtDur(task.starttime, task.endtime))}
          ${row('Resultado', `<code style="font-size:12px;color:${st.kind === 'fail' ? st.color : '#1b2430'}">${escapeHtml(task.status || '—')}</code>`)}
        </table>
      </td></tr>
      <tr><td style="padding:12px 22px;background:#f7f9fc;border-top:1px solid #eef1f5;color:#8b95a3;font-size:11.5px">
        Enviado por PBI · ${fmtDate(Math.floor(Date.now() / 1000))}
      </td></tr>
    </table>
  </td></tr></table></body></html>`;

  const text = [
    `PBI — ${taskLabel(task.type)} ${st.label}`,
    `Estado:    ${st.label} (${task.status || '—'})`,
    `Objetivo:  ${target}`,
    `Servidor:  ${hostName || '—'}`,
    `Inicio:    ${fmtDate(task.starttime)}`,
    `Fin:       ${fmtDate(task.endtime)}`,
    `Duración:  ${fmtDur(task.starttime, task.endtime)}`,
  ].join('\n');

  return { subject, html, text };
}

/** Email de prueba. */
export function buildTestEmail({ hostName } = {}) {
  const sample = {
    type: 'backup', id: 'k0homenas:vm/103', user: 'root@pam',
    starttime: Math.floor(Date.now() / 1000) - 184, endtime: Math.floor(Date.now() / 1000), status: 'OK',
  };
  const m = buildTaskEmail(sample, { hostName: hostName || 'PBS (prueba)', names: { 103: 'hbm-Server' } });
  return { ...m, subject: '[PBI] Email de prueba ✅' };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

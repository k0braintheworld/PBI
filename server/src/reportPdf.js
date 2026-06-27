import PDFDocument from 'pdfkit';
import { calendarWeeks, CAL_COLORS } from './reportService.js';

/**
 * Renderiza el informe de copias a PDF (A4) a partir del objeto de datos `r`
 * de reportService.computeReport. Devuelve un Buffer.
 */

const C = {
  dark: '#131c28', orange: '#e8730c', text: '#1b2430', muted: '#6b7685',
  ok: '#157a42', warn: '#a06806', err: '#b62a25', line: '#e8edf3',
  soft: '#f7f9fc', white: '#ffffff',
};

const fmtBytes = (n) => {
  if (n == null) return '—';
  const u = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']; let i = 0; let v = Number(n);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
};
const dt = (e) => (e ? new Date(e * 1000).toLocaleString('es-ES') : '—');
const d = (e) => (e ? new Date(e * 1000).toLocaleDateString('es-ES') : '—');

export function renderPdf(r) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const M = 40;
    const W = doc.page.width;      // 595.28
    const CW = W - M * 2;          // ancho de contenido
    const bottom = doc.page.height - 46;

    // --- Cabecera (banda oscura a sangre) ---
    doc.rect(0, 0, W, 96).fill(C.dark);
    doc.fillColor(C.orange).font('Helvetica-Bold').fontSize(9).text('PBI', M, 22, { characterSpacing: 1 });
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(19).text(r.title, M, 36);
    doc.fillColor('#9fabbb').font('Helvetica').fontSize(10).text(`Periodo: ${d(r.from)} – ${d(r.to)}`, M, 64);
    if (r.sede) {
      doc.fillColor('#9fabbb').fontSize(8).text('SEDE', W - M - 180, 24, { width: 180, align: 'right', characterSpacing: 1 });
      doc.fillColor(C.white).font('Helvetica-Bold').fontSize(14).text(r.sede, W - M - 180, 36, { width: 180, align: 'right' });
    }
    if (r.hostName) doc.fillColor('#7e8b9c').font('Helvetica').fontSize(9).text(r.hostName, W - M - 180, 64, { width: 180, align: 'right' });

    let y = 104;

    // --- Metadatos de auditoría ---
    if (r.meta) {
      const m = r.meta;
      const parts = [];
      if (m.reportId) parts.push(`Informe nº: ${m.reportId}`);
      if (m.emittedAt) parts.push(`Emitido: ${m.emittedAt}`);
      if (m.generatedBy) parts.push(`Generado por: ${m.generatedBy}`);
      if (m.responsable) parts.push(`Responsable: ${m.responsable}`);
      if (parts.length) {
        doc.roundedRect(M, y, CW, 20, 5).fillAndStroke(C.soft, C.line);
        doc.fillColor(C.muted).font('Helvetica').fontSize(8.5).text(parts.join('    ·    '), M + 10, y + 6, { width: CW - 20 });
        y += 28;
      }
    }

    // --- KPIs ---
    const okColor = r.successRate >= 95 ? C.ok : r.successRate >= 80 ? C.warn : C.err;
    const kpis = [
      { v: String(r.backups), l: 'Copias realizadas', c: C.text },
      { v: `${r.successRate}%`, l: 'Tasa de éxito', c: okColor },
      { v: String(r.failCount), l: 'Con fallo', c: r.failCount ? C.err : C.ok },
      { v: fmtBytes(r.totalUsed), l: 'Datos almacenados', c: C.text },
    ];
    const gap = 10;
    const bw = (CW - gap * 3) / 4;
    kpis.forEach((k, i) => {
      const x = M + i * (bw + gap);
      doc.roundedRect(x, y, bw, 56, 8).fillAndStroke(C.soft, C.line);
      doc.fillColor(k.c).font('Helvetica-Bold').fontSize(19).text(k.v, x + 12, y + 12, { width: bw - 24, ellipsis: true });
      doc.fillColor(C.muted).font('Helvetica').fontSize(8).text(k.l.toUpperCase(), x + 12, y + 38, { width: bw - 24, characterSpacing: .3 });
    });
    y += 56 + 22;

    // --- Alcance del informe ---
    {
      const scopeStr = (r.scope || []).map((s) => `${s.vmid}${s.name ? ` (${s.name})` : ''}`).join(' · ');
      doc.fillColor(C.text).font('Helvetica-Bold').fontSize(12).text('Alcance del informe', M, y);
      y += 15;
      doc.fillColor(C.muted).font('Helvetica').fontSize(9.5)
        .text(`${(r.scope || []).length || '—'} máquina(s): ${scopeStr || 'todas las máquinas con copias en el periodo'}`, M, y, { width: CW });
      y = doc.y + 12;
    }

    // --- Calendario de copias ---
    const weeks = calendarWeeks(r.calendar);
    if (weeks.length) {
      const rowH = 26;
      const needed = 20 + 14 + weeks.length * rowH + 26;
      if (y + needed > bottom) { doc.addPage(); y = 50; }
      const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
      doc.fillColor(C.text).font('Helvetica-Bold').fontSize(13).text(`Calendario de copias · ${cap(r.monthLabel)}`, M, y);
      y += 20;
      const colW = CW / 7;
      const wd = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
      doc.font('Helvetica-Bold').fontSize(8).fillColor(C.muted);
      wd.forEach((w, i) => doc.text(w, M + i * colW, y, { width: colW, align: 'center' }));
      y += 14;
      for (const week of weeks) {
        week.forEach((c, ci) => {
          if (!c) return;
          doc.font('Helvetica').fontSize(7.5).fillColor('#9aa3b0').text(String(c.day), M + ci * colW, y, { width: colW, align: 'center' });
          const cx = M + ci * colW + colW / 2;
          doc.circle(cx, y + 15, 6);
          if (c.status === 'none') doc.fillAndStroke('#eef2f7', '#dde3ec'); else doc.fill(CAL_COLORS[c.status]);
        });
        y += rowH;
      }
      // Leyenda
      y += 2;
      let lx = M;
      doc.font('Helvetica').fontSize(9);
      for (const [k, l] of [['ok', 'Correcta'], ['partial', 'Parcial'], ['failed', 'Con fallo'], ['none', 'Sin copia']]) {
        doc.circle(lx + 4, y + 5, 4);
        if (k === 'none') doc.fillAndStroke('#eef2f7', '#dde3ec'); else doc.fill(CAL_COLORS[k]);
        doc.fillColor(C.muted).font('Helvetica').fontSize(9).text(l, lx + 13, y);
        lx += 13 + doc.widthOfString(l) + 18;
      }
      y += 24;
    }

    // --- Almacenamiento ---
    doc.fillColor(C.text).font('Helvetica-Bold').fontSize(13).text('Estado de almacenamiento', M, y);
    y += 22;
    for (const s of r.perDatastore) {
      const pct = s.total ? Math.round((s.used / s.total) * 100) : 0;
      const bc = pct >= 90 ? C.err : pct >= 75 ? C.warn : C.ok;
      doc.fillColor(C.text).font('Helvetica-Bold').fontSize(11).text(s.store, M, y);
      doc.fillColor(C.muted).font('Helvetica').fontSize(10).text(`${fmtBytes(s.used)} / ${fmtBytes(s.total)}  (${pct}%)`, M, y, { width: CW, align: 'right' });
      y += 16;
      doc.roundedRect(M, y, CW, 7, 3).fill(C.line);
      if (pct > 0) doc.roundedRect(M, y, Math.max(3, (CW * pct) / 100), 7, 3).fill(bc);
      y += 18;
    }
    y += 8;

    // --- Tabla por máquina ---
    doc.fillColor(C.text).font('Helvetica-Bold').fontSize(13).text('Copias por máquina', M, y);
    y += 20;

    const cols = [
      { k: 'maq', label: 'Máquina', w: 150, align: 'left' },
      { k: 'cop', label: 'Copias', w: 50, align: 'center' },
      { k: 'res', label: 'Resultado', w: 95, align: 'left' },
      { k: 'ult', label: 'Última copia', w: 110, align: 'left' },
      { k: 'tam', label: 'Tamaño', w: 60, align: 'right' },
      { k: 'ver', label: 'Verif.', w: 50, align: 'left' },
    ];
    const drawHeader = () => {
      doc.rect(M, y, CW, 20).fill(C.soft);
      let x = M;
      doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(8);
      for (const c of cols) { doc.text(c.label.toUpperCase(), x + 8, y + 6, { width: c.w - 12, align: c.align }); x += c.w; }
      y += 20;
    };
    drawHeader();

    if (!r.vms.length) {
      doc.fillColor(C.muted).font('Helvetica').fontSize(10).text('No hubo copias en el periodo.', M, y + 8, { width: CW, align: 'center' });
      y += 28;
    }
    for (const m of r.vms) {
      const snap = r.lastSnap.get(String(m.vmid));
      const verify = snap?.verification?.state;
      const name = r.names[String(m.vmid)] ? ` · ${r.names[String(m.vmid)]}` : '';
      // Altura de fila dinámica según el nombre de la máquina (evita solapes)
      doc.font('Helvetica').fontSize(9.5);
      const rowH = Math.max(20, doc.heightOfString(`${m.vmid}${name}`, { width: cols[0].w - 12 }) + 8);
      if (y + rowH > bottom) { doc.addPage(); y = 50; drawHeader(); }
      let x = M;
      // Máquina
      doc.fillColor(C.text).font('Helvetica-Bold').text(String(m.vmid), x + 8, y + 6, { width: cols[0].w - 12, continued: true })
        .fillColor(C.muted).font('Helvetica').text(name, { width: cols[0].w - 12 });
      x += cols[0].w;
      // Copias
      doc.fillColor(C.text).font('Helvetica').text(String(m.count), x + 8, y + 6, { width: cols[1].w - 12, align: 'center' });
      x += cols[1].w;
      // Resultado
      doc.fillColor(m.fail ? C.err : C.ok).font(m.fail ? 'Helvetica-Bold' : 'Helvetica').text(m.fail ? `${m.ok} OK / ${m.fail} fallo` : `${m.ok} OK`, x + 8, y + 6, { width: cols[2].w - 12 });
      x += cols[2].w;
      // Última copia
      doc.fillColor(C.muted).font('Helvetica').text(dt(m.last), x + 8, y + 6, { width: cols[3].w - 12 });
      x += cols[3].w;
      // Tamaño
      doc.fillColor(C.text).text(fmtBytes(snap?.size), x + 8, y + 6, { width: cols[4].w - 12, align: 'right' });
      x += cols[4].w;
      // Verif
      const vTxt = verify === 'ok' ? 'verificado' : verify === 'failed' ? 'fallido' : 'sin verif.';
      const vCol = verify === 'ok' ? C.ok : verify === 'failed' ? C.err : C.muted;
      doc.fillColor(vCol).fontSize(8.5).text(vTxt, x + 8, y + 6.5, { width: cols[5].w - 10 });
      y += rowH;
      doc.moveTo(M, y).lineTo(M + CW, y).strokeColor(C.line).lineWidth(0.5).stroke();
    }
    y += 14;

    // --- Incidencias ---
    if (y + 60 > bottom) { doc.addPage(); y = 50; }
    if (r.failures.length) {
      doc.fillColor(C.err).font('Helvetica-Bold').fontSize(13).text(`Incidencias del periodo (${r.failures.length})`, M, y);
      y += 20;
      for (const t of r.failures) {
        if (y + 16 > bottom) { doc.addPage(); y = 50; }
        doc.fillColor(C.text).font('Helvetica').fontSize(9).text(`${t.type} · ${t.id || '—'}`, M + 4, y, { width: 220, continued: false });
        doc.fillColor(C.muted).fontSize(8.5).text(dt(t.endtime), M + 230, y, { width: 110 });
        doc.fillColor(C.err).font('Helvetica').fontSize(8.5).text((t.status || '').slice(0, 70), M + 345, y, { width: CW - 345 });
        y += 15;
      }
    } else {
      doc.roundedRect(M, y, CW, 30, 8).fillAndStroke('#e6f4ec', '#bfe3cd');
      doc.fillColor(C.ok).font('Helvetica-Bold').fontSize(11).text('Sin incidencias: todas las copias del periodo finalizaron correctamente.', M + 14, y + 9, { width: CW - 28 });
      y += 30;
    }

    // --- Cumplimiento y política (solo informe a medida) ---
    if (r.meta) {
      if (y + 90 > bottom) { doc.addPage(); y = 50; }
      doc.fillColor(C.text).font('Helvetica-Bold').fontSize(13).text('Cumplimiento y política de copias', M, y);
      y += 18;
      const pc = [{ l: 'Máquina', w: 150 }, { l: 'RPO (prog.)', w: 92 }, { l: 'Retención', w: 178 }, { l: 'Modo', w: CW - 150 - 92 - 178 }];
      doc.rect(M, y, CW, 18).fill(C.soft);
      let px = M; doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(8);
      for (const c of pc) { doc.text(c.l.toUpperCase(), px + 6, y + 5, { width: c.w - 10 }); px += c.w; }
      y += 18;
      for (const s of (r.scope || [])) {
        const p = (r.policies && (r.policies[s.vmid] || r.policies['*'])) || null;
        const cells = [
          `${s.vmid}${s.name ? ` · ${s.name}` : ''}`,
          p ? p.schedule : '—',
          p ? p.retention : '—',
          p ? p.mode : '—',
        ];
        // Altura de fila dinámica: la de la celda más alta (evita solapes al partir línea)
        doc.font('Helvetica').fontSize(9);
        const rowH = Math.max(14, ...cells.map((txt, i) => doc.heightOfString(String(txt), { width: pc[i].w - 10 }))) + 8;
        if (y + rowH > bottom) { doc.addPage(); y = 50; }
        px = M;
        doc.fillColor(C.text).text(cells[0], px + 6, y + 4, { width: pc[0].w - 10 }); px += pc[0].w;
        doc.fillColor(C.muted);
        doc.text(cells[1], px + 6, y + 4, { width: pc[1].w - 10 }); px += pc[1].w;
        doc.text(cells[2], px + 6, y + 4, { width: pc[2].w - 10 }); px += pc[2].w;
        doc.text(cells[3], px + 6, y + 4, { width: pc[3].w - 10 });
        y += rowH; doc.moveTo(M, y).lineTo(M + CW, y).strokeColor(C.line).lineWidth(0.5).stroke();
      }
      y += 10;
      const off = r.offsite;
      const fact = (t) => { if (y + 14 > bottom) { doc.addPage(); y = 50; } doc.font('Helvetica').fontSize(9).fillColor(C.muted).text(t, M, y, { width: CW }); y = doc.y + 3; };
      fact(`Cifrado de las copias: ${r.encryption?.encrypted ? 'Sí' : 'No'}`);
      fact(`Copia externa (3-2-1): ${off && off.configured ? `Sí${off.remotes && off.remotes.length ? ` (${off.remotes.join(', ')})` : ''}` : 'No configurada'}`);
      fact(`Última prueba de restauración: ${r.meta.restoreTest || 'no registrada'}`);
      fact('Controles: ISO/IEC 27001:2022 — 8.13 · ENS (RD 311/2022) — mp.info.6');
      y += 8;
      if (y + 24 > bottom) { doc.addPage(); y = 50; }
      doc.moveTo(M, y).lineTo(M + CW, y).strokeColor(C.line).lineWidth(0.5).stroke(); y += 10;
      doc.fillColor(C.muted).font('Helvetica').fontSize(9).text(`Responsable: ${r.meta.responsable || '____________________'}`, M, y, { width: CW * 0.55 });
      doc.text('Firma: ____________________     Fecha: __________', M + CW * 0.45, y, { width: CW * 0.55, align: 'right' });
      y += 16;
    }

    // --- Declaración de cumplimiento ---
    if (y + 50 > bottom) { doc.addPage(); y = 50; }
    y += 6;
    doc.fillColor(C.muted).font('Helvetica').fontSize(8.5).text(
      'Declaración: este informe refleja el estado y la evidencia de las copias de seguridad gestionadas mediante '
      + 'Proxmox Backup Server para el periodo y alcance indicados, a efectos de cumplimiento (ISO/IEC 27001, ENS). '
      + 'Los datos proceden directamente de los registros del sistema de copia de seguridad.',
      M, y, { width: CW, align: 'justify' });

    // --- Pie con numeración en cada página ---
    const gen = `Informe generado por PBI${r.sede ? ` · Sede ${r.sede}` : ''} · ${dt(Math.floor(Date.now() / 1000))}`;
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const fy = doc.page.height - 30;
      doc.fillColor(C.muted).font('Helvetica').fontSize(8).text(gen, M, fy, { width: CW - 80, align: 'left', lineBreak: false });
      doc.fillColor(C.muted).font('Helvetica').fontSize(8).text(`Página ${i - range.start + 1} de ${range.count}`, M, fy, { width: CW, align: 'right' });
    }

    doc.end();
  });
}

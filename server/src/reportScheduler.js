// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import * as reportStore from './reportStore.js';
import * as notifyStore from './notifyStore.js';
import { sendReport } from './reportRunner.js';

/**
 * Programador del informe periódico. Comprueba cada pocos minutos si toca
 * enviar (según frecuencia, día y hora) y no se ha enviado ya este periodo.
 * Robusto a reinicios gracias a la marca persistente state.lastSent.
 */

const TICK_MS = 5 * 60 * 1000;
let timer = null;
let busy = false;

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

function dueInfo(cfg, now) {
  const hour = Number(cfg.hour) || 8;
  if (cfg.frequency === 'daily') {
    return { due: now.getHours() >= hour, key: ymd(now) };
  }
  if (cfg.frequency === 'weekly') {
    const jsWeekday = now.getDay() === 0 ? 7 : now.getDay(); // 1=lun … 7=dom
    return { due: jsWeekday === (Number(cfg.weekday) || 1) && now.getHours() >= hour, key: ymd(now) };
  }
  // monthly: el día configurado (o después, por si se reinició) y a partir de la hora
  const dom = Number(cfg.dayOfMonth) || 1;
  const due = (now.getDate() > dom) || (now.getDate() === dom && now.getHours() >= hour);
  return { due, key: ym(now) };
}

async function tick() {
  if (busy) return;
  busy = true;
  try {
    const cfg = reportStore.getRaw();
    if (!cfg.enabled) return;
    const smtp = notifyStore.getRaw().smtp;
    if (!smtp.host || !(cfg.to || smtp.to)) return;

    const now = new Date();
    const { due, key } = dueInfo(cfg, now);
    // Primera vez tras activarlo: fija línea base y no envía de golpe el periodo en curso.
    if (cfg.state?.lastSent == null) { reportStore.setState({ lastSent: key }); return; }
    if (!due) return;
    if (cfg.state?.lastSent === key) return; // ya enviado este periodo

    await sendReport(cfg);
    reportStore.setState({ lastSent: key });
    console.log(`[informe] enviado (${cfg.frequency}, periodo ${key})`);
  } catch (e) {
    console.error('[informe] error programando/enviando:', e.message);
  } finally {
    busy = false;
  }
}

export function startReportScheduler() {
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  setTimeout(tick, 15000);
  console.log('  Informe periódico: programador activo');
}

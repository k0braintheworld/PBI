// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeTargetUrl, isLinkLocalHost } from '../src/netGuard.js';

test('bloquea el rango link-local de metadatos', () => {
  assert.ok(isLinkLocalHost('169.254.169.254'));
  assert.ok(isLinkLocalHost('169.254.0.1'));
  assert.ok(isLinkLocalHost('fe80::1'));
  assert.throws(() => assertSafeTargetUrl('http://169.254.169.254/latest/meta-data'), /link-local|metadatos/i);
});

test('rechaza esquemas que no sean http/https', () => {
  assert.throws(() => assertSafeTargetUrl('file:///etc/passwd'));
  assert.throws(() => assertSafeTargetUrl('gopher://x'));
  assert.throws(() => assertSafeTargetUrl(''));
});

test('permite LAN privada, loopback y dominios (Proxmox legítimo)', () => {
  assert.doesNotThrow(() => assertSafeTargetUrl('https://192.168.1.10:8007'));
  assert.doesNotThrow(() => assertSafeTargetUrl('https://10.0.0.5:8007'));
  assert.doesNotThrow(() => assertSafeTargetUrl('https://127.0.0.1:8007'));
  assert.doesNotThrow(() => assertSafeTargetUrl('https://pbs.midominio.com:8007'));
  assert.equal(isLinkLocalHost('192.168.1.10'), false);
});

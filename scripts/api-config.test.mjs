import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPreviewHost, apiBase, turnstileSiteKey } from '../js/api-config.js';

const PREVIEW_HOST = 'your-firebase-project--pr1-feat-reservas-abc.web.app';
const PROD_API = 'https://your-worker.your-account.workers.dev';
const PREVIEW_API = 'https://your-worker-preview.your-account.workers.dev';

test('isPreviewHost: solo el host con "--"', () => {
  assert.equal(isPreviewHost(PREVIEW_HOST), true);
  assert.equal(isPreviewHost('your-firebase-project.web.app'), false);
  assert.equal(isPreviewHost('localhost'), false);
});

test('apiBase: preview, producción y local', () => {
  assert.equal(apiBase(PREVIEW_HOST), PREVIEW_API);
  assert.equal(apiBase('your-firebase-project.web.app'), PROD_API);
  assert.equal(apiBase('localhost'), 'http://localhost:8787');
  assert.equal(apiBase('127.0.0.1'), 'http://localhost:8787');
});

test('turnstileSiteKey: clave propia solo en preview', () => {
  assert.equal(turnstileSiteKey(PREVIEW_HOST), 'YOUR_TURNSTILE_SITE_KEY');
  assert.equal(turnstileSiteKey('localhost'), '1x00000000000000000000AA');
  assert.equal(turnstileSiteKey('your-firebase-project.web.app'), '1x00000000000000000000AA');
});

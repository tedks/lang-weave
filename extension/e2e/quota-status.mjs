// Real Chromium MV3/storage/popup with synthetic provider responses and an owned rejecting network sink.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = await mkdtemp(join(tmpdir(), 'spanish-weave-quota-'));
const extension = join(scratch, 'extension');
const profile = join(scratch, 'profile');
const sinkHits = [];
const modelSinkHits = () => sinkHits.filter((hit) => hit.includes('generativelanguage.googleapis.com'));
const originHits = [];
const origin = createServer((request, response) => {
  originHits.push(request.url);
  response.writeHead(200, { 'Content-Type': 'text/plain' });
  response.end('owned positive control');
});
const sink = createServer((request, response) => {
  sinkHits.push(request.url);
  response.destroy();
});
sink.on('connect', (request, socket) => {
  sinkHits.push(request.url);
  socket.destroy();
});
const listen = async (server) => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
};
let browser;
try {
  const originPort = await listen(origin);
  const sinkPort = await listen(sink);
  await cp(join(root, 'src'), join(extension, 'src'), { recursive: true });
  await cp(join(root, 'icons'), join(extension, 'icons'), { recursive: true }); // the manifest names them; Chrome refuses to load without
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push(...manifest.optional_host_permissions); // isolated test grant
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  const args = [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
    '--host-resolver-rules=MAP generativelanguage.googleapis.com ~NOTFOUND, MAP probe.weave.test 127.0.0.1',
    `--proxy-server=127.0.0.1:${sinkPort}`];
  const launch = () => chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args });
  const route = (context) => context.route('https://reading.example/**', (request) => request.fulfill({
    contentType: 'text/html', body: `<!doctype html><title>Ordinary reading</title><main><p>
      We read books and enjoy quiet evenings every week.
    </p></main>`,
  }));

  browser = await launch();
  await route(browser);
  let worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  await worker.evaluate(async () => {
    globalThis.syntheticCalls = 0;
    const original = fetch;
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) return original(url, init);
      if (init.headers['x-goog-api-key'] !== 'synthetic-quota-key') throw new Error('Wrong synthetic key');
      globalThis.syntheticCalls++;
      return new Response(JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED',
        message: 'secret page text and synthetic-quota-key must never be stored',
        details: [
          { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [
            { quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' },
          ] },
          { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '3600s' },
        ] } }), { status: 429, headers: { 'Content-Type': 'application/json' } });
    };
    for (let i = 0; i < 100 && !(await chrome.storage.local.get('settings')).settings; i++)
      await new Promise((done) => setTimeout(done, 10));
    await chrome.storage.local.set({ apiKey: 'synthetic-quota-key', consentShown: true });
  });
  const page = await browser.newPage();
  await page.goto('https://reading.example/first');
  await assert.doesNotReject(async () => {
    for (let attempt = 0; attempt < 80; attempt++) {
      if ((await worker.evaluate(() => chrome.storage.local.get('modelStatus'))).modelStatus?.category === 'daily_quota') return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Synthetic daily status was not stored');
  });
  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${id}/src/popup.html`);
  await popup.waitForFunction(() => /daily|quota/i.test(document.querySelector('#operation')?.textContent || ''));
  assert.equal(await worker.evaluate(() => globalThis.syntheticCalls), 1);
  assert.equal(await page.locator('.fw-word').count(), 0);
  let stored = await worker.evaluate(() => chrome.storage.local.get(null));
  assert.ok(JSON.stringify({ modelStatus: stored.modelStatus, quotaState: stored.quotaState })
    .length < 2000);
  assert.doesNotMatch(JSON.stringify({ modelStatus: stored.modelStatus, quotaState: stored.quotaState }),
    /synthetic-quota-key|secret page text|reading\.example/);
  const firstStatusAt = stored.modelStatus.at;
  const guidedRetryAt = stored.modelStatus.retryAt;
  assert.ok(guidedRetryAt > firstStatusAt);
  assert.equal(modelSinkHits().length, 0);
  await browser.close();
  browser = null;

  // Closing and reopening the same throwaway Chromium profile restarts the MV3 worker.
  // Its synthetic fetch disappears; a bad replay can reach only the owned sink.
  browser = await launch();
  await route(browser);
  worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  assert.equal(await worker.evaluate(() => 'syntheticCalls' in globalThis), false);
  const second = await browser.newPage();
  await second.goto('https://reading.example/second');
  for (let attempt = 0; attempt < 80; attempt++) {
    const observed = await worker.evaluate(() => chrome.storage.local.get('modelStatus'));
    if (observed.modelStatus?.at > firstStatusAt) break;
    if (attempt === 79) throw new Error('Restarted worker did not process the second page');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(await second.locator('.fw-word').count(), 0);
  assert.equal(modelSinkHits().length, 0, 'persisted cooldown should stop dispatch after worker restart');
  const restartedPopup = await browser.newPage();
  await restartedPopup.goto(`chrome-extension://${id}/src/popup.html`);
  await restartedPopup.waitForFunction(() => /daily|quota/i.test(document.querySelector('#operation')?.textContent || ''));
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('modelStatus'))).modelStatus.retryAt, guidedRetryAt);
  const review = await browser.newPage();
  await review.goto(`chrome-extension://${id}/src/review.html`);
  await review.locator('#counts').getByText(/available to add/).waitFor();
  assert.equal(modelSinkHits().length, 0, 'local review remains offline');

  await worker.evaluate(() => {
    globalThis.recoveryCalls = 0;
    const original = fetch;
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) return original(url, init);
      if (init.headers['x-goog-api-key'] !== 'replacement-synthetic-key') throw new Error('Old key used');
      globalThis.recoveryCalls++;
      const items = JSON.parse(JSON.parse(init.body).contents[0].parts[0].text.replace(/^Passages:\n/, ''));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({
        passages: items.map(({ id, text }) => ({ id, swaps: text.includes(' and ')
          ? [{ o: 'and', f: 'y', g: 'and', h: '', ctx: '' }] : [] })),
      }) }] } }] }), { headers: { 'Content-Type': 'application/json' } });
    };
  });
  assert.deepEqual(await restartedPopup.evaluate(() => chrome.runtime.sendMessage({
    type: 'save', apiKey: 'replacement-synthetic-key',
  })), { ok: true });
  await second.reload();
  try { await second.locator('.fw-word').first().waitFor({ timeout: 5000 }); }
  catch {
    const diagnostic = { calls: await worker.evaluate(() => globalThis.recoveryCalls),
      status: (await worker.evaluate(() => chrome.storage.local.get('modelStatus'))).modelStatus,
      words: await second.locator('.fw-word').count(), modelSinkHits: modelSinkHits().length };
    throw new Error(`Synthetic replacement did not restore reading: ${JSON.stringify(diagnostic)}`);
  }
  assert.ok(await worker.evaluate(() => globalThis.recoveryCalls) >= 1);
  stored = await worker.evaluate(() => chrome.storage.local.get(null));
  assert.doesNotMatch(JSON.stringify({ modelStatus: stored.modelStatus, quotaState: stored.quotaState }),
    /synthetic-quota-key|replacement-synthetic-key|secret page text/);
  assert.equal(modelSinkHits().length, 0);
  const probe = await worker.evaluate(async (port) => {
    const positive = await (await fetch(`http://127.0.0.1:${port}/good`)).text();
    let denied = false;
    try { await fetch(`http://probe.weave.test:${port}/blocked`); } catch { denied = true; }
    let tlsDenied = false;
    try { await fetch(`https://probe.weave.test:${port}/blocked`); } catch { tlsDenied = true; }
    return { positive, denied, tlsDenied };
  }, originPort);
  assert.deepEqual(probe, { positive: 'owned positive control', denied: true, tlsDenied: true });
  assert.ok(originHits.includes('/good'));
  assert.equal(originHits.includes('/blocked'), false);
  assert.ok(sinkHits.some((hit) => hit.includes('probe.weave.test')));
  console.log('PASS: synthetic daily 429 status and bounded persistence, real MV3/profile restart without model replay, offline review, key replacement recovery, and owned HTTP/HTTPS sink controls; no live Gemini.');
} finally {
  try { if (browser) await browser.close(); } finally {
    for (const server of [origin, sink]) if (server.listening) server.closeAllConnections();
    await Promise.all([origin, sink].filter((server) => server.listening)
      .map((server) => new Promise((resolve) => server.close(resolve))));
    await rm(scratch, { recursive: true, force: true });
  }
}

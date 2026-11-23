// Isolated real MV3 Chromium with a synthetic Gemini reply and throwaway profile.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, chromiumBinary, extensionRoot, grantReadingSite, waitForExtensionWorker } from './browser.mjs';
import { closedShadow } from './closed-shadow.js';
const { cleanPack } = await import(pathToFileURL(join(extensionRoot, 'src', 'languages.js')).href);
const { initialState, intervalDays } = await import(pathToFileURL(join(extensionRoot, 'src', 'fsrs.js')).href);

const scratch = await mkdtemp(join(tmpdir(), 'lang-weave-gradual-'));
const extension = extensionRoot;
let browser;
try {
  browser = await chromium.launchPersistentContext(join(scratch, 'profile'), {
    ...chromiumBinary, headless: true,
    // A restarted MV3 worker loses the synthetic fetch; DNS must then fail
    // closed instead of sending the throwaway prompt to the real endpoint.
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--host-resolver-rules=MAP generativelanguage.googleapis.com ~NOTFOUND',
      '--proxy-server=127.0.0.1:9'],
  });
  const worker = await waitForExtensionWorker(browser);
  const id = new URL(worker.url()).host;
  await worker.evaluate(async () => {
    for (let i = 0; i < 100 && !(await chrome.storage.local.get('settings')).settings; i++)
      await new Promise((done) => setTimeout(done, 10));
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, gradual: true, inlineRecall: true,
      newWordsPerDay: 1, newSitesEnabled: true }, apiKey: 'synthetic-gradual-key', consentShown: true });
    globalThis.calls = [];
    globalThis.inlineActions = [];
    chrome.runtime.onMessage.addListener(({ type }) => {
      if (['inlineBegin', 'inlineReveal', 'inlineRate'].includes(type)) globalThis.inlineActions.push(type);
    });
    const original = fetch;
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) return original(url, init);
      if (init.headers['x-goog-api-key'] !== 'synthetic-gradual-key') throw new Error('Key mismatch');
      const body = JSON.parse(init.body);
      const passages = JSON.parse(body.contents[0].parts[0].text.replace(/^Passages:\n/, ''));
      globalThis.calls.push(...passages.map((p) => p.text));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ passages:
        passages.map(({ id, text }) => ({ id, swaps: text.includes('the idea')
          ? [{ o: 'the idea', f: 'la idea', g: 'the idea', h: '', ctx: '' }]
          : text.includes('the question') ? [{ o: 'the question', f: 'la pregunta', g: 'the question', h: '', ctx: '' }] : [] })) }) }] } }] }),
      { headers: { 'Content-Type': 'application/json' } });
    };
  });
  const html = `<!doctype html><html lang="en"><body><main>
    <p id="reading">We discussed the idea with friends every week.</p>
    <p id="reading2">We discussed the idea with neighbors every week. ${'The neighbors shared simple stories at the table. '.repeat(20)}</p>
    <p id="reading3">We discussed the idea with colleagues every week.</p>
    <p id="health">The doctor explained the idea behind my medication.</p>
    <form><p>Private form text and the idea stay here.</p><input value="private"></form>
    <p contenteditable="true">Editable the idea stays here.</p>
  </main></body></html>`;
  await grantReadingSite(browser, worker);
  await browser.route('https://reading.example/**', (route) => route.fulfill({ contentType: 'text/html',
    body: route.request().url().endsWith('/offscreen')
      ? '<main><div style="height:900px"></div><p id="offscreen">We discussed the question with friends every week.</p></main>' : html }));
  const page = await browser.newPage();
  const recall = await closedShadow(page, 'fw-recall-host');
  await page.goto('https://reading.example/one');
  const word = page.locator('#reading .fw-word');
  await word.waitFor();
  await page.waitForFunction(() => document.querySelector('#reading .fw-word')?.getAttribute('data-fr') === 'la idea');
  assert.equal(await word.getAttribute('data-fr'), 'la idea');
  assert.equal(await word.getAttribute('title'), null); // first encounter is reading, not an immediate quiz
  assert.equal(await page.locator('#health .fw-word, form .fw-word, [contenteditable] .fw-word').count(), 0);
  const first = await worker.evaluate(() => chrome.storage.local.get('recallReview').then((x) => x.recallReview));
  assert.equal(first.learning.count, 1);
  assert.ok(first.cards['la idea']);
  assert.ok((await worker.evaluate(() => globalThis.calls)).every((s) => !/doctor|Private form|Editable/.test(s)));

  await page.goto('https://reading.example/two');
  const due = page.locator('#reading .fw-word');
  await due.waitFor();
  await page.locator('#reading2 .fw-word').waitFor();
  await page.locator('#reading3 .fw-word').waitFor();
  assert.equal(await due.getAttribute('title'), null); // same local day is still reading, not a quiz
  assert.equal(await due.textContent(), 'la idea');
  await worker.evaluate(async () => {
    const { recallReview } = await chrome.storage.local.get('recallReview');
    recallReview.cards['la idea'].introducedDay = '2000-01-01';
    await chrome.storage.local.set({ recallReview });
  });
  await page.reload();
  await due.waitFor();
  await page.locator('#reading2 .fw-word').waitFor();
  await page.locator('#reading3 .fw-word').waitFor();
  assert.equal(await due.getAttribute('title'), 'Open inline recall');
  assert.equal(await page.locator('#reading2 .fw-word').getAttribute('title'), 'Open inline recall');
  assert.equal(await due.textContent(), 'the idea?');
  assert.equal(await due.locator('sup').getAttribute('aria-hidden'), 'true');
  assert.equal(await page.locator('.fw-practice').count(), 3);
  assert.equal(await page.locator('.fw-practice-cue').count(), 2);
  assert.equal(await page.locator('#reading3 .fw-practice-cue').count(), 0);
  assert.equal(await due.getAttribute('data-fr'), null);
  assert.equal(await due.getAttribute('data-tip'), null);
  assert.doesNotMatch(await due.evaluate((el) => el.outerHTML), /la idea/);
  await due.hover();
  await page.waitForTimeout(800); // exceeds the production 700 ms delay: an ordinary gloss would be visible
  assert.equal(await page.locator('.fw-gloss, .fw-gloss-on').count(), 0);
  await due.focus();
  await page.waitForTimeout(800);
  assert.equal(await page.locator('.fw-gloss, .fw-gloss-on').count(), 0);
  assert.equal(await page.locator('#reading').textContent(), 'We discussed the idea? with friends every week.');
  await due.evaluate((span) => {
    span.click();
    span.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  assert.equal(await recall.locator('.fw-recall').count(), 0); // page script cannot open a ticket
  const recallEffects = () => worker.evaluate(async () => ({
    storage: await chrome.storage.local.get(['recallReview', 'learningRetrievals']),
    actions: globalThis.inlineActions,
    modelCalls: globalThis.calls.length,
  }));
  const beforeDirtyCue = await recallEffects();
  await due.evaluate((span) => {
    span.setAttribute('data-en', 'forged cue');
    window.recallInput = [];
    for (const type of ['click', 'keydown']) {
      span.addEventListener(type, (event) => window.recallInput.push([event.type, event.isTrusted]), { once: true });
    }
  });
  await due.click();
  await due.press('Enter');
  assert.deepEqual(await page.evaluate(() => window.recallInput), [['click', true], ['keydown', true]]);
  assert.equal(await recall.locator('.fw-recall').count(), 0, 'edited cue must reject even trusted input');
  assert.deepEqual(await recallEffects(), beforeDirtyCue, 'edited cue must create no ticket, retrieval or model call');
  assert.equal(await due.getAttribute('data-en'), 'forged cue', 'the host edit stays in place');

  await page.reload();
  await due.waitFor();
  assert.equal(await due.getAttribute('title'), 'Open inline recall');
  await due.press('Enter');
  await recall.locator('.fw-recall').waitFor();
  assert.match(await recall.locator('.fw-recall').textContent(), /Recall the translation/);
  await recall.locator('.fw-recall button', { hasText: 'Reveal answer' }).waitFor();
  assert.deepEqual((await recallEffects()).actions, [...beforeDirtyCue.actions, 'inlineBegin']);
  assert.equal(await recall.locator('.fw-recall button', { hasText: 'Reveal answer' }).evaluate((el) => el.getRootNode().activeElement === el), true);
  await recall.locator('.fw-recall button', { hasText: 'Reveal answer' }).clickUntrusted();
  assert.equal(await recall.locator('.fw-recall button', { hasText: 'Easy' }).count(), 0);
  await recall.locator('.fw-recall button', { hasText: 'Reveal answer' }).click();
  await recall.locator('.fw-recall button', { hasText: 'Already know' }).waitFor();
  assert.deepEqual(await recall.locator('.fw-recall-ratings button').allTextContents(), ['Again', 'Hard', 'Medium', 'Easy']);
  assert.equal(await recall.locator('.fw-recall-secondary button').textContent(), 'Already know');
  const actualRow = await recall.locator('.fw-recall-ratings').evaluate((row) => ({
    columns: getComputedStyle(row).gridTemplateColumns.split(' ').length,
    tops: [...row.children].map((button) => Math.round(button.getBoundingClientRect().top)),
  }));
  assert.equal(actualRow.columns, 4);
  assert.equal(new Set(actualRow.tops).size, 1);
  await recall.locator('.fw-recall button', { hasText: 'Already know' }).clickUntrusted();
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('recallReview').then((x) => x.recallReview))).cards['la idea'].familiar, undefined);
  await recall.locator('.fw-recall button', { hasText: 'Dismiss' }).click();
  assert.equal(await recall.locator('.fw-recall').count(), 0);
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('recallReview').then((x) => x.recallReview))).cards['la idea'].reviews, 0);
  await due.click();
  await recall.locator('.fw-recall').waitFor();
  await due.evaluate((span) => span.remove());
  await recall.locator('.fw-recall button', { hasText: 'Reveal answer' }).click();
  await recall.locator('.fw-recall').waitFor({ state: 'detached', timeout: 2000 });
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('recallReview').then((x) => x.recallReview))).cards['la idea'].reviews, 0);
  await page.reload();
  await due.waitFor();
  await due.click();
  await recall.locator('.fw-recall button', { hasText: 'Reveal answer' }).click();
  await due.evaluate((span) => span.remove());
  await recall.locator('.fw-recall button', { hasText: 'Easy' }).click();
  await recall.locator('.fw-recall').waitFor({ state: 'detached', timeout: 2000 });
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('recallReview').then((x) => x.recallReview))).cards['la idea'].reviews, 0);
  await page.reload();
  await due.waitFor();
  await due.click();
  await recall.locator('.fw-recall button', { hasText: 'Reveal answer' }).click();
  await recall.locator('.fw-recall button', { hasText: 'Easy' }).waitFor();
  const beforeDirtyRating = await recallEffects();
  assert.equal(beforeDirtyRating.actions.at(-1), 'inlineReveal');
  await due.evaluate((span) => span.setAttribute('data-en', 'forged after reveal'));
  await recall.locator('.fw-recall button', { hasText: 'Easy' }).click();
  await recall.locator('.fw-recall').waitFor({ state: 'detached' });
  await page.waitForTimeout(300); // detaching the panel need not wait for queued worker messages
  assert.deepEqual(await recallEffects(), beforeDirtyRating, 'edited span must reject a rating without writing or sending');

  await page.reload();
  await due.waitFor();
  await due.click();
  await recall.locator('.fw-recall button', { hasText: 'Reveal answer' }).click();
  await recall.locator('.fw-recall button', { hasText: 'Easy' }).waitFor();
  assert.deepEqual((await recallEffects()).actions, [...beforeDirtyRating.actions, 'inlineBegin', 'inlineReveal'],
    'the next intact cue sends only its own open and reveal');
  console.log('Recall ownership: trusted click and Enter on the edited cue send no inline action; edited post-reveal rating closes with no effects.');
  const canFailWrite = await worker.evaluate(() => {
    const original = chrome.storage.local.set;
    const failOnce = (...args) => {
      if (Object.hasOwn(args[0], 'recallReview')) {
        chrome.storage.local.set = original;
        return Promise.reject(new Error('Synthetic rating storage failure'));
      }
      return original.call(chrome.storage.local, ...args);
    };
    chrome.storage.local.set = failOnce;
    return chrome.storage.local.set === failOnce;
  });
  assert.equal(canFailWrite, true);
  await recall.locator('.fw-recall button', { hasText: 'Easy' }).click();
  await recall.locator('.fw-recall-status').waitForText(/Rating was not saved/);
  assert.equal(await recall.locator('.fw-recall button:disabled').count(), 0);
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('recallReview').then((x) => x.recallReview))).cards['la idea'].reviews, 0);
  const secondTab = await browser.newPage();
  const secondRecall = await closedShadow(secondTab, 'fw-recall-host');
  await secondTab.goto('https://reading.example/second-tab');
  const secondCue = secondTab.locator('#reading .fw-word');
  await secondCue.waitFor();
  await secondTab.waitForFunction(() => document.querySelector('#reading .fw-word')?.getAttribute('title') === 'Open inline recall');
  await secondCue.click();
  await secondRecall.locator('.fw-recall button', { hasText: 'Reveal answer' }).click();
  await secondRecall.locator('.fw-recall button', { hasText: 'Easy' }).waitFor();
  const concurrent = await worker.evaluate(() => chrome.storage.local.get('recallReview').then((x) => x.recallReview.inline));
  assert.equal(concurrent.length, 2, 'two tabs hold independent inline tickets');
  assert.equal(new Set(concurrent.map(({ tabId }) => tabId)).size, 2);
  const callsBeforeRating = (await worker.evaluate(() => globalThis.calls)).length;
  await recall.locator('.fw-recall button', { hasText: 'Easy' }).click();
  await recall.locator('.fw-recall').waitFor({ state: 'detached' });
  const rated = await worker.evaluate(() => chrome.storage.local.get('recallReview').then((x) => x.recallReview));
  assert.equal(rated.cards['la idea'].reviews, 1);
  await secondRecall.locator('.fw-recall button', { hasText: 'Easy' }).click();
  await secondRecall.locator('.fw-recall-status').waitForText(/Rating was not saved/);
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('recallReview').then((x) => x.recallReview))).cards['la idea'].reviews, 1);
  await secondTab.close();
  assert.equal(rated.cards['la idea'].interval, intervalDays(initialState('easy').stability));
  await page.waitForFunction(() => {
    const span = document.querySelector('#reading .fw-word');
    return span && span.textContent === 'la idea' && span.getAttribute('title') !== 'Open inline recall';
  }); // only the rated span changes, without re-requesting the whole page
  assert.equal(await due.getAttribute('data-en'), 'the idea');
  assert.equal(await due.evaluate((span) => document.activeElement === span), true);
  assert.equal(await page.locator('#reading2 .fw-word').getAttribute('title'), null);
  assert.equal(await page.locator('#reading2 .fw-word').textContent(), 'la idea');
  assert.equal(await page.locator('#reading3 .fw-word').textContent(), 'la idea');
  assert.equal(await page.locator('.fw-practice-cue').count(), 0);
  assert.equal(await page.locator('#reading3 .fw-word').getAttribute('role'), 'button');
  await page.waitForTimeout(750); // catches an unintended content flush after a full-page refresh
  assert.equal((await worker.evaluate(() => globalThis.calls)).length, callsBeforeRating);
  const review = await browser.newPage();
  await review.goto(`chrome-extension://${id}/src/review.html`);
  await review.locator('#counts').getByText(/0 due/).waitFor();
  assert.equal(await review.locator('#question').isHidden(), true);
  // A settings change refreshes an open Review tab. Its queue snapshot can
  // overwrite a direct fixture reset made outside the worker's write queue.
  await review.close();

  // The current page has exhausted its one-word allowance. With no due
  // anchor in this passage, local selection skips the model entirely; the
  // same passage is reconsidered after local-day rollover.
  await page.evaluate(() => {
    const p = document.createElement('p'); p.id = 'question';
    p.textContent = 'We discussed the question with friends every week.';
    document.querySelector('main').append(p);
  });
  await page.waitForTimeout(1500); // bounded observation for a delayed unwanted model call
  assert.equal(await worker.evaluate(() => globalThis.calls.some((text) => text.includes('the question'))), false);
  assert.equal(await page.locator('#question .fw-word').count(), 0);
  await worker.evaluate(async () => {
    const { recallReview } = await chrome.storage.local.get('recallReview');
    recallReview.learning.day = '2000-01-01';
    await chrome.storage.local.set({ recallReview });
  });
  await page.locator('#question').evaluate((p) => { p.textContent += ' '; }); // same normalized passage
  await page.locator('#question .fw-word').waitFor();
  await page.waitForFunction(() => document.querySelector('#question .fw-word')?.getAttribute('data-fr') === 'la pregunta');
  assert.equal(await page.locator('#question .fw-word').textContent(), 'la pregunta');

  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${id}/src/popup.html`);
  const waitReweave = async (stage) => {
    try { await page.locator('#reading .fw-word').waitFor(); }
    catch (error) {
      const settings = await worker.evaluate(async () => {
        const { settings } = await chrome.storage.local.get('settings');
        return { enabled: settings?.enabled, siteOverrides: settings?.siteOverrides };
      });
      const reading = await page.locator('#reading').evaluate((el) => ({ html: el.innerHTML,
        allWords: document.querySelectorAll('.fw-word').length }));
      console.error('REWEAVE_DEBUG', stage, JSON.stringify({ settings, reading,
        popupEnabled: await popup.locator('#enabled').isChecked() }));
      throw error;
    }
  };
  const options = await browser.newPage();
  await options.goto(`chrome-extension://${id}/src/options.html`);
  await options.locator('#gradual').uncheck();
  await page.waitForFunction(() => document.querySelector('#reading .fw-word')?.getAttribute('title') !== 'Open inline recall');
  await popup.locator('#enabled').uncheck();
  await page.waitForFunction(() => document.querySelectorAll('.fw-word').length === 0);
  assert.equal(await page.locator('#reading').textContent(), 'We discussed the idea with friends every week.');
  await popup.locator('#enabled').check();
  await popup.waitForFunction(() => chrome.storage.local.get('settings').then(({ settings }) => settings?.enabled === true));
  await waitReweave('popup enable');
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'save', siteOverride: { host: 'reading.example', enabled: false } }));
  await page.waitForFunction(() => document.querySelectorAll('.fw-word').length === 0);
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'save', siteOverride: { host: 'reading.example', enabled: true } }));
  await waitReweave('site enable');

  const pack = cleanPack({ words: Array.from({ length: 20 }, (_, i) => ({
      fr: `mot${i}`, en: `word${i}`, hint: `hint${i}`, level: i < 10 ? 1 : 2,
    })) }, 'fr');
  await worker.evaluate(async (pack) => {
    await chrome.storage.local.set({ languagePacks: { fr: pack } });
  }, pack);
  await options.reload();
  await options.locator('#language').selectOption('fr');
  await options.waitForFunction(() => document.querySelector('#language')?.value === 'fr');
  await page.waitForFunction(() => document.querySelectorAll('.fw-word').length === 0);
  assert.equal(await page.locator('#reading').textContent(), 'We discussed the idea with friends every week.');
  assert.equal(await worker.evaluate(() => chrome.storage.local.get('settings').then((x) => x.settings.language)), 'fr');
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('recallReview').then((x) => x.recallReview))).cards['la idea'].reviews, 1);
  await page.close(); // stop the earlier reading page before resetting an introduction fixture
  await options.locator('#language').selectOption('es');
  await options.locator('#gradual').check();
  await options.locator('#newWordsPerDay').selectOption('2');
  await options.waitForFunction(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    return settings?.language === 'es' && settings.gradual && settings.newWordsPerDay === 2;
  });
  const resetQuestion = () => worker.evaluate(async () => {
    const { recallReview } = await chrome.storage.local.get('recallReview');
    delete recallReview.cards['la pregunta'];
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    recallReview.learning = { day, count: 1, pending: [] };
    await chrome.storage.local.set({ recallReview });
  });
  const readReview = () => worker.evaluate(() => chrome.storage.local.get('recallReview').then((x) => x.recallReview));
  const openOffscreen = async () => {
    const page = await browser.newPage();
    await page.goto('https://reading.example/offscreen');
    const reserved = page.locator('#offscreen .fw-word');
    await reserved.waitFor();
    // In quirks mode the root element can report the document's full height.
    const face = await reserved.evaluate((span) => ({
      offscreen: span.getBoundingClientRect().top >= window.innerHeight,
      text: span.textContent, translation: span.getAttribute('data-fr'),
    }));
    assert.equal(face.offscreen, true, 'the question starts below the viewport');
    assert.equal(face.text, 'the question');
    assert.equal(face.translation, null);
    const state = await readReview();
    assert.equal(state.learning.count, 1);
    assert.equal(state.cards['la pregunta'], undefined);
    assert.deepEqual(state.learning.pending.map(({ word }) => word), ['la pregunta']);
    return { page, reserved };
  };
  const scrollAndCheckIntroduction = async ({ page, reserved }) => {
    await reserved.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('#offscreen .fw-word')?.getAttribute('data-fr') === 'la pregunta');
    const state = await readReview();
    assert.equal(state.learning.count, 2);
    assert.ok(state.cards['la pregunta']);
    // The visible span sends a separate encounter write after the acknowledgement.
    await options.waitForFunction(async () => {
      const { recallReview } = await chrome.storage.local.get('recallReview');
      return recallReview?.cards['la pregunta']?.seenCount === 1;
    }, undefined, { polling: 50, timeout: 5000 });
    await page.close();
  };
  await resetQuestion();
  const offscreen = await openOffscreen();
  await worker.evaluate(async () => {
    const { recallReview } = await chrome.storage.local.get('recallReview');
    recallReview.learning.pending[0].until = Date.now() - 1000; // recently expired, still eligible for renewal
    await chrome.storage.local.set({ recallReview });
  });
  await scrollAndCheckIntroduction(offscreen);
  await resetQuestion();
  const retry = await openOffscreen();
  await worker.evaluate(() => {
    const original = chrome.storage.local.set;
    chrome.storage.local.set = (...args) => {
      if (Object.hasOwn(args[0], 'recallReview')) {
        chrome.storage.local.set = original;
        return Promise.reject(new Error('Synthetic introduction acknowledgement failure'));
      }
      return original.call(chrome.storage.local, ...args);
    };
  });
  await scrollAndCheckIntroduction(retry);
  await worker.evaluate(async () => {
    const { recallReview } = await chrome.storage.local.get('recallReview');
    recallReview.learning.day = '2099-01-01';
    await chrome.storage.local.set({ recallReview });
  });
  await popup.reload();
  await popup.locator('#budgetRecovery').waitFor();
  assert.match(await popup.locator('#budgetWarning').textContent(), /2099-01-01/);
  const popupHeight = await popup.evaluate(() => document.body.getBoundingClientRect().height);
  assert.ok(popupHeight <= 600, `budget-recovery popup exceeds Chrome's 600px cap: ${popupHeight}px`);
  await popup.locator('#cancelBudget').click();
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('recallReview').then((x) => x.recallReview))).learning.day, '2099-01-01');
  await popup.reload();
  await popup.locator('#budgetRecovery').waitFor();
  await popup.locator('#recoverBudget').click();
  await popup.locator('#budgetRecovery').waitFor({ state: 'hidden' });
  const recovered = await worker.evaluate(() => chrome.storage.local.get('recallReview').then((x) => x.recallReview));
  assert.equal(recovered.learning.count, 0);
  assert.equal(recovered.cards['la idea'].reviews, 1);
  assert.ok(recovered.cards['la pregunta']);
  console.log('PASS: Chromium MV3 gradual introduction, persisted budget, due inline reveal/rate, detached-cue rejection, review interoperability, exclusions, off/site restoration and language isolation; Gemini synthetic.');
} finally {
  if (browser) await browser.close();
  await rm(scratch, { recursive: true, force: true });
}

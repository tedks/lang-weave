// Real MV3 Chromium gate for My words and opening review. Use the extracted beta ZIP when
// run by Bazel. All learner actions and storage stay in a fresh disposable profile.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.LANG_WEAVE_PLAYWRIGHT
  ? pathToFileURL(process.env.LANG_WEAVE_PLAYWRIGHT).href
  : 'playwright');

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = await mkdtemp(join(tmpdir(), 'lang-weave-words-'));
const unpackedBeta = process.env.LANG_WEAVE_WELCOME_EXTENSION;
const extension = unpackedBeta || join(scratch, 'extension');
let browser;
try {
  if (!unpackedBeta) {
    await cp(join(root, 'src'), join(extension, 'src'), { recursive: true });
    await cp(join(root, 'icons'), join(extension, 'icons'), { recursive: true });
    await cp(join(root, '_locales'), join(extension, '_locales'), { recursive: true });
    await writeFile(join(extension, 'manifest.json'), await readFile(join(root, 'manifest.json')));
  }
  const executablePath = process.env.LANG_WEAVE_CHROMIUM;
  const shortcutTool = process.env.LANG_WEAVE_REVIEW_XDOTOOL;
  browser = await chromium.launchPersistentContext(join(scratch, 'profile'), {
    ...(executablePath ? { executablePath } : { channel: 'chromium' }), headless: !shortcutTool, locale: 'en-US',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--host-resolver-rules=MAP * ~NOTFOUND',
      '--proxy-server=127.0.0.1:9'],
  });
  const extensionId = 'lkbkmlgogcpcacjmdmoecgacdbfddbnh';
  const isReviewWorker = (candidate) => candidate.url() === `chrome-extension://${extensionId}/src/background.js`;
  let worker = browser.serviceWorkers().find(isReviewWorker) || await browser.waitForEvent('serviceworker', isReviewWorker);
  assert.equal(await worker.evaluate(() => chrome.runtime.id), extensionId);
  const url = (page) => `chrome-extension://${extensionId}/src/${page}.html`;
  const send = (page, message) => page.evaluate((m) => chrome.runtime.sendMessage(m), message);
  const stored = () => worker.evaluate(() => chrome.storage.local.get(['recallReview', 'learningRetrievals']));
  const reviewPages = () => browser.pages().filter((page) => page.url() === url('review'));
  const tabOf = (page) => page.evaluate(() => chrome.tabs.getCurrent());
  // Count browser pages independently of the worker's discovery. Chrome 140's
  // URL-filtered tabs.query returns no matches even for our own open Review.
  const reviewTabs = () => Promise.all(reviewPages().map(tabOf));
  const grants = () => worker.evaluate(() => chrome.permissions.getAll());
  const initialGrants = await grants();
  const until = async (read, check, what) => {
    let value;
    for (let i = 0; i < 100; i++) {
      value = await read();
      if (check(value)) return value;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for ${what}`);
  };

  // Spanish is the default language; keep the settings as the worker made them, but fail loudly if not.
  const settings = await worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings);
  assert.ok(!settings?.language || settings.language === 'es', `unexpected default language ${settings?.language}`);

  const popup = await browser.newPage();
  await popup.goto(url('popup'));
  await popup.locator('#primary').getByText('Add words', { exact: true }).waitFor();
  const openedPage = async (name) => until(async () => {
    const error = await popup.locator('#notice').textContent();
    assert.equal(error, '', `popup failed to open ${name}`);
    return browser.pages().find((page) => page.url() === url(name));
  }, Boolean, `popup to open ${name}`);
  assert.deepEqual(await reviewTabs(), []);
  await popup.locator('#primary').click();
  const review = await openedPage('review');
  const { id: reviewId, windowId: reviewWindow } = await tabOf(review);
  const reviewDocument = () => worker.evaluate(async (tabId) => (await chrome.runtime.getContexts({
    contextTypes: ['TAB'], tabIds: [tabId], frameIds: [0],
  }))[0]?.documentId, reviewId);
  const waitForReview = () => until(reviewTabs, (tabs) => tabs.some((tab) => tab.id === reviewId && tab.active),
    'the same review tab to refocus');
  await review.locator('#introduce').click();
  const prompt = review.locator('#prompt');
  const answer = review.locator('#answer');
  await prompt.waitFor();
  const ratedGloss = await prompt.textContent();
  await review.locator('#reveal').click();
  await answer.waitFor();
  const rated = await answer.textContent();
  const firstOffer = (await stored()).recallReview.current;
  const documentId = await reviewDocument();
  assert.ok(documentId);
  assert.equal(firstOffer.revealed, true);
  // Restart the worker with the revealed card still on screen. The popup click
  // wakes it and must find the same document even with no in-memory tab IDs.
  const { id: popupId } = await popup.evaluate(() => chrome.tabs.getCurrent());
  const unrelated = await worker.evaluate((windowId) => chrome.tabs.create({ windowId, url: 'about:blank' }), reviewWindow);
  const otherWindow = await worker.evaluate((tabId) => chrome.windows.create({ tabId, focused: true }), popupId);
  assert.notEqual(otherWindow.id, reviewWindow);
  await popup.bringToFront();
  const cdp = await browser.newCDPSession(popup);
  const { targetInfos } = await cdp.send('Target.getTargets');
  const initialWorker = targetInfos.find((target) => target.type === 'service_worker' && target.url === worker.url());
  assert.ok(initialWorker);
  const oldWorker = worker;
  await worker.evaluate(() => { globalThis.reviewWarmWorker = true; });
  await cdp.send('Target.closeTarget', { targetId: initialWorker.targetId });
  await until(() => cdp.send('Target.getTargets'), ({ targetInfos }) =>
    targetInfos.every((target) => target.targetId !== initialWorker.targetId), 'the old review worker to stop');
  await popup.locator('#primary').click();
  await until(async () => {
    assert.equal(await popup.locator('#notice').textContent(), '');
    return (await cdp.send('Target.getTargets')).targetInfos;
  }, (targets) => targets.some((target) => target.type === 'service_worker' && target.url === oldWorker.url()),
  'the popup to wake the review worker');
  worker = browser.serviceWorkers().find((candidate) => candidate.url() === oldWorker.url()) || oldWorker;
  assert.equal(await worker.evaluate(() => globalThis.reviewWarmWorker), undefined);
  await waitForReview();
  assert.deepEqual((await reviewTabs()).map((tab) => tab.id), [reviewId]);
  assert.equal(await prompt.textContent(), ratedGloss);
  assert.equal(await answer.isVisible(), true);
  assert.equal(await answer.textContent(), rated);
  assert.equal(await reviewDocument(), documentId);
  const focusedWindow = () => worker.evaluate(async () => (await chrome.windows.getLastFocused()).id);
  if (shortcutTool) await until(focusedWindow, (id) => id === reviewWindow, 'the review window to focus');
  const neighboringTab = await worker.evaluate((tabId) => chrome.tabs.get(tabId), unrelated.id);
  assert.equal(neighboringTab.id, unrelated.id);
  assert.equal(neighboringTab.windowId, reviewWindow);
  assert.equal(neighboringTab.active, false);
  assert.deepEqual((await stored()).recallReview.current, firstOffer);
  assert.equal((await stored()).learningRetrievals?.retrievals.length ?? 0, 0);

  await review.locator('[data-rating="medium"]').click();
  const position = review.locator('#progress');
  await position.getByText(/^Card 2 of /).waitFor();
  await review.locator('#reveal').click();
  await answer.waitFor();
  const shown = async () => ({
    prompt: await prompt.textContent(),
    answer: await answer.textContent(),
    revealed: await answer.isVisible(),
    position: await position.textContent(),
    documentId: await reviewDocument(),
    saved: await stored(),
  });
  const session = await shown();
  assert.equal(session.documentId, documentId);
  assert.equal(session.saved.recallReview.current.revealed, true);
  assert.equal(session.saved.learningRetrievals.retrievals.length, 1);
  await worker.evaluate((id) => chrome.tabs.update(id, { active: true }), unrelated.id);
  await popup.locator('#primary').click();
  await waitForReview();
  assert.deepEqual((await reviewTabs()).map((tab) => tab.id), [reviewId]);
  assert.deepEqual(await shown(), session);

  if (shortcutTool) {
    // Send the real browser accelerator using the dedicated disposable X
    // display; a renderer keyboard event cannot invoke chrome.commands.
    const reviewShortcut = () => worker.evaluate(async () => (await chrome.commands.getAll())
      .find((command) => command.name === 'open-review').shortcut);
    let binding = await reviewShortcut();
    if (!binding) {
      // New Chromium versions reserve Alt+Shift+R for Reading mode.
      const shortcuts = await browser.newPage();
      await shortcuts.goto('chrome://extensions/shortcuts');
      const input = shortcuts.locator('.command-entry').filter({ hasText: 'Open Lang Weave review' }).locator('cr-shortcut-input');
      await input.getByRole('button', { name: /edit/i }).click();
      await input.getByRole('textbox').press('Control+Shift+Y');
      binding = await until(reviewShortcut, (value) => value === 'Ctrl+Shift+Y', 'the fixture review shortcut to bind');
      await shortcuts.close();
    }
    const title = 'Lang Weave review shortcut fixture';
    await popup.evaluate((title) => { document.title = title; }, title);
    execFileSync(shortcutTool, ['search', '--sync', '--onlyvisible', '--name', title, 'windowactivate', '--sync'],
      { timeout: 4000 });
    await until(focusedWindow, (id) => id === otherWindow.id, 'the shortcut source window to focus');
    execFileSync(shortcutTool, ['key', '--clearmodifiers', binding.toLowerCase()], { timeout: 4000 });
    await until(focusedWindow, (id) => id === reviewWindow, 'the browser shortcut to focus the review window');
    assert.deepEqual((await reviewTabs()).map((tab) => tab.id), [reviewId]);
    assert.deepEqual(await shown(), session);
    console.log(`PASS: the native Open Review shortcut (${binding}) preserves the revealed card and rating session in the existing review window.`);
  }
  let data = session.saved;
  const cardIds = Object.keys(data.recallReview.cards);
  assert.equal(cardIds.length, 5);
  assert.ok(cardIds.includes(rated));
  assert.equal(data.recallReview.cards[rated].reviews, 1);
  assert.ok(data.recallReview.cards[rated].due > Date.now() + 3600000, 'the rated card is not due');
  assert.equal(data.learningRetrievals.retrievals.length, 1);
  const untouched = cardIds.filter((id) => id !== rated); // four new, due-now cards
  assert.equal(untouched.length, 4);

  // 3. The words page: count, incremental rendering, today line, strip, measurements.
  await popup.locator('#openWords').click();
  const words = await openedPage('words');
  await words.locator('#words li[data-id]').first().waitFor();
  const total = Number((await words.locator('#count').textContent()).match(/^(\d+) words$/)?.[1]);
  assert.ok(total >= 200, `count says ${await words.locator('#count').textContent()}`);
  const rendered = () => words.locator('#words li[data-id]').count();
  const first = await rendered();
  assert.ok(first > 0 && first < total, `rendered ${first} of ${total}`);
  assert.equal(await words.locator('#more').isVisible(), true);
  await words.locator('#more').click();
  assert.ok(await rendered() > first, 'Show more adds rows');
  const today = await words.locator('#today').textContent();
  assert.match(today, /5 introduced/);
  assert.match(today, /1 reviewed/);
  assert.equal(await words.locator('#strip > *').count(), 30);
  assert.equal(await words.locator('#measures > li').count(), 8);
  assert.match(await words.locator('#measures').textContent(), /Not enough data yet/);
  assert.match(await words.locator('#measures').textContent(), /Measurements skipped.*0 measurements skipped\./s);

  // 4. Search: seeded form, English gloss, accent-insensitive, arrow-key focus.
  const list = (await send(words, { type: 'wordsList' }));
  assert.equal(list.scope, 'es');
  assert.equal(list.rows.length, total);
  const row = (id) => words.locator(`#words li[data-id="${id}"]`);
  const fold = (value) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  // Filtering is synchronous on input, so the row count right after fill is already the result.
  const search = (query) => words.locator('#search').fill(query);
  await search(rated);
  await until(() => rendered(), (n) => n > 0 && n < first, 'filtered list');
  assert.equal(await row(rated).count(), 1);
  for (const text of await words.locator('#words li[data-id]').allTextContents()) {
    assert.ok(fold(text).includes(fold(rated)), `row "${text}" does not contain ${rated}`);
  }
  await words.locator('#search').focus();
  await words.keyboard.press('ArrowDown');
  assert.equal(await words.evaluate(() => document.activeElement?.matches('#words li[data-id]')), true);
  assert.equal(await words.evaluate(() => document.activeElement.querySelector('.form').textContent),
    await words.locator('#words li[data-id]').first().locator('.form').textContent());

  await search(ratedGloss); // an English gloss finds its own row
  assert.equal(await row(rated).count(), 1);
  const accented = list.rows.find((r) => /[áéíóúñü]/.test(r.target) && fold(r.target) !== r.target);
  assert.ok(accented, 'the pack has an accented form');
  await search(fold(accented.target)); // typed without the accent
  assert.equal(await row(accented.id).count(), 1, `accent-insensitive search for ${fold(accented.target)}`);
  await search(accented.target.toUpperCase());
  assert.equal(await row(accented.id).count(), 1);

  // 5. Choose a different card in the open review, then choose the early card.
  const current = data.recallReview.current;
  const different = list.rows.find((item) => untouched.includes(item.id) && item.id !== current.word);
  assert.ok(different);
  const practice = async ({ id, target, gloss }) => {
    await words.bringToFront();
    await search(target);
    await row(id).getByRole('button', { name: 'Practice now' }).click();
    await prompt.getByText(gloss, { exact: true }).waitFor();
    assert.equal(await answer.isVisible(), false);
    assert.deepEqual((await reviewTabs()).map((tab) => [tab.id, tab.active]), [[reviewId, true]]);
  };
  await practice(different);
  assert.match(await review.locator('#progress').textContent(), /^Card 2 of /);
  const stale = await send(review, { type: 'reviewRate', ticket: current.ticket, rating: 'medium' });
  assert.match(stale.error, /stale/);
  await practice({ id: rated, target: rated, gloss: ratedGloss });
  const prior = await stored();
  assert.deepEqual(prior.recallReview.cards, data.recallReview.cards);
  assert.deepEqual(prior.learningRetrievals, data.learningRetrievals);
  await review.locator('#reveal').click();
  await review.locator('#answer').getByText(rated, { exact: true }).waitFor();
  await review.locator('[data-rating="medium"]').click();
  // The worker writes the card first and the retrieval log right after, so wait for both.
  data = await until(stored, (d) => d.recallReview.cards[rated]?.reviews === 2 &&
    d.learningRetrievals?.retrievals.length === 2, 'second review and its retrieval log entry');
  const log = data.learningRetrievals.retrievals;
  assert.equal(log.length, 2);
  assert.equal(log[1][0], rated);
  assert.equal(typeof log[1][9], 'number', `early review predicted recall: ${JSON.stringify(log[1])}`);
  assert.ok(log[1][9] > 0 && log[1][9] <= 1);

  // 6. Reset: two clicks, Cancel leaves the card, Confirm removes it.
  await words.bringToFront();
  await words.reload();
  await words.locator('#words li[data-id]').first().waitFor();
  await search(rated);
  await row(rated).getByRole('button', { name: 'Reset' }).click();
  const confirm = row(rated).getByRole('button', { name: 'Confirm reset' });
  await confirm.waitFor();
  assert.equal((await stored()).recallReview.cards[rated].reviews, 2); // nothing changed yet
  await row(rated).getByRole('button', { name: 'Cancel' }).click();
  await row(rated).getByRole('button', { name: 'Reset', exact: true }).waitFor();
  assert.equal(await row(rated).getByRole('button', { name: 'Confirm reset' }).count(), 0);
  assert.equal((await stored()).recallReview.cards[rated].reviews, 2);

  // The worker-side guard, from the words page (its sender surface allows wordReset).
  const other = untouched[0];
  const otherCard = (await stored()).recallReview.cards[other];
  const unconfirmed = await send(words, { type: 'wordReset', id: other, scope: 'es', confirm: false,
    version: { due: otherCard.due, reviews: otherCard.reviews, familiar: false } });
  assert.ok(unconfirmed.error, 'confirm:false is refused');
  const wrong = await send(words, { type: 'wordReset', id: other, scope: 'es', confirm: true,
    version: { due: 0, reviews: 99, familiar: false } });
  assert.ok(wrong.error && wrong.stale, 'a wrong version is refused as stale');
  const wrongScope = await send(words, { type: 'wordReset', id: other, scope: 'fr', confirm: true,
    version: { due: otherCard.due, reviews: otherCard.reviews, familiar: false } });
  assert.ok(wrongScope.error, 'a wrong scope is refused');
  assert.deepEqual((await stored()).recallReview.cards[other], otherCard);

  await row(rated).getByRole('button', { name: 'Reset', exact: true }).click();
  await row(rated).getByRole('button', { name: 'Confirm reset' }).click();
  data = await until(stored, (d) => !d.recallReview.cards[rated], 'the reset to reach storage');
  assert.equal(Object.keys(data.recallReview.cards).length, 4);
  assert.equal(data.learningRetrievals.retrievals.length, 2); // history stays
  await until(() => row(rated).locator('.meta').textContent(), (text) => text.startsWith('New'), 'New stage text');
  assert.match(await words.locator('#count').textContent(), /was reset/);

  // 7. No URLs or passages anywhere on the page, with every row rendered.
  await words.locator('#search').fill('');
  await until(() => rendered(), (n) => n > 0, 'full list');
  while (await words.locator('#more').isVisible()) await words.locator('#more').click();
  assert.equal(await rendered(), total);
  const text = (await words.evaluate(() => document.body.textContent)).toLowerCase();
  assert.ok(!text.includes('http'), 'page text contains "http"');
  // "example" is legitimately part of two bundled glosses ("for example", "the example"), so it may
  // appear only in a row whose own pack gloss contains it, and nowhere outside the list.
  const outside = (await words.evaluate(() => {
    const copy = document.body.cloneNode(true);
    copy.querySelector('#words').remove();
    return copy.textContent;
  })).toLowerCase();
  assert.ok(!outside.includes('example'), 'page text outside the list contains "example"');
  const glossOf = new Map(list.rows.map((r) => [r.id, r.gloss.toLowerCase()]));
  const rowTexts = await words.locator('#words li[data-id]').evaluateAll((lis) =>
    lis.map((li) => ({ id: li.dataset.id, content: li.textContent.toLowerCase() })));
  for (const { id, content } of rowTexts) {
    if (content.includes('example')) assert.ok(glossOf.get(id).includes('example'), `row ${id} shows "example" outside its gloss`);
  }

  // 8. The popup links to the page and stays within Chrome's popup cap.
  await popup.waitForFunction(() => document.querySelector('#today')?.textContent.trim() &&
    document.querySelector('#primary')?.textContent.trim());
  assert.equal(await popup.locator('#openWords').getAttribute('href'), 'words.html');
  const popupSize = await popup.evaluate(() => ({ width: document.body.getBoundingClientRect().width,
    height: document.body.getBoundingClientRect().height }));
  assert.equal(popupSize.width, 300);
  assert.ok(popupSize.height <= 600, `popup exceeds Chrome's 600px cap: ${popupSize.height}px`);

  // Concurrent ordinary opens after closing the review must create one replacement.
  await review.close();
  assert.deepEqual(await Promise.all([send(popup, { type: 'openReview' }), send(popup, { type: 'openReview' })]),
    [{ ok: true }, { ok: true }]);
  const replacement = await openedPage('review');
  await replacement.locator('#prompt').waitFor();
  assert.equal((await reviewTabs()).length, 1);
  assert.equal((await stored()).learningRetrievals.retrievals.length, 2);

  // Switch to the bundled Guaraní scope. In this fresh scope the same review
  // tab is idle, so Practice now must refresh it even without a visible card.
  const options = await browser.newPage();
  await options.goto(url('options'));
  await options.locator('#language').selectOption('gn-PY-x-weave');
  await replacement.locator('#language').getByText(/Paraguayan Guaraní/).waitFor();
  await replacement.locator('#empty').waitFor();
  const spanish = await stored();
  await words.bringToFront();
  await words.reload();
  await words.locator('#language').getByText(/Paraguayan Guaraní/).waitFor();
  await search('mbo’ehára');
  await row('mbo’ehára').getByRole('button', { name: 'Practice now' }).click();
  await replacement.locator('#prompt').getByText('teacher (at school)', { exact: true }).waitFor();
  assert.equal((await reviewTabs()).length, 1);
  assert.deepEqual(await stored(), spanish);

  // With two live reviews, the source-window review wins even if a different
  // window also has an active review tab.
  const localReview = await tabOf(replacement);
  const popupTab = await tabOf(popup);
  assert.equal(localReview.windowId, popupTab.windowId);
  const remoteWindow = await worker.evaluate((url) => chrome.windows.create({ url, focused: false }), url('review'));
  const remoteReview = await until(() => reviewPages().find((page) => page !== replacement),
    Boolean, 'the competing Review document');
  await remoteReview.locator('#prompt').getByText('teacher (at school)', { exact: true }).waitFor();
  const remoteTab = await tabOf(remoteReview);
  assert.equal(remoteTab.windowId, remoteWindow.id);
  assert.equal(remoteTab.active, true);
  assert.notEqual(remoteTab.windowId, localReview.windowId);
  await popup.bringToFront();
  assert.equal((await tabOf(replacement)).active, false);
  assert.deepEqual(await send(popup, { type: 'openReview' }), { ok: true });
  assert.equal((await tabOf(replacement)).active, true);
  if (shortcutTool) assert.equal(await focusedWindow(), localReview.windowId);
  assert.equal(reviewPages().length, 2);
  await remoteReview.close();

  // After that tab navigates to a protected Chrome page, Practice now creates
  // one new Review, leaving both the old tab and other Lang Weave pages intact.
  await replacement.goto('chrome://version/');
  await replacement.evaluate(() => { globalThis.protectedFixture = true; });
  await options.evaluate(() => { globalThis.optionsFixture = true; });
  await words.bringToFront();
  await search('y');
  await row('y').getByRole('button', { name: 'Practice now' }).click();
  const newReview = await openedPage('review');
  await newReview.locator('#prompt').getByText('water', { exact: true }).waitFor();
  const newTab = await tabOf(newReview);
  assert.notEqual(newTab.id, localReview.id);
  assert.equal(newTab.windowId, (await tabOf(words)).windowId);
  assert.equal(newTab.active, true);
  assert.deepEqual(reviewPages(), [newReview]);
  assert.equal(replacement.url(), 'chrome://version/');
  assert.equal(await replacement.evaluate(() => globalThis.protectedFixture), true);
  assert.equal(await options.evaluate(() => globalThis.optionsFixture), true);
  assert.deepEqual(await grants(), initialGrants);

  console.log(`PASS: My words and review in real MV3 Chromium: ${total} words, popup open and cold resume, repeated practice in one tab, stale-ticket and duplicate-open protection, explicit early rating, reset guards, search and popup sizing. No network or model call.`);
} finally {
  if (browser) await browser.close();
  await rm(scratch, { recursive: true, force: true }); // this script owns its unique scratch directory
}

// Real MV3 Chromium gate for the "My words" page. No network, no Gemini, no API key: every card
// is seeded through the real worker's review messages, and every assertion reads the page or the
// worker's own storage. Throwaway profile; the scratch directory is removed in finally.
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = await mkdtemp(join(tmpdir(), 'lang-weave-words-'));
const extension = join(scratch, 'extension');
let browser;
try {
  await cp(join(root, 'src'), join(extension, 'src'), { recursive: true });
  await cp(join(root, 'icons'), join(extension, 'icons'), { recursive: true }); // the manifest names them
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  browser = await chromium.launchPersistentContext(join(scratch, 'profile'), {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--host-resolver-rules=MAP generativelanguage.googleapis.com ~NOTFOUND',
      '--proxy-server=127.0.0.1:9'],
  });
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  const extensionId = await worker.evaluate(() => chrome.runtime.id);
  const url = (page) => `chrome-extension://${extensionId}/src/${page}.html`;
  const send = (page, message) => page.evaluate((m) => chrome.runtime.sendMessage(m), message);
  const stored = () => worker.evaluate(() => chrome.storage.local.get(['recallReview', 'learningRetrievals']));
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

  // 2. Seed through the real review flow: introduce 5, rate one 'medium'.
  const seed = await browser.newPage();
  await seed.goto(url('review'));
  const introduced = await send(seed, { type: 'reviewIntroduce' });
  assert.equal(introduced.added, 5);
  const next = await send(seed, { type: 'reviewNext' });
  assert.ok(next.card?.ticket, 'a card is served');
  const revealed = await send(seed, { type: 'reviewReveal', ticket: next.card.ticket });
  const rated = revealed.answer.fr; // the Spanish form of the card rated here
  const ratedGloss = next.card.en;
  const rateReply = await send(seed, { type: 'reviewRate', ticket: next.card.ticket, rating: 'medium' });
  assert.equal(rateReply.ok, true);
  await seed.close(); // no other review tab may race the cards under test
  let data = await stored();
  const cardIds = Object.keys(data.recallReview.cards);
  assert.equal(cardIds.length, 5);
  assert.ok(cardIds.includes(rated));
  assert.equal(data.recallReview.cards[rated].reviews, 1);
  assert.ok(data.recallReview.cards[rated].due > Date.now() + 3600000, 'the rated card is not due');
  assert.equal(data.learningRetrievals.retrievals.length, 1);
  const untouched = cardIds.filter((id) => id !== rated); // four new, due-now cards
  assert.equal(untouched.length, 4);

  // 3. The words page: count, incremental rendering, today line, strip, measurements.
  const words = await browser.newPage();
  await words.goto(url('words'));
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
  assert.equal(await words.locator('#measures > li').count(), 7);
  assert.match(await words.locator('#measures').textContent(), /Not enough data yet/);

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

  // 5. Practice now on the not-due word opens the review tab on exactly that card.
  await search(rated);
  const [review] = await Promise.all([browser.waitForEvent('page'),
    row(rated).getByRole('button', { name: 'Practice now' }).click()]);
  await review.waitForLoadState();
  assert.equal(new URL(review.url()).pathname, '/src/review.html');
  await review.locator('#prompt').getByText(ratedGloss, { exact: true }).waitFor();
  assert.equal((await review.locator('#prompt').textContent()), ratedGloss);
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
  await review.close();

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
  const popup = await browser.newPage();
  await popup.goto(url('popup'));
  await popup.waitForFunction(() => document.querySelector('#today')?.textContent.trim() &&
    document.querySelector('#primary')?.textContent.trim());
  assert.equal(await popup.locator('#openWords').getAttribute('href'), 'words.html');
  const popupSize = await popup.evaluate(() => ({ width: document.body.getBoundingClientRect().width,
    height: document.body.getBoundingClientRect().height }));
  assert.equal(popupSize.width, 300);
  assert.ok(popupSize.height <= 600, `popup exceeds Chrome's 600px cap: ${popupSize.height}px`);

  console.log(`PASS: My words in real MV3 Chromium: ${total} words rendered in batches, today/strip/measures, search (form, gloss, accent-insensitive, ArrowDown focus), Practice now opened the review card with an FSRS early-review prediction, Reset confirm/cancel/guards, no URLs on the page, popup link and size. No network or model call.`);
} finally {
  if (browser) await browser.close();
  await rm(scratch, { recursive: true, force: true }); // this script owns its unique scratch directory
}

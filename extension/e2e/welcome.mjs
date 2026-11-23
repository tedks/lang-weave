// Fresh MV3 install: first-run page has a local demo and an explicit site choice.
// DNS blocks Gemini; no real key or request is used.
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.LANG_WEAVE_PLAYWRIGHT
  ? pathToFileURL(process.env.LANG_WEAVE_PLAYWRIGHT).href
  : 'playwright');

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = await mkdtemp(join(tmpdir(), 'lang-weave-welcome-'));
const suppliedExtension = process.env.LANG_WEAVE_WELCOME_EXTENSION;
const extension = suppliedExtension || join(scratch, 'extension');
let context;
try {
  if (!suppliedExtension) {
    await cp(join(root, 'src'), join(extension, 'src'), { recursive: true });
    await cp(join(root, 'icons'), join(extension, 'icons'), { recursive: true });
    await cp(join(root, '_locales'), join(extension, '_locales'), { recursive: true }); // default_locale needs it
    await writeFile(join(extension, 'manifest.json'), await readFile(join(root, 'manifest.json')));
  }
  const geminiRequests = [];
  const executablePath = process.env.LANG_WEAVE_CHROMIUM;
  context = await chromium.launchPersistentContext(join(scratch, 'profile'), {
    ...(executablePath ? { executablePath } : { channel: 'chromium' }), headless: true,
    locale: 'en-US',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--host-resolver-rules=MAP * ~NOTFOUND', '--proxy-server=http://127.0.0.1:9'],
  });
  context.on('request', (request) => {
    if (request.url().startsWith('https://generativelanguage.googleapis.com/')) geminiRequests.push(request.url());
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  assert.equal(id, 'lkbkmlgogcpcacjmdmoecgacdbfddbnh');
  const welcomeUrl = `chrome-extension://${id}/src/welcome.html`;
  const page = context.pages().find((p) => p.url() === welcomeUrl) ||
    await context.waitForEvent('page', { predicate: (p) => p.url() === welcomeUrl });
  await page.locator('#demo .fw-word').first().waitFor();
  assert.equal(await page.getByText('The Gemini API requires users to be 18 or older.').count(), 1);
  assert.equal(await page.locator('#suggestX').isHidden(), true, 'the unpacked build already has a static X script');
  assert.equal(await page.locator('#demo .fw-word').count(), 9);
  const word = page.locator('#demo .fw-word').first();
  assert.equal(await word.textContent(), 'hoy');
  await word.hover();
  await page.locator('.fw-gloss.fw-gloss-on').waitFor();
  assert.match(await page.locator('.fw-gloss').textContent(), /hoy · today/);
  await word.click();
  assert.equal(await word.textContent(), 'Today');
  await word.click();
  assert.equal(await word.textContent(), 'hoy');
  const before = await worker.evaluate(() => chrome.storage.local.get(['settings', 'consentShown', 'apiKey']));
  assert.equal(before.consentShown, false);
  assert.equal(before.apiKey, undefined);
  // A real install's first startup writes the new-profile learning default (gradual-default-on-install-ruling).
  assert.equal(before.settings.gradual, true);
  assert.equal(before.settings.newWordsPerDay, 5);
  assert.match((await page.locator('[aria-labelledby="learnHeading"]').textContent()).replace(/\s+/g, ' '),
    /Gradual learning is on for new installs, at 5 new words a day\. .*Settings shows whether it is on for you/);
  const placement = page.locator('#placement');
  const placementTrigger = placement.locator(':scope > summary');
  assert.equal(await placement.getByRole('combobox').count(), 0, 'placement is optional and closed initially');
  await placementTrigger.focus();
  await placementTrigger.press('Enter');
  await placement.getByRole('heading', { name: 'Beginner', exact: true }).waitFor();
  const startingPoint = placement.getByRole('combobox', { name: 'Spanish starting point' });
  const score = placement.getByRole('textbox', { name: 'Duolingo Score for your Spanish course (optional)' });
  await score.waitFor();
  const beforeScore = await worker.evaluate(() => chrome.storage.local.get(null));
  const scoreStatus = placement.locator('#placementScoreStatus');
  await score.fill('161');
  await score.press('Enter');
  await scoreStatus.getByText('Enter a whole number from 0 to 160, or leave this blank.').waitFor();
  assert.equal(await score.getAttribute('aria-invalid'), 'true');
  await placementTrigger.press('Enter');
  const rawScore = placement.locator('#duolingoScore');
  await page.waitForFunction(() => document.getElementById('duolingoScore').value === '');
  assert.equal(await rawScore.getAttribute('aria-invalid'), null);
  assert.equal(await scoreStatus.textContent(), '');
  await placementTrigger.press('Enter');
  await score.fill('29');
  await score.press('Enter');
  await scoreStatus.getByText('Look at the Beginner examples first.').waitFor();
  assert.equal(await placement.getByRole('heading').first().textContent(), 'Beginner');
  await score.fill('30');
  await score.press('Enter');
  await scoreStatus.getByText('Try the Expanded examples first.').waitFor();
  assert.equal(await placement.getByRole('heading').first().textContent(), 'Expanded');
  assert.equal(await score.inputValue(), '');
  await score.press('Enter'); // a blank Score returns to ordinary preview
  assert.equal(await placement.getByRole('heading').first().textContent(), 'Beginner');
  assert.equal(await startingPoint.inputValue(), '0');
  assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get(null)), beforeScore, 'preview does not write storage');
  assert.equal(await placement.locator('[lang="es"]').filter({ hasText: /^sin$/ }).first().isVisible(), true);
  const meanings = placement.getByText('Check Expanded meanings', { exact: true });
  await meanings.press('Enter');
  await placement.locator('[lang="en"]').filter({ hasText: /still/ }).waitFor();
  await startingPoint.selectOption({ label: 'Expanded' });
  const saveStartingPoint = placement.getByRole('button', { name: 'Save starting point' });
  await saveStartingPoint.press('Space');
  await placement.getByRole('status').getByText('Spanish starting point saved on this device.').waitFor();
  assert.equal(await saveStartingPoint.evaluate((button) => button === document.activeElement), true);
  const placed = await worker.evaluate(() => chrome.storage.local.get(['settings', 'spanishPlacement', 'consentShown', 'apiKey', 'recallReview']));
  assert.equal(placed.spanishPlacement, 2);
  assert.equal(placed.consentShown, false);
  assert.equal(placed.apiKey, undefined);
  assert.equal(placed.recallReview, undefined);
  assert.deepEqual(placed.settings, before.settings, 'placement leaves the regular settings intact');
  await page.close(); // a learner may close welcome before choosing
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/src/popup.html`);
  await popup.locator('#welcomeRoute').waitFor({ state: 'visible' });
  await popup.locator('#operation').getByText(/Finish setup/).waitFor();
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/src/options.html`);
  await options.locator('#newSitesEnabled[disabled]').waitFor();
  await options.locator('#welcomeLink').waitFor({ state: 'visible' });
  assert.match(await options.locator('#newSitesEnabled').locator('..').textContent(), /first choice on the welcome page/);
  const reopenedPromise = context.waitForEvent('page', { predicate: (p) => p.url() === welcomeUrl });
  await popup.locator('#openWelcome').click();
  const reopened = await reopenedPromise;
  await reopened.getByRole('button', { name: /Only sites I turn on/ }).click();
  await reopened.getByRole('status').getByText(/Only sites you turn on selected/).waitFor();
  const after = await worker.evaluate(() => chrome.storage.local.get(['settings', 'consentShown']));
  assert.equal(after.consentShown, true);
  assert.equal(after.settings.newSitesEnabled, false);
  assert.equal(after.settings.gradual, true); // the site choice merges; it never resets the learning default
  assert.deepEqual(await worker.evaluate(() => chrome.permissions.getAll().then(({ origins }) => origins
    .filter((origin) => origin === '<all_urls>' || origin === 'http://*/*' || origin === 'https://*/*'))), []);

  const review = await context.newPage();
  await review.goto(`chrome-extension://${id}/src/review.html`);
  await review.locator('#language').getByText('Spanish').waitFor();
  await review.locator('#introduce').click();
  await review.locator('#prompt').getByText('if', { exact: true }).waitFor();
  const expandedCounts = await review.locator('#counts').textContent();
  const placedHistory = await worker.evaluate(() => chrome.storage.local.get('recallReview'));
  const settingsPlacement = options.locator('#placement');
  await options.locator('#levelOverride:disabled').waitFor();
  assert.equal(await settingsPlacement.locator(':scope > summary').getAttribute('aria-describedby'), 'levelHint');
  await settingsPlacement.locator(':scope > summary').press('Enter');
  const settingsChoice = settingsPlacement.getByRole('combobox', { name: 'Spanish starting point' });
  await settingsPlacement.locator('fieldset:enabled').waitFor();
  assert.equal(await settingsChoice.inputValue(), '2');
  const settingsScore = settingsPlacement.getByRole('textbox', { name: 'Duolingo Score for your Spanish course (optional)' });
  await settingsScore.fill('0');
  await settingsScore.press('Enter');
  await settingsPlacement.getByText('Look at the Beginner examples first.').waitFor();
  assert.equal(await settingsChoice.inputValue(), '2', 'the hint leaves an existing placement unchanged');
  await settingsChoice.selectOption({ label: 'Beginner' });
  await settingsPlacement.getByRole('button', { name: 'Save starting point' }).click();
  await options.locator('#levelInfo').getByText('L1').waitFor();
  await review.waitForFunction((counts) => document.getElementById('counts').textContent !== counts, expandedCounts);
  await review.locator('#prompt').getByText('if', { exact: true }).waitFor();
  assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get('recallReview')), placedHistory);
  await review.locator('#reveal').click();
  await review.locator('#answer').getByText('si', { exact: true }).waitFor();
  await settingsChoice.selectOption({ label: 'Use my reading level setting' });
  await settingsPlacement.getByRole('button', { name: 'Save starting point' }).click();
  await options.locator('#levelOverride:enabled').waitFor();
  console.log('PASS: optional Spanish placement from Welcome, keyboard access, revision and clearing in Settings, and existing review retained.');

  const guaraniWelcome = await context.newPage();
  await guaraniWelcome.goto(welcomeUrl);
  const languagePreview = guaraniWelcome.locator('#placement > summary');
  await languagePreview.press('Enter');
  const openScore = guaraniWelcome.locator('#duolingoScore');
  await openScore.fill('30');
  await openScore.press('Enter');
  await guaraniWelcome.getByText('Try the Expanded examples first.').waitFor();
  await openScore.fill('160');
  const beginnerMeanings = guaraniWelcome.getByText('Check Beginner meanings', { exact: true });
  await beginnerMeanings.focus();
  await options.locator('#language').selectOption({ value: 'gn-PY-x-weave' });
  await options.locator('#wordInfo').getByText(/Paraguayan Guaraní/).waitFor();
  assert.equal(await settingsPlacement.isHidden(), true);
  await openScore.waitFor({ state: 'hidden' });
  assert.equal(await openScore.inputValue(), '');
  assert.equal(await beginnerMeanings.evaluate((summary) => summary === document.activeElement), true);
  await languagePreview.press('Enter');
  await guaraniWelcome.locator('#placement:not([open])').waitFor();
  await languagePreview.press('Enter');
  await guaraniWelcome.getByText('Choose Spanish in Settings to use this check.').waitFor();
  assert.equal(await openScore.isHidden(), true);
  await guaraniWelcome.close();
  console.log('PASS: optional Spanish course Score orders real examples by keyboard, with no preview storage writes and Spanish-only scope.');

  await review.goto(`chrome-extension://${id}/src/review.html`);
  await review.locator('#language').getByText(/Paraguayan Guaraní/).waitFor();
  await review.locator('#introduce').click();
  await review.locator('#prompt').getByText('water', { exact: true }).waitFor();
  await review.locator('#reveal').click();
  await review.locator('#answer').getByText('y', { exact: true }).waitFor();
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('apiKey'))).apiKey, undefined);
  console.log('PASS: selected bundled Paraguayan Guaraní and revealed water → y in offline review.');
  assert.deepEqual(geminiRequests, []);
  console.log('PASS: fresh install welcome demo, closed-page popup route, pending Settings controls, only-sites consent and no Gemini request during setup.');
} finally {
  try { await context?.close(); } finally { await rm(scratch, { recursive: true, force: true }); }
}

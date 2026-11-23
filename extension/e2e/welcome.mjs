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
  assert.equal(await placement.locator('[lang="es"]').filter({ hasText: /^sin$/ }).first().isVisible(), true);
  const meanings = placement.getByText('Check Expanded meanings', { exact: true });
  await meanings.press('Enter');
  await placement.locator('[lang="en"]').filter({ hasText: /still/ }).waitFor();
  const startingPoint = placement.getByRole('combobox', { name: 'Spanish starting point' });
  await startingPoint.selectOption({ label: 'Expanded' });
  await placement.getByRole('button', { name: 'Save starting point' }).press('Space');
  await placement.getByRole('status').getByText('Spanish starting point saved on this device.').waitFor();
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
  const placedHistory = await worker.evaluate(() => chrome.storage.local.get('recallReview'));
  const settingsPlacement = options.locator('#placement');
  await settingsPlacement.locator(':scope > summary').press('Enter');
  const settingsChoice = settingsPlacement.getByRole('combobox', { name: 'Spanish starting point' });
  await settingsPlacement.locator('fieldset:enabled').waitFor();
  assert.equal(await settingsChoice.inputValue(), '2');
  await settingsChoice.selectOption({ label: 'Beginner' });
  await settingsPlacement.getByRole('button', { name: 'Save starting point' }).click();
  await options.locator('#levelInfo').getByText('L1').waitFor();
  assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get('recallReview')), placedHistory);
  await review.locator('#reveal').click();
  await review.locator('#answer').getByText('si', { exact: true }).waitFor();
  await settingsChoice.selectOption({ label: 'Use my reading level setting' });
  await settingsPlacement.getByRole('button', { name: 'Save starting point' }).click();
  await options.locator('#levelOverride:enabled').waitFor();
  console.log('PASS: optional Spanish placement from Welcome, keyboard access, revision and clearing in Settings, and existing review retained.');

  await options.locator('#language').selectOption({ value: 'gn-PY-x-weave' });
  await options.locator('#wordInfo').getByText(/Paraguayan Guaraní/).waitFor();
  assert.equal(await settingsPlacement.isHidden(), true);

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

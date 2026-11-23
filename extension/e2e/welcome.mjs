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

const pickerFor = (page) => page.getByRole('combobox', { name: 'Sample language' });
const spanish = {
  name: 'Spanish',
  tag: 'es',
  targets: ['hoy', 'con', 'y', 'importante', 'siempre', 'porque', 'difícil', 'pero', 'posible'],
  source: 'Today I read with a friend, and we talk about an important idea. We always ask a question because learning is difficult, but it is possible.',
  firstSource: 'Today',
};
const guarani = {
  name: 'Paraguayan Guaraní',
  tag: 'gn-PY',
  targets: ['ama', 'yvyra', 'panambi', 'yvoty', 'kuarahy'],
  source: 'After the rain, I walked past a tree toward the garden. A butterfly landed on a flower, and the sun warmed the path.',
  firstSource: 'rain',
};

async function checkSample(page, { name, tag, targets, source, firstSource }) {
  const picker = pickerFor(page);
  const demo = page.locator('#demo');
  const words = demo.getByRole('button');
  const first = demo.getByRole('button', { name: targets[0], exact: true });
  const gloss = page.locator('.fw-gloss.fw-gloss-on');
  await first.waitFor();
  assert.equal(await picker.locator('option:checked').textContent(), name);
  assert.equal(await demo.getAttribute('lang'), 'en');
  assert.deepEqual(await words.allTextContents(), targets);
  assert.deepEqual(await words.evaluateAll((list) => list.map((word) => word.lang)), targets.map(() => tag));
  assert.match(await first.evaluate((word) => word.ownerDocument
    .getElementById(word.getAttribute('aria-describedby')).textContent), /Show English/);

  await first.hover();
  await gloss.waitFor();
  assert.ok((await gloss.textContent()).startsWith(`${targets[0]} · ${firstSource.toLowerCase()}`));
  assert.equal(await gloss.locator('span').getAttribute('lang'), tag);
  await page.locator('#demoHeading').hover();
  await gloss.waitFor({ state: 'detached' });

  await picker.focus();
  await page.keyboard.press('Tab');
  assert.equal(await first.evaluate((word) => word.matches(':focus-visible')), true);
  await gloss.waitFor();
  await page.keyboard.press('Enter');
  const flipped = demo.getByRole('button', { name: firstSource, exact: true });
  assert.equal(await flipped.evaluate((word) => word.closest('[lang]').lang), 'en');
  assert.equal(await flipped.evaluate((word) => word.ownerDocument
    .getElementById(word.getAttribute('aria-describedby')).textContent), `Show ${name}`);
  await gloss.waitFor({ state: 'detached' });
  await page.keyboard.press('Space');
  assert.equal(await first.getAttribute('lang'), tag);
  for (const word of await words.all()) await word.click();
  assert.equal(await demo.textContent(), source);
}

async function openParagraph(context, entry, url) {
  const [page] = await Promise.all([
    context.waitForEvent('page'),
    entry.getByRole('link', { name: 'Practice a paragraph' }).press('Enter'),
  ]);
  await page.waitForURL(url);
  await page.locator('#language:enabled').waitFor();
  return page;
}

async function checkParagraph(context, worker, id) {
  const base = `chrome-extension://${id}/src/`;
  assert.equal(context.pages().some((p) => p.url() === `${base}paragraph.html`), false);
  const popup = await context.newPage();
  await popup.goto(`${base}popup.html`);
  const before = await worker.evaluate(async () => ({
    local: await chrome.storage.local.get(null), sync: await chrome.storage.sync.get(null),
    session: await chrome.storage.session.get(null), permissions: await chrome.permissions.getAll(),
  }));
  assert.equal(before.local.apiKey, undefined);
  await worker.evaluate(() => {
    self.paragraphWorkerCalls = 0;
    const observe = (sender) => {
      if (sender?.url === chrome.runtime.getURL('src/paragraph.html')) self.paragraphWorkerCalls++;
    };
    chrome.runtime.onMessage.addListener((_message, sender) => { observe(sender); });
    chrome.runtime.onConnect.addListener((port) => { observe(port.sender); });
  });
  const page = await openParagraph(context, popup, `${base}paragraph.html`);
  let consoleCalls = 0;
  let pageErrors = 0;
  page.on('console', () => { consoleCalls++; });
  page.on('pageerror', () => { pageErrors++; });
  await page.setViewportSize({ width: 320, height: 700 });
  const source = page.getByRole('textbox', { name: 'Short English paragraph' });
  const find = page.getByRole('button', { name: 'Find words' });
  const occurrence = page.getByRole('combobox', { name: 'Occurrence in your paragraph' });
  const sense = page.getByRole('combobox', { name: 'Catalog word and meaning' });
  const practice = page.getByRole('button', { name: 'Practice this word' });
  const preview = page.locator('#preview');
  const language = page.getByRole('combobox', { name: 'Practice language' });
  assert.equal(await language.inputValue(), 'es');
  assert.equal(await language.getAttribute('aria-describedby'), 'level');
  await page.getByText('Vocabulary tier: Beginner').waitFor();
  await page.getByRole('button', { name: 'Use example' }).click();
  await find.click();
  assert.ok(await occurrence.locator('option').count() >= 6);
  const text = 'A window faced the river. Dr. Lee said, “The window stood open.” Then I said, "Close the window." A window-frame broke. <img src=x>';
  await source.fill(text);
  assert.equal(await occurrence.isHidden(), true);
  await find.press('Enter');
  assert.equal(await occurrence.evaluate((el) => el === document.activeElement), true);
  assert.deepEqual((await occurrence.locator('option').allTextContents()).map((label) => label.match(/\[(.*?)\]/)[1]),
    ['window', 'the river', 'The window', 'the window']);
  assert.equal(await page.locator('#senseContext').textContent(), 'ventana · window');
  await occurrence.selectOption('2');
  assert.equal((await page.locator('#occurrenceContext').textContent()).trim(), 'Dr. Lee said, “The window stood open.”');
  assert.equal(await page.locator('#occurrenceContext mark').textContent(), 'The window');
  await practice.press('Enter');
  const word = preview.getByRole('button', { name: 'La ventana', exact: true });
  assert.equal(await word.evaluate((el) => el === document.activeElement), true);
  assert.equal(await word.getAttribute('lang'), 'es');
  assert.equal(await preview.textContent(), text.replace('“The window', '“La ventana'));
  assert.equal(await preview.locator('img').count(), 0);
  await page.keyboard.press('Space');
  assert.equal(await preview.textContent(), text);
  await occurrence.selectOption('3');
  await practice.click();
  assert.equal(await preview.textContent(), text.replace('Close the window', 'Close la ventana'));
  await preview.getByRole('button', { name: 'la ventana', exact: true }).click();
  assert.equal(await preview.textContent(), text);
  await source.fill('Zebras prance.');
  await find.click();
  await page.getByRole('status').getByText(/Try the example or edit your paragraph/).waitFor();
  await language.selectOption({ label: 'Paraguayan Guaraní' });
  await page.getByRole('button', { name: 'Use example' }).click();
  await find.click();
  const teacher = occurrence.locator('option').filter({ hasText: /\[teacher\]/ });
  await occurrence.selectOption(await teacher.getAttribute('value'));
  assert.equal(await sense.locator('option:checked').textContent(), 'mbo’ehára · teacher (at school)');
  assert.equal(await page.locator('#senseContext').textContent(), 'mbo’ehára · teacher (at school)');
  assert.equal(await page.locator('#senseContext [lang]').getAttribute('lang'), 'gn-PY');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth &&
    ['occurrenceContext', 'senseContext'].every((id) => {
      const context = document.getElementById(id);
      return context.scrollWidth <= context.clientWidth && getComputedStyle(context).whiteSpace === 'pre-wrap';
    })), true);
  await practice.click();
  const guaraniWord = preview.getByRole('button', { name: 'mbo’ehára', exact: true });
  assert.equal(await guaraniWord.getAttribute('lang'), 'gn-PY');
  await guaraniWord.click();
  assert.equal(await preview.textContent(), await source.inputValue());
  const prose = await source.inputValue();
  const door = occurrence.locator('option').filter({ hasText: /\[door\]/ });
  await occurrence.selectOption(await door.getAttribute('value'));
  assert.equal(await page.locator('#senseContext').textContent(), 'okẽ · door (movable barrier)');
  await practice.press('Enter');
  const doorWord = preview.getByRole('button', { name: 'okẽ', exact: true });
  assert.equal(await doorWord.getAttribute('lang'), 'gn-PY');
  assert.equal(await doorWord.evaluate((word) => word === document.activeElement), true);
  assert.equal(await preview.textContent(), prose.replace('the door', 'the okẽ'));
  await doorWord.press('Space');
  assert.equal(await preview.textContent(), prose);
  const englishDoor = preview.getByRole('button', { name: 'door', exact: true });
  assert.equal(await englishDoor.getAttribute('lang'), null);
  await englishDoor.click();
  assert.equal(await doorWord.textContent(), 'okẽ');
  await page.getByRole('button', { name: 'Clear paragraph' }).press('Space');
  assert.equal(await source.inputValue(), '');
  assert.equal(await source.evaluate((el) => el === document.activeElement), true);
  assert.equal(await occurrence.isHidden(), true);
  await source.fill('The window was stuck.');
  await find.click();
  await page.reload();
  await page.locator('#language:enabled').waitFor();
  assert.equal(await source.inputValue(), '');
  assert.equal(await occurrence.isHidden(), true);
  assert.equal(page.url(), `${base}paragraph.html`);
  const after = await worker.evaluate(async () => ({
    local: await chrome.storage.local.get(null), sync: await chrome.storage.sync.get(null),
    session: await chrome.storage.session.get(null), permissions: await chrome.permissions.getAll(),
  }));
  assert.deepEqual(after, before, 'paragraph practice leaves storage and permissions untouched');
  assert.equal(await worker.evaluate(() => self.paragraphWorkerCalls), 0);
  assert.equal(consoleCalls, 0);
  assert.equal(pageErrors, 0);
  await page.close();
  await popup.close();
  console.log('PASS: installed popup routes to keyless Spanish and Guaraní paragraph practice, exact dialogue selection and flipping, plain text, no-match recovery, clear and reload. Storage and grants unchanged. No worker calls or console output from practice.');
}

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
  const networkRequests = [];
  const executablePath = process.env.LANG_WEAVE_CHROMIUM;
  context = await chromium.launchPersistentContext(join(scratch, 'profile'), {
    ...(executablePath ? { executablePath } : { channel: 'chromium' }), headless: true,
    locale: 'en-US',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--host-resolver-rules=MAP * ~NOTFOUND', '--proxy-server=http://127.0.0.1:9'],
  });
  context.on('request', (request) => {
    if (/^https?:/.test(request.url())) networkRequests.push(request.url());
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  assert.equal(id, 'lkbkmlgogcpcacjmdmoecgacdbfddbnh');
  const welcomeUrl = `chrome-extension://${id}/src/welcome.html`;
  const page = context.pages().find((p) => p.url() === welcomeUrl) ||
    await context.waitForEvent('page', { predicate: (p) => p.url() === welcomeUrl });
  await page.locator('#demoLanguage:enabled').waitFor();
  assert.equal(await page.getByText('The Gemini API requires users to be 18 or older.').count(), 1);
  assert.equal(await page.locator('#suggestX').isHidden(), true, 'the unpacked build already has a static X script');
  const before = await worker.evaluate(() => chrome.storage.local.get(['settings', 'consentShown', 'apiKey']));
  assert.equal(before.consentShown, false);
  assert.equal(before.apiKey, undefined);
  assert.equal(before.settings.language, 'es');
  const permissions = await worker.evaluate(() => chrome.permissions.getAll());
  await checkParagraph(context, worker, id);
  await checkSample(page, spanish);
  await pickerFor(page).selectOption({ label: guarani.name });
  await checkSample(page, guarani);
  await pickerFor(page).selectOption({ label: spanish.name });
  assert.deepEqual(await page.locator('#demo').getByRole('button').allTextContents(), spanish.targets);
  assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get(['settings', 'consentShown', 'apiKey'])), before);
  assert.deepEqual(await worker.evaluate(() => chrome.permissions.getAll()), permissions);
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
  const practiceUrl = `chrome-extension://${id}/src/paragraph.html`;
  const placementPractice = await openParagraph(context, page, practiceUrl);
  assert.equal(page.url(), welcomeUrl);
  await placementPractice.getByText('Vocabulary tier: Expanded').waitFor();
  const practiceSource = placementPractice.getByRole('textbox', { name: 'Short English paragraph' });
  await practiceSource.fill('Admission is free. Admission is free.');
  await placementPractice.getByRole('button', { name: 'Find words' }).click();
  await placementPractice.getByRole('combobox', { name: 'Occurrence in your paragraph' }).selectOption('1');
  const practiceMeanings = placementPractice.getByRole('combobox', { name: 'Catalog word and meaning' });
  assert.deepEqual(await practiceMeanings.locator('option').allTextContents(), ['libre · free (unrestricted)', 'gratis · free (no cost)']);
  await practiceMeanings.selectOption({ label: 'gratis · free (no cost)' });
  assert.equal(await placementPractice.locator('#senseContext').textContent(), 'gratis · free (no cost)');
  const practiceButton = placementPractice.getByRole('button', { name: 'Practice this word' });
  await practiceButton.press('Space');
  assert.equal(await placementPractice.locator('#preview').textContent(), 'Admission is free. Admission is gratis.');
  await practiceSource.fill('She said, “I don’t know.”');
  await placementPractice.getByRole('button', { name: 'Find words' }).click();
  await practiceButton.click();
  assert.equal(await placementPractice.locator('#preview').textContent(), 'She said, “No sé.”');
  await placementPractice.goto('about:blank');
  await placementPractice.goBack();
  await placementPractice.locator('#language:enabled').waitFor();
  assert.equal(await practiceSource.inputValue(), '');
  assert.equal(await placementPractice.locator('#choices').isHidden(), true);
  await placementPractice.close();
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
  const guaraniPractice = await openParagraph(context, guaraniWelcome, practiceUrl);
  assert.equal(await guaraniPractice.getByRole('combobox', { name: 'Practice language' }).inputValue(), 'gn-PY-x-weave');
  await guaraniPractice.close();
  await guaraniWelcome.close();
  console.log('PASS: optional Spanish course Score orders real examples by keyboard, with no preview storage writes and Spanish-only scope.');

  await reopened.reload();
  await reopened.locator('#demo').getByRole('button', { name: 'ama', exact: true }).waitFor();
  assert.equal(await pickerFor(reopened).inputValue(), 'gn-PY-x-weave');
  await pickerFor(reopened).selectOption({ label: spanish.name });
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('settings'))).settings.language, 'gn-PY-x-weave');

  await review.goto(`chrome-extension://${id}/src/review.html`);
  await review.locator('#language').getByText(/Paraguayan Guaraní/).waitFor();
  await review.locator('#introduce').click();
  await review.locator('#prompt').getByText('water', { exact: true }).waitFor();
  await review.locator('#reveal').click();
  await review.locator('#answer').getByText('y', { exact: true }).waitFor();
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('apiKey'))).apiKey, undefined);
  console.log('PASS: selected bundled Paraguayan Guaraní and revealed water → y in offline review.');

  const words = await context.newPage();
  await words.goto(`chrome-extension://${id}/src/words.html`);
  await words.locator('#words li[data-id="y"]').waitFor();
  const teacher = words.locator('#words li[data-id="mbo’ehára"]');
  const [teacherReview] = await Promise.all([context.waitForEvent('page'),
    teacher.getByRole('button', { name: 'Practice now' }).click()]);
  await teacherReview.locator('#prompt').getByText('teacher (at school)', { exact: true }).waitFor();
  await teacherReview.locator('#reveal').click();
  await teacherReview.locator('#answer').getByText('mbo’ehára', { exact: true }).waitFor();
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('apiKey'))).apiKey, undefined);
  await teacherReview.close();
  await words.close();
  console.log('PASS: new everyday Guaraní appears in My words and opens keyless Review on the original catalog.');

  // With review closed, the usual My words route opens a fresh review tab.
  if (!review.isClosed()) await review.close();
  const proseWords = await context.newPage();
  await proseWords.goto(`chrome-extension://${id}/src/words.html`);
  const doorRow = proseWords.locator('#words li[data-id="okẽ"]');
  const [doorReview] = await Promise.all([context.waitForEvent('page'),
    doorRow.getByRole('button', { name: 'Practice now' }).press('Enter')]);
  await doorReview.locator('#prompt').getByText('door (movable barrier)', { exact: true }).waitFor();
  await doorReview.locator('#reveal').press('Space');
  await doorReview.locator('#answer').getByText('okẽ', { exact: true }).waitFor();
  await doorReview.locator('[data-rating="medium"]').press('Enter');
  await doorReview.waitForFunction(async () => {
    const key = 'lang:gn-PY-x-weave:0000000000000001:recallReview';
    return (await chrome.storage.local.get(key))[key]?.cards?.['okẽ']?.reviews === 1;
  });
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('apiKey'))).apiKey, undefined);
  await doorReview.close();
  await proseWords.close();
  console.log('PASS: the built-in Guaraní paragraph flips okẽ and My words reveals the same accented form in a separate keyless review.');

  // Simulate a previously generated pack for the same locale without using Gemini.
  await worker.evaluate(() => chrome.storage.local.set({ languagePacks: { 'gn-PY': {
    words: Array.from({ length: 20 }, (_, i) => ({
      fr: `fixture-${i}`, en: `example ${i}`, hint: 'fixture', level: i < 10 ? 1 : 2,
    })),
  } } }));
  await options.reload();
  await options.locator('#language option[value="gn-PY"]').waitFor({ state: 'attached' });
  await options.locator('#language').selectOption('gn-PY');
  await options.locator('#removeLanguage').waitFor();
  await reopened.reload();
  await reopened.locator('#demo').getByRole('button', { name: 'hoy', exact: true }).waitFor();
  assert.equal(await pickerFor(reopened).inputValue(), 'es');
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('settings'))).settings.language, 'gn-PY');
  const generatedPractice = await openParagraph(context, reopened, practiceUrl);
  await generatedPractice.getByText(/Offline practice supports the two bundled languages/).waitFor();
  const practiceLanguage = generatedPractice.getByRole('combobox', { name: 'Practice language' });
  assert.equal(await practiceLanguage.inputValue(), 'es');
  await practiceLanguage.selectOption({ label: 'Paraguayan Guaraní' });
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('settings'))).settings.language, 'gn-PY');

  assert.deepEqual(networkRequests, []);
  console.log('PASS: Spanish and Guaraní sample matching, focus, hover and flip; returning bundled selection, generated-pack fallback, and only-sites consent without a network request.');
} finally {
  try { await context?.close(); } finally { await rm(scratch, { recursive: true, force: true }); }
}

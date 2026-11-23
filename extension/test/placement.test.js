import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { duolingoPreview, placementSamples } from '../src/placement.js';
import { L1_WORDS, L2_EXTRA, L2_WORDS } from '../src/vocabulary.js';
import { GUARANI_STARTER } from '../src/language-name.js';
import { GUARANI_PACK } from '../src/guarani.js';
import { createBackup, parseBackup } from '../src/portability.js';
import { hashKey } from '../src/hash.js';

const everyday = JSON.parse(readFileSync(new URL('spanish-everyday-corpus.json', import.meta.url)));

test('the Spanish course Score only chooses a preview order at the published A1/A2 boundary', () => {
  for (const value of ['0', '0000', '9', '10', '19', '20', '29', '  29  ']) expect(duolingoPreview(value)).toBe(1);
  for (const value of ['30', '0030', '59', '60', '79', '80', '99', '100', '114', '115', '129', '130', '160'])
    expect(duolingoPreview(value)).toBe(2);
  for (const value of ['', ' ', '-1', '+1', '1.5', '30.0', '1e2', '161', '1600', '30 XP'])
    expect(duolingoPreview(value)).toBeNull();
});

test('placement examples use real forms and meanings, including tiny and empty pools', () => {
  const [beginner, expanded] = placementSamples();
  expect(beginner).toHaveLength(4);
  expect(expanded).toHaveLength(4);
  expect(beginner.every((word) => L1_WORDS.includes(word))).toBe(true);
  expect(expanded.every((word) => L2_EXTRA.includes(word))).toBe(true);
  const forms = [...L1_WORDS, ...L2_EXTRA].map(({ fr }) => fr);
  expect(new Set(forms).size).toBe(forms.length);
  expect(forms.sort()).toEqual(L2_WORDS.map(({ fr }) => fr).sort());
  const basic = { fr: 'hoy', en: 'today' };
  const extra = { fr: 'el árbol', en: 'the tree' };
  expect(placementSamples([basic, basic], [basic, extra])).toEqual([[basic], [extra]]);
  expect(placementSamples([basic], [])).toEqual([[basic], []]);
  expect(placementSamples([], [])).toEqual([[], []]);
});

test('Spanish placement opts in locally, prioritizes real reader matches, and preserves older history', async () => {
  const original = { chrome: globalThis.chrome, fetch: globalThis.fetch };
  const legacyCard = { due: 1, interval: 1, reviews: 3, seenDay: '2026-01-01', seenCount: 2 };
  const storage = { settings: { language: 'es', levelOverride: 0, gradual: true, newWordsPerDay: 1, inlineRecall: true },
    recallReview: { version: 1, cards: {
      'la puerta': legacyCard, 'la pregunta': { due: 2, interval: 1, reviews: 3 },
    }, learning: { day: '', count: 0 } }, consentShown: true,
    readingEvents: [{ day: '2026-01-01', word: 'la puerta', kind: 'seen' }] };
  const listeners = [];
  const on = (list = []) => ({ addListener: (fn) => list.push(fn) });
  const id = 'fw-placement';
  const extension = `chrome-extension://${id}/`;
  const page = { id, tab: { id: 1, title: 'Reading' }, frameId: 0, documentId: 'doc',
    documentLifecycle: 'active', url: 'https://reading.example/story' };
  const sender = (surface) => ({ id, url: `${extension}src/${surface}.html` });
  const send = (msg, surface) => new Promise((reply) => {
    if (!listeners[0](msg, surface ? sender(surface) : page, reply)) reply(undefined);
  });
  let failBroadcast = false;
  let failedBroadcast = false;
  globalThis.chrome = {
    storage: { local: {
      async setAccessLevel() {},
      async get(keys) {
        return structuredClone(Object.fromEntries([keys || Object.keys(storage)].flat()
          .filter((key) => Object.hasOwn(storage, key)).map((key) => [key, storage[key]])));
      },
      async set(values) { Object.assign(storage, structuredClone(values)); },
      async remove(keys) { for (const key of [keys].flat()) delete storage[key]; },
    } },
    runtime: { id, getURL: (path) => extension + path, getManifest: () => ({ version: '0.13.0' }),
      onMessage: on(listeners), onInstalled: on(), onStartup: on() },
    tabs: { get: async () => ({ id: 1, title: 'Reading', url: page.url }),
      query: async () => {
        if (!failBroadcast) return [];
        failedBroadcast = true;
        throw new Error('Could not list tabs');
      },
      sendMessage: async () => {} },
    action: { setBadgeText: async () => {} }, alarms: { create: async () => {}, onAlarm: on() },
    permissions: { getAll: async () => ({ origins: ['<all_urls>'] }), onAdded: on(), onRemoved: on() },
    scripting: { getRegisteredContentScripts: async () => [], updateContentScripts: async () => {},
      unregisterContentScripts: async () => {}, registerContentScripts: async () => {} },
  };
  const prompts = [];
  let holdResponse;
  function holdNextResponse() {
    let started, release;
    const requestStarted = new Promise((resolve) => { started = resolve; });
    const released = new Promise((resolve) => { release = resolve; });
    holdResponse = () => { holdResponse = undefined; started(); return released; };
    return { requestStarted, release };
  }
  globalThis.fetch = async (url, init) => {
    if (url === extension + 'manifest.json') return Response.json({ version: '0.13.0' });
    expect(url).toStartWith('https://generativelanguage.googleapis.com/');
    const request = JSON.parse(init.body);
    const prompt = request.systemInstruction.parts[0].text;
    prompts.push(prompt);
    await holdResponse?.();
    const passages = JSON.parse(request.contents[0].parts[0].text.replace(/^Passages:\n/, '')).map(({ id, text }) => {
      const swaps = [];
      if (prompt.includes('a veces = sometimes') && text.startsWith('We sometimes catch'))
        swaps.push({ o: 'sometimes', f: 'a veces', ctx: 'We sometimes catch' });
      if (prompt.includes('la puerta = the door') && text.startsWith('The door looks'))
        swaps.push({ o: 'The door', f: 'la puerta', ctx: 'The door looks' });
      if (text === everyday.heldOut.home[0])
        swaps.push({ o: 'the window', f: 'la ventana', ctx: 'crossed the window' });
      if (text === everyday.contrasts[0].text)
        swaps.push({ o: 'The window', f: 'la ventana', ctx: 'The window frame' });
      return { id, swaps };
    });
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ passages }) }] } }] });
  };
  const preview = (surface = 'options') => send({ type: 'placement' }, surface);
  const apply = (choice, snapshot, surface = 'options') => send({ type: 'placement', choice, epoch: snapshot.epoch }, surface);
  const config = () => send({ type: 'config' });
  const ask = (revision, text) => send({ type: 'swaps', revision,
    items: [{ key: `${revision}:${hashKey(text)}`, text }] });
  const select = (language, levelOverride) => send({ type: 'save', settings: { language, levelOverride } }, 'options');
  try {
    await import('../src/background.js?placement');
    const initial = await preview('welcome');
    const oldConfig = await config();
    const settings = structuredClone(storage.settings);
    const legacy = structuredClone(storage.recallReview);
    expect(initial).toMatchObject({ available: true, choice: 0 });
    expect(oldConfig.level).toBe(1);
    expect(storage.spanishPlacement).toBeUndefined();
    expect(await send({ type: 'placement', choice: 2, epoch: initial.epoch })).toBeUndefined();
    expect(await apply('2', initial)).toEqual({ ok: false });
    failBroadcast = true;
    expect(await apply(2, initial, 'welcome')).toMatchObject({ ok: true, choice: 2 });
    failBroadcast = false;
    expect(failedBroadcast).toBe(true);
    expect(await preview()).toMatchObject({ available: true, choice: 2 });
    expect(await apply(1, initial)).toEqual({ ok: false });
    expect(storage.settings).toEqual(settings);
    expect(storage.recallReview).toEqual(legacy);
    expect(prompts).toEqual([]);
    expect(storage.apiKey).toBeUndefined();
    expect(parseBackup(createBackup(storage, '0.13.0')).state.preferences.levelOverride).toBe(0);

    await send({ type: 'save', apiKey: 'synthetic-key' }, 'options');
    const expanded = await config();
    const text = 'We sometimes catch up without leaving the room.';
    expect(expanded.level).toBe(2);
    expect(await ask(oldConfig.revision, text)).toMatchObject({ stale: true });
    const held = holdNextResponse();
    const pending = ask(expanded.revision, text);
    await held.requestStarted;
    const current = await preview();
    expect(await apply(2, current)).toEqual({ ok: true, ...current });
    expect(await apply(1, initial)).toEqual({ ok: false });
    held.release();
    const { results } = await pending;
    const [swap] = Object.values(results).flat();
    expect(swap.word).toBe('a veces');
    expect(typeof swap.introTicket).toBe('string');
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).not.toContain('sin = without');
    expect(storage.recallReview.cards['a veces']).toBeUndefined();
    expect(storage.recallReview.learning.pending).toMatchObject([{ word: swap.word, ticket: swap.introTicket, revision: expanded.revision }]);
    expect((await config()).revision).toBe(expanded.revision);
    expect(await send({ type: 'introAck', word: swap.word, ticket: swap.introTicket, revision: expanded.revision }))
      .toEqual({ ok: true });
    const doorText = 'The door looks lovely after a gentle snowfall.';
    const heldOld = holdNextResponse();
    const oldRequest = ask(expanded.revision, doorText);
    await heldOld.requestStarted;
    const afterReading = structuredClone(storage.recallReview);
    const beforeRevision = await preview();
    expect(await apply(1, beforeRevision)).toMatchObject({ ok: true, choice: 1 });
    heldOld.release();
    expect(await oldRequest).toMatchObject({ stale: true });
    const beginner = await config();
    expect(beginner.level).toBe(1);
    expect(storage.recallReview).toEqual(afterReading);
    expect(storage.recallReview.cards['la puerta']).toEqual(legacyCard);
    expect(storage.recallReview.learning.count).toBe(1);
    expect((await send({ type: 'reviewNext' }, 'review')).card.en).toBe('the door');
    await send({ type: 'save', settings: { newWordsPerDay: 2 } }, 'options');
    const revised = await config();
    expect(Object.values((await ask(revised.revision, 'That documentary explores the world beyond our doorstep.')).results))
      .toEqual([[]]);
    expect(prompts).toHaveLength(2);
    const doorResult = await ask(revised.revision, doorText);
    expect(Object.values(doorResult.results).flat()).toMatchObject([{ word: 'la puerta', status: 'due' }]);
    expect(prompts.at(-1)).toContain('la puerta = the door');
    expect(prompts.at(-1)).toContain('This reading-coverage cap overrides density.');
    const repeated = await ask(revised.revision, 'We sometimes catch up by writing friendly letters.');
    expect(Object.values(repeated.results).flat()).toMatchObject([{ word: 'a veces', status: 'due' }]);
    expect(await send({ type: 'wordPractice', scope: 'es', id: 'a veces' }, 'words'))
      .toEqual({ ok: true, introduced: false });
    const { card } = await send({ type: 'reviewNext' }, 'review');
    expect(card.en).toBe('sometimes');
    expect(await send({ type: 'reviewReveal', ticket: card.ticket }, 'review'))
      .toMatchObject({ answer: { fr: 'a veces' } });

    const cue = await send({ type: 'inlineBegin', word: 'la pregunta', revision: revised.revision });
    expect(typeof cue.ticket).toBe('string');
    const heldDoor = holdNextResponse();
    const pendingDoor = ask(revised.revision, 'The door looks bright after a long winter.');
    await heldDoor.requestStarted;
    expect(await send({ type: 'wordReset', id: 'la puerta', scope: 'es', confirm: true,
      version: { due: 1, reviews: 3, familiar: false, claimAt: null, claimDue: null } }, 'words')).toEqual({ ok: true });
    heldDoor.release();
    expect(await pendingDoor).toMatchObject({ stale: true });
    expect((await config()).revision).toBe(revised.revision);
    const requestsAfterReset = prompts.length;
    expect(Object.values((await ask(revised.revision, doorText)).results)).toEqual([[]]);
    expect(prompts).toHaveLength(requestsAfterReset);
    expect(await send({ type: 'inlineReveal', ticket: cue.ticket, revision: revised.revision }))
      .toMatchObject({ answer: { fr: 'la pregunta' } });

    const beforeSwitch = await preview();
    await select(GUARANI_STARTER, 2);
    expect(await preview()).toMatchObject({ available: false });
    expect(await apply(2, beforeSwitch)).toEqual({ ok: false });
    expect(await config()).toMatchObject({ language: GUARANI_STARTER, level: 2 });
    expect((await send({ type: 'reviewStatus' }, 'review')).new).toBe(GUARANI_PACK.words.length);
    await select('es', 0);
    expect(await apply(2, beforeSwitch)).toEqual({ ok: false });
    expect(await preview()).toMatchObject({ available: true, choice: 1 });
    // A stored generated-language choice can outlive the pack on an older profile.
    storage.settings.language = 'fr';
    expect(await config()).toMatchObject({ language: 'es', level: 1 });
    expect(await preview()).toMatchObject({ available: true, choice: 1 });
    const beforeClear = structuredClone(storage.recallReview);
    const clear = await apply(0, await preview());
    expect(clear).toMatchObject({ ok: true, choice: 0 });
    expect(await apply(0, clear)).toEqual(clear);
    expect((await config()).level).toBe(1);
    expect((await config()).settings).not.toHaveProperty('spanishPlacement');
    expect(storage.recallReview).toEqual(beforeClear);
    expect((await send({ type: 'wordsList' }, 'words')).rows.find(({ id }) => id === 'a veces'))
      .toMatchObject({ practise: true });
    expect(storage.readingEvents).toEqual([{ day: '2026-01-01', word: 'la puerta', kind: 'seen' }]);

    // A pre-upgrade card keeps its history when the same ID becomes Beginner.
    const savedWindow = { due: 1, interval: 4, reviews: 6 };
    storage.recallReview.cards['la ventana'] = structuredClone(savedWindow);
    await apply(1, await preview());
    await send({ type: 'save', settings: { gradual: false } }, 'options');
    const ordinary = await config();
    expect(ordinary).toMatchObject({ language: 'es', level: 1, settings: { gradual: false } });
    expect((await send({ type: 'wordsList' }, 'words')).rows.find(({ id }) => id === 'la ventana'))
      .toMatchObject({ reviews: 6, practise: true });
    const visible = await ask(ordinary.revision, everyday.heldOut.home[0]);
    expect(Object.values(visible.results).flat()).toMatchObject([{ word: 'la ventana', f: 'la ventana' }]);
    expect(prompts.at(-1)).toContain('la ventana = the window');
    expect(prompts.at(-1)).not.toContain('la maleta = the suitcase');
    expect(prompts.at(-1)).not.toContain('This reading-coverage cap overrides density.');
    const compound = await ask(ordinary.revision, everyday.contrasts[0].text);
    expect(prompts.at(-1)).toContain('la ventana = the window');
    expect(Object.values(compound.results)).toEqual([[]]);
    expect(storage.recallReview.cards['la ventana']).toEqual(savedWindow);

  } finally {
    Object.assign(globalThis, original);
  }
});

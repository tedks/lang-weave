import { expect, test } from 'bun:test';
import { hashKey } from '../src/hash.js';
import { L2_WORDS } from '../src/vocabulary.js';
import { localDay } from '../src/events.js';
import { REVIEW_KEY } from '../src/review.js';

test('production menu listener, one-use save, stable review history and archive/export', async () => {
  const prior = { chrome: globalThis.chrome, fetch: globalThis.fetch };
  const data = { settings: { enabled: true, newSitesEnabled: true, gradual: true,
    newWordsPerDay: 1, inlineRecall: true } };
  const messages = [], clicks = [], removed = [], added = [], opened = [];
  const event = (items) => ({ addListener(fn) { items.push(fn); } });
  const id = 'fw-personal';
  const url = 'https://reading.example/story';
  const page = { id, tab: { id: 7, title: 'Reading' }, frameId: 0,
    documentId: 'document-one', documentLifecycle: 'active', url };
  const popup = { id, url: `chrome-extension://${id}/src/popup.html` };
  const options = { id, url: `chrome-extension://${id}/src/options.html` };
  let liveUrl = url, title = 'Reading', origins = ['<all_urls>'];
  let alive = true, challenge = true, modelCalls = 0, broadcastQueries = 0,
    failPersonalWrite = false, modelEnabled = false;
  let holdNextTab = false, entered, release;
  globalThis.chrome = {
    storage: { local: {
      async setAccessLevel() {},
      async get(keys) {
        const names = typeof keys === 'string' ? [keys] : keys || Object.keys(data);
        return structuredClone(Object.fromEntries(names.filter((key) => key in data).map((key) => [key, data[key]])));
      },
      async set(values) {
        if (failPersonalWrite && Object.hasOwn(values, 'personalVocabularyV1')) throw new Error('disk failed');
        Object.assign(data, structuredClone(values));
      },
      async remove(keys) { for (const key of keys) delete data[key]; },
    } },
    runtime: { id, getURL: (path) => `chrome-extension://${id}/${path}`,
      getManifest: () => ({ version: '0.10.0' }), onMessage: event(messages),
      onInstalled: event([]), onStartup: event([]) },
    tabs: {
      async get() {
        if (holdNextTab) {
          holdNextTab = false;
          entered(); await new Promise((resolve) => { release = resolve; });
        }
        return { id: 7, title, url: liveUrl };
      },
      async query() { broadcastQueries++; return []; },
      async create(options) { opened.push(options.url); return { id: 8 }; },
      async sendMessage(tabId, msg, options) {
        if (msg.type === 'personalCaptureChallenge' || msg.type === 'personalCaptureAlive') {
          expect(tabId).toBe(7);
          expect(options).toEqual({ documentId: 'document-one', frameId: 0 });
          if (!alive) throw new Error('Document gone');
          return { ok: msg.type === 'personalCaptureChallenge' ? challenge : true,
            ...(msg.type === 'personalCaptureChallenge' ? { text: msg.text } : {}) };
        }
        return undefined;
      },
    },
    contextMenus: { removeAll(callback) { callback(); }, create() {}, onClicked: event(clicks) },
    action: { async setBadgeText() {} }, alarms: { create() {}, onAlarm: event([]) },
    permissions: { async getAll() { return { origins }; }, onAdded: event(added), onRemoved: event(removed) },
    scripting: { async getRegisteredContentScripts() { return []; }, async registerContentScripts() {},
      async updateContentScripts() {}, async unregisterContentScripts() {} },
  };
  globalThis.fetch = async (endpoint, init) => {
    if (String(endpoint).endsWith('manifest.json')) return { ok: true, json: async () => ({ version: '0.10.0' }) };
    modelCalls++;
    if (!modelEnabled) throw new Error('No network allowed in capture test');
    const user = JSON.parse(init.body).contents[0].parts[0].text;
    const passages = JSON.parse(user.replace(/^Passages:\n/, ''));
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{
      text: JSON.stringify({ passages: passages.map(({ id: passageId }) => ({ id: passageId,
        swaps: [{ o: 'shimmer', f: 'brillar', ctx: '' }] })) }),
    }] } }] }) };
  };
  const send = (msg, sender = page) => new Promise((resolve) => {
    if (!messages.some((fn) => fn(msg, sender, resolve))) resolve(undefined);
  });
  const captureSender = (nonce) => ({ id, url: `chrome-extension://${id}/src/capture.html?nonce=${nonce}` });
  const click = async (selectionText, extra = {}) => {
    const before = opened.length;
    clicks[0]({ menuItemId: 'lang-weave-add-selection', selectionText, frameId: 0,
      editable: false, pageUrl: url, ...extra }, { id: 7, title });
    for (let i = 0; i < 100 && opened.length === before; i++) await new Promise((resolve) => setTimeout(resolve, 1));
    expect(opened.length).toBe(before + 1);
    return new URL(opened.at(-1)).searchParams.get('nonce');
  };
  const hold = () => new Promise((resolve) => { entered = resolve; holdNextTab = true; });
  try {
    await import('../src/background.js?personal-worker');
    await send({ type: 'config' }); // production content-script handshake records the exact document
    expect(clicks).toHaveLength(1);
    const nonce = await click('glimmer');
    const owner = captureSender(nonce);
    expect((await send({ type: 'captureDraft', nonce }, owner)).selectedText).toBe('glimmer');
    const forged = await send({ type: 'captureSave', nonce, direction: 'en-to-target',
      source: 'glimmer', target: 'brillo', sense: '' }, page);
    expect(forged).toBeUndefined();
    expect((await send({ type: 'captureSave', nonce: 'forged-nonce', direction: 'en-to-target',
      source: 'glimmer', target: 'brillo', sense: '' }, owner)).error).toMatch(/expired|changed/i);
    failPersonalWrite = true;
    const fields = { type: 'captureSave', nonce, direction: 'en-to-target',
      source: 'glimmer', target: 'brillo', sense: '' };
    expect((await send(fields, owner)).error).toMatch(/could not be saved/i);
    expect(data.personalVocabularyV1).toBeUndefined();
    failPersonalWrite = false;
    const [saved, concurrent] = await Promise.all([send(fields, owner), send(fields, owner)]);
    expect(saved.ok).toBe(true);
    expect(saved.reviewOnly).toBe(false);
    expect(concurrent.id).toBe(saved.id); // one write and one idempotent receipt
    expect((await send(fields, owner)).id).toBe(saved.id); // later retry cannot create a second entry
    expect(data.personalVocabularyV1.entries).toHaveLength(1);
    expect(data.personalVocabularyV1.history.es?.cards[saved.id]).toBeUndefined(); // Save did not introduce
    expect(data.recallReview).toBeUndefined();
    expect(modelCalls).toBe(0);

    const manual = await send({ type: 'personalIntroduce', id: saved.id }, owner);
    expect(manual.added).toBe(true);
    const queued = await send({ type: 'reviewNext' }, { id, url: `chrome-extension://${id}/src/review.html` });
    expect(queued.card.en).toBe('glimmer');
    const reviewer = { id, url: `chrome-extension://${id}/src/review.html` };
    expect((await send({ type: 'reviewReveal', ticket: queued.card.ticket }, reviewer)).answer.fr).toBe('brillo');
    const rated = await send({ type: 'reviewRate', ticket: queued.card.ticket, rating: 'again' }, reviewer);
    expect(rated.interval).toBe(0);
    expect(data.personalVocabularyV1.history.es.cards[saved.id].reviews).toBe(1);
    expect(data.personalVocabularyV1.history.es.cards[saved.id].due).toBeGreaterThan(Date.now());
    const personalDue = data.personalVocabularyV1.history.es.cards[saved.id].due;
    expect(await send({ type: 'reviewStatus' }, reviewer)).toMatchObject({
      nextDue: personalDue, nextCount: 1,
    });
    expect(await send({ type: 'reviewNext' }, reviewer)).toMatchObject({
      card: null, nextDue: personalDue, nextCount: 1,
    });
    const previousLegacy = data[REVIEW_KEY];
    data[REVIEW_KEY] = { version: 1, cards: { y: { due: personalDue, interval: 1, reviews: 1 } } };
    expect(await send({ type: 'reviewStatus' }, reviewer)).toMatchObject({
      nextDue: personalDue, nextCount: 2,
    });
    data[REVIEW_KEY] = previousLegacy;

    // Save with a configured model must not start a reading retry or provider request.
    data.apiKey = 'synthetic-key';
    modelEnabled = true;
    const beforeSaveCalls = modelCalls, beforeSaveBroadcasts = broadcastQueries;
    const beforeSaveRevision = (await send({ type: 'config' })).revision;
    // A second ordinary personal entry enters the budgeted adaptive path only after visible ack.
    const shimmerNonce = await click('shimmer');
    const shimmerOwner = captureSender(shimmerNonce);
    const shimmerSaved = await send({ type: 'captureSave', nonce: shimmerNonce, direction: 'en-to-target',
      source: 'shimmer', target: 'brillar', sense: '' }, shimmerOwner);
    expect(shimmerSaved.reviewOnly).toBe(false);
    const sparkNonce = await click('spark');
    const sparkSaved = await send({ type: 'captureSave', nonce: sparkNonce, direction: 'en-to-target',
      source: 'spark', target: 'chispa', sense: '' }, captureSender(sparkNonce));
    expect(sparkSaved.reviewOnly).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(modelCalls).toBe(beforeSaveCalls);
    expect(broadcastQueries).toBe(beforeSaveBroadcasts);
    const stalePassage = 'We saw shimmer around the quiet garden today.';
    expect((await send({ type: 'swaps', revision: beforeSaveRevision,
      items: [{ key: `${beforeSaveRevision}:${hashKey(stalePassage)}`, text: stalePassage }] })).stale).toBe(true);
    expect((await send({ type: 'introAck', revision: beforeSaveRevision,
      word: 'brillar', ticket: crypto.randomUUID() })).stale).toBe(true);
    expect(modelCalls).toBe(beforeSaveCalls); // stale traffic cannot start a provider call or charge learning
    expect(data.personalVocabularyV1.history.es?.learning?.count || 0).toBe(0);
    const revision = (await send({ type: 'config' })).revision;
    const passage = 'We saw shimmer around the quiet garden today.';
    const request = () => send({ type: 'swaps', revision,
      items: [{ key: `${revision}:${hashKey(passage)}`, text: passage } ] });
    const proposed = await request();
    const swap = Object.values(proposed.results).flat().find((item) => item.word === 'brillar');
    if (!swap) throw new Error(`Missing personal swap: ${JSON.stringify(proposed)}`);
    expect(swap.status).toBe('new');
    expect(swap.introTicket).toBeString();
    expect(data.personalVocabularyV1.history.es.cards[shimmerSaved.id]).toBeUndefined();
    expect(data.personalVocabularyV1.history.es.learning.count).toBe(0);
    expect((await send({ type: 'introAck', word: swap.word, ticket: swap.introTicket, revision })).ok).toBe(true);
    expect(data.personalVocabularyV1.history.es.cards[shimmerSaved.id].reviews).toBe(0);
    expect(data.personalVocabularyV1.history.es.learning.count).toBe(1);
    expect((await send({ type: 'event', word: 'brillar', event: 'seen', revision })).ok).toBe(true);
    expect(data['lang:personal:es:readingEvents'][0].word).toBe(shimmerSaved.id);
    expect(data['lang:personal:es:vocabularyEncounters'].counts[shimmerSaved.id]).toBeGreaterThan(0);
    const beforeBlocked = modelCalls;
    const sparkPassage = 'We saw spark around the quiet garden today.';
    const blocked = await send({ type: 'swaps', revision,
      items: [{ key: `${revision}:${hashKey(sparkPassage)}`, text: sparkPassage }] });
    expect(Object.values(blocked.results).flat()).toEqual([]);
    expect(modelCalls).toBe(beforeBlocked);
    expect(data.personalVocabularyV1.history.es.cards[sparkSaved.id]).toBeUndefined();
    const actualNow = Date.now;
    Date.now = () => actualNow() + 86400000;
    try {
      const cue = await send({ type: 'inlineBegin', word: 'brillar', revision });
      expect(cue.ticket).toBeString();
      expect((await send({ type: 'inlineReveal', ticket: cue.ticket, revision })).answer.fr).toBe('brillar');
      expect((await send({ type: 'inlineRate', ticket: cue.ticket, revision, rating: 'again' })).interval).toBe(0);
    } finally { Date.now = actualNow; }
    expect((await send({ type: 'personalArchive', id: saved.id, archived: true }, owner)).ok).toBe(true);
    expect(data.personalVocabularyV1.history.es.cards[saved.id].reviews).toBe(1);
    expect((await send({ type: 'personalArchive', id: saved.id, archived: false }, owner)).ok).toBe(true);
    const exported = JSON.parse((await send({ type: 'personalExport' }, owner)).json);
    expect(exported.entries[0].id).toBe(saved.id);
    expect(exported.history.es.cards[saved.id].reviews).toBe(1);
    expect(exported.feedback.es.events.some((event) => event.word === shimmerSaved.id)).toBe(true);
    expect(JSON.stringify(exported)).not.toMatch(/reading\.example|document-one|apiKey|\/story/);
    expect(JSON.stringify(exported)).not.toMatch(/ownerKey|documentId|introReceipt|"pending"|"inline"|"current"/);

    const known = L2_WORDS.find((word) => word.fr === 'el gato');
    const knownNonce = await click(known.en);
    const knownOwner = captureSender(knownNonce);
    expect((await send({ type: 'captureDraft', nonce: knownNonce }, knownOwner)).matches
      .some((item) => item.target === known.fr)).toBe(true);
    const linked = await send({ type: 'captureSave', nonce: knownNonce,
      direction: 'en-to-target', source: known.en, target: known.fr, sense: '' }, knownOwner);
    expect(linked.reviewOnly).toBe(true);
    expect(data.personalVocabularyV1.entries.find((entry) => entry.id === linked.id).linkedLegacy).toContain('legacy');
    const collisionNonce = await click(known.en);
    const collisionOwner = captureSender(collisionNonce);
    const collision = { type: 'captureSave', nonce: collisionNonce, direction: 'en-to-target',
      source: known.en, target: 'la gata', sense: 'female cat' };
    expect((await send(collision, collisionOwner)).error).toMatch(/distinct meaning/i);
    const distinct = await send({ ...collision, distinct: true }, collisionOwner);
    expect(distinct.reviewOnly).toBe(true);
    expect(distinct.id).not.toBe(linked.id);
    expect((await send({ type: 'personalIntroduce', id: distinct.id }, collisionOwner)).added).toBe(true);
    const distinctQueue = await send({ type: 'reviewNext' }, reviewer);
    expect(distinctQueue.card.en).toBe(known.en);
    expect((await send({ type: 'reviewReveal', ticket: distinctQueue.card.ticket }, reviewer)).answer.fr).toBe('la gata');
    expect((await send({ type: 'reviewRate', ticket: distinctQueue.card.ticket, rating: 'hard' }, reviewer)).interval).toBe(1);
    expect(data.personalVocabularyV1.history.es.cards[distinct.id].reviews).toBe(1);
    expect(data.personalVocabularyV1.history.es.cards[linked.id]).toBeUndefined();
    const targetNonce = await click('brisa');
    const targetOwner = captureSender(targetNonce);
    const targetSaved = await send({ type: 'captureSave', nonce: targetNonce,
      direction: 'target-to-en', source: 'breeze', target: 'brisa', sense: '' }, targetOwner);
    expect(targetSaved.ok).toBe(true);
    expect(data.personalVocabularyV1.entries.find((entry) => entry.id === targetSaved.id).direction).toBe('target-to-en');

    // Canonical-language personal identity/history outlives removal of a generated pack scope.
    const frenchPack = { words: Array.from({ length: 20 }, (_, i) => ({
      fr: `mot${i}`, en: `anchor${i}`, hint: 'moh', level: i < 10 ? 1 : 2,
    })) };
    data.languagePacks = { fr: frenchPack };
    expect((await send({ type: 'save', settings: { language: 'fr' } }, popup)).ok).toBe(true);
    const packRevision = (await send({ type: 'config' })).revision;
    const packNonce = await click('anchor0');
    const packMatch = await send({ type: 'captureSave', nonce: packNonce,
      direction: 'en-to-target', source: 'anchor0', target: 'mot0', sense: '' }, captureSender(packNonce));
    expect(packMatch.reviewOnly).toBe(true); // separate durable ID, pack still teaches this exact meaning
    expect((await send({ type: 'config' })).revision).toBe(packRevision);
    const frenchNonce = await click('sunbeam');
    const frenchOwner = captureSender(frenchNonce);
    const frenchSaved = await send({ type: 'captureSave', nonce: frenchNonce,
      direction: 'en-to-target', source: 'sunbeam', target: 'rayon', sense: '' }, frenchOwner);
    expect(frenchSaved.ok).toBe(true);
    expect((await send({ type: 'personalIntroduce', id: frenchSaved.id }, frenchOwner)).added).toBe(true);
    const frenchCard = structuredClone(data.personalVocabularyV1.history.fr.cards[frenchSaved.id]);
    data['lang:personal:fr:readingEvents'] = [{ word: frenchSaved.id, kind: 'seen', day: localDay() }];
    expect((await send({ type: 'removeLanguage', code: 'fr' }, options)).ok).toBe(true);
    expect(data.personalVocabularyV1.entries.find((entry) => entry.id === frenchSaved.id).target).toBe('rayon');
    expect(data.personalVocabularyV1.history.fr.cards[frenchSaved.id]).toEqual(frenchCard);
    expect(data['lang:personal:fr:readingEvents'][0].word).toBe(frenchSaved.id);
    data.languagePacks = { fr: frenchPack };
    expect((await send({ type: 'save', settings: { language: 'fr' } }, popup)).ok).toBe(true);
    expect(data.personalVocabularyV1.history.fr.cards[frenchSaved.id]).toEqual(frenchCard);
    await send({ type: 'save', settings: { language: 'es' } }, popup);

    // A permission event during the final awaited tabs.get invalidates Save even if regranted later.
    const staleNonce = await click('spark');
    const staleOwner = captureSender(staleNonce);
    const wait = hold();
    const pending = send({ type: 'captureSave', nonce: staleNonce, direction: 'en-to-target',
      source: 'spark', target: 'chispa', sense: '' }, staleOwner);
    await wait;
    origins = [];
    const revocation = removed[0]();
    release();
    expect((await pending).error).toMatch(/expired|changed/i);
    await revocation;
    expect(data.personalVocabularyV1.entries).toHaveLength(8);
    origins = ['<all_urls>']; await added[0]();

    const reboundNonce = await click('radiance');
    const reboundOwner = captureSender(reboundNonce);
    const waitRebound = hold();
    const pendingRebound = send({ type: 'captureSave', nonce: reboundNonce, direction: 'en-to-target',
      source: 'radiance', target: 'resplandor', sense: '' }, reboundOwner);
    await waitRebound;
    origins = [];
    const removedOnce = removed[0]();
    origins = ['<all_urls>'];
    const addedBack = added[0]();
    release();
    expect((await pendingRebound).error).toMatch(/expired|changed/i);
    await Promise.all([removedOnce, addedBack]);
    expect(data.personalVocabularyV1.entries).toHaveLength(8);

    const siteNonce = await click('luster');
    const siteOwner = captureSender(siteNonce);
    const waitSite = hold();
    const pendingSite = send({ type: 'captureSave', nonce: siteNonce, direction: 'en-to-target',
      source: 'luster', target: 'lustre', sense: '' }, siteOwner);
    await waitSite;
    const siteOff = send({ type: 'save', settings: { enabled: false } }, popup);
    release();
    expect((await pendingSite).error).toMatch(/expired|changed/i);
    await siteOff;
    expect(data.personalVocabularyV1.entries).toHaveLength(8);
    await send({ type: 'save', settings: { enabled: true } }, popup);

    const navNonce = await click('gleam');
    liveUrl = 'https://reading.example/new-document';
    expect((await send({ type: 'captureSave', nonce: navNonce, direction: 'en-to-target',
      source: 'gleam', target: 'brillo', sense: '' }, captureSender(navNonce))).error).toMatch(/expired|changed/i);
    liveUrl = url;
    expect(data.personalVocabularyV1.entries).toHaveLength(8);

    const reloadNonce = await click('glow');
    alive = false; // same URL, old document is gone
    expect((await send({ type: 'captureSave', nonce: reloadNonce, direction: 'en-to-target',
      source: 'glow', target: 'resplandecer', sense: '' }, captureSender(reloadNonce))).error).toMatch(/expired|changed/i);
    alive = true;

    for (const override of [{ frameId: 1 }, { editable: true }, { linkUrl: 'https://reading.example/link' },
      { selectionText: 'x'.repeat(81) }, { pageUrl: 'https://reading.example/account' }]) {
      const invalid = await click('word', override);
      expect(typeof (await send({ type: 'captureDraft', nonce: invalid }, captureSender(invalid))).error).toBe('string');
    }
    title = 'Medication advice';
    const sensitive = await click('word');
    expect((await send({ type: 'captureDraft', nonce: sensitive }, captureSender(sensitive))).error).toMatch(/off|unavailable/i);
    title = 'Reading';
    origins = [];
    const noPermission = await click('word');
    expect((await send({ type: 'captureDraft', nonce: noPermission }, captureSender(noPermission))).error).toMatch(/off|unavailable/i);
    origins = ['<all_urls>'];

    data.personalVocabularyV1.history.es.learning = { day: '2099-01-01', count: 1, pending: [] };
    data.personalVocabularyV1.history.es.cards[shimmerSaved.id].introducedDay = '2099-01-01';
    const budgetStatus = await send({ type: 'status' }, popup);
    expect(budgetStatus.budgetWarning).toBe('2099-01-01');
    expect((await send({ type: 'recoverBudget', confirm: true, day: '2099-01-01',
      scope: budgetStatus.config.scope }, popup)).ok).toBe(true);
    expect(data.personalVocabularyV1.history.es.learning).toEqual({ day: localDay(), count: 0, pending: [] });
    expect(data.personalVocabularyV1.history.es.cards[shimmerSaved.id].introGateDay).toBe(localDay());

    // Canonical generated-language casing remains part of personal identity.
    data.languagePacks['pt-BR'] = { words: Array.from({ length: 20 }, (_, i) => ({
      fr: `forma${i}`, en: `anchor${i}`, hint: 'form', level: i < 10 ? 1 : 2,
    })) };
    expect((await send({ type: 'save', settings: { language: 'pt-BR' } }, popup)).ok).toBe(true);
    const regionalNonce = await click('gleam');
    const regionalSaved = await send({ type: 'captureSave', nonce: regionalNonce,
      direction: 'en-to-target', source: 'gleam', target: 'brilho', sense: '' }, captureSender(regionalNonce));
    expect(regionalSaved.ok).toBe(true);
    expect(data.personalVocabularyV1.entries.find((entry) => entry.id === regionalSaved.id).language).toBe('pt-BR');
    expect((await send({ type: 'personalList' }, captureSender(regionalNonce))).entries
      .find((entry) => entry.id === regionalSaved.id).reviewOnly).toBe(false);
    await send({ type: 'save', settings: { language: 'es' } }, popup);

    alive = false;
    const missing = await click('dazzle');
    expect((await send({ type: 'captureDraft', nonce: missing }, captureSender(missing))).error).toMatch(/document|selection/i);
    alive = true; challenge = false;
    const denied = await click('dazzle');
    expect((await send({ type: 'captureDraft', nonce: denied }, captureSender(denied))).error).toMatch(/selection|document/i);
    challenge = true;
    const intact = structuredClone(data.personalVocabularyV1);
    data.personalVocabularyV1 = { version: 1, entries: [{ invalid: true }], history: intact.history };
    const malformed = structuredClone(data.personalVocabularyV1);
    const unsupportedRevision = (await send({ type: 'config' })).revision;
    const catPassage = 'We saw cat around the quiet garden today.';
    await send({ type: 'swaps', revision: unsupportedRevision,
      items: [{ key: `${unsupportedRevision}:${hashKey(catPassage)}`, text: catPassage }] });
    expect(data.personalVocabularyV1).toEqual(malformed); // reading cannot overwrite an unsupported store
    data.personalVocabularyV1 = intact;
    const restartNonce = await click('renewal');
    messages.length = 0; clicks.length = 0; removed.length = 0; added.length = 0;
    await import('../src/background.js?personal-worker-restart');
    expect((await send({ type: 'captureDraft', nonce: restartNonce }, captureSender(restartNonce))).error).toMatch(/expired/i);
    expect((await send({ type: 'captureSave', nonce: restartNonce, direction: 'en-to-target',
      source: 'renewal', target: 'renovación', sense: '' }, captureSender(restartNonce))).error).toMatch(/expired|changed/i);
    await send({ type: 'captureReady' }); // right-click re-announces the live document after worker restart
    const resumedNonce = await click('renewal');
    expect((await send({ type: 'captureDraft', nonce: resumedNonce }, captureSender(resumedNonce))).selectedText).toBe('renewal');
    expect(modelCalls).toBeGreaterThanOrEqual(1);
  } finally { Object.assign(globalThis, prior); }
}, 30000);

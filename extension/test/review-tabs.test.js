import { expect, test } from 'bun:test';
import { createReviewTabs } from '../src/review-tabs.js';

const base = 'chrome-extension://review-test/';
const url = base + 'src/review.html';
const reviewTab = (id, windowId, extra = {}) => ({ id, windowId, url, incognito: false, ...extra });

function browser(initial, hooks = {}) {
  const tabsById = new Map(initial.map((tab) => [tab.id, tab]));
  const calls = [];
  const windows = {
    get: async (id) => ({ id, incognito: id === 2 }),
    getLastFocused: async () => ({ id: 1, incognito: false }),
    update: async (id, change) => { calls.push(['window', id, change]); },
  };
  const tabs = {
    query: async (query) => {
      expect(query).toEqual({ url });
      return [...tabsById.values()].map((tab) => ({ ...tab }));
    },
    get: async (id) => {
      hooks.beforeGet?.(tabsById, id);
      const tab = tabsById.get(id);
      if (!tab) throw new Error('No such tab');
      return { ...tab };
    },
    update: async (id, change) => {
      calls.push(['tab', id, change]);
      hooks.beforeUpdate?.(tabsById, id);
      if (!tabsById.has(id)) throw new Error('No such tab');
      return { ...tabsById.get(id), ...change };
    },
    create: async (fields) => {
      calls.push(['create', fields]);
      await hooks.beforeCreate?.();
      const tab = reviewTab(99, fields.windowId, { url: undefined, pendingUrl: fields.url });
      tabsById.set(tab.id, tab);
      return tab;
    },
    sendMessage: async (id, payload, target) => {
      calls.push(['message', id, payload, target]);
      hooks.beforeMessage?.(tabsById, id);
      return { ok: true };
    },
  };
  const runtime = {
    getURL: (path) => base + path,
    getContexts: async (filter) => {
      calls.push(['contexts', filter]);
      return [{ documentId: 'review-document' }];
    },
  };
  return { open: createReviewTabs({ tabs, windows, runtime }), calls };
}

test('simultaneous review requests reuse the one pending tab, preserving its document', async () => {
  const { promise, resolve } = Promise.withResolvers();
  const { open, calls } = browser([reviewTab(5, 1, { url: url + '#untrusted' })], { beforeCreate: () => promise });
  const first = open(1);
  const concurrent = open(3);
  resolve();
  expect(await Promise.all([first, concurrent])).toEqual([{ ok: true }, { ok: true }]);
  expect(calls).toEqual([
    ['create', { url, windowId: 1 }], ['window', 1, { focused: true }],
    ['tab', 99, { active: true }], ['window', 1, { focused: true }],
  ]);
});

test('a private origin cannot focus a regular review or start a practice ticket', async () => {
  const { open, calls } = browser([reviewTab(4, 1), reviewTab(5, 2, { incognito: true })]);
  const chooseWord = () => { throw new Error('Private practice reached the queue'); };
  expect(await open(2, chooseWord)).toHaveProperty('error');
  expect(await open(2)).toHaveProperty('error');
  expect(calls).toEqual([]);
});

test('practice skips a navigated page and falls through when the next candidate closes', async () => {
  const { open, calls } = browser([reviewTab(4, 1), reviewTab(5, 1), reviewTab(6, 3)], {
    beforeGet: (tabs, id) => {
      if (id === 4) tabs.get(id).url = 'https://unrelated.example/';
    },
    beforeUpdate: (tabs, id) => { if (id === 5) tabs.delete(id); },
  });
  const refused = { error: 'Stale scope', stale: true };
  expect(await open(1, () => refused)).toEqual(refused);
  expect(calls).toEqual([]);
  const chosen = { ok: true, introduced: false };
  expect(await open(1, () => { calls.push(['choose']); return chosen; })).toEqual(chosen);
  expect(calls).toEqual([
    ['choose'], ['tab', 5, { active: true }], ['tab', 6, { active: true }], ['window', 3, { focused: true }],
    ['contexts', { contextTypes: ['TAB'], tabIds: [6], documentUrls: [url], frameIds: [0], incognito: false }],
    ['message', 6, { type: 'refreshReview' }, { documentId: 'review-document' }],
  ]);
});

test('a review that navigates before document delivery falls back to one new page', async () => {
  const { open, calls } = browser([reviewTab(4, 1)], {
    beforeMessage: (tabs, id) => {
      tabs.get(id).url = 'https://unrelated.example/';
      throw new Error('No receiving document');
    },
  });
  let chosen = 0;
  expect(await open(1, () => { chosen++; return { ok: true }; })).toEqual({ ok: true });
  expect(chosen).toBe(1);
  expect(calls.filter(([type]) => type === 'create')).toEqual([['create', { url, windowId: 1 }]]);
});

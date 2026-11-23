import { expect, test } from 'bun:test';
import { createReviewTabs } from '../src/review-tabs.js';

const base = 'chrome-extension://review-test/';
const url = base + 'src/review.html';
const exactFilter = { contextTypes: ['TAB'], documentUrls: [url], frameIds: [0], incognito: false };
const reviewTab = (id, windowId, extra = {}) => ({
  id, windowId, status: 'complete', active: false, incognito: false,
  documentUrl: url, documentId: `document-${id}`, frameId: 0, contextType: 'TAB', ...extra,
});

function browser(initial, hooks = {}) {
  const tabsById = new Map(initial.map((tab) => [tab.id, tab]));
  const calls = [];
  const reads = [];
  const discoveries = [];
  const windows = {
    get: async (id) => ({ id, incognito: id === 2 }),
    getLastFocused: async () => ({ id: 1, incognito: false }),
    update: async (id, change) => { calls.push(['window', id, change]); },
  };
  const tabs = {
    get: async (id) => {
      reads.push(id);
      hooks.beforeGet?.(tabsById, id);
      const tab = tabsById.get(id);
      if (!tab) throw new Error('No such tab');
      // Chrome 140 exposes no own Tab.url, nor a protected pending URL.
      const { documentUrl, documentId, contextType, frameId, ...visible } = tab;
      return visible;
    },
    update: async (id, change) => {
      calls.push(['tab', id, change]);
      hooks.beforeUpdate?.(tabsById, id);
      if (!tabsById.has(id)) throw new Error('No such tab');
      Object.assign(tabsById.get(id), change);
    },
    create: async (fields) => {
      calls.push(['create', fields]);
      const tab = reviewTab(99, fields.windowId, { active: true });
      tabsById.set(tab.id, tab);
      hooks.afterCreate?.(tab);
      return { id: tab.id, windowId: tab.windowId };
    },
    sendMessage: async (id, payload, target) => {
      calls.push(['message', id, payload, target]);
      hooks.beforeMessage?.(tabsById, id);
      const tab = tabsById.get(id);
      if (!tab || tab.documentId !== target.documentId) throw new Error('No receiving document');
      return tab.reply === undefined ? { ok: true } : tab.reply;
    },
  };
  const runtime = {
    getURL: (path) => base + path,
    getContexts: async (filter) => {
      const { tabIds, ...scope } = filter;
      expect(scope).toEqual(exactFilter);
      discoveries.push(tabIds);
      hooks.beforeContexts?.(tabsById, tabIds);
      return [...tabsById.values()].filter((tab) => tab.documentId &&
        (!tabIds || tabIds.includes(tab.id)) && tab.documentUrl === url &&
        !tab.incognito && tab.frameId === 0 && tab.contextType === 'TAB'
      ).map(({ id, windowId, documentId }) => ({ tabId: id, windowId, documentId }));
    },
  };
  return { open: createReviewTabs({ tabs, windows, runtime }), calls, reads, discoveries, tabsById };
}

test('simultaneous review opens create one tab while Chrome has no URL or document context yet', async () => {
  const pendingRead = Promise.withResolvers();
  const { open, calls, tabsById } = browser([], {
    afterCreate: (tab) => Object.assign(tab, { status: 'loading', documentId: undefined }),
    beforeGet: (tabs, id) => { if (tabs.get(id)?.status === 'loading') pendingRead.resolve(); },
  });
  const first = open(1);
  const concurrent = open(3);
  await pendingRead.promise;
  expect(calls).toEqual([['create', { url, windowId: 1 }]]);
  Object.assign(tabsById.get(99), { status: 'complete', documentId: 'new-document' });
  expect(await Promise.all([first, concurrent])).toEqual([{ ok: true }, { ok: true }]);
  expect(calls).toEqual([
    ['create', { url, windowId: 1 }], ['window', 1, { focused: true }], ['window', 1, { focused: true }],
  ]);
});

test('retrying a slow new Review reuses the same pending tab', async () => {
  let retrying = false;
  const pendingRead = Promise.withResolvers();
  const { open, calls, tabsById } = browser([], {
    afterCreate: (tab) => Object.assign(tab, { status: 'loading', documentId: undefined }),
    beforeGet: (_tabs, id) => { if (retrying && id === 99) pendingRead.resolve(); },
  });
  await expect(open(1)).rejects.toThrow('still loading');
  retrying = true;
  const retry = open(3);
  await pendingRead.promise;
  expect(calls).toEqual([['create', { url, windowId: 1 }]]);
  Object.assign(tabsById.get(99), { status: 'complete', documentId: 'new-document' });
  expect(await retry).toEqual({ ok: true });
  expect(calls).toEqual([['create', { url, windowId: 1 }], ['window', 1, { focused: true }]]);
});

test('a private origin cannot focus a regular review or start a practice ticket', async () => {
  const { open, calls, discoveries } = browser([reviewTab(4, 1), reviewTab(5, 2, { incognito: true })]);
  const chooseWord = () => { throw new Error('Private practice reached the queue'); };
  expect(await open(2, chooseWord)).toHaveProperty('error');
  expect(await open(2)).toHaveProperty('error');
  expect(calls).toEqual([]);
  expect(discoveries).toEqual([]);
});

test('ordinary Open Review prefers an active review in the source window and only focuses it', async () => {
  const { open, calls } = browser([reviewTab(3, 4, { active: true }), reviewTab(5, 1), reviewTab(6, 1, { active: true })]);
  expect(await open(1)).toEqual({ ok: true });
  expect(calls).toEqual([['window', 1, { focused: true }]]);
});

test('discovery does not read protected, other extension, subframe or private tabs', async () => {
  const { open, calls, reads } = browser([
    reviewTab(1, 1, { documentUrl: 'chrome://version/' }),
    reviewTab(2, 1, { documentUrl: base + 'src/options.html' }),
    reviewTab(3, 1, { documentUrl: 'chrome-extension://other/src/review.html' }),
    reviewTab(4, 1, { documentUrl: url + '#other' }),
    reviewTab(5, 1, { frameId: 2 }),
    reviewTab(6, 2, { incognito: true }),
    reviewTab(7, 1, { contextType: 'SIDE_PANEL' }),
  ]);
  expect(await open(1)).toEqual({ ok: true });
  expect(new Set(reads)).toEqual(new Set([99]));
  expect(calls).toEqual([['create', { url, windowId: 1 }], ['window', 1, { focused: true }]]);
});

test('practice preserves queue errors and skips a visible pending departure and a closing tab', async () => {
  const { open, calls, discoveries } = browser([
    reviewTab(4, 1, { url, pendingUrl: base + 'src/options.html' }), reviewTab(5, 1), reviewTab(6, 3),
  ], { beforeUpdate: (tabs, id) => { if (id === 5) tabs.delete(id); } });
  const refused = { error: 'Stale scope', stale: true };
  expect(await open(1, () => refused)).toEqual(refused);
  expect(calls).toEqual([]);
  expect(discoveries).toEqual([]);
  const chosen = { ok: true, introduced: false };
  expect(await open(1, () => { calls.push(['choose']); return chosen; })).toEqual(chosen);
  expect(calls).toEqual([
    ['choose'], ['tab', 5, { active: true }], ['tab', 6, { active: true }], ['window', 3, { focused: true }],
    ['message', 6, { type: 'refreshReview' }, { documentId: 'document-6' }],
  ]);
});

test.each([false, true])('a committed departure with a slow destination skips the tab (fallback: %s)', async (alternate) => {
  let checks = 0;
  const tabs = [reviewTab(4, 1, { status: 'loading' })];
  if (alternate) tabs.push(reviewTab(8, 3, { active: true }));
  const { open, calls } = browser(tabs, {
    beforeContexts: (tabs, ids) => {
      // Chrome keeps the old document visible until commit. The destination
      // stays loading after commit and both of its URL fields are hidden.
      if (ids?.includes(4) && ++checks === 2) tabs.get(4).documentUrl = 'https://unrelated.example/';
    },
  });
  expect(await open(1, () => ({ ok: true }))).toEqual({ ok: true });
  expect(calls).toEqual(alternate
    ? [['window', 3, { focused: true }], ['message', 8, { type: 'refreshReview' }, { documentId: 'document-8' }]]
    : [['create', { url, windowId: 1 }], ['window', 1, { focused: true }]]);
});

test('a still-loading candidate does not block another ready Review', async () => {
  const { open, calls } = browser([reviewTab(4, 1, { status: 'loading' }), reviewTab(8, 3, { active: true })]);
  expect(await open(1)).toEqual({ ok: true });
  expect(calls).toEqual([['window', 3, { focused: true }]]);
});

test('a tab that leaves review during activation never receives a window focus or refresh', async () => {
  const { open, calls } = browser([reviewTab(4, 3)], {
    beforeUpdate: (tabs, id) => Object.assign(tabs.get(id), { documentUrl: 'chrome://version/', documentId: 'protected' }),
  });
  expect(await open(1, () => ({ ok: true }))).toEqual({ ok: true });
  expect(calls).toEqual([
    ['tab', 4, { active: true }],
    ['create', { url, windowId: 1 }], ['window', 1, { focused: true }],
  ]);
});

test('navigation before directed delivery leaves practice selected and creates one new review', async () => {
  const { open, calls } = browser([reviewTab(4, 1)], {
    beforeMessage: (tabs, id) => Object.assign(tabs.get(id), { documentUrl: base + 'src/words.html', documentId: 'words' }),
  });
  let chosen = 0;
  expect(await open(1, () => { chosen++; return { ok: true }; })).toEqual({ ok: true });
  expect(chosen).toBe(1);
  expect(calls.filter(([type]) => type === 'message' || type === 'create')).toEqual([
    ['message', 4, { type: 'refreshReview' }, { documentId: 'document-4' }],
    ['create', { url, windowId: 1 }],
  ]);
});

test('a same-tab reload updates the targeted document and never opens another tab', async () => {
  const { open, calls } = browser([reviewTab(4, 1)], {
    beforeMessage: (tabs, id) => { tabs.get(id).documentId = 'reloaded-document'; },
  });
  expect(await open(1, () => ({ ok: true }))).toEqual({ ok: true });
  expect(calls.filter(([type]) => type === 'message' || type === 'create')).toEqual([
    ['message', 4, { type: 'refreshReview' }, { documentId: 'document-4' }],
    ['message', 4, { type: 'refreshReview' }, { documentId: 'reloaded-document' }],
  ]);
});

test('an unacknowledged refresh surfaces an error without duplicating a live review', async () => {
  const { open, calls } = browser([reviewTab(4, 1, { active: true, reply: null })]);
  await expect(open(1, () => ({ ok: true }))).rejects.toThrow('could not refresh');
  expect(await open(1)).toEqual({ ok: true });
  expect(calls).toEqual([
    ['window', 1, { focused: true }], ['message', 4, { type: 'refreshReview' }, { documentId: 'document-4' }],
    ['window', 1, { focused: true }],
  ]);
});

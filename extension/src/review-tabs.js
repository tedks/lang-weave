const LOAD_TIMEOUT_MS = 1000;
const LOAD_POLL_MS = 25;

// One worker serializes popup, shortcut and My words opens. Chrome's own
// Review documents are discoverable again after an MV3 worker restart.
export function createReviewTabs({ tabs, windows, runtime }) {
  const url = runtime.getURL('src/review.html');
  const filter = { contextTypes: ['TAB'], documentUrls: [url], frameIds: [0], incognito: false };
  const contexts = (tabIds) => runtime.getContexts(tabIds ? { ...filter, tabIds } : filter);
  let opens = Promise.resolve();
  let openingTabId;

  async function readTab(id) {
    const tab = await tabs.get(id).catch(() => null);
    // Chrome 140 can omit both URL fields. A visible mismatch still rules
    // out this tab, but only a matching document context can establish identity.
    const visibleUrl = tab?.pendingUrl || tab?.url;
    return tab && !tab.incognito && !tab.discarded && (!visibleUrl || visibleUrl === url) ? tab : null;
  }

  async function currentReview(id) {
    const deadline = performance.now() + LOAD_TIMEOUT_MS;
    do {
      let tab = await readTab(id);
      if (!tab || tab.status === 'unloaded') return null;
      // A context can predate its listener on startup and outlive the start
      // of a navigation away, even when Chrome hides the pending URL.
      if (tab.status === 'complete') {
        const [document] = await contexts([id]);
        tab = await readTab(id);
        if (!tab || tab.status === 'unloaded') return null;
        if (tab.status === 'complete' && (!document || document.windowId === tab.windowId)) {
          return document?.documentId ? { tab, documentId: document.documentId } : null;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, LOAD_POLL_MS));
    } while (performance.now() < deadline);
    throw new Error('The Lang Weave review is still loading. Try again.');
  }

  async function refreshReview(id, review) {
    for (let attempt = 0; attempt < 2; attempt++) {
      // The refresh carries neither a word nor a ticket. The exact document
      // that receives it asks the worker for the current queue.
      const reply = await tabs.sendMessage(id, { type: 'refreshReview' }, { documentId: review.documentId })
        .catch(() => null);
      const current = await currentReview(id);
      if (!current) return false;
      if (current.documentId === review.documentId) {
        if (reply?.ok === true) return true;
        throw new Error('The open Lang Weave review could not refresh.');
      }
      review = current;
    }
    throw new Error('The Lang Weave review changed while opening. Try again.');
  }

  async function focusReview(id, refresh) {
    let review = await currentReview(id);
    if (!review) return false;
    try {
      if (!review.tab.active) {
        await tabs.update(id, { active: true });
        review = await currentReview(id);
        if (!review) return false;
      }
      await windows.update(review.tab.windowId, { focused: true });
    } catch (error) {
      if (await currentReview(id)) throw error;
      return false;
    }
    review = await currentReview(id);
    return !!review && (!refresh || await refreshReview(id, review));
  }

  function openReview(windowId, chooseWord) {
    // Capture the event's source window before an earlier open can move focus.
    const source = (Number.isInteger(windowId) ? windows.get(windowId) : windows.getLastFocused())
      .catch(() => null);
    const request = opens.then(async () => {
      const origin = await source;
      if (!origin) return { error: 'The Chrome window for this review is unavailable.' };
      // Spanning-mode extension pages cannot run in incognito tabs.
      if (origin.incognito) return { error: 'Open Lang Weave review from a regular Chrome window.' };
      const result = chooseWord ? await chooseWord() : { ok: true };
      if (!result.ok) return result;

      const ids = new Set((await contexts()).map(({ tabId }) => tabId));
      if (openingTabId !== undefined) ids.add(openingTabId);
      const candidates = (await Promise.all([...ids].map(readTab))).filter(Boolean);
      const rank = (tab) => tab.windowId === origin.id ? (tab.active ? 0 : 1) : 2;
      candidates.sort((a, b) => rank(a) - rank(b) || a.id - b.id);
      for (const tab of candidates) {
        const reused = await focusReview(tab.id, !!chooseWord);
        if (tab.id === openingTabId) openingTabId = undefined;
        if (reused) return result;
      }
      const created = await tabs.create({ url, windowId: origin.id });
      // Hold serialized opens until the new document can be found. If loading
      // times out, keep this ID as a candidate for the next request in this worker.
      openingTabId = created.id;
      const opened = await focusReview(created.id, false);
      openingTabId = undefined;
      return opened ? result : { error: 'The new Lang Weave review is no longer open.' };
    });
    opens = request.catch(() => {});
    return request;
  }
  return openReview;
}

// One worker owns opening review for popup, shortcuts and My words. The tab
// strip is the source of truth even after an MV3 worker restart.
export function createReviewTabs({ tabs, windows, runtime }) {
  const url = runtime.getURL('src/review.html');
  let opens = Promise.resolve();
  const isReview = (tab) => tab?.id >= 0 && !tab.incognito && (tab.pendingUrl ?? tab.url) === url;
  const read = (id) => tabs.get(id).catch(() => null);

  async function focusReview(id, refresh) {
    if (!isReview(await read(id))) return false;
    try {
      const active = await tabs.update(id, { active: true });
      if (!isReview(active)) return false;
      await windows.update(active.windowId, { focused: true });
      if (refresh) {
        const [document] = await runtime.getContexts({
          contextTypes: ['TAB'], tabIds: [id], documentUrls: [url], frameIds: [0], incognito: false,
        });
        if (document?.documentId) {
          // The tab may navigate between discovery and delivery. Only the
          // exact review document may receive the refresh; it never carries a
          // ticket or word. A new document reads the queue on startup.
          await tabs.sendMessage(id, { type: 'refreshReview' }, { documentId: document.documentId })
            .catch(() => {});
        }
      }
    } catch (error) {
      if (isReview(await read(id))) throw error;
      return false;
    }
    return isReview(await read(id));
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

      // Chrome exposes our own extension URLs without the tabs permission.
      const candidates = (await tabs.query({ url })).filter(isReview);
      const rank = (tab) => tab.windowId === origin.id ? (tab.active ? 0 : 1) : 2;
      candidates.sort((a, b) => rank(a) - rank(b) || a.id - b.id);
      for (const tab of candidates) {
        if (await focusReview(tab.id, !!chooseWord)) return result;
      }
      const created = await tabs.create({ url, windowId: origin.id });
      await windows.update(created.windowId, { focused: true });
      return result;
    });
    opens = request.catch(() => {});
    return request;
  }
  return openReview;
}

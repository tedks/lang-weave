// Selection capture into personal vocabulary, and the personal-vocabulary list on the capture page.
import { siteEnabled, hasSiteAccess } from './settings.js';
import { isZeroFrench } from './levels.js';
import { hashKey } from './hash.js';
import { PENDING_KEY, SENT_KEY } from './events.js';
import { REVIEW_KEY, introduce } from './review.js';
import { englishAnchors, entryId } from './catalog.js';
import { ENCOUNTERS_KEY } from './encounters.js';
import { PERSONAL_KEY, cleanPersonal, personalWords, suggestedMatches, addPersonal, exportPersonal,
  validForm, targetAliases } from './personal.js';
import { personalScope } from './worker-context.js';
import { personalReview } from './review-state.js';

export const CAPTURE_MENU = 'lang-weave-add-selection';
export const CAPTURE_MS = 2 * 60 * 1000;
export const CAPTURE_PATH = /\/(?:login|signin|sign-in|checkout|payment|billing|settings|account|medical|patient|portal|banking)(?:\/|$)/i;
export const captureUrlSafe = (url) => {
  try { const parsed = new URL(url); return /^https?:$/.test(parsed.protocol) && !CAPTURE_PATH.test(parsed.pathname); }
  catch { return false; }
};
// Catalog writes change reading policy, but they do not change the source page's
// consent, language, or document. Keep parallel confirmation pages usable.
export const captureRevision = (ctx) => hashKey(JSON.stringify([ctx.settings, ctx.level, ctx.scope,
  ctx.language, ctx.origins, ctx.hasKey, ctx.captureEpoch, chrome.runtime.getManifest().version]));

export function createCaptureHandlers({ store, locked, worker, captureDrafts, completedCaptures,
    contentDocuments, context, broadcast, reviewState }) {
  function rememberDocument(sender) {
    if (sender.frameId === 0 && sender.documentId && Number.isSafeInteger(sender.tab?.id) &&
        /^https?:\/\//.test(sender.url || '')) {
      contentDocuments.set(sender.tab.id, { documentId: sender.documentId, url: sender.url });
      if (contentDocuments.size > 100) contentDocuments.delete(contentDocuments.keys().next().value);
    }
  }

  async function openCapture(draft) {
    for (const [nonce, prior] of captureDrafts) if (Date.now() - prior.createdAt > CAPTURE_MS)
      captureDrafts.delete(nonce);
    if (captureDrafts.size >= 20) captureDrafts.delete(captureDrafts.keys().next().value);
    captureDrafts.set(draft.nonce, draft);
    await chrome.tabs.create({ url: chrome.runtime.getURL(`src/capture.html?nonce=${encodeURIComponent(draft.nonce)}`) });
  }

  async function captureMenuClicked(info, tab) {
    if (info?.menuItemId !== CAPTURE_MENU) return;
    const nonce = crypto.randomUUID();
    const draft = { nonce, createdAt: Date.now(), error: '', selectedText: '' };
    const fail = async (message) => { draft.error = message; await openCapture(draft); };
    const selected = validForm(info.selectionText, { selection: true });
    if (!selected || info.editable || info.linkUrl || info.frameId !== 0 ||
        !Number.isSafeInteger(tab?.id) || !captureUrlSafe(info.pageUrl)) {
      await fail('Select a short word or phrase from readable page text on an enabled site.'); return;
    }
    const document = contentDocuments.get(tab.id);
    if (!document) { await fail('This page is not ready for capture. Reload it after enabling Lang Weave.'); return; }
    const settingsAtStart = worker.settingsGeneration, permissionAtStart = worker.permissionGeneration;
    const ctx = await context();
    if (!siteEnabled(ctx.settings, info.pageUrl) || !hasSiteAccess(info.pageUrl, ctx.origins) ||
        isZeroFrench(tab.title || '')) {
      await fail('Lang Weave is off or unavailable on this page. Check the site setting and permission.'); return;
    }
    try {
      const current = await chrome.tabs.get(tab.id);
      if (current?.url !== info.pageUrl || isZeroFrench(current.title || '') ||
          contentDocuments.get(tab.id)?.documentId !== document.documentId) throw new Error('Page changed');
      const response = await chrome.tabs.sendMessage(tab.id,
        { type: 'personalCaptureChallenge', text: selected, nonce },
        { documentId: document.documentId, frameId: 0 });
      if (response?.ok !== true || response.text !== selected) throw new Error('Selection unavailable');
      const latest = await context();
      const finalTab = await chrome.tabs.get(tab.id);
      if (captureRevision(latest) !== captureRevision(ctx) || finalTab?.url !== info.pageUrl ||
          isZeroFrench(finalTab.title || '') || contentDocuments.get(tab.id)?.documentId !== document.documentId ||
          settingsAtStart !== worker.settingsGeneration || permissionAtStart !== worker.permissionGeneration)
        throw new Error('Page or settings changed');
      Object.assign(draft, { selectedText: selected, tabId: tab.id, documentId: document.documentId,
        url: info.pageUrl, language: ctx.language, revision: captureRevision(ctx),
        settingsGeneration: settingsAtStart, permissionGeneration: permissionAtStart });
    } catch {
      draft.error = 'The selection changed, or this document is no longer available. Select it again on the page.';
    }
    await openCapture(draft);
  }

  async function captureIsCurrent(draft) {
    if (!draft?.tabId || !draft.documentId || Date.now() - draft.createdAt > CAPTURE_MS || draft.error) return null;
    const settingEpoch = worker.settingsGeneration, permissionEpoch = worker.permissionGeneration;
    if (settingEpoch !== draft.settingsGeneration || permissionEpoch !== draft.permissionGeneration) return null;
    const ctx = await context();
    if (ctx.language !== draft.language || captureRevision(ctx) !== draft.revision ||
        !siteEnabled(ctx.settings, draft.url) || !hasSiteAccess(draft.url, ctx.origins) ||
        !captureUrlSafe(draft.url) ||
        contentDocuments.get(draft.tabId)?.documentId !== draft.documentId) return null;
    try {
      const response = await chrome.tabs.sendMessage(draft.tabId, { type: 'personalCaptureAlive' },
        { documentId: draft.documentId, frameId: 0 });
      if (response?.ok !== true) return null;
      const tab = await chrome.tabs.get(draft.tabId);
      // Keep epoch comparisons synchronous and last after the final asynchronous tab lookup.
      if (tab?.url !== draft.url || isZeroFrench(tab.title || '') ||
          contentDocuments.get(draft.tabId)?.documentId !== draft.documentId ||
          worker.settingsGeneration !== settingEpoch || worker.permissionGeneration !== permissionEpoch) return null;
      return ctx;
    } catch { return null; }
  }

  async function captureDraft(msg) {
    const draft = captureDrafts.get(msg.nonce);
    if (!draft || Date.now() - draft.createdAt > CAPTURE_MS)
      return { error: 'Capture expired. Select the word again on the page.' };
    if (draft.error) return { selectedText: draft.selectedText, error: draft.error };
    const ctx = await captureIsCurrent(draft);
    if (!ctx) return { error: 'The source page, language or site permission changed. Select the word again.' };
    const matches = [...suggestedMatches(draft.selectedText, 'en-to-target', ctx.language,
      ctx.legacyAllWords, ctx.personal).map((match) => ({ ...match, direction: 'en-to-target' })),
      ...suggestedMatches(draft.selectedText, 'target-to-en', ctx.language,
        ctx.legacyAllWords, ctx.personal).map((match) => ({ ...match, direction: 'target-to-en' }))].slice(0, 24);
    const personalStatus = new Map(ctx.activePersonal.map(({ entry, reviewOnly }) => [entry.id, reviewOnly]));
    return { selectedText: draft.selectedText, language: ctx.language,
      matches: matches.map((match) => ({ ...match,
        ...(match.id ? { reviewOnly: personalStatus.get(match.id) === true,
          reason: 'shared spelling or phrase needs explicit review' } : {}) })) };
  }

  function captureKeepAlive(msg) {
    const draft = captureDrafts.get(msg.nonce);
    return { ok: !!draft && !draft.error && Date.now() - draft.createdAt <= CAPTURE_MS };
  }

  async function captureSave(msg) {
    return locked(async () => {
      const completed = completedCaptures.get(msg.nonce);
      if (completed && Date.now() - completed.at <= CAPTURE_MS) return completed.result;
      const draft = captureDrafts.get(msg.nonce);
      const ctx = await captureIsCurrent(draft);
      if (!ctx) return { error: 'Capture expired or the source page changed. Select the word again.' };
      const source = validForm(msg.source), target = validForm(msg.target);
      if (!source || !target || !['en-to-target', 'target-to-en'].includes(msg.direction) ||
          (msg.direction === 'en-to-target' ? source : target) !== draft.selectedText)
        return { error: 'The selected form must match the confirmed source or target exactly.' };
      const exactKnown = ctx.language === 'es' && (!msg.sense || msg.sense === source)
        ? ctx.legacyAllWords.find((word) => word.fr === target && word.en === source) : null;
      const samePackMeaning = ctx.legacyAllWords.some((word) => word.fr === target && word.en === source &&
        (!msg.sense || msg.sense === word.en));
      const collidesWithPack = ctx.legacyAllWords.some((word) =>
        targetAliases(word.fr, ctx.language).some((form) => targetAliases(target, ctx.language).includes(form)) ||
        englishAnchors(word).some((anchor) => englishAnchors({ en: source }).includes(anchor)));
      if (collidesWithPack && !samePackMeaning && msg.distinct !== true)
        return { error: 'This spelling already has another meaning in the current pack. Confirm “distinct meaning” to save it separately.' };
      let result;
      try {
        result = addPersonal(ctx.personal, { ...msg,
          provenance: exactKnown ? 'bundled-suggestion' : 'manual',
          linkedLegacy: exactKnown ? entryId(ctx.scope, exactKnown) : undefined }, ctx.language);
      } catch (error) { return { error: error.message }; }
      if (!result.duplicate) {
        try { await store.set({ [PERSONAL_KEY]: ctx.personal }); }
        catch { return { error: 'Personal vocabulary could not be saved. Retry or cancel.' }; }
      }
      captureDrafts.delete(msg.nonce);
      const { reviewOnly } = personalWords(ctx.personal, ctx.language, ctx.legacyAllWords)
        .find(({ entry }) => entry.id === result.entry.id) || { reviewOnly: true };
      const receipt = { ok: true, id: result.entry.id, duplicate: result.duplicate,
        archived: result.entry.archived, reviewOnly };
      completedCaptures.set(msg.nonce, { at: Date.now(), result: receipt });
      if (completedCaptures.size > 20) completedCaptures.delete(completedCaptures.keys().next().value);
      return receipt;
    });
  }

  async function personalList() {
    const ctx = await context();
    if (ctx.personal.unsupported) return { error: 'Personal vocabulary uses a newer format. Update Lang Weave.' };
    const status = new Map(personalWords(ctx.personal, ctx.language, ctx.legacyAllWords)
      .map(({ entry, reviewOnly }) => [entry.id, reviewOnly]));
    return { entries: ctx.personal.entries.map((entry) => ({ id: entry.id, language: entry.language,
      en: entry.source, fr: entry.target, target: entry.target, sense: entry.sense,
      archived: entry.archived, reviewOnly: entry.archived || entry.language !== ctx.language || status.get(entry.id),
      reason: entry.archived ? 'archived' : entry.language !== ctx.language ? 'select this language to use it' :
        entry.linkedLegacy ? 'linked to an existing bundled card' :
        status.get(entry.id) ? 'shared spelling or phrase needs explicit review' : '' })) };
  }

  async function personalArchive(msg) {
    return locked(async () => {
      const ctx = await context();
      if (ctx.personal.unsupported) return { error: 'Personal vocabulary uses a newer format. Update Lang Weave.' };
      const entry = ctx.personal.entries.find((item) => item.id === msg.id);
      if (!entry || typeof msg.archived !== 'boolean') return { error: 'Entry unavailable.' };
      if (entry.archived !== msg.archived) {
        entry.archived = msg.archived;
        ctx.personal.revision++;
        await store.set({ [PERSONAL_KEY]: ctx.personal });
        if (ctx.revision !== (await context()).revision) void broadcast('retry').catch(() => {});
      }
      return { ok: true };
    });
  }

  async function personalIntroduce(msg) {
    return locked(async () => {
      const ctx = await context();
      if (ctx.personal.unsupported) return { error: 'Personal vocabulary uses a newer format. Update Lang Weave.' };
      const entry = ctx.personal.entries.find((item) => item.id === msg.id && !item.archived);
      if (!entry) return { error: 'Entry unavailable.' };
      if (entry.linkedLegacy) {
        if (ctx.language !== entry.language) return { error: 'Select this entry’s language first.' };
        const legacy = await reviewState(ctx);
        const word = legacy.words.find((item) => entryId(ctx.scope, item) === entry.linkedLegacy);
        if (!word) return { error: 'Linked bundled card is not available at this level.' };
        const added = introduce(legacy.state, [word], Date.now(), 1);
        if (added) await legacy.scoped.set({ [REVIEW_KEY]: legacy.state });
        return { ok: true, added: !!added };
      }
      const review = personalReview({ ...ctx, language: entry.language });
      const added = introduce(review.state, [{ fr: entry.id, en: entry.source }], Date.now(), 1);
      if (added) await store.set({ [PERSONAL_KEY]: ctx.personal });
      return { ok: true, added: !!added };
    });
  }

  async function personalExportResult() {
    const { [PERSONAL_KEY]: raw } = await store.get(PERSONAL_KEY);
    if (cleanPersonal(raw).unsupported) return { error: 'Personal vocabulary uses a newer format. Update Lang Weave.' };
    const personal = cleanPersonal(raw);
    const feedback = {};
    for (const language of new Set(personal.entries.map((entry) => entry.language))) {
      const own = await personalScope(language).get([ENCOUNTERS_KEY, PENDING_KEY, SENT_KEY]);
      feedback[language] = { encounters: own[ENCOUNTERS_KEY] || null,
        events: own[PENDING_KEY] || [], shown: own[SENT_KEY] || null };
    }
    return { json: JSON.stringify({ ...exportPersonal(personal), feedback }, null, 2) };
  }

  function registerCaptureMenu() {
    if (!chrome.contextMenus?.create) return;
    chrome.contextMenus.removeAll(() => {
      if (chrome.runtime.lastError) { console.warn('Lang Weave selection menu unavailable:', chrome.runtime.lastError.message); return; }
      chrome.contextMenus.create({ id: CAPTURE_MENU, title: 'Add to Lang Weave',
        contexts: ['selection'], documentUrlPatterns: ['http://*/*', 'https://*/*'] }, () => {
        if (chrome.runtime.lastError) console.warn('Lang Weave selection menu unavailable:', chrome.runtime.lastError.message);
      });
    });
  }
  const captureMenuListener = (info, tab) => { void captureMenuClicked(info, tab).catch(() => {}); };
  return { rememberDocument, captureDraft, captureKeepAlive, captureSave, personalList, personalArchive,
    personalIntroduce, personalExportResult, registerCaptureMenu, captureMenuListener };
}

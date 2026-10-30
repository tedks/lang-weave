// Standalone Spanish service worker: site access, one model call at a time and local reading events.
// Keys stay here; pages only get a config without them.
// This file is the composition root. It owns the per-worker state, creates the feature
// modules in dependency order and registers every Chrome listener synchronously at top level.
// Message authorization is the surface table in router.js. Feature modules are factories so
// that each evaluation of this file (one per worker start) gets its own state.
import { createCache, chromeStorage } from './cache.js';
import { cleanSettings } from './settings.js';
import { validateStorageSettings } from './portability.js';
import { senderSurfaces, surfaceAllows } from './router.js';
import { createContext, publicContext } from './worker-context.js';
import { createReviewState } from './review-state.js';
import { createGradualBudgets } from './gradual-budgets.js';
import { createReading } from './reading.js';
import { createReviewHandlers } from './review-handlers.js';
import { createInlineRecall } from './inline-recall.js';
import { createUpdate, openWelcome, ALARM } from './update.js';
import { createSettingsHandlers } from './settings-handlers.js';
import { createCaptureHandlers } from './capture-handlers.js';
import { createBackupHandlers } from './backup-handlers.js';
import { createProgressHandlers } from './progress-handlers.js';
import { createSites } from './sites.js';
import { createBadge } from './badge.js';
import { STATUS_KEY, QUOTA_STATE_KEY } from './quota-status.js';
export { RELOADED_KEY } from './update.js';

const store = chrome.storage.local;
const cache = createCache(chromeStorage);
const cooldown = new Map(); // hot copy; quotaState is the bounded restart-safe source
const cooldownKinds = new Map();
// Mutable per-worker scalars live on one object so every module reads them live, synchronously,
// after each await. Never copy one into a local except as a deliberate start-of-work snapshot.
const worker = {
  permissionGeneration: 0, // permission events can arrive while the storage lock is held
  settingsGeneration: 0, // a popup change also invalidates a held dispatch before its write gets the lock
  importBlocked: false, // a failed journal commit needs startup recovery before any other mutation
  startupUnsupportedSettings: false,
};
const captureDrafts = new Map(); // worker memory only; a restart invalidates every nonce
const completedCaptures = new Map(); // short-lived idempotent receipts; no draft/page metadata
const backupPages = new Map(); // live extension-page ports; a worker restart loses preview authority
const contentDocuments = new Map(); // tab -> top-frame document identity, never persisted

const serial = () => {
  let chain = Promise.resolve();
  return (fn) => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };
};
const modelCall = serial(); // one model call at a time
const locked = serial(); // storage read-modify-writes one at a time, or concurrent ones drop data
// When both queues are needed, enter modelCall before locked; reversing them can deadlock update reload.

const { connectBackupPage, recoverLearningImport, learningExport, learningPreview, learningImport } =
  createBackupHandlers({ store, locked, worker, backupPages });

const ready = (async () => {
  // Content scripts run on every enabled site, so stored keys are kept out of their reach.
  if (store.setAccessLevel) await store.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const { settings } = await store.get('settings');
  try { validateStorageSettings(settings || {}); }
  catch { worker.startupUnsupportedSettings = true; }
  if (settings?.apiKey) await store.set({ apiKey: settings.apiKey }); // 0.1 kept a pasted key in settings
  // A stored settings object identifies an existing profile. Only a truly empty new profile
  // needs onboarding; older profiles keep their existing access until they choose otherwise.
  if (!worker.startupUnsupportedSettings) await store.set({
    settings: cleanSettings(settings), ...(settings === undefined ? { consentShown: false } : {}),
  });
  const { keyEpoch } = await store.get('keyEpoch');
  if (typeof keyEpoch !== 'string' || !keyEpoch) await store.set({ keyEpoch: crypto.randomUUID() });
  await recoverLearningImport();
})();

chrome.runtime.onConnect?.addListener(connectBackupPage);

const { context, broadcast } = createContext({ store, ready });
const { reviewState } = createReviewState({ context });
const { introduction, recoverBudget, adaptiveReviewState, commitAdaptive } =
  createGradualBudgets({ store, locked, context, broadcast, reviewState });
const { swaps, record } = createReading({ store, cache, locked, modelCall, worker, cooldown, cooldownKinds,
  context, adaptiveReviewState, commitAdaptive });
const { reviewStatus, reviewIntroduce, reviewNext, reviewReveal, reviewRate, reviewKnown, learningStats } =
  createReviewHandlers({ store, locked, context, reviewState });
const { progress, wordsList, wordPractice, wordKnown, wordReset } =
  createProgressHandlers({ store, locked, context, reviewState });
const { inlineAction } = createInlineRecall({ store, locked, context, reviewState });
let refreshBadges = () => {};
const { checkUpdate, arm, updatePending } = createUpdate({ store, locked, modelCall,
  onBadgeChange: () => refreshBadges() });
const badge = createBadge({ store, context, updatePending });
refreshBadges = badge.refreshAll;
const { clearCache, addLanguage, removeLanguage, save, removeKey, testKey, status } = createSettingsHandlers({ store, cache, locked,
  modelCall, worker, cooldown, cooldownKinds, context, broadcast, reviewState, reviewStatus, checkUpdate });
const { rememberDocument, captureDraft, captureKeepAlive, captureSave, personalList, personalArchive,
  personalIntroduce, personalExportResult, registerCaptureMenu, captureMenuListener } =
  createCaptureHandlers({ store, locked, worker, captureDrafts, completedCaptures, contentDocuments,
    context, broadcast, reviewState });
const { registerSites, permissionsChanged } = createSites({ store, locked, worker, broadcast });
// The first routed reply must not run ahead of restoring a granted site's
// content script after an MV3 worker wake. A page loaded before this reply
// can still miss injection (see startup-injection-gap).
const sitesReady = ready.then(registerSites);
// A transient registration failure must not poison every later routed message.
// createSites serializes attempts, so a later reply can safely try again.
const awaitSites = () => sitesReady.catch(() => registerSites());

// Each sender surface may send only the messages router.js lists for it.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || sender.id !== chrome.runtime.id) return false;
  if (worker.importBlocked) { reply({ error: 'Learning import is incomplete. Reload Lang Weave to recover it.' }); return true; }
  const surfaces = senderSurfaces(sender);
  const page = surfaces.has('page');
  if (page && ['config', 'captureReady'].includes(msg.type)) rememberDocument(sender);
  const handlers = {
    config: async () => publicContext(await context()),
    captureReady: async () => ({ ok: true }),
    swaps: () => swaps(msg, sender),
    event: () => record(msg, sender),
    status, clearCache, removeKey, testKey,
    recoverBudget: () => recoverBudget(msg),
    save: () => save(msg),
    addLanguage: () => addLanguage(msg),
    removeLanguage: () => removeLanguage(msg),
    reviewStatus: () => reviewStatus(), reviewIntroduce, reviewNext,
    reviewReveal: () => reviewReveal(msg),
    reviewRate: () => reviewRate(msg),
    reviewKnown: () => reviewKnown(msg),
    learningStats: () => learningStats(),
    progress: () => progress(), wordsList: () => wordsList(),
    wordPractice: () => wordPractice(msg), wordKnown: () => wordKnown(msg), wordReset: () => wordReset(msg),
    inlineBegin: () => inlineAction(msg, sender),
    inlineReveal: () => inlineAction(msg, sender),
    inlineRate: () => inlineAction(msg, sender),
    introAck: () => introduction(msg, sender),
    introRelease: () => introduction(msg, sender),
    introRenew: () => introduction(msg, sender),
    captureDraft: () => captureDraft(msg), captureKeepAlive: () => captureKeepAlive(msg),
    captureSave: () => captureSave(msg),
    captureCancel: () => ({ ok: captureDrafts.delete(msg.nonce) }),
    personalList, personalArchive: () => personalArchive(msg),
    personalIntroduce: () => personalIntroduce(msg), personalExport: personalExportResult,
    learningExport, learningPreview: () => learningPreview(msg, sender),
    learningImport: () => learningImport(msg, sender),
  };
  if (!handlers[msg.type] || !surfaceAllows(surfaces, msg.type)) return false;
  awaitSites().then(handlers[msg.type]).then(reply, (e) => reply({ error: String(e?.message || e) }));
  return true;
});

chrome.permissions.onAdded.addListener(permissionsChanged);
chrome.permissions.onRemoved.addListener(permissionsChanged);
chrome.permissions.onAdded.addListener(() => void badge.refreshAll().catch(() => {}));
chrome.permissions.onRemoved.addListener(() => void badge.refreshAll().catch(() => {}));
chrome.tabs.onActivated?.addListener(({ tabId }) => void badge.refresh(tabId).catch(() => {}));
chrome.tabs.onUpdated?.addListener((tabId, change) => {
  // Chrome omits change.url on a tab whose host is not granted, but still reports loading.
  if (change.url || change.status === 'loading' || change.status === 'complete')
    void badge.refresh(tabId).catch(() => {});
});
chrome.storage.onChanged?.addListener((changes, area) => {
  if (area === 'local' && ['settings', 'apiKey', 'keyEpoch', 'consentShown', STATUS_KEY, QUOTA_STATE_KEY]
    .some((key) => Object.hasOwn(changes, key))) void badge.refreshAll().catch(() => {});
});

chrome.runtime.onInstalled.addListener(arm);
chrome.runtime.onInstalled.addListener(openWelcome);
chrome.runtime.onStartup.addListener(arm);
chrome.alarms?.onAlarm?.addListener((a) => {
  if (a.name !== ALARM) return;
  void checkUpdate();
});
chrome.contextMenus?.onClicked?.addListener(captureMenuListener);
chrome.tabs.onRemoved?.addListener((tabId) => {
  badge.removed(tabId);
  contentDocuments.delete(tabId);
  for (const [nonce, draft] of captureDrafts) if (draft.tabId === tabId) captureDrafts.delete(nonce);
});
chrome.runtime.onInstalled.addListener(registerCaptureMenu);
chrome.runtime.onStartup.addListener(registerCaptureMenu);
void sitesReady.catch(() => {});
// On an MV3 wake, Chrome can retain the previous action badge. Resolve the
// unpacked update first so a pending NEW is never replaced by reading state.
void ready.then(async () => { await checkUpdate({ allowReload: false }); await badge.refreshAll(); }).catch(() => {});

// Sender-scoped message router. Each surface (an extension page, or a web page's
// content script) may send only the messages listed for it; everything else is denied.
// A sender may match more than one surface predicate only in theory; a message is allowed
// when any matching surface lists it. A new surface (welcome, options, side panel) is one
// new entry here; never widen an existing entry to reach a new page.

const backupPageUrl = () => chrome.runtime.getURL('src/backup.html');
export const backupSender = (sender) => sender?.id === chrome.runtime.id && sender.url === backupPageUrl();

export function capturePageSender(sender) {
  try {
    const url = new URL(sender.url);
    const own = new URL(chrome.runtime.getURL('src/capture.html'));
    return url.protocol === 'chrome-extension:' && url.host === own.host &&
      url.pathname === own.pathname;
  } catch { return false; }
}

const surface = (name, matches, messages) => Object.freeze({ name, matches, messages: Object.freeze(messages) });
export const SURFACES = Object.freeze([
  surface('popup', (sender) => sender.url === chrome.runtime.getURL('src/popup.html'),
    ['status', 'clearCache', 'save', 'addLanguage', 'removeLanguage', 'reviewStatus', 'recoverBudget',
      'removeKey', 'testKey']),
  surface('review', (sender) => sender.url === chrome.runtime.getURL('src/review.html'),
    ['reviewStatus', 'reviewIntroduce', 'reviewNext', 'reviewReveal', 'reviewRate', 'reviewKnown', 'learningStats']),
  surface('capture', capturePageSender,
    ['captureDraft', 'captureKeepAlive', 'captureSave', 'captureCancel', 'personalList',
      'personalArchive', 'personalIntroduce', 'personalExport']),
  surface('backup', backupSender, ['learningExport', 'learningPreview', 'learningImport']),
  surface('page', (sender) => sender.tab && /^https?:\/\//.test(sender.url || ''),
    ['config', 'captureReady', 'swaps', 'event', 'inlineBegin', 'inlineReveal', 'inlineRate',
      'introAck', 'introRelease', 'introRenew']),
]);

// The names of every surface this sender matches. Pure: reads only the sender and the extension URL.
export const senderSurfaces = (sender) =>
  new Set(SURFACES.filter(({ matches }) => matches(sender)).map(({ name }) => name));
export const surfaceAllows = (surfaces, type) =>
  SURFACES.some(({ name, messages }) => surfaces.has(name) && messages.includes(type));

// Worker-side writes to the local learning log (learning-log.js): one retrieval per rating or
// "already know" claim, one exposure per seen/peek event. Word IDs only; the scope catalog is
// always passed, so no URL, host or page text can be stored. Callers hold the worker lock.
import { chromeStorage } from './cache.js';
import { scopedStorage } from './scope.js';
import { personalScope } from './worker-context.js';
import { recordRetrieval, recordExposures } from './learning-log.js';
import { localDay } from './events.js';

// The log catalogs match what a backup can verify (portability.js logCatalog): the scope's full
// word list, or the personal entry IDs of the current language.
const catalog = (ctx, personal) => new Set(personal
  ? ctx.personal.entries.filter((entry) => entry.language === ctx.language).map((entry) => entry.id)
  : ctx.legacyAllWords.map((word) => word.fr));
const storageFor = (ctx, personal) => personal ? personalScope(ctx.language) : scopedStorage(chromeStorage, ctx.scope);

// A measurement must never fail or undo the rating it describes, so a storage error here is
// swallowed after the card itself has been saved. Returns whether the entry was written.
export async function logRetrieval(ctx, personal, record, source, now) {
  if (!record) return false;
  try {
    return await recordRetrieval(storageFor(ctx, personal), { ...record, at: now, source,
      // Both review surfaces prompt with the English gloss and ask for the target form.
      direction: 'productive' }, catalog(ctx, personal));
  } catch { return false; }
}

export async function logExposure(ctx, personal, word, kind, now) {
  try {
    return await recordExposures(storageFor(ctx, personal), [word], catalog(ctx, personal), localDay(new Date(now)), kind);
  } catch { return 0; }
}

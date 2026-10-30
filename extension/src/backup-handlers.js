// Learning backup page: export, preview and journaled import. A live port per page is its
// preview authority; every import step rechecks it, the storage signature and both generations.
import { createBackup, parseBackup, backupPreview, learningPatch, targetFresh, IMPORT_JOURNAL_KEY,
  IMPORT_RECEIPT_KEY, MAX_BACKUP_BYTES, LEARNING_STORAGE_KEYS, emptyLogEntry } from './portability.js';
import { backupSender } from './router.js';

export const sameBackupSender = (a, b) => a.id === b.id && a.url === b.url &&
  a.documentId === b.documentId && a.tab?.id === b.tab?.id;
export const digest = async (value) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
  new TextEncoder().encode(value))), (byte) => byte.toString(16).padStart(2, '0')).join('');
export const storageSignature = (value) => JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
export const permissionSignature = (value) => JSON.stringify({ origins: [...(value.origins || [])].sort(),
  permissions: [...(value.permissions || [])].sort() });
export const liveBackupPage = (page, sender, token) => page && page.port && !page.closed &&
  sameBackupSender(page.sender, sender) && page.preview?.token === token;

export function alreadyImported(all, backup, hash) {
  if (all[IMPORT_RECEIPT_KEY]?.schemaVersion !== 1 || all[IMPORT_RECEIPT_KEY]?.hash !== hash) return false;
  const patch = learningPatch(backup, all.settings);
  for (const [key, value] of Object.entries(patch)) if (storageSignature({ value: all[key] }) !==
      storageSignature({ value })) return false;
  const learned = Object.keys(all).filter((key) => LEARNING_STORAGE_KEYS.includes(key) || key.startsWith('lang:'));
  // A fresh target may already hold an empty learning log that the import had no reason to write.
  return learned.every((key) => Object.hasOwn(patch, key) || emptyLogEntry(key, all[key]));
}

export function createBackupHandlers({ store, locked, worker, backupPages }) {
  const connectBackupPage = (port) => {
    if (port.name !== 'learning-backup-page' || !backupSender(port.sender)) return;
    let page;
    port.onMessage.addListener((message) => {
      if (message?.invalidate === true && page && message.pageId === page.id) {
        page.preview = null;
        page.generation++;
        return;
      }
      if (page || typeof message?.pageId !== 'string' || !/^[0-9a-f-]{36}$/i.test(message.pageId)) return;
      page = { id: message.pageId, port, sender: port.sender, generation: 0, preview: null, closed: false };
      backupPages.set(page.id, page);
      port.postMessage({ ready: true, pageId: page.id });
    });
    port.onDisconnect.addListener(() => {
      if (!page) return;
      page.closed = true;
      page.generation++;
      page.preview = null;
      if (backupPages.get(page.id) === page) backupPages.delete(page.id);
    });
  };

  async function recoverLearningImport(beforePatch = async () => {}, forceCommit = false) {
    const { [IMPORT_JOURNAL_KEY]: journal } = await store.get(IMPORT_JOURNAL_KEY);
    if (!journal) return;
    if (journal.version !== 1 || !['prepared', 'committing'].includes(journal.phase) ||
        typeof journal.json !== 'string' || typeof journal.hash !== 'string' ||
        !journal.settings || !journal.before || await digest(journal.json) !== journal.hash)
      throw new Error('Learning import journal needs attention; storage was not changed further.');
    if (journal.phase === 'prepared') { await store.remove(IMPORT_JOURNAL_KEY); return; }
    targetFresh({ settings: journal.settings }); // journal may be corrupted; never restore a key or consent
    const backup = parseBackup(journal.json);
    const patch = learningPatch(backup, journal.settings);
    const receipt = { schemaVersion: 1, hash: journal.hash };
    const intended = { ...patch, [IMPORT_RECEIPT_KEY]: receipt };
    const intendedKeys = Object.keys(intended).sort();
    if (JSON.stringify(Object.keys(journal.before).sort()) !== JSON.stringify(intendedKeys))
      throw new Error('Learning import journal has an unsupported key set.');
    const current = await store.get(intendedKeys);
    let applied = false;
    for (const key of intendedKeys) {
      const original = journal.before[key];
      if (!original || typeof original.present !== 'boolean') throw new Error('Learning import journal is invalid.');
      const exists = Object.hasOwn(current, key);
      const sameBefore = exists === original.present && (!exists ||
        storageSignature({ value: current[key] }) === storageSignature({ value: original.value }));
      const sameAfter = exists && storageSignature({ value: current[key] }) ===
        storageSignature({ value: intended[key] });
      if (!sameBefore && !sameAfter) throw new Error('Learning import target changed during recovery.');
      if (!sameBefore) applied = true;
    }
    // A crash after journal promotion but before the patch must not import from
    // a stale preview. Only an already-started partial patch is finished on restart.
    if (!forceCommit && !applied) { await store.remove(IMPORT_JOURNAL_KEY); return; }
    await beforePatch(); // import path rechecks authority after the journal digest/read awaits
    await store.set(intended);
    await store.remove(IMPORT_JOURNAL_KEY);
  }

  async function stableLearningTarget() {
    const generation = [worker.permissionGeneration, worker.settingsGeneration];
    const first = await store.get(null);
    const firstPermissions = await chrome.permissions.getAll();
    const second = await store.get(null);
    const secondPermissions = await chrome.permissions.getAll();
    if (generation[0] !== worker.permissionGeneration || generation[1] !== worker.settingsGeneration ||
        storageSignature(first) !== storageSignature(second) ||
        permissionSignature(firstPermissions) !== permissionSignature(secondPermissions))
      throw new Error('Target changed while it was being checked. Preview again.');
    return { all: second, signature: storageSignature(second),
      permissions: permissionSignature(secondPermissions), generation };
  }

  async function learningExport() {
    if (worker.startupUnsupportedSettings) throw new Error('Settings use an unsupported format. Update Lang Weave before exporting.');
    return locked(async () => ({ json: createBackup(await store.get(null), chrome.runtime.getManifest().version) }));
  }

  async function learningPreview(msg, sender) {
    if (worker.startupUnsupportedSettings) throw new Error('Target settings use an unsupported format.');
    if (typeof msg.json !== 'string' || new TextEncoder().encode(msg.json).length > MAX_BACKUP_BYTES)
      throw new Error('Choose a learning backup JSON file no larger than 1 MiB.');
    const page = backupPages.get(msg.pageId);
    if (!page || page.closed || !sameBackupSender(page.sender, sender)) throw new Error('Backup page expired. Reopen it.');
    const generation = ++page.generation;
    page.preview = null;
    const backup = parseBackup(msg.json);
    const hash = await digest(msg.json);
    return locked(async () => {
      const target = await stableLearningTarget();
      if (page.closed || page.generation !== generation) throw new Error('Preview expired. Choose the file again.');
      const already = alreadyImported(target.all, backup, hash);
      if (!already) targetFresh(target.all);
      const token = crypto.randomUUID();
      page.preview = { token, json: msg.json, hash, target, generation, already };
      return { token, preview: { ...backupPreview(backup), already } };
    });
  }

  async function learningImport(msg, sender) {
    const page = backupPages.get(msg.pageId);
    if (!liveBackupPage(page, sender, msg.token)) throw new Error('Preview expired. Choose the file again.');
    return locked(async () => {
      const preview = page.preview;
      if (!liveBackupPage(page, sender, msg.token) || preview.generation !== page.generation)
        throw new Error('Preview expired. Choose the file again.');
      const backup = parseBackup(preview.json);
      if (await digest(preview.json) !== preview.hash) throw new Error('Preview payload changed.');
      const target = await stableLearningTarget();
      if (!liveBackupPage(page, sender, msg.token) || preview.generation !== page.generation ||
          preview.target.signature !== target.signature || preview.target.permissions !== target.permissions ||
          preview.target.generation[0] !== target.generation[0] || preview.target.generation[1] !== target.generation[1])
        throw new Error('Target or preview changed. Preview again.');
      if (preview.already) {
        if (!alreadyImported(target.all, backup, preview.hash)) throw new Error('Imported learning changed. Preview again.');
        page.preview = null;
        return { ok: true, already: true };
      }
      targetFresh(target.all);
      const patch = learningPatch(backup, target.all.settings);
      const before = Object.fromEntries([...Object.keys(patch), IMPORT_RECEIPT_KEY].map((key) =>
        [key, { present: Object.hasOwn(target.all, key),
          ...(Object.hasOwn(target.all, key) ? { value: target.all[key] } : {}) }]));
      const journal = { version: 1, phase: 'prepared', json: preview.json,
        hash: preview.hash, settings: target.all.settings, before };
      // The journal makes an interrupted multi-key write recoverable on worker startup.
      await store.set({ [IMPORT_JOURNAL_KEY]: journal });
      const beforeCommit = await store.get(null);
      const beforePermissions = await chrome.permissions.getAll();
      delete beforeCommit[IMPORT_JOURNAL_KEY];
      if (!liveBackupPage(page, sender, msg.token) || preview.generation !== page.generation ||
          worker.permissionGeneration !== target.generation[0] || worker.settingsGeneration !== target.generation[1] ||
          storageSignature(beforeCommit) !== target.signature ||
          permissionSignature(beforePermissions) !== target.permissions) {
        await store.remove(IMPORT_JOURNAL_KEY);
        throw new Error('Preview expired before import. Preview again.');
      }
      await store.set({ [IMPORT_JOURNAL_KEY]: { ...journal, phase: 'committing' } });
      if (!liveBackupPage(page, sender, msg.token) || preview.generation !== page.generation ||
          worker.permissionGeneration !== target.generation[0] || worker.settingsGeneration !== target.generation[1]) {
        await store.remove(IMPORT_JOURNAL_KEY);
        throw new Error('Preview expired before import. Preview again.');
      }
      let patchStarted = false;
      try {
        await recoverLearningImport(async () => {
          const latest = await store.get(null);
          const permissions = await chrome.permissions.getAll();
          delete latest[IMPORT_JOURNAL_KEY];
          if (!liveBackupPage(page, sender, msg.token) || preview.generation !== page.generation ||
              worker.permissionGeneration !== target.generation[0] || worker.settingsGeneration !== target.generation[1] ||
              storageSignature(latest) !== target.signature ||
              permissionSignature(permissions) !== target.permissions)
            throw new Error('Target or preview changed. Preview again.');
          worker.settingsGeneration++; // invalidate held reading/config work before the learning preference write
          patchStarted = true;
        }, true);
      } catch (error) {
        if (!patchStarted) await store.remove(IMPORT_JOURNAL_KEY);
        throw new Error(patchStarted
          ? `Learning import did not finish. Reopen Lang Weave to recover: ${error.message}` : error.message);
      }
      page.preview = null;
      return { ok: true };
    }).catch(async (error) => {
      try { if ((await store.get(IMPORT_JOURNAL_KEY))[IMPORT_JOURNAL_KEY]) worker.importBlocked = true; }
      catch { worker.importBlocked = true; }
      throw error;
    });
  }
  return { connectBackupPage, recoverLearningImport, learningExport, learningPreview, learningImport };
}

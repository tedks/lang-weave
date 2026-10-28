// Explicit, bounded learning backup. This module never reads permissions or writes storage.
import { cleanPack, MAX_PACKS } from './languages.js';
import { cleanPersonal, validForm, validLanguage, MAX_PERSONAL } from './personal.js';
import { validDay } from './learning.js';
import { wordsForLevel } from './levels.js';
import { REVIEW_KEY } from './review.js';
import { PENDING_KEY, SENT_KEY } from './events.js';
import { ENCOUNTERS_KEY } from './encounters.js';

export const BACKUP_FORMAT = 'lang-weave-learning-backup';
export const BACKUP_SCHEMA = 1;
export const MAX_BACKUP_BYTES = 1024 * 1024;
export const IMPORT_JOURNAL_KEY = 'learningImportJournalV1';
export const IMPORT_RECEIPT_KEY = 'learningImportReceiptV1';
const LEARNING_SUFFIXES = [REVIEW_KEY, PENDING_KEY, SENT_KEY, ENCOUNTERS_KEY];
const DIRECT_KEYS = new Set(['settings', 'languagePacks', 'personalVocabularyV1', ...LEARNING_SUFFIXES]);
const NON_LEARNING_KEYS = new Set(['apiKey', 'epoch', 'keyEpoch', 'modelCalls', 'modelStatus',
  'quotaState', 'reloadedFor', IMPORT_JOURNAL_KEY, IMPORT_RECEIPT_KEY]);
const VERSION = /^[0-9a-f]{16}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERSONAL_ID = /^personal:([^:]+):([0-9a-f-]{36})$/i;
const BAD_KEY = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_SCOPES = 80;
const MAX_CARDS = 5000;
const SETTINGS_FIELDS = ['enabled', 'model', 'levelOverride', 'language', 'gradual',
  'newWordsPerDay', 'density', 'inlineRecall', 'newSitesEnabled', 'siteOverrides', 'apiKey'];

function fail(reason) { throw new Error(`Learning backup: ${reason}`); }
function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${name} must be an object`);
  return value;
}
function keys(value, allowed, name, required = []) {
  object(value, name);
  for (const key of Object.keys(value)) if (BAD_KEY.has(key) || !allowed.includes(key)) fail(`unsupported ${name} field`);
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`missing ${name} field`);
}
function map(value, name, max) {
  object(value, name);
  if (Object.keys(value).length > max) fail(`${name} is too large`);
  for (const key of Object.keys(value)) if (BAD_KEY.has(key)) fail(`unsafe ${name} key`);
  return value;
}
function integer(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`invalid ${name}`);
  return value;
}
function day(value, allowEmpty = false) {
  if (allowEmpty && value === '') return value;
  if (!validDay(value)) fail('invalid calendar day');
  return value;
}
function boundedString(value, max, name, joiners = false) {
  if (typeof value !== 'string' || !value || value.length > max ||
      /[\p{Cc}\p{Cf}\p{Cs}<>]/u.test(joiners ? value.replace(/[\u200c\u200d]/g, '') : value) ||
      /(?:https?:\/\/|www\.|\S+@\S+)/iu.test(value)) fail(`invalid ${name}`);
  return value;
}
function language(value) {
  if (value !== 'es' && validLanguage(value) !== value) fail('invalid language');
  return value;
}
function scopeKey(value) {
  if (value === 'es') return value;
  let match = /^lang:([^:]+):([0-9a-f]{16})$/.exec(value);
  if (match) { language(match[1]); if (match[1] === 'es') fail('Spanish has no pack scope'); return value; }
  match = /^personal:([^:]+)$/.exec(value);
  if (match) { language(match[1]); return value; }
  fail('unsupported history scope');
}
function storageScopeKey(key) {
  const match = /^lang:(.+):([^:]+)$/.exec(key);
  if (!match || !LEARNING_SUFFIXES.includes(match[2])) fail('unsupported scoped storage key');
  const raw = match[1];
  return raw.startsWith('personal:') ? scopeKey(raw) : scopeKey(`lang:${raw}`);
}
function storageKey(scope, suffix) {
  if (scope === 'es') return suffix;
  if (scope.startsWith('personal:')) return `lang:${scope}:${suffix}`;
  return `${scope}:${suffix}`;
}
function cardId(value, scope) {
  boundedString(value, 100, 'card ID');
  if (scope.startsWith('personal:')) {
    const match = PERSONAL_ID.exec(value);
    if (!match || match[1] !== scope.slice(9) || !UUID.test(match[2])) fail('invalid personal card ID');
  } else if (!/[\p{L}\p{N}]/u.test(value) || /\.(?:com|org|net|gov)(?:\/|$)/iu.test(value))
    fail('invalid historical card form');
  return value;
}
function card(value) {
  keys(value, ['due', 'interval', 'reviews', 'familiar', 'easyStreak', 'introducedDay', 'introGateDay', 'introReceipt'],
    'card', ['due', 'interval', 'reviews']);
  const result = { due: integer(value.due, 0, Number.MAX_SAFE_INTEGER, 'due time'),
    interval: integer(value.interval, 0, 365, 'interval'), reviews: integer(value.reviews, 0, 10000, 'review count') };
  if (Object.hasOwn(value, 'familiar')) { if (value.familiar !== true) fail('invalid familiarity'); result.familiar = true; }
  if (Object.hasOwn(value, 'easyStreak')) result.easyStreak = integer(value.easyStreak, 0, 3, 'easy streak');
  if (Object.hasOwn(value, 'introducedDay')) result.introducedDay = day(value.introducedDay);
  if (Object.hasOwn(value, 'introGateDay')) result.introGateDay = day(value.introGateDay);
  // The one-use receipt belongs to an installation/document and is deliberately omitted.
  return result;
}
function review(value, scope, source = false) {
  keys(value, source ? ['version', 'cards', 'current', 'inline', 'learning'] : ['version', 'cards', 'learning'],
    'review', ['version', 'cards', 'learning']);
  if (value.version !== 1) fail('unsupported review version');
  const cards = Object.create(null);
  for (const [id, valueCard] of Object.entries(map(value.cards, 'cards', MAX_CARDS))) cards[cardId(id, scope)] = card(valueCard);
  keys(value.learning, source ? ['day', 'count', 'pending'] : ['day', 'count'], 'learning', ['day', 'count']);
  return { version: 1, cards, learning: { day: day(value.learning.day, true),
    count: integer(value.learning.count, 0, 20, 'introduction count') } };
}
function packs(value) {
  const result = Object.create(null);
  for (const [code, raw] of Object.entries(map(value, 'packs', MAX_PACKS))) {
    language(code);
    if (code === 'es') fail('Spanish is bundled');
    keys(raw, ['version', 'words'], 'pack', ['version', 'words']);
    if (!VERSION.test(raw.version)) fail('invalid pack version');
    if (!Array.isArray(raw.words)) fail('invalid pack words');
    for (const word of raw.words) {
      keys(word, ['fr', 'en', 'hint', 'level'], 'pack word', ['fr', 'en', 'hint', 'level']);
      boundedString(word.fr, 80, 'pack form', true);
      boundedString(word.en, 80, 'pack gloss');
      boundedString(word.hint, 80, 'pack hint');
    }
    const cleaned = cleanPack(raw, code);
    if (!cleaned || cleaned.version !== raw.version || cleaned.words.some((word, i) =>
      Object.keys(word).some((field) => word[field] !== raw.words[i][field]))) fail('unsupported pack data');
    result[code] = cleaned;
  }
  return result;
}
function preferences(value, installed) {
  keys(value, ['language', 'levelOverride', 'gradual', 'newWordsPerDay', 'density', 'inlineRecall'],
    'preferences', ['language', 'levelOverride', 'gradual', 'newWordsPerDay', 'density', 'inlineRecall']);
  language(value.language);
  if (value.language !== 'es' && !Object.hasOwn(installed, value.language)) fail('selected language pack is missing');
  integer(value.levelOverride, 0, 4, 'level');
  integer(value.newWordsPerDay, 1, 10, 'daily budget');
  if (typeof value.gradual !== 'boolean' || typeof value.inlineRecall !== 'boolean' ||
      !['light', 'normal', 'heavy'].includes(value.density)) fail('invalid learning preference');
  return { language: value.language, levelOverride: value.levelOverride, gradual: value.gradual,
    newWordsPerDay: value.newWordsPerDay, density: value.density, inlineRecall: value.inlineRecall };
}
function personal(value, source = false) {
  keys(value, ['version', 'revision', 'entries', 'history'], 'personal', ['version', 'revision', 'entries', 'history']);
  if (value.version !== 1) fail('unsupported personal version');
  integer(value.revision, 0, Number.MAX_SAFE_INTEGER, 'personal revision');
  if (!Array.isArray(value.entries) || value.entries.length > MAX_PERSONAL) fail('invalid personal entries');
  const ids = new Set();
  const entries = value.entries.map((entry) => {
    keys(entry, ['uuid', 'id', 'language', 'source', 'target', 'sense', 'direction', 'archived',
      'provenance', 'createdAt', 'linkedLegacy'], 'personal entry',
    ['uuid', 'id', 'language', 'source', 'target', 'sense', 'direction', 'archived', 'provenance', 'createdAt']);
    language(entry.language);
    if (!UUID.test(entry.uuid) || entry.id !== `personal:${entry.language}:${entry.uuid}` || ids.has(entry.uuid) ||
        validForm(entry.source) !== entry.source || validForm(entry.target) !== entry.target ||
        validForm(entry.sense) !== entry.sense || !['en-to-target', 'target-to-en'].includes(entry.direction) ||
        typeof entry.archived !== 'boolean' || !['manual', 'bundled-suggestion'].includes(entry.provenance))
      fail('invalid personal entry');
    ids.add(entry.uuid);
    integer(entry.createdAt, 0, Number.MAX_SAFE_INTEGER, 'personal creation time');
    if (Object.hasOwn(entry, 'linkedLegacy')) boundedString(entry.linkedLegacy, 100, 'legacy link');
    return { ...entry };
  });
  const history = Object.create(null);
  for (const [code, state] of Object.entries(map(value.history, 'personal history', 80))) {
    language(code);
    history[code] = review(state, `personal:${code}`, source);
  }
  const result = { version: 1, revision: value.revision, entries, history };
  if (cleanPersonal(result).unsupported) fail('unsupported personal data');
  return result;
}
function knownIds(scope, installed, personalState, scopeState) {
  const result = new Set(Object.keys(scopeState.review?.cards || {}));
  if (scope === 'es') for (const word of wordsForLevel(2)) result.add(word.fr.toLowerCase());
  else if (scope.startsWith('personal:')) for (const entry of personalState.entries)
    if (entry.language === scope.slice(9)) result.add(entry.id.toLowerCase());
  else {
    const [, code, version] = scope.split(':');
    if (installed[code]?.version === version) for (const word of installed[code].words) result.add(word.fr.toLowerCase());
  }
  return result;
}
function feedbackId(id, allowed, scope, peek = false) {
  const bare = peek && id.startsWith('peek:') ? id.slice(5) : id;
  cardId(bare, scope);
  if (!allowed.has(bare) && !allowed.has(bare.toLowerCase())) fail('feedback refers to unknown word');
  return id;
}
function feedback(value, scope, installed, personalState, source = false) {
  keys(value, ['review', 'events', 'shown', 'encounters'], 'scope');
  const result = {};
  if (Object.hasOwn(value, 'review')) {
    if (scope.startsWith('personal:')) fail('personal review belongs in personal history');
    result.review = review(value.review, scope, source);
  }
  const allowed = knownIds(scope, installed, personalState, result);
  if (Object.hasOwn(value, 'events')) {
    if (!Array.isArray(value.events) || value.events.length > 500) fail('invalid reading events');
    result.events = value.events.map((event) => {
      keys(event, ['word', 'kind', 'day'], 'event', ['word', 'kind', 'day']);
      if (!['seen', 'flip', 'peek'].includes(event.kind)) fail('invalid event kind');
      return { word: feedbackId(event.word, allowed, scope), kind: event.kind, day: day(event.day) };
    });
  }
  if (Object.hasOwn(value, 'shown')) {
    keys(value.shown, ['day', 'words'], 'shown', ['day', 'words']);
    if (!Array.isArray(value.shown.words) || value.shown.words.length > 500) fail('invalid shown words');
    result.shown = { day: day(value.shown.day), words: value.shown.words.map((id) => feedbackId(id, allowed, scope, true)) };
  }
  if (Object.hasOwn(value, 'encounters')) {
    keys(value.encounters, ['version', 'day', 'bucket', 'counts', 'touched'], 'encounters',
      ['version', 'day', 'bucket', 'counts', 'touched']);
    if (value.encounters.version !== 1) fail('unsupported encounter version');
    const counts = Object.create(null);
    for (const [id, count] of Object.entries(map(value.encounters.counts, 'encounter counts', 256)))
      counts[feedbackId(id, allowed, scope)] = integer(count, 1, 7, 'encounter count');
    if (!Array.isArray(value.encounters.touched) || value.encounters.touched.length > 256) fail('invalid touched IDs');
    result.encounters = { version: 1, day: day(value.encounters.day),
      bucket: integer(value.encounters.bucket, 0, 10000000, 'encounter bucket'), counts,
      touched: value.encounters.touched.map((id) => feedbackId(id, allowed, scope)) };
  }
  return result;
}
function state(value, source = false) {
  keys(value, ['preferences', 'packs', 'personal', 'scopes'], 'state', ['preferences', 'packs', 'personal', 'scopes']);
  const installed = packs(value.packs);
  const own = personal(value.personal, source);
  const scopes = Object.create(null);
  for (const [id, raw] of Object.entries(map(value.scopes, 'scopes', MAX_SCOPES))) {
    scopeKey(id);
    scopes[id] = feedback(raw, id, installed, own, source);
  }
  return { preferences: preferences(value.preferences, installed), packs: installed, personal: own, scopes };
}
export function parseBackup(json) {
  if (typeof json !== 'string' || new TextEncoder().encode(json).length > MAX_BACKUP_BYTES) fail('file is too large');
  let raw;
  try { raw = JSON.parse(json); } catch { fail('file is not valid JSON'); }
  keys(raw, ['format', 'schemaVersion', 'exportedByVersion', 'state'], 'file',
    ['format', 'schemaVersion', 'exportedByVersion', 'state']);
  if (raw.format !== BACKUP_FORMAT || raw.schemaVersion !== BACKUP_SCHEMA) fail('unsupported format or schema version');
  boundedString(raw.exportedByVersion, 40, 'export tool version');
  if (!/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(raw.exportedByVersion)) fail('invalid export tool version');
  return { format: BACKUP_FORMAT, schemaVersion: BACKUP_SCHEMA,
    exportedByVersion: raw.exportedByVersion, state: state(raw.state) };
}
function storageEntries(all) {
  object(all, 'storage');
  const scopes = Object.create(null);
  for (const [key, value] of Object.entries(all)) {
    if (DIRECT_KEYS.has(key) || NON_LEARNING_KEYS.has(key) || key.startsWith('c:')) continue;
    if (!key.startsWith('lang:')) fail('unknown storage format');
    const scope = storageScopeKey(key);
    const suffix = key.slice(storageKey(scope, '').length);
    if (!LEARNING_SUFFIXES.includes(suffix)) fail('unknown learning key');
    (scopes[scope] ||= {})[({ [REVIEW_KEY]: 'review', [PENDING_KEY]: 'events',
      [SENT_KEY]: 'shown', [ENCOUNTERS_KEY]: 'encounters' })[suffix]] = value;
  }
  const es = scopes.es ||= {};
  for (const [key, field] of [[REVIEW_KEY, 'review'], [PENDING_KEY, 'events'],
    [SENT_KEY, 'shown'], [ENCOUNTERS_KEY, 'encounters']])
    if (Object.hasOwn(all, key)) es[field] = all[key];
  return scopes;
}
export function createBackup(all, exportedByVersion) {
  const scopes = storageEntries(all);
  const settings = object(all.settings || {}, 'settings');
  validateStorageSettings(settings);
  const raw = { format: BACKUP_FORMAT, schemaVersion: BACKUP_SCHEMA, exportedByVersion,
    state: { preferences: {
      language: settings.language ?? 'es', levelOverride: settings.levelOverride ?? 0,
      gradual: settings.gradual ?? false, newWordsPerDay: settings.newWordsPerDay ?? 5,
      density: settings.density ?? 'normal', inlineRecall: settings.inlineRecall ?? false,
    }, packs: all.languagePacks || {},
    personal: all.personalVocabularyV1 || { version: 1, revision: 0, entries: [], history: {} },
    scopes } };
  const clean = { ...raw, state: state(raw.state, true) };
  const json = JSON.stringify(clean, null, 2);
  if (new TextEncoder().encode(json).length > MAX_BACKUP_BYTES) fail('supported learning state exceeds file limit');
  return json;
}
export function learningPatch(backup, targetSettings) {
  const out = Object.create(null);
  out.settings = { ...targetSettings, ...backup.state.preferences };
  out.languagePacks = backup.state.packs;
  out.personalVocabularyV1 = backup.state.personal;
  for (const [scope, fields] of Object.entries(backup.state.scopes)) {
    for (const [field, suffix] of [['review', REVIEW_KEY], ['events', PENDING_KEY],
      ['shown', SENT_KEY], ['encounters', ENCOUNTERS_KEY]])
      if (Object.hasOwn(fields, field)) out[storageKey(scope, suffix)] = fields[field];
  }
  return out;
}
export function targetFresh(all) {
  const scopes = storageEntries(all); // rejects unknown target keys, including unknown scoped formats
  validateStorageSettings(all.settings || {});
  if (all.apiKey || all.settings?.apiKey) fail('target has a key; import into a keyless fresh installation');
  if (Object.keys(packs(all.languagePacks || {})).length) fail('target has installed language packs');
  const own = personal(all.personalVocabularyV1 || { version: 1, revision: 0, entries: [], history: {} }, true);
  if (own.entries.length || Object.values(own.history).some((s) => Object.keys(s.cards).length || s.learning.day || s.learning.count))
    fail('target has personal learning');
  for (const [id, raw] of Object.entries(scopes)) {
    if (id !== 'es' && Object.keys(raw).length) fail('target has a learning scope');
    const clean = feedback(raw, id, {}, own, true);
    if (Object.keys(clean.review?.cards || {}).length || clean.review?.learning.day || clean.review?.learning.count ||
        clean.events?.length || clean.shown?.words.length || Object.keys(clean.encounters?.counts || {}).length ||
        clean.encounters?.touched.length) fail('target has learning progress');
  }
  return true;
}
export function validateStorageSettings(settings) {
  keys(settings, SETTINGS_FIELDS, 'settings');
  if (settings.siteOverrides !== undefined) map(settings.siteOverrides, 'site overrides', 10000);
  return true;
}
export function backupPreview(backup) {
  const { state: s } = backup;
  return { exportedByVersion: backup.exportedByVersion,
    languages: new Set(['es', ...Object.keys(s.packs), ...s.personal.entries.map((e) => e.language),
      ...Object.keys(s.personal.history), ...Object.keys(s.scopes).map((k) => k === 'es' ? 'es' :
        k.startsWith('personal:') ? k.slice(9) : k.split(':')[1])]).size,
    packs: Object.keys(s.packs).length,
    cards: Object.values(s.scopes).reduce((sum, scope) => sum + Object.keys(scope.review?.cards || {}).length, 0) +
      Object.values(s.personal.history).reduce((sum, scope) => sum + Object.keys(scope.cards).length, 0),
    personal: s.personal.entries.length, preferences: s.preferences };
}

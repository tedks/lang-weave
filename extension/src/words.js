// My words: progress, the merged word list and "Is this working?". Local data only.
// The list renders in batches so a full pack plus 300 personal entries stays responsive.
import { STAGE_LABELS, todayLine, weekLine, headline, measurementItems } from './progress-text.js';
import { t, tn, localize } from './i18n.js';

localize();

const $ = (id) => document.getElementById(id);
export const BATCH = 60;
const DAY_MS = 86400000;
let list = { rows: [], scope: '', now: 0 };
let shown = [];
let rendered = 0;
let busy = false;
let loadGeneration = 0;

async function send(type, fields = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...fields });
  if (!response || response.error) throw new Error(response?.error || t('words_unavailable'));
  return response;
}
const notice = (message) => { $('notice').textContent = String(message || ''); };

function dueText(row, now) {
  if (row.familiar && !row.maintenance) return t('words_due_not_scheduled');
  if (row.due === null) return t('words_due_not_started');
  if (row.due <= now) return t('words_due_now');
  // Local calendar days, so "tomorrow" means the next local date, not 24 hours away.
  const midnight = (time) => { const d = new Date(time); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const days = Math.round((midnight(row.due) - midnight(now)) / DAY_MS);
  if (days < 1) return tn('words_due_today', Math.max(1, Math.round((row.due - now) / 3600000)));
  return days === 1 ? t('words_due_tomorrow') : tn('words_due_days', days);
}

function drawProgress(p) {
  $('language').textContent = t('words_language_heading', p.language);
  $('headline').textContent = p.returned ? tn('words_headline_returned', p.returned, headline(p.verifiedKnown))
    : headline(p.verifiedKnown);
  $('stages').replaceChildren(...Object.entries(STAGE_LABELS).map(([stage, label]) => {
    const li = document.createElement('li');
    li.textContent = t('words_stage_count', label, p.stages[stage]);
    return li;
  }));
  $('today').textContent = todayLine(p.today);
  const active = p.activity.filter((d) => d.retrievals > 0).length;
  $('strip').setAttribute('aria-label', t('words_strip_label', active));
  $('strip').replaceChildren(...p.activity.map((d) => {
    const cell = document.createElement('span');
    if (d.retrievals > 0) cell.className = 'on';
    cell.title = tn('words_strip_day', d.retrievals, d.day);
    return cell;
  }));
  $('week').textContent = weekLine(p.practisedThisWeek);
  $('measures').replaceChildren(...measurementItems(p.measurements, p.verifiedKnown).map((item) => {
    const li = document.createElement('li');
    const title = document.createElement('strong');
    title.textContent = `${t('words_measure_title', item.title)} `;
    const why = document.createElement('div');
    why.className = 'muted meta';
    why.textContent = item.why;
    li.append(title, item.value, why);
    return li;
  }));
}

// Fold accents on Latin letters only: in other scripts a combining mark makes a different
// letter (Cyrillic й is not и; Devanagari vowel signs are letters).
const fold = (value) => String(value || '').normalize('NFD').replace(/(\p{Script=Latin})[\u0300-\u036f]+/gu, '$1')
  .normalize('NFC').toLocaleLowerCase().trim();
function matching() {
  const query = fold($('search').value);
  const stage = $('stage').value;
  return list.rows.filter((row) => (!stage || row.stage === stage) &&
    (!query || [row.target, row.gloss, row.sense].some((value) => fold(value).includes(query))));
}

function button(label, onClick, { disabled = false, title = '' } = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.disabled = disabled;
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

async function act(control, callback) {
  if (busy) return;
  busy = true;
  control.disabled = true;
  notice('');
  try { await callback(); } catch (error) { notice(error.message); } finally { busy = false; control.disabled = false; }
}

function rowItem(row) {
  const li = document.createElement('li');
  li.tabIndex = -1;
  li.dataset.id = row.id;
  const form = document.createElement('span');
  form.className = 'form';
  form.textContent = row.target;
  const gloss = document.createElement('span');
  const tags = [];
  if (row.kind === 'personal') tags.push(t('words_tag_personal'));
  else if (row.saved) tags.push(t('words_tag_saved'));
  if (row.archived) tags.push(t('words_tag_archived'));
  gloss.textContent = ` · ${row.sense ? t('words_gloss_sense', row.gloss, row.sense) : row.gloss}${tags.map((tag) => ` · ${tag}`).join('')}`;
  const head = document.createElement('div');
  head.append(form, gloss);
  const meta = document.createElement('div');
  meta.className = 'muted meta';
  meta.textContent = t('words_meta', STAGE_LABELS[row.stage], dueText(row, list.now),
    tn('words_seen_on', row.days, tn('words_seen_times', row.exposures)));
  li.setAttribute('aria-label', t('words_row_label', row.target, row.gloss, STAGE_LABELS[row.stage]));
  const actions = document.createElement('div');
  actions.className = 'actions';
  const practise = button(t('words_practise'), () => act(practise, async () => {
    await send('wordPractice', { id: row.id, scope: list.scope });
    await chrome.tabs.create({ url: chrome.runtime.getURL('src/review.html') });
    await load();
  }), { disabled: !row.practise, title: row.reason });
  actions.append(practise);
  if (!row.familiar && !row.archived && row.reason !== 'Its bundled word is not in this pack') {
    const known = button(t('words_known'), () => act(known, async () => {
      await send('wordKnown', { id: row.id, scope: list.scope });
      await load();
    }));
    actions.append(known);
  }
  if (row.version) {
    const reset = button(t('words_reset'), () => {
      // Two clicks: the request carries confirm only from the second, explicit one.
      const box = document.createElement('div');
      box.className = 'actions';
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', t('words_reset_group', row.target));
      const text = document.createElement('span');
      text.textContent = t('words_reset_confirm_text', row.target);
      const confirm = button(t('words_reset_confirm'), () => act(confirm, async () => {
        await send('wordReset', { id: row.id, scope: list.scope, confirm: true, version: row.version });
        notice('');
        await load();
        $('count').textContent = t('words_reset_done', row.target, $('count').textContent);
      }));
      const cancel = button(t('words_cancel'), () => { box.replaceWith(actions); reset.focus(); });
      box.append(text, confirm, cancel);
      actions.replaceWith(box);
      confirm.focus();
    });
    actions.append(reset);
  }
  const archiveId = row.kind === 'personal' ? row.id : row.saved?.id;
  if (archiveId) {
    const archived = row.kind === 'personal' ? row.archived : row.saved.archived;
    const archive = button(archived ? t('words_unarchive') : t('words_archive'), () => act(archive, async () => {
      await send('personalArchive', { id: archiveId, archived: !archived });
      await load();
    }));
    actions.append(archive);
  }
  li.append(head, meta, actions);
  return li;
}

// Rows use a roving tabindex: one row at a time is in the Tab order, and arrow keys move it.
// Each row's buttons stay in the Tab order as well.
function rove(row) {
  for (const li of $('words').querySelectorAll('li[tabindex="0"]')) li.tabIndex = -1;
  if (row) row.tabIndex = 0;
}

function renderMore() {
  const next = shown.slice(rendered, rendered + BATCH);
  $('words').append(...next.map(rowItem));
  if (!$('words').querySelector('li[tabindex="0"]')) rove($('words').querySelector('li[data-id]'));
  rendered += next.length;
  $('more').hidden = rendered >= shown.length;
  $('more').textContent = t('words_more_left', shown.length - rendered);
}

function render() {
  shown = matching();
  rendered = 0;
  $('words').replaceChildren();
  $('count').textContent = shown.length === list.rows.length ? tn('words_count', shown.length)
    : tn('words_count_of', shown.length, list.rows.length);
  if (!shown.length) {
    const li = document.createElement('li');
    li.textContent = list.rows.length ? t('words_no_match') : t('words_no_words');
    $('words').append(li);
    $('more').hidden = true;
    return;
  }
  renderMore();
}

async function load() {
  const generation = ++loadGeneration;
  const [p, words] = await Promise.all([send('progress'), send('wordsList')]);
  if (generation !== loadGeneration) return;
  list = words;
  drawProgress(p);
  const focused = document.activeElement?.closest?.('#words li')?.dataset.id;
  render();
  if (focused) {
    const index = shown.findIndex((row) => row.id === focused);
    while (index >= rendered && rendered < shown.length) renderMore();
    [...$('words').children].find((li) => li.dataset.id === focused)?.focus();
  }
}

// Roving focus between rows. Moving past the last rendered row renders the next batch;
// moving above the first row returns to the search box.
function moveFocus(from, step) {
  if (step === Infinity) while (rendered < shown.length) renderMore();
  const rows = [...$('words').children].filter((li) => li.dataset.id);
  if (!rows.length) return;
  const index = from === null || step === -Infinity ? 0 : step === Infinity ? rows.length - 1 : rows.indexOf(from) + step;
  if (index < 0) { $('search').focus(); return; }
  if (index >= rows.length && rendered < shown.length) { renderMore(); moveFocus(from, step); return; }
  rows[Math.min(index, rows.length - 1)].focus();
}
$('words').addEventListener('focusin', (event) => {
  const row = event.target.closest?.('li[data-id]');
  if (row) rove(row);
});

const STEPS = { ArrowDown: 1, ArrowUp: -1, Home: -Infinity, End: Infinity };
$('words').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { $('search').focus(); return; }
  const row = event.target.closest?.('li');
  // Keys typed on a row's buttons keep their native meaning.
  if (!row || event.target !== row || !(event.key in STEPS)) return;
  event.preventDefault();
  moveFocus(row, STEPS[event.key]);
});
$('search').addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') { event.preventDefault(); moveFocus(null, 1); }
});
$('search').addEventListener('input', render);
$('stage').addEventListener('change', render);
$('more').addEventListener('click', renderMore);
for (const [stage, label] of Object.entries(STAGE_LABELS)) {
  const option = document.createElement('option');
  option.value = stage;
  option.textContent = label;
  $('stage').append(option);
}
for (const id of ['openEntries', 'openSettings']) $(id).addEventListener('click', (event) => {
  event.preventDefault();
  void (id === 'openSettings' ? chrome.runtime.openOptionsPage()
    : chrome.tabs.create({ url: chrome.runtime.getURL('src/capture.html') }));
});
// Ratings in other tabs change stages and due dates; refresh when this tab is shown again.
document.addEventListener('visibilitychange', () => { if (!document.hidden) void load().catch((e) => notice(e.message)); });
void load().catch((error) => notice(error.message));

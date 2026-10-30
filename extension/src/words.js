// My words: progress, the merged word list and "Is this working?". Local data only.
// The list renders in batches so a full pack plus 300 personal entries stays responsive.
import { STAGE_LABELS, plural, todayLine, weekLine, headline, measurementItems } from './progress-text.js';

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
  if (!response || response.error) throw new Error(response?.error || 'My words is unavailable');
  return response;
}
const notice = (message) => { $('notice').textContent = String(message || ''); };

function dueText(row, now) {
  if (row.familiar && !row.maintenance) return 'Not scheduled';
  if (row.due === null) return 'Not started';
  if (row.due <= now) return 'Due now';
  // Local calendar days, so "tomorrow" means the next local date, not 24 hours away.
  const midnight = (time) => { const d = new Date(time); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const days = Math.round((midnight(row.due) - midnight(now)) / DAY_MS);
  if (days < 1) return `Due today in ${plural(Math.max(1, Math.round((row.due - now) / 3600000)), 'hour')}`;
  return days === 1 ? 'Due tomorrow' : `Due in ${plural(days, 'day')}`;
}

function drawProgress(p) {
  $('language').textContent = `${p.language} words on this device`;
  $('headline').textContent = headline(p.verifiedKnown) +
    (p.returned ? ` · ${plural(p.returned, 'word')} returned from retirement to be verified` : '');
  $('stages').replaceChildren(...Object.entries(STAGE_LABELS).map(([stage, label]) => {
    const li = document.createElement('li');
    li.textContent = `${label}: ${p.stages[stage]}`;
    return li;
  }));
  $('today').textContent = todayLine(p.today);
  const active = p.activity.filter((d) => d.retrievals > 0).length;
  $('strip').setAttribute('aria-label', `Days with reviews in the last 30 days: ${active}`);
  $('strip').replaceChildren(...p.activity.map((d) => {
    const cell = document.createElement('span');
    if (d.retrievals > 0) cell.className = 'on';
    cell.title = `${d.day}: ${plural(d.retrievals, 'review')}`;
    return cell;
  }));
  $('week').textContent = weekLine(p.practisedThisWeek);
  $('measures').replaceChildren(...measurementItems(p.measurements, p.verifiedKnown).map((item) => {
    const li = document.createElement('li');
    const title = document.createElement('strong');
    title.textContent = `${item.title}: `;
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
  gloss.textContent = ` · ${row.gloss}${row.sense ? ` (${row.sense})` : ''}${row.kind === 'personal' ? ' · your word' : row.saved ? ' · saved by you' : ''}${row.archived ? ' · archived' : ''}`;
  const head = document.createElement('div');
  head.append(form, gloss);
  const meta = document.createElement('div');
  meta.className = 'muted meta';
  meta.textContent = `${STAGE_LABELS[row.stage]} · ${dueText(row, list.now)} · seen ${plural(row.exposures, 'time')} on ${plural(row.days, 'day')}`;
  li.setAttribute('aria-label', `${row.target}, ${row.gloss}, ${STAGE_LABELS[row.stage]}`);
  const actions = document.createElement('div');
  actions.className = 'actions';
  const practise = button('Practice now', () => act(practise, async () => {
    await send('wordPractice', { id: row.id, scope: list.scope });
    await chrome.tabs.create({ url: chrome.runtime.getURL('src/review.html') });
    await load();
  }), { disabled: !row.practise, title: row.reason });
  actions.append(practise);
  if (!row.familiar && !row.archived && row.reason !== 'Its bundled word is not in this pack') {
    const known = button('Already know', () => act(known, async () => {
      await send('wordKnown', { id: row.id, scope: list.scope });
      await load();
    }));
    actions.append(known);
  }
  if (row.version) {
    const reset = button('Reset', () => {
      // Two clicks: the request carries confirm only from the second, explicit one.
      const box = document.createElement('div');
      box.className = 'actions';
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', `Reset ${row.target}`);
      const text = document.createElement('span');
      text.textContent = `Reset ${row.target}? Its schedule, review count and "known" mark are cleared; your history stays in the measurements.`;
      const confirm = button('Confirm reset', () => act(confirm, async () => {
        await send('wordReset', { id: row.id, scope: list.scope, confirm: true, version: row.version });
        notice('');
        await load();
        $('count').textContent = `${row.target} was reset. ${$('count').textContent}`;
      }));
      const cancel = button('Cancel', () => { box.replaceWith(actions); reset.focus(); });
      box.append(text, confirm, cancel);
      actions.replaceWith(box);
      confirm.focus();
    });
    actions.append(reset);
  }
  const archiveId = row.kind === 'personal' ? row.id : row.saved?.id;
  if (archiveId) {
    const archived = row.kind === 'personal' ? row.archived : row.saved.archived;
    const archive = button(archived ? 'Unarchive' : 'Archive', () => act(archive, async () => {
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
  $('more').textContent = `Show more (${shown.length - rendered} left)`;
}

function render() {
  shown = matching();
  rendered = 0;
  $('words').replaceChildren();
  $('count').textContent = shown.length === list.rows.length ? plural(shown.length, 'word')
    : `${plural(shown.length, 'word')} of ${list.rows.length}`;
  if (!shown.length) {
    const li = document.createElement('li');
    li.textContent = list.rows.length ? 'No word matches.' : 'No words yet.';
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

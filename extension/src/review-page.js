const $ = (id) => document.getElementById(id);
const DAY_MS = 86400000;
const AUTO_RELOAD_MS = 60 * 60 * 1000;
// Number keys follow the on-screen order. "Already know" has no key: retiring a
// word should take a deliberate click, never a stray keystroke.
// event.code covers layouts such as AZERTY, where the digit row needs Shift.
const RATING_KEYS = { 1: 'again', 2: 'hard', 3: 'medium', 4: 'easy' };
const RATING_CODES = { Digit1: 'again', Digit2: 'hard', Digit3: 'medium', Digit4: 'easy',
  Numpad1: 'again', Numpad2: 'hard', Numpad3: 'medium', Numpad4: 'easy' };
let card = null;
let busy = false;
let loadGeneration = 0;
let refreshQueued = false;
let returnTimer = null;
// Page-local session summary. It holds only counts and the due times the worker
// returned for ratings made in this tab; nothing here is stored.
let session = { language: null, reviewed: 0, returns: [] };

async function send(type, fields = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...fields });
  if (!response || response.error) throw new Error(response?.error || 'Review is unavailable');
  return response;
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function counts(data) {
  $('counts').textContent = `${data.due} due · ${data.new} available to add`;
  $('introduce').hidden = data.new === 0;
  $('introduce').textContent = `Add ${plural(Math.min(5, data.new), 'new word')}`;
}

function showAnswer(answer) {
  $('answer').textContent = answer.fr;
  $('hint').textContent = answer.hint ? `Pronunciation: ${answer.hint}` : '';
  $('solution').hidden = false;
  $('reveal').hidden = true;
}

function midnight(time) {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

// Due times from this session that are still ahead. A past one has already come
// back and was either re-rated here (a newer due time was recorded) or handled
// on another surface, so it no longer describes a future review.
function upcoming(now = Date.now()) {
  return session.returns.filter((due) => due > now);
}

// When the earliest card rated in this session comes back, and how many of this
// session's cards return on that same local day.
function nextReturn(now = Date.now()) {
  const returns = upcoming(now);
  if (!returns.length) return '';
  const first = Math.min(...returns);
  const day = midnight(first);
  const count = returns.filter((due) => midnight(due) === day).length;
  const days = Math.round((day - midnight(now)) / DAY_MS);
  const when = days <= 0
    ? `today from ${new Date(first).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : days === 1 ? 'tomorrow'
      : `on ${new Date(first).toLocaleDateString([], days < 7 ? { weekday: 'long' } : { month: 'long', day: 'numeric' })}`;
  return `Next review from this session: ${when}, ${plural(count, 'word')}.`;
}

// With nothing on screen, recheck when a card rated here comes due, and at
// least hourly so a tab left open still picks up cards due from other sessions.
function scheduleReturn() {
  clearTimeout(returnTimer);
  returnTimer = null;
  if (card) return;
  const returns = upcoming();
  const wait = returns.length ? Math.min(...returns) - Date.now() + 1000 : AUTO_RELOAD_MS;
  returnTimer = setTimeout(() => refresh(), Math.max(1000, Math.min(wait, AUTO_RELOAD_MS)));
}

function showQueue(response) {
  card = response.card;
  counts(response);
  $('question').hidden = !card;
  $('solution').hidden = true;
  $('reveal').hidden = false;
  const finished = !card && session.reviewed > 0;
  $('finish').hidden = !finished;
  $('empty').hidden = !!card || finished;
  $('empty').textContent = response.new
    ? 'No reviews due. Add a few words when you are ready.'
    : 'You are caught up. Come back when a card is due.';
  if (finished) {
    $('finish-summary').textContent = `You completed ${plural(session.reviewed, 'review')}.`;
    $('finish-next').textContent = nextReturn();
  }
  if (card) {
    const position = session.reviewed + 1;
    $('progress').textContent = `Card ${position} of ${Math.max(position, session.reviewed + response.due)}`;
    $('prompt').textContent = card.en;
  }
  scheduleReturn();
}

async function load() {
  const generation = ++loadGeneration;
  const response = await send('reviewNext');
  if (generation !== loadGeneration) return;
  $('retry').hidden = true;
  if (response.language !== session.language) session = { language: response.language, reviewed: 0, returns: [] };
  $('language').textContent = `Reviewing ${response.language}`;
  for (const name of document.querySelectorAll('.language-name')) name.textContent = response.language;
  showQueue(response);
  if (card?.revealed) {
    const { answer } = await send('reviewReveal', { ticket: card.ticket });
    if (generation !== loadGeneration) return;
    showAnswer(answer);
  }
}

function focusable(element) {
  return !!element && element !== document.body && element.isConnected &&
    !element.disabled && !element.closest('[hidden]');
}

// The control a keyboard user needs next. Disabling buttons during an action
// drops focus to <body> in Chromium, so every action ends by placing it here.
function settleFocus() {
  const target = $('retry').hidden ? nextFocus() : $('retry');
  if (target && document.activeElement !== target) target.focus();
}

function nextFocus() {
  if (card) return $('solution').hidden ? $('reveal') : document.querySelector('[data-rating="medium"]');
  if (!$('finish').hidden) return $('finish');
  if (!$('introduce').hidden) return $('introduce');
  return $('empty');
}

// `follow` actions move focus to the next step; background refreshes keep the
// user's place when it still exists.
async function run(action, { follow = true } = {}) {
  if (busy) return;
  busy = true;
  const before = document.activeElement;
  const main = document.querySelector('main');
  main?.setAttribute('aria-busy', 'true');
  $('notice').textContent = '';
  for (const button of document.querySelectorAll('button')) button.disabled = true;
  try { await action(); }
  catch (error) {
    $('notice').textContent = error.message || 'Review failed';
    // A failed load, or a card the worker no longer accepts ("Reload the
    // queue."), leaves the page stale; offer the reload the error asks for.
    $('retry').hidden = false;
  }
  finally {
    busy = false;
    for (const button of document.querySelectorAll('button')) button.disabled = false;
    main?.removeAttribute('aria-busy');
    if (!follow) {
      // A background refresh never pulls focus from where the user left it;
      // it only rescues focus from a control the refresh hid or removed.
      if (focusable(before)) before.focus();
      else if (before && before !== document.body && !focusable(document.activeElement)) settleFocus();
    } else settleFocus();
    if (refreshQueued) { refreshQueued = false; void run(load, { follow: false }); }
  }
}

function refresh() {
  if (busy) refreshQueued = true;
  else void run(load, { follow: false });
}

$('reveal').addEventListener('click', () => run(async () => {
  if (!card) return;
  const generation = loadGeneration;
  const { answer } = await send('reviewReveal', { ticket: card.ticket });
  if (generation !== loadGeneration) return;
  showAnswer(answer);
}));
$('introduce').addEventListener('click', () => run(async () => {
  await send('reviewIntroduce');
  await load();
}));
$('retry').addEventListener('click', () => run(load));
for (const button of document.querySelectorAll('[data-rating]')) {
  button.addEventListener('click', () => run(async () => {
    if (!card || $('solution').hidden) return;
    const result = await send('reviewRate', { ticket: card.ticket, rating: button.dataset.rating });
    session.reviewed++;
    // With gradual learning on, a third Easy in a row retires the word, and the
    // worker's reply does not say whether that happened. Leave Easy out rather
    // than promise a return that may never come.
    if (button.dataset.rating !== 'easy' && Number.isSafeInteger(result.due)) session.returns.push(result.due);
    await load();
  }));
}
$('known').addEventListener('click', () => run(async () => {
  if (!card || $('solution').hidden) return;
  await send('reviewKnown', { ticket: card.ticket });
  session.reviewed++;
  await load();
}));

document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
  const control = typeof event.target?.closest === 'function' &&
    event.target.closest('button, a, input, select, textarea, [contenteditable]');
  const typing = control && !control.matches('button');
  if (typing) return;
  if (event.key === ' ' || event.key === 'Enter') {
    // A held key must not reveal and then rate in one press.
    if (event.repeat) { if (card) event.preventDefault(); return; }
    if (event.shiftKey) return;
    // A focused button activates natively; only claim the key from the page body.
    if (control || !card || !$('solution').hidden || busy) return;
    event.preventDefault();
    $('reveal').click();
    return;
  }
  const rating = RATING_KEYS[event.key] || RATING_CODES[event.code];
  if (!rating || event.repeat || !card || $('solution').hidden) return;
  event.preventDefault();
  document.querySelector(`[data-rating="${rating}"]`)?.click();
});

void run(load);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !(changes.settings || changes.languagePacks)) return;
  loadGeneration++;
  refresh();
});
// A due time can pass while the tab sits in the background; check again when it
// comes back into view instead of asking the user to refresh.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !card) refresh();
});

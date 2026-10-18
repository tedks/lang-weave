const $ = (id) => document.getElementById(id);
let card = null;
let busy = false;
let loadGeneration = 0;
let refreshQueued = false;

async function send(type, fields = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...fields });
  if (!response || response.error) throw new Error(response?.error || 'Review is unavailable');
  return response;
}

function counts(data) {
  $('counts').textContent = `${data.due} due · ${data.new} available to add`;
  $('introduce').hidden = data.new === 0;
  $('introduce').textContent = `Add ${Math.min(5, data.new)} new word${data.new === 1 ? '' : 's'}`;
}

function showAnswer(answer) {
  $('answer').textContent = answer.fr;
  $('hint').textContent = answer.hint ? `Pronunciation: ${answer.hint}` : '';
  $('solution').hidden = false;
  $('reveal').hidden = true;
}

async function load() {
  const generation = ++loadGeneration;
  const response = await send('reviewNext');
  if (generation !== loadGeneration) return;
  $('language').textContent = `Reviewing ${response.language}`;
  card = response.card;
  counts(response);
  $('question').hidden = !card;
  $('empty').hidden = !!card;
  $('solution').hidden = true;
  $('reveal').hidden = false;
  $('empty').textContent = response.new
    ? 'No reviews due. Add a few words when you are ready.'
    : 'You are caught up. Come back when a card is due.';
  if (!card) return;
  $('prompt').textContent = card.en;
  if (card.revealed) showAnswer((await send('reviewReveal', { ticket: card.ticket })).answer);
}

async function run(action) {
  if (busy) return;
  busy = true;
  $('notice').textContent = '';
  for (const button of document.querySelectorAll('button')) button.disabled = true;
  try { await action(); }
  catch (error) { $('notice').textContent = error.message || 'Review failed'; }
  finally {
    busy = false;
    for (const button of document.querySelectorAll('button')) button.disabled = false;
    if (refreshQueued) { refreshQueued = false; void run(load); }
  }
}

$('reveal').addEventListener('click', () => run(async () => {
  if (!card) return;
  showAnswer((await send('reviewReveal', { ticket: card.ticket })).answer);
}));
$('introduce').addEventListener('click', () => run(async () => {
  await send('reviewIntroduce');
  await load();
}));
$('refresh').addEventListener('click', () => run(load));
for (const button of document.querySelectorAll('[data-rating]')) {
  button.addEventListener('click', () => run(async () => {
    if (!card || $('solution').hidden) return;
    await send('reviewRate', { ticket: card.ticket, rating: button.dataset.rating });
    await load();
  }));
}
void run(load);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !(changes.settings || changes.languagePacks)) return;
  loadGeneration++;
  if (busy) refreshQueued = true;
  else void run(load);
});

const $ = (id) => document.getElementById(id);
const nonce = new URL(location.href).searchParams.get('nonce') || '';
let draft = null;
let busy = false;
let allEntries = [];

async function send(type, fields = {}) {
  const result = await chrome.runtime.sendMessage({ type, ...fields });
  if (!result || result.error && !(type === 'captureDraft' && Object.hasOwn(result, 'selectedText')))
    throw new Error(result?.error || 'The request could not be completed.');
  return result;
}
function notice(message) { $('notice').textContent = String(message || ''); }
function fillDirection(direction) {
  const radio = document.querySelector(`input[name="direction"][value="${direction}"]`);
  if (radio) radio.checked = true;
}
function drawSuggestions(matches) {
  const container = $('matches');
  container.replaceChildren();
  if (!Array.isArray(matches) || !matches.length) {
    const p = document.createElement('p'); p.textContent = 'No local suggestions. Enter both forms yourself.'; container.append(p); return;
  }
  const title = document.createElement('h2'); title.textContent = 'Local suggestions'; container.append(title);
  for (const match of matches.slice(0, 32)) {
    const item = document.createElement('article');
    const text = document.createElement('p');
    const source = String(match?.en ?? match?.source ?? '');
    const target = String(match?.fr ?? match?.target ?? '');
    text.textContent = `${source} ⇄ ${target}${match?.sense ? ` · ${String(match.sense)}` : ''}`;
    const provenance = document.createElement('p'); provenance.className = 'muted';
    const origin = match?.provenance === 'bundled-suggestion'
      ? 'Bundled suggestion; meaning has not been independently dictionary checked'
      : match?.provenance === 'manual' ? 'Your saved personal entry' : 'Local suggestion';
    provenance.textContent = `${origin}${match?.reviewOnly ? ` · Review only: ${String(match.reason || 'automatic reading is disabled for this entry')}` : ''}`;
    const choose = document.createElement('button'); choose.type = 'button'; choose.textContent = 'Use suggestion';
    choose.addEventListener('click', () => {
      $('source').value = source;
      $('target').value = target;
      $('sense').value = String(match?.sense ?? '');
      fillDirection(match?.direction === 'target-to-en' ? 'target-to-en' : 'en-to-target');
      $('distinct').checked = false;
    });
    item.append(text, provenance, choose); container.append(item);
  }
}
function drawEntries(entries) {
  const list = $('entries'); list.replaceChildren();
  if (!Array.isArray(entries) || !entries.length) {
    const li = document.createElement('li'); li.textContent = 'No personal entries yet.'; list.append(li); return;
  }
  for (const entry of entries.slice(0, 300)) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `${String(entry?.en || '')} ⇄ ${String(entry?.fr || entry?.target || '')}${entry?.sense ? ` · ${String(entry.sense)}` : ''}${entry?.archived ? ' · Archived' : ''}`;
    li.append(label);
    if (entry?.reviewOnly) {
      const why = document.createElement('p'); why.className = 'muted';
      why.textContent = `Review only; automatic reading is disabled${entry.reason ? `: ${String(entry.reason)}` : '.'}`;
      li.append(why);
    }
    if (!entry?.archived && entry?.id) {
      const introduce = document.createElement('button'); introduce.type = 'button'; introduce.textContent = 'Add to review';
      introduce.addEventListener('click', () => act(introduce, async () => {
        const result = await send('personalIntroduce', { id: String(entry.id) });
        notice(result.added ? 'Added to review.' : 'No new review card was added.');
        await loadEntries();
      }));
      li.append(introduce);
    }
    if (entry?.id) {
      const archive = document.createElement('button'); archive.type = 'button';
      archive.textContent = entry.archived ? 'Unarchive' : 'Archive';
      archive.addEventListener('click', () => act(archive, async () => {
        await send('personalArchive', { id: String(entry.id), archived: !entry.archived });
        await loadEntries();
      }));
      li.append(archive);
    }
    list.append(li);
  }
}
async function loadEntries() {
  const result = await send('personalList');
  allEntries = Array.isArray(result.entries) ? result.entries : [];
  filterEntries();
}
function filterEntries() {
  const query = $('entry-search').value.normalize('NFC').toLocaleLowerCase().trim();
  drawEntries(query ? allEntries.filter((entry) => [entry.en, entry.fr, entry.target, entry.sense, entry.language]
    .some((value) => String(value || '').normalize('NFC').toLocaleLowerCase().includes(query))) : allEntries);
}
$('entry-search').addEventListener('input', filterEntries);
for (const radio of document.querySelectorAll('input[name="direction"]')) radio.addEventListener('change', () => {
  if (!draft?.selectedText) return;
  if (radio.value === 'en-to-target') $('source').value = draft.selectedText;
  else $('target').value = draft.selectedText;
});
async function act(button, callback) {
  if (busy) return;
  busy = true; button.disabled = true;
  try { await callback(); }
  catch (error) { notice(error.message); }
  finally { busy = false; button.disabled = false; }
}
async function loadDraft() {
  if (!nonce) return;
  try {
    const result = await send('captureDraft', { nonce });
    draft = result;
    $('selected').textContent = String(result.selectedText || '');
    $('language').textContent = `Selected language: ${String(result.language || 'unknown')}`;
    if (result.error) notice(result.error);
    $('retry').hidden = false;
    $('editor').hidden = false;
    drawSuggestions(result.matches);
  } catch (error) {
    notice(`${error.message} You can retry this page or cancel the capture.`);
    $('retry').hidden = false;
    $('editor').hidden = false;
  }
}
$('capture-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void act($('save'), async () => {
    if (!draft || !nonce) throw new Error('Capture expired. Retry from the page selection.');
    const fields = new FormData(event.currentTarget);
    const result = await send('captureSave', { nonce, direction: fields.get('direction'), source: fields.get('source'), target: fields.get('target'), sense: fields.get('sense'), distinct: $('distinct').checked });
    notice(result.reviewOnly ? 'Saved as a review-only personal entry.' : result.duplicate ? 'This personal entry already exists.' : 'Saved as a personal entry. It was not added to review.');
    draft = null;
    await loadEntries();
  });
});
$('cancel').addEventListener('click', () => act($('cancel'), async () => {
  if (nonce) await send('captureCancel', { nonce });
  draft = null;
  $('editor').hidden = true;
  notice('Capture cancelled.');
}));
$('refresh').addEventListener('click', () => act($('refresh'), loadEntries));
$('retry').addEventListener('click', () => act($('retry'), loadDraft));
$('export').addEventListener('click', () => act($('export'), async () => {
  const result = await send('personalExport');
  const payload = typeof result.json === 'string' ? result.json : JSON.stringify(result.export ?? result, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'lang-weave-personal-export.json';
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
  notice('Personal export downloaded.');
}));
void Promise.all([loadDraft(), loadEntries()]).catch((error) => notice(error.message));

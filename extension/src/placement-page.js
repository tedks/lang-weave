import { localize, t } from './i18n.js';
import { placementSamples } from './placement.js';

export function mountPlacement(panel) {
  panel.insertAdjacentHTML('beforeend', `
    <p data-i18n="placement_intro"></p>
    <div class="placement-samples">
      <div data-placement-beginner>
        <h3 data-i18n="placement_beginner"></h3>
        <ul></ul>
        <details><summary data-i18n="placement_meanings_beginner"></summary><ul></ul></details>
      </div>
      <div data-placement-expanded>
        <h3 data-i18n="placement_expanded"></h3>
        <ul></ul>
        <details><summary data-i18n="placement_meanings_expanded"></summary><ul></ul></details>
      </div>
    </div>
    <form>
      <fieldset disabled aria-describedby="placementHelp">
        <legend data-i18n="placement_legend"></legend>
        <p id="placementHelp" data-i18n="placement_help"></p>
        <label for="placementChoice" data-i18n="placement_choice"></label>
        <select id="placementChoice">
          <option value="0" data-i18n="placement_default"></option>
          <option value="1" data-i18n="placement_beginner"></option>
          <option value="2" data-i18n="placement_expanded"></option>
        </select>
        <button type="submit" data-i18n="placement_save"></button>
      </fieldset>
    </form>
    <p role="status"></p>
  `);
  const form = panel.querySelector('form');
  const fieldset = form.querySelector('fieldset');
  const choice = form.querySelector('select');
  const status = panel.querySelector('[role="status"]');
  const [beginner, expanded] = placementSamples();
  let snapshot;
  let busy = false;

  function showExamples(container, words) {
    container.hidden = words.length === 0;
    const appendWords = (list, meanings) => {
      for (const { fr, en } of words) {
        const item = document.createElement('li');
        const target = document.createElement('span');
        target.lang = 'es';
        target.textContent = fr;
        item.append(target);
        if (meanings) {
          const gloss = document.createElement('span');
          gloss.lang = 'en';
          gloss.textContent = ` · ${en}`;
          item.append(gloss);
        }
        list.append(item);
      }
    };
    const [prompts, answers] = container.querySelectorAll('ul');
    appendWords(prompts, false);
    appendWords(answers, true);
  }
  showExamples(panel.querySelector('[data-placement-beginner]'), beginner);
  showExamples(panel.querySelector('[data-placement-expanded]'), expanded);
  choice.querySelector('[value="1"]').disabled = beginner.length === 0;
  choice.querySelector('[value="2"]').disabled = expanded.length === 0;
  localize(panel);

  async function load() {
    snapshot = null;
    fieldset.disabled = true;
    const current = await chrome.runtime.sendMessage({ type: 'placement' });
    if (!current?.available) {
      status.textContent = t(current?.available === false ? 'placement_spanish_only' : 'placement_error');
      return;
    }
    snapshot = current;
    choice.value = String(current.choice);
    fieldset.disabled = false;
    status.textContent = '';
  }

  panel.addEventListener('toggle', async () => {
    if (!panel.open || busy) return;
    busy = true;
    try { await load(); }
    catch { status.textContent = t('placement_error'); }
    finally { busy = false; }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !snapshot) return;
    const selected = Number(choice.value);
    if (choice.selectedOptions[0]?.disabled) return;
    busy = true;
    fieldset.disabled = true;
    try {
      const result = await chrome.runtime.sendMessage({ type: 'placement', choice: selected, epoch: snapshot.epoch });
      if (result?.ok) {
        snapshot = result;
        status.textContent = t('placement_saved');
      } else {
        await load();
        if (snapshot) status.textContent = t('placement_changed');
      }
    } catch { status.textContent = t('placement_error'); }
    finally { fieldset.disabled = !snapshot; busy = false; }
  });
}

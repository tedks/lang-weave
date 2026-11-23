import { localize, t } from './i18n.js';
import { duolingoPreview, placementSamples } from './placement.js';

export function mountPlacement(panel) {
  panel.insertAdjacentHTML('beforeend', `
    <p data-i18n="placement_intro"></p>
    <form data-placement-score hidden autocomplete="off">
      <label for="duolingoScore" data-i18n="placement_score_label"></label>
      <input id="duolingoScore" inputmode="numeric" aria-describedby="placementScoreHelp placementScoreStatus">
      <button type="submit" data-i18n="placement_score_preview"></button>
      <p id="placementScoreHelp" data-i18n="placement_score_help"></p>
      <p id="placementScoreStatus" role="status"></p>
    </form>
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
    <form data-placement-choice>
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
    <p role="status" data-placement-status></p>
    <button type="button" data-placement-retry hidden data-i18n="placement_retry"></button>
  `);
  const form = panel.querySelector('[data-placement-choice]');
  const fieldset = form.querySelector('fieldset');
  const choice = form.querySelector('select');
  const status = panel.querySelector('[data-placement-status]');
  const retry = panel.querySelector('[data-placement-retry]');
  const scoreForm = panel.querySelector('[data-placement-score]');
  const score = scoreForm.querySelector('input');
  const scoreStatus = scoreForm.querySelector('[role="status"]');
  const samples = panel.querySelector('.placement-samples');
  const beginnerExamples = samples.querySelector('[data-placement-beginner]');
  const expandedExamples = samples.querySelector('[data-placement-expanded]');
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
  showExamples(beginnerExamples, beginner);
  showExamples(expandedExamples, expanded);
  choice.querySelector('[value="1"]').disabled = beginner.length === 0;
  choice.querySelector('[value="2"]').disabled = expanded.length === 0;
  localize(panel);

  function clearScore() {
    score.value = '';
    score.removeAttribute('aria-invalid');
    scoreStatus.textContent = '';
    samples.prepend(beginnerExamples);
  }

  scoreForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!snapshot || scoreForm.hidden) return;
    const hint = duolingoPreview(score.value);
    samples.prepend(hint === 2 ? expandedExamples : beginnerExamples);
    if (hint === null && score.value.trim()) {
      score.setAttribute('aria-invalid', 'true');
      scoreStatus.textContent = t('placement_score_invalid');
      score.focus();
      return;
    }
    score.value = '';
    score.removeAttribute('aria-invalid');
    scoreStatus.textContent = hint === 2 ? t('placement_score_expanded')
      : hint === 1 ? t('placement_score_beginner') : '';
  });

  async function load() {
    snapshot = null;
    fieldset.disabled = true;
    scoreForm.hidden = true;
    clearScore();
    const current = await chrome.runtime.sendMessage({ type: 'placement' });
    if (current?.available === false) {
      status.textContent = t('placement_spanish_only');
      retry.hidden = true;
      return;
    }
    if (!current?.available) throw new Error('Placement unavailable');
    snapshot = current;
    scoreForm.hidden = !(beginner.length && expanded.length);
    choice.value = String(current.choice);
    if (choice.selectedOptions[0]?.disabled) choice.value = '0';
    fieldset.disabled = false;
    retry.hidden = true;
    status.textContent = '';
  }

  function showError() {
    status.textContent = t('placement_error');
    retry.hidden = !!snapshot;
  }

  async function refresh() {
    if (busy) return;
    busy = true;
    try { await load(); }
    catch { showError(); }
    finally { busy = false; }
  }

  panel.addEventListener('toggle', () => {
    if (panel.open) void refresh();
    else clearScore();
  });
  retry.addEventListener('click', async () => {
    const wasFocused = document.activeElement === retry;
    await refresh();
    const focused = document.activeElement;
    if (snapshot && panel.open && (focused === retry || wasFocused && focused === document.body)) choice.focus();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !snapshot) return;
    const selected = Number(choice.value);
    if (choice.selectedOptions[0]?.disabled) return;
    const previousFocus = document.activeElement;
    busy = true;
    fieldset.disabled = true;
    status.textContent = '';
    try {
      const result = await chrome.runtime.sendMessage({ type: 'placement', choice: selected, epoch: snapshot.epoch });
      if (result?.ok) {
        snapshot = result;
        status.textContent = t('placement_saved');
      } else if (result?.ok === false) {
        const previousChoice = snapshot.choice;
        await load();
        if (snapshot) {
          if (snapshot.choice === previousChoice) choice.value = String(selected);
          status.textContent = t('placement_changed');
        }
      } else showError();
    } catch { showError(); }
    finally {
      fieldset.disabled = !snapshot;
      busy = false;
      // Chromium can drop focus when disabling a focused form control.
      if (panel.open && fieldset.contains(previousFocus) &&
          (document.activeElement === document.body || document.activeElement === previousFocus)) {
        if (snapshot) previousFocus.focus();
        else if (!retry.hidden) retry.focus();
        else panel.querySelector('summary').focus();
      }
    }
  });
}

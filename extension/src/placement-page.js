import { localize, t } from './i18n.js';
import { duolingoPreview, placementSamples } from './placement.js';
import { DEFAULT_SETTINGS } from './settings.js';

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
  const trigger = panel.firstElementChild;
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
  const isOpen = () => panel.open && !panel.hidden;
  let snapshot;
  let saveEpoch;
  let opening = 0;
  let readGeneration = 0;
  let saving = false;
  let pendingSave;
  let saveFocus;
  let notice;

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

  function showFirst(hint) {
    const first = hint === 2 ? expandedExamples : beginnerExamples;
    const last = hint === 2 ? beginnerExamples : expandedExamples;
    if (samples.firstElementChild === first) return;
    // Leave the focused group in place when a language change resets order.
    if (first.contains(document.activeElement)) samples.append(last);
    else samples.prepend(first);
  }

  function hideScore() {
    const wasFocused = scoreForm.contains(document.activeElement);
    scoreForm.hidden = true;
    score.value = '';
    score.removeAttribute('aria-invalid');
    scoreStatus.textContent = '';
    showFirst(1);
    if (wasFocused && isOpen()) trigger.focus();
  }

  scoreForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!isOpen() || scoreForm.hidden) return;
    const hint = duolingoPreview(score.value);
    showFirst(hint);
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

  function announce(message, kind) {
    notice = kind;
    if (status.textContent !== message) status.textContent = message;
  }

  function restoreSaveFocus() {
    const previousFocus = saveFocus;
    saveFocus = undefined;
    // Chromium can drop focus when disabling a focused form control.
    if (!previousFocus ||
        (document.activeElement !== document.body && document.activeElement !== previousFocus)) return;
    if (!fieldset.disabled) previousFocus.focus();
    else if (!retry.hidden) retry.focus();
    else trigger.focus();
  }

  function showSnapshot(current) {
    const selected = Number(choice.value);
    const previousChoice = snapshot?.choice;
    const dirty = snapshot && selected !== previousChoice;
    const wasUnavailable = snapshot?.available === false;
    const option = [...choice.options].find(({ value, disabled }) => Number(value) === current.choice && !disabled)
      ?? choice.options[0];
    const saved = Number(option.value);
    const recovering = !retry.hidden;
    const focused = document.activeElement;
    const settled = pendingSave;
    pendingSave = undefined;
    snapshot = { ...current, choice: saved };
    retry.hidden = true;
    fieldset.disabled = !current.available;
    if (!current.available) {
      hideScore();
      announce(t('placement_spanish_only'));
      if (focused === retry || fieldset.contains(focused)) trigger.focus();
      restoreSaveFocus();
      return;
    }
    scoreForm.hidden = !(beginner.length && expanded.length);
    if (!dirty) choice.value = String(saved);
    // Refresh the displayed saved choice without granting a dirty draft a new
    // epoch. A rejected Save can do so with an explicit second-save prompt.
    const clean = !dirty || selected === saved;
    if (clean || settled === 'conflict') saveEpoch = current.epoch;
    const label = option.textContent;
    if (settled === 'saved' && selected === saved) announce(t('placement_saved'), 'saved');
    else if (settled === 'conflict') announce(t('placement_changed', label), 'draft');
    else if (!clean && saveEpoch !== current.epoch) announce(t('placement_competing', label), 'draft');
    else if (settled === 'error') announce(t('placement_error'));
    else if (recovering || wasUnavailable || (notice === 'draft' && clean) ||
             (notice === 'saved' && saved !== previousChoice)) announce('');
    if (focused === retry) choice.focus();
    restoreSaveFocus();
  }

  async function refresh() {
    if (saving || !isOpen()) return;
    const generation = ++readGeneration;
    const isCurrent = () => isOpen() && generation === readGeneration;
    try {
      const current = await chrome.runtime.sendMessage({ type: 'placement' });
      if (!isCurrent()) return;
      if (typeof current?.available !== 'boolean') throw new Error('Placement unavailable');
      showSnapshot(current);
    } catch {
      if (isCurrent()) {
        announce(t('placement_error'));
        retry.hidden = false;
        restoreSaveFocus();
      }
    }
  }

  panel.addEventListener('toggle', () => {
    opening++;
    readGeneration++;
    snapshot = null;
    pendingSave = undefined;
    saveFocus = undefined;
    fieldset.disabled = true;
    retry.hidden = true;
    hideScore();
    announce('');
    void refresh();
  });
  chrome.storage?.onChanged?.addListener(({ settings, spanishPlacement, epoch }, area) => {
    if (area !== 'local') return;
    const before = settings?.oldValue?.language ?? DEFAULT_SETTINGS.language;
    const after = settings?.newValue?.language ?? DEFAULT_SETTINGS.language;
    if (before !== after) {
      const focused = document.activeElement;
      const choiceFocused = fieldset.contains(focused) || (saveFocus && focused === document.body);
      if (snapshot) snapshot = { ...snapshot, available: false };
      fieldset.disabled = true;
      pendingSave = undefined;
      saveFocus = undefined;
      hideScore();
      if (choiceFocused && isOpen()) trigger.focus();
    }
    if (before !== after || spanishPlacement || epoch) void refresh();
  });
  choice.addEventListener('change', () => {
    if (!snapshot?.available || Number(choice.value) !== snapshot.choice) return;
    saveEpoch = snapshot.epoch;
    if (notice === 'draft') announce('');
  });
  retry.addEventListener('click', () => { void refresh(); });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!isOpen() || fieldset.disabled || !snapshot?.available) return;
    const selected = Number(choice.value);
    if (choice.selectedOptions[0]?.disabled) return;
    const view = opening;
    const isSameOpening = () => isOpen() && view === opening;
    const focused = document.activeElement;
    saveFocus = fieldset.contains(focused) ? focused : undefined;
    saving = true;
    readGeneration++;
    fieldset.disabled = true;
    announce('');
    try {
      const result = await chrome.runtime.sendMessage({ type: 'placement', choice: selected, epoch: saveEpoch });
      if (!isSameOpening()) return;
      if (result?.ok) {
        // This draft was saved. A fresh read decides whether it is still current.
        snapshot = { ...result, choice: selected, available: snapshot.available };
        if (snapshot.available) pendingSave = 'saved';
      } else if (snapshot.available) {
        pendingSave = result?.ok === false ? 'conflict' : 'error';
      }
    } catch {
      if (isSameOpening() && snapshot.available) pendingSave = 'error';
    }
    finally {
      saving = false;
      // Wait to present the result until writes and reopenings during the save are reflected.
      void refresh();
    }
  });
}

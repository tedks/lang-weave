import { test, expect } from 'bun:test';
import { Window } from 'happy-dom';

test('an open review tab discards a revealed answer after language changes while refreshing', async () => {
  const previous = { document: globalThis.document, chrome: globalThis.chrome };
  const window = new Window();
  window.document.body.innerHTML = `
    <p id="language"></p><p id="counts"></p><p id="empty"></p><p id="notice"></p>
    <div id="question" hidden><p id="prompt"></p><button id="reveal"></button>
      <div id="solution" hidden><p id="answer"></p><p id="hint"></p>
        <button data-rating="hard"></button><button id="known"></button></div></div>
    <button id="introduce"></button><button id="refresh"></button>`;
  globalThis.document = window.document;
  let changed;
  let releaseFrenchAnswer;
  let releaseSpanishQueue;
  let answerRequested;
  let queueRequested;
  const answerStarted = new Promise((resolve) => { answerRequested = resolve; });
  const queueStarted = new Promise((resolve) => { queueRequested = resolve; });
  let queues = 0;
  globalThis.chrome = {
    runtime: { sendMessage: ({ type }) => {
      if (type === 'reviewNext' && ++queues === 1) return Promise.resolve({
        language: 'French', due: 1, new: 0,
        card: { ticket: 'old', en: 'and', revealed: true },
      });
      if (type === 'reviewNext') {
        queueRequested();
        return new Promise((resolve) => { releaseSpanishQueue = resolve; });
      }
      if (type === 'reviewReveal') {
        answerRequested();
        return new Promise((resolve) => { releaseFrenchAnswer = resolve; });
      }
      throw new Error(`Unexpected review request: ${type}`);
    } },
    storage: { onChanged: { addListener: (fn) => { changed = fn; } } },
  };
  try {
    await import('../src/review-page.js?language-refresh');
    await answerStarted;
    expect(window.document.getElementById('language').textContent).toBe('Reviewing French');
    changed({ settings: {} }, 'local');
    releaseFrenchAnswer({ answer: { fr: 'et', hint: 'eh' } });
    await queueStarted;
    expect(window.document.getElementById('solution').hidden).toBe(true);
    releaseSpanishQueue({ language: 'Spanish', due: 1, new: 0,
      card: { ticket: 'new', en: 'but', revealed: false } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.document.getElementById('language').textContent).toBe('Reviewing Spanish');
    expect(window.document.getElementById('prompt').textContent).toBe('but');

    // The same guard applies when a user clicks Reveal during a switch.
    const clickStarted = new Promise((resolve) => { answerRequested = resolve; });
    const nextQueueStarted = new Promise((resolve) => { queueRequested = resolve; });
    window.document.getElementById('reveal').click();
    await clickStarted;
    changed({ languagePacks: {} }, 'local');
    releaseFrenchAnswer({ answer: { fr: 'pero', hint: 'peh-roh' } });
    await nextQueueStarted;
    expect(window.document.getElementById('solution').hidden).toBe(true);
    releaseSpanishQueue({ language: 'Spanish', due: 0, new: 0, card: null });
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    Object.assign(globalThis, previous);
    await window.happyDOM.abort();
  }
});

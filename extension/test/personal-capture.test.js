import { test, expect } from 'bun:test';
import { Window } from 'happy-dom';
import { verifyCaptureSelection, capturePageAllowed } from '../src/personal-capture.js';

const options = { url: 'https://example.com/story', title: 'A story', settings: { enabled: true, newSitesEnabled: true, siteOverrides: {} }, origins: ['https://example.com/*'] };
function selection(html, text) {
  const win = new Window({ url: options.url });
  globalThis.window = win;
  win.document.body.innerHTML = html;
  const walker = win.document.createTreeWalker(win.document.body, win.NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const start = node.data.indexOf(text);
    if (start >= 0) {
      const range = win.document.createRange(); range.setStart(node, start); range.setEnd(node, start + text.length);
      const result = win.getSelection(); result.addRange(range);
      return { win, result };
    }
  }
  throw new Error('test selection not found');
}

test('capture requires enabled granted safe HTTP prose and an exact bounded live selection', () => {
  const { win, result } = selection('<p>We can capture this useful phrase.</p>', 'useful phrase');
  expect(capturePageAllowed(options)).toBe(true);
  expect(verifyCaptureSelection(result, 'useful phrase', options)).toEqual({ ok: true, text: 'useful phrase' });
  expect(verifyCaptureSelection(result, 'different phrase', options).ok).toBe(false);
  expect(verifyCaptureSelection(result, 'useful phrase', { ...options, title: 'Patient diagnosis' }).ok).toBe(false);
  expect(verifyCaptureSelection(result, 'useful phrase', { ...options, url: 'https://example.com/account' }).ok).toBe(false);
  expect(verifyCaptureSelection(result, 'useful phrase', { ...options, origins: [] }).ok).toBe(false);
  win.happyDOM.abort();
});

test('selection is rejected if it touches a link, editable control, code, or hidden content', () => {
  for (const wrapper of ['<a href="#">', '<span contenteditable="true">', '<code>', '<span hidden>', '<span aria-hidden="true">']) {
    const { win, result } = selection(`<p>${wrapper}selected word</${wrapper.match(/^<([\w]+)/)[1]}></p>`, 'selected word');
    expect(verifyCaptureSelection(result, 'selected word', options).ok).toBe(false);
    win.happyDOM.abort();
  }
});

test('selection rejects oversized, control, URL-like, and high-stakes text', () => {
  for (const text of ['one two three four five six']) {
    const { win, result } = selection(`<p>${text}</p>`, text);
    expect(verifyCaptureSelection(result, text, options).ok).toBe(false);
    win.happyDOM.abort();
  }
  for (const text of ['https://example.com', 'prescription dosage']) {
    const { win, result } = selection(`<p>${text}</p>`, text);
    expect(verifyCaptureSelection(result, text, options).ok).toBe(false);
    win.happyDOM.abort();
  }
});

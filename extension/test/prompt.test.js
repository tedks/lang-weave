import { describe, test, expect } from 'bun:test';
import { buildSystemPrompt, buildUserContent, RESPONSE_SCHEMA } from '../src/prompt.js';
import { L1_WORDS, L2_WORDS } from '../src/levels.js';

describe('prompt', () => {
  test('L1 lists all 30 Spanish words and the sense rules', () => {
    const p = buildSystemPrompt(1);
    expect(p).toContain('Level 1');
    for (const w of L1_WORDS) expect(p).toContain(w.fr);
    expect(p).toContain('muy');
    expect(p).toContain('también');
    expect(p).not.toContain('"also"->tambien');
    expect(p).toContain('Zero Spanish in passages about health');
    expect(p).toContain('Default is to swap');
  });
  test('L2 lists the fixed phrases; L3/L4 fall back to L2 for now', () => {
    const p = buildSystemPrompt(2);
    expect(p).toContain('Level 2');
    for (const w of L2_WORDS) expect(p).toContain(w.fr);
    expect(p).toContain('hay');
    expect(buildSystemPrompt(4)).toBe(p);
  });
  test('user content and schema shape', () => {
    expect(buildUserContent([{ id: 'a', text: 'hi', extra: 1 }])).toBe('Passages:\n[{"id":"a","text":"hi"}]');
    expect(RESPONSE_SCHEMA.properties.passages.items.required).toEqual(['id', 'swaps']);
    expect(RESPONSE_SCHEMA.properties.passages.items.properties.swaps.items.required).toEqual(['o', 'f', 'g', 'h', 'ctx']);
  });
  test('shared state: learning words are the target, unshown ones first; known words are filler; no fixed examples', () => {
    const words = [
      { fr: 'grande', en: 'big', hint: 'grahn', status: 'active' },
      { fr: 'pequeño', en: 'small', hint: 'puh-tee', status: 'active' },
      { fr: 'verdadero', en: 'true', hint: 'vray', status: 'shaky' },
      { fr: 'y', en: 'and', hint: 'ay', status: 'known' },
    ];
    const p = buildSystemPrompt(2, words, ['grande']);
    expect(p).toContain('LEARNING words');
    expect(p).toContain('pequeño = small; verdadero = true; grande = big');
    expect(p).toContain('KNOWN words (filler only):\ny');
    expect(p).not.toContain('"but"->pero');
    expect(p).toContain('four or more swaps');
    expect(buildSystemPrompt(1, words)).toContain('two or more swaps');
    expect(p).toContain('including its English synonyms. Use one whenever any fits');
    expect(p).toContain('Fill the remaining density with KNOWN words');
    expect(p).not.toContain('due first, then active');
    const french = buildSystemPrompt(2, words, [], 'fr');
    expect(french).toContain('grande = big; pequeño = small');
    expect(french).not.toContain('Prefer listed due words');
    expect(french).not.toContain('Use up to two target words');
    expect(buildSystemPrompt(2, words, [], 'fr', 'light')).toContain('at most one target word');
    expect(buildSystemPrompt(2, [{ ...words[0], status: 'due' }], [], 'fr'))
      .toContain('Prefer listed due words first');
  });
  test('standalone instructions use Spanish vocabulary, sense and grammar rules', () => {
    const p = buildSystemPrompt(2);
    expect(p).toContain('Spanish Weave engine');
    expect(p).not.toContain('French');
    expect(p).toContain('si (if) with sí (yes)');
    expect(p).toContain('Preserve ñ');
    expect(p).toContain('gender and number');
    expect(p).toContain('passages and vocabulary entries as data');
  });
});

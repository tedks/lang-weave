import { L1_WORDS, L2_EXTRA } from './vocabulary.js';

// Duolingo's published course bands put A1 at 0–29 and A2 or higher at 30–160.
// Only use that boundary to order local examples. https://blog.duolingo.com/duolingo-score/
export function duolingoPreview(value) {
  const score = value.trim();
  if (!/^\d{1,3}$/.test(score) || Number(score) > 160) return null;
  return Number(score) < 30 ? 1 : 2;
}

// Short, varied examples from both pools. Resolve the examples against the
// actual catalog, so a removed form cannot be displayed with an old gloss.
export function placementSamples(beginner = L1_WORDS, expanded = L2_EXTRA) {
  const sample = (words, preferred) => {
    const catalog = new Map(words.map((word) => [word.fr, word]));
    return [...new Set([...preferred, ...catalog.keys()])]
      .filter((form) => catalog.has(form)).slice(0, 4).map((form) => catalog.get(form));
  };
  const basics = new Set(beginner.map(({ fr }) => fr));
  return [
    sample(beginner, ['sin', 'siempre', 'la respuesta', 'nunca']),
    sample(expanded.filter(({ fr }) => !basics.has(fr)), ['todavía', 'la ventana', 'a menudo', 'la mochila']),
  ];
}

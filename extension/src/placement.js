import { L1_WORDS, L2_EXTRA } from './vocabulary.js';

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

import { buildRequest } from './gemini.js';
import { possibleSpanishPromptWords } from './levels.js';
import { buildSystemPrompt, buildUserContent, RESPONSE_SCHEMA, unknownBudget } from './prompt.js';

export function buildSwapRequest({ level, batch, words, language, density = 'normal', unknownLimit = false, shownToday }) {
  // The worker supplies unknownLimit for every gradual request and all-active rows for ordinary reading.
  const ordinarySpanish = !unknownLimit && (language === undefined || language === 'es') &&
    words?.every((word) => word.status === 'active');
  const promptWords = ordinarySpanish ? possibleSpanishPromptWords(level, words, batch) : words;
  return buildRequest({ system: buildSystemPrompt(level, promptWords, shownToday, language, density,
    unknownLimit ? unknownBudget(batch) : null), user: buildUserContent(batch), schema: RESPONSE_SCHEMA });
}

// Both sides hash the same JSON data. Array order is part of the prompt.
export function canonicalSwapBody(value) {
  if (Array.isArray(value)) return `[${Array.from(value, canonicalSwapBody).join(',')}]`;
  if (value === null || typeof value !== 'object') {
    const json = JSON.stringify(value);
    if (json === undefined) throw new TypeError('Swap request requires JSON values');
    return json;
  }
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalSwapBody(value[key])}`).join(',')}}`;
}

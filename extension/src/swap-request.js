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

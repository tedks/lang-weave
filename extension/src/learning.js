// Browser-local gradual policy. Callers serialize mutations and persist before returning results.
import { localDay } from './events.js';

export const DENSITIES = ['light', 'normal', 'heavy'];
const BASIC = new Set(['and', 'or', 'but', 'no', 'yes', 'with', 'for (purpose)', 'in', 'the', 'a']);

export function cleanLearning(raw) {
  const day = typeof raw?.day === 'string' && /^\d{4}-\d\d-\d\d$/.test(raw.day) ? raw.day : '';
  const count = Number.isSafeInteger(raw?.count) && raw.count >= 0 && raw.count <= 20 ? raw.count : 0;
  return { day, count };
}

export function remaining(learning, day, budget) {
  // A clock rollback cannot mint a second allowance for an earlier local date.
  if (learning.day > day) return 0;
  return Math.max(0, budget - (learning.day === day ? learning.count : 0));
}

export function policyWords(words, state, settings, now = Date.now(), day = localDay(new Date(now))) {
  if (!settings.gradual) return words.map((w) => ({ ...w, status: 'active' }));
  const left = remaining(state.learning, day, settings.newWordsPerDay);
  const due = [], learning = [], fresh = [], known = [];
  for (const w of words) {
    const card = state.cards[w.fr];
    if (card?.familiar) known.push({ ...w, status: 'known' });
    else if (card?.due <= now) due.push({ ...w, status: 'due' });
    else if (card) learning.push({ ...w, status: 'active' });
    else if (left) fresh.push({ ...w, status: 'new' });
  }
  due.sort((a, b) => state.cards[a.fr].due - state.cards[b.fr].due);
  fresh.sort((a, b) => Number(BASIC.has(a.en)) - Number(BASIC.has(b.en)));
  // Familiar words are occasionally useful for readable density, but should never dominate.
  return [...due, ...learning, ...fresh, ...known.slice(0, 2)];
}

export function commitLearning(state, results, settings, now = Date.now(), day = localDay(new Date(now))) {
  if (!settings.gradual) return results;
  const left = remaining(state.learning, day, settings.newWordsPerDay);
  let added = 0;
  const output = {};
  for (const [key, swaps] of Object.entries(results)) {
    output[key] = [];
    for (const swap of swaps) {
      const card = state.cards[swap.word];
      if (card?.familiar) {
        // Familiar filler is bounded per passage independently of model generosity.
        if (output[key].filter((s) => s.status === 'known').length >= 1) continue;
        output[key].push({ ...swap, status: 'known' });
      } else if (card) {
        output[key].push({ ...swap, status: card.due <= now ? 'due' : 'active',
          ...(card.due <= now && settings.inlineRecall ? { practice: true } : {}) });
      } else if (added < left && typeof swap.word === 'string') {
        state.cards[swap.word] = { due: now, interval: 0, reviews: 0, introducedDay: day };
        output[key].push({ ...swap, status: 'new' });
        added++;
      }
    }
  }
  if (added) state.learning = { day, count: (state.learning.day === day ? state.learning.count : 0) + added };
  return output;
}

// Admission-time English surface rules. They are intentionally narrower than a dictionary.
import { readFileSync } from 'node:fs';

const irregular = JSON.parse(readFileSync(new URL('./english-irregulars.json', import.meta.url), 'utf8'));
const cvc = (base) => /^[a-z]*[aeiou][^aeiouwxy]$/.test(base) && !/[aeiou].*[aeiou]/.test(base);
const consonantY = (base) => /[^aeiou]y$/.test(base);
const sibilant = (base) => /(?:s|x|z|ch|sh)$/.test(base);

export function englishInflections(base, row) {
  if (!/^[a-z]+$/.test(base)) return [];
  if (row.pos === 'noun' && row.number === 'plural') {
    if (irregular.noun[base]) return irregular.noun[base];
    return [consonantY(base) ? `${base.slice(0, -1)}ies` :
      sibilant(base) ? `${base}es` : `${base}s`];
  }
  if (row.pos !== 'verb') return [];
  if (irregular.verb[base]) return irregular.verb[base];
  const third = consonantY(base) ? `${base.slice(0, -1)}ies` :
    sibilant(base) || /[^aeiou]o$/.test(base) ? `${base}es` : `${base}s`;
  const ing = base.endsWith('e') && !base.endsWith('ee') ? `${base.slice(0, -1)}ing` :
    cvc(base) ? `${base}${base.at(-1)}ing` : `${base}ing`;
  const ed = consonantY(base) ? `${base.slice(0, -1)}ied` : base.endsWith('e') ? `${base}d` :
    cvc(base) ? `${base}${base.at(-1)}ed` : `${base}ed`;
  return [third, ing, ed];
}

export function supportsAnchor(base, anchor, row) {
  if (base === anchor) return true;
  if (row.pos === 'noun' && anchor.startsWith('the ')) return supportsAnchor(base, anchor.slice(4), row);
  return englishInflections(base, row).includes(anchor);
}

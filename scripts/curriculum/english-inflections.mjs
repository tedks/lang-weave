// Admission-time English surface rules. They are intentionally narrower than a dictionary.
import { readFileSync } from 'node:fs';

const irregular = JSON.parse(readFileSync(new URL('./english-irregulars.json', import.meta.url), 'utf8'));
const regular = JSON.parse(readFileSync(new URL('./english-regulars.json', import.meta.url), 'utf8'));
const regularNouns = new Set(regular.noun);
const regularVerbs = new Set(regular.verb);
const irregularPluralSurfaces = new Set(Object.values(irregular.noun).flat());
const cvc = (base) => /^[a-z]*[aeiou][^aeiouwxy]$/.test(base) && !/[aeiou].*[aeiou]/.test(base);
const consonantY = (base) => /[^aeiou]y$/.test(base);
const sibilant = (base) => /(?:s|x|z|ch|sh)$/.test(base);

export function englishInflections(base, row) {
  if (!/^[a-z]+$/.test(base)) return [];
  if (row.pos === 'noun' && row.number === 'plural') {
    if (Object.hasOwn(irregular.noun, base)) return irregular.noun[base];
    if (!regularNouns.has(base)) return [];
    // These endings have mixed regular and irregular plurals. An unlisted base waits for a source decision.
    if (/(?:[^aeiou]o|f|fe)$/.test(base)) return [];
    return [consonantY(base) ? `${base.slice(0, -1)}ies` :
      sibilant(base) ? `${base}es` : `${base}s`];
  }
  if (row.pos !== 'verb') return [];
  if (Object.hasOwn(irregular.verb, base)) return irregular.verb[base];
  if (!regularVerbs.has(base)) return [];
  const singleZ = /[aeiou]z$/.test(base);
  const third = consonantY(base) ? `${base.slice(0, -1)}ies` :
    singleZ ? `${base}zes` :
    sibilant(base) || /[^aeiou]o$/.test(base) ? `${base}es` : `${base}s`;
  const ing = base.endsWith('ie') ? `${base.slice(0, -2)}ying` :
    /(?:oe|ye)$/.test(base) ? `${base}ing` :
    base.endsWith('ic') ? `${base}king` : singleZ ? `${base}zing` :
    base.endsWith('e') && !base.endsWith('ee') ? `${base.slice(0, -1)}ing` :
    cvc(base) ? `${base}${base.at(-1)}ing` : `${base}ing`;
  const ed = consonantY(base) ? `${base.slice(0, -1)}ied` : base.endsWith('e') ? `${base}d` :
    base.endsWith('ic') ? `${base}ked` : singleZ ? `${base}zed` :
    cvc(base) ? `${base}${base.at(-1)}ed` : `${base}ed`;
  return [third, ing, ed];
}

const regularPluralSurfaces = new Set([...regularNouns].flatMap((base) =>
  englishInflections(base, { pos: 'noun', number: 'plural' })));

export function isPluralSurface(anchor) {
  const bare = anchor.replace(/^the /, '');
  return irregularPluralSurfaces.has(bare) || regularPluralSurfaces.has(bare);
}

export function supportsAnchor(base, anchor, row) {
  if (base === anchor) return true;
  if (row.pos === 'noun' && anchor.startsWith('the ')) return supportsAnchor(base, anchor.slice(4), row);
  return englishInflections(base, row).includes(anchor);
}

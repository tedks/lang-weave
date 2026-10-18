const CODE = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2})?$/;

export function languageCode(input) {
  if (typeof input !== 'string' || input.length > 20) return null;
  try {
    const code = Intl.getCanonicalLocales(input.trim())[0];
    return code && CODE.test(code) && !['en', 'es'].includes(code.split('-')[0]) ? code : null;
  } catch { return null; }
}

export function languageName(code) {
  if (code === 'es') return 'Spanish';
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code; }
  catch { return code; }
}

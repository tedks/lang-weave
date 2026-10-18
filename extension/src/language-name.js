export function languageName(code) {
  if (code === 'es') return 'Spanish';
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code; }
  catch { return code; }
}

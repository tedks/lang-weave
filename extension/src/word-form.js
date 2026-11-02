// One shape rule for a generated pack's target form and a catalog-backed log ID.
// Catalog membership, checked by the log writer, is the privacy boundary.
const FIELD = /^[^\p{Cc}<>\[\]{}\r\n]{1,80}$/u;

export function validPackForm(form) {
  return typeof form === 'string' && form.length <= 50 && FIELD.test(form) &&
    form.trim() === form && /\p{L}/u.test(form) &&
    !/\p{Cf}/u.test(form.replace(/[\u200c\u200d]/g, ''));
}

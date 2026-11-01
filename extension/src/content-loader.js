// Content scripts cannot be ES modules, so this classic script pulls the module in.
(async () => {
  // A startup recovery and the registered script can race while content.js is importing.
  // This isolated-world marker makes both paths share one module entry.
  const marker = Symbol.for('lang-weave.content-loader');
  if (globalThis[marker]) return;
  globalThis[marker] = true;
  try {
    await import(chrome.runtime.getURL('src/content.js'));
  } catch (e) {
    delete globalThis[marker]; // a later explicit injection may retry a failed import
    console.error('[lang-weave] failed to load', e);
  }
})();

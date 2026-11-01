// Content scripts cannot be ES modules, so this classic script pulls the module in.
(async () => {
  // A startup recovery and the registered script can race while content.js is importing.
  // This isolated-world marker lets the startup probe see an import in flight
  // and prevents a second loader call in the same document.
  const marker = Symbol.for('lang-weave.content-loader');
  if (globalThis[marker]) return;
  globalThis[marker] = true;
  try {
    await import(chrome.runtime.getURL('src/content.js'));
  } catch (e) {
    console.error('[lang-weave] failed to load', e);
  }
})();

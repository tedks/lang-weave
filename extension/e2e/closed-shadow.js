// CDP-only access to a closed panel root in Chromium gates. Every operation starts
// from a fresh DOM snapshot; CDP node IDs from an older snapshot are not reusable.
export async function closedShadow(page, hostClass) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');

  const root = async () => {
    const { root: document } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const walk = (node) => [node, ...(node.children || []).flatMap(walk), ...(node.shadowRoots || []).flatMap(walk)];
    const host = walk(document).find((node) => {
      const at = node.attributes || [];
      return at.some((value, i) => i % 2 === 0 && value === 'class' &&
        at[i + 1].split(' ').includes(hostClass));
    });
    return host?.shadowRoots?.[0]?.nodeId || null;
  };
  const nodes = async (selector) => {
    const nodeId = await root();
    if (!nodeId) return [];
    return (await cdp.send('DOM.querySelectorAll', { nodeId, selector })).nodeIds;
  };
  const call = async (nodeId, fn) => {
    const { object } = await cdp.send('DOM.resolveNode', { nodeId });
    const { result, exceptionDetails } = await cdp.send('Runtime.callFunctionOn', {
      objectId: object.objectId, functionDeclaration: `function() { return (${fn.toString()}).call(this, this); }`,
      returnByValue: true });
    if (exceptionDetails) throw new Error(`${exceptionDetails.text}: ${exceptionDetails.exception?.description || ''}`);
    return result.value;
  };
  const selected = async (selector, hasText) => {
    const ids = await nodes(selector);
    if (!hasText) return ids;
    const texts = await Promise.all(ids.map((id) => call(id, function () { return this.textContent; })));
    return ids.filter((_, i) => hasText instanceof RegExp ? hasText.test(texts[i]) : texts[i].includes(hasText));
  };
  const locator = (selector, { hasText } = {}) => ({
    async count() { return (await selected(selector, hasText)).length; },
    async waitFor({ state = 'visible', timeout = 30000 } = {}) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const present = (await selected(selector, hasText)).length > 0;
        if (present === (state !== 'detached')) return;
        await page.waitForTimeout(30);
      }
      throw new Error(`closed shadow ${selector}: waitFor ${state} timed out`);
    },
    async waitForText(pattern, timeout = 30000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (pattern.test((await this.textContent()) || '')) return;
        await page.waitForTimeout(30);
      }
      throw new Error(`closed shadow ${selector}: waitForText timed out`);
    },
    async textContent() {
      const id = (await selected(selector, hasText))[0];
      return id ? call(id, function () { return this.textContent; }) : null;
    },
    async allTextContents() {
      const ids = await selected(selector, hasText);
      return Promise.all(ids.map((id) => call(id, function () { return this.textContent; })));
    },
    async evaluate(fn) {
      const id = (await selected(selector, hasText))[0];
      if (!id) throw new Error(`closed shadow ${selector}: no node`);
      return call(id, fn);
    },
    async click() {
      await this.waitFor();
      const id = (await selected(selector, hasText))[0];
      if (!id) throw new Error(`closed shadow ${selector}: no node`);
      const { model } = await cdp.send('DOM.getBoxModel', { nodeId: id });
      const q = model.content;
      await page.mouse.click((q[0] + q[2] + q[4] + q[6]) / 4,
        (q[1] + q[3] + q[5] + q[7]) / 4);
    },
    async clickUntrusted() {
      await this.waitFor();
      const id = (await selected(selector, hasText))[0];
      if (!id) throw new Error(`closed shadow ${selector}: no node`);
      await call(id, function () { this.click(); return true; });
    },
  });
  return { locator, host: page.locator(`.${hostClass}`) };
}

// Keep legacy Spanish keys at their original names; other packs have separate local histories.
export function scopedStorage(storage, scope) {
  if (scope === 'es') return storage;
  const key = (k) => `lang:${scope}:${k}`;
  return {
    async get(keys) {
      const data = await storage.get(keys.map(key));
      return Object.fromEntries(keys.map((k) => [k, data[key(k)]]));
    },
    async set(entries) {
      await storage.set(Object.fromEntries(Object.entries(entries).map(([k, v]) => [key(k), v])));
    },
    async remove(keys) { await storage.remove(keys.map(key)); },
  };
}

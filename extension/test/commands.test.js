import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createCommands } from '../src/commands.js';
import { COMMANDS, SURFACES } from '../src/router.js';

test('manifest shortcuts are exact worker commands, without new permissions or message routes', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  expect(Object.keys(manifest.commands).sort()).toEqual(Object.values(COMMANDS).sort());
  expect(manifest.commands[COMMANDS.pauseSite].suggested_key.default).toBe('Alt+Shift+W');
  expect(manifest.commands[COMMANDS.openReview].suggested_key.default).toBe('Alt+Shift+R');
  expect(SURFACES.flatMap(({ messages }) => messages)).not.toContain(COMMANDS.pauseSite);
  expect(SURFACES.flatMap(({ messages }) => messages)).not.toContain(COMMANDS.openReview);
  expect(manifest.permissions).not.toContain('tabs');
});

test('pause command saves a site override and broadcasts through save; review opens the exact page', async () => {
  let tab = { id: 7, active: true, url: 'https://reading.example/article' };
  const saved = [];
  const opened = [];
  let origins = ['https://reading.example/*'];
  const settings = { enabled: true, newSitesEnabled: true, siteOverrides: {} };
  const commands = createCommands({
    tabs: { query: async () => [tab], get: async () => tab,
      create: async (request) => { opened.push(request); return { id: 8 }; } },
    runtime: { getURL: (path) => `chrome-extension://test/${path}` },
    context: async () => ({ settings, origins }),
    save: async (msg) => { saved.push(msg); settings.siteOverrides[msg.siteOverride.host] = msg.siteOverride.enabled; },
  });
  await commands.handle(COMMANDS.pauseSite, tab);
  expect(saved).toEqual([{ siteOverride: { host: 'reading.example', enabled: false } }]);
  await commands.handle(COMMANDS.pauseSite, tab);
  expect(saved[1]).toEqual({ siteOverride: { host: 'reading.example', enabled: true } });
  await Promise.all([commands.handle(COMMANDS.pauseSite), commands.handle(COMMANDS.pauseSite)]);
  expect(saved.slice(2, 4)).toEqual([
    { siteOverride: { host: 'reading.example', enabled: false } },
    { siteOverride: { host: 'reading.example', enabled: true } },
  ]); // rapid commands serialize their read and save
  await commands.handle(COMMANDS.openReview, tab);
  expect(opened).toEqual([{ url: 'chrome-extension://test/src/review.html' }]);
  await commands.handle('unknown-command', tab);
  expect(saved).toHaveLength(4);
  expect(opened).toHaveLength(1);

  tab = { id: 7, active: true, url: 'https://different.example/article' };
  await commands.handle(COMMANDS.pauseSite, { id: 7, active: true, url: 'https://reading.example/article' });
  expect(saved).toHaveLength(4); // navigation after the command cannot toggle the former host
  tab = { id: 7, active: true, url: 'https://reading.example/article' };
  settings.newSitesEnabled = false;
  delete settings.siteOverrides['reading.example'];
  await commands.handle(COMMANDS.pauseSite, tab);
  expect(saved).toHaveLength(4); // the shortcut does not turn on an ask-first site
  settings.siteOverrides['reading.example'] = false;
  await commands.handle(COMMANDS.pauseSite, tab);
  expect(saved[4]).toEqual({ siteOverride: { host: 'reading.example', enabled: true } });
  origins = ['<all_urls>'];
  tab = { id: 7, active: true, url: 'https://READING.example./article' };
  await commands.handle(COMMANDS.pauseSite, tab);
  expect(saved[5]).toEqual({ siteOverride: { host: 'reading.example', enabled: false } });
});

test('pause command refuses ungranted, inactive, hidden-URL, and global-off tabs', async () => {
  const settings = { enabled: true, newSitesEnabled: true, siteOverrides: {} };
  let origins = [];
  let tab = { id: 7, active: true, url: 'https://reading.example/article' };
  const saved = [];
  const commands = createCommands({ tabs: { query: async () => [tab], get: async () => tab },
    runtime: { getURL: (path) => path }, context: async () => ({ settings, origins }),
    save: async (msg) => saved.push(msg) });
  await commands.handle(COMMANDS.pauseSite, tab);
  origins = ['https://reading.example/*'];
  tab.active = false;
  await commands.handle(COMMANDS.pauseSite, tab);
  tab.active = true;
  settings.enabled = false;
  await commands.handle(COMMANDS.pauseSite, tab);
  settings.enabled = true;
  tab.url = undefined;
  await commands.handle(COMMANDS.pauseSite, tab);
  expect(saved).toHaveLength(0);
});

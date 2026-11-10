'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const path = require('node:path');

function fixture() {
  const calls = [];
  const events = new EventEmitter();
  const realFiles = new WeakMap();
  let api;
  const electron = {
    contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } },
    ipcRenderer: Object.assign(events, { invoke: async (channel, ...args) => { calls.push({ channel, args }); return []; }, send: (channel, ...args) => { calls.push({ channel, args }); } }),
    webUtils: { getPathForFile: (file) => realFiles.get(file) ?? '' },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8'), { require: (name) => { if (name !== 'electron') throw new Error('Unexpected require'); return electron; } });
  return { api, calls, events, realFiles };
}

test('renderer cannot read arbitrary disk paths through the drag/drop API', async () => {
  const { api, calls } = fixture();
  await assert.rejects(api.openPaths(['/private/secret.ini']), /Arraste arquivos/);
  await assert.rejects(api.openPaths('not an array'), /Arraste arquivos/);
  assert.equal(calls.length, 0);
  assert.equal(api.getPathForFile({ name: 'made-up.ini', path: '/private/secret.ini' }), '');
  await assert.rejects(api.openPaths(['/private/secret.ini']), /Arraste arquivos/);
});

test('a real dropped File grants only its exact path, once', async () => {
  const { api, calls, realFiles } = fixture();
  const nativeFile = {};
  realFiles.set(nativeFile, '/home/user/GameData.ini');
  const permittedPath = api.getPathForFile(nativeFile);
  await assert.rejects(api.openPaths([permittedPath, '/private/secret.ini']), /Arraste arquivos/);
  await api.openPaths([permittedPath]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].channel, 'configura:open-paths');
  assert.equal(calls[0].args[0][0], permittedPath);
  await assert.rejects(api.openPaths([permittedPath]), /Arraste arquivos/);
});

test('callbacks receive payloads only, and listeners can be removed', () => {
  const { api, events } = fixture();
  let received;
  const unsubscribe = api.onOpenFiles((...args) => { received = args; });
  events.emit('configura:open-files', { sender: { secret: true } }, [{ id: 'file-1' }]);
  assert.deepEqual(received, [[{ id: 'file-1' }]]);
  unsubscribe();
  received = undefined;
  events.emit('configura:open-files', {}, [{ id: 'file-2' }]);
  assert.equal(received, undefined);
});

test('bridge exposes no generic channel or raw Electron access', () => {
  const { api } = fixture();
  assert.equal(Object.isFrozen(api), true);
  for (const name of ['invoke', 'send', 'ipcRenderer', 'require', 'exec', 'shell']) assert.equal(api[name], undefined);
});

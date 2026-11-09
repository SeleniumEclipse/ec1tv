"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { NAMES, bootstrap, bundle, bootstrapSource } = require("./runtime-install.cjs");
const fingerprint = "SHA256:" + "A".repeat(43);
const clone = value => JSON.parse(JSON.stringify(value));

test("runtime bundle contains only fixed setup files with matching hashes", () => {
  const value = bundle(fingerprint);
  assert.equal(bootstrap(value, { validateOnly: true }).files, NAMES.length);
  assert.ok(value.files.every(entry => !/test|node_modules|connection.json|private-key/.test(entry.name)));
  assert.ok(value.files.some(entry => entry.name === "LICENSE"));
});

test("tampered duplicate oversized and unexpected runtime files are rejected", () => {
  const original = bundle(fingerprint);
  for (const change of [
    value => { value.files[0].data = Buffer.from("tampered").toString("base64"); },
    value => { value.files[0].name = "../outside.cjs"; },
    value => { value.files[0].name = value.files[1].name; },
    value => { value.files[0].data = "A".repeat(350001); },
    value => { value.hostFingerprint = "unverified"; }
  ]) { const value = clone(original); change(value); assert.throws(() => bootstrap(value, { validateOnly: true })); }
});

test("runtime preflight is read-only when no setup is installed", () => {
  let writes = 0;
  const fileSystem = {
    lstatSync: () => ({ isDirectory: () => true, isSymbolicLink: () => false, uid: 0, mode: 0o755 }),
    realpathSync: value => value, existsSync: () => false,
    mkdirSync: () => { writes++; }, writeFileSync: () => { writes++; }
  };
  assert.deepEqual(bootstrap(bundle(fingerprint), { fs: fileSystem, getuid: () => 0, nodeVersion: "20.0.0" }), { installed: false, compatible: true, files: 0 });
  assert.equal(writes, 0);
  assert.throws(() => bootstrap(bundle(fingerprint), { fs: fileSystem, getuid: () => 1000 }), /Administrator/);
});

test("serialized bootstrap source parses without interpolation damage", () => {
  assert.doesNotThrow(() => new vm.Script(bootstrapSource()));
  assert.ok(!bootstrapSource().includes("eval("));
});

test("an interrupted owned runtime is reported as resumable without writes", () => {
  const value = bundle(fingerprint);
  const checked = bootstrap(value, { validateOnly: true });
  const marker = Buffer.from(JSON.stringify({ kind: "ec1tv-runtime", version: 1, phase: "installing", hostFingerprint: fingerprint, hashes: checked.hashes }));
  let writes = 0;
  const fileSystem = {
    constants: { O_RDONLY: 0, O_NOFOLLOW: 1 },
    existsSync: filename => !filename.endsWith("/runtime"),
    lstatSync: filename => filename.endsWith("install.json") ? { isFile: () => true, isSymbolicLink: () => false, uid: 0, nlink: 1, size: marker.length, mode: 0o600, ino: 1, dev: 1 } : { isDirectory: () => true, isSymbolicLink: () => false, uid: 0, mode: filename.endsWith("ec1tv-setup") ? 0o700 : 0o755 },
    realpathSync: filename => filename, openSync: () => 1, fstatSync: () => ({ ino: 1, dev: 1 }), readFileSync: () => marker, closeSync() {},
    mkdirSync: () => { writes++; }, writeFileSync: () => { writes++; }
  };
  assert.equal(bootstrap(value, { fs: fileSystem, getuid: () => 0, nodeVersion: "20.0.0" }).incomplete, true);
  assert.equal(writes, 0);
});
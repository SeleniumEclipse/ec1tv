"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createPhotoControl, DIRECTORY, HELPER, CONNECTION } = require("./photo-control.cjs");
const { digest } = require("./protected-files.cjs");
const clone = value => JSON.parse(JSON.stringify(value));
const state = () => ({ version: 1, clientId: "11111111-2222-4333-8444-555555555555", account: "family@example.invalid", folderName: "Family Photos", folderId: "OWN_FOLDER", driveId: "OWN_DRIVE", scope: "Files.ReadWrite.AppFolder offline_access", refreshToken: "synthetic-refresh-token", accessToken: "synthetic-access-token", accessTokenExpires: Date.now() + 3600000 });

function fixture(verifyResult = { ok: true, folderVerified: true, photoCount: 2, truncated: false }) {
  const entries = new Map(); let saved = null, exists = false;
  const helperBytes = Buffer.from("synthetic helper source ".repeat(12));
  const files = {
    journal: () => ({ load: () => saved ? clone(saved) : null, save: value => { saved = clone(value); } }),
    directory() { assert.ok(exists); }, ensureDirectory() { exists = true; },
    read: filename => entries.get(filename) || null,
    write(filename, bytes, expected, mode) { assert.equal(entries.has(filename), false); entries.set(filename, { bytes: Buffer.from(bytes), sha256: digest(bytes), mode }); },
    remove(filename, expected) { assert.equal(entries.get(filename).sha256, expected); entries.delete(filename); }
  };
  const fileSystem = { existsSync: filename => filename === DIRECTORY ? exists : entries.has(filename), readdirSync: () => [...entries.keys()].map(filename => filename.slice(DIRECTORY.length + 1)) };
  const control = createPhotoControl({ files, fileSystem, helperBytes, invokeHelper: async () => { if (verifyResult instanceof Error) throw verifyResult; return verifyResult; } });
  return { control, entries, record: () => saved, foreignDirectory: () => { exists = true; } };
}

test("connection transfers only a root-private login and returns safe status", async () => {
  const context = fixture();
  const result = await context.control.connect(state());
  assert.equal(result.connected, true);
  assert.ok(context.entries.has(HELPER));
  assert.equal(context.entries.get(CONNECTION).mode, 0o600);
  assert.ok(!JSON.stringify(context.record()).includes("synthetic-refresh"));
  assert.ok(!JSON.stringify(result).includes("synthetic-access"));
  assert.equal(context.control.status().folder, "Apps/Family Photos");
});

test("an existing unowned photo setup is preserved", async () => {
  const context = fixture(); context.foreignDirectory();
  assert.equal(context.control.status().existingSetup, true);
  await assert.rejects(context.control.connect(state()), /already exists/);
  assert.equal(context.record(), null);
  assert.equal(context.entries.size, 0);
});

test("a working login is not silently replaced", async () => {
  const context = fixture(); await context.control.connect(state());
  const original = Buffer.from(context.entries.get(CONNECTION).bytes);
  await assert.rejects(context.control.connect(state()), /Disconnect/);
  assert.deepEqual(context.entries.get(CONNECTION).bytes, original);
});

test("verification failure removes only the newly saved login", async () => {
  const context = fixture({ ok: false });
  await assert.rejects(context.control.connect(state()), /login was removed/);
  assert.equal(context.entries.has(CONNECTION), false);
  assert.equal(context.entries.has(HELPER), true);
  assert.equal(context.record().phase, "disconnected");
});

test("uncertain verification keeps a recoverable record for explicit disconnect", async () => {
  const error = new Error("timeout"); error.uncertain = true;
  const context = fixture(error);
  await assert.rejects(context.control.connect(state()), /did not confirm/);
  assert.equal(context.record().phase, "needs-recovery");
  assert.equal(context.entries.has(CONNECTION), true);
  assert.equal(context.control.disconnect().tvLoginRemoved, true);
  assert.equal(context.entries.has(CONNECTION), false);
});

test("disconnect leaves photos and unrelated files alone and refuses helper drift", async () => {
  const context = fixture(); await context.control.connect(state());
  const helper = context.entries.get(HELPER); helper.sha256 = "f".repeat(64);
  assert.throws(() => context.control.disconnect(), /changed outside/);
  assert.equal(context.entries.has(CONNECTION), true);
});

test("an owned disconnected setup can connect a new own-account login", async () => {
  const context = fixture();
  await context.control.connect(state());
  context.control.disconnect();
  const status = context.control.status();
  assert.equal(status.existingSetup, false);
  assert.equal(status.connected, false);
  const another = { ...state(), account: "another@example.invalid", folderId: "NEW_FOLDER", folderName: "Another Folder" };
  assert.equal((await context.control.connect(another)).folder, "Apps/Another Folder");
});
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { SERVICES, nativeCall, createAdapter } = require("./tv-adapter.cjs");
const { validateRequest, requestBytes, dispatch } = require("./tv-worker.cjs");
const fingerprint = "SHA256:" + "A".repeat(43);

test("native calls use fixed executable and structured arguments", () => {
  let observed;
  const reply = nativeCall(SERVICES.setHome, { category: "home", appId: "io.focusstage.home" }, {}, (command, args, options) => {
    observed = { command, args, options }; return '{"returnValue":true}';
  });
  assert.equal(reply.returnValue, true);
  assert.equal(observed.command, "/usr/bin/luna-send");
  assert.deepEqual(observed.args.slice(0, 3), ["-n", "1", "-f"]);
  assert.deepEqual(JSON.parse(observed.args[4]), { category: "home", appId: "io.focusstage.home" });
  assert.equal(observed.options.timeout, 12000);
  assert.throws(() => nativeCall("luna://unapproved/service", {}, {}, () => assert.fail()));
});

test("lost or malformed mutation replies are marked uncertain", () => {
  for (const execute of [() => { throw new Error("timeout"); }, () => "not-json"]) {
    assert.throws(() => nativeCall(SERVICES.save, {}, {}, execute), error => error.uncertain === true);
  }
  assert.throws(() => nativeCall(SERVICES.save, {}, {}, () => '{"returnValue":false}'), error => error.uncertain !== true);
});

test("adapter captures only the requested settings profiles and launcher", () => {
  const calls = [];
  const adapter = createAdapter({
    identity: { hostFingerprint: fingerprint },
    files: { directory() {}, read: () => ({ sha256: "1".repeat(64) }) },
    fileSystem: { readdirSync: () => ["existing.json"] },
    call(uri, payload) {
      calls.push({ uri, payload });
      if (uri === SERVICES.settings) return { returnValue: true, settings: { defaultApps: { home: "com.webos.app.home" }, lastAppHandlerPolicy: "idleApp" } };
      if (uri === SERVICES.profiles) return { returnValue: true, profiles: { defaultApps: { support: true, categories: { home: "com.webos.app.home" } }, idleApp: { support: true, appId: "com.webos.app.home" } } };
      return { returnValue: true, appInfo: { id: "io.focusstage.home", version: "0.1.15", appCategory: ["home"], handlesRelaunch: false } };
    }
  });
  const state = adapter.snapshot();
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].payload.keys, ["defaultApps", "lastAppHandlerPolicy"]);
  assert.equal(state.identity.hostFingerprint, fingerprint);
  assert.equal(state.overrides.length, 1);
});

test("worker accepts only supported commands and verified-host-shaped requests", () => {
  assert.doesNotThrow(() => validateRequest({ version: 1, action: "home-apply", hostFingerprint: fingerprint, includeIdle: false }));
  for (const extra of [{ action: "shell" }, { command: "whoami" }, { hostFingerprint: "accept-anything" }, { includeIdle: "false" }]) {
    assert.throws(() => validateRequest({ version: 1, action: "home-status", hostFingerprint: fingerprint, ...extra }));
  }
});

test("worker input is bounded and does not execute content", async () => {
  assert.equal((await requestBytes(Readable.from([Buffer.from('{"version":1}')]))).toString(), '{"version":1}');
  await assert.rejects(requestBytes(Readable.from([Buffer.alloc(131073)])), /size limit/);
});

test("photo connection requires the compatible launcher before saving tokens", async () => {
  const connection = { version: 1, clientId: "11111111-2222-4333-8444-555555555555", account: "family@example.invalid", folderName: "Family Photos", folderId: "OWN_FOLDER", driveId: "OWN_DRIVE", scope: "Files.ReadWrite.AppFolder", refreshToken: "synthetic-refresh-token" };
  const request = { version: 1, action: "photos-connect", hostFingerprint: fingerprint, connection };
  const control = { connect: async () => ({ connected: true }) };
  assert.deepEqual(await dispatch(request, { snapshot: async () => ({ app: { version: "0.1.16" } }) }, null, control), { connected: true });
  await assert.rejects(dispatch(request, { snapshot: async () => ({ app: { version: "0.1.15" } }) }, null, control), /0.1.16/);
  assert.throws(() => validateRequest({ ...request, action: "home-status" }), /Unexpected/);
});
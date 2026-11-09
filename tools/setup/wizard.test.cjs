"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { runWizard } = require("./wizard.cjs");
const config = { host: "192.168.200.20", port: 22, username: "root", keyPath: "private-key", hostFingerprint: "SHA256:" + "A".repeat(43) };

function fixture(answers, confirmations) {
  const calls = [], messages = [], records = new Map([["connection.json", config]]);
  const context = {
    ui: { say: value => messages.push(value), ask: async () => { assert.ok(answers.length); return answers.shift(); }, confirm: async () => { assert.ok(confirmations.length); return confirmations.shift(); } },
    state: { read: name => records.get(name), save: (name, value) => records.set(name, value) },
    connect: async () => { calls.push("connect"); return { close: () => calls.push("close") }; },
    ensureRuntime: async (session, install) => { calls.push(install ? "install-runtime" : "check-runtime"); return { installed: true }; },
    operation: async (session, action, fields) => { calls.push({ action, fields }); if (action === "home-status") return { phase: "not-configured", appVersion: "0.1.16" }; if (action === "photos-status") return { connected: false, existingSetup: false }; return { phase: "applied" }; },
    signIn: async () => assert.fail("Unexpected sign-in")
  };
  return { context, calls, messages, records };
}

test("declining TV changes exits before connecting", async () => {
  const value = fixture(["2"], [false]);
  assert.deepEqual(await runWizard(value.context), { cancelled: true });
  assert.deepEqual(value.calls, []);
});

test("declining a photo renewal check exits before connecting", async () => {
  const value = fixture(["5"], [false]);
  assert.deepEqual(await runWizard(value.context), { cancelled: true });
  assert.deepEqual(value.calls, []);
});

test("Home setup requires confirmations and passes only the chosen idle setting", async () => {
  const value = fixture(["2"], [true, false, true]);
  await runWizard(value.context);
  assert.deepEqual(value.calls.find(item => item.action === "home-apply"), { action: "home-apply", fields: { includeIdle: false } });
  assert.equal(value.calls.at(-1), "close");
  assert.equal(value.records.get("last-result.json").action, "home-apply");
});

test("connection check does not install an absent runtime", async () => {
  const value = fixture(["1"], []);
  value.context.ensureRuntime = async (session, install) => { assert.equal(install, false); return { installed: false }; };
  assert.equal((await runWizard(value.context)).setupInstalled, false);
  assert.equal(value.calls.at(-1), "close");
});

test("a foreign photo setup stops before account authentication", async () => {
  const value = fixture(["4"], [true]);
  value.context.operation = async () => ({ connected: false, existingSetup: true });
  await assert.rejects(runWizard(value.context), /different photo setup/);
  assert.equal(value.calls.at(-1), "close");
});

test("OneDrive uses entered identity and requires confirmation of its folder", async () => {
  const value = fixture(["4", "11111111-2222-4333-8444-555555555555", "family@example.invalid", "Family Photos"], [true, true]);
  value.context.signIn = async (photoConfig, callbacks) => {
    assert.equal(photoConfig.account, "family@example.invalid");
    assert.equal(photoConfig.folderName, "Family Photos");
    assert.equal(await callbacks.confirmFolder({ account: photoConfig.account, folder: "Apps/Family Photos" }), true);
    return { connected: true, folder: "Apps/Family Photos" };
  };
  await runWizard(value.context);
  assert.equal(value.calls.at(-1), "close");
  assert.equal(value.records.get("last-result.json").result.connected, true);
});

test("failed actions always close the connection", async () => {
  const value = fixture(["3"], [true, true]);
  value.context.operation = async () => { throw new Error("synthetic refusal"); };
  await assert.rejects(runWizard(value.context), /synthetic refusal/);
  assert.equal(value.calls.at(-1), "close");
});
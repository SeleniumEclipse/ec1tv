"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { apply, restore, status } = require("./home-control.cjs");
const { APP_ID, OVERRIDE_PATH } = require("./home-plan.cjs");
const clone = value => JSON.parse(JSON.stringify(value));

function fixture(failureAt = null, uncertain = false) {
  const original = {
    settings: { defaultApps: { home: "com.webos.app.home", MembershipApp: "com.example.membership" }, lastAppHandlerPolicy: "idleApp" },
    profiles: { defaultApps: { support: true, categories: { home: "com.webos.app.home", aod: "com.example.aod" } }, idleApp: { support: true, appId: "com.webos.app.home" } },
    app: { id: APP_ID, version: "0.1.15", appCategory: ["home"], handlesRelaunch: false },
    identity: { hostFingerprint: "test-device" }, overrides: []
  };
  let state = clone(original), record = null, override = null, failed = false;
  const calls = [], writes = [];
  function check(name) {
    calls.push(name);
    if (!failed && failureAt === name) { failed = true; const error = new Error("synthetic failure"); error.uncertain = uncertain; throw error; }
  }
  const adapter = {
    async snapshot() { check("snapshot"); return clone(state); },
    async writeOverride(plan) { check("write"); assert.ok(record); assert.equal(record.phase, "applying"); override = JSON.parse(plan.content); state.overrides.push({ path: OVERRIDE_PATH, sha256: plan.sha256 }); },
    async removeOverride() { check("remove"); state.overrides = []; override = null; },
    async rescan() { check("rescan"); state.profiles = clone(original.profiles); if (override) { state.profiles.defaultApps = clone(override.defaultApps); if (override.idleApp) state.profiles.idleApp = clone(override.idleApp); } },
    async setHome(id) { check("set-home"); state.settings.defaultApps.home = id; },
    async saveDefaults(defaults) { check("save-defaults"); state.settings.defaultApps = clone(defaults); }
  };
  const store = {
    async load() { return record ? clone(record) : null; },
    async save(value) { record = clone(value); writes.push(value.phase); },
    async archive(value) { calls.push("archive"); assert.equal(value.phase, "restored"); }
  };
  return { adapter, store, original, calls, writes, state: () => state, record: () => record, removeApp: () => { state.app = null; } };
}

test("Home setup saves recovery before mutation and restores original settings", async () => {
  const context = fixture();
  assert.deepEqual(await apply(context.adapter, context.store, true), { phase: "applied", changed: true, includeIdle: true });
  assert.deepEqual(context.writes.slice(0, 2), ["prepared", "applying"]);
  assert.equal(context.state().settings.defaultApps.home, APP_ID);
  assert.equal(context.state().profiles.idleApp.appId, APP_ID);
  assert.equal((await restore(context.adapter, context.store)).phase, "restored");
  assert.deepEqual(context.state(), context.original);
});

test("repeated setup is checked without duplicate writes", async () => {
  const context = fixture();
  await apply(context.adapter, context.store);
  const writeCount = context.calls.filter(name => name === "write").length;
  assert.equal((await apply(context.adapter, context.store)).changed, false);
  assert.equal(context.calls.filter(name => name === "write").length, writeCount);
  await assert.rejects(apply(context.adapter, context.store, true), /Restore LG Home/);
});

test("completed-operation failures restore the original state", async () => {
  for (const stage of ["write", "rescan", "set-home", "save-defaults"]) {
    const context = fixture(stage);
    await assert.rejects(apply(context.adapter, context.store), /original Home settings were restored/);
    assert.deepEqual(context.state(), context.original);
    assert.equal(context.record().phase, "restored");
  }
});

test("an uncertain native reply keeps recovery state without blind rollback", async () => {
  const context = fixture("set-home", true);
  await assert.rejects(apply(context.adapter, context.store), /did not confirm/);
  assert.equal(context.record().phase, "needs-recovery");
  assert.ok(!context.calls.includes("remove"));
  await assert.rejects(apply(context.adapter, context.store), /Finish Home recovery/);
  assert.equal((await restore(context.adapter, context.store)).phase, "restored");
  assert.deepEqual(context.state(), context.original);
});

test("recovery stops on unrelated drift without changing it", async () => {
  const context = fixture();
  await apply(context.adapter, context.store);
  context.state().settings.lastAppHandlerPolicy = "lastInputApp";
  await assert.rejects(restore(context.adapter, context.store), /Unrelated/);
  assert.ok(!context.calls.includes("remove"));
  assert.equal(context.state().settings.lastAppHandlerPolicy, "lastInputApp");
});

test("removing the launcher does not prevent Home recovery", async () => {
  const context = fixture();
  await apply(context.adapter, context.store);
  context.removeApp();
  assert.equal((await restore(context.adapter, context.store)).phase, "restored");
  assert.equal(context.state().settings.defaultApps.home, "com.webos.app.home");
  assert.equal((await status(context.adapter, context.store)).phase, "restored");
});
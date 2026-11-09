"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { APP_ID, OVERRIDE_PATH, buildPlan, assertApplied, assertRestored, assertRecoverable } = require("./home-plan.cjs");
const clone = value => JSON.parse(JSON.stringify(value));

function snapshot() {
  return {
    settings: { defaultApps: { home: "com.webos.app.home", MembershipApp: "com.example.membership" }, lastAppHandlerPolicy: "idleApp" },
    profiles: {
      defaultApps: { _configuration: "defaultApps.json", support: true, categories: { home: "com.webos.app.home", aod: "com.example.aod" }, preserved: true },
      idleApp: { _configuration: "idleApp.json", support: false, appId: "com.webos.app.home", preserved: "value" }
    },
    app: { id: APP_ID, version: "0.1.15", appCategory: ["home"], handlesRelaunch: false },
    overrides: [{ path: "/var/webos-profile/override/existing.json", sha256: "1".repeat(64) }]
  };
}

test("Home planning changes only saved Home and the effective Home category", () => {
  const before = snapshot(), original = clone(before), plan = buildPlan(before);
  assert.deepEqual(before, original);
  assert.equal(plan.expected.settings.defaultApps.home, APP_ID);
  assert.equal(plan.expected.settings.defaultApps.MembershipApp, original.settings.defaultApps.MembershipApp);
  assert.deepEqual(plan.expected.profiles.idleApp, original.profiles.idleApp);
  const override = JSON.parse(plan.content);
  assert.equal(override.defaultApps.categories.aod, "com.example.aod");
  assert.equal(override.defaultApps._configuration, undefined);
  assert.equal(override.idleApp, undefined);
  assert.doesNotThrow(() => assertApplied(plan, plan.expected));
});

test("optional idle routing retains unrelated idle fields", () => {
  const plan = buildPlan(snapshot(), true), override = JSON.parse(plan.content);
  assert.equal(override.idleApp.appId, APP_ID);
  assert.equal(override.idleApp.support, true);
  assert.equal(override.idleApp.preserved, "value");
  assert.equal(override.idleApp._configuration, undefined);
});

test("already configured or foreign owned-path state is refused", () => {
  for (const edit of [
    before => { before.settings.defaultApps.home = APP_ID; },
    before => { before.profiles.defaultApps.categories.home = APP_ID; },
    before => { before.profiles.idleApp.appId = APP_ID; },
    before => { before.overrides.push({ path: OVERRIDE_PATH, sha256: "2".repeat(64) }); }
  ]) { const before = snapshot(); edit(before); assert.throws(() => buildPlan(before)); }
});

test("recovery accepts partial application but not unrelated settings changes", () => {
  const plan = buildPlan(snapshot(), true);
  assert.doesNotThrow(() => assertRecoverable(plan, plan.before));
  assert.doesNotThrow(() => assertRecoverable(plan, plan.expected));
  const partial = clone(plan.expected);
  partial.settings.defaultApps.home = plan.before.settings.defaultApps.home;
  partial.overrides = clone(plan.before.overrides);
  assert.doesNotThrow(() => assertRecoverable(plan, partial));
  partial.settings.lastAppHandlerPolicy = "lastInputApp";
  assert.throws(() => assertRecoverable(plan, partial), /Unrelated/);
});

test("recovery refuses changed files, apps, categories and tampered plans", () => {
  const plan = buildPlan(snapshot());
  for (const edit of [
    current => { current.overrides[0].sha256 = "3".repeat(64); },
    current => { current.overrides.find(entry => entry.path === OVERRIDE_PATH).sha256 = "4".repeat(64); },
    current => { current.profiles.defaultApps.categories.aod = "another.app"; },
    current => { current.identity = { hostFingerprint: "a-different-device" }; }
  ]) { const current = clone(plan.expected); edit(current); assert.throws(() => assertRecoverable(plan, current)); }
  const tampered = clone(plan); tampered.expected.settings.defaultApps.home = "another.app";
  assert.throws(() => assertRecoverable(tampered, plan.expected), /inconsistent/);
});

test("restoration requires the entire original snapshot", () => {
  const plan = buildPlan(snapshot());
  assert.doesNotThrow(() => assertRestored(plan, plan.before));
  assert.throws(() => assertRestored(plan, plan.expected));
  const malformed = snapshot(); delete malformed.settings.defaultApps;
  assert.throws(() => buildPlan(malformed));
});

test("Home can be restored after the launcher was removed or updated", () => {
  const plan = buildPlan(snapshot());
  const removed = clone(plan.expected); removed.app = null;
  assert.doesNotThrow(() => assertRecoverable(plan, removed));
  const updated = clone(plan.expected); updated.app.version = "0.1.16";
  assert.doesNotThrow(() => assertRecoverable(plan, updated));
  assert.throws(() => assertApplied(plan, updated));
  const restored = clone(plan.before); restored.app = null;
  assert.doesNotThrow(() => assertRestored(plan, restored));
});
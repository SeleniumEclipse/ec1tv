"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const APP_ID = "io.focusstage.home";
const OVERRIDE_PATH = "/var/webos-profile/override/io.ec1tv.home.json";
const clone = value => JSON.parse(JSON.stringify(value));
const digest = value => crypto.createHash("sha256").update(value).digest("hex");

function object(value, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), "Invalid " + label);
  for (const key of Object.keys(value)) assert.ok(!["__proto__", "prototype", "constructor"].includes(key), "Unsafe object key");
  return value;
}

function appId(value) {
  assert.ok(typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(value) && !value.includes(".."), "Invalid application ID");
  return value;
}

function validateSnapshot(snapshot, requireApp = true) {
  object(snapshot, "TV state");
  object(snapshot.settings, "saved settings");
  const defaults = object(snapshot.settings.defaultApps, "default applications");
  assert.ok(Object.keys(defaults).length > 0 && Object.keys(defaults).length <= 32, "Unexpected default-application count");
  for (const value of Object.values(defaults)) appId(value);
  appId(defaults.home);
  assert.equal(typeof snapshot.settings.lastAppHandlerPolicy, "string", "Missing startup policy");
  object(snapshot.profiles, "native profiles");
  const profile = object(snapshot.profiles.defaultApps, "Home profile");
  assert.equal(profile.support, true, "Native default applications are not supported");
  const categories = object(profile.categories, "Home categories");
  for (const value of Object.values(categories)) appId(value);
  appId(categories.home);
  const idle = object(snapshot.profiles.idleApp, "idle profile");
  appId(idle.appId);
  assert.equal(typeof idle.support, "boolean", "Unknown idle-profile support");
  assert.ok(Array.isArray(snapshot.overrides) && snapshot.overrides.length <= 64, "Unexpected override inventory");
  const names = new Set();
  for (const entry of snapshot.overrides) {
    assert.ok(typeof entry.path === "string" && /^\/var\/webos-profile\/override\/[A-Za-z0-9._-]+\.json$/.test(entry.path), "Unexpected override path");
    assert.ok(!names.has(entry.path), "Duplicate override path");
    names.add(entry.path);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
  }
  if (requireApp) {
    object(snapshot.app, "installed launcher");
    assert.equal(snapshot.app.id, APP_ID, "Install the launcher before changing Home");
    assert.match(snapshot.app.version, /^\d+\.\d+\.\d+$/);
    assert.ok(Array.isArray(snapshot.app.appCategory) && snapshot.app.appCategory.includes("home"), "The launcher lacks the Home category");
    assert.equal(snapshot.app.handlesRelaunch, false, "Unexpected launcher activation setting");
  }
  return snapshot;
}

function buildPlan(snapshot, includeIdle = false) {
  validateSnapshot(snapshot);
  assert.equal(typeof includeIdle, "boolean");
  assert.ok(!snapshot.overrides.some(entry => entry.path === OVERRIDE_PATH), "An ec1tv Home override already exists; use its recovery record");
  assert.notEqual(snapshot.settings.defaultApps.home, APP_ID, "Home is already configured outside this setup record");
  assert.notEqual(snapshot.profiles.defaultApps.categories.home, APP_ID, "A Home profile already selects this launcher");
  assert.notEqual(snapshot.profiles.idleApp.appId, APP_ID, "An idle profile already selects this launcher");
  const clean = value => Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith("_")));
  const override = {
    defaultApps: { ...clean(snapshot.profiles.defaultApps), categories: { ...snapshot.profiles.defaultApps.categories, home: APP_ID } }
  };
  if (includeIdle) override.idleApp = { ...clean(snapshot.profiles.idleApp), support: true, appId: APP_ID };
  const content = JSON.stringify(override, null, 2) + "\n";
  assert.ok(Buffer.byteLength(content) <= 8192, "Home override exceeds the size limit");
  const expected = clone(snapshot);
  expected.settings.defaultApps.home = APP_ID;
  expected.profiles.defaultApps.categories.home = APP_ID;
  if (includeIdle) {
    expected.profiles.idleApp.support = true;
    expected.profiles.idleApp.appId = APP_ID;
  }
  expected.overrides.push({ path: OVERRIDE_PATH, sha256: digest(content) });
  expected.overrides.sort((first, second) => first.path.localeCompare(second.path));
  return { version: 1, appId: APP_ID, includeIdle, overridePath: OVERRIDE_PATH, content, sha256: digest(content), before: clone(snapshot), expected };
}

function normalized(snapshot, includeApp = true) {
  validateSnapshot(snapshot, includeApp);
  return {
    settings: snapshot.settings,
    profiles: snapshot.profiles,
    app: includeApp ? snapshot.app : null,
    identity: snapshot.identity || null,
    overrides: snapshot.overrides.map(entry => ({ path: entry.path, sha256: entry.sha256 })).sort((first, second) => first.path.localeCompare(second.path))
  };
}

function assertApplied(plan, snapshot) {
  assert.deepEqual(normalized(snapshot), normalized(plan.expected), "TV state does not match the requested Home configuration");
}

function assertRestored(plan, snapshot) {
  assert.deepEqual(normalized(snapshot, false), normalized(plan.before, false), "Original Home configuration has not been fully restored");
}

function assertRecoverable(plan, snapshot) {
  validateSnapshot(snapshot, false);
  assert.equal(plan.version, 1);
  assert.equal(plan.overridePath, OVERRIDE_PATH);
  assert.equal(plan.sha256, digest(plan.content));
  const expectedPlan = buildPlan(plan.before, plan.includeIdle);
  assert.deepEqual(plan, expectedPlan, "Recovery plan is inconsistent");
  const current = clone(snapshot);
  const original = plan.before;
  assert.ok([original.settings.defaultApps.home, APP_ID].includes(current.settings.defaultApps.home), "Saved Home changed outside this setup");
  assert.ok([original.profiles.defaultApps.categories.home, APP_ID].includes(current.profiles.defaultApps.categories.home), "Effective Home changed outside this setup");
  if (plan.includeIdle) {
    assert.ok([original.profiles.idleApp.appId, APP_ID].includes(current.profiles.idleApp.appId), "Idle app changed outside this setup");
    assert.ok([original.profiles.idleApp.support, true].includes(current.profiles.idleApp.support), "Idle support changed outside this setup");
    current.profiles.idleApp.appId = original.profiles.idleApp.appId;
    current.profiles.idleApp.support = original.profiles.idleApp.support;
  }
  const own = current.overrides.find(entry => entry.path === OVERRIDE_PATH);
  if (own) assert.equal(own.sha256, plan.sha256, "The Home override changed outside this setup");
  current.overrides = current.overrides.filter(entry => entry.path !== OVERRIDE_PATH);
  current.settings.defaultApps.home = original.settings.defaultApps.home;
  current.profiles.defaultApps.categories.home = original.profiles.defaultApps.categories.home;
  assert.deepEqual(normalized(current, false), normalized(original, false), "Unrelated TV state changed; automatic recovery stopped");
}

module.exports = { APP_ID, OVERRIDE_PATH, digest, validateSnapshot, buildPlan, assertApplied, assertRestored, assertRecoverable };
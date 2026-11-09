"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { APP_ID, buildPlan, assertApplied, assertRestored, assertRecoverable } = require("./home-plan.cjs");

function validateRecord(record) {
  assert.ok(record && record.version === 1 && record.kind === "ec1tv-home", "Unknown Home recovery record");
  assert.ok(["prepared", "applying", "applied", "restoring", "restored", "needs-recovery"].includes(record.phase), "Unknown Home recovery state");
  assert.match(record.operationId, /^[a-f0-9-]{36}$/);
  assert.deepEqual(record.plan, buildPlan(record.plan.before, record.plan.includeIdle), "Home recovery record is inconsistent");
  return record;
}

async function restore(adapter, store, suppliedRecord) {
  const record = validateRecord(suppliedRecord || await store.load());
  const current = await adapter.snapshot();
  if (record.phase === "restored") {
    assertRestored(record.plan, current);
    return { phase: "restored", changed: false };
  }
  assertRecoverable(record.plan, current);
  if (adapter.ensureRestoreTargets) await adapter.ensureRestoreTargets(record.plan);
  record.phase = "restoring";
  await store.save(record);
  try {
    await adapter.removeOverride(record.plan);
    await adapter.rescan();
    assertRecoverable(record.plan, await adapter.snapshot());
    await adapter.setHome(record.plan.before.settings.defaultApps.home);
    assertRecoverable(record.plan, await adapter.snapshot());
    await adapter.saveDefaults(record.plan.before.settings.defaultApps);
    assertRestored(record.plan, await adapter.snapshot());
    record.phase = "restored";
    await store.save(record);
    return { phase: "restored", changed: true };
  } catch (error) {
    record.phase = "needs-recovery";
    await store.save(record);
    const failure = new Error("Home restoration needs attention. Keep the recovery record and check the TV before retrying.");
    failure.cause = error;
    throw failure;
  }
}

async function apply(adapter, store, includeIdle = false) {
  const previous = await store.load();
  if (previous) {
    validateRecord(previous);
    if (previous.phase === "applied") {
      assert.equal(previous.plan.includeIdle, includeIdle, "Restore LG Home before choosing a different idle option");
      assertApplied(previous.plan, await adapter.snapshot());
      return { phase: "applied", changed: false, includeIdle };
    }
    assert.equal(previous.phase, "restored", "Finish Home recovery before starting another setup");
    await store.archive(previous);
  }
  const plan = buildPlan(await adapter.snapshot(), includeIdle);
  if (adapter.ensureRestoreTargets) await adapter.ensureRestoreTargets(plan);
  const record = { version: 1, kind: "ec1tv-home", operationId: crypto.randomUUID(), phase: "prepared", plan };
  await store.save(record);
  try {
    record.phase = "applying";
    await store.save(record);
    assertRestored(plan, await adapter.snapshot());
    await adapter.writeOverride(plan);
    await adapter.rescan();
    assertRecoverable(plan, await adapter.snapshot());
    await adapter.setHome(APP_ID);
    assertRecoverable(plan, await adapter.snapshot());
    await adapter.saveDefaults(plan.expected.settings.defaultApps);
    assertApplied(plan, await adapter.snapshot());
    record.phase = "applied";
    await store.save(record);
    return { phase: "applied", changed: true, includeIdle };
  } catch (error) {
    if (error.uncertain === true) {
      record.phase = "needs-recovery";
      await store.save(record);
      throw new Error("The TV did not confirm the change. Check Home status before using Restore LG Home; do not repeat setup.");
    }
    try { await restore(adapter, store, record); }
    catch { throw new Error("Home setup stopped and restoration needs attention. Keep the recovery record and use Restore LG Home."); }
    throw new Error("Home setup stopped. The original Home settings were restored.");
  }
}

async function status(adapter, store) {
  const record = await store.load();
  const current = await adapter.snapshot();
  if (!record) return { phase: "not-configured", currentHome: current.settings.defaultApps.home, appVersion: current.app ? current.app.version : null };
  validateRecord(record);
  if (record.phase === "applied") assertApplied(record.plan, current);
  else if (record.phase === "restored") assertRestored(record.plan, current);
  else assertRecoverable(record.plan, current);
  return { phase: record.phase, includeIdle: record.plan.includeIdle, currentHome: current.settings.defaultApps.home, appVersion: current.app ? current.app.version : null };
}

module.exports = { apply, restore, status, validateRecord };
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const cp = require("node:child_process");
const { APP_ID, OVERRIDE_PATH } = require("./home-plan.cjs");
const { createFiles } = require("./protected-files.cjs");

const SERVICES = Object.freeze({
  settings: "luna://com.webos.settingsservice/getSystemSettings",
  profiles: "luna://com.webos.service.systemprofile/getProfiles",
  app: "luna://com.webos.applicationManager/getAppInfo",
  setHome: "luna://com.webos.service.applicationmanager/setDefaultApp",
  save: "luna://com.webos.settingsservice/setSystemSettings",
  rescan: "luna://com.webos.service.systemprofile/debug/rescan"
});

function nativeCall(uri, payload, options = {}, execute = cp.execFileSync) {
  assert.ok(Object.values(SERVICES).includes(uri), "Unsupported native service");
  const body = JSON.stringify(payload);
  assert.ok(Buffer.byteLength(body) <= 32768, "Native request is too large");
  const mutating = [SERVICES.setHome, SERVICES.save, SERVICES.rescan].includes(uri);
  let bytes;
  try {
    bytes = execute("/usr/bin/luna-send", ["-n", "1", "-f", uri, body], {
      timeout: 12000, maxBuffer: 1048576, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
    });
  } catch {
    const error = new Error("The TV service did not complete its response.");
    error.uncertain = mutating;
    throw error;
  }
  let reply;
  try { reply = JSON.parse(String(bytes).trim()); }
  catch {
    const error = new Error("The TV service returned an unreadable response.");
    error.uncertain = mutating;
    throw error;
  }
  assert.ok(reply && typeof reply === "object" && !Array.isArray(reply), "Invalid native response");
  if (!options.allowFailure) assert.equal(reply.returnValue, true, "The TV refused this native request");
  return reply;
}

function createAdapter({ identity, files = createFiles(), fileSystem = fs, call = nativeCall }) {
  assert.ok(identity && /^SHA256:[A-Za-z0-9+/]{43}$/.test(identity.hostFingerprint), "A verified TV host fingerprint is required");
  return {
    snapshot() {
      files.directory("/var/webos-profile");
      files.directory("/var/webos-profile/override");
      const settings = call(SERVICES.settings, { category: "general", keys: ["defaultApps", "lastAppHandlerPolicy"] });
      const profiles = call(SERVICES.profiles, { names: ["defaultApps", "idleApp"] });
      const response = call(SERVICES.app, { id: APP_ID }, { allowFailure: true });
      const metadata = response.appInfo || response;
      const app = response.returnValue === true ? {
        id: metadata.id, version: metadata.version,
        appCategory: metadata.appCategory || [], handlesRelaunch: metadata.handlesRelaunch === true
      } : null;
      const names = fileSystem.readdirSync("/var/webos-profile/override").sort();
      assert.ok(names.length <= 64 && names.every(name => /^[A-Za-z0-9._-]+\.json$/.test(name)), "Unexpected native override files");
      const overrides = names.map(name => {
        const filename = "/var/webos-profile/override/" + name;
        const value = files.read(filename, { maximum: 65536 });
        return { path: filename, sha256: value.sha256 };
      });
      return { settings: settings.settings, profiles: profiles.profiles, app, overrides, identity: { ...identity } };
    },
    writeOverride(plan) {
      assert.equal(plan.overridePath, OVERRIDE_PATH);
      files.write(OVERRIDE_PATH, Buffer.from(plan.content), null, 0o644);
    },
    removeOverride(plan) {
      assert.equal(plan.overridePath, OVERRIDE_PATH);
      files.remove(OVERRIDE_PATH, plan.sha256);
    },
    rescan() { return call(SERVICES.rescan, {}); },
    setHome(id) { return call(SERVICES.setHome, { category: "home", appId: id }); },
    saveDefaults(defaults) { return call(SERVICES.save, { category: "general", settings: { defaultApps: defaults }, store: true }); },
    ensureRestoreTargets(plan) {
      for (const id of new Set([plan.before.settings.defaultApps.home, plan.before.profiles.defaultApps.categories.home])) {
        const response = call(SERVICES.app, { id });
        assert.equal((response.appInfo || response).id, id, "The original Home application is unavailable");
      }
    }
  };
}

module.exports = { SERVICES, nativeCall, createAdapter };
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const cp = require("node:child_process");
const ROOT = "/var/lib/ec1tv-setup";
const RUNTIME = ROOT + "/runtime";
const LOCK = ROOT + "/operation.lock";

function validateRequest(request) {
  assert.ok(request && typeof request === "object" && !Array.isArray(request), "Invalid setup request");
  assert.equal(request.version, 1, "Unsupported setup request version");
  assert.ok(["home-status", "home-apply", "home-restore", "photos-status", "photos-connect", "photos-verify", "photos-disconnect"].includes(request.action), "Unsupported setup action");
  const allowed = ["version", "action", "hostFingerprint", "includeIdle"];
  if (request.action === "photos-connect") allowed.push("connection");
  assert.ok(Object.keys(request).every(key => allowed.includes(key)), "Unexpected setup request field");
  assert.match(request.hostFingerprint, /^SHA256:[A-Za-z0-9+/]{43}$/);
  if (request.includeIdle !== undefined) assert.equal(typeof request.includeIdle, "boolean");
  if (request.action === "photos-connect") require("./focus-photo-helper.cjs").validateState(request.connection);
  return request;
}

async function dispatch(request, adapter, store, photoControl) {
  validateRequest(request);
  if (request.action.startsWith("photos-")) {
    assert.ok(photoControl, "Photo controls are unavailable");
    if (request.action === "photos-connect") {
      const current = await adapter.snapshot();
      assert.equal(current.app && current.app.version, "0.1.16", "Install launcher 0.1.16 before connecting photos");
      return photoControl.connect(request.connection);
    }
    if (request.action === "photos-disconnect") return photoControl.disconnect();
    if (request.action === "photos-verify") return photoControl.verify();
    return photoControl.status();
  }
  const home = require("./home-control.cjs");
  if (request.action === "home-apply") return home.apply(adapter, store, request.includeIdle === true);
  if (request.action === "home-restore") return home.restore(adapter, store);
  return home.status(adapter, store);
}

function requestBytes(input) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    input.on("data", chunk => {
      size += chunk.length;
      if (size > 131072) { input.pause(); reject(new Error("Setup request exceeds the size limit")); return; }
      chunks.push(chunk);
    });
    input.on("error", reject);
    input.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function checkDirectory(filename) {
  const stat = fs.lstatSync(filename);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === 0 && (stat.mode & 0o777) === 0o700, "Unsafe setup runtime directory");
  assert.equal(fs.realpathSync(filename), filename);
}

async function main() {
  assert.equal(process.platform, "linux", "This worker must run on the TV");
  assert.equal(process.getuid(), 0, "Administrator access is required");
  assert.equal(__dirname, RUNTIME, "Unexpected setup runtime location");
  process.umask(0o077);
  checkDirectory(ROOT); checkDirectory(RUNTIME);
  const bytes = await requestBytes(process.stdin);
  const request = validateRequest(JSON.parse(bytes.toString("utf8")));
  if (process.argv[2] !== "--locked") {
    assert.equal(process.argv.length, 2);
    try {
      const stat = fs.lstatSync(LOCK);
      assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.uid === 0 && stat.nlink === 1 && (stat.mode & 0o777) === 0o600, "Unsafe setup lock file");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    const result = cp.spawnSync("/usr/bin/flock", ["-w", "3", LOCK, "/usr/bin/node", __filename, "--locked"], {
      input: bytes, encoding: "utf8", timeout: 240000, maxBuffer: 1048576, stdio: ["pipe", "pipe", "pipe"]
    });
    bytes.fill(0);
    if (result.error) throw new Error("The setup operation did not confirm completion. Check status before retrying.");
    if (result.stdout) process.stdout.write(result.stdout);
    else throw new Error("Another setup operation is active or the TV worker could not start.");
    process.exitCode = result.status || 0;
    return;
  }
  assert.ok(process.argv.length === 3 || (process.argv.length === 4 && process.argv[3] === "--photo-locked"));
  const { createFiles } = require("./protected-files.cjs");
  const { createAdapter } = require("./tv-adapter.cjs");
  const { createPhotoControl } = require("./photo-control.cjs");
  const files = createFiles();
  const adapter = createAdapter({ identity: { hostFingerprint: request.hostFingerprint }, files });
  const photoControl = createPhotoControl({
    files, fileSystem: fs, helperBytes: files.read(RUNTIME + "/focus-photo-helper.cjs", { maximum: 131072, mode: 0o600 }).bytes,
    invokeHelper(operation) {
      assert.equal(operation, "verify");
      let output;
      try { output = cp.execFileSync("/usr/bin/node", ["/var/lib/focus-stage-photos/focus-photo-helper.cjs", "verify"], { timeout: 30000, maxBuffer: 262144, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
      catch { const error = new Error("The photo verification did not confirm completion."); error.uncertain = true; throw error; }
      return JSON.parse(output.trim());
    }
  });
  if (["photos-connect", "photos-verify", "photos-disconnect"].includes(request.action) && process.argv[3] !== "--photo-locked") {
    if (request.action === "photos-connect") photoControl.prepare();
    const directory = "/var/lib/focus-stage-photos";
    files.directory(directory, true);
    files.read(directory + "/request.lock", { absent: true, mode: 0o600 });
    const result = cp.spawnSync("/usr/bin/flock", ["-w", "3", directory + "/request.lock", "/usr/bin/node", __filename, "--locked", "--photo-locked"], {
      input: bytes, encoding: "utf8", timeout: 60000, maxBuffer: 1048576, stdio: ["pipe", "pipe", "pipe"]
    });
    bytes.fill(0);
    if (result.error || !result.stdout) throw new Error("The photo operation did not confirm completion. Check photo status before retrying.");
    process.stdout.write(result.stdout);
    process.exitCode = result.status || 0;
    return;
  }
  const result = await dispatch(request, adapter, files.journal(ROOT + "/home.json"), photoControl);
  bytes.fill(0);
  if (request.connection) { request.connection.accessToken = ""; request.connection.refreshToken = ""; }
  console.log(JSON.stringify({ ok: true, result }));
}

module.exports = { ROOT, RUNTIME, LOCK, validateRequest, dispatch, requestBytes };
if (require.main === module) main().catch(error => { console.log(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; });
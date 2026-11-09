"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const cp = require("node:child_process");
const crypto = require("node:crypto");

function inside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep));
}

function validatePrivatePath(filename, repository, environment = process.env) {
  const absolute = path.resolve(filename);
  assert.ok(!absolute.startsWith("\\\\"), "Use a private local folder, not a network share");
  assert.ok(!inside(repository, absolute), "Private setup files must be outside the repository");
  for (const root of [environment.OneDrive, environment.OneDriveConsumer, environment.OneDriveCommercial].filter(Boolean)) {
    assert.ok(!inside(root, absolute), "Private setup files must not be stored in OneDrive");
  }
  let directory = fs.existsSync(absolute) && fs.lstatSync(absolute).isDirectory() ? absolute : path.dirname(absolute);
  while (true) {
    assert.ok(!fs.existsSync(path.join(directory, ".git")), "Private setup files must not be inside any Git repository");
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return absolute;
}

function defaultDirectory(environment = process.env) {
  if (process.platform === "win32") {
    assert.ok(environment.LOCALAPPDATA, "Windows local app-data directory is unavailable");
    return path.join(environment.LOCALAPPDATA, "ec1tv");
  }
  return path.join(environment.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "ec1tv");
}

function protectDirectory(directory) {
  if (process.platform === "win32") {
    const identity = cp.execFileSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true, timeout: 5000 });
    const sid = identity.match(/S-1-\d+(?:-\d+)+/);
    assert.ok(sid, "Cannot identify the Windows user for private storage");
    cp.execFileSync("icacls.exe", [directory, "/inheritance:r", "/grant:r", "*" + sid[0] + ":(OI)(CI)F", "*S-1-5-18:(OI)(CI)F"], {
      windowsHide: true, timeout: 10000, stdio: ["ignore", "pipe", "pipe"]
    });
  } else {
    const stat = fs.lstatSync(directory);
    assert.equal(stat.uid, process.getuid(), "Private storage belongs to another user");
    fs.chmodSync(directory, 0o700);
  }
}

function containsSecret(value) {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => /^(?:password|passphrase|privateKey|accessToken|refreshToken|clientSecret)$/i.test(key) || containsSecret(child));
}

function createLocalState(repository, requestedDirectory = defaultDirectory()) {
  const directory = validatePrivatePath(requestedDirectory, repository);
  const existed = fs.existsSync(directory);
  if (!existed) fs.mkdirSync(directory, { mode: 0o700, recursive: true });
  const stat = fs.lstatSync(directory);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), "Unsafe local setup directory");
  const real = fs.realpathSync(directory);
  validatePrivatePath(real, repository);
  const marker = path.join(directory, "owner.json");
  if (existed) {
    assert.ok(fs.existsSync(marker), "This private folder is not an ec1tv setup folder; choose another folder");
    const markerStat = fs.lstatSync(marker);
    assert.ok(markerStat.isFile() && !markerStat.isSymbolicLink() && markerStat.size < 1024, "Invalid setup-folder ownership record");
    assert.equal(JSON.parse(fs.readFileSync(marker, "utf8")).kind, "ec1tv-user-setup");
  }
  protectDirectory(directory);
  if (!existed) fs.writeFileSync(marker, JSON.stringify({ kind: "ec1tv-user-setup", version: 1 }) + "\n", { flag: "wx", mode: 0o600 });
  function target(name) {
    assert.match(name, /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}\.json$/);
    return path.join(directory, name);
  }
  function read(name) {
    const filename = target(name);
    if (!fs.existsSync(filename)) return null;
    const current = fs.lstatSync(filename);
    assert.ok(current.isFile() && !current.isSymbolicLink() && current.nlink === 1 && current.size <= 262144, "Unsafe local setup file");
    return JSON.parse(fs.readFileSync(filename, "utf8"));
  }
  function save(name, value) {
    assert.ok(!containsSecret(value), "Tokens, passwords and private keys must not be saved in setup records");
    const filename = target(name), bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n");
    assert.ok(bytes.length <= 262144, "Setup record is too large");
    if (fs.existsSync(filename)) read(name);
    const temporary = filename + "." + crypto.randomUUID() + ".tmp";
    const descriptor = fs.openSync(temporary, "wx", 0o600);
    try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, filename);
    return filename;
  }
  return { directory, read, save };
}

module.exports = { inside, validatePrivatePath, defaultDirectory, containsSecret, createLocalState };
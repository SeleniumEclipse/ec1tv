"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execute, quote } = require("./connection.cjs");
const NAMES = ["home-plan.cjs", "home-control.cjs", "protected-files.cjs", "tv-adapter.cjs", "tv-worker.cjs", "photo-control.cjs", "focus-photo-helper.cjs", "LICENSE"];

function bootstrap(bundle, environment = {}) {
  const assert = require("node:assert/strict");
  const crypto = require("node:crypto");
  const fs = environment.fs || require("node:fs");
  const root = "/var/lib/ec1tv-setup", runtime = root + "/runtime", marker = root + "/install.json";
  const names = ["home-plan.cjs", "home-control.cjs", "protected-files.cjs", "tv-adapter.cjs", "tv-worker.cjs", "photo-control.cjs", "focus-photo-helper.cjs", "LICENSE"];
  const hash = value => crypto.createHash("sha256").update(value).digest("hex");
  assert.ok(bundle && bundle.version === 1 && typeof bundle.install === "boolean" && Array.isArray(bundle.files), "Invalid setup runtime bundle");
  assert.match(bundle.hostFingerprint, /^SHA256:[A-Za-z0-9+/]{43}$/);
  assert.equal(bundle.files.length, names.length, "Unexpected setup runtime file count");
  const expected = new Set(names), decoded = new Map(), hashes = {};
  let total = 0;
  for (const entry of bundle.files) {
    assert.ok(entry && expected.delete(entry.name), "Unexpected or duplicate setup runtime file");
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    assert.ok(typeof entry.data === "string" && entry.data.length <= 350000 && /^[A-Za-z0-9+/]*={0,2}$/.test(entry.data), "Invalid setup runtime encoding");
    const bytes = Buffer.from(entry.data, "base64");
    assert.equal(bytes.toString("base64"), entry.data);
    assert.ok(bytes.length > 0 && bytes.length <= 262144, "Setup runtime file size is invalid");
    total += bytes.length;
    assert.ok(total <= 524288, "Setup runtime bundle is too large");
    assert.equal(hash(bytes), entry.sha256, "Setup runtime file checksum mismatch");
    hashes[entry.name] = entry.sha256; decoded.set(entry.name, bytes);
  }
  if (environment.validateOnly) return { files: names.length, hashes };
  const uid = environment.getuid ? environment.getuid() : process.getuid();
  assert.equal(uid, 0, "Administrator access is required");
  assert.ok(Number((environment.nodeVersion || process.versions.node).split(".")[0]) >= 16, "The TV needs Node.js 16 or later");
  function directory(filename, privateMode = false) {
    const stat = fs.lstatSync(filename);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === 0 && !(stat.mode & 0o022), "Unsafe setup parent directory");
    if (privateMode) assert.equal(stat.mode & 0o777, 0o700, "Setup directory must have mode 0700");
    assert.equal(fs.realpathSync(filename), filename);
  }
  function read(filename) {
    if (!fs.existsSync(filename)) return null;
    const stat = fs.lstatSync(filename);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.uid === 0 && stat.nlink === 1 && stat.size <= 262144 && (stat.mode & 0o777) === 0o600, "Unsafe setup runtime file");
    const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const current = fs.fstatSync(descriptor);
      assert.equal(current.ino, stat.ino); assert.equal(current.dev, stat.dev);
      return fs.readFileSync(descriptor);
    } finally { fs.closeSync(descriptor); }
  }
  function write(filename, bytes, original = null) {
    const current = read(filename);
    assert.equal(current ? hash(current) : null, original ? hash(original) : null, "Runtime changed before writing");
    const temporary = filename + "." + crypto.randomUUID() + ".tmp";
    const descriptor = fs.openSync(temporary, "wx", 0o600);
    try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
    assert.equal(hash(read(temporary)), hash(bytes));
    const before = read(filename);
    assert.equal(before ? hash(before) : null, original ? hash(original) : null, "Runtime changed before replacement");
    if (original) fs.renameSync(temporary, filename);
    else { fs.linkSync(temporary, filename); fs.unlinkSync(temporary); }
    const parent = fs.openSync(filename.slice(0, filename.lastIndexOf("/")), "r");
    try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
  }
  directory("/var"); directory("/var/lib");
  if (!fs.existsSync(root)) {
    if (!bundle.install) return { installed: false, compatible: true, files: 0 };
    fs.mkdirSync(root, { mode: 0o700 });
    directory(root, true);
    write(marker, Buffer.from(JSON.stringify({ kind: "ec1tv-runtime", version: 1, phase: "installing", hostFingerprint: bundle.hostFingerprint, hashes }) + "\n"));
  }
  directory(root, true);
  const original = read(marker);
  assert.ok(original, "An unowned setup directory exists; it will not be changed");
  const record = JSON.parse(original.toString("utf8"));
  assert.ok(record.kind === "ec1tv-runtime" && record.version === 1 && ["installing", "ready"].includes(record.phase), "Unknown setup runtime ownership record");
  assert.equal(record.hostFingerprint, bundle.hostFingerprint, "Setup runtime belongs to a different TV identity");
  assert.deepEqual(record.hashes, hashes, "Use the matching ec1tv setup version for recovery; this runtime will not be overwritten");
  if (!fs.existsSync(runtime)) {
    assert.equal(record.phase, "installing", "The installed runtime directory is missing");
    if (!bundle.install) return { installed: false, compatible: true, incomplete: true, files: 0 };
    fs.mkdirSync(runtime, { mode: 0o700 });
  }
  directory(runtime, true);
  for (const name of names) {
    const filename = runtime + "/" + name, current = read(filename);
    if (current) assert.equal(hash(current), hashes[name], "An installed setup file changed unexpectedly");
    else {
      assert.equal(record.phase, "installing", "Setup runtime file is missing");
      if (!bundle.install) return { installed: false, compatible: true, incomplete: true };
      write(filename, decoded.get(name));
    }
  }
  if (record.phase !== "ready") {
    if (!bundle.install) return { installed: false, compatible: true, incomplete: true, files: names.length };
    record.phase = "ready";
    write(marker, Buffer.from(JSON.stringify(record) + "\n"), original);
  }
  return { installed: true, compatible: true, files: names.length };
}

function bundle(hostFingerprint, install = false) {
  const entries = NAMES.map(name => {
    const filename = name === "LICENSE" ? path.resolve(__dirname, "../..", "LICENSE") : path.join(__dirname, name);
    const stat = fs.lstatSync(filename);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 262144, "Invalid local setup runtime source");
    const bytes = fs.readFileSync(filename);
    return { name, data: bytes.toString("base64"), sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
  });
  const result = { version: 1, hostFingerprint, install, files: entries };
  bootstrap(result, { validateOnly: true });
  return result;
}

function bootstrapSource() {
  return '"use strict";const chunks=[];let total=0;process.stdin.on("data",chunk=>{total+=chunk.length;if(total>800000)process.exit(2);chunks.push(chunk);});process.stdin.on("end",()=>{try{const input=JSON.parse(Buffer.concat(chunks).toString("utf8"));const result=(' + bootstrap.toString() + ')(input);console.log(JSON.stringify({ok:true,result}));}catch(error){console.log(JSON.stringify({ok:false,error:error.message}));}});';
}

async function ensureRuntime(session, install = false) {
  const input = Buffer.from(JSON.stringify(bundle(session.hostFingerprint, install)));
  try {
    const output = await execute(session, "/usr/bin/node -e " + quote(bootstrapSource()), input, 60000);
    const response = JSON.parse(output.trim());
    assert.equal(response.ok, true, response.error || "Setup runtime verification failed");
    return response.result;
  } finally { input.fill(0); }
}

async function operation(session, action, fields = {}) {
  const request = { version: 1, action, hostFingerprint: session.hostFingerprint, ...fields };
  require("./tv-worker.cjs").validateRequest(request);
  const bytes = Buffer.from(JSON.stringify(request));
  try {
    const output = await execute(session, "/usr/bin/node /var/lib/ec1tv-setup/runtime/tv-worker.cjs", bytes);
    const response = JSON.parse(output.trim());
    assert.equal(response.ok, true, response.error || "The TV did not confirm the setup operation");
    return response.result;
  } finally { bytes.fill(0); }
}

module.exports = { NAMES, bootstrap, bundle, bootstrapSource, ensureRuntime, operation };
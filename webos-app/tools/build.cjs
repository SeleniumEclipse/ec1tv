"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { spawnSync } = require("node:child_process");

function readTar(buffer) {
  const entries = new Map();
  for (let offset = 0; offset + 512 <= buffer.length;) {
    const header = buffer.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString().replace(/\0.*$/, "");
    if (!name) break;
    const prefix = header.subarray(345, 500).toString().replace(/\0.*$/, "");
    const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/, "").trim() || "0", 8);
    assert.ok(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= buffer.length, "Invalid package tar size");
    const full = (prefix ? prefix + "/" + name : name).replace(/^\.\//, "");
    assert.ok(!full.startsWith("/") && !full.includes("\\") && !full.split("/").includes(".."), "Unsafe package path");
    assert.ok(!entries.has(full), "Duplicate package path");
    assert.ok([0, 48, 53].includes(header[156]), "Unsupported package entry type");
    entries.set(full, { bytes: buffer.subarray(offset + 512, offset + 512 + size), directory: header[156] === 53 });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function sourceFiles(directory, prefix = "") {
  const result = [];
  for (const name of fs.readdirSync(directory).sort()) {
    const filename = path.join(directory, name);
    const stat = fs.lstatSync(filename);
    assert.ok(!stat.isSymbolicLink(), "Source symlinks are not permitted");
    const relative = prefix ? prefix + "/" + name : name;
    if (stat.isDirectory()) result.push(...sourceFiles(filename, relative));
    else {
      assert.ok(stat.isFile() && stat.size <= 12000000, "Unexpected application file");
      assert.ok(!/(?:^|\/)(?:\.git|\.ssh|state|keys|node_modules)(?:\/|$)|\.(?:key|pem|pfx|p12|dpapi|log)$/i.test(relative), "Private file in application source");
      result.push(relative);
    }
  }
  return result;
}

function packageParts(bytes) {
  if (bytes.subarray(0, 8).toString() !== "!<arch>\n") return readTar(zlib.gunzipSync(bytes));
  const parts = new Map();
  for (let offset = 8; offset + 60 <= bytes.length;) {
    const name = bytes.subarray(offset, offset + 16).toString().trim().replace(/\/$/, "");
    const size = Number(bytes.subarray(offset + 48, offset + 58).toString().trim());
    assert.ok(Number.isSafeInteger(size) && size >= 0 && offset + 60 + size <= bytes.length, "Invalid package archive size");
    assert.ok(!parts.has(name), "Duplicate package archive member");
    parts.set(name, { bytes: bytes.subarray(offset + 60, offset + 60 + size), directory: false });
    offset += 60 + size + size % 2;
  }
  return parts;
}

function verifyPackage(bytes, source, info, expectedFiles) {
  const parts = packageParts(bytes);
  assert.ok(parts.has("data.tar.gz") && parts.has("control.tar.gz"), "Incomplete IPK");
  const control = readTar(zlib.gunzipSync(parts.get("control.tar.gz").bytes));
  assert.ok([...control].every(([name, entry]) => entry.directory || name === "control"), "Unexpected package install/remove hook");
  const entries = readTar(zlib.gunzipSync(parts.get("data.tar.gz").bytes));
  const prefix = "usr/palm/applications/" + info.id + "/";
  const expected = new Set(expectedFiles);
  const verified = [];
  let metadataFound = false;
  for (const [name, entry] of entries) {
    if (entry.directory) continue;
    if (name === "usr/palm/packages/" + info.id + "/packageinfo.json") {
      assert.deepEqual(JSON.parse(entry.bytes.toString("utf8")), { id: info.id, version: info.version, app: info.id });
      metadataFound = true;
      continue;
    }
    assert.ok(name.startsWith(prefix), "Package file outside the launcher");
    const relative = name.slice(prefix.length);
    assert.ok(expected.delete(relative), "Unexpected or duplicate packaged file");
    assert.ok(entry.bytes.equals(fs.readFileSync(path.join(source, relative))), "Package/source bytes differ");
    verified.push(relative);
  }
  assert.equal(expected.size, 0, "Source files missing from package");
  assert.ok(metadataFound, "Package metadata is missing");
  return verified.sort();
}

function build() {
  const appRoot = path.resolve(__dirname, "..");
  const project = path.resolve(appRoot, "..");
  const source = path.join(appRoot, "app");
  const info = JSON.parse(fs.readFileSync(path.join(source, "appinfo.json"), "utf8"));
  assert.equal(info.id, "io.focusstage.home", "An app-ID change needs a separate migration review");
  assert.match(info.version, /^\d+\.\d+\.\d+$/);
  const expectedFiles = sourceFiles(source);
  for (const required of ["LICENSE.txt", "assets/asset-sources.json", "assets/source-sans-OFL.txt", "assets/lucide-LICENSE.txt"]) {
    assert.ok(expectedFiles.includes(required), "Required asset/licence notice is absent");
  }
  const cliRoot = path.join(project, "node_modules", "@webos-tools", "cli");
  const cliPackage = JSON.parse(fs.readFileSync(path.join(cliRoot, "package.json"), "utf8"));
  assert.equal(cliPackage.version, "3.2.6", "Install the reviewed locked dependencies first");
  const cli = path.resolve(cliRoot, cliPackage.bin["ares-package"]);
  assert.ok(cli.startsWith(cliRoot + path.sep), "Unexpected CLI entry point");
  const output = path.join(appRoot, "dist");
  const ipk = path.join(output, info.id + "_" + info.version + "_all.ipk");
  assert.ok(!fs.existsSync(ipk), "Package already exists; preserve/review it before choosing to remove or relocate it");
  for (const directory of [output, path.join(appRoot, "reports"), path.join(appRoot, ".build-work")]) fs.mkdirSync(directory, { recursive: true });
  const work = fs.mkdtempSync(path.join(appRoot, ".build-work", "package-"));
  const home = path.join(work, "cli-home");
  fs.mkdirSync(home);
  const result = spawnSync(process.execPath, [cli, source, "--no-minify", "--outdir", output], {
    cwd: appRoot, encoding: "utf8", windowsHide: true, timeout: 120000, maxBuffer: 4000000,
    env: { ...process.env, TEMP: work, TMP: work, TMPDIR: work, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home }
  });
  fs.writeFileSync(path.join(work, "package.log"), (result.stdout || "") + (result.stderr || ""));
  if (result.error) throw result.error;
  assert.equal(result.status, 0, "LG packaging failed; inspect the private generated package.log");
  const bytes = fs.readFileSync(ipk);
  const verified = verifyPackage(bytes, source, info, expectedFiles);
  const report = {
    id: info.id, version: info.version,
    package: path.relative(project, ipk).split(path.sep).join("/"),
    bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    cli: "@webos-tools/cli@" + cliPackage.version,
    inspectedPayloadFiles: verified, packagePayloadMatchesSources: true,
    deviceContacted: false, homeAssignmentChanged: false
  };
  const reportPath = path.join(appRoot, "reports", info.id + "_" + info.version + "_build.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ package: report.package, sha256: report.sha256, verifiedFiles: verified.length, deviceContacted: false }, null, 2));
}

module.exports = { readTar, sourceFiles, verifyPackage };
if (require.main === module) {
  try { build(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
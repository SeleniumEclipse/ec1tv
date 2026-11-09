"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { readTar, sourceFiles, verifyPackage } = require("../tools/build.cjs");
const source = path.resolve(__dirname, "../app");
const info = JSON.parse(fs.readFileSync(path.join(source, "appinfo.json"), "utf8"));

function tar(entries) {
  const chunks = [];
  for (const [name, content, type = 48] of entries) {
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const header = Buffer.alloc(512);
    header.write(name);
    header.write(bytes.length.toString(8).padStart(11, "0") + "\0", 124, 12);
    header[156] = type;
    chunks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function fixture(appEntries, controlEntries = [["control", "Package: test\n"]], metadata = { id: info.id, version: info.version, app: info.id }) {
  const entries = appEntries.map(([name, bytes]) => ["usr/palm/applications/" + info.id + "/" + name, bytes]);
  if (metadata) entries.push(["usr/palm/packages/" + info.id + "/packageinfo.json", JSON.stringify(metadata)]);
  return zlib.gzipSync(tar([
    ["control.tar.gz", zlib.gzipSync(tar(controlEntries))],
    ["data.tar.gz", zlib.gzipSync(tar(entries))]
  ]));
}

test("launcher package verification includes every source file and licence notice", () => {
  const files = sourceFiles(source);
  const bytes = fixture(files.map(name => [name, fs.readFileSync(path.join(source, name))]));
  assert.deepEqual(verifyPackage(bytes, source, info, files), files.slice().sort());
  for (const name of ["LICENSE.txt", "assets/source-sans-OFL.txt", "assets/lucide-LICENSE.txt"]) assert.ok(files.includes(name));
});

test("package verifier rejects altered source bytes", () => {
  const bytes = fixture([["appinfo.json", "altered"]]);
  assert.throws(() => verifyPackage(bytes, source, info, ["appinfo.json"]), /bytes differ/);
});

test("package verifier rejects omitted or unexpected files", () => {
  const entry = ["appinfo.json", fs.readFileSync(path.join(source, "appinfo.json"))];
  assert.throws(() => verifyPackage(fixture([entry]), source, info, ["appinfo.json", "LICENSE.txt"]), /missing/);
  assert.throws(() => verifyPackage(fixture([entry, ["secret.key", "synthetic"]]), source, info, ["appinfo.json"]), /Unexpected/);
});

test("package verifier rejects installer hooks and mismatched metadata", () => {
  const entry = ["appinfo.json", fs.readFileSync(path.join(source, "appinfo.json"))];
  assert.throws(() => verifyPackage(fixture([entry], [["postinst", "synthetic"]]), source, info, ["appinfo.json"]), /hook/);
  assert.throws(() => verifyPackage(fixture([entry], undefined, { id: "another.app", version: info.version, app: info.id }), source, info, ["appinfo.json"]));
  assert.throws(() => verifyPackage(fixture([entry], undefined, null), source, info, ["appinfo.json"]), /metadata/);
});

test("archive reader rejects traversal, duplicate files, and links", () => {
  assert.throws(() => readTar(tar([["../outside", "synthetic"]])), /Unsafe/);
  assert.throws(() => readTar(tar([["same", "first"], ["same", "second"]])), /Duplicate/);
  assert.throws(() => readTar(tar([["link", "", 50]])), /entry type/);
});
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createFiles, directoryStat, fileStat, digest } = require("./protected-files.cjs");

function memoryFiles() {
  const entries = new Map(), handles = new Map();
  let nextIdentity = 1, nextHandle = 10, writesUntilFailure = Infinity;
  function failure(code) { const error = new Error(code); error.code = code; return error; }
  function entry(name) { if (!entries.has(name)) throw failure("ENOENT"); return entries.get(name); }
  function make(bytes, mode, directory = false) { return { bytes: Buffer.from(bytes), mode, directory, uid: 0, nlink: 1, ino: nextIdentity++, dev: 1 }; }
  entries.set("/owned", make("", 0o700, true));
  function stat(value) { return { ...value, size: value.bytes.length, isFile: () => !value.directory, isDirectory: () => value.directory, isSymbolicLink: () => Boolean(value.symlink) }; }
  const api = {
    constants: { O_RDONLY: 0, O_NOFOLLOW: 131072 },
    lstatSync: name => stat(entry(name)), realpathSync: name => { entry(name); return name; },
    openSync(name, flags, mode) {
      if (flags === "wx") { if (entries.has(name)) throw failure("EEXIST"); entries.set(name, make("", mode)); }
      const descriptor = nextHandle++; handles.set(descriptor, entry(name)); return descriptor;
    },
    fstatSync: descriptor => stat(handles.get(descriptor)),
    readFileSync: descriptor => Buffer.from(handles.get(descriptor).bytes),
    writeSync(descriptor, bytes, offset, length) {
      if (writesUntilFailure-- <= 0) throw new Error("synthetic interrupted write");
      const count = Math.min(length, 5), target = handles.get(descriptor);
      target.bytes = Buffer.concat([target.bytes, bytes.subarray(offset, offset + count)]); return count;
    },
    fchmodSync: (descriptor, mode) => { handles.get(descriptor).mode = mode; },
    fsyncSync() {}, closeSync: descriptor => { handles.delete(descriptor); },
    linkSync(from, to) { if (entries.has(to)) throw failure("EEXIST"); const value = entry(from); value.nlink++; entries.set(to, value); },
    unlinkSync(name) { const value = entry(name); entries.delete(name); value.nlink--; },
    renameSync(from, to) { const value = entry(from); if (entries.has(to)) entries.get(to).nlink--; entries.set(to, value); entries.delete(from); },
    mkdirSync(name, options) { if (entries.has(name)) throw failure("EEXIST"); entries.set(name, make("", options.mode, true)); }
  };
  return { api, entries, interruptAfter: count => { writesUntilFailure = count; } };
}

test("protected files are atomically created and replaced with exact hashes", () => {
  const memory = memoryFiles(), files = createFiles(memory.api);
  const first = Buffer.from("first record"), second = Buffer.from("complete replacement");
  files.write("/owned/state.json", first);
  assert.deepEqual(files.read("/owned/state.json").bytes, first);
  files.write("/owned/state.json", second, digest(first));
  assert.deepEqual(files.read("/owned/state.json").bytes, second);
  assert.deepEqual([...memory.entries.keys()].sort(), ["/owned", "/owned/state.json"]);
});

test("partial writes preserve the original and remove only the owned temporary file", () => {
  const memory = memoryFiles(), files = createFiles(memory.api), original = Buffer.from("original");
  files.write("/owned/state.json", original);
  memory.interruptAfter(1);
  assert.throws(() => files.write("/owned/state.json", Buffer.from("long replacement content"), digest(original)), /interrupted/);
  assert.deepEqual(files.read("/owned/state.json").bytes, original);
  assert.deepEqual([...memory.entries.keys()].sort(), ["/owned", "/owned/state.json"]);
});

test("changed files cannot be overwritten or removed", () => {
  const memory = memoryFiles(), files = createFiles(memory.api);
  files.write("/owned/state.json", Buffer.from("original"));
  assert.throws(() => files.write("/owned/state.json", Buffer.from("new"), "1".repeat(64)), /changed/);
  assert.throws(() => files.remove("/owned/state.json", "1".repeat(64)), /changed/);
  assert.equal(files.remove("/owned/state.json", digest(Buffer.from("original"))), true);
  assert.equal(files.remove("/owned/state.json", digest(Buffer.from("original"))), false);
});

test("journal saves retain ownership and archive restored records", () => {
  const memory = memoryFiles(), files = createFiles(memory.api), journal = files.journal("/owned/home.json");
  assert.equal(journal.load(), null);
  journal.save({ phase: "prepared" });
  journal.save({ phase: "restored" });
  assert.deepEqual(journal.load(), { phase: "restored" });
  journal.archive({ phase: "restored" });
  assert.equal([...memory.entries.keys()].filter(name => /^\/owned\/home-/.test(name)).length, 1);
});

test("unsafe permissions, ownership, hard links and symlinks are refused", () => {
  const memory = memoryFiles(), files = createFiles(memory.api);
  files.write("/owned/state.json", Buffer.from("value"));
  const value = memory.entries.get("/owned/state.json");
  for (const [field, unsafe] of [["uid", 1000], ["nlink", 2], ["mode", 0o666], ["symlink", true]]) {
    const previous = value[field]; value[field] = unsafe;
    assert.throws(() => files.read("/owned/state.json")); value[field] = previous;
  }
  assert.throws(() => directoryStat({ isDirectory: () => true, isSymbolicLink: () => false, uid: 0, mode: 0o777 }));
  assert.throws(() => fileStat({ isFile: () => true, isSymbolicLink: () => false, uid: 0, nlink: 1, mode: 0o600, size: 999999 }, 10));
});
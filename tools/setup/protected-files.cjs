"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path").posix;
const crypto = require("node:crypto");
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");

function directoryStat(stat, privateMode = false) {
  assert.ok(stat && stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === 0, "Unsafe administrator directory");
  assert.equal(stat.mode & 0o022, 0, "Administrator directory is writable by other users");
  if (privateMode) assert.equal(stat.mode & 0o777, 0o700, "Private directory must have mode 0700");
}

function fileStat(stat, maximum = 262144, mode) {
  assert.ok(stat && stat.isFile() && !stat.isSymbolicLink() && stat.uid === 0 && stat.nlink === 1, "Unsafe administrator file");
  assert.ok(Number.isSafeInteger(stat.size) && stat.size >= 0 && stat.size <= maximum, "Administrator file exceeds the size limit");
  assert.equal(stat.mode & 0o022, 0, "Administrator file is writable by other users");
  if (mode !== undefined) assert.equal(stat.mode & 0o777, mode, "Unexpected private file permissions");
}

function createFiles(fileSystem = fs) {
  function directory(filename, privateMode = false) {
    directoryStat(fileSystem.lstatSync(filename), privateMode);
    assert.equal(fileSystem.realpathSync(filename), filename, "Directory resolves outside its expected path");
  }

  function ensureDirectory(filename) {
    directory(path.dirname(filename));
    try { fileSystem.mkdirSync(filename, { mode: 0o700 }); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    directory(filename, true);
  }

  function read(filename, { absent = false, maximum = 262144, mode } = {}) {
    directory(path.dirname(filename));
    let stat;
    try { stat = fileSystem.lstatSync(filename); }
    catch (error) { if (absent && error.code === "ENOENT") return null; throw error; }
    fileStat(stat, maximum, mode);
    assert.equal(fileSystem.realpathSync(filename), filename, "File resolves outside its expected path");
    const descriptor = fileSystem.openSync(filename, fileSystem.constants.O_RDONLY | fileSystem.constants.O_NOFOLLOW);
    try {
      const opened = fileSystem.fstatSync(descriptor);
      fileStat(opened, maximum, mode);
      assert.equal(opened.dev, stat.dev);
      assert.equal(opened.ino, stat.ino, "File identity changed before reading");
      const bytes = fileSystem.readFileSync(descriptor);
      assert.equal(bytes.length, opened.size, "File size changed during reading");
      const current = fileSystem.lstatSync(filename);
      assert.equal(current.dev, opened.dev);
      assert.equal(current.ino, opened.ino, "File identity changed during reading");
      return { bytes, sha256: digest(bytes), mode: opened.mode & 0o777 };
    } finally { fileSystem.closeSync(descriptor); }
  }

  function syncDirectory(filename) {
    const descriptor = fileSystem.openSync(filename, "r");
    try { fileSystem.fsyncSync(descriptor); }
    finally { fileSystem.closeSync(descriptor); }
  }

  function write(filename, bytes, expectedHash = null, mode = 0o600) {
    assert.ok(Buffer.isBuffer(bytes) && bytes.length <= 262144, "Invalid protected file content");
    assert.ok([0o600, 0o644, 0o700].includes(mode), "Unexpected protected file mode");
    assert.ok(expectedHash === null || /^[a-f0-9]{64}$/.test(expectedHash), "Invalid expected file hash");
    const before = read(filename, { absent: true });
    assert.equal(before && before.sha256, expectedHash, "File changed outside this operation");
    const parent = path.dirname(filename);
    const temporary = path.join(parent, ".ec1tv-" + crypto.randomUUID() + ".tmp");
    let descriptor;
    try {
      descriptor = fileSystem.openSync(temporary, "wx", mode);
      let written = 0;
      while (written < bytes.length) {
        const count = fileSystem.writeSync(descriptor, bytes, written, bytes.length - written);
        assert.ok(count > 0, "Protected write made no progress");
        written += count;
      }
      fileSystem.fchmodSync(descriptor, mode);
      fileSystem.fsyncSync(descriptor);
      fileSystem.closeSync(descriptor);
      descriptor = undefined;
      assert.equal(read(temporary, { mode }).sha256, digest(bytes), "Temporary file verification failed");
      const current = read(filename, { absent: true });
      assert.equal(current && current.sha256, expectedHash, "File changed before replacement");
      if (expectedHash === null) {
        fileSystem.linkSync(temporary, filename);
        fileSystem.unlinkSync(temporary);
      } else fileSystem.renameSync(temporary, filename);
      syncDirectory(parent);
      assert.equal(read(filename, { mode }).sha256, digest(bytes), "Protected file verification failed");
    } finally {
      if (descriptor !== undefined) fileSystem.closeSync(descriptor);
      try { fileSystem.unlinkSync(temporary); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    return digest(bytes);
  }

  function remove(filename, expectedHash) {
    assert.match(expectedHash, /^[a-f0-9]{64}$/);
    const current = read(filename, { absent: true });
    if (!current) return false;
    assert.equal(current.sha256, expectedHash, "Refusing to remove a changed file");
    fileSystem.unlinkSync(filename);
    syncDirectory(path.dirname(filename));
    return true;
  }

  function journal(filename) {
    let expectedHash = null;
    return {
      load() {
        const current = read(filename, { absent: true, mode: 0o600 });
        expectedHash = current ? current.sha256 : null;
        return current ? JSON.parse(current.bytes.toString("utf8")) : null;
      },
      save(value) {
        const bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n");
        expectedHash = write(filename, bytes, expectedHash);
      },
      archive(value) {
        const archive = path.join(path.dirname(filename), "home-" + crypto.randomUUID() + ".json");
        write(archive, Buffer.from(JSON.stringify(value, null, 2) + "\n"));
      }
    };
  }

  return { directory, ensureDirectory, read, write, remove, journal };
}

module.exports = { createFiles, directoryStat, fileStat, digest };
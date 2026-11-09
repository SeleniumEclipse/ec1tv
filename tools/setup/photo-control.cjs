"use strict";

const assert = require("node:assert/strict");
const photos = require("./focus-photo-helper.cjs");
const { digest } = require("./protected-files.cjs");
const DIRECTORY = photos.DIRECTORY;
const HELPER = DIRECTORY + "/focus-photo-helper.cjs";
const CONNECTION = DIRECTORY + "/connection.json";
const RECORD = "/var/lib/ec1tv-setup/photos.json";

function identity(state) {
  return { clientId: state.clientId, account: state.account, folderName: state.folderName, folderId: state.folderId, driveId: state.driveId };
}

function validateRecord(record) {
  assert.ok(record && record.version === 1 && record.kind === "ec1tv-photos", "Unknown photo ownership record");
  assert.ok(["prepared", "connecting", "connected", "disconnected", "needs-recovery"].includes(record.phase), "Unknown photo setup state");
  assert.match(record.helperSha256, /^[a-f0-9]{64}$/);
  return record;
}

function createPhotoControl({ files, fileSystem, helperBytes, invokeHelper }) {
  const store = files.journal(RECORD);
  assert.ok(Buffer.isBuffer(helperBytes) && helperBytes.length > 100 && helperBytes.length <= 131072, "Invalid photo runtime source");

  function record() {
    const saved = store.load();
    return saved ? validateRecord(saved) : null;
  }

  function inspect(saved) {
    if (!fileSystem.existsSync(DIRECTORY)) return { helper: null, connection: null };
    assert.ok(saved, "A photo setup already exists outside ec1tv ownership; it will not be changed");
    files.directory(DIRECTORY, true);
    const names = fileSystem.readdirSync(DIRECTORY);
    assert.ok(names.every(name => ["focus-photo-helper.cjs", "connection.json", "request.lock"].includes(name)), "Unexpected files in the photo directory; keep them for review");
    const helper = files.read(HELPER, { absent: true, mode: 0o600, maximum: 131072 });
    if (helper) assert.equal(helper.sha256, saved.helperSha256, "The photo helper changed outside this setup");
    const connection = files.read(CONNECTION, { absent: true, mode: 0o600, maximum: 65536 });
    if (connection) {
      const state = photos.validateState(JSON.parse(connection.bytes.toString("utf8")));
      assert.deepEqual(identity(state), saved.identity, "The photo login belongs to a different setup");
    }
    return { helper, connection };
  }

  function status() {
    const saved = record();
    if (!saved) return { managed: false, connected: false, existingSetup: fileSystem.existsSync(DIRECTORY) };
    const current = inspect(saved);
    return { managed: true, existingSetup: false, connected: Boolean(current.connection), phase: saved.phase, folder: current.connection ? "Apps/" + saved.identity.folderName : null };
  }

  function prepare() {
    let saved = record();
    if (!saved) {
      assert.equal(fileSystem.existsSync(DIRECTORY), false, "A photo setup already exists; it will not be replaced");
      saved = { version: 1, kind: "ec1tv-photos", phase: "prepared", helperSha256: digest(helperBytes), identity: null };
      store.save(saved);
    }
    inspect(saved);
    assert.equal(saved.helperSha256, digest(helperBytes), "Use the matching setup version before changing this photo runtime");
    if (!fileSystem.existsSync(DIRECTORY)) files.ensureDirectory(DIRECTORY);
    return saved;
  }

  async function connect(state) {
    photos.validateState(state);
    const saved = prepare();
    const current = inspect(saved);
    assert.equal(current.connection, null, "Disconnect the saved photo login before connecting another or renewing it");
    saved.identity = identity(state);
    saved.phase = "connecting";
    store.save(saved);
    try {
      if (!current.helper) files.write(HELPER, helperBytes, null, 0o600);
      const serialized = Buffer.from(JSON.stringify(state) + "\n");
      assert.ok(serialized.length <= 65536, "Photo credentials exceed the storage limit");
      try { files.write(CONNECTION, serialized, null, 0o600); }
      finally { serialized.fill(0); }
      const result = await invokeHelper("verify");
      assert.equal(result.ok, true, "The TV could not verify the photo connection");
      assert.equal(result.folderVerified, true, "The TV did not confirm the app folder");
      saved.phase = "connected";
      store.save(saved);
      return { connected: true, folder: "Apps/" + state.folderName, firstPagePhotoCount: result.photoCount, morePages: result.truncated === true };
    } catch (error) {
      if (error.uncertain === true) {
        saved.phase = "needs-recovery"; store.save(saved);
        throw new Error("The TV did not confirm the photo check. Check photo status, then disconnect before retrying.");
      }
      const latest = inspect(saved);
      if (latest.connection) files.remove(CONNECTION, latest.connection.sha256);
      saved.phase = "disconnected";
      store.save(saved);
      throw new Error("Photo verification failed. The saved TV login was removed; review the registration and sign in again.");
    }
  }

  async function verify() {
    const saved = record();
    assert.ok(saved, "No ec1tv photo connection exists");
    assert.ok(inspect(saved).connection, "Connect your own OneDrive account first");
    const result = await invokeHelper("verify");
    assert.equal(result.ok, true, "Photo verification failed; reconnect if Microsoft access expired or was revoked");
    assert.equal(result.folderVerified, true);
    saved.phase = "connected"; store.save(saved);
    return { connected: true, folder: "Apps/" + saved.identity.folderName, firstPagePhotoCount: result.photoCount, morePages: result.truncated === true };
  }

  function disconnect() {
    const saved = record();
    assert.ok(saved, "No ec1tv-owned photo setup exists");
    const current = inspect(saved);
    if (current.connection) files.remove(CONNECTION, current.connection.sha256);
    saved.phase = "disconnected";
    store.save(saved);
    return { connected: false, tvLoginRemoved: true, cloudPhotosChanged: false, revokeMicrosoftConsentSeparately: true };
  }

  return { status, prepare, connect, verify, disconnect };
}

module.exports = { DIRECTORY, HELPER, CONNECTION, RECORD, identity, createPhotoControl };
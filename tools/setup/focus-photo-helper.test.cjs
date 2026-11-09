"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const photos = require("./focus-photo-helper.cjs");

function connection(overrides = {}) {
  return {
    version: 1, clientId: "11111111-2222-4333-8444-555555555555", account: "family@example.invalid", folderName: "Family TV Photos",
    folderId: "OWN_FOLDER", driveId: "OWN_DRIVE", scope: "Files.ReadWrite.AppFolder offline_access",
    refreshToken: "synthetic-refresh-token", accessToken: "synthetic-access-token", accessTokenExpires: Date.now() + 3600000,
    ...overrides
  };
}
const response = value => ({ status: 200, headers: {}, bytes: Buffer.from(JSON.stringify(value)) });

test("each connection supplies its own account registration and folder", () => {
  assert.doesNotThrow(() => photos.validateState(connection()));
  assert.doesNotThrow(() => photos.validateState(connection({ clientId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", account: "another@example.invalid", folderName: "Another App Folder" })));
  for (const change of [{ clientId: "YOUR_CLIENT_ID" }, { account: "not-an-account" }, { folderName: "../private" }, { folderName: "" }, { scope: "Files.ReadWrite.All" }]) assert.throws(() => photos.validateState(connection(change)));
});

test("refresh uses the connection's client ID and retains its own identity", async () => {
  let saved, observed;
  const state = connection({ accessTokenExpires: 0 });
  const client = photos.createPhotoClient(state, value => { saved = value; }, async (url, options) => {
    if (url === photos.TOKEN_URL) { observed = new URLSearchParams(options.body); return response({ access_token: "synthetic-new-access", refresh_token: "synthetic-new-refresh", scope: photos.SCOPE, expires_in: 3600 }); }
    return response({ value: [] });
  });
  const result = await client.list();
  assert.equal(observed.get("client_id"), state.clientId);
  assert.equal(saved.account, state.account);
  assert.equal(saved.folderName, state.folderName);
  assert.equal(result.folder, "Apps/Family TV Photos");
  assert.ok(!JSON.stringify(result).includes("synthetic-new"));
});

test("connection verification checks the actual app-root folder identity", async () => {
  const state = connection();
  const network = async url => {
    if (url === photos.TOKEN_URL) return response({ access_token: "synthetic-new-access", scope: photos.SCOPE, expires_in: 3600 });
    if (url.includes("special/approot")) return response({ id: state.folderId, name: state.folderName, folder: {}, specialFolder: { name: "appRoot" }, parentReference: { driveId: state.driveId } });
    return response({ value: [] });
  };
  assert.equal((await photos.createPhotoClient(state, () => {}, network).verify()).folderVerified, true);
  const wrong = async url => url.includes("special/approot") ? response({ id: "ANOTHER_FOLDER", name: state.folderName, folder: {}, specialFolder: { name: "approot" }, parentReference: { driveId: state.driveId } }) : network(url);
  await assert.rejects(photos.createPhotoClient(state, () => {}, wrong).verify(), /APP_FOLDER_CHANGED/);
});

test("listing and downloads stay within the connected folder and approved hosts", async () => {
  const state = connection();
  const client = photos.createPhotoClient(state, () => {}, async () => response({ id: "PHOTO", name: "sample.jpg", file: { mimeType: "image/jpeg" }, parentReference: { id: "OTHER_FOLDER" } }));
  await assert.rejects(client.photo("PHOTO"), /PHOTO_OUTSIDE_FOLDER/);
  for (const value of ["http://graph.microsoft.com/file", "https://graph.microsoft.com.attacker.invalid/file", "https://user:pass@graph.microsoft.com/file"]) assert.throws(() => photos.imageUrl(value));
  assert.throws(() => photos.photoPageUrl("https://graph.microsoft.com/v1.0/me/drive/items/OTHER_FOLDER/children", state));
  assert.doesNotThrow(() => photos.photoPageUrl("https://graph.microsoft.com/v1.0/me/drive/items/OWN_FOLDER/children?$top=128", state));
});

test("credentials require exact root-private permissions", () => {
  const stat = { isFile: () => true, isSymbolicLink: () => false, uid: 0, mode: 0o600, nlink: 1, size: 100 };
  assert.doesNotThrow(() => photos.validateCredentialFile(stat));
  for (const value of [{ ...stat, mode: 0o644 }, { ...stat, uid: 1000 }, { ...stat, nlink: 2 }]) assert.throws(() => photos.validateCredentialFile(value));
});
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const auth = require("./onedrive-auth.cjs");
const config = { clientId: "11111111-2222-4333-8444-555555555555", account: "family@example.invalid", folderName: "Family Photos" };
const authorization = () => ({ account: { username: config.account, homeAccountId: "synthetic-account" }, accessToken: "synthetic-access-token", expiresOn: new Date(Date.now() + 3600000), scopes: ["Files.ReadWrite.AppFolder", "offline_access"] });
const folder = () => ({ id: "OWN_FOLDER", name: config.folderName, folder: {}, specialFolder: { name: "appRoot" }, parentReference: { id: "APPS_PARENT", driveId: "OWN_DRIVE" } });
const cache = () => JSON.stringify({ RefreshToken: { one: { credential_type: "RefreshToken", client_id: config.clientId, home_account_id: "synthetic-account", environment: "login.microsoftonline.com", secret: "synthetic-refresh-token" } } });
const response = (value, status = 200) => ({ status, headers: {}, bytes: Buffer.from(JSON.stringify(value)) });
async function network(url) {
  if (url.includes("special/approot")) return response(folder());
  if (url.includes("root/children")) return response({}, 403);
  return response({ value: [] });
}

test("configuration and authorization require the requested account and limited scope", () => {
  assert.deepEqual(auth.validateConfig(config), config);
  assert.doesNotThrow(() => auth.validateAuthorization(config, authorization()));
  const wrong = authorization(); wrong.account.username = "other@example.invalid";
  assert.throws(() => auth.validateAuthorization(config, wrong), /match/);
  const broad = authorization(); broad.scopes = ["Files.ReadWrite.All"];
  assert.throws(() => auth.validateAuthorization(config, broad));
  assert.throws(() => auth.validateConfig({ ...config, clientSecret: "synthetic" }));
});

test("only the selected registration and account refresh token is transferred", () => {
  const state = auth.connectionState(config, authorization(), cache(), folder());
  assert.equal(state.clientId, config.clientId);
  assert.equal(state.account, config.account);
  assert.equal(state.folderName, config.folderName);
  assert.equal(state.refreshToken, "synthetic-refresh-token");
  const duplicate = JSON.parse(cache()); duplicate.RefreshToken.two = duplicate.RefreshToken.one;
  assert.throws(() => auth.connectionState(config, authorization(), JSON.stringify(duplicate), folder()), /single/);
  assert.throws(() => auth.connectionState(config, authorization(), cache(), { ...folder(), specialFolder: { name: "pictures" } }));
  assert.equal(auth.connectionState(config, authorization(), cache(), { ...folder(), name: "Family Photos 1" }).folderName, "Family Photos 1");
});

test("bounded folder checks refuse unrelated root items and cross-folder contents", async () => {
  const proof = await auth.checkFolderBoundary(config, authorization(), network);
  assert.equal(proof.folder.id, "OWN_FOLDER");
  const unrelated = async url => url.includes("root/children") ? response({ value: [{ id: "UNRELATED" }] }) : network(url);
  await assert.rejects(auth.checkFolderBoundary(config, authorization(), unrelated), /unrelated/);
  const outside = async url => url.includes("items/") ? response({ value: [{ id: "PHOTO", parentReference: { id: "OTHER" } }] }) : network(url);
  await assert.rejects(auth.checkFolderBoundary(config, authorization(), outside), /outside/);
});

test("ancestor-only root metadata is accepted without reading the whole library", async () => {
  const calls = [];
  const limited = async url => { calls.push(url); return url.includes("root/children") ? response({ value: [{ id: "APPS_PARENT" }] }) : network(url); };
  await auth.checkFolderBoundary(config, authorization(), limited);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(url => !url.includes("/content")));
});

test("guided sign-in requires folder confirmation and clears authentication cache", async () => {
  let cleared = false, presented = false, transferred;
  const client = {
    async acquireTokenByDeviceCode(request) { request.deviceCodeCallback({ verificationUri: "https://microsoft.com/devicelogin", userCode: "TEST-CODE" }); return authorization(); },
    getTokenCache: () => ({ serialize: cache }), async clearCache() { cleared = true; }
  };
  const result = await auth.signIn(config, {
    showCode: () => { presented = true; }, confirmFolder: async value => value.folder === "Apps/Family Photos",
    connect: async value => { transferred = value; return { connected: true }; }
  }, { createClient: () => client, network });
  assert.deepEqual(result, { connected: true });
  assert.equal(presented, true); assert.equal(cleared, true);
  assert.equal(transferred.refreshToken, ""); assert.equal(transferred.accessToken, "");
});

test("declined folder confirmation never transfers authentication to the TV", async () => {
  let cleared = false;
  const client = { acquireTokenByDeviceCode: async () => authorization(), getTokenCache: () => ({ serialize: cache }), clearCache: async () => { cleared = true; } };
  await assert.rejects(auth.signIn(config, { showCode() {}, confirmFolder: async () => false, connect: async () => assert.fail("Unexpected token transfer") }, { createClient: () => client, network }), /cancelled/);
  assert.equal(cleared, true);
});
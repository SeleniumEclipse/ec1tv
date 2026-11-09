"use strict";

const assert = require("node:assert/strict");
const photos = require("./focus-photo-helper.cjs");
const AUTHORITY = "https://login.microsoftonline.com/consumers";
const SCOPES = ["https://graph.microsoft.com/Files.ReadWrite.AppFolder", "offline_access"];

function validateConfig(config) {
  assert.ok(config && typeof config === "object" && !Array.isArray(config), "Enter your own OneDrive setup information");
  assert.match(config.clientId || "", /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
  assert.ok(typeof config.account === "string" && config.account.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.account), "Enter your personal Microsoft account email");
  assert.ok(typeof config.folderName === "string" && config.folderName.length > 0 && config.folderName.length <= 120 &&
    !/[\x00-\x1f\x7f/\\]/.test(config.folderName) && config.folderName.trim() === config.folderName, "Enter the app-registration display name");
  assert.ok(Object.keys(config).every(key => ["clientId", "account", "folderName"].includes(key)), "Do not place tokens or client secrets in configuration");
  return { clientId: config.clientId.toLowerCase(), account: config.account.toLowerCase(), folderName: config.folderName };
}

function validateAuthorization(config, result) {
  if (!result || !result.account || typeof result.account.username !== "string" ||
      result.account.username.toLowerCase() !== config.account || !result.account.homeAccountId ||
      typeof result.accessToken !== "string" || result.accessToken.length < 8 || result.accessToken.length > 32768 ||
      !(result.expiresOn instanceof Date) || result.expiresOn.getTime() <= Date.now() || !Array.isArray(result.scopes)) {
    throw new Error("Microsoft sign-in did not match the requested account or returned an expired connection.");
  }
  photos.limitedScopes(result.scopes.join(" "));
  return result;
}

function validateFolder(config, folder) {
  if (!folder || typeof folder.name !== "string" || folder.name.length < 1 || folder.name.length > 120 ||
      /[\x00-\x1f\x7f/\\]/.test(folder.name) || folder.name.trim() !== folder.name ||
      !folder.folder || folder.remoteItem || !folder.specialFolder ||
      !["approot", "appRoot"].includes(folder.specialFolder.name) || !folder.parentReference) {
    throw new Error("Microsoft did not return a valid app-specific folder. Check the registration and permissions.");
  }
  for (const identifier of [folder.id, folder.parentReference.id, folder.parentReference.driveId]) photos.itemId(identifier);
  return folder;
}

function connectionState(config, authorization, serializedCache, folder) {
  validateAuthorization(config, authorization);
  validateFolder(config, folder);
  assert.ok(typeof serializedCache === "string" && serializedCache.length <= 1048576, "Unexpected Microsoft authentication cache");
  const cache = JSON.parse(serializedCache);
  const tokens = Object.values(cache.RefreshToken || {}).filter(value => value && value.credential_type === "RefreshToken" &&
    String(value.client_id).toLowerCase() === config.clientId && value.home_account_id === authorization.account.homeAccountId &&
    ["login.windows.net", "login.microsoftonline.com", "login.live.com"].includes(value.environment));
  assert.equal(tokens.length, 1, "A single folder-limited refresh token is required");
  return photos.validateState({
    version: 1, clientId: config.clientId, account: config.account, folderName: folder.name,
    folderId: folder.id, driveId: folder.parentReference.driveId,
    refreshToken: tokens[0].secret, accessToken: authorization.accessToken,
    accessTokenExpires: authorization.expiresOn.getTime(), scope: authorization.scopes.join(" "),
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });
}

function parseResponse(response) {
  if (response.status < 200 || response.status >= 300) throw new Error("Microsoft refused the folder check. Review the app-folder permission and sign in again.");
  try { return JSON.parse(response.bytes.toString("utf8")); }
  catch { throw new Error("Microsoft returned an unreadable folder response."); }
}

async function checkFolderBoundary(config, authorization, network = photos.requestBytes) {
  const options = { token: authorization.accessToken, limit: 262144 };
  const folder = validateFolder(config, parseResponse(await network("https://graph.microsoft.com/v1.0/me/drive/special/approot?$select=id,name,folder,specialFolder,parentReference", options)));
  const listing = parseResponse(await network("https://graph.microsoft.com/v1.0/me/drive/items/" + folder.id + "/children?$select=id,parentReference&$top=1", options));
  assert.ok(Array.isArray(listing.value) && listing.value.length <= 1, "Unexpected app-folder listing");
  for (const item of listing.value) assert.equal(item.parentReference && item.parentReference.id, folder.id, "A listed item is outside the app folder");
  const rootResponse = await network("https://graph.microsoft.com/v1.0/me/drive/root/children?$select=id&$top=2", options);
  if (rootResponse.status !== 403) {
    const root = parseResponse(rootResponse);
    assert.ok(Array.isArray(root.value) && root.value.length <= 2 && !root["@odata.nextLink"], "Unexpected access outside the app folder");
    assert.ok(root.value.every(item => item && [folder.id, folder.parentReference.id].includes(item.id)), "The token can list an unrelated root item; review permissions");
  }
  return { folder, photoFolderHasItems: listing.value.length > 0 };
}

function createAuthClient(config) {
  const { PublicClientApplication } = require("@azure/msal-node");
  return new PublicClientApplication({
    auth: { clientId: config.clientId, authority: AUTHORITY },
    system: { loggerOptions: { loggerCallback() {}, piiLoggingEnabled: false } }
  });
}

async function signIn(configuration, callbacks, dependencies = {}) {
  const config = validateConfig(configuration);
  assert.equal(typeof callbacks.showCode, "function");
  assert.equal(typeof callbacks.confirmFolder, "function");
  assert.equal(typeof callbacks.connect, "function");
  const client = (dependencies.createClient || createAuthClient)(config);
  let state;
  try {
    const authorization = validateAuthorization(config, await client.acquireTokenByDeviceCode({
      scopes: SCOPES,
      deviceCodeCallback(response) {
        const address = new URL(response.verificationUri);
        assert.ok(address.protocol === "https:" && ["microsoft.com", "www.microsoft.com", "login.microsoftonline.com"].includes(address.hostname) &&
          !address.username && !address.password && !address.port, "Unexpected Microsoft verification page");
        assert.ok(typeof response.userCode === "string" && /^[A-Z0-9-]{4,32}$/i.test(response.userCode), "Invalid Microsoft device code");
        callbacks.showCode({ verificationUri: address.href, userCode: response.userCode });
      }
    }));
    const proof = await checkFolderBoundary(config, authorization, dependencies.network);
    if (!await callbacks.confirmFolder({ account: config.account, folder: "Apps/" + proof.folder.name, hasItems: proof.photoFolderHasItems })) {
      throw new Error("Photo connection cancelled before saving anything on the TV.");
    }
    state = connectionState(config, authorization, client.getTokenCache().serialize(), proof.folder);
    return await callbacks.connect(state);
  } finally {
    if (state) { state.accessToken = ""; state.refreshToken = ""; }
    if (typeof client.clearCache === "function") await client.clearCache();
  }
}

module.exports = { AUTHORITY, SCOPES, validateConfig, validateAuthorization, validateFolder, connectionState, checkFolderBoundary, createAuthClient, signIn };
"use strict";

const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DIRECTORY = "/var/lib/focus-stage-photos";
const GRAPH = "https://graph.microsoft.com";
const TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const SCOPE = "Files.ReadWrite.AppFolder";
const MAX_JSON = 262144;
const MAX_PHOTO = 2097152;
const MAX_ITEMS = 128;
const MAX_CURSOR = 8192;

function refused(code) {
  const error = new Error(code);
  error.safeCode = code;
  return error;
}

function itemId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9!_-]{1,200}$/.test(value)) throw refused("INVALID_PHOTO_ID");
  return value;
}

function tokenValue(value) {
  return typeof value === "string" && value.length >= 8 && value.length <= 32768 && !/[\s\x00-\x1f\x7f]/.test(value);
}

function limitedScopes(value) {
  if (typeof value !== "string" || value.length > 1024) throw refused("UNEXPECTED_PERMISSION");
  const scopes = value.trim().split(/\s+/).map(scope => scope.replace(/^https:\/\/graph\.microsoft\.com\//, ""));
  if (!scopes.includes(SCOPE) || scopes.some(scope => ![SCOPE, "openid", "profile", "email", "offline_access"].includes(scope))) {
    throw refused("UNEXPECTED_PERMISSION");
  }
  return scopes;
}

function validateState(state) {
  if (!state || state.version !== 1 || typeof state.clientId !== "string" ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(state.clientId) ||
      typeof state.account !== "string" || state.account.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.account) ||
      typeof state.folderName !== "string" || state.folderName.length < 1 || state.folderName.length > 120 ||
      /[\x00-\x1f\x7f/\\]/.test(state.folderName) || state.folderName.trim() !== state.folderName ||
      !tokenValue(state.refreshToken) || typeof state.driveId !== "string" || state.driveId.length < 1 || state.driveId.length > 200) {
    throw refused("INVALID_CONNECTION");
  }
  itemId(state.folderId);
  limitedScopes(state.scope);
  if (state.accessToken && (!tokenValue(state.accessToken) || !Number.isFinite(state.accessTokenExpires))) {
    throw refused("INVALID_CONNECTION");
  }
  return state;
}

function validateDirectory(stat) {
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 511) !== 448) {
    throw refused("UNSAFE_CONNECTION_DIRECTORY");
  }
}

function validateCredentialFile(stat) {
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.uid !== 0 ||
      (stat.mode & 511) !== 384 || stat.nlink !== 1 || stat.size < 1 || stat.size > 65536) {
    throw refused("UNSAFE_CONNECTION_FILE");
  }
}

function imageUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw refused("INVALID_IMAGE_URL"); }
  const exact = ["api.onedrive.com", "my.microsoftpersonalcontent.com", "graph.microsoft.com"];
  const suffixes = [".1drv.com", ".onedrive.com", ".sharepoint.com", ".storage.live.com", ".livefilestore.com"];
  const allowed = exact.includes(url.hostname) || suffixes.some(suffix => url.hostname.endsWith(suffix)) ||
    /^[a-z0-9-]+-mediap\.svc\.ms$/.test(url.hostname);
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash || url.href.length > 32768 || !allowed) {
    throw refused("UNAPPROVED_IMAGE_HOST");
  }
  return url.href;
}

function graphUrl(path) {
  if (typeof path !== "string" || !path.startsWith("/me/drive/")) throw refused("INVALID_GRAPH_PATH");
  const url = new URL("/v1.0" + path, GRAPH);
  if (url.origin !== GRAPH || !url.pathname.startsWith("/v1.0/me/drive/") || url.hash) throw refused("INVALID_GRAPH_PATH");
  return url.href;
}

function photoPageUrl(value, state) {
  let url, pathname;
  try {
    if (typeof value !== "string" || value.length > MAX_CURSOR || /[\x00-\x20\x7f]/.test(value)) throw new Error();
    url = new URL(value);
    pathname = decodeURIComponent(url.pathname);
  } catch { throw refused("INVALID_PHOTO_CURSOR"); }
  const paths = ["/v1.0/me/drive/items/" + state.folderId + "/children",
    "/v1.0/drives/" + state.driveId + "/items/" + state.folderId + "/children"];
  const parameters = ["$select", "$top", "$orderby", "$skiptoken", "$skip", "$count"];
  if (url.origin !== GRAPH || url.username || url.password || url.hash || !paths.includes(pathname) ||
      Array.from(url.searchParams.keys()).some(key => !parameters.includes(key.toLowerCase()))) {
    throw refused("INVALID_PHOTO_CURSOR");
  }
  const top = url.searchParams.get("$top");
  if (top !== null && (!/^\d+$/.test(top) || Number(top) < 1 || Number(top) > MAX_ITEMS)) throw refused("INVALID_PHOTO_CURSOR");
  return url.href;
}

function decodePhotoCursor(cursor, state) {
  if (typeof cursor !== "string" || cursor.length < 1 || cursor.length > MAX_CURSOR || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw refused("INVALID_PHOTO_CURSOR");
  }
  const bytes = Buffer.from(cursor, "base64url");
  if (bytes.toString("base64url") !== cursor) throw refused("INVALID_PHOTO_CURSOR");
  return photoPageUrl(bytes.toString("utf8"), state);
}

function requestBytes(address, options, requester = https.request) {
  options = options || {};
  const url = new URL(address);
  const method = options.method || "GET";
  const limit = options.limit || MAX_JSON;
  if (url.href !== TOKEN_URL && url.origin !== GRAPH) imageUrl(address);
  if (url.protocol !== "https:" || url.username || url.password || url.hash ||
      !["GET", "POST"].includes(method) || (method === "POST" && url.href !== TOKEN_URL) ||
      (options.token && url.origin !== GRAPH) || !Number.isInteger(limit) || limit < 1 || limit > MAX_PHOTO) {
    throw refused("UNAPPROVED_NETWORK_REQUEST");
  }
  const headers = { Accept: "application/json", Connection: "close" };
  if (options.token) headers.Authorization = "Bearer " + options.token;
  if (method === "POST") {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    headers["Content-Length"] = Buffer.byteLength(options.body);
  }
  return new Promise((resolve, reject) => {
    let done = false, request, timer;
    function finish(error, value) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) { if (request) request.destroy(); reject(error); }
      else resolve(value);
    }
    try {
      request = requester(url, { method, headers, agent: false, rejectUnauthorized: true }, response => {
        response.on("error", () => finish(refused("NETWORK_FAILED")));
        const status = response.statusCode;
        if (status >= 300 && status < 400) {
          response.destroy();
          finish(null, { status, headers: response.headers, bytes: Buffer.alloc(0) });
          return;
        }
        const declared = response.headers["content-length"];
        if (declared !== undefined && (!/^\d+$/.test(String(declared)) || Number(declared) > limit)) {
          response.destroy(); finish(refused("RESPONSE_TOO_LARGE")); return;
        }
        const chunks = [];
        let total = 0;
        response.on("data", chunk => {
          total += chunk.length;
          if (total > limit) { response.destroy(); finish(refused("RESPONSE_TOO_LARGE")); return; }
          chunks.push(chunk);
        });
        response.on("end", () => finish(null, { status, headers: response.headers, bytes: Buffer.concat(chunks, total) }));
      });
      request.on("error", () => finish(refused("NETWORK_FAILED")));
      timer = setTimeout(() => finish(refused("NETWORK_TIMEOUT")), 8000);
      if (options.body) request.write(options.body);
      request.end();
    } catch { finish(refused("NETWORK_FAILED")); }
  });
}

function connectionStore() {
  if (typeof process.getuid !== "function" || process.getuid() !== 0 || __dirname !== DIRECTORY) {
    throw refused("UNEXPECTED_HELPER_IDENTITY");
  }
  validateDirectory(fs.lstatSync(DIRECTORY));
  if (fs.realpathSync(DIRECTORY) !== DIRECTORY) throw refused("UNSAFE_CONNECTION_DIRECTORY");
  const filename = path.join(DIRECTORY, "connection.json");
  return {
    read() {
      let stat;
      try { stat = fs.lstatSync(filename); } catch (error) {
        if (error.code === "ENOENT") return null;
        throw refused("CONNECTION_READ_FAILED");
      }
      validateCredentialFile(stat);
      const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const buffer = Buffer.alloc(65537);
      try {
        const opened = fs.fstatSync(descriptor);
        validateCredentialFile(opened);
        if (opened.ino !== stat.ino || opened.dev !== stat.dev || fs.realpathSync("/proc/self/fd/" + descriptor) !== filename) {
          throw refused("UNSAFE_CONNECTION_FILE");
        }
        const count = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
        if (count !== opened.size || count > 65536) throw refused("CONNECTION_READ_FAILED");
        return validateState(JSON.parse(buffer.subarray(0, count).toString("utf8")));
      } finally {
        buffer.fill(0);
        fs.closeSync(descriptor);
      }
    },
    write(state) {
      validateState(state);
      validateDirectory(fs.lstatSync(DIRECTORY));
      const temporary = filename + "." + process.pid + "." + crypto.randomBytes(6).toString("hex");
      const serialized = JSON.stringify(state);
      if (Buffer.byteLength(serialized) > 65536) throw refused("CONNECTION_TOO_LARGE");
      try {
        fs.writeFileSync(temporary, serialized + "\n", { flag: "wx", mode: 0o600 });
        validateCredentialFile(fs.lstatSync(temporary));
        fs.renameSync(temporary, filename);
      } finally {
        try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw refused("CONNECTION_WRITE_FAILED"); }
      }
    }
  };
}

function parseJson(response) {
  if (response.status < 200 || response.status >= 300) throw refused("MICROSOFT_HTTP_" + response.status);
  try { return JSON.parse(response.bytes.toString("utf8")); } catch { throw refused("INVALID_MICROSOFT_RESPONSE"); }
}

function previewSize(width, height) {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 &&
    width <= 1920 && height <= 1080 && width * height <= 2073600;
}

function ownedImage(item, folderId) {
  return Boolean(item && typeof item.id === "string" && /^[A-Za-z0-9!_-]{1,200}$/.test(item.id) &&
    !item.remoteItem && !item.folder && item.parentReference && item.parentReference.id === folderId &&
    item.file && typeof item.file.mimeType === "string" && /^image\/(jpeg|png|webp|heic|heif)$/i.test(item.file.mimeType) &&
    typeof item.name === "string" && item.name.length <= 240);
}

function createPhotoClient(initialState, saveState, network = requestBytes, now = Date.now) {
  let state = validateState(initialState);
  async function accessToken(force) {
    if (!force && tokenValue(state.accessToken) && state.accessTokenExpires > now() + 60000) return state.accessToken;
    const body = new URLSearchParams({
      client_id: state.clientId, grant_type: "refresh_token", refresh_token: state.refreshToken,
      scope: "https://graph.microsoft.com/" + SCOPE + " offline_access"
    }).toString();
    const result = await network(TOKEN_URL, { method: "POST", body, limit: MAX_JSON });
    if (result.status !== 200) throw refused("SIGN_IN_REQUIRED");
    const refreshed = parseJson(result);
    const scopes = limitedScopes(refreshed.scope);
    if (!tokenValue(refreshed.access_token) || !Number.isInteger(refreshed.expires_in) ||
        refreshed.expires_in < 60 || refreshed.expires_in > 86400 ||
        (refreshed.refresh_token && !tokenValue(refreshed.refresh_token))) throw refused("INVALID_TOKEN_RESPONSE");
    state = validateState({
      version: 1, clientId: state.clientId, account: state.account, folderName: state.folderName, folderId: state.folderId, driveId: state.driveId,
      refreshToken: refreshed.refresh_token || state.refreshToken,
      accessToken: refreshed.access_token, accessTokenExpires: now() + refreshed.expires_in * 1000,
      scope: scopes.join(" "), createdAt: state.createdAt, updatedAt: new Date(now()).toISOString()
    });
    saveState(state);
    return state.accessToken;
  }
  async function graphRequest(address) {
    let response = await network(address, { token: await accessToken(false), limit: MAX_JSON });
    if (response.status === 401) response = await network(address, { token: await accessToken(true), limit: MAX_JSON });
    return parseJson(response);
  }
  async function graph(pathname) { return graphRequest(graphUrl(pathname)); }
  async function download(address, token) {
    let current = address;
    for (let redirects = 0; redirects < 4; redirects++) {
      const response = await network(current, { token: redirects === 0 ? token : undefined, limit: MAX_PHOTO });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        current = imageUrl(response.headers.location);
        continue;
      }
      if (response.status !== 200) throw refused("PHOTO_HTTP_" + response.status);
      const mime = String(response.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      if (!["image/jpeg", "image/png", "image/webp", "application/octet-stream"].includes(mime) ||
          !response.bytes.length || response.bytes.length > MAX_PHOTO) throw refused("INVALID_PHOTO_RESPONSE");
      return response.bytes;
    }
    throw refused("PHOTO_REDIRECT_LIMIT");
  }
  return {
    status() { return { ok: true, connected: true, folder: "Apps/" + state.folderName, maxItems: MAX_ITEMS }; },
    async verify() {
      await accessToken(true);
      const folder = await graph("/me/drive/special/approot?$select=id,name,folder,specialFolder,parentReference");
      if (folder.id !== state.folderId || folder.name !== state.folderName || !folder.folder || !folder.specialFolder ||
          !["approot", "appRoot"].includes(folder.specialFolder.name) ||
          !folder.parentReference || folder.parentReference.driveId !== state.driveId) throw refused("APP_FOLDER_CHANGED");
      const catalog = await this.list();
      return { ok: true, connected: true, refreshed: true, folderVerified: true, photoCount: catalog.items.length, truncated: catalog.truncated };
    },
    async list(cursor) {
      const address = cursor === undefined ? graphUrl("/me/drive/items/" + state.folderId +
        "/children?$select=id,name,file,folder,remoteItem,image,size,parentReference&$top=" + MAX_ITEMS + "&$orderby=name") : decodePhotoCursor(cursor, state);
      const response = await graphRequest(address);
      if (!Array.isArray(response.value) || response.value.length > MAX_ITEMS) throw refused("INVALID_PHOTO_LIST");
      const items = response.value.filter(item => ownedImage(item, state.folderId)).map(item => ({
        id: item.id, name: item.name.replace(/[\x00-\x1f\x7f]/g, " "),
        width: item.image && Number.isInteger(item.image.width) ? item.image.width : null,
        height: item.image && Number.isInteger(item.image.height) ? item.image.height : null
      }));
      const nextCursor = response["@odata.nextLink"] ? Buffer.from(photoPageUrl(response["@odata.nextLink"], state)).toString("base64url") : null;
      if (nextCursor && nextCursor.length > MAX_CURSOR) throw refused("INVALID_PHOTO_CURSOR");
      return { ok: true, connected: true, folder: "Apps/" + state.folderName, items, nextCursor, truncated: Boolean(nextCursor) };
    },
    async photo(identifier) {
      const id = itemId(identifier);
      const item = await graph("/me/drive/items/" + id + "?$select=id,name,parentReference,file,folder,remoteItem,image,size");
      if (item.id !== id || !ownedImage(item, state.folderId)) throw refused("PHOTO_OUTSIDE_FOLDER");
      let bytes;
      if (item.image && previewSize(item.image.width, item.image.height) && Number.isInteger(item.size) &&
          item.size > 0 && item.size <= MAX_PHOTO && /^image\/(jpeg|png|webp)$/i.test(item.file.mimeType)) {
        bytes = await download(graphUrl("/me/drive/items/" + id + "/content"), await accessToken(false));
      } else {
        let thumbnail;
        for (const size of ["c1920x1080", "c1280x720", "large"]) {
          const previews = await graph("/me/drive/items/" + id + "/thumbnails?select=" + size);
          if (!Array.isArray(previews.value) || previews.value.length > 5) throw refused("INVALID_PHOTO_PREVIEW");
          const candidate = previews.value.map(set => set && set[size]).find(value => value && typeof value.url === "string");
          if (!candidate) continue;
          if (previewSize(candidate.width, candidate.height)) { thumbnail = candidate; break; }
        }
        if (!thumbnail) throw refused("PHOTO_PREVIEW_TOO_LARGE");
        bytes = await download(imageUrl(thumbnail.url));
      }
      return { ok: true, id, byteLength: bytes.length, data: bytes.toString("base64") };
    }
  };
}

module.exports = {
  DIRECTORY, GRAPH, TOKEN_URL, SCOPE, MAX_JSON, MAX_PHOTO, MAX_ITEMS, MAX_CURSOR,
  refused, itemId, limitedScopes, validateState, validateDirectory, validateCredentialFile,
  imageUrl, graphUrl, photoPageUrl, decodePhotoCursor, requestBytes, connectionStore, previewSize, ownedImage, createPhotoClient
};

if (require.main === module) {
  let finished = false;
  const timer = setTimeout(() => output({ ok: false, error: "PHOTO_TIMEOUT" }), 22000);
  function output(result) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    process.stdout.write(JSON.stringify(result) + "\n", () => process.exit(0));
  }
  (async () => {
    const operation = process.argv[2];
    const validLength = operation === "photo" ? process.argv.length === 4 :
      operation === "list" ? [3, 4].includes(process.argv.length) : process.argv.length === 3;
    if (!["status", "list", "photo", "verify"].includes(operation) || !validLength) {
      throw refused("INVALID_OPERATION");
    }
    const store = connectionStore();
    const state = store.read();
    if (!state) return { ok: true, connected: false, items: [] };
    const client = createPhotoClient(state, value => store.write(value));
    return operation === "status" ? client.status() : operation === "list" ? client.list(process.argv[3]) : operation === "verify" ? client.verify() : client.photo(process.argv[3]);
  })().then(output).catch(error => output({ ok: false, error: error.safeCode || "PHOTO_REQUEST_FAILED" }));
}
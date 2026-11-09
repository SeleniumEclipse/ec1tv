(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FocusWebOS = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  var OWN_ID = "io.focusstage.home";
  var MAX_ICON_BYTES = 1048576;
  var MAX_PHOTO_BYTES = 2097152;
  var MAX_PHOTO_PIXELS = 2073600;
  var MAX_PHOTO_ITEMS = 128;
  var MAX_PHOTO_CURSOR = 8192;
  var MAX_PHOTO_CATALOG_BYTES = 2097152;
  var MAX_STDOUT = 4194304;
  var ROOTS = [
    "/media/cryptofs/apps/usr/palm/applications/",
    "/media/developer/apps/usr/palm/applications/",
    "/media/system/apps/usr/palm/applications/",
    "/usr/palm/applications/"
  ];
  var SYSTEM_ICON_ROOTS = new Map([
    ["com.webos.app.browser", "/mnt/otncabi/usr/palm/applications/com.webos.app.browser/"],
    ["com.webos.app.discovery", "/mnt/otncabi/usr/palm/applications/com.webos.app.discovery/"]
  ]);
  var COMMANDS = Object.freeze({
    apps: "luna-send -n 1 luna://com.webos.applicationManager/listLaunchPoints '{}'",
    inputs: "luna-send -n 1 luna://com.webos.service.eim/getAllInputStatus '{}'"
  });
  var TARGETS = Object.freeze({
    settings: "com.palm.app.settings",
    originalHome: "com.webos.app.home"
  });
  var BLOCKED = new Set([
    OWN_ID, "com.webos.app.home", "com.webos.app.home2021",
    "com.webos.app.lghome", "com.webos.app.launcher"
  ]);
  var HELPER = /(?:^|\.)(?:screensaver|screen-saver|boot|oobe|eula|overlay|toast|notification|pincode|inputmask|systemui)(?:\.|$)/i;

  function failure(message, code) {
    var error = new Error(message);
    error.code = code || "SERVICE_ERROR";
    return error;
  }
  function validId(id) {
    return typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(id) && !id.includes("..");
  }
  function flag(value) { return value === true || value === 1 || value === "true" || value === "1"; }
  function label(value, fallback) {
    return typeof value === "string" && value.trim()
      ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 240) : fallback;
  }
  function safeParams(value) {
    try {
      var source = typeof value === "string" ? value : JSON.stringify(value);
      if (!source || source.length > 8192) return undefined;
      var result = JSON.parse(source);
      return result && typeof result === "object" && !Array.isArray(result) ? result : undefined;
    } catch (_) { return undefined; }
  }
  function color(value) {
    return typeof value === "string" && /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : null;
  }
  function surfaceColor(value, allowBright) {
    var safe = color(value);
    if (!safe) return "#18242c";
    if (allowBright) return safe;
    var rgb = [1, 3, 5].map(function (offset) { return parseInt(safe.slice(offset, offset + 2), 16); });
    if ((rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722) > 160) return "#18242c";
    var scale = Math.min(1, 104 / Math.max.apply(null, rgb));
    return "#" + rgb.map(function (channel) {
      return Math.round(channel * scale).toString(16).padStart(2, "0");
    }).join("");
  }
  function guardIconPath(appId, path) {
    if (!validId(appId) || typeof path !== "string" || path.length > 768 ||
        /[\u0000-\u001f\u007f\\:%?#]/.test(path) || path.includes("//")) {
      throw failure("Native artwork path refused.", "ICON_PATH");
    }
    var root = ROOTS.find(function (candidate) { return path.startsWith(candidate + appId + "/"); });
    var systemRoot = SYSTEM_ICON_ROOTS.get(appId);
    if (!root && systemRoot && path.startsWith(systemRoot)) root = systemRoot;
    if (!root || path.split("/").some(function (part) { return part === "." || part === ".."; }) ||
        !/^[A-Za-z0-9_./ @()+,'-]+$/.test(path) || !/\.(png|jpe?g|webp)$/i.test(path)) {
      throw failure("Native artwork must be a raster file inside this app's approved directory.", "ICON_PATH");
    }
    return path;
  }
  function quoteShell(value) { return "'" + value.replace(/'/g, "'\"'\"'") + "'"; }
  function buildIconReadCommand(appId, path) {
    var safe = guardIconPath(appId, path);
    // Pin the opened file and recheck its resolved identity before reading any bytes.
    // This closes a rename/symlink race between the path check and the actual read.
    return "p=" + quoteShell(safe) + "; " +
      "if [ ! -f \"$p\" ] || [ ! -r \"$p\" ] || [ -L \"$p\" ] || [ \"$(readlink -f \"$p\")\" != \"$p\" ]; then " +
      "printf '%s\\n' 'FOCUS_ICON_REFUSED' >&2; exit 1; fi; " +
      "exec 3< \"$p\" || exit 1; f=\"/proc/$$/fd/3\"; " +
      "if [ ! -f \"$f\" ] || [ \"$(readlink -f \"$f\")\" != \"$p\" ]; then " +
      "printf '%s\\n' 'FOCUS_ICON_REFUSED' >&2; exit 1; fi; " +
      "n=$(stat -L -c %s \"$f\") || exit 1; " +
      "if [ \"$n\" -lt 1 ] || [ \"$n\" -gt " + MAX_ICON_BYTES + " ]; then " +
      "printf '%s\\n' 'FOCUS_ICON_SIZE_REFUSED' >&2; exit 1; fi; " +
      "printf 'FOCUS_ICON_V1:%s\\n' \"$n\"; head -c " + (MAX_ICON_BYTES + 1) + " \"$f\" | base64";
  }
  function iconCandidates(row) {
    var candidates = [];
    ["extraLargeIcon", "largeIcon", "icon"].forEach(function (field) {
      try {
        var path = guardIconPath(row.id, row[field]);
        if (!candidates.includes(path)) candidates.push(path);
      } catch (_) { /* A refused path may fall through to another native size. */ }
    });
    return candidates;
  }
  function assertResponse(response, key) {
    if (!response || response.returnValue !== true || !Array.isArray(response[key])) {
      throw failure("Invalid " + key + " response; no fixture substitution is permitted.", "INVENTORY_RESPONSE");
    }
  }
  function normalizeInventory(appResponse, inputResponse) {
    assertResponse(appResponse, "launchPoints");
    assertResponse(inputResponse, "devices");
    var appRows = new Map();
    appResponse.launchPoints.slice().sort(function (a, b) {
      return String(a && a.launchPointId || "").localeCompare(String(b && b.launchPointId || ""));
    }).forEach(function (row) {
      if (!row || !validId(row.id) || flag(row.hidden) || BLOCKED.has(row.id) ||
          (row.lptype && row.lptype !== "default") || (flag(row.systemApp) && HELPER.test(row.id))) return;
      if (!appRows.has(row.id)) appRows.set(row.id, row);
    });
    var apps = [];
    appRows.forEach(function (row) {
      if (/^com\.webos\.app\.hdmi\d+$/.test(row.id)) return;
      apps.push({
        id: "app:" + row.id, appId: row.id, kind: "app",
        title: label(row.title, row.id), params: safeParams(row.params),
        ownerColor: color(row.iconColor) || color(row.bgColor),
        iconCandidates: iconCandidates(row), detail: "App"
      });
    });
    var titleComparer = new Intl.Collator("en", { sensitivity: "base", numeric: true });
    apps.sort(function (first, second) {
      return titleComparer.compare(first.title, second.title) || first.id.localeCompare(second.id);
    });
    var inputs = new Map();
    inputResponse.devices.forEach(function (row) {
      if (!row || typeof row.id !== "string" || !/^HDMI_([1-9]|1[0-6])$/.test(row.id)) return;
      var port = Number(row.id.slice(5));
      var appId = "com.webos.app.hdmi" + port;
      if (row.appId && row.appId !== appId) return;
      if (inputs.has(port)) return;
      var plugged = flag(row.hdmiPlugIn);
      var native = appRows.get(appId) || { id: appId };
      inputs.set(port, {
        id: "input:" + row.id, appId: appId, kind: "input", port: port,
        title: label(row.label, "HDMI " + port), params: undefined,
        ownerColor: color(native.iconColor) || color(native.bgColor),
        iconCandidates: iconCandidates(native), plugged: plugged,
        signal: flag(row.hdmiSignalExist),
        detail: "HDMI " + port + " · " + (plugged ? "Connected" : "Not connected") +
          (plugged ? (flag(row.hdmiSignalExist) ? " · Signal detected" : " · No signal") : "")
      });
    });
    return apps.concat(Array.from(inputs.values()).sort(function (a, b) { return a.port - b.port; }));
  }
  function parseExec(response) {
    if (!response || response.returnValue === false || response.error ||
        (response.exitCode !== undefined && response.exitCode !== 0) ||
        (typeof response.stderrString === "string" && response.stderrString.trim())) {
      throw failure("Homebrew read failed: " + label(response && (response.stderrString || response.errorText || response.error), "service refused the read"), "ROOT_READ");
    }
    var text = response.stdoutString;
    if (typeof text !== "string" && Array.isArray(response.stdoutBytes)) {
      if (response.stdoutBytes.length > MAX_STDOUT || !response.stdoutBytes.every(function (n) {
        return Number.isInteger(n) && n >= 0 && n <= 255;
      })) throw failure("Invalid or oversized Homebrew output.", "ROOT_OUTPUT");
      var bytes = new Uint8Array(response.stdoutBytes);
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    }
    if (typeof text !== "string" || text.length > MAX_STDOUT) throw failure("Missing or oversized Homebrew stdout.", "ROOT_OUTPUT");
    return text;
  }
  function parseExecJSON(response) {
    var text = parseExec(response);
    try { return JSON.parse(text); }
    catch (_) { throw failure("Homebrew returned malformed inventory JSON.", "ROOT_JSON"); }
  }
  function imageInfo(bytes) {
    function at(index) { return bytes.charCodeAt(index); }
    function u16(index) { return at(index) * 256 + at(index + 1); }
    function u32(index) { return at(index) * 16777216 + at(index + 1) * 65536 + at(index + 2) * 256 + at(index + 3); }
    if (bytes.length >= 24 && bytes.slice(0, 8) === "\x89PNG\r\n\x1a\n" && bytes.slice(12, 16) === "IHDR") {
      return { mime: "image/png", width: u32(16), height: u32(20) };
    }
    if (bytes.length > 12 && at(0) === 255 && at(1) === 216) {
      var index = 2;
      while (index + 4 < bytes.length) {
        if (at(index) !== 255) break;
        var marker = at(index + 1);
        var length = u16(index + 2);
        if (length < 2 || index + 2 + length > bytes.length) break;
        if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 8) {
          return { mime: "image/jpeg", width: u16(index + 7), height: u16(index + 5) };
        }
        index += 2 + length;
      }
    }
    if (bytes.length >= 30 && bytes.slice(0, 4) === "RIFF" && bytes.slice(8, 12) === "WEBP") {
      var type = bytes.slice(12, 16);
      if (type === "VP8X") {
        return { mime: "image/webp", width: 1 + at(24) + at(25) * 256 + at(26) * 65536, height: 1 + at(27) + at(28) * 256 + at(29) * 65536 };
      }
      if (type === "VP8 " && bytes.slice(23, 26) === "\x9d\x01\x2a") {
        return { mime: "image/webp", width: (at(26) + at(27) * 256) & 16383, height: (at(28) + at(29) * 256) & 16383 };
      }
      if (type === "VP8L" && at(20) === 47) {
        return { mime: "image/webp", width: 1 + at(21) + ((at(22) & 63) << 8), height: 1 + (at(22) >> 6) + (at(23) << 2) + ((at(24) & 15) << 10) };
      }
    }
    throw failure("Native artwork is not a supported raster image.", "ICON_FORMAT");
  }
  function parseIconOutput(response) {
    var output = parseExec(response);
    var match = /^FOCUS_ICON_V1:(\d+)\r?\n([A-Za-z0-9+/=\r\n]+)\s*$/.exec(output);
    if (!match) throw failure("Invalid guarded artwork response.", "ICON_OUTPUT");
    var length = Number(match[1]);
    var encoded = match[2].replace(/[\r\n]/g, "");
    if (length < 1 || length > MAX_ICON_BYTES || encoded.length > Math.ceil(MAX_ICON_BYTES / 3) * 4 ||
        encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      throw failure("Native artwork size or encoding refused.", "ICON_SIZE");
    }
    var bytes;
    try { bytes = atob(encoded); } catch (_) { throw failure("Invalid artwork base64.", "ICON_OUTPUT"); }
    if (bytes.length !== length) throw failure("Artwork changed or was truncated during the read.", "ICON_SIZE");
    var info = imageInfo(bytes);
    if (!info.width || !info.height || info.width > 1024 || info.height > 1024 ||
        info.width * info.height > 1048576) throw failure("Artwork exceeds the decoded-image limit.", "ICON_DIMENSIONS");
    return { dataUrl: "data:" + info.mime + ";base64," + encoded, bytes: length, width: info.width, height: info.height };
  }
  function validPhotoId(value) {
    return typeof value === "string" && /^[A-Za-z0-9!_-]{1,200}$/.test(value);
  }
  function validPhotoCursor(value) {
    if (typeof value !== "string" || !value.length || value.length > MAX_PHOTO_CURSOR || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
    try {
      var address = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4));
      var url = new URL(address);
      return url.origin === "https://graph.microsoft.com" && !url.username && !url.password && !url.hash &&
        url.pathname.indexOf("/v1.0/") === 0 && url.pathname.endsWith("/children");
    } catch (_) { return false; }
  }
  function buildPhotoCommand(operation, identifier) {
    if (!["list", "photo"].includes(operation) ||
        (operation === "photo" ? !validPhotoId(identifier) : identifier !== undefined && !validPhotoCursor(identifier))) {
      throw failure("Invalid OneDrive photo request.", "PHOTO_REQUEST");
    }
    var command = "umask 077; /usr/bin/timeout 24 /usr/bin/flock -w 2 '/var/lib/focus-stage-photos/request.lock' " +
      "/usr/bin/node '/var/lib/focus-stage-photos/focus-photo-helper.cjs' " + operation;
    return identifier !== undefined ? command + " " + quoteShell(identifier) : command;
  }
  function assertPhotoResponse(value) {
    if (!value || value.ok !== true) {
      throw failure(value && value.error === "SIGN_IN_REQUIRED" ? "OneDrive sign-in needs to be renewed." : "OneDrive photos are unavailable.", "PHOTO_SERVICE");
    }
  }
  function normalizePhotos(value) {
    assertPhotoResponse(value);
    if (value.connected === false) return { connected: false, items: [], truncated: false };
    var validFolder = typeof value.folder === "string" && /^Apps\/[^\x00-\x1f\x7f/\\]{1,120}$/.test(value.folder) &&
      value.folder.slice(5).trim() === value.folder.slice(5);
    if (value.connected !== true || !validFolder || !Array.isArray(value.items) || value.items.length > MAX_PHOTO_ITEMS) {
      throw failure("Invalid OneDrive photo list.", "PHOTO_LIST");
    }
    var seen = new Set(), items = [];
    value.items.forEach(function (item) {
      if (!item || !validPhotoId(item.id) || typeof item.name !== "string" || item.name.length > 240) {
        throw failure("Invalid OneDrive photo entry.", "PHOTO_LIST");
      }
      if (seen.has(item.id)) return;
      seen.add(item.id);
      items.push({ id: item.id, name: label(item.name, "Photo") });
    });
    if (value.nextCursor !== undefined && value.nextCursor !== null && !validPhotoCursor(value.nextCursor)) {
      throw failure("Invalid OneDrive photo continuation.", "PHOTO_LIST");
    }
    return { connected: true, items: items, nextCursor: value.nextCursor || null, truncated: value.truncated === true };
  }
  async function collectPhotoPages(readPage, isCurrent) {
    var items = [], identifiers = new Set(), cursors = new Set(), cursor, bytes = 0, pageCount = 0;
    do {
      if (isCurrent && !isCurrent()) throw failure("Photo refresh cancelled.", "PHOTO_CANCELLED");
      var page = await readPage(cursor);
      if (isCurrent && !isCurrent()) throw failure("Photo refresh cancelled.", "PHOTO_CANCELLED");
      if (!page.connected) {
        if (pageCount) throw failure("OneDrive disconnected during photo refresh.", "PHOTO_SERVICE");
        return { connected: false, items: [], truncated: false, pageCount: 0 };
      }
      if (page.truncated && !page.nextCursor) throw failure("The OneDrive photo helper needs its pagination update.", "PHOTO_LIST");
      pageCount++;
      page.items.forEach(function (item) {
        if (identifiers.has(item.id)) return;
        bytes += (item.id.length + item.name.length) * 2 + 128;
        if (bytes > MAX_PHOTO_CATALOG_BYTES) throw failure("The photo list exceeds its memory safety budget. The previous list is unchanged.", "PHOTO_LIST");
        identifiers.add(item.id);
        items.push(item);
      });
      cursor = page.nextCursor;
      if (cursor) {
        if (!validPhotoCursor(cursor) || cursors.has(cursor)) throw failure("OneDrive repeated an invalid photo-list page.", "PHOTO_LIST");
        bytes += cursor.length * 2 + 128;
        if (bytes > MAX_PHOTO_CATALOG_BYTES) throw failure("The photo list exceeds its memory safety budget. The previous list is unchanged.", "PHOTO_LIST");
        cursors.add(cursor);
      }
    } while (cursor);
    return { connected: true, items: items, truncated: false, pageCount: pageCount };
  }
  function shuffledPhotoIds(items, currentId, random) {
    var nextRandom = random || Math.random;
    var identifiers = items.map(function (item) { return item.id; });
    for (var index = identifiers.length - 1; index > 0; index--) {
      var position = Math.floor(nextRandom() * (index + 1));
      var previous = identifiers[index];
      identifiers[index] = identifiers[position];
      identifiers[position] = previous;
    }
    var last = identifiers.length - 1;
    if (last > 0 && identifiers[last] === currentId) {
      var first = identifiers[0];
      identifiers[0] = identifiers[last];
      identifiers[last] = first;
    }
    return identifiers;
  }
  function parsePhotoOutput(response, expectedId) {
    if (!validPhotoId(expectedId)) throw failure("Invalid OneDrive photo ID.", "PHOTO_REQUEST");
    var value = parseExecJSON(response);
    assertPhotoResponse(value);
    if (value.id !== expectedId || !Number.isInteger(value.byteLength) || value.byteLength < 1 ||
        value.byteLength > MAX_PHOTO_BYTES || typeof value.data !== "string" ||
        value.data.length > Math.ceil(MAX_PHOTO_BYTES / 3) * 4 || value.data.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(value.data)) {
      throw failure("OneDrive photo size or encoding refused.", "PHOTO_SIZE");
    }
    var bytes;
    try { bytes = atob(value.data); } catch (_) { throw failure("Invalid OneDrive photo encoding.", "PHOTO_FORMAT"); }
    if (bytes.length !== value.byteLength) throw failure("OneDrive photo was truncated.", "PHOTO_SIZE");
    var info = imageInfo(bytes);
    if (!info.width || !info.height || info.width > 1920 || info.height > 1080 || info.width * info.height > MAX_PHOTO_PIXELS) {
      throw failure("OneDrive photo exceeds the display-image limit.", "PHOTO_DIMENSIONS");
    }
    return { id: value.id, dataUrl: "data:" + info.mime + ";base64," + value.data, bytes: bytes.length, width: info.width, height: info.height };
  }
  function IconCache(options) {
    options = options || {};
    this.maxEntries = options.maxEntries || 64;
    this.maxBytes = options.maxBytes || 4194304;
    this.maxPixels = options.maxPixels || 4194304;
    this.entries = new Map();
    this.bytes = 0;
    this.pixels = 0;
  }
  IconCache.prototype.get = function (key) {
    var value = this.entries.get(key);
    if (value) { this.entries.delete(key); this.entries.set(key, value); }
    return value;
  };
  IconCache.prototype.put = function (key, value) {
    if (value.bytes > this.maxBytes || value.width * value.height > this.maxPixels) return false;
    this.remove(key);
    this.entries.set(key, value);
    this.bytes += value.bytes;
    this.pixels += value.width * value.height;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes || this.pixels > this.maxPixels) {
      this.remove(this.entries.keys().next().value);
    }
    return true;
  };
  IconCache.prototype.remove = function (key) {
    var old = this.entries.get(key);
    if (old) { this.bytes -= old.bytes; this.pixels -= old.width * old.height; this.entries.delete(key); }
  };
  function restoreSelection(items, saved) {
    saved = saved || {};
    var index = items.findIndex(function (item) { return item.id === saved.selectedId; });
    if (index < 0) index = Math.max(0, Math.min(items.length - 1, Number.isInteger(saved.index) ? saved.index : 0));
    var gridIndex = items.findIndex(function (item) { return item.id === saved.gridId; });
    return {
      index: index, selectedId: items[index] ? items[index].id : null,
      gridIndex: gridIndex >= 0 ? gridIndex : index,
      gridScrollTop: Math.max(0, Math.min(100000, Number(saved.gridScrollTop) || 0))
    };
  }
  function gridRows(items, columns) {
    var rows = [], row = [], kind;
    items.forEach(function (item, index) {
      if (kind !== item.kind || row.length === columns) { if (row.length) rows.push(row); row = []; }
      kind = item.kind;
      row.push(index);
    });
    if (row.length) rows.push(row);
    return rows;
  }
  function railIndices(items, order, hidden) {
    var byId = new Map(), used = new Set(), result = [];
    var hiddenIds = new Set(Array.isArray(hidden) ? hidden.slice(0, 128) : []);
    items.forEach(function (item, index) { byId.set(item.id, index); });
    (Array.isArray(order) ? order.slice(0, 128) : []).concat(items.map(function (item) { return item.id; })).forEach(function (id) {
      if (byId.has(id) && !used.has(id) && !hiddenIds.has(id)) { used.add(id); result.push(byId.get(id)); }
    });
    return result.length || !items.length ? result : [0];
  }
  function railWeights(count, position) {
    return Array.from({ length: count }, function (_, index) { return Math.max(0, 1 - Math.abs(index - position)); });
  }
  function pointerLayout(centers, weights) {
    return centers.map(function (center, index) {
      var scale = 1 + Math.max(0, Math.min(1, weights[index] || 0));
      return { left: center - 60, baseLeft: center - 60, railOffset: 0, center: center, width: 120 * scale, scale: scale };
    });
  }
  function compactPointerCenters(centers, anchor) {
    return centers.map(function (_, index) { return centers[anchor] + (index - anchor) * 144; });
  }
  function railLayout(count, position, options) {
    if (!count) return [];
    options = options || {};
    position = Math.max(0, Math.min(count - 1, position));
    var weights = options.weights || railWeights(count, position);
    var cards = [], edge = 0;
    for (var index = 0; index < count; index++) {
      var scale = 1 + Math.max(0, Math.min(1, weights[index] || 0));
      var width = 120 * scale;
      cards.push({ center: edge + width / 2, width: width, scale: scale });
      edge += width + 24;
    }
    var lower = Math.floor(position), upper = Math.ceil(position), fraction = position - lower;
    var center = Number.isFinite(options.center) ? options.center : 960;
    var offset = center - cards[lower].center * (1 - fraction) - cards[upper].center * fraction;
    if (Number.isInteger(options.anchorIndex) && cards[options.anchorIndex]) offset = center - cards[options.anchorIndex].center;
    return cards.map(function (card) { return { left: card.center + offset - 60, baseLeft: card.center - 60, railOffset: offset, center: card.center + offset, width: card.width, scale: card.scale }; });
  }
  function stepRail(motion, target, seconds, count, response) {
    target = Math.max(0, Math.min(Math.max(0, count - 1), target));
    response = response === 40 ? 40 : 24;
    var elapsed = Math.max(0, Math.min(0.05, seconds));
    var displacement = motion.position - target;
    var change = (motion.velocity + response * displacement) * elapsed;
    var decay = Math.exp(-response * elapsed);
    var position = target + (displacement + change) * decay;
    var velocity = (motion.velocity - response * change) * decay;
    if (position < 0 || position > Math.max(0, count - 1)) {
      position = Math.max(0, Math.min(Math.max(0, count - 1), position));
      velocity = 0;
    }
    if (Math.abs(position - target) < 0.001 && Math.abs(velocity) < 0.01) return { position: target, velocity: 0 };
    return { position: position, velocity: velocity };
  }
  function pointerScroll(x, y) {
    if (x < 0 || x > 1920 || y < 570 || y > 960 || (x >= 160 && x <= 1760)) return { direction: 0 };
    var direction = x < 160 ? -1 : 1;
    var depth = direction < 0 ? (160 - x) / 160 : (x - 1760) / 160;
    return { direction: direction, dwell: 300, interval: Math.round(1000 / (1 + 5 * Math.pow(Math.min(1, depth), 1.3))) };
  }
  function moveGrid(items, index, key, columns) {
    var rows = gridRows(items, columns || 6);
    var r = rows.findIndex(function (row) { return row.includes(index); });
    if (r < 0) return 0;
    var c = rows[r].indexOf(index);
    if (key === "ArrowLeft") return rows[r][Math.max(0, c - 1)];
    if (key === "ArrowRight") return rows[r][Math.min(rows[r].length - 1, c + 1)];
    if (key === "ArrowUp" && r === 0) return -1;
    var next = key === "ArrowUp" ? r - 1 : key === "ArrowDown" ? Math.min(rows.length - 1, r + 1) : r;
    return rows[next][Math.min(c, rows[next].length - 1)];
  }
  function isTVEnvironment(environment) {
    return !!(environment.PalmServiceBridge || environment.PalmSystem ||
      /web[o0]s|netcast|LG Browser/i.test(environment.navigator && environment.navigator.userAgent || ""));
  }
  function createLiveClient(options) {
    options = options || {};
    var Bridge = options.Bridge || (typeof PalmServiceBridge !== "undefined" ? PalmServiceBridge : null);
    var timeout = options.timeoutMs || 8000;
    var pending = new Map(), serial = 0;
    var lastApps = { returnValue: true, launchPoints: [] };
    var lastInputs = { returnValue: true, devices: [] };
    function request(uri, payload, deadline) {
      return new Promise(function (resolve, reject) {
        if (typeof Bridge !== "function") { reject(failure("PalmServiceBridge is unavailable on this TV. Desktop fixtures are disabled.", "BRIDGE_MISSING")); return; }
        var id = ++serial, bridge, timer;
        function settle(error, value) {
          if (!pending.has(id)) return;
          clearTimeout(timer);
          pending.delete(id);
          try { if (bridge) bridge.onservicecallback = null; } catch (_) { /* A native setter must not strand the promise. */ }
          if (error) reject(error); else resolve(value);
        }
        try {
          bridge = new Bridge();
          pending.set(id, bridge);
          var requestTimeout = deadline || timeout;
          timer = setTimeout(function () { settle(failure("No reply from webOS within " + requestTimeout + " ms. A launch may still complete.", "TIMEOUT")); }, requestTimeout);
          bridge.onservicecallback = function (raw) {
            try {
              if (typeof raw !== "string" || raw.length > MAX_STDOUT + 262144) throw failure("Invalid webOS service response.", "BRIDGE_RESPONSE");
              var response = JSON.parse(raw);
              if (!response || response.returnValue === false) throw failure(label(response && (response.errorText || response.errorMessage), "webOS refused the request."), "SERVICE_REFUSED");
              settle(null, response);
            } catch (error) { settle(error); }
          };
          bridge.call(uri, JSON.stringify(payload));
        } catch (error) {
          if (pending.has(id)) settle(error); else reject(error);
        }
      });
    }
    function read(command, deadline) { return request("luna://org.webosbrew.hbchannel.service/exec", { command: command }, deadline); }
    return Object.freeze({
      mode: "webos",
      pendingCount: function () { return pending.size; },
      loadInventory: function () {
        var errors = [], started = Date.now(), timings = {};
        return Promise.all([
          read(COMMANDS.apps).then(parseExecJSON).then(function (value) { assertResponse(value, "launchPoints"); lastApps = value; })
            .catch(function (error) { errors.push("Apps: " + error.message); })
            .finally(function () { timings.appsMs = Date.now() - started; }),
          request("luna://com.webos.service.eim/getAllInputStatus", {}).then(function (value) { assertResponse(value, "devices"); lastInputs = value; })
            .catch(function (error) { errors.push("Inputs: " + error.message); })
            .finally(function () { timings.inputsMs = Date.now() - started; })
        ]).then(function () {
          timings.totalMs = Date.now() - started;
          return { items: normalizeInventory(lastApps, lastInputs), errors: errors, stale: errors.length > 0, timings: timings };
        });
      },
      readIcon: async function (item) {
        if (!item || !validId(item.appId) || !Array.isArray(item.iconCandidates) || !item.iconCandidates.length) {
          throw failure("No approved native artwork path.", "ICON_PATH");
        }
        var lastError;
        for (var index = 0; index < Math.min(3, item.iconCandidates.length); index++) {
          try { return parseIconOutput(await read(buildIconReadCommand(item.appId, item.iconCandidates[index]))); }
          catch (error) { lastError = error; }
        }
        throw lastError;
      },
      loadPhotos: function (isCurrent) {
        return collectPhotoPages(function (cursor) {
          return read(buildPhotoCommand("list", cursor), 28000).then(parseExecJSON).then(normalizePhotos);
        }, isCurrent);
      },
      readPhoto: function (identifier) {
        return read(buildPhotoCommand("photo", identifier), 28000).then(function (response) {
          return parsePhotoOutput(response, identifier);
        });
      },
      openSettings: function () {
        return request("luna://com.webos.service.systemUIManager/launch", { appId: "com.webos.app.quicksettings" })
          .then(function (response) {
            if (response.returnValue !== true || response.error) throw failure("webOS did not acknowledge the Settings panel.", "SETTINGS_UNCONFIRMED");
            return response;
          });
      },
      launch: function (item) {
        if (!item || !validId(item.appId)) return Promise.reject(failure("Invalid native app ID.", "APP_ID"));
        var payload = { id: item.appId }, params = safeParams(item.params);
        if (params) payload.params = params;
        return request("luna://com.webos.applicationManager/launch", payload).then(function (response) {
          if (response.returnValue !== true || response.error) throw failure("webOS did not acknowledge the launch.", "LAUNCH_UNCONFIRMED");
          return response;
        });
      }
    });
  }
  return Object.freeze({
    OWN_ID: OWN_ID, MAX_ICON_BYTES: MAX_ICON_BYTES, COMMANDS: COMMANDS, TARGETS: TARGETS,
    MAX_PHOTO_BYTES: MAX_PHOTO_BYTES, MAX_PHOTO_PIXELS: MAX_PHOTO_PIXELS, MAX_PHOTO_ITEMS: MAX_PHOTO_ITEMS,
    MAX_PHOTO_CURSOR: MAX_PHOTO_CURSOR, MAX_PHOTO_CATALOG_BYTES: MAX_PHOTO_CATALOG_BYTES,
    validId: validId, safeParams: safeParams, surfaceColor: surfaceColor,
    guardIconPath: guardIconPath, buildIconReadCommand: buildIconReadCommand,
    normalizeInventory: normalizeInventory, parseExec: parseExec, parseExecJSON: parseExecJSON,
    parseIconOutput: parseIconOutput, IconCache: IconCache,
    validPhotoId: validPhotoId, validPhotoCursor: validPhotoCursor, buildPhotoCommand: buildPhotoCommand, normalizePhotos: normalizePhotos,
    collectPhotoPages: collectPhotoPages, shuffledPhotoIds: shuffledPhotoIds, parsePhotoOutput: parsePhotoOutput,
    restoreSelection: restoreSelection, moveGrid: moveGrid, gridRows: gridRows,
    railIndices: railIndices, railWeights: railWeights, railLayout: railLayout, pointerLayout: pointerLayout, compactPointerCenters: compactPointerCenters, stepRail: stepRail, pointerScroll: pointerScroll,
    isTVEnvironment: isTVEnvironment, createLiveClient: createLiveClient
  });
});

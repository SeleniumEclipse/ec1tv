"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const api = require("../app/webos.js");
const root = "/media/cryptofs/apps/usr/palm/applications/";
const emptyInputs = { returnValue: true, devices: [] };
const apps = rows => ({ returnValue: true, launchPoints: rows });
const envelope = stdoutString => ({ returnValue: true, stdoutString, stderrString: "" });
const app = (id, title, extra = {}) => ({ id, title, lptype: "default", ...extra });
const iconBytes = fs.readFileSync(path.join(__dirname, "..", "app", "icon.png"));
const iconEnvelope = bytes => envelope("FOCUS_ICON_V1:" + bytes.length + "\n" + bytes.toString("base64") + "\n");
function mockClient(handler, timeoutMs = 100) {
  const calls = [];
  class Bridge {
    call(uri, payload) {
      const call = { uri, payload: JSON.parse(payload), bridge: this };
      calls.push(call);
      handler(call, response => { if (this.onservicecallback) this.onservicecallback(JSON.stringify(response)); });
    }
  }
  return { client: api.createLiveClient({ Bridge, timeoutMs }), calls };
}
test("photo lists accept the connected user's app-folder name", () => {
  for (const folder of ["Apps/ec1tv Photos", "Apps/Family TV Photos", "Apps/Focus Stage"]) {
    const result = api.normalizePhotos({ ok: true, connected: true, folder, items: [{ id: "OWN_PHOTO", name: "sample.jpg" }] });
    assert.equal(result.connected, true);
    assert.equal(result.items[0].id, "OWN_PHOTO");
  }
});
test("photo lists reject malformed folder names and oversized pages", () => {
  for (const folder of ["Photos/Family", "Apps/", "Apps/../Other", "Apps/ family", "Apps/family\n", "Apps/" + "x".repeat(121)]) {
    assert.throws(() => api.normalizePhotos({ ok: true, connected: true, folder, items: [] }));
  }
  assert.throws(() => api.normalizePhotos({ ok: true, connected: true, folder: "Apps/Family", items: Array.from({ length: 129 }, () => ({ id: "PHOTO", name: "sample.jpg" })) }));
});
test("metadata keeps useful system LG apps, store, HBC, and Live TV; filters hidden/helpers/loop launchers", () => {
  const result = api.normalizeInventory(apps([
    app("netflix", "Netflix"), app("youtube.leanback.v4", "YouTube"),
    app("com.palm.app.settings", "Settings", { systemApp: true }),
    app("com.webos.app.discovery", "LG Apps", { systemApp: true }),
    app("com.webos.app.livetv", "Live TV", { systemApp: true }),
    app("org.webosbrew.hbchannel", "Homebrew Channel"),
    app("com.webos.app.browser", "Browser", { systemApp: true }),
    app(api.OWN_ID, "Self"), app("com.webos.app.home", "LG Home"),
    app("com.webos.app.home2021", "Other Home"),
    app("com.webos.app.toast", "Helper", { systemApp: true }),
    app("hidden.app", "Hidden", { hidden: "true" }),
    app("pin.app", "Pinned", { lptype: "bookmark" }),
    app("bad id; echo x", "Invalid"), null
  ]), emptyInputs);
  assert.equal(result.length, 7);
  assert.deepEqual(result.map(row => row.title), ["Browser", "Homebrew Channel", "LG Apps", "Live TV", "Netflix", "Settings", "YouTube"]);
});
test("stable sorting, duplicate default launch points, untrusted labels, and JSON params", () => {
  const title = '<img src=x onerror="bad()"> & A deliberately long title '.repeat(5);
  const list = [
    app("one", "zeta", { launchPointId: "z", params: "not JSON" }),
    app("one", "Alpha", { launchPointId: "a", params: '{"source":"native","id":"not-shell"}' }),
    app("two", title), app("three", "alpha")
  ];
  const first = api.normalizeInventory(apps(list), emptyInputs);
  assert.deepEqual(first, api.normalizeInventory(apps(list.slice().reverse()), emptyInputs));
  assert.equal(first.find(row => row.appId === "one").title, "Alpha");
  assert.deepEqual(first.find(row => row.appId === "one").params, { source: "native", id: "not-shell" });
  assert.ok(first.find(row => row.appId === "two").title.startsWith("<img"));
  assert.equal(first.find(row => row.appId === "two").title.length, 240);
  assert.equal(api.safeParams("[1]"), undefined);
  assert.equal(api.safeParams('{"x":"' + "a".repeat(9000) + '"}'), undefined);
});
test("inventory title sorting preserves numeric, accent, case and stable-ID ordering", () => {
  const rows = [app("title.ten", "Video 10"), app("title.two", "Video 2"), app("title.accent", "\u00c9clair"),
    app("title.plain", "eclair"), app("title.upper", "ALPHA"), app("title.lower", "alpha")];
  const expected = rows.slice().sort((first, second) =>
    first.title.localeCompare(second.title, "en", { sensitivity: "base", numeric: true }) || ("app:" + first.id).localeCompare("app:" + second.id));
  assert.deepEqual(api.normalizeInventory(apps(rows), emptyInputs).map(item => item.appId), expected.map(item => item.id));
});
test("HDMI uses hdmiPlugIn, not connected; all ports are selectable and grouped", () => {
  const result = api.normalizeInventory(apps([app("netflix", "Netflix"), app("com.webos.app.hdmi2", "HDMI 2")]), {
    returnValue: true, devices: [
      { id: "HDMI_4", label: "HDMI 4", hdmiPlugIn: false },
      { id: "HDMI_1", label: "HDMI 1", connected: true, hdmiPlugIn: false },
      { id: "HDMI_2", label: "Sony DVD Player", appId: "com.webos.app.hdmi2", hdmiPlugIn: true, hdmiSignalExist: true },
      { id: "HDMI_3", label: "Denon Home Theater", hdmiPlugIn: true, hdmiSignalExist: false }
    ]
  });
  assert.equal(result.length, 5);
  assert.deepEqual(result.slice(1).map(row => row.port), [1, 2, 3, 4]);
  assert.equal(result[1].plugged, false);
  assert.match(result[1].detail, /Not connected/);
  assert.equal(result[2].appId, "com.webos.app.hdmi2");
  assert.match(result[3].detail, /No signal/);
  assert.ok(result.every(row => !row.title.includes("Xbox")));
});
test("malformed inventory is explicit instead of an empty success or fixtures", () => {
  assert.throws(() => api.normalizeInventory({ returnValue: false }, emptyInputs), /Invalid/);
  assert.throws(() => api.normalizeInventory(apps([]), { returnValue: true, devices: {} }), /Invalid/);
  assert.throws(() => api.parseExecJSON(envelope("not-json")), /malformed/);
});
test("native artwork priority rejects unsafe candidates before falling back to valid native sizes", () => {
  const normal = api.normalizeInventory(apps([app("netflix", "Netflix", {
    extraLargeIcon: root + "netflix/192.png", largeIcon: root + "netflix/130.png", icon: root + "netflix/80.png"
  })]), emptyInputs)[0];
  assert.deepEqual(normal.iconCandidates, [root + "netflix/192.png", root + "netflix/130.png", root + "netflix/80.png"]);
  const refused = api.normalizeInventory(apps([app("netflix", "Netflix", {
    extraLargeIcon: "/etc/passwd", largeIcon: root + "netflix/130.png"
  })]), emptyInputs)[0];
  assert.deepEqual(refused.iconCandidates, [root + "netflix/130.png"]);
});
test("only approved same-app raster roots accepted, including HBC", () => {
  for (const prefix of [root, "/usr/palm/applications/", "/media/developer/apps/usr/palm/applications/", "/media/system/apps/usr/palm/applications/"]) {
    assert.equal(api.guardIconPath("org.webosbrew.hbchannel", prefix + "org.webosbrew.hbchannel/assets/icon130.png"), prefix + "org.webosbrew.hbchannel/assets/icon130.png");
  }
});
test("native manifest declares Home capability and delegates window activation to webOS", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "app", "appinfo.json"), "utf8"));
  assert.deepEqual(manifest.appCategory, ["home"]);
  assert.equal(manifest.handlesRelaunch, false, "No background-only launch preparation is needed; webOS must activate the window automatically");
  assert.equal(manifest.id, "io.focusstage.home");
  assert.equal(manifest.requiredPermissions, undefined, "Home capability must not add an unverified all-permissions grant");
});
test("native system-app artwork remains confined to its own app directory", () => {
  const system = "/media/system/apps/usr/palm/applications/";
  assert.equal(api.guardIconPath("com.webos.app.lgchannels", system + "com.webos.app.lgchannels/icon_130x130.png"), system + "com.webos.app.lgchannels/icon_130x130.png");
  assert.throws(() => api.guardIconPath("com.webos.app.lgchannels", system + "com.webos.app.lifeonscreen/icon-large.png"));
  assert.throws(() => api.guardIconPath("com.webos.app.lgchannels", system + "com.webos.app.lgchannels/../private.png"));
});
test("mounted system artwork is limited to the exact Browser and Apps directories", () => {
  const mounted = "/mnt/otncabi/usr/palm/applications/";
  const browser = mounted + "com.webos.app.browser/assets/hd1080/webbrowser_extra_large_icon.png";
  const store = mounted + "com.webos.app.discovery/asset/hd1080/lgstore_130x130.png";
  assert.equal(api.guardIconPath("com.webos.app.browser", browser), browser);
  assert.equal(api.guardIconPath("com.webos.app.discovery", store), store);
  assert.throws(() => api.guardIconPath("netflix", mounted + "netflix/icon.png"));
  assert.throws(() => api.guardIconPath("com.webos.app.browser", store));
  assert.throws(() => api.guardIconPath("com.webos.app.discovery", browser));
  assert.throws(() => api.guardIconPath("com.webos.app.browser", mounted + "com.webos.app.browser.other/icon.png"));
  assert.throws(() => api.guardIconPath("com.webos.app.browser", mounted + "com.webos.app.browser/../private.png"));
  assert.throws(() => api.guardIconPath("com.webos.app.browser", browser.replace("otncabi", "otycabi")));
  assert.throws(() => api.guardIconPath("com.webos.app.browser", browser.replace(".png", ".svg")));
  const result = api.normalizeInventory(apps([app("com.webos.app.browser", "Web Browser", { extraLargeIcon: browser }), app("com.webos.app.discovery", "Apps", { largeIcon: store })]), emptyInputs);
  assert.deepEqual(result.find(item => item.appId === "com.webos.app.browser").iconCandidates, [browser]);
  assert.deepEqual(result.find(item => item.appId === "com.webos.app.discovery").iconCandidates, [store]);
});
test("reject traversal, control characters, schemes, sibling apps, and shell metacharacters", () => {
  const bad = [
    "/etc/passwd", "/home/root/.ssh/id_rsa", "file://" + root + "netflix/icon.png",
    "https://example.invalid/icon.png", root + "youtube/icon.png", root + "netflix-other/icon.png",
    root + "netflix/../secret.png", root + "netflix/./icon.png", root + "netflix//icon.png",
    root + "netflix/%2e%2e/icon.png", root + "netflix/\nicon.png", root + "netflix/\u0000icon.png",
    root + "netflix/$(whoami).png", root + "netflix/icon.png;echo x", root + "netflix/icon.svg",
    root + "netflix\\icon.png"
  ];
  for (const icon of bad) assert.throws(() => api.guardIconPath("netflix", icon), /artwork/);
  assert.throws(() => api.buildIconReadCommand("../netflix", root + "netflix/icon.png"));
});
test("read-only icon command quotes apostrophes, refuses symlinks canonically, and bounds both reads", () => {
  const command = api.buildIconReadCommand("netflix", root + "netflix/owner's logo.png");
  assert.ok(command.includes("owner'\"'\"'s logo.png"));
  assert.match(command, /readlink -f "\$p"/);
  assert.match(command, /\[ -L "\$p" \]/);
  assert.match(command, /exec 3< "\$p"/);
  assert.match(command, /f="\/proc\/\$\$\/fd\/3"/);
  assert.match(command, /readlink -f "\$f"/);
  assert.match(command, /stat -L -c %s "\$f"/);
  assert.match(command, /-gt 1048576/);
  assert.match(command, /head -c 1048577 "\$f" \| base64$/);
  assert.doesNotMatch(command, /\b(?:rm|chmod|chown|curl|wget|eval|sh -c)\b/);
});
test("guarded PNG reads preserve native bytes and dimensions exactly", () => {
  const image = api.parseIconOutput(iconEnvelope(iconBytes));
  assert.equal(image.width, 130); assert.equal(image.height, 130);
  assert.equal(image.bytes, iconBytes.length);
  assert.equal(image.dataUrl, "data:image/png;base64," + iconBytes.toString("base64"));
});
test("refuse declared size over 1MiB, truncated reads, oversized decoded images, non-raster payloads", () => {
  assert.throws(() => api.parseIconOutput(envelope("FOCUS_ICON_V1:1048577\nAAAA\n")), /size/);
  assert.throws(() => api.parseIconOutput(envelope("FOCUS_ICON_V1:4\nAAAA\n")), /truncated/);
  const oversized = Buffer.from(iconBytes);
  oversized.writeUInt32BE(20000, 16);
  assert.throws(() => api.parseIconOutput(iconEnvelope(oversized)), /decoded-image/);
  assert.throws(() => api.parseIconOutput(iconEnvelope(Buffer.from("<svg onload='x'/>"))), /raster/);
  assert.throws(() => api.parseIconOutput(envelope(iconBytes.toString("base64"))), /guarded/);
});
test("Homebrew stderr/errors/missing stdout are explicit; UTF-8 stdoutBytes supported", () => {
  assert.throws(() => api.parseExec({ returnValue: true, stdoutString: "{}", stderrString: "Permission denied" }), /Permission denied/);
  assert.throws(() => api.parseExec({ returnValue: true, error: "FOCUS_ICON_REFUSED" }), /FOCUS_ICON_REFUSED/);
  assert.throws(() => api.parseExec({ returnValue: true }), /stdout/);
  assert.throws(() => api.parseExec({ returnValue: false, stdoutString: "{}" }), /failed/);
  assert.deepEqual(api.parseExecJSON({ stdoutBytes: Array.from(Buffer.from('{"name":"Télévision"}')) }), { name: "Télévision" });
});
test("icon LRU bounded by entries, source bytes, and decoded pixels", () => {
  const cache = new api.IconCache({ maxEntries: 2, maxBytes: 100, maxPixels: 100 });
  const value = { bytes: 40, width: 5, height: 5, dataUrl: "local" };
  cache.put("a", value); cache.put("b", value); cache.get("a"); cache.put("c", value);
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.entries.size, 2); assert.equal(cache.bytes, 80); assert.equal(cache.pixels, 50);
  assert.equal(cache.put("huge", { bytes: 101, width: 1, height: 1 }), false);
  assert.equal(cache.put("wide", { bytes: 1, width: 101, height: 1 }), false);
  cache.remove("a"); assert.equal(cache.bytes, 40);
});
test("night-safe default never uses white full-screen; bright fill requires explicit opt-in", () => {
  assert.equal(api.surfaceColor("#ffffff", false), "#18242c");
  assert.equal(api.surfaceColor("#ffffff", true), "#ffffff");
  assert.equal(api.surfaceColor("url(https://example.invalid)", true), "#18242c");
  assert.notEqual(api.surfaceColor("#ff0000", false), "#ff0000");
});
test("stable IDs restore selected app and grid scroll after reordering and removal", () => {
  const before = api.normalizeInventory(apps([app("a", "Alpha"), app("b", "Beta"), app("c", "Charlie")]), emptyInputs);
  const after = api.normalizeInventory(apps([app("z", "Aardvark"), ...before.map(row => app(row.appId, row.title))]), emptyInputs);
  const restored = api.restoreSelection(after, { selectedId: "app:c", gridId: "app:b", index: 2, gridScrollTop: 840 });
  assert.equal(restored.index, 3); assert.equal(restored.gridIndex, 2); assert.equal(restored.gridScrollTop, 840);
  const removed = api.restoreSelection(after.slice(0, 2), { selectedId: "missing", index: 30 });
  assert.equal(removed.index, 1); assert.equal(removed.selectedId, "app:a");
});
test("6-column grid navigation reaches more than 35 destinations and independent input rows", () => {
  const items = Array.from({ length: 41 }, (_, n) => ({ id: "app:" + n, kind: "app" }))
    .concat(Array.from({ length: 4 }, (_, n) => ({ id: "input:" + n, kind: "input" })));
  const seen = new Set([0]), queue = [0];
  while (queue.length) {
    const index = queue.shift();
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
      const next = api.moveGrid(items, index, key);
      if (next >= 0 && !seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  assert.equal(seen.size, 45);
  assert.equal(api.moveGrid(items, 0, "ArrowUp"), -1);
  assert.equal(api.moveGrid(items, 40, "ArrowRight"), 40);
  assert.equal(api.moveGrid(items, 40, "ArrowDown"), 44);
  assert.equal(api.moveGrid(items, 41, "ArrowLeft"), 41);
});
test("TV detection cannot silently enable fixtures if the native bridge is missing", () => {
  assert.equal(api.isTVEnvironment({ navigator: { userAgent: "Mozilla/5.0 (Web0S; Linux/SmartTV) Chrome/108" } }), true);
  assert.equal(api.isTVEnvironment({ PalmSystem: {} }), true);
  assert.equal(api.isTVEnvironment({ PalmServiceBridge() {} }), true);
  assert.equal(api.isTVEnvironment({ navigator: { userAgent: "Desktop Chrome" } }), false);
});
test("rail order and hiding retain the complete catalog and tolerate missing, duplicate and new apps", () => {
  const items = Object.freeze([{ id: "app:a" }, { id: "app:b" }, { id: "input:HDMI_2" }]);
  assert.deepEqual(api.railIndices(items, ["input:HDMI_2", "missing", "app:a", "app:a"], ["app:b"]), [2, 0]);
  assert.equal(items.length, 3);
  assert.deepEqual(api.railIndices(items, null, null), [0, 1, 2]);
  assert.deepEqual(api.railIndices(items, [], items.map(item => item.id)), [0]);
  assert.deepEqual(api.railIndices([], [], []), []);
});
test("rail artwork has a constant 24px edge gap through every intermediate growth and scroll position", () => {
  for (let position = 0; position <= 19; position += 0.125) {
    const cards = api.railLayout(20, position);
    for (let index = 1; index < cards.length; index++) {
      const gap = cards[index].center - cards[index].width / 2 - cards[index - 1].center - cards[index - 1].width / 2;
      assert.ok(Math.abs(gap - 24) < 0.000001);
      assert.ok(cards[index].scale >= 1 && cards[index].scale <= 2);
    }
  }
  const settled = api.railLayout(37, 18);
  assert.equal(settled[18].center, 960);
  assert.equal(settled[18].width * settled[18].width / (120 * 120), 4);
  assert.equal(settled[19].center - settled[18].center, 204);
  assert.equal(settled[20].center - settled[19].center, 144);
});
test("rapid rail retargeting retains current motion without queuing old selections or leaving the collection", () => {
  let motion = { position: 4, velocity: 0 };
  for (const target of [5, 6, 12, 3, 2, 1, 0, 36, 20, 19]) {
    const unchanged = api.stepRail(motion, target, 0, 37);
    assert.ok(Math.abs(unchanged.position - motion.position) < 0.000001);
    motion = api.stepRail(motion, target, 1 / 60, 37);
    assert.ok(Number.isFinite(motion.position) && Number.isFinite(motion.velocity));
    assert.ok(motion.position >= 0 && motion.position <= 36);
  }
  for (let frame = 0; frame < 90; frame++) motion = api.stepRail(motion, 19, 1 / 60, 37);
  assert.deepEqual(motion, { position: 19, velocity: 0 });
});
test("pointer scroll is confined to the far edges with bounded proportional speed", () => {
  for (const x of [160, 400, 640, 960, 1280, 1520, 1760]) assert.equal(api.pointerScroll(x, 780).direction, 0);
  assert.equal(api.pointerScroll(100, 100).direction, 0);
  assert.equal(api.pointerScroll(1800, 1000).direction, 0);
  assert.equal(api.pointerScroll(100, 780).direction, -1);
  assert.equal(api.pointerScroll(1800, 780).direction, 1);
  assert.equal(api.pointerScroll(1800, 780).dwell, 300);
  assert.ok(api.pointerScroll(1900, 780).interval < api.pointerScroll(1840, 780).interval);
  assert.ok(api.pointerScroll(1840, 780).interval < api.pointerScroll(1780, 780).interval);
  for (const x of [0, 100, 1800, 1920]) {
    const interval = api.pointerScroll(x, 780).interval;
    assert.ok(interval >= 166 && interval <= 1000);
  }
});
test("pointer growth stays anchored under its tile without growing intermediate apps", () => {
  for (let progress = 0; progress <= 1; progress += 0.125) {
    const weights = Array.from({ length: 20 }, (_, index) => index === 4 ? 1 - progress : index === 9 ? progress : 0);
    const layout = api.railLayout(20, 9, { weights, anchorIndex: 9, center: 1450 });
    assert.equal(layout[9].center, 1450);
    assert.equal(layout[6].scale, 1);
    for (let index = 1; index < layout.length; index++) {
      const gap = layout[index].center - layout[index].width / 2 - layout[index - 1].center - layout[index - 1].width / 2;
      assert.ok(Math.abs(gap - 24) < 0.000001);
    }
  }
});
test("a pointer-to-D-pad handoff preserves its first geometry before returning to center", () => {
  const weights = api.railWeights(20, 5.4);
  const anchored = api.railLayout(20, 9, { weights, anchorIndex: 9, center: 1450 });
  const handedOff = api.railLayout(20, 9, { weights, center: 1450 });
  assert.deepEqual(handedOff, anchored);
  assert.equal(api.railLayout(20, 10)[10].center, 960);
});
test("modest pointer growth keeps every visible tile center fixed without overlapping neighbors", () => {
  const centers = api.railLayout(20, 5).map(card => card.center);
  for (let selected = 0; selected < centers.length; selected++) {
    const weights = api.railWeights(centers.length, selected).map(weight => weight * 0.25);
    const layout = api.pointerLayout(centers, weights);
    assert.deepEqual(layout.map(card => card.center), centers);
    assert.equal(layout[selected].width, 150);
    for (let index = 1; index < layout.length; index++) {
      assert.ok(layout[index].center - layout[index].width / 2 - layout[index - 1].center - layout[index - 1].width / 2 >= 9);
    }
  }
});
test("entering pointer mode removes the former D-pad slot while keeping the hovered app anchored", () => {
  const expanded = api.railLayout(25, 12).map(card => card.center);
  const compact = api.compactPointerCenters(expanded, 8);
  assert.equal(compact[8], expanded[8]);
  for (let index = 1; index < compact.length; index++) assert.equal(compact[index] - compact[index - 1], 144);
  assert.notEqual(expanded[12] - expanded[11], 144);
  assert.equal(compact[12] - compact[11], 144);
});
test("single steps respond faster without changing the continuous held-button motion", () => {
  let single = { position: 5, velocity: 0 }, held = { position: 5, velocity: 0 };
  for (let frame = 0; frame < 8; frame++) {
    single = api.stepRail(single, 6, 1 / 60, 37, 40);
    held = api.stepRail(held, 6, 1 / 60, 37, 24);
  }
  assert.ok(single.position > 5.96);
  assert.ok(held.position < single.position);
  assert.ok(single.position <= 6);
});
test("compact ten-column grid reaches every app and input and exits Up at its first row", () => {
  const items = Array.from({ length: 41 }, (_, index) => ({ id: "app:" + index, kind: "app" }))
    .concat(Array.from({ length: 4 }, (_, index) => ({ id: "input:" + index, kind: "input" })));
  const seen = new Set([0]), queue = [0];
  while (queue.length) {
    const index = queue.shift();
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
      const next = api.moveGrid(items, index, key, 10);
      if (next >= 0 && !seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  assert.equal(seen.size, items.length);
  assert.equal(api.moveGrid(items, 9, "ArrowUp", 10), -1);
});
test("bridge retains pending references until a callback, then releases them", async () => {
  let respond;
  const { client, calls } = mockClient((call, reply) => { respond = reply; });
  const pending = client.launch({ appId: "netflix", params: { start: "native", id: "'; anything" } });
  assert.equal(client.pendingCount(), 1);
  assert.deepEqual(calls[0].payload, { id: "netflix", params: { start: "native", id: "'; anything" } });
  assert.equal(calls[0].uri, "luna://com.webos.applicationManager/launch");
  respond({ returnValue: true });
  await pending;
  assert.equal(client.pendingCount(), 0);
  assert.equal(calls[0].bridge.onservicecallback, null);
});
test("timeout and malformed native response reject and release bridge references", async () => {
  const { client } = mockClient(() => {}, 12);
  await assert.rejects(client.launch({ appId: "netflix" }), error => error.code === "TIMEOUT");
  assert.equal(client.pendingCount(), 0);
  const malformed = mockClient(({ bridge }) => bridge.onservicecallback("not json"));
  await assert.rejects(malformed.client.launch({ appId: "netflix" }), SyntaxError);
  assert.equal(malformed.client.pendingCount(), 0);
});
test("apps and native Settings use their distinct structured public APIs; refusals reject", async () => {
  const { client, calls } = mockClient((call, reply) => reply({ returnValue: true }));
  await client.launch({ appId: "youtube.leanback.v4" });
  await client.openSettings();
  await client.launch({ appId: api.TARGETS.originalHome });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(call => call.payload.id || call.payload.appId), ["youtube.leanback.v4", "com.webos.app.quicksettings", "com.webos.app.home"]);
  assert.equal(calls[1].uri, "luna://com.webos.service.systemUIManager/launch");
  assert.ok(calls.every(call => !call.payload.command));
  const refused = mockClient((call, reply) => reply({ returnValue: false, errorText: "Denied by TV" }));
  await assert.rejects(refused.client.launch({ appId: "netflix" }), /Denied by TV/);
  await assert.rejects(refused.client.openSettings(), /Denied by TV/);
  const ambiguous = mockClient((call, reply) => reply({ id: "netflix" }));
  await assert.rejects(ambiguous.client.launch({ appId: "netflix" }), /acknowledge/);
  await assert.rejects(ambiguous.client.openSettings(), /acknowledge/);
});
test("live inventory uses one fixed app read and direct native inputs, retaining explicitly stale source data", async () => {
  let fail = false;
  const { client, calls } = mockClient((call, reply) => {
    if (call.uri === "luna://com.webos.service.eim/getAllInputStatus") {
      reply(fail ? { returnValue: false, errorText: "input service unavailable" } : { returnValue: true, devices: [{ id: "HDMI_1", hdmiPlugIn: false }] });
    } else reply(envelope(JSON.stringify(apps([app("netflix", "Netflix")]))));
  });
  const first = await client.loadInventory();
  assert.equal(first.items.length, 2); assert.equal(first.errors.length, 0);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].payload, { command: api.COMMANDS.apps });
  assert.equal(calls[1].uri, "luna://com.webos.service.eim/getAllInputStatus");
  assert.deepEqual(calls[1].payload, {});
  assert.ok(Object.values(first.timings).every(value => Number.isFinite(value) && value >= 0));
  fail = true;
  const stale = await client.loadInventory();
  assert.equal(stale.items.length, 2); assert.equal(stale.stale, true);
  assert.match(stale.errors[0], /input service unavailable/);
});
test("failed first TV inventory has explicit errors and no fixture apps", async () => {
  const { client } = mockClient((call, reply) => reply({ returnValue: false, errorText: "Permission denied" }));
  const result = await client.loadInventory();
  assert.equal(result.items.length, 0); assert.equal(result.errors.length, 2);
  assert.ok(result.errors.every(error => error.includes("Permission denied")));
});
test("native icon fallback stays inside guarded read builder and preserves bytes", async () => {
  let count = 0;
  const { client, calls } = mockClient((call, reply) => {
    if (++count === 1) reply({ returnValue: true, error: "FOCUS_ICON_REFUSED" });
    else reply(iconEnvelope(iconBytes));
  });
  const image = await client.readIcon({ appId: "netflix", iconCandidates: [root + "netflix/192.png", root + "netflix/130.png"] });
  assert.equal(image.bytes, iconBytes.length);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.payload.command.startsWith("p=")));
  await assert.rejects(client.readIcon({ appId: "netflix", iconCandidates: ["/etc/passwd"] }), /artwork/);
  assert.equal(calls.length, 2);
});
test("application sources expose no HTML injection, external fetches, shell input, or Home takeover", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "app", "main.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "app", "index.html"), "utf8");
  assert.doesNotMatch(main, /innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function|fetch\(|XMLHttpRequest|WebSocket/);
  assert.doesNotMatch(main, /setDefault|backgroundRootShell|setHome|updater|password|credential/);
  assert.ok(html.includes("connect-src 'none'"));
  assert.doesNotMatch(html, /<input|https?:\/\//);
});

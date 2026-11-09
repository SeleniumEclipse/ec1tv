(function (root) {
  "use strict";
  if (root.FocusWebOS.isTVEnvironment(root)) return;
  var apps = [
    ["com.apple.appletv", "Apple TV"], ["com.disney.disneyplus-prod", "Disney+"],
    ["org.webosbrew.hbchannel", "Homebrew Channel"], ["com.webos.app.discovery", "LG Apps"],
    ["com.palm.app.settings", "LG TV settings"], ["com.webos.app.livetv", "Live TV"],
    ["netflix", "Netflix"], ["youtube.leanback.v4", "YouTube"]
  ].map(function (entry) {
    return { id: entry[0], title: entry[1], lptype: "default", iconColor: entry[0] === "netflix" ? "#ffffff" : "#24405b" };
  });
  for (var n = 1; n <= 32; n++) apps.push({
    id: "preview.sample" + n,
    title: n === 17 ? "Sample 17 — A deliberately long application title that wraps without pushing adjacent destinations off screen" : "Sample app " + String(n).padStart(2, "0"),
    lptype: "default"
  });
  var inputs = [
    { id: "HDMI_1", label: "HDMI 1", hdmiPlugIn: false, connected: true },
    { id: "HDMI_2", label: "Sony DVD Player", hdmiPlugIn: true, hdmiSignalExist: true },
    { id: "HDMI_3", label: "Denon Home Theater", hdmiPlugIn: true, hdmiSignalExist: false },
    { id: "HDMI_4", label: "HDMI 4", hdmiPlugIn: false }
  ];
  root.FocusFixtures = Object.freeze({
    mode: "preview",
    loadInventory: function () {
      return Promise.resolve({
        items: root.FocusWebOS.normalizeInventory({ returnValue: true, launchPoints: apps }, { returnValue: true, devices: inputs }),
        errors: [], stale: false
      });
    },
    launch: function () { return Promise.resolve({ preview: true }); },
    openSettings: function () { return Promise.resolve({ preview: true }); },
    readIcon: function () { return Promise.reject(new Error("Desktop fixture: native TV artwork is unavailable.")); }
  });
})(window);

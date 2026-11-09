(function () {
  "use strict";
  var api = window.FocusWebOS;
  var television = api.isTVEnvironment(window);
  var client = television ? api.createLiveClient() : window.FocusFixtures;
  var $ = function (selector) { return document.querySelector(selector); };
  var screen = $("#screen"), home = $("#home"), rail = $("#apps"), drawer = $("#drawer");
  screen.dataset.scriptStartedMs = String(Math.round(performance.now()));
  var gridContent = $("#grid-content"), scroller = $("#grid-scroll"), menu = $("#menu");
  var motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
  var STORE = "focusstage.preferences.v1";
  var EASE = "cubic-bezier(.22,.75,.22,1)";
  var GRID_COLUMNS = 10;
  var PHOTOS = ["assets/lake-screen.jpg", "assets/gorge-screen.jpg"];
  var PHOTO_REFRESH_INTERVAL = 300000;
  var PHOTO_DISPLAY_INTERVAL = 90000;
  var PHOTO_FADE_DURATION = 2000;
  var PHOTO_IDLE_DELAY = 60000;
  var saved = {};
  try {
    var stored = localStorage.getItem(STORE);
    if (stored && stored.length < 65536) saved = JSON.parse(stored) || {};
  } catch (_) { saved = {}; }
  var prefs = {
    slideshow: saved.slideshow === true,
    autoHideControls: saved.autoHideControls !== false,
    reduceMotion: saved.reduceMotion === true, photo: saved.photo === 1 ? 1 : 0,
    oneDrivePhotos: television && saved.oneDrivePhotos === true,
    cloudPhotoId: api.validPhotoId(saved.cloudPhotoId) ? saved.cloudPhotoId : null,
    railOrder: Array.isArray(saved.railOrder) ? saved.railOrder.filter(function (id) { return typeof id === "string" && id.length < 220; }).slice(0, 128) : [],
    hiddenRail: Array.isArray(saved.hiddenRail) ? saved.hiddenRail.filter(function (id) { return typeof id === "string" && id.length < 220; }).slice(0, 128) : []
  };
  var state = {
    items: [], selected: 0, gridIndex: 0, gridScrollTop: 0, view: null,
    editId: null, editFromGrid: false,
    launchPending: false, launchState: "idle",
    inventoryErrors: [], initialized: false, refresh: null
  };
  var railCards = [], gridCards = [], hosts = [], closeTimers = {};
  var visibleRail = [], railMotion = { position: 0, velocity: 0 }, railTarget = 0, railFrame = null, railTime = 0;
  var railResponse = 40, lastRailInput = 0;
  var navigationMode = "dpad", pointerAnchor = null, railGrowth = null;
  var railEmphasized = true;
  var pointerCenters = null, railOriginCenters = null;
  var railCenter = { position: 960, velocity: 0 }, railCenterTarget = 960;
  var iconCache = new api.IconCache(), attemptedIcons = new Set(), pendingIcons = new Set(), iconErrors = new Map();
  var lastWantedIcons = new Set();
  var launchEpoch = 0;
  var toastTimer = null, lastInteraction = performance.now(), lastPointer = "", photoTimer = null;
  var photoAnimation = null, photoEpoch = 0, artworkFrame = null, lastForeground = 0;
  var cloudPhotos = { items: [], order: [], loadedAt: -Infinity, loading: null, reading: false, restart: false, generation: 0, error: "", pageCount: 0 };
  var photoSyncTimer = null;
  var lastInventoryAt = -Infinity, returnedFromBackground = false;
  var returningFocus = null;
  var pointerTimer = null, pointerIntent = { direction: 0 }, pointerPosition = null, pointerMode = false;
  var pointerArmedAt = 0, pointerLastStepAt = 0;
  var windowFocused = true, wheelAmount = 0, lastWheelAt = 0;
  var heldPress = null, holdTimer = null, suppressCardClickUntil = 0;
  var idleTimer = null, idleMotionTimer = null, photoIdle = false, idleFocus = null;
  var wakeKey = null, wakePointer = false, wakeClickUntil = 0, lastIdlePointer = "";

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function reduced() { return prefs.reduceMotion || motionQuery.matches; }
  function syncMotion() {
    document.body.classList.toggle("reduced-motion", reduced());
    if (reduced()) {
      if (photoAnimation) photoAnimation.finish();
      updateRail(true);
    }
  }
  function selectedItem() { return state.items[state.selected]; }
  function snapshot() {
    return {
      selectedId: selectedItem() ? selectedItem().id : saved.selectedId,
      index: state.selected,
      gridId: state.items[state.gridIndex] ? state.items[state.gridIndex].id : saved.gridId,
      gridScrollTop: state.gridScrollTop,
      slideshow: prefs.slideshow, reduceMotion: prefs.reduceMotion, photo: prefs.photo,
      autoHideControls: prefs.autoHideControls,
      oneDrivePhotos: prefs.oneDrivePhotos, cloudPhotoId: prefs.cloudPhotoId,
      railOrder: prefs.railOrder, hiddenRail: prefs.hiddenRail
    };
  }
  function persist() {
    try { localStorage.setItem(STORE, JSON.stringify(snapshot())); } catch (_) { /* Navigation still works without storage. */ }
  }
  function toast(text) {
    clearTimeout(toastTimer);
    $("#toast").textContent = text;
    $("#toast").hidden = false;
    toastTimer = setTimeout(function () { $("#toast").hidden = true; }, 6500);
  }
  function noteInteraction() {
    if (photoIdle) setPhotoIdle(false);
    lastInteraction = performance.now();
    if (photoAnimation) photoAnimation.finish();
    schedulePhotos();
    scheduleIdle();
  }
  function setPhotoIdle(value) {
    if (photoIdle === value) return;
    if (value) { idleFocus = document.activeElement; stopPointer(); cancelHold(); }
    photoIdle = value;
    screen.dataset.photoIdle = String(value);
    document.body.classList.add("idle-transition");
    document.body.classList.toggle("photo-idle", value);
    clearTimeout(idleMotionTimer);
    idleMotionTimer = setTimeout(function () { document.body.classList.remove("idle-transition"); }, 650);
    if (value) { clearTimeout(toastTimer); $("#toast").hidden = true; }
    lockHome();
    if (!value) {
      var previousFocus = idleFocus;
      idleFocus = null;
      if (previousFocus && previousFocus.isConnected && !previousFocus.closest("[hidden]")) previousFocus.focus({ preventScroll: true });
      else focusSelection();
    }
  }
  function scheduleIdle(delay) {
    clearTimeout(idleTimer);
    if (!prefs.autoHideControls || photoIdle || document.hidden || !windowFocused) return;
    idleTimer = setTimeout(function () {
      if (!state.initialized || state.view || state.launchPending || heldPress || screen.dataset.railMoving === "true") { scheduleIdle(5000); return; }
      if (performance.now() - lastInteraction < PHOTO_IDLE_DELAY) { scheduleIdle(); return; }
      setPhotoIdle(true);
    }, delay === undefined ? Math.max(250, PHOTO_IDLE_DELAY - (performance.now() - lastInteraction)) : delay);
  }
  function resize() {
    var scale = Math.min(innerWidth / 1920, innerHeight / 1080);
    screen.style.transform = "scale(" + scale + ")";
    screen.style.left = Math.max(0, (innerWidth - 1920 * scale) / 2) + "px";
    screen.style.top = Math.max(0, (innerHeight - 1080 * scale) / 2) + "px";
  }
  function lockHome() {
    var locked = !!state.view || photoIdle;
    home.inert = locked;
    home.setAttribute("aria-hidden", String(locked));
  }
  function iconKey(item) { return item.appId + "|" + item.iconCandidates.join("|"); }
  function fallback(host, item, message) {
    var key = "fallback:" + item.kind + ":" + message;
    if (host._painted === key) return;
    var image = element("img", "fallback-icon");
    image.src = item.kind === "input" ? "assets/input.svg" : "assets/grid.svg";
    image.alt = "";
    var note = element("span", "artwork-note", item.kind === "input" ? "HDMI " + item.port : message);
    host.replaceChildren(image, note);
    host._painted = key;
  }
  function desiredArtwork() {
    var wanted = new Set();
    currentRailLayouts().forEach(function (layout, rank) {
      if (layout.center + layout.width / 2 >= -144 && layout.center - layout.width / 2 <= 2064) wanted.add(visibleRail[rank]);
    });
    if (state.view === "all-apps" || (state.view === "edit-app" && state.editFromGrid)) {
      var bounds = scroller.getBoundingClientRect(), margin = 280 * screen.getBoundingClientRect().width / 1920;
      gridCards.forEach(function (card, index) {
        var rect = card.getBoundingClientRect();
        if (rect.bottom >= bounds.top - margin && rect.top <= bounds.bottom + margin) wanted.add(index);
      });
    }
    return wanted;
  }
  function paintArtwork() {
    artworkFrame = null;
    var wanted = desiredArtwork();
    var wantedIcons = new Set();
    wanted.forEach(function (index) {
      var key = iconKey(state.items[index]);
      wantedIcons.add(key);
      if (!lastWantedIcons.has(key) && !pendingIcons.has(key) && !iconCache.get(key) && !iconErrors.has(key)) attemptedIcons.delete(key);
    });
    lastWantedIcons = wantedIcons;
    hosts.forEach(function (record) {
      var item = state.items[record.index], host = record.node;
      var visible = wanted.has(record.index) && (!record.grid || state.view === "all-apps" || (state.view === "edit-app" && state.editFromGrid));
      if (!visible && !host._painted) return;
      var cached = visible && iconCache.get(iconKey(item));
      if (cached) {
        if (host._painted !== cached.dataUrl) {
          var image = element("img", "native-art");
          image.alt = "";
          image.addEventListener("load", function () {
            if (!screen.dataset.firstArtworkMs) screen.dataset.firstArtworkMs = String(Math.round(performance.now()));
          }, { once: true });
          image.src = cached.dataUrl;
          image.addEventListener("error", function () {
            iconCache.remove(iconKey(item));
            iconErrors.set(iconKey(item), "The native image could not be decoded.");
            scheduleArtwork();
            updateStatus();
          }, { once: true });
          host.replaceChildren(image);
          host._painted = cached.dataUrl;
        }
      } else {
        var message = !television ? "Preview artwork" : !item.iconCandidates.length || iconErrors.has(iconKey(item)) ? "Icon unavailable" : attemptedIcons.has(iconKey(item)) && !pendingIcons.has(iconKey(item)) ? "Icon not cached" : "Loading icon";
        fallback(host, item, message);
      }
    });
    if (!television || document.hidden) return;
    var ordered = Array.from(wanted).sort(function (a, b) { return Math.abs(a - state.selected) - Math.abs(b - state.selected); });
    for (var n = 0; n < ordered.length && pendingIcons.size < 2; n++) {
      var item = state.items[ordered[n]], key = iconKey(item);
      if (!item.iconCandidates.length || iconCache.get(key) || attemptedIcons.has(key)) continue;
      attemptedIcons.add(key);
      pendingIcons.add(key);
      (function (destination, cacheKey) {
        client.readIcon(destination).then(function (value) {
          iconCache.put(cacheKey, value);
        }).catch(function (error) {
          iconErrors.set(cacheKey, error.message);
        }).finally(function () {
          pendingIcons.delete(cacheKey);
          updateStatus();
          scheduleArtwork();
        });
      })(item, key);
    }
  }
  function scheduleArtwork() {
    if (artworkFrame === null) artworkFrame = requestAnimationFrame(paintArtwork);
  }
  function updateStatus() {
    var messages = state.inventoryErrors.slice();
    var item = selectedItem();
    if (item && iconErrors.has(iconKey(item))) messages.push(item.title + " artwork: " + iconErrors.get(iconKey(item)));
    if (messages.length) messages.push("Menu → Refresh apps & inputs retries reads. No preview data is substituted.");
    var status = $("#inventory-status");
    status.textContent = messages.join("\n");
    status.hidden = !messages.length;
    status.classList.toggle("error", messages.length > 0);
  }
  function makeCard(item, index, grid) {
    var button = element("button", grid ? "grid-card" : "app-position");
    button.type = "button";
    button.dataset.id = item.id;
    button.dataset.index = String(index);
    button.title = item.title + (item.kind === "input" ? " — " + item.detail : "");
    button.setAttribute("aria-label", button.title);
    button.style.setProperty("--app-surface", api.surfaceColor(item.ownerColor, false));
    var tile = element("span", grid ? "drawer-icon" : "tile");
    var art = element("span", "artwork");
    art.setAttribute("aria-hidden", "true");
    tile.append(art);
    hosts.push({ node: art, index: index, grid: grid });
    var title = element("span", grid ? "drawer-label" : "app-label", item.title);
    button.append(tile, title);
    button._tile = tile; button._label = title;
    if (grid && item.kind === "input") button.append(element("span", "input-detail", "HDMI " + item.port + " · " + (item.plugged ? "Connected" : "Not connected")));
    button.addEventListener("focus", function () {
      if (grid && state.view === "all-apps") chooseGrid(index, false, false);
      else if (!grid && !state.view) {
        if (index !== state.selected) centeredNavigation();
        chooseRail(index, false);
      }
    });
    button.addEventListener("pointermove", function (event) {
      if (!grid) return;
      var point = event.clientX + ":" + event.clientY;
      if (point === lastPointer || (grid ? state.view !== "all-apps" : state.view)) return;
      lastPointer = point;
      noteInteraction();
      chooseGrid(index, true, false);
    });
    button.addEventListener("pointerdown", function (event) {
      if (event.button !== 0 || (grid ? state.view !== "all-apps" : state.view)) return;
      event.preventDefault();
      if (!grid) selectPointerTile(index, false);
      beginHold(index, grid, "pointer");
    });
    button.addEventListener("pointerup", function (event) {
      if (heldPress && heldPress.mode === "pointer") {
        if (heldPress.triggered) { event.preventDefault(); suppressCardClickUntil = performance.now() + 150; }
        cancelHold();
      }
    });
    button.addEventListener("pointercancel", cancelHold);
    button.addEventListener("pointerleave", function () { if (heldPress && heldPress.mode === "pointer" && !heldPress.triggered) cancelHold(); });
    button.addEventListener("contextmenu", function (event) {
      event.preventDefault();
      if (grid ? state.view !== "all-apps" : state.view) return;
      cancelHold();
      if (!grid) selectPointerTile(index, false);
      openAppEditor(index, grid);
    });
    button.addEventListener("click", function (event) {
      if (performance.now() < suppressCardClickUntil) return;
      if (grid ? state.view !== "all-apps" : state.view) return;
      if (grid) chooseGrid(index, false, false);
      else if (event.detail > 0) selectPointerTile(index, false);
      else chooseRail(index, false);
      launch(item);
    });
    return button;
  }
  function renderCollection() {
    rail.replaceChildren();
    gridContent.replaceChildren();
    hosts = []; railCards = []; gridCards = [];
    var previousRank = visibleRail.indexOf(state.selected);
    visibleRail = api.railIndices(state.items, prefs.railOrder, prefs.hiddenRail);
    if (!visibleRail.includes(state.selected)) state.selected = visibleRail[Math.max(0, Math.min(visibleRail.length - 1, previousRank))] || 0;
    railGrowth = null;
    pointerCenters = null; railOriginCenters = null;
    pointerAnchor = navigationMode === "pointer" ? visibleRail.indexOf(state.selected) : null;
    var groups = {};
    state.items.forEach(function (item, index) {
      if (visibleRail.includes(index)) {
        var card = makeCard(item, index, false);
        railCards[index] = card; rail.append(card);
      }
      if (!groups[item.kind]) {
        var section = element("section", "grid-section");
        section.append(element("h3", "", item.kind === "input" ? "Inputs" : "Apps"));
        groups[item.kind] = element("div", "app-grid");
        section.append(groups[item.kind]); gridContent.append(section);
      }
      var gridCard = makeCard(item, index, true);
      gridCards.push(gridCard); groups[item.kind].append(gridCard);
    });
    updateRail(true);
    updateGrid();
    scroller.scrollTop = state.gridScrollTop;
    requestAnimationFrame(fitLabels);
    scheduleArtwork();
  }
  function fitLabel(node, railLabel) {
    if (!node || !node.clientWidth || !node.clientHeight) return;
    var width = node.style.width;
    if (railLabel) node.style.width = "132px";
    var size = 24;
    node.style.fontSize = size + "px";
    while (size > 8 && (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1)) {
      node.style.fontSize = (--size) + "px";
    }
    if (railLabel) { node._compactFontSize = size; node.style.width = width; }
  }
  function fitLabels() {
    railCards.forEach(function (card) { fitLabel(card._label, true); });
    if (railCards[state.selected] && screen.dataset.railMoving !== "true") fitLabel(railCards[state.selected]._label, false);
    gridCards.forEach(function (card) { fitLabel(card.querySelector(".drawer-label"), false); });
  }
  function targetRailWeights() {
    var amount = railEmphasized ? navigationMode === "pointer" ? 0.25 : 1 : 0;
    return api.railWeights(visibleRail.length, railMotion.position).map(function (weight) { return weight * amount; });
  }
  function motionWeights() {
    var target = targetRailWeights();
    if (!railGrowth) return target;
    return target.map(function (weight, index) { return railGrowth.from[index] + (weight - railGrowth.from[index]) * railGrowth.motion.position; });
  }
  function growFrom(weights) {
    var target = targetRailWeights();
    railGrowth = railOriginCenters || weights.some(function (weight, index) { return Math.abs(weight - target[index]) > 0.000001; })
      ? { from: weights, motion: { position: 0, velocity: 0 } } : null;
  }
  function emphasizeRail(value) {
    if (railEmphasized === value) return;
    var weights = motionWeights();
    railEmphasized = value;
    home.classList.toggle("rail-unfocused", !value);
    screen.dataset.railEmphasized = String(value);
    growFrom(weights);
    updateRail();
  }
  function currentRailLayouts() {
    var weights = motionWeights();
    var layouts = pointerCenters ? api.pointerLayout(pointerCenters, weights) : api.railLayout(visibleRail.length, railMotion.position, {
      weights: weights, center: railCenter.position, anchorIndex: pointerAnchor
    });
    if (railOriginCenters && railGrowth) {
      layouts.forEach(function (layout, index) {
        layout.center = railOriginCenters[index] + (layout.center - railOriginCenters[index]) * railGrowth.motion.position;
        layout.left = layout.center - 60;
        layout.baseLeft = layout.left - layout.railOffset;
      });
    }
    return layouts;
  }
  function centeredNavigation() {
    if (navigationMode === "dpad" && pointerAnchor === null && railCenterTarget === 960) return;
    var weights = motionWeights();
    if (pointerCenters) railOriginCenters = currentRailLayouts().map(function (layout) { return layout.center; });
    pointerCenters = null;
    pointerAnchor = null;
    navigationMode = "dpad";
    screen.dataset.navigationMode = navigationMode;
    railCenterTarget = 960;
    growFrom(weights);
    updateRail();
  }
  function pointerScrollNavigation() {
    if (navigationMode === "pointer" && pointerAnchor === null && !pointerCenters) return;
    var weights = motionWeights();
    if (pointerCenters) railOriginCenters = currentRailLayouts().map(function (layout) { return layout.center; });
    pointerCenters = null;
    pointerAnchor = null;
    navigationMode = "pointer";
    screen.dataset.navigationMode = navigationMode;
    railCenterTarget = railCenter.position;
    railCenter.velocity = 0;
    growFrom(weights);
  }
  function selectPointerTile(index, focus) {
    var rank = visibleRail.indexOf(index), card = railCards[index];
    if (rank < 0 || !card || state.view) return;
    emphasizeRail(true);
    if (state.selected === index && navigationMode === "pointer" && pointerAnchor === rank && pointerCenters) {
      if (focus) card.focus({ preventScroll: true });
      return;
    }
    var weights = motionWeights();
    if (!pointerCenters) {
      railOriginCenters = currentRailLayouts().map(function (layout) { return layout.center; });
      pointerCenters = api.compactPointerCenters(railOriginCenters, rank);
    } else if (railOriginCenters) railOriginCenters = currentRailLayouts().map(function (layout) { return layout.center; });
    var center = pointerCenters[rank];
    navigationMode = "pointer";
    screen.dataset.navigationMode = navigationMode;
    pointerAnchor = rank;
    railCenter = { position: center, velocity: 0 };
    railCenterTarget = center;
    railMotion = { position: rank, velocity: 0 };
    growFrom(weights);
    noteInteraction();
    chooseRail(index, focus);
    updateRail();
  }
  function paintRail() {
    var layouts = currentRailLayouts();
    rail.style.transform = "translate3d(" + (layouts.length ? layouts[0].railOffset : 0) + "px,0,0)";
    layouts.forEach(function (layout, rank) {
      var card = railCards[visibleRail[rank]];
      if (card._baseLeft !== layout.baseLeft) {
        card.style.transform = "translate3d(" + layout.baseLeft + "px,0,0)";
        card._baseLeft = layout.baseLeft;
      }
      if (card._scale !== layout.scale) {
        card._tile.style.transform = "scale(" + layout.scale + ")";
        card._scale = layout.scale;
      }
      var labelWidth = navigationMode === "pointer" ? 132 : layout.width + 12;
      if (card._labelWidth !== labelWidth) {
        card._label.style.width = labelWidth + "px";
        card._label.style.left = (60 - labelWidth / 2) + "px";
        card._labelWidth = labelWidth;
      }
    });
    screen.dataset.railPosition = String(railMotion.position);
    screen.dataset.railCenter = String(railCenter.position);
  }
  function railTick(timestamp) {
    railFrame = null;
    var elapsed = railTime ? (timestamp - railTime) / 1000 : 1 / 60;
    if (pointerAnchor === null) railMotion = api.stepRail(railMotion, railTarget, elapsed, visibleRail.length, railResponse);
    else railMotion = { position: railTarget, velocity: 0 };
    railCenter = api.stepRail(railCenter, railCenterTarget, elapsed, 1921, 40);
    if (railGrowth) {
      railGrowth.motion = api.stepRail(railGrowth.motion, 1, elapsed, 2, 40);
      if (railGrowth.motion.position === 1 && railGrowth.motion.velocity === 0) { railGrowth = null; railOriginCenters = null; }
    }
    railTime = timestamp;
    paintRail();
    if (railGrowth || railMotion.position !== railTarget || railMotion.velocity !== 0 || railCenter.position !== railCenterTarget || railCenter.velocity !== 0) railFrame = requestAnimationFrame(railTick);
    else {
      screen.dataset.railMoving = "false"; railTime = 0;
      if (railCards[state.selected]) fitLabel(railCards[state.selected].querySelector(".app-label"), false);
      scheduleArtwork();
    }
  }
  function updateRail(immediate) {
    railTarget = Math.max(0, visibleRail.indexOf(state.selected));
    railCards.forEach(function (card, index) {
      var wasSelected = card.classList.contains("selected");
      card.classList.toggle("selected", index === state.selected);
      card.setAttribute("aria-pressed", String(railEmphasized && index === state.selected));
      card.tabIndex = index === state.selected ? 0 : -1;
      if (wasSelected && index !== state.selected) card._label.style.fontSize = (card._label._compactFontSize || 24) + "px";
    });
    if (immediate || reduced() || state.view || !state.initialized) {
      if (railFrame !== null) cancelAnimationFrame(railFrame);
      railFrame = null; railTime = 0;
      railMotion = { position: railTarget, velocity: 0 };
      railCenter = { position: railCenterTarget, velocity: 0 };
      railGrowth = null;
      railOriginCenters = null;
      paintRail();
      screen.dataset.railMoving = "false";
    } else if (railGrowth || railMotion.position !== railTarget || railMotion.velocity !== 0 || railCenter.position !== railCenterTarget || railCenter.velocity !== 0) {
      screen.dataset.railMoving = "true";
      if (railFrame === null) railFrame = requestAnimationFrame(railTick);
    }
    if (railCards[state.selected]) {
      var selectedLabel = railCards[state.selected]._label;
      if (screen.dataset.railMoving === "true") selectedLabel.style.fontSize = (selectedLabel._compactFontSize || 24) + "px";
      else fitLabel(selectedLabel, false);
    }
    $('[data-action="previous"]').disabled = !visibleRail.length || railTarget === 0;
    $('[data-action="next"]').disabled = !visibleRail.length || railTarget === visibleRail.length - 1;
    updateStatus();
  }
  function chooseRail(index, focus) {
    if (!visibleRail.includes(index)) return;
    if (state.selected !== index) {
      var now = performance.now();
      railResponse = now - lastRailInput < 160 ? 24 : 40;
      lastRailInput = now;
      state.selected = index;
      state.gridIndex = state.selected;
      updateRail();
      persist();
      scheduleArtwork();
    }
    if (focus && document.activeElement !== railCards[state.selected]) railCards[state.selected].focus({ preventScroll: true });
  }
  function moveRail(direction, focus) {
    var rank = visibleRail.indexOf(state.selected);
    chooseRail(visibleRail[Math.max(0, Math.min(visibleRail.length - 1, rank + direction))], focus);
  }
  function stopPointer() {
    clearTimeout(pointerTimer);
    pointerTimer = null;
    pointerIntent = { direction: 0 };
    pointerArmedAt = 0; pointerLastStepAt = 0;
    screen.dataset.pointerScrolling = "false";
  }
  function pointerTick() {
    pointerTimer = null;
    if (!pointerMode || !windowFocused || state.view || state.launchPending || document.hidden) { stopPointer(); return; }
    var before = state.selected;
    noteInteraction();
    pointerScrollNavigation();
    moveRail(pointerIntent.direction, true);
    if (state.selected === before) { stopPointer(); return; }
    pointerLastStepAt = performance.now();
    screen.dataset.pointerScrolling = "true";
    pointerTimer = setTimeout(pointerTick, pointerIntent.interval);
  }
  function pointerMove(event) {
    var bounds = screen.getBoundingClientRect(), scale = bounds.width / 1920;
    var point = { x: (event.clientX - bounds.left) / scale, y: (event.clientY - bounds.top) / scale };
    if (pointerPosition && Math.abs(point.x - pointerPosition.x) + Math.abs(point.y - pointerPosition.y) < 3) return;
    pointerPosition = point;
    if (!windowFocused || state.view || state.launchPending || document.hidden ||
        (event.target.closest && event.target.closest(".toolbar,.footer,.browse-arrow,.overlay"))) { stopPointer(); return; }
    pointerMode = true;
    var intent = api.pointerScroll(point.x, point.y);
    if (!intent.direction) {
      stopPointer();
      var card = event.target.closest && event.target.closest(".app-position");
      if (card && point.y >= 570 && point.y <= 960) selectPointerTile(Number(card.dataset.index), true);
      return;
    }
    var unchangedDirection = intent.direction === pointerIntent.direction;
    pointerIntent = intent;
    var now = performance.now();
    if (!unchangedDirection) { pointerArmedAt = now; pointerLastStepAt = 0; }
    clearTimeout(pointerTimer);
    var due = pointerLastStepAt ? pointerLastStepAt + intent.interval : pointerArmedAt + intent.dwell;
    screen.dataset.pointerScrolling = pointerLastStepAt ? "true" : "armed";
    pointerTimer = setTimeout(pointerTick, Math.max(0, due - now));
  }
  function updateGrid() {
    gridCards.forEach(function (card, index) {
      card.classList.toggle("selected", index === state.gridIndex);
      card.setAttribute("aria-pressed", String(index === state.gridIndex));
      card.tabIndex = index === state.gridIndex ? 0 : -1;
    });
    var item = state.items[state.gridIndex];
    $("#drawer-detail").textContent = item ? item.title + (item.kind === "input" ? " · " + item.detail : "") : "No destinations were returned. Back → Menu → Refresh apps & inputs.";
  }
  function revealGridCard() {
    var card = gridCards[state.gridIndex];
    if (!card || state.view !== "all-apps") return;
    var scale = screen.getBoundingClientRect().width / 1920;
    var bounds = scroller.getBoundingClientRect(), rect = card.getBoundingClientRect();
    if (rect.top < bounds.top + 10 * scale) scroller.scrollTop -= (bounds.top + 10 * scale - rect.top) / scale;
    else if (rect.bottom > bounds.bottom - 20 * scale) scroller.scrollTop += (rect.bottom - bounds.bottom + 20 * scale) / scale;
    state.gridScrollTop = scroller.scrollTop;
  }
  function chooseGrid(index, focus, reveal) {
    state.gridIndex = Math.max(0, Math.min(state.items.length - 1, index));
    updateGrid();
    if (gridCards[state.gridIndex]) fitLabel(gridCards[state.gridIndex].querySelector(".drawer-label"), false);
    if (focus && gridCards[state.gridIndex] && document.activeElement !== gridCards[state.gridIndex]) gridCards[state.gridIndex].focus({ preventScroll: true });
    if (reveal) revealGridCard();
    persist();
    scheduleArtwork();
  }
  function focusSelection() {
    var card = railCards[state.selected];
    (card || $('[data-action="menu"]')).focus({ preventScroll: true });
  }
  function openDrawer() {
    cancelHold();
    stopPointer();
    clearTimeout(closeTimers.drawer);
    noteInteraction();
    state.view = "all-apps";
    updateRail(true);
    drawer.hidden = false; drawer.inert = false;
    document.body.classList.add("drawer-open");
    drawer.getBoundingClientRect();
    drawer.classList.add("is-open");
    lockHome();
    fitLabels();
    chooseGrid(state.gridIndex, true, true);
    scheduleArtwork();
  }
  function closeDrawer(immediate, focus) {
    if (state.view === "all-apps") state.view = null;
    state.gridScrollTop = scroller.scrollTop;
    persist();
    drawer.classList.remove("is-open");
    drawer.inert = true;
    document.body.classList.remove("drawer-open");
    clearTimeout(closeTimers.drawer);
    if (immediate || reduced()) drawer.hidden = true;
    else closeTimers.drawer = setTimeout(function () { drawer.hidden = true; }, 360);
    lockHome();
    if (focus !== false) focusSelection();
    scheduleArtwork();
  }
  function menuButton(title, action) {
    var button = element("button", "menu-option", title);
    button.type = "button";
    button.dataset.menuAction = action;
    button.addEventListener("click", function () { menuAction(action, button); });
    return button;
  }
  function menuToggle(title, action, checked) {
    var label = element("label", "menu-option menu-toggle");
    var input = element("input", "menu-check");
    input.type = "checkbox";
    input.checked = checked;
    input.dataset.menuAction = action;
    input.addEventListener("change", function () { menuAction(action, input); });
    label.append(element("span", "", title), input);
    return label;
  }
  function cancelHold() { clearTimeout(holdTimer); holdTimer = null; heldPress = null; }
  function beginHold(index, grid, mode) {
    if (state.launchPending || heldPress || !state.items[index]) return;
    stopPointer();
    heldPress = { index: index, grid: grid, mode: mode, triggered: false };
    holdTimer = setTimeout(function () {
      if (!heldPress || document.hidden || !windowFocused) { cancelHold(); return; }
      heldPress.triggered = true;
      suppressCardClickUntil = performance.now() + 150;
      openAppEditor(index, grid);
    }, 650);
  }
  function openAppEditor(index, grid) {
    if (!state.items[index] || state.launchPending) return;
    var bounds = screen.getBoundingClientRect(), scale = bounds.width / 1920;
    var tile = (grid ? gridCards[index] : railCards[index])._tile.getBoundingClientRect();
    var panelWidth = grid ? 84 : 224, panelHeight = grid ? 84 : 148;
    menu.style.setProperty("--edit-left", Math.max(24, Math.min(1920 - panelWidth - 24, (tile.left + tile.width / 2 - bounds.left) / scale - panelWidth / 2)) + "px");
    menu.style.setProperty("--edit-top", Math.max(24, Math.min(1080 - panelHeight - 24, (tile.top - bounds.top) / scale - panelHeight - 16)) + "px");
    state.editId = state.items[index].id;
    state.editFromGrid = grid;
    if (grid) drawer.inert = true;
    else chooseRail(index, false);
    openMenu("edit-app");
  }
  function renderAppEditor(content) {
    var index = state.items.findIndex(function (item) { return item.id === state.editId; });
    var item = state.items[index];
    if (!item) return;
    $("#menu-title").textContent = item.title;
    var controls = element("div", "context-controls"), rank = visibleRail.indexOf(index);
    (state.editFromGrid ? ["visible"] : ["left", "confirm", "right", "visible"]).forEach(function (action) {
      var button = element("button", "editor-move " + action), image = element("img");
      button.type = "button";
      button.dataset.railAction = action;
      button.title = action === "confirm" ? "Confirm" : action === "visible" ? (rank < 0 ? "Show on rail" : "Hide from rail") : "Move " + action + " on rail";
      button.setAttribute("aria-label", button.title);
      if (action === "left" || action === "right") button.disabled = rank < 0 || (action === "left" ? rank === 0 : rank === visibleRail.length - 1);
      if (action === "visible") {
        button.dataset.menuAction = "rail-visible";
        button.classList.toggle("show-on-rail", rank < 0);
      }
      image.src = "assets/" + (action === "confirm" ? "lucide-check.svg" : action === "visible" ? "lucide-x.svg" : "lucide-chevron-up.svg");
      image.alt = "";
      button.append(image);
      button.addEventListener("click", function () { if (action === "confirm") closeMenu(false); else editRail(action); });
      controls.append(button);
    });
    content.append(controls);
  }
  function editRail(action) {
    if (state.editFromGrid && action !== "visible") return;
    var index = state.items.findIndex(function (item) { return item.id === state.editId; });
    if (index < 0) return;
    var rank = visibleRail.indexOf(index);
    if (action === "visible") {
      if (rank >= 0 && visibleRail.length === 1) { toast("Keep at least one app or input on the rail."); return; }
      prefs.hiddenRail = prefs.hiddenRail.filter(function (id) { return id !== state.editId; });
      if (rank >= 0) prefs.hiddenRail.push(state.editId);
    } else {
      var next = rank + (action === "left" ? -1 : 1);
      if (rank < 0 || next < 0 || next >= visibleRail.length) return;
      var order = api.railIndices(state.items, prefs.railOrder, []);
      var from = order.indexOf(index), to = order.indexOf(visibleRail[next]);
      order[from] = order[to]; order[to] = index;
      prefs.railOrder = order.map(function (itemIndex) { return state.items[itemIndex].id; });
    }
    renderCollection();
    persist();
    if (action === "visible") { closeMenu(false); return; }
    renderMenu();
    $('[data-rail-action="confirm"]').focus({ preventScroll: true });
  }
  function renderMenu() {
    var content = $("#menu-content");
    content.replaceChildren();
    menu.classList.toggle("editing", state.view === "edit-app");
    menu.classList.toggle("grid-edit", state.view === "edit-app" && state.editFromGrid);
    $('[data-action="close-menu"]').textContent = state.view === "edit-app" ? "Done" : "Back";
    if (state.view === "edit-app") renderAppEditor(content);
    else if (state.view === "photos") {
      $("#menu-title").textContent = "Photos";
      content.append(
        menuButton("Next photo", "photo-next"),
        menuToggle("Slideshow", "slideshow", prefs.slideshow),
        menuToggle("Auto-hide controls", "auto-hide-controls", prefs.autoHideControls)
      );
      if (television) content.append(menuToggle("OneDrive photos", "onedrive-photos", prefs.oneDrivePhotos));
      if (prefs.oneDrivePhotos) {
        content.append(menuButton("Refresh photos", "photo-refresh"));
        content.append(element("p", "menu-note", cloudPhotos.error ||
          (cloudPhotos.loading ? "Loading OneDrive photos..." : "Apps / Focus Stage")));
        content.querySelector('[data-menu-action="photo-next"]').disabled = cloudPhotos.reading;
        content.querySelector('[data-menu-action="photo-refresh"]').disabled = Boolean(cloudPhotos.loading || cloudPhotos.reading);
      } else content.append(element("p", "menu-note", "Photos: GlacierNPS / public domain"));
    } else {
      $("#menu-title").textContent = "Menu";
      content.append(
        menuButton("LG TV settings", "settings"),
        menuButton("Original LG Home", "originalHome"),
        menuButton("Refresh apps & inputs", "refresh"),
        menuToggle("Reduced motion", "motion", prefs.reduceMotion)
      );
    }
  }
  function openMenu(mode) {
    if (mode !== "edit-app") cancelHold();
    stopPointer();
    noteInteraction();
    if (mode === "photos" || mode === "menu") emphasizeRail(false);
    clearTimeout(closeTimers.menu);
    returningFocus = document.activeElement;
    state.view = mode;
    menu.hidden = false; menu.inert = false;
    renderMenu();
    menu.getBoundingClientRect();
    menu.classList.add("is-open");
    lockHome();
    (mode === "edit-app" ? $(state.editFromGrid ? '[data-rail-action="visible"]' : '[data-rail-action="confirm"]') : $("#menu-content button:not(:disabled)")).focus({ preventScroll: true });
  }
  function closeMenu(immediate, focus) {
    cancelHold();
    var editingGrid = state.view === "edit-app" && state.editFromGrid;
    var returnToGrid = editingGrid && !immediate;
    if (state.view === "menu" || state.view === "photos" || state.view === "edit-app") state.view = null;
    menu.classList.remove("is-open"); menu.inert = true;
    clearTimeout(closeTimers.menu);
    if (immediate || reduced()) menu.hidden = true;
    else closeTimers.menu = setTimeout(function () { menu.hidden = true; }, 180);
    lockHome();
    if (returnToGrid) openDrawer();
    else {
      if (editingGrid) closeDrawer(true, false);
      if (focus !== false) {
        if (returningFocus && returningFocus.isConnected && !returningFocus.closest("[hidden]")) returningFocus.focus({ preventScroll: true });
        else focusSelection();
      }
    }
  }
  function menuAction(action, button) {
    noteInteraction();
    if (action === "rail-visible") { editRail("visible"); return; }
    if (action === "settings") {
      if (state.launchPending) return;
      closeMenu(true, false);
      focusSelection();
      var settingsEpoch = ++launchEpoch;
      state.launchPending = true;
      setLaunchState("settings-pending");
      client.openSettings().then(function (response) {
        if (settingsEpoch !== launchEpoch) return;
        state.launchPending = false;
        setLaunchState("idle");
        lockHome();
        if (response.preview) toast("Desktop preview: the native LG Settings panel is not available here.");
      }).catch(function (error) {
        if (settingsEpoch !== launchEpoch) return;
        state.launchPending = false;
        setLaunchState("idle");
        lockHome();
        toast("Could not open LG Settings: " + error.message);
      });
      return;
    }
    if (action === "originalHome") {
      launch({
        id: "action:" + action, appId: api.TARGETS[action], title: "Original LG Home",
        kind: "app", iconCandidates: [], ownerColor: null
      });
      return;
    }
    if (action === "refresh") {
      closeMenu(true);
      attemptedIcons = new Set(pendingIcons);
      iconErrors.clear();
      refreshInventory();
      return;
    }
    if (action === "photo-next") { nextPhoto(true); return; }
    if (action === "onedrive-photos") {
      prefs.oneDrivePhotos = !prefs.oneDrivePhotos;
      cloudPhotos.generation++;
      cloudPhotos.error = "";
      ++photoEpoch;
      if (photoAnimation) photoAnimation.cancel();
      photoAnimation = null;
      $("#photo-next").removeAttribute("src");
      $("#photo-next").style.opacity = "0";
      persist();
      if (prefs.oneDrivePhotos) requestCloudPhoto(true, true);
      else changePhoto(prefs.photo, true);
      refreshPhotoMenu();
      schedulePhotos();
      schedulePhotoSync();
      return;
    }
    if (action === "photo-refresh") {
      cloudPhotos.loadedAt = -Infinity;
      requestCloudPhoto(true, true);
      return;
    }
    if (action === "slideshow") prefs.slideshow = !prefs.slideshow;
    if (action === "auto-hide-controls") { prefs.autoHideControls = !prefs.autoHideControls; scheduleIdle(); }
    if (action === "motion") prefs.reduceMotion = !prefs.reduceMotion;
    persist();
    syncMotion();
    renderMenu();
    var replacement = Array.from(menu.querySelectorAll("[data-menu-action]")).find(function (node) { return node.dataset.menuAction === action; });
    if (replacement) replacement.focus({ preventScroll: true });
    schedulePhotos();
  }
  function setLaunchState(value) { state.launchState = value; screen.dataset.launchState = value; }
  function animate(elementNode, frames, duration) {
    if (reduced()) { Object.assign(elementNode.style, frames[frames.length - 1]); return null; }
    return elementNode.animate(frames, { duration: duration, easing: EASE, fill: "both" });
  }
  function launch(item) {
    stopPointer();
    if (state.launchPending) {
      toast("The app is still opening.");
      return;
    }
    noteInteraction();
    var epoch = ++launchEpoch;
    state.launchPending = true;
    setLaunchState("pending");
    var request = client.launch(item);
    if (state.view === "all-apps") closeDrawer(true, false);
    if (state.view) closeMenu(true, false);
    focusSelection();
    request.then(function (response) {
      if (epoch !== launchEpoch) return;
      state.launchPending = false;
      setLaunchState(response.preview ? "preview" : "accepted");
      if (response.preview) toast("Desktop preview: native app launch is unavailable.");
    }).catch(function (error) {
      if (epoch !== launchEpoch) return;
      state.launchPending = false;
      setLaunchState(error.code === "TIMEOUT" ? "timeout" : "error");
      toast("Could not open " + item.title + ": " + error.message);
    });
  }
  function resetHandoff() {
    cancelHold();
    ++launchEpoch;
    state.launchPending = false;
    setLaunchState("idle");
    lockHome();
  }
  function focusRecord() {
    var active = document.activeElement;
    return active ? { id: active.dataset.id, action: active.dataset.action, menuAction: active.dataset.menuAction } : {};
  }
  function restoreFocus(record) {
    if (record.menuAction && state.view && state.view !== "all-apps") return;
    if (record.action) {
      var action = Array.from(document.querySelectorAll("[data-action]")).find(function (node) { return node.dataset.action === record.action; });
      if (action && !action.closest("[hidden]")) { action.focus({ preventScroll: true }); return; }
    }
    if (state.view === "all-apps") chooseGrid(state.gridIndex, true, true);
    else if (!state.view) focusSelection();
  }
  function refreshInventory() {
    if (state.refresh) return state.refresh;
    var started = performance.now();
    screen.dataset.refreshing = "true";
    var status = $("#inventory-status");
    if (!state.initialized) { status.hidden = false; status.textContent = "Reading apps & inputs…"; }
    state.refresh = client.loadInventory().then(function (result) {
      screen.dataset.inventoryMs = String(Math.round(performance.now() - started));
      if (result.timings) {
        screen.dataset.appLookupMs = String(result.timings.appsMs);
        screen.dataset.inputLookupMs = String(result.timings.inputsMs);
        if (!state.initialized) {
          screen.dataset.firstAppLookupMs = String(result.timings.appsMs);
          screen.dataset.firstInputLookupMs = String(result.timings.inputsMs);
        }
      }
      var unchanged = state.initialized && JSON.stringify(result.items) === JSON.stringify(state.items);
      screen.dataset.inventoryChanged = String(!unchanged);
      var focus = focusRecord();
      var before = state.initialized ? snapshot() : saved;
      if (!state.initialized && !before.selectedId) before = { selectedId: "app:netflix" };
      state.items = result.items;
      var restored = api.restoreSelection(state.items, before);
      state.selected = restored.index; state.gridIndex = restored.gridIndex; state.gridScrollTop = restored.gridScrollTop;
      state.inventoryErrors = result.errors.slice();
      if (result.stale) state.inventoryErrors.push("Refresh incomplete. Any previously read entries for a failed source remain unchanged.");
      if (!state.items.length && !state.inventoryErrors.length) state.inventoryErrors = ["No visible apps or HDMI inputs were returned."];
      if (!unchanged) renderCollection();
      state.initialized = true;
      updateStatus();
      restoreFocus(focus);
      persist();
      screen.dataset.ready = "true";
      lastInventoryAt = performance.now();
      if (!screen.dataset.firstCatalogMs) screen.dataset.firstCatalogMs = String(Math.round(performance.now()));
    }).catch(function (error) {
      state.inventoryErrors = [error.message];
      updateStatus();
      screen.dataset.ready = "error";
      if (!state.items.length) $('[data-action="menu"]').focus();
    }).finally(function () {
      state.refresh = null;
      screen.dataset.refreshing = "false";
    });
    return state.refresh;
  }
  function refreshPhotoMenu() {
    screen.dataset.cloudPhotoState = cloudPhotos.error ? "error" : cloudPhotos.loading || cloudPhotos.reading ? "loading" : prefs.oneDrivePhotos ? "ready" : "off";
    screen.dataset.cloudPhotoCount = String(cloudPhotos.items.length);
    screen.dataset.cloudPhotoPages = String(cloudPhotos.pageCount);
    if (state.view !== "photos") return;
    var action = document.activeElement && document.activeElement.dataset.menuAction;
    renderMenu();
    if (action) {
      var replacement = menu.querySelector('[data-menu-action="' + action + '"]');
      if (replacement && !replacement.disabled) replacement.focus({ preventScroll: true });
    }
  }
  function loadCloudPhotos() {
    if (cloudPhotos.loading) return cloudPhotos.loading;
    if (performance.now() - cloudPhotos.loadedAt < PHOTO_REFRESH_INTERVAL) return Promise.resolve();
    cloudPhotos.error = "";
    var generation = cloudPhotos.generation;
    function isCurrent() { return prefs.oneDrivePhotos && !document.hidden && generation === cloudPhotos.generation; }
    cloudPhotos.loading = client.loadPhotos(isCurrent).then(function (result) {
      if (!isCurrent()) return;
      if (!result.connected) throw new Error("OneDrive is not connected.");
      var previousIds = new Set(cloudPhotos.items.map(function (item) { return item.id; }));
      var currentIds = new Set(result.items.map(function (item) { return item.id; }));
      cloudPhotos.order = cloudPhotos.order.filter(function (id) { return currentIds.has(id); });
      var added = result.items.filter(function (item) { return !previousIds.has(item.id); });
      if (added.length) cloudPhotos.order = api.shuffledPhotoIds(cloudPhotos.order.map(function (id) { return { id: id }; }).concat(added), prefs.cloudPhotoId);
      cloudPhotos.items = result.items;
      cloudPhotos.pageCount = result.pageCount || 1;
      cloudPhotos.loadedAt = performance.now();
      screen.dataset.cloudPhotoSyncedMs = String(Math.round(cloudPhotos.loadedAt));
      if (!result.items.length) cloudPhotos.error = "Apps / Focus Stage has no photos yet.";
    }).finally(function () {
      cloudPhotos.loading = null;
      refreshPhotoMenu();
    });
    refreshPhotoMenu();
    return cloudPhotos.loading;
  }
  async function requestCloudPhoto(manual, keepSelection) {
    if (!prefs.oneDrivePhotos) return;
    if (cloudPhotos.reading) { if (keepSelection) cloudPhotos.restart = true; return; }
    cloudPhotos.reading = true;
    var generation = cloudPhotos.generation;
    refreshPhotoMenu();
    try {
      await loadCloudPhotos();
      if (!prefs.oneDrivePhotos || generation !== cloudPhotos.generation) return;
      if (!cloudPhotos.items.length) { await changePhoto(prefs.photo, manual); return; }
      var selected = cloudPhotos.items.findIndex(function (item) { return item.id === prefs.cloudPhotoId; });
      var index = selected;
      if (!keepSelection || selected < 0) {
        if (!cloudPhotos.order.length) cloudPhotos.order = api.shuffledPhotoIds(cloudPhotos.items, prefs.cloudPhotoId);
        var identifier = cloudPhotos.order.pop();
        index = cloudPhotos.items.findIndex(function (item) { return item.id === identifier; });
      }
      await changePhoto(index, manual, true);
    } catch (error) {
      if (!prefs.oneDrivePhotos || generation !== cloudPhotos.generation) return;
      cloudPhotos.error = error.message || "OneDrive photos are unavailable.";
      if (manual) toast(cloudPhotos.error);
    } finally {
      cloudPhotos.reading = false;
      refreshPhotoMenu();
      if (cloudPhotos.restart) {
        cloudPhotos.restart = false;
        if (prefs.oneDrivePhotos) requestCloudPhoto(manual, true);
      }
    }
  }
  function nextPhoto(manual) {
    if (prefs.oneDrivePhotos) return requestCloudPhoto(manual, false);
    return changePhoto((prefs.photo + 1) % PHOTOS.length, manual);
  }
  async function changePhoto(index, manual, cloud) {
    var next = $("#photo-next"), current = $("#photo-current"), epoch = ++photoEpoch;
    var firstPicture = !current.hasAttribute("src");
    if (photoAnimation) photoAnimation.finish();
    var source = PHOTOS[index], identifier;
    try {
      if (cloud) {
        identifier = cloudPhotos.items[index].id;
        var image = await client.readPhoto(identifier);
        if (epoch !== photoEpoch || !prefs.oneDrivePhotos) return;
        source = image.dataUrl;
      }
      next.src = source;
      await next.decode();
      if (epoch !== photoEpoch) return;
      if (document.hidden || (!manual && !firstPicture && (state.view || state.launchPending || performance.now() - lastInteraction < 5000))) {
        next.removeAttribute("src");
        return;
      }
      var commit = function () {
        if (epoch !== photoEpoch) return;
        current.src = source;
        if (photoAnimation) photoAnimation.cancel();
        photoAnimation = null;
        next.style.opacity = "0";
        next.removeAttribute("src");
        if (cloud) { prefs.cloudPhotoId = identifier; cloudPhotos.error = ""; }
        else prefs.photo = index;
        screen.dataset.photoSource = cloud ? "onedrive" : "samples";
        if (!screen.dataset.firstPhotoMs) screen.dataset.firstPhotoMs = String(Math.round(performance.now()));
        persist();
        schedulePhotos();
      };
      if (reduced() || firstPicture) commit();
      else {
        photoAnimation = animate(next, [{ opacity: 0 }, { opacity: 1 }], PHOTO_FADE_DURATION);
        await new Promise(function (resolve) {
          photoAnimation.onfinish = function () { commit(); resolve(); };
          photoAnimation.oncancel = resolve;
        });
      }
    } catch (error) {
      if (epoch !== photoEpoch) return;
      next.removeAttribute("src");
      if (cloud) throw error;
      if (manual) toast("Sample photo unavailable. The current picture is unchanged.");
    }
  }
  function schedulePhotos() {
    clearTimeout(photoTimer);
    if (!prefs.slideshow || document.hidden || !windowFocused) return;
    photoTimer = setTimeout(function () {
      if (!state.view && !state.launchPending && performance.now() - lastInteraction >= 5000) {
        nextPhoto(false);
      }
      schedulePhotos();
    }, PHOTO_DISPLAY_INTERVAL);
  }
  function schedulePhotoSync(delay) {
    clearTimeout(photoSyncTimer);
    if (!prefs.oneDrivePhotos || document.hidden || !windowFocused) return;
    var remaining = PHOTO_REFRESH_INTERVAL - (performance.now() - cloudPhotos.loadedAt);
    photoSyncTimer = setTimeout(syncCloudPhotoList, delay === undefined ? Math.max(1000, remaining) : delay);
  }
  async function syncCloudPhotoList() {
    if (!prefs.oneDrivePhotos || document.hidden || !windowFocused) return;
    if (cloudPhotos.loading || cloudPhotos.reading || state.view || state.launchPending || performance.now() - lastInteraction < 5000) {
      schedulePhotoSync(5000);
      return;
    }
    var generation = cloudPhotos.generation, retry = false;
    try {
      await loadCloudPhotos();
      if (!prefs.oneDrivePhotos || generation !== cloudPhotos.generation || document.hidden) return;
      if (!cloudPhotos.items.length) {
        if (screen.dataset.photoSource === "onedrive") await changePhoto(prefs.photo, false);
      } else if (screen.dataset.photoSource !== "onedrive" || !cloudPhotos.items.some(function (item) { return item.id === prefs.cloudPhotoId; })) {
        await requestCloudPhoto(false, false);
      }
    } catch (error) {
      if (prefs.oneDrivePhotos && generation === cloudPhotos.generation && !document.hidden) {
        cloudPhotos.error = error.message || "OneDrive photos are unavailable.";
        retry = true;
      }
    } finally {
      refreshPhotoMenu();
      schedulePhotoSync(retry ? 60000 : undefined);
    }
  }
  function trapTab(event, container) {
    if (event.key !== "Tab") return false;
    var buttons = Array.from(container.querySelectorAll("button:not(:disabled),input:not(:disabled)")).filter(function (button) { return button.tabIndex >= 0 && button.getClientRects().length > 0; });
    if (!buttons.length) return true;
    var index = buttons.indexOf(document.activeElement);
    buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus({ preventScroll: true });
    event.preventDefault();
    return true;
  }
  document.querySelectorAll("[data-action]").forEach(function (button) {
    button.addEventListener("click", function () {
      noteInteraction();
      var action = button.dataset.action;
      if (action === "all-apps") openDrawer();
      if (action === "close-drawer") closeDrawer(false);
      if (action === "close-menu") closeMenu(false);
      if (action === "menu" || action === "photos") openMenu(action);
      if (action === "previous") moveRail(-1, true);
      if (action === "next") moveRail(1, true);
    });
  });
  document.addEventListener("focusin", function (event) {
    if (!event.target || typeof event.target.closest !== "function") return;
    if (event.target.closest(".toolbar")) emphasizeRail(false);
    else if (event.target.closest(".app-position,.browse-arrow")) emphasizeRail(true);
  });
  function stopWakeEvent(event) { event.preventDefault(); event.stopImmediatePropagation(); }
  function wakeKeyId(event) { return event.code || event.key || String(event.keyCode); }
  document.addEventListener("keydown", function (event) {
    var identifier = wakeKeyId(event);
    if (wakeKey === identifier) { stopWakeEvent(event); return; }
    if (!photoIdle) return;
    var navigation = (event.key || "").startsWith("Arrow") ||
      ["Enter", " ", "Tab", "Escape", "Backspace", "BrowserBack", "GoBack"].includes(event.key) || [13, 461].includes(event.keyCode);
    noteInteraction();
    if (navigation) { wakeKey = identifier; stopWakeEvent(event); }
  }, true);
  document.addEventListener("keyup", function (event) {
    if (wakeKey !== wakeKeyId(event)) return;
    wakeKey = null;
    stopWakeEvent(event);
  }, true);
  document.addEventListener("pointermove", function (event) {
    var position = event.clientX + ":" + event.clientY;
    if (position === lastIdlePointer) return;
    lastIdlePointer = position;
    var waking = photoIdle;
    noteInteraction();
    if (waking) event.stopImmediatePropagation();
  }, { capture: true, passive: true });
  document.addEventListener("pointerdown", function (event) {
    var waking = photoIdle;
    noteInteraction();
    if (waking) { wakePointer = true; stopWakeEvent(event); }
  }, true);
  document.addEventListener("pointerup", function (event) {
    if (!wakePointer) return;
    wakePointer = false;
    wakeClickUntil = performance.now() + 400;
    stopWakeEvent(event);
  }, true);
  document.addEventListener("click", function (event) {
    if (!photoIdle && performance.now() >= wakeClickUntil) return;
    noteInteraction();
    stopWakeEvent(event);
  }, true);
  document.addEventListener("contextmenu", function (event) {
    if (!photoIdle && !wakePointer) return;
    noteInteraction();
    wakePointer = false;
    wakeClickUntil = performance.now() + 400;
    stopWakeEvent(event);
  }, true);
  document.addEventListener("wheel", function (event) {
    var waking = photoIdle;
    noteInteraction();
    if (waking) stopWakeEvent(event);
  }, { capture: true, passive: false });
  document.addEventListener("keydown", function (event) {
    pointerMode = false;
    stopPointer();
    noteInteraction();
    var key = event.key;
    if (key.startsWith("Arrow") && !state.view) centeredNavigation();
    if (key !== "Enter" && key !== " " && event.keyCode !== 13) cancelHold();
    if (event.repeat && (key === "Enter" || key === " " || event.keyCode === 13)) { event.preventDefault(); return; }
    if ((key === "Enter" || event.keyCode === 13) && document.activeElement && document.activeElement.matches('input[type="checkbox"]')) {
      event.preventDefault(); document.activeElement.click(); return;
    }
    if (event.keyCode === 461 || ["Escape", "Backspace", "BrowserBack", "GoBack"].includes(key)) {
      event.preventDefault();
      if (state.view === "all-apps") closeDrawer(false);
      else if (state.view) closeMenu(false);
      else focusSelection();
      if (state.launchPending) toast("The app is still opening.");
      else setLaunchState("idle");
      return;
    }
    var heldTarget = document.activeElement;
    if ((key === "Enter" || key === " " || event.keyCode === 13) && heldTarget && heldTarget.matches(".app-position,.grid-card")) {
      event.preventDefault();
      var gridTarget = heldTarget.classList.contains("grid-card");
      if (gridTarget ? state.view === "all-apps" : !state.view) beginHold(Number(heldTarget.dataset.index), gridTarget, "keyboard");
      return;
    }
    if (state.view === "all-apps") {
      if (trapTab(event, drawer)) return;
      if (!key.startsWith("Arrow")) return;
      event.preventDefault();
      if (document.activeElement === $('[data-action="close-drawer"]')) {
        if (key === "ArrowDown") chooseGrid(state.gridIndex, true, true);
        if (key === "ArrowUp") closeDrawer(false);
        return;
      }
      var index = api.moveGrid(state.items, state.gridIndex, key, GRID_COLUMNS);
      if (index < 0) closeDrawer(false);
      else chooseGrid(index, true, true);
      return;
    }
    if (state.view) {
      if (trapTab(event, menu)) return;
      if (state.view === "edit-app" && key.startsWith("Arrow")) {
        event.preventDefault();
        if (state.editFromGrid) return;
        if (key === "ArrowDown") $('[data-rail-action="visible"]').focus({ preventScroll: true });
        else if (key === "ArrowUp") $('[data-rail-action="confirm"]').focus({ preventScroll: true });
        else if (document.activeElement !== $('[data-rail-action="visible"]')) editRail(key === "ArrowLeft" ? "left" : "right");
        return;
      }
      var offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1 }[key];
      if (offset !== undefined) {
        event.preventDefault();
        var buttons = Array.from(menu.querySelectorAll("button:not(:disabled),input:not(:disabled)")).filter(function (button) { return button.getClientRects().length > 0; });
        var current = buttons.indexOf(document.activeElement);
        buttons[Math.max(0, Math.min(buttons.length - 1, current + offset))].focus();
      }
      return;
    }
    var active = document.activeElement;
    if (active && active.closest(".toolbar")) {
      if (key === "ArrowDown") { event.preventDefault(); focusSelection(); }
      else if (key === "ArrowLeft" || key === "ArrowRight") {
        event.preventDefault();
        var controls = Array.from(document.querySelectorAll(".toolbar button"));
        var pos = controls.indexOf(active);
        controls[Math.max(0, Math.min(controls.length - 1, pos + (key === "ArrowLeft" ? -1 : 1)))].focus();
      }
      return;
    }
    if (active && active.closest(".footer")) {
      if (key === "ArrowUp") { event.preventDefault(); focusSelection(); }
      else if (key === "ArrowDown") { event.preventDefault(); openDrawer(); }
      return;
    }
    if (key === "ArrowLeft" || key === "ArrowRight") {
      event.preventDefault();
      moveRail(key === "ArrowLeft" ? -1 : 1, true);
    } else if (key === "ArrowUp") {
      event.preventDefault(); $('[data-action="photos"]').focus();
    } else if (key === "ArrowDown") {
      event.preventDefault(); openDrawer();
    } else if ((key === "Enter" || key === " " || event.keyCode === 13) && (!active || active === document.body || active.classList.contains("app-position"))) {
      event.preventDefault();
      if (!event.repeat && selectedItem()) launch(selectedItem());
    }
  });
  document.addEventListener("keyup", function (event) {
    if (!(event.key === "Enter" || event.key === " " || event.keyCode === 13) || !heldPress || heldPress.mode !== "keyboard") return;
    event.preventDefault();
    var press = heldPress;
    cancelHold();
    if (press.triggered || document.hidden || (press.grid ? state.view !== "all-apps" : state.view)) return;
    if (press.grid) chooseGrid(press.index, false, false); else chooseRail(press.index, false);
    launch(state.items[press.index]);
  });
  scroller.addEventListener("scroll", function () {
    state.gridScrollTop = scroller.scrollTop;
    persist();
    scheduleArtwork();
  }, { passive: true });
  document.addEventListener("pointermove", pointerMove, { passive: true });
  document.addEventListener("pointerdown", stopPointer, { capture: true, passive: true });
  document.addEventListener("pointerup", function (event) {
    if (!heldPress || heldPress.mode !== "pointer") return;
    if (heldPress.triggered) { event.preventDefault(); suppressCardClickUntil = performance.now() + 150; }
    cancelHold();
  }, { capture: true });
  document.addEventListener("pointercancel", cancelHold, { capture: true });
  document.documentElement.addEventListener("pointerleave", stopPointer);
  document.addEventListener("cursorStateChange", function (event) {
    if (event.detail && event.detail.visibility === false) { pointerMode = false; stopPointer(); }
  });
  document.addEventListener("wheel", function (event) {
    if (state.view || state.launchPending || document.hidden) return;
    var bounds = screen.getBoundingClientRect(), scale = bounds.width / 1920;
    var position = (event.clientY - bounds.top) / scale;
    if (position < 570 || position > 960) return;
    event.preventDefault();
    stopPointer();
    var delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (event.deltaMode === 1) delta *= 24;
    if (event.deltaMode === 2) delta *= 960;
    wheelAmount += Math.max(-240, Math.min(240, delta));
    var now = performance.now();
    if (Math.abs(wheelAmount) < 50 || now - lastWheelAt < 110) return;
    noteInteraction();
    pointerScrollNavigation();
    moveRail(wheelAmount < 0 ? -1 : 1, true);
    wheelAmount = 0; lastWheelAt = now;
  }, { passive: false });
  window.addEventListener("blur", function () {
    windowFocused = false; stopPointer(); cancelHold(); clearTimeout(photoTimer); clearTimeout(photoSyncTimer); clearTimeout(idleTimer);
    wakeKey = null; wakePointer = false;
  });
  window.addEventListener("focus", function () { windowFocused = true; noteInteraction(); schedulePhotoSync(); });
  function foreground() {
    if (document.hidden || performance.now() - lastForeground < 350) return;
    lastForeground = performance.now();
    noteInteraction();
    var needsRefresh = returnedFromBackground || !state.initialized || state.inventoryErrors.length > 0 || performance.now() - lastInventoryAt >= 2000;
    returnedFromBackground = false;
    resetHandoff();
    if (state.view === "all-apps") closeDrawer(true, false);
    else if (state.view) closeMenu(true, false);
    centeredNavigation();
    updateRail(true);
    focusSelection();
    if (needsRefresh) refreshInventory();
    scheduleArtwork();
    schedulePhotos();
    schedulePhotoSync();
  }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      returnedFromBackground = true;
      stopPointer();
      clearTimeout(photoTimer);
      clearTimeout(photoSyncTimer);
      clearTimeout(idleTimer);
      wakeKey = null; wakePointer = false;
      ++photoEpoch;
      if (photoAnimation) photoAnimation.finish();
      resetHandoff();
      updateRail(true);
      persist();
    } else foreground();
  });
  document.addEventListener("webOSRelaunch", foreground);
  window.addEventListener("webOSRelaunch", foreground);
  window.addEventListener("pageshow", function (event) { if (event.persisted) foreground(); });
  window.addEventListener("pagehide", persist);
  window.addEventListener("resize", resize);
  motionQuery.addEventListener("change", syncMotion);
  function clock() {
    var date = new Date();
    $("#clock").textContent = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    $("#clock").dateTime = date.toISOString();
  }
  $("#environment").hidden = television;
  screen.dataset.navigationMode = navigationMode;
  screen.dataset.railEmphasized = String(railEmphasized);
  screen.dataset.photoSource = prefs.oneDrivePhotos ? "loading" : "samples";
  screen.dataset.cloudPhotoState = "off";
  screen.dataset.photoIdle = "false";
  screen.dataset.photoIdleDelayMs = String(PHOTO_IDLE_DELAY);
  screen.dataset.photoDisplayIntervalMs = String(PHOTO_DISPLAY_INTERVAL);
  screen.dataset.photoFadeDurationMs = String(PHOTO_FADE_DURATION);
  screen.dataset.photoRefreshIntervalMs = String(PHOTO_REFRESH_INTERVAL);
  $("#environment").textContent = television ? "" : "Desktop preview · fixture data and artwork · no TV calls";
  document.body.classList.add("initializing");
  syncMotion(); resize(); clock();
  if (document.fonts) document.fonts.ready.then(fitLabels);
  setInterval(clock, 30000);
  if (!prefs.oneDrivePhotos) $("#photo-current").src = PHOTOS[prefs.photo];
  refreshInventory().finally(function () {
    requestAnimationFrame(function () { document.body.classList.remove("initializing"); });
    if (prefs.oneDrivePhotos) requestCloudPhoto(false, true);
    schedulePhotoSync();
  });
  schedulePhotos();
  scheduleIdle();
})();

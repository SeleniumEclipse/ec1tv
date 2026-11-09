"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const { validateConnection } = require("./connection.cjs");
const { validateConfig } = require("./onedrive-auth.cjs");

const ACTIONS = Object.freeze({
  "1": "status", "2": "home-apply", "3": "home-restore", "4": "photos-connect",
  "5": "photos-verify", "6": "photos-disconnect", "7": "configure", "0": "exit"
});

async function configure(ui, state) {
  ui.say("Use your own rooted TV, SSH client key, and independently verified TV host fingerprint.");
  const host = (await ui.ask("TV local-network IP address: ")).trim();
  const port = Number((await ui.ask("Root SSH port [22]: ")).trim() || "22");
  const enteredKey = (await ui.ask("Path to your SSH private-key file: ")).trim();
  const keyPath = path.resolve(enteredKey.replace(/^~(?=[/\\])/, os.homedir()));
  const hostFingerprint = (await ui.ask("Verified TV host fingerprint (SHA256:...): ")).trim();
  const config = validateConnection({ host, port, username: "root", keyPath, hostFingerprint });
  assert.ok(await ui.confirm("Have you independently verified that this fingerprint belongs to your TV?"), "Connection setup cancelled before saving.");
  state.save("connection.json", config);
  ui.say("Connection settings saved privately. No key contents or passphrase were saved.");
  return config;
}

async function runWizard({ ui, state, connect, ensureRuntime, operation, signIn }) {
  ui.say("ec1tv setup\n1. Check connection and status\n2. Use ec1tv as Home\n3. Restore LG Home\n4. Connect OneDrive photos\n5. Check OneDrive photos\n6. Disconnect OneDrive photos\n7. Change connection settings\n0. Exit");
  const action = ACTIONS[(await ui.ask("Choose an option: ")).trim()];
  assert.ok(action, "Choose one of the listed options.");
  if (action === "exit") return { cancelled: true };
  if (action === "configure") { await configure(ui, state); return { configured: true }; }
  const changes = ["home-apply", "home-restore", "photos-connect", "photos-verify", "photos-disconnect"].includes(action);
  if (changes && !await ui.confirm("Is the TV available for setup changes? These can affect its Home screen or photo connection.")) return { cancelled: true };
  let config = state.read("connection.json");
  if (!config) config = await configure(ui, state);
  validateConnection(config);
  const session = await connect(config, ui);
  try {
    let runtime = await ensureRuntime(session, false);
    ui.say("TV identity and administrator connection verified.");
    if (!runtime.installed) {
      if (action === "status") { ui.say("The TV is connected. Run a setup option to install the private setup/recovery helper."); return { connected: true, setupInstalled: false }; }
      assert.ok(await ui.confirm("Install the ec1tv setup helper and private recovery folder on this TV?"), "Setup cancelled before helper installation.");
      runtime = await ensureRuntime(session, true);
    }
    assert.equal(runtime.installed, true, "The setup helper is not ready.");
    let result;
    if (action === "status") {
      result = { home: await operation(session, "home-status"), photos: await operation(session, "photos-status") };
      ui.say("Home: " + result.home.phase + ". Photos: " + (result.photos.connected ? "connected" : result.photos.existingSetup ? "managed by another setup" : "not connected") + ".");
    } else if (action === "home-apply") {
      const includeIdle = await ui.confirm("Also use ec1tv as the TV's system idle app?");
      assert.ok(await ui.confirm("Save this TV's original settings and make ec1tv the Home destination?"), "Home setup cancelled before changing settings.");
      result = await operation(session, action, { includeIdle });
      ui.say("Home configuration saved. Test the physical Home button, apps, HDMI inputs, sound, and standby. Use Restore LG Home to undo it.");
    } else if (action === "home-restore") {
      assert.ok(await ui.confirm("Restore this TV's original Home settings using its saved recovery record?"), "Home restoration cancelled.");
      result = await operation(session, action);
      ui.say("Original Home settings restored. Test Home and input resume before removing the launcher.");
    } else if (action === "photos-connect") {
      const current = await operation(session, "photos-status");
      assert.equal(current.existingSetup, false, "A different photo setup already exists and will not be changed.");
      assert.equal(current.connected, false, "Disconnect the saved photo login before connecting or renewing an account.");
      const home = await operation(session, "home-status");
      assert.equal(home.appVersion, "0.1.16", "Install launcher 0.1.16 before connecting your photo account.");
      ui.say("Create your own personal-account Microsoft registration first. Use only Files.ReadWrite.AppFolder and enable public client flows. See docs/photos.md.");
      const photoConfig = validateConfig({
        clientId: (await ui.ask("Your Application (client) ID: ")).trim(),
        account: (await ui.ask("Your personal Microsoft account email: ")).trim(),
        folderName: (await ui.ask("Registration display name [ec1tv Photos]: ")).trim() || "ec1tv Photos"
      });
      result = await signIn(photoConfig, {
        showCode(value) { ui.say("Open " + value.verificationUri + " in your browser and enter this code directly: " + value.userCode + "\nDo not share the code or paste it into chat."); },
        async confirmFolder(value) {
          ui.say("Account: " + value.account + "\nPhoto folder: " + value.folder + "\nMicrosoft's app-folder permission allows reading, writing, and deleting within this folder.");
          return ui.confirm("Use this account and folder for this TV?");
        },
        connect(connection) { return operation(session, "photos-connect", { connection }); }
      });
      ui.say("OneDrive connected. Add pictures to " + result.folder + ", then turn on OneDrive photos in the TV's Photos menu.");
    } else if (action === "photos-disconnect") {
      assert.ok(await ui.confirm("Remove the saved OneDrive login from this TV? Cloud photos will stay in your account."), "Photo disconnection cancelled.");
      result = await operation(session, action);
      ui.say("The saved TV login was removed. Turn off OneDrive photos on the TV and revoke this app's access in your Microsoft account if desired.");
    } else {
      result = await operation(session, "photos-verify");
      ui.say("Photo login and app folder verified. First page contains " + result.firstPagePhotoCount + " supported pictures.");
    }
    state.save("last-result.json", { action, checkedAt: new Date().toISOString(), result });
    return result;
  } finally { session.close(); }
}

module.exports = { ACTIONS, configure, runWizard };
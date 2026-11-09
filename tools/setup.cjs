"use strict";

const path = require("node:path");
const { Writable } = require("node:stream");
const readline = require("node:readline/promises");
const { createLocalState } = require("./setup/local-state.cjs");
const connection = require("./setup/connection.cjs");
const { ensureRuntime, operation } = require("./setup/runtime-install.cjs");
const { signIn } = require("./setup/onedrive-auth.cjs");
const { runWizard } = require("./setup/wizard.cjs");

function createUI(input = process.stdin, output = process.stdout) {
  let muted = false;
  const display = new Writable({ write(chunk, encoding, callback) { if (!muted) output.write(chunk, encoding); callback(); } });
  const terminal = readline.createInterface({ input, output: display, terminal: Boolean(input.isTTY) });
  return {
    say(message) { output.write(message + "\n"); },
    ask(message) { return terminal.question(message); },
    async confirm(message) { return /^(?:y|yes)$/i.test((await terminal.question(message + " [y/N]: ")).trim()); },
    async secret(message) {
      if (!input.isTTY || !output.isTTY) throw new Error("Enter the SSH passphrase directly in an interactive terminal.");
      output.write(message); muted = true;
      try { return await terminal.question(""); }
      finally { muted = false; output.write("\n"); }
    },
    close() { terminal.close(); }
  };
}

async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === "--help") {
    console.log("ec1tv guided setup\nRun: npm run setup\nUse your own rooted TV, SSH private key, and verified host fingerprint.\nHome changes and photo connection require explicit confirmation.\nPrivate settings are stored outside the repository. No passwords or tokens are saved on this computer.");
    return;
  }
  if (args.length) throw new Error("Use npm run setup, or npm run setup -- --help.");
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Run setup directly in an interactive terminal. Do not pipe account codes or passphrases through another program.");
  const repository = path.resolve(__dirname, "..");
  const ui = createUI();
  try {
    const state = createLocalState(repository);
    ui.say("Private setup folder: " + state.directory);
    await runWizard({
      ui, state, ensureRuntime, operation, signIn,
      async connect(config) {
        const key = connection.readKey(config, repository);
        let passphrase;
        try {
          const parsed = require("ssh2").utils.parseKey(key);
          if (parsed instanceof Error) {
            if (!/encrypted|passphrase/i.test(parsed.message)) throw new Error("The selected file is not a supported SSH private key.");
            passphrase = await ui.secret("SSH key passphrase (hidden): ");
          }
          return await connection.connect(config, key, passphrase);
        } finally { key.fill(0); passphrase = undefined; }
      }
    });
  } finally { ui.close(); }
}

module.exports = { createUI, main };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
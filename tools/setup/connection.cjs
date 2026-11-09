"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const net = require("node:net");
const fs = require("node:fs");
const { validatePrivatePath } = require("./local-state.cjs");

function privateAddress(host) {
  if (typeof host !== "string" || host.length > 100) return false;
  if (net.isIP(host) === 4) {
    const parts = host.split(".").map(Number);
    return parts[0] === 10 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
  }
  return net.isIP(host) === 6 && /^(?:f[cd]|fe[89ab])/i.test(host);
}

function validateConnection(config) {
  assert.ok(config && typeof config === "object" && !Array.isArray(config), "Missing TV connection settings");
  assert.ok(privateAddress(config.host), "Enter the TV's private local-network IP address");
  assert.ok(Number.isInteger(config.port) && config.port >= 1 && config.port <= 65535, "Invalid SSH port");
  assert.equal(config.username, "root", "The setup requires a root SSH connection");
  assert.match(config.hostFingerprint, /^SHA256:[A-Za-z0-9+/]{43}$/);
  assert.ok(typeof config.keyPath === "string" && config.keyPath.length > 0 && config.keyPath.length <= 4096, "Choose your own SSH private-key file");
  assert.ok(!Object.keys(config).some(key => /password|passphrase|privateKey|token/i.test(key)), "Do not save credentials in connection settings");
  return config;
}

function readKey(config, repository) {
  validateConnection(config);
  const filename = validatePrivatePath(config.keyPath, repository);
  const stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size > 0 && stat.size <= 524288, "Unsafe SSH identity file");
  validatePrivatePath(fs.realpathSync(filename), repository);
  return fs.readFileSync(filename);
}

async function connect(config, privateKey, passphrase, Client = require("ssh2").Client) {
  validateConnection(config);
  assert.ok(Buffer.isBuffer(privateKey) && privateKey.length <= 524288, "Invalid SSH identity");
  const client = new Client();
  let matched = false;
  try {
    await new Promise((resolve, reject) => {
      client.once("ready", resolve);
      client.once("error", reject);
      client.connect({
        host: config.host, port: config.port, username: "root", privateKey, passphrase,
        authHandler: ["publickey"], readyTimeout: 15000, keepaliveInterval: 10000, keepaliveCountMax: 2,
        hostVerifier(key) {
          const observed = "SHA256:" + crypto.createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
          matched = observed === config.hostFingerprint;
          return matched;
        }
      });
    });
    assert.equal(matched, true, "The TV host key was not verified");
    client.on("error", () => {});
    return { client, hostFingerprint: config.hostFingerprint, close: () => client.end() };
  } catch {
    client.end();
    throw new Error(matched ? "SSH authentication failed. Check your own key, passphrase, and TV SSH settings." : "The TV connection or host-key check failed. Verify the TV address and fingerprint before retrying.");
  } finally { privateKey.fill(0); }
}

function execute(session, command, input = Buffer.alloc(0), timeout = 260000) {
  return new Promise((resolve, reject) => {
    let channel, finished = false, size = 0;
    const chunks = [];
    const timer = setTimeout(() => finish(new Error("The TV command did not confirm completion. Check status before retrying.")), timeout);
    function finish(error, output) {
      if (finished) return;
      finished = true; clearTimeout(timer);
      if (error) { if (channel) channel.close(); reject(error); }
      else resolve(output);
    }
    session.client.exec(command, (error, stream) => {
      if (error) { finish(new Error("Could not start the TV command.")); return; }
      channel = stream;
      stream.on("data", bytes => { size += bytes.length; if (size > 1048576) finish(new Error("TV response exceeded the size limit.")); else chunks.push(bytes); });
      stream.stderr.on("data", bytes => { size += bytes.length; if (size > 1048576) finish(new Error("TV error output exceeded the size limit.")); });
      stream.on("error", () => finish(new Error("The TV connection was interrupted. Check status before retrying.")));
      stream.on("close", code => {
        const output = Buffer.concat(chunks).toString("utf8");
        if (code !== 0) {
          let reply;
          try { reply = JSON.parse(output.trim()); } catch {}
          const reportedFailure = reply && !Array.isArray(reply) && reply.ok === false &&
            typeof reply.error === "string" && reply.error.length > 0 && reply.error.length <= 2048 &&
            Object.keys(reply).every(key => ["ok", "error"].includes(key));
          if (!reportedFailure) { finish(new Error("The TV command stopped before a successful result.")); return; }
        }
        finish(null, output);
      });
      stream.end(input);
    });
  });
}

function sftp(session) {
  return new Promise((resolve, reject) => session.client.sftp((error, result) => error ? reject(new Error("Could not open the TV file connection.")) : resolve(result)));
}

function fileCall(client, method, ...args) {
  return new Promise((resolve, reject) => client[method](...args, (error, value) => error ? reject(error) : resolve(value)));
}

function quote(value) { assert.equal(typeof value, "string"); return "'" + value.replace(/'/g, "'\"'\"'") + "'"; }

module.exports = { privateAddress, validateConnection, readKey, connect, execute, sftp, fileCall, quote };
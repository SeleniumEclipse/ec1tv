"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { privateAddress, validateConnection, connect, execute, quote } = require("./connection.cjs");
const { inside, validatePrivatePath, containsSecret } = require("./local-state.cjs");
const rawHostKey = Buffer.from("synthetic test host key");
const fingerprint = "SHA256:" + crypto.createHash("sha256").update(rawHostKey).digest("base64").replace(/=+$/, "");
const config = () => ({ host: "192.168.200.20", port: 22, username: "root", keyPath: "private-client-key", hostFingerprint: fingerprint });

test("connection settings require a private address root identity and exact host pin", () => {
  assert.doesNotThrow(() => validateConnection(config()));
  for (const update of [{ host: "example.com" }, { host: "8.8.8.8" }, { host: "127.0.0.1" }, { username: "prisoner" }, { hostFingerprint: "accept-all" }, { port: 0 }, { password: "synthetic" }]) assert.throws(() => validateConnection({ ...config(), ...update }));
  assert.equal(privateAddress("fd00::10"), true);
  assert.equal(privateAddress("::1"), false);
});

test("SSH accepts only the pinned host and clears the supplied key buffer", async () => {
  let options;
  class Client extends EventEmitter {
    connect(value) { options = value; queueMicrotask(() => value.hostVerifier(rawHostKey) ? this.emit("ready") : this.emit("error", new Error("host mismatch"))); }
    end() {}
  }
  const key = Buffer.from("synthetic client identity");
  const session = await connect(config(), key, undefined, Client);
  assert.deepEqual(options.authHandler, ["publickey"]);
  assert.ok(key.every(value => value === 0));
  session.close();
  const rejected = Buffer.from("synthetic client identity");
  await assert.rejects(connect({ ...config(), hostFingerprint: "SHA256:" + "A".repeat(43) }, rejected, undefined, Client), /host-key check failed/);
  assert.ok(rejected.every(value => value === 0));
});

test("private state paths cannot live in the source tree or known cloud folders", () => {
  const repository = process.cwd();
  assert.throws(() => validatePrivatePath(repository + "/private/key", repository, {}), /outside the repository/);
  assert.equal(inside(repository, repository + "/child"), true);
  assert.equal(inside(repository, repository + "-other"), false);
  assert.throws(() => validatePrivatePath("/cloud/private", "/project", { OneDrive: "/cloud" }), /OneDrive/);
});

test("local records reject nested secrets while keeping key references", () => {
  assert.equal(containsSecret({ device: { keyPath: "private-path" } }), false);
  for (const key of ["password", "passphrase", "privateKey", "accessToken", "refreshToken", "clientSecret"]) assert.equal(containsSecret({ nested: { [key]: "synthetic" } }), true);
  assert.equal(quote("fixed'path"), "'fixed'\"'\"'path'");
});

function commandSession(output, code) {
  return {
    client: {
      exec(command, callback) {
        const channel = new EventEmitter();
        channel.stderr = new EventEmitter();
        channel.close = () => {};
        channel.end = () => queueMicrotask(() => {
          channel.emit("data", Buffer.from(output));
          channel.emit("close", code);
        });
        callback(null, channel);
      }
    }
  };
}

test("structured TV failures retain the recovery message", async () => {
  const output = JSON.stringify({ ok: false, error: "The original Home settings were restored." });
  assert.equal(await execute(commandSession(output, 1), "synthetic-command"), output);
});

test("nonzero command exits cannot be presented as successful replies", async () => {
  for (const output of ["unstructured command error", '{"ok":true,"result":{}}', '{"ok":false,"error":"failure","unexpected":"value"}']) {
    await assert.rejects(execute(commandSession(output, 1), "synthetic-command"), /stopped before a successful result/);
  }
});

test("successful TV commands retain their structured result", async () => {
  const output = JSON.stringify({ ok: true, result: { phase: "restored" } });
  assert.equal(await execute(commandSession(output, 0), "synthetic-command"), output);
});
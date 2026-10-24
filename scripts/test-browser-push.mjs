import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "artifacts/api-server/package.json"));
const { build } = require("esbuild");
const compiled = await build({
  entryPoints: [path.join(root, "artifacts/biz-connect/src/lib/browser-push.ts")],
  bundle: true, write: false, platform: "node", format: "esm", logLevel: "silent",
  define: { "import.meta.env": '{"BASE_URL":"/"}' },
});
const { activateBrowserPush, withPushDeadline, PushActivationError } =
  await import("data:text/javascript;base64," + Buffer.from(compiled.outputFiles[0].text).toString("base64"));
const originals = Object.fromEntries(["window", "navigator", "Notification"].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const keyBytes = Uint8Array.from({ length: 65 }, (_, index) => index === 0 ? 4 : 7);
const publicKey = Buffer.from(keyBytes).toString("base64url");
const input = { endpoint: "https://push.invalid/fixture", keys: { p256dh: "fixture-public-key", auth: "fixture-auth" } };
let permissionRequests, registers, subscribes, unsubscribes, saves, existing;
let registration, permissionApi;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function setup(permission = "granted") {
  permissionRequests = registers = subscribes = unsubscribes = saves = 0;
  existing = null;
  permissionApi = { permission, requestPermission: async () => {
    permissionRequests++; permissionApi.permission = "granted"; return "granted";
  } };
  registration = { pushManager: {
    getSubscription: async () => existing,
    subscribe: async (options) => {
      subscribes++;
      assert.deepEqual([...options.applicationServerKey], [...keyBytes]);
      return { toJSON: () => input, options: { applicationServerKey: keyBytes.buffer } };
    },
  } };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { PushManager: class {} } });
  Object.defineProperty(globalThis, "Notification", { configurable: true, value: permissionApi });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { serviceWorker: {
    register: async (url) => { registers++; assert.equal(url, "/sw.js"); return registration; },
    ready: Promise.resolve(registration),
  } } });
}
const save = async (data, signal) => { saves++; assert.deepEqual(data, input); assert.equal(signal.aborted, false); };
try {
  setup("default");
  assert.equal(await activateBrowserPush(publicKey, save, { requestPermission: true }), true);
  assert.equal(permissionRequests, 1); assert.equal(subscribes, 1); assert.equal(saves, 1);

  setup();
  existing = { toJSON: () => input, options: { applicationServerKey: keyBytes.buffer } };
  assert.equal(await activateBrowserPush(publicKey, save, { requestPermission: true }), true);
  assert.equal(permissionRequests, 0); assert.equal(subscribes, 0); assert.equal(saves, 1);

  setup("denied");
  permissionApi.requestPermission = async () => { permissionRequests++; return "denied"; };
  assert.equal(await activateBrowserPush(publicKey, save, { requestPermission: true }), false);
  assert.equal(registers, 0); assert.equal(saves, 0);

  setup("default");
  let latePermission;
  permissionApi.requestPermission = () => { permissionRequests++; return new Promise((resolve) => { latePermission = resolve; }); };
  await assert.rejects(activateBrowserPush(publicKey, save, { requestPermission: true, timeoutMs: 20 }), PushActivationError);
  latePermission("granted"); await tick();
  assert.equal(permissionRequests, 1); assert.equal(registers, 0); assert.equal(saves, 0, "Late permission must not save after timeout");

  setup();
  navigator.serviceWorker.ready = new Promise(() => {});
  await assert.rejects(activateBrowserPush(publicKey, save, { requestPermission: false, timeoutMs: 20 }), PushActivationError);
  assert.equal(saves, 0);

  setup();
  let serverSignal, lateSave;
  await assert.rejects(activateBrowserPush(publicKey, async (_, signal) => {
    saves++; serverSignal = signal;
    await new Promise((resolve) => { lateSave = resolve; });
  }, { requestPermission: false, timeoutMs: 20 }), PushActivationError);
  assert.equal(serverSignal.aborted, true); assert.equal(saves, 1);
  lateSave(); await tick();
  assert.equal(saves, 1, "Timeout must not start a retry");

  setup();
  const cancel = new AbortController();
  const pending = activateBrowserPush(publicKey, async () => new Promise(() => {}), { requestPermission: false, signal: cancel.signal });
  setTimeout(() => cancel.abort(), 5);
  await assert.rejects(pending, { name: "AbortError" });

  setup();
  existing = {
    options: { applicationServerKey: new Uint8Array(65).buffer },
    unsubscribe: async () => { unsubscribes++; return true; },
    toJSON: () => input,
  };
  assert.equal(await activateBrowserPush(publicKey, save, { requestPermission: false }), true);
  assert.equal(unsubscribes, 1); assert.equal(subscribes, 1);

  await assert.rejects(withPushDeadline(() => new Promise(() => {}), 20), PushActivationError);
  console.log("PASS: push activation success, subscription reuse, permission denial, bounded permission/worker/server waits, cancellation, no late save or retry, and server-key rotation. Browser APIs and delivery simulated.");
} finally {
  for (const [name, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
}

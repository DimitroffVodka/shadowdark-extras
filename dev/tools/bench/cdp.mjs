// Tiny Chrome DevTools Protocol client for the visible bench Chrome (#272 perf tests).
// node cdp.mjs [--port 9333] [--throttle N] (--file script.js | --expr "...") [--timeout ms]
// The CPU throttle lasts only while this session is attached, so the script runs inside it.
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const port = Number(opt("--port", 9333));
const throttle = Number(opt("--throttle", 0));
const file = opt("--file");
const expression = file ? readFileSync(file, "utf8") : opt("--expr", "1");
const timeout = Number(opt("--timeout", 600000));

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === "page" && t.url.includes("localhost:30000")) ?? targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let next = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++next;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});

if (throttle) await send("Emulation.setCPUThrottlingRate", { rate: throttle });
const res = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, timeout });
if (throttle) await send("Emulation.setCPUThrottlingRate", { rate: 1 });
ws.close();
const out = res.result?.exceptionDetails ?? res.result?.result?.value ?? res.error ?? res;
console.log(JSON.stringify(out, null, 1));

// Helper for "<name>-proposed" fixtures in this module, mirroring shadowdark-enhancer's helper without its
// shared UI kit — SDX keeps its own visual language, so a proposal is the current fixture + a proposed
// stylesheet (and optional template swaps) that are injected unlayered by the harness page, which is what
// lets a proposal beat the module's @layer(modules) rules. Nothing here ships; it only feeds the harness.
//   export default proposed(current, { "templates/x.hbs": "tools/design-harness/proposed/templates/x.hbs" }, { extraCss: "tools/design-harness/proposed/css/x.css" })
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

// Foundry draws data-tooltip itself; the design harness does not. Show it on hover so proposal tooltips can be judged.
const TOOLTIP_SHIM = `<script>(()=>{if(window.__tt)return;window.__tt=1;const t=document.createElement("div");t.style.cssText="position:fixed;z-index:99999;max-width:260px;padding:4px 8px;font:12px/1.3 sans-serif;color:#fff;background:#000e;border:1px solid #888;border-radius:3px;pointer-events:none;display:none";document.body.appendChild(t);document.addEventListener("mouseover",e=>{const n=e.target.closest&&e.target.closest("[data-tooltip]");if(!n){t.style.display="none";return}t.textContent=n.dataset.tooltip;t.style.display="block";const r=n.getBoundingClientRect();t.style.left=Math.max(4,Math.min(innerWidth-t.offsetWidth-4,r.left))+"px";t.style.top=Math.max(4,r.top-t.offsetHeight-6)+"px"})})()</script>`;
const withShim = (w) => ({ ...w, toolbar: (w.toolbar ?? "") + TOOLTIP_SHIM });

export function proposed(current, map = {}, opts = {}) {
  const swap = (w) => {
    const t = (x) => map[x] ?? x;
    const out = { ...w };
    if (w.template) out.template = t(w.template);
    if (w.parts) out.parts = w.parts.map((p) => ({ ...p, template: t(p.template) }));
    return out;
  };
  const extra = (Array.isArray(opts.extraCss) ? opts.extraCss : [opts.extraCss])
    .filter(Boolean).map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n");
  const base = { ...swap(current), classes: opts.classes ?? current.classes, css: extra,
    ...(opts.width ? { width: opts.width } : {}), ...(opts.title ? { title: opts.title } : {}) };
  if (current.build) base.build = (s) => withShim(swap({ ...current.build(s) }));
  return withShim(base);
}

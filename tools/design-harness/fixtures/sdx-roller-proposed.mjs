import current from "./sdx-roller.mjs";
import { proposed } from "./_proposed.mjs";
// Fixes: portrait strip wrap, ≥22px remove targets, heading/hint split (template + css).
export default proposed(current, { "templates/sdx-roller.hbs": "tools/design-harness/proposed/templates/sdx-roller.hbs" },
  { extraCss: ["tools/design-harness/proposed/css/sdx-proposals.css", "tools/design-harness/proposed/css/sdx-roller.css"] });

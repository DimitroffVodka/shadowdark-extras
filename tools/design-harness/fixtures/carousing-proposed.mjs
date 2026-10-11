import current from "./carousing.mjs";
import { proposed } from "./_proposed.mjs";
// Fixes: uniform card heights, legible micro-text, calmer gold (css only).
export default proposed(current, { "templates/carousing-overlay.hbs": "tools/design-harness/proposed/templates/carousing.hbs" },
  { extraCss: ["tools/design-harness/proposed/css/sdx-proposals.css", "tools/design-harness/proposed/css/carousing.css"] });

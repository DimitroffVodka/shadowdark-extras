import current from "./medkit.mjs";
import { proposed } from "./_proposed.mjs";
// Fixes: "Src:"/"Source:" microcopy, inline styles (template); secondary text sizes and button weight (css).
export default proposed(current, { "templates/medkit.hbs": "tools/design-harness/proposed/templates/medkit.hbs" },
  { extraCss: ["tools/design-harness/proposed/css/sdx-proposals.css", "tools/design-harness/proposed/css/medkit.css"] });

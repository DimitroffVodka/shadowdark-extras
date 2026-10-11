import current from "./camping-rest.mjs";
import { proposed } from "./_proposed.mjs";
// Fixes: name + ability truncation, SHOUTING labels, dim controls, control rhythm (css only).
export default proposed(current, { "templates/camping-rest.hbs": "tools/design-harness/proposed/templates/camping-rest.hbs" },
  { extraCss: ["tools/design-harness/proposed/css/sdx-proposals.css", "tools/design-harness/proposed/css/camping-rest.css"] });

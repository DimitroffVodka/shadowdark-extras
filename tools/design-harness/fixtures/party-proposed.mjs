import current from "./party.mjs";
import { proposed } from "./_proposed.mjs";
// Fixes: stat-chip contrast, tab contrast, compact GM action row, stat/ability/effect legibility,
// spawn-widget hit area (css only).
export default proposed(current, { "templates/party.hbs": "tools/design-harness/proposed/templates/party.hbs" },
  { extraCss: ["tools/design-harness/proposed/css/sdx-proposals.css", "tools/design-harness/proposed/css/party.css"] });

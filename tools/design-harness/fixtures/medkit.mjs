// MedkitApp (scripts/combat/MedkitSD.mjs): reconciles an actor's spells/scrolls/wands against the
// registered compendiums. Window classes ["shadowdark","sdx-medkit-window"], width 550.
// Both sections (updates + up-to-date) render together in one state, so one fixture covers the look.
const S = "modules/shadowdark-extras/assets/";
const C = "/icons/svg/";
const build = () => ({
  parts: [
    {
      id: "form",
      template: "templates/medkit.hbs",
      context: {
        actor: { name: "Iraga Draguul" },
        updatesAvailable: [
          { id: "i1", img: `${S}Weapons/Wands/Wand_Star_Silver_1x1.webp`, name: "Wand of Magic Missile", statusLabel: "Enhancement flags differ", currentSource: "Shadowdark Extras" },
          { id: "i2", img: `${C}explosion.svg`, name: "Magic Missile", statusLabel: "Newer compendium version", currentSource: "Shadowdark Extras" },
          { id: "i3", img: `${C}aura.svg`, name: "Bless", statusLabel: "Enhancement flags differ", currentSource: "Player's Handbook" },
        ],
        upToDate: [
          { img: `${C}fire.svg`, name: "Burning Hands", sourceLabel: "Shadowdark Extras" },
          { img: `${C}eye.svg`, name: "Detect Magic", sourceLabel: "Shadowdark Extras" },
          { img: `${C}blood.svg`, name: "Cure Wounds", sourceLabel: "Shadowdark Extras" },
        ],
        hasUpdates: true,
        hasUpToDate: true,
        updateCount: 3,
      },
    },
  ],
});
export default {
  title: "Shadowdark Extras Medkit",
  icon: "fas fa-kit-medical",
  classes: ["shadowdark", "sdx-medkit-window"],
  width: 550,
  height: 640,
  previewHeight: 700,
  id: "sdx-medkit",
  initial: "updates",
  build,
};

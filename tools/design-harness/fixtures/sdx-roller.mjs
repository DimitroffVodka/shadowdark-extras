// SDXRollerApp (scripts/tray/SDXRollerApp.mjs): the group-roll configuration window (380 wide, fixed).
// Actors strip + participants/contestants + roll options, per _prepareContext.
const art = (f) => "/systems/shadowdark/assets/quickstart/pregens/" + f;
const actor = (i, name, f) => ({ uuid: "Actor." + i, name, img: f ? art(f) : "/systems/shadowdark/assets/tokens/cowled_token.webp", type: "Player" });
const build = () => ({
  parts: [
    {
      id: "main",
      template: "templates/sdx-roller.hbs",
      context: {
        actors: [
          actor("a1", "Creeg Greythorn", "Creeg_Greythorn-portrait.webp"),
          actor("a2", "Elbin Grizzlegut", "Elbin_Grizzlegut_portrait.webp"),
          actor("a3", "Iraga Draguul", "Iraga_Draguul_portrait.webp"),
          actor("a4", "Jorbin Ironhelm", "Jorbin_Ironhelm_portrait.webp"),
          actor("a5", "Martin Rast", "Martin_Rast_portrait.webp"),
          actor("a6", "Bram the Porter", null),
        ],
        participants: [
          { uuid: "Actor.a1", name: "Creeg Greythorn", img: art("Creeg_Greythorn-portrait.webp"), contestant: false },
          { uuid: "Actor.a2", name: "Elbin Grizzlegut", img: art("Elbin_Grizzlegut_portrait.webp"), contestant: false },
        ],
        contestants: [
          { uuid: "Actor.a3", name: "Iraga Draguul", img: art("Iraga_Draguul_portrait.webp"), contestant: true },
        ],
        abilities: [
          { key: "str", label: "Strength", selected: true },
          { key: "dex", label: "Dexterity", selected: false },
          { key: "con", label: "Constitution", selected: false },
          { key: "int", label: "Intelligence", selected: false },
          { key: "wis", label: "Wisdom", selected: false },
          { key: "cha", label: "Charisma", selected: false },
        ],
        dc: 12,
        showDc: false,
        hideNames: false,
        useAverage: false,
        customLabel: "",
        filter: "",
        isGM: true,
      },
    },
  ],
});
export default {
  title: "SDX Roller",
  icon: "fas fa-dice-d20",
  classes: ["sdx-roller-window"],
  width: 380,
  height: 1010,
  previewHeight: 740,
  id: "sdx-roller-app",
  initial: "config",
  build,
};

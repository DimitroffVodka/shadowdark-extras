// CampingRestApp (scripts/party/CampingRestSD.mjs): the overnight-rest workflow window.
// classes ["shadowdark","shadowdark-extras","sdx-camping-rest-app"], 820x720.
// Members carry the task selects; the context flags drive which contextual controls render
// (the real app toggles the same blocks from JS on change).
const art = (f) => "/systems/shadowdark/assets/quickstart/pregens/" + f;
const tasks = [
  { key: "hunt", name: "Hunt", abilitiesCsv: "wis|con" },
  { key: "keepWatch", name: "Keep Watch", abilitiesCsv: "wis" },
  { key: "craft", name: "Craft", abilitiesCsv: "dex|int" },
  { key: "entertain", name: "Entertain", abilitiesCsv: "cha" },
];
const taskOptions = (selected) => tasks.map((t) => ({ ...t, selected: t.key === selected }));
const build = () => ({
  parts: [
    {
      id: "form",
      template: "templates/camping-rest.hbs",
      context: {
        members: [
          { id: "a1", uuid: "Actor.a1", name: "Creeg Greythorn", img: art("Creeg_Greythorn-portrait.webp"), hp: 7, hpMax: 10, rations: 3, taskKey: "hunt",
            taskOptions: taskOptions("hunt"), abilityOptions: [{ index: 0, ability: "Wisdom", selected: true }, { index: 1, ability: "Constitution", selected: false }],
            isCraft: false, isEntertain: false, isKeepWatch: false, isHunt: true, pushed: false, brokenItems: [], targets: [{ id: "a2", name: "Iraga Draguul" }, { id: "a3", name: "Elbin Grizzlegut" }] },
          { id: "a2", uuid: "Actor.a2", name: "Iraga Draguul", img: art("Iraga_Draguul_portrait.webp"), hp: 5, hpMax: 8, rations: 2, taskKey: "craft",
            taskOptions: taskOptions("craft"), abilityOptions: [{ index: 0, ability: "Dexterity", selected: false }, { index: 1, ability: "Intelligence", selected: true }],
            isCraft: true, isEntertain: false, isKeepWatch: false, isHunt: false, pushed: false, brokenItems: [{ id: "i9", name: "Shortsword" }], targets: [{ id: "a1", name: "Creeg Greythorn" }] },
          { id: "a3", uuid: "Actor.a3", name: "Elbin Grizzlegut", img: art("Elbin_Grizzlegut_portrait.webp"), hp: 9, hpMax: 9, rations: 0, taskKey: "keepWatch",
            taskOptions: taskOptions("keepWatch"), abilityOptions: [{ index: 0, ability: "Wisdom", selected: true }],
            isCraft: false, isEntertain: false, isKeepWatch: true, isHunt: false, pushed: true, brokenItems: [], targets: [{ id: "a1", name: "Creeg Greythorn" }] },
          { id: "a4", uuid: "Actor.a4", name: "Bram the Porter of the Seventh Lantern Company", img: "/systems/shadowdark/assets/tokens/cowled_token.webp", hp: 4, hpMax: 4, rations: 1, taskKey: "",
            taskOptions: taskOptions(""), abilityOptions: [], isCraft: false, isEntertain: false, isKeepWatch: false, isHunt: false, pushed: false, brokenItems: [], targets: [] },
        ],
        huntBlocked: false,
        deferRest: false,
        advanceTime: true,
        advanceTimeLocked: false,
        totalRations: 14,
        totalTorches: 5,
        canLightWithTorches: true,
      },
    },
  ],
});
export default {
  title: "SHADOWDARK_EXTRAS.camping_rest.title",
  icon: "fas fa-campground",
  classes: ["shadowdark", "shadowdark-extras", "sdx-camping-rest-app"],
  width: 820,
  height: 720,
  previewHeight: 780,
  id: "sdx-camping-rest",
  initial: "rest",
  build,
};

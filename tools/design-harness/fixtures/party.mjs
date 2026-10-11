// PartySheetSD (scripts/party/PartySheetSD.mjs + party-roster.mjs): the party sheet, five tabs
// (quests tab only with a quest log). classes ["shadowdark","sheet","party","shadowdark-extras-party"],
// 750x650, initial tab = members. Context mirrors _prepareMembers() row shape; `members` gates the list
// and is the players+npcs concatenation, as in the real context. One shipped view: 3 players + 2 NPCs.
const art = (f) => "/systems/shadowdark/assets/quickstart/pregens/" + f;
const member = (o) => ({
  isNPC: false, isCompendiumActor: false, spawnFormula: null, isOwner: true,
  hpWavesEnabled: true, hpWaveColor: "#c9a227", hpWaveClass: "",
  effects: [], slots: { used: 4, max: 12, free: 8 }, xp: { current: 3, next: 10 },
  ...o,
  hpPercent: Math.round((o.hp.value / o.hp.max) * 100) || 0,
  hpWaveTranslate: Math.max(0, Math.round((o.hp.value / o.hp.max) * 100) - 15) || 0,
});
const build = () => {
  const players = [
    member({
      id: "a1", uuid: "Actor.a1", memberKey: "a1", name: "Creeg Greythorn", img: art("Creeg_Greythorn-portrait.webp"),
      hp: { value: 7, max: 10 }, ac: 14, level: 3, className: "Fighter", ancestryName: "Human",
      abilities: { str: 2, dex: 1, con: 2, int: 0, wis: 1, cha: -1 },
      effects: [{ id: "e1", name: "Blessed", img: "/icons/svg/aura.svg" }, { id: "e2", name: "Torchlight", img: "/icons/svg/light.svg" }],
      slots: { used: 7, max: 14, free: 7 }, xp: { current: 4, next: 10 },
    }),
    member({
      id: "a2", uuid: "Actor.a2", memberKey: "a2", name: "Iraga Draguul", img: art("Iraga_Draguul_portrait.webp"),
      hp: { value: 5, max: 8 }, ac: 12, level: 2, className: "Priest", ancestryName: "Elf",
      abilities: { str: -1, dex: 2, con: 0, int: 1, wis: 3, cha: 1 },
      effects: [], slots: { used: 3, max: 10, free: 7 }, xp: { current: 2, next: 10 },
    }),
    member({
      id: "a3", uuid: "Actor.a3", memberKey: "a3", name: "Bram the Porter of the Seventh Lantern Company", img: art("Martin_Rast_portrait.webp"),
      hp: { value: 4, max: 4 }, ac: 11, level: 1, className: "Thief", ancestryName: "Halfling",
      abilities: { str: -2, dex: 3, con: 1, int: 1, wis: 0, cha: 2 },
      effects: [{ id: "e3", name: "Poisoned", img: "/icons/svg/biohazard.svg" }],
      slots: { used: 9, max: 10, free: 1 }, xp: { current: 0, next: 10 },
    }),
  ];
  const npcs = [
    { id: "a4", uuid: "Actor.a4", memberKey: "a4", name: "Wolf", img: "/systems/shadowdark/assets/tokens/cowled_token.webp",
      isNPC: true, isCompendiumActor: false, spawnFormula: "2", isOwner: true, hpWavesEnabled: false, hpWaveColor: "#8a8a8a", hpWaveClass: "",
      hp: { value: 5, max: 5 }, hpPercent: 100, hpWaveTranslate: 85, ac: 12, level: null, className: "Animal", ancestryName: "",
      xp: { current: 0, next: 10 }, abilities: { str: 1, dex: 2, con: 1, int: -3, wis: 1, cha: -2 }, effects: [],
      slots: { used: 0, max: 0, free: 0 } },
    { id: "a5", uuid: "Actor.a5", memberKey: "a5", name: "Hireling Torchbearer", img: "/systems/shadowdark/assets/tokens/cowled_token.webp",
      isNPC: true, isCompendiumActor: false, spawnFormula: "1d4", isOwner: true, hpWavesEnabled: false, hpWaveColor: "#8a8a8a", hpWaveClass: "",
      hp: { value: 3, max: 6 }, hpPercent: 50, hpWaveTranslate: 85, ac: 10, level: null, className: "NPC", ancestryName: "",
      xp: { current: 0, next: 10 }, abilities: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, effects: [],
      slots: { used: 0, max: 0, free: 0 } },
  ];
  return {
    parts: [
      {
        id: "party",
        template: "templates/party.hbs",
        context: {
          cssClass: "editable",
          editable: true,
          owner: true,
          isGM: true,
          actor: { name: "The Lantern Company", img: "/systems/shadowdark/assets/tokens/cowled_token.webp" },
          memberCount: players.length + npcs.length,
          partyStats: { totalHp: 27, maxHp: 37, avgAc: 13, avgLevel: 3 },
          tabs: {
            "tab-members": { cssClass: "active" },
            "tab-inventory": { cssClass: "" },
            "tab-travel": { cssClass: "" },
            "tab-quests": { cssClass: "" },
            "tab-description": { cssClass: "" },
          },
          questTab: null,
          players,
          members: [...players, ...npcs],
          npcs,
          inventory: { items: [] },
          coins: {},
          coinSlots: {},
          inventorySlots: { used: 19, max: 34, over: false },
          descriptionHTML: "",
          campingTasks: [],
          campingMembers: [],
          travelSpeeds: [],
          overlandState: {},
        },
      },
    ],
  };
};
export default {
  title: "The Lantern Company",
  icon: "fas fa-users",
  classes: ["shadowdark", "sheet", "party", "shadowdark-extras-party"],
  width: 750,
  height: 1030,
  previewHeight: 990,
  id: "sdx-party",
  initial: "members",
  build,
};

// TrayApp (scripts/tray/TrayApp.mjs): the SDX side tray, templates/sdx-tray/tray.hbs. One template, one part, eight
// views. The real app is frame:false and docked at the left (position:fixed, translated off-screen until expanded);
// the harness always draws a window frame, so the css below hides the header and docks the tray statically — what is
// judged is the tray itself, not Foundry's window chrome. The tray's behaviour (painting, flattening, tabs, search) is
// bound in scripts/tray/*-bindings.mjs, none of which runs here: this is a look, not a tool.
//
// Context is hand-built to the shape scripts/tray/TraySD.mjs hands the tray (the big `data` object near the end of
// its render function) plus what TrayApp._prepareContext derives. Tile and image names come from the module's real
// assets/ folders, so the grids show its own art and stay in step when tiles are added. When TraySD adds a context
// key this fixture will not know it, and the template just renders the key's empty branch.
//
//   Dungeons   tiles  intwalls  doors  fill (Paint Floor armed)  generator (panel open)  player (paints via the GM)
//              tiles-open (the redesign's folded sections open; the original template ignores it)
//   Token      token (a player with a character)  notoken (nothing selected)
//   ToM        scenes
//   Party      party
//   Pins       pins
//   Notes      notes
//   Hexes      hexes  hexes-colored  hexes-custom  hexes-poi
//   Decor      decor
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MOD = "modules/shadowdark-extras/";
const pretty = (f) => f.replace(/\.[^.]+$/, "").replace(/_/g, " ");
const IMG = /\.(webp|png|jpe?g|svg)$/i;

// First `n` image files of an assets/ subfolder as the tile records the template reads (first one `active`).
const files = (dir) => { const full = path.join(ROOT, "assets", dir); return fs.existsSync(full) ? fs.readdirSync(full).filter((f) => IMG.test(f)).sort() : []; };
const dirs = (dir) => { const full = path.join(ROOT, "assets", dir); return fs.existsSync(full) ? fs.readdirSync(full, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : []; };
const tiles = (dir, n, extra = {}) => files(dir).slice(0, n).map((f, i) => ({ path: `assets/${dir}/${f}`, src: encodeURI(`${MOD}assets/${dir}/${f}`), label: pretty(f), active: i === 0, ...extra }));

// Core ships these; the system's art stands in for portraits (as the SDE crawl-tracker fixture does).
const ART = "/systems/shadowdark/assets/quickstart/pregens/";
const PORTRAITS = [`${ART}Creeg_Greythorn-portrait.webp`, `${ART}Elbin_Grizzlegut_portrait.webp`, `${ART}Iraga_Draguul_portrait.webp`, "/systems/shadowdark/assets/tokens/cowled_token.webp"];

// TraySD.getHealthbarStatusFromHP / getHealthOverlayHeight, which the harness cannot import (Foundry globals).
const status = (pct) => (pct <= 0 ? "dead" : pct <= 25 ? "critical" : pct <= 50 ? "bloodied" : pct <= 75 ? "injured" : "healthy");
const hp = (value, max) => ({ value, max, percent: Math.round((value / max) * 100) });
const helpers = {
  // TrayApp registers these at init; the harness does not know them.
  healthOverlayHeight: (h) => (!h ? "0%" : `${Math.min(100, Math.max(0, h.max ? ((h.max - h.value) / h.max) * 100 : 100 - (h.percent ?? 0)))}%`),
  multiply: (a, b) => (a || 0) * (b || 0),
  divide: (a, b) => (b ? (a || 0) / b : 0),
};

const features = {
  tomScenes: true, tomVideoOverlays: true, tomPlayerView: true, tomSceneEditor: true, partyManagement: true,
  journalPins: true, journalPlaceableNotes: true, hexPainter: true, dungeonPainter: true, hexDecorPainter: true,
  canvasTileFlatten: true, combatMarchingMode: true, combatFormationSpawner: true, canvasLightTracker: true,
  partyCarousing: true, canvasDrawingTools: true, sceneMapGenerators: true, hexCoordinates: true, hexTooltip: true,
  hexFog: true, hexSoloMode: true, trayRoller: true,
};

// --- data per view -----------------------------------------------------------------------------------------------

const party = () => {
  const mk = (i, name, v, m, extra = {}) => ({ id: `t${i}`, name, img: PORTRAITS[i], hp: hp(v, m), healthbarStatus: status((v / m) * 100), ac: 12 + i, luck: i % 2, hasLuck: true,
    showHpNumbers: true, showAc: true, isOwner: true, isNPC: false, isSelected: i === 0, ...extra });
  const partyTokens = [mk(0, "Creeg Greythorn", 9, 9), mk(1, "Elbin Grizzlegut", 5, 8), mk(2, "Iraga Draguul", 2, 7), mk(3, "Jorbin Ironhelm", 0, 6)];
  const npc = (i, name, v, m) => ({ id: `n${i}`, name, img: PORTRAITS[3], hp: hp(v, m), healthbarStatus: status((v / m) * 100), ac: 11, showHpNumbers: true, showAc: true, isOwner: true, isNPC: true, isSelected: false });
  const total = partyTokens.reduce((a, t) => a + t.hp.max, 0), left = partyTokens.reduce((a, t) => a + t.hp.value, 0);
  return { partyTokens, npcTokens: [npc(0, "Goblin Raider", 3, 5), npc(1, "Cave Troll", 14, 22)], partyTotalHP: total, partyRemainingHP: left, partyHealthbarStatus: status((left / total) * 100), hideNpcsFromPlayers: false };
};

const pins = () => {
  const row = (o) => ({ rowType: "pin", parentId: "", ancestors: "", depth: 0, indent: 0, hidden: false, x: 1200, y: 800, backgroundColor: "#000000", borderColor: "#ffffff",
    borderRadius: "50%", displayType: "icon", displayClass: "fa-solid fa-skull", displayStyle: "color: #ffffff;", displayContent: "", displayTint: "", pageName: "", gmOnly: false, requiresVision: false, ...o });
  return {
    pins: [
      { rowType: "folder", id: "f1", parentId: "", ancestors: "", depth: 0, indent: 0, hidden: false, collapsed: false, color: "#c9a227", icon: "fa-solid fa-dungeon", iconIsImage: false, name: "Level 1 — The Crypt", count: 3, scope: "scene" },
      row({ id: "p1", parentId: "f1", ancestors: "f1", indent: 14, name: "Entrance", pageName: "Area 1", displayClass: "fa-solid fa-door-open" }),
      row({ id: "p2", parentId: "f1", ancestors: "f1", indent: 14, name: "Sarcophagus Hall", pageName: "Area 4", displayType: "text", displayContent: "4", displayStyle: "color: #ffffff; font-family: Arial; font-weight: bold; font-size: 16px;", backgroundColor: "#5c1d1d", gmOnly: true }),
      row({ id: "p3", parentId: "f1", ancestors: "f1", indent: 14, name: "Hidden Lever", displayClass: "fa-solid fa-lock", requiresVision: true, gmOnly: true }),
      row({ id: "p4", name: "Camp", pageName: "Rest here", displayClass: "fa-solid fa-campground", backgroundColor: "#1d3a1d" }),
    ],
    mapNotes: [
      { id: "m1", uuid: "Scene.x.Note.m1", name: "Collapsed bridge", img: "icons/svg/book.svg", x: 400, y: 300, canDelete: true },
      { id: "m2", uuid: "Scene.x.Note.m2", name: "Old shrine", img: "icons/svg/book.svg", x: 900, y: 650, canDelete: true },
    ],
    pinSearchTerm: "",
  };
};

const notes = () => ({
  noteGroups: [
    { id: "tokens", label: "Tokens", icon: "fa-solid fa-user", count: 2, collapsed: false, rows: [
      { sourceUuid: "Scene.x.Token.a", sourceType: "Token", displayName: "Goblin Raider", isVisible: true, expanded: true, icon: "fa-solid fa-user", enrichedContent: "<p>Carries a <strong>rusted key</strong> on a cord. Flees at half HP.</p>" },
      { sourceUuid: "Scene.x.Token.b", sourceType: "Token", displayName: "Cave Troll", isVisible: false, expanded: false, icon: "fa-solid fa-user", enrichedContent: "<p>Regenerates unless burned.</p>" },
    ] },
    { id: "tiles", label: "Tiles", icon: "fa-solid fa-image", count: 1, collapsed: false, rows: [
      { sourceUuid: "Scene.x.Tile.a", sourceType: "Tile", displayName: "Cracked flagstones", isVisible: true, expanded: false, icon: "fa-solid fa-image", enrichedContent: "<p>A trapdoor lies under the third slab.</p>" },
    ] },
    { id: "lights", label: "Lights", icon: "fa-solid fa-lightbulb", count: 1, collapsed: true, rows: [
      { sourceUuid: "Scene.x.AmbientLight.a", sourceType: "AmbientLight", displayName: "Brazier", isVisible: true, expanded: false, icon: "fa-solid fa-lightbulb", enrichedContent: "<p>Goes out if the door is opened.</p>" },
    ] },
  ],
  noteSceneId: "x",
});

const scenes = () => {
  const bg = (f) => `${MOD}assets/tiles/${encodeURI(f)}`;
  const names = files("tiles");
  const sc = (i, name, extra = {}) => ({ id: `s${i}`, name, background: bg(names[i % Math.max(1, names.length)] ?? "blank.webp"), isVideo: false, isArena: false, folderId: "", ...extra });
  return {
    tomActiveSceneId: "s1",
    tomFolders: [{ id: "fo1", name: "Chapter 1", collapsed: false, scenes: [sc(1, "The Sunken Gate", { folderId: "fo1" }), sc(2, "Market Square", { folderId: "fo1" })] },
      { id: "fo2", name: "Chapter 2", collapsed: true, scenes: [sc(3, "Wolf Den", { folderId: "fo2", isArena: true })] }],
    tomScenes: [sc(1, "The Sunken Gate", { folderId: "fo1" }), sc(2, "Market Square", { folderId: "fo1" }), sc(3, "Wolf Den", { folderId: "fo2", isArena: true }), sc(0, "Tavern Interior"), sc(4, "Hex Overland Map")],
    tomOverlaysCollapsed: false,
  };
};
// Overlay names come from the real Tom/overlays folder (videos, so listed by name only).
const overlays = () => {
  const full = path.join(ROOT, "assets/Tom/overlays");
  const names = fs.existsSync(full) ? fs.readdirSync(full).sort().slice(0, 6) : [];
  return names.map((n, i) => ({ name: pretty(n), path: `${MOD}assets/Tom/overlays/${n}`, active: i < 2 }));
};

const hexData = (tab) => {
  const biomes = ["Water", "Vegetation", "Desert"].filter((d) => files(`Hexes/${d}`).length);
  const hexTiles = biomes.flatMap((d, bi) => tiles(`Hexes/${d}`, 4)).map((t, i) => ({ ...t, active: i === 0 }));
  const symbolDirs = dirs("symbols").slice(0, 3);
  return {
    activeTileTab: tab, hexColumns: 30, hexRows: 30, hexPathKind: null, hexRoadStyle: "art", hexPathWidth: 15, hexSearchFilter: "",
    waterEffect: true, windEffect: false, fogAnimation: false, tintEnabled: true, bwEffect: false, poiScalePercent: 100, canUndoPoi: false, canRedoPoi: false, poiMirror: false,
    hexTiles,
    coloredTileWidth: 200, coloredTileHeight: 173, hasColoredTagFilters: false,
    hexColoredTags: [{ tag: "forest", label: "Forest", count: 6, active: false }, { tag: "water", label: "Water", count: 4, active: false }],
    hexColoredTiles: tiles("tiles", 8, { biome: "Forest" }),
    customTileWidth: 200, customTileHeight: 173, customNavPath: [], customNavBreadcrumb: [{ label: "hexes", segments: [] }],
    customNavChips: [{ name: "Regions", label: "Regions", count: 12 }, { name: "Autumn", label: "Autumn", count: 9 }],
    hexCustomTiles: tiles("Hexes/Regions", 6, { biome: "Region" }),
    hexSymbolFolders: symbolDirs.map((d, i) => ({ folder: d, label: d, collapsed: i > 0, tiles: tiles(`symbols/${d}`, 6, { category: d }) })),
  };
};

const decorData = () => ({
  decorSearchFilter: "", decorElevation: 0, decorSort: 0, poiScalePercent: 100,
  decorFolders: [{ folder: "clutter", label: "Clutter", collapsed: false, tiles: tiles("Dungeon/clutter", 9, { category: "clutter" }) },
    { folder: "decor", label: "Decor", collapsed: false, tiles: tiles("Dungeon/decor", 4, { category: "decor" }) }],
});

const dungeonData = (mode, { floorTool = null, generator = false } = {}) => {
  const floorTiles = tiles("Dungeon/floor_tiles", 12), wallTiles = tiles("Dungeon/wall_tiles", 12), doorTiles = tiles("Dungeon/door_tiles", 9);
  const bgs = files("Dungeon/backgrounds").slice(0, 4).map((f) => ({ value: `assets/Dungeon/backgrounds/${f}`, label: pretty(f), active: false }));
  return {
    dungeonMode: mode, floorTool, backgroundOptions: [{ value: "", label: "None", active: true }, ...bgs],
    noFoundryWalls: false, wallShadows: false, curvedWalls: false, collapsed: {},
    generatorExpanded: generator, generatorSeed: "k3j9x2",
    // DungeonGeneratorSD.mjs _generatorSettings defaults
    generatorSettings: { rooms: 10, density: 0.8, branching: 0.5, roomSize: 0.5, symmetry: true, stairs: 1, stairsDown: 1, clutter: 0, decorLights: 0, decorTiles: true, textured: true, wallShadows: false, wallColor: "#5C3D3D", thickness: 20, style: "rooms", biomes: false },
    hasFloorTiles: floorTiles.length > 0, floorTiles,
    hasWallTiles: wallTiles.length > 0, wallTiles, intWallTiles: wallTiles.slice(0, 8),
    hasDoorTiles: doorTiles.length > 0, doorTiles,
    hasIntDoorTiles: doorTiles.length > 0, intDoorTiles: doorTiles.slice(0, 6),
  };
};

// --- states ------------------------------------------------------------------------------------------------------

// "all-<dungeon state>": every view's data at once (viewMode dungeons), for interactive prototypes: the template renders every
// view into the DOM and only hides the inactive ones by class, so a page script can switch tabs without re-rendering.
const ALL = {
  tiles: () => dungeonData("tiles"), intwalls: () => dungeonData("intwalls"), doors: () => dungeonData("doors"),
  fill: () => dungeonData("tiles", { floorTool: "fill" }), erase: () => dungeonData("tiles", { floorTool: "erase" }),
  generator: () => dungeonData("tiles", { generator: true }),
};
const everything = (sub) => ({
  ...hexData("default"), ...decorData(), ...party(), ...pins(), ...notes(), ...scenes(), tomOverlayOptions: overlays(), tomOverlayCount: 2,
  actor: { name: "Creeg Greythorn", img: PORTRAITS[0], system: { level: { value: 3 } } }, actorHP: hp(5, 9), actorHealthbarStatus: status((5 / 9) * 100),
  ...ALL[sub](),
});

const build = (state) => {
  if (state.startsWith("all-") && ALL[state.slice(4)]) {
    return { parts: [{ id: "main", template: "templates/sdx-tray/tray.hbs", context: {
      features, isGM: true, canPlayerPaint: false, isExpanded: true, viewMode: "dungeons", showTabParty: true,
      isHexagonal: false, hexFogActive: false, soloModeActive: false, canUndoPoi: false, canRedoPoi: false, showSelectionBox: false,
      ...everything(state.slice(4)),
    } }] };
  }
  const gm = !["player", "token", "notoken"].includes(state);
  const actor = { name: "Creeg Greythorn", img: PORTRAITS[0], system: { level: { value: 3 } } };
  const view = {
    tiles: ["dungeons", dungeonData("tiles")], intwalls: ["dungeons", dungeonData("intwalls")], doors: ["dungeons", dungeonData("doors")],
    fill: ["dungeons", dungeonData("tiles", { floorTool: "fill" })],
    "tiles-open": ["dungeons", { ...dungeonData("tiles"), ddOptionsOpen: true, ddLevelOpen: true }], generator: ["dungeons", dungeonData("tiles", { generator: true })], player: ["dungeons", dungeonData("tiles")],
    token: ["player", { actor, actorHP: hp(5, 9), actorHealthbarStatus: status((5 / 9) * 100) }], notoken: ["player", { actor: null, actorHP: null }],
    scenes: ["scenes", { ...scenes(), tomOverlayOptions: overlays(), tomOverlayCount: 2 }],
    party: ["party", party()], pins: ["pins", pins()], notes: ["notes", notes()],
    hexes: ["hexes", hexData("default")], "hexes-colored": ["hexes", hexData("colored")], "hexes-custom": ["hexes", hexData("custom")], "hexes-poi": ["hexes", hexData("symbols")],
    decor: ["decor", decorData()],
  }[state] ?? ["dungeons", dungeonData("tiles")];
  return {
    parts: [{
      id: "main",
      template: "templates/sdx-tray/tray.hbs",
      context: {
        features, isGM: gm, canPlayerPaint: !gm, isExpanded: true, viewMode: view[0], showTabParty: true,
        isHexagonal: false, hexFogActive: false, soloModeActive: false, canUndoPoi: false, canRedoPoi: false,
        showSelectionBox: false, activeTileTab: "default", ...view[1],
      },
    }],
  };
};

// Dock the tray where it sits in a session instead of fixed and off-screen, hide the window chrome, and give it a
// definite height (the real one is the viewport: calc(100vh - 10px)); each view's list scrolls inside it, as live.
const css = `
.application .window-header{display:none}
.harness-toolbar{flex-wrap:wrap;max-width:440px}   /* 17 state buttons: keep the bar as narrow as the tray so crops stay tight */
.application{background:none!important;border:0!important;box-shadow:none!important}
.application .window-content{padding:0!important;overflow:visible!important;background:none!important}
.sdx-tray[data-position="left"]{position:relative!important;top:auto!important;left:auto!important;transform:none!important;height:790px!important}
`;

const STATES = ["tiles", "tiles-open", "intwalls", "doors", "fill", "generator", "player", "token", "notoken", "scenes", "party", "pins", "notes", "hexes", "hexes-colored", "hexes-custom", "hexes-poi", "decor"];

export default {
  title: "SDX tray", icon: "fa-solid fa-dungeon", classes: ["sdx-tray-host"], id: "sdx-tray",
  width: 420, previewHeight: 820, initial: "tiles", build, css, helpers,
  toolbar: `<span>State:</span>${STATES.map((s) => `<button data-action="s" data-state="${s}">${s}</button>`).join("")}`,
  actions: { s: { state: "{state}" } },
};

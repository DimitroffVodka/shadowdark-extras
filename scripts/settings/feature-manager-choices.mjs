import {
	FEATURE_CATALOG,
	FEATURE_GROUPS,
	FEATURE_IDS,
	getDisabledFeatureIds,
	getFeatureState,
	normalizeDisabledFeatureIds,
} from "./feature-gates.mjs";
import { MODULE_ID } from "../shared/module-id.mjs";

const previewPath = filename => `modules/${MODULE_ID}/assets/feature-manager/${filename}.webp`;

const choice = (id, group, name, description, location, preview, members) => Object.freeze({
	id,
	group,
	name,
	description,
	location,
	preview: previewPath(preview),
	members: Object.freeze(members),
});

export const VISIBLE_FEATURE_GROUPS = Object.freeze([
	{ id: "tabs", name: "SDX Tray Tabs" },
	{ id: "tools", name: "SDX Tray Tools" },
]);

export const VISIBLE_FEATURE_CHOICES = Object.freeze([
	choice(
		"sdx-tray",
		"master",
		"SDX Tray",
		"Show and initialize the complete SDX sidebar tray.",
		"Left side of the Foundry canvas",
		"sdx-tray",
		[FEATURE_IDS.TRAY]
	),
	choice(
		"scenes",
		"tabs",
		"Scenes",
		"Create, organize, edit, broadcast, and stop scenes, including the player view, navigation, arena editor, and video overlays.",
		"SDX Tray → Scenes tab",
		"scenes",
		[
			FEATURE_IDS.TOM_SCENES,
			FEATURE_IDS.TOM_VIDEO_OVERLAYS,
			FEATURE_IDS.TOM_SCENE_EDITOR,
			FEATURE_IDS.TOM_PLAYER_VIEW,
			FEATURE_IDS.TOM_SCENE_NAVIGATION,
		]
	),
	choice(
		"party",
		"tabs",
		"Party",
		"Party roster, health cards, travel, camping, weather, token selection, and stat synchronization.",
		"SDX Tray → Party tab",
		"party",
		[FEATURE_IDS.PARTY_MANAGEMENT]
	),
	choice(
		"pins",
		"tabs",
		"Pins",
		"Journal pin list, pin placement, canvas rendering, folders, styles, and pin tools.",
		"SDX Tray → Pins tab, Add Pin, and Pin List",
		"pins",
		[FEATURE_IDS.JOURNAL_PINS]
	),
	choice(
		"notes",
		"tabs",
		"Notes",
		"Notes attached to tiles, walls, lights, sounds, and tokens.",
		"SDX Tray → Notes tab",
		"notes",
		[FEATURE_IDS.PLACEABLE_NOTES]
	),
	choice(
		"hexes",
		"tabs",
		"Hexes",
		"Paint hex tiles, symbols, custom tiles, points of interest, and generated hex content.",
		"SDX Tray → Hexes tab",
		"hexes",
		[FEATURE_IDS.HEX_PAINTER]
	),
	choice(
		"dungeons",
		"tabs",
		"Dungeons",
		"Paint and generate dungeons, manage biomes and levels, and flatten finished tiles.",
		"SDX Tray → Dungeons tab",
		"dungeons",
		[FEATURE_IDS.DUNGEON_PAINTER, FEATURE_IDS.TILE_FLATTEN]
	),
	choice(
		"decor",
		"tabs",
		"Decor",
		"Paint decor assets over hex maps and transform placed points of interest.",
		"SDX Tray → Decor tab",
		"decor",
		[FEATURE_IDS.DECOR_PAINTER]
	),
	choice(
		"marching-mode",
		"tools",
		"Marching Mode",
		"Choose the party leader and synchronize marching movement for the party.",
		"SDX Tray handle → Crown and walking buttons",
		"marching-mode",
		[FEATURE_IDS.MARCHING_MODE]
	),
	choice(
		"formation-spawner",
		"tools",
		"Formation Spawner",
		"Arrange the party on a grid and spawn the formation onto the canvas.",
		"SDX Tray handle → Formation button",
		"formation-spawner",
		[FEATURE_IDS.FORMATION_SPAWNER]
	),
	choice(
		"light-source-tracker",
		"tools",
		"Light Source Tracker",
		"Track active token light sources, remaining durations, and light controls.",
		"SDX Tray handle → Fire button",
		"light-source-tracker",
		[FEATURE_IDS.LIGHT_TRACKER]
	),
	choice(
		"carousing",
		"tools",
		"Carousing",
		"Run downtime carousing, apply outcomes, manage renown and wealth, and keep a log.",
		"SDX Tray handle → Carousing button",
		"carousing",
		[FEATURE_IDS.CAROUSING]
	),
	choice(
		"drawing-tools",
		"tools",
		"Drawing Tools",
		"Draw synchronized shapes and stamps on the canvas with optional timed erase.",
		"SDX Tray handle → Pencil button",
		"drawing-tools",
		[FEATURE_IDS.DRAWING_TOOLS]
	),
	choice(
		"map-generators",
		"tools",
		"Map Generators",
		"Open bundled Watabou generators and import generated maps as Foundry scenes.",
		"SDX Tray handle → Map button",
		"map-generators",
		[FEATURE_IDS.MAP_GENERATORS]
	),
	choice(
		"toggle-coordinates",
		"tools",
		"Toggle Coordinates",
		"Show map coordinates using standard labels or Shadowdark zine-style hex IDs.",
		"SDX Tray handle → Globe button",
		"toggle-coordinates",
		[FEATURE_IDS.COORDINATES]
	),
	choice(
		"hex-tooltip",
		"tools",
		"Hex Tooltip / Hexplorer",
		"Hover over hexes to explore generated terrain, settlements, and dungeons.",
		"SDX Tray handle → Information button",
		"hex-tooltip",
		[FEATURE_IDS.HEX_TOOLTIP]
	),
	choice(
		"hex-fog",
		"tools",
		"Hex Fog",
		"Track per-hex fog state, reveal explored hexes, and apply fog effects.",
		"SDX Tray handle → Fog button",
		"hex-fog",
		[FEATURE_IDS.HEX_FOG]
	),
	choice(
		"solo-hex-mode",
		"tools",
		"Solo Hex Mode",
		"Generate wilderness hex tiles and journal content while a token explores.",
		"SDX Tray handle → Compass button",
		"solo-hex-mode",
		[FEATURE_IDS.SOLO_HEX_MODE]
	),
	choice(
		"sdx-roller",
		"tools",
		"SDX Roller",
		"Run cinematic rolls, group checks, overlays, and recap cards.",
		"SDX Tray handle → Dice button",
		"sdx-roller",
		[FEATURE_IDS.SDX_ROLLER]
	),
]);

const CHOICES_BY_ID = new Map(VISIBLE_FEATURE_CHOICES.map(entry => [entry.id, entry]));
const VISIBLE_MEMBER_IDS = new Set(VISIBLE_FEATURE_CHOICES.flatMap(entry => entry.members));

export function getVisibleFeatureChoice(choiceId) {
	return CHOICES_BY_ID.get(choiceId) ?? null;
}

export function getVisibleFeatureChoiceState(
	choiceId,
	disabledFeatureIds = getDisabledFeatureIds()
) {
	const entry = getVisibleFeatureChoice(choiceId);
	if (!entry) throw new Error(`${MODULE_ID} | Unknown visible feature choice: ${choiceId}`);

	const disabled = new Set(normalizeDisabledFeatureIds(disabledFeatureIds));
	const directEnabled = entry.members.filter(id => !disabled.has(id));
	const effectiveStates = entry.members.map(id => ({
		id,
		...getFeatureState(id, disabledFeatureIds),
	}));
	const blocked = effectiveStates.find(state => state.reason === "dependency");

	return {
		checked: directEnabled.length === entry.members.length,
		partial: directEnabled.length > 0 && directEnabled.length < entry.members.length,
		blocked: Boolean(blocked),
		blockedBy: blocked?.blockedBy ?? null,
	};
}

export function applyVisibleFeatureChoiceState(value, choiceId, enabled) {
	const entry = getVisibleFeatureChoice(choiceId);
	if (!entry) throw new Error(`${MODULE_ID} | Unknown visible feature choice: ${choiceId}`);

	const selected = new Set(normalizeDisabledFeatureIds(value));
	for (const id of entry.members) {
		if (enabled) selected.delete(id);
		else selected.add(id);
	}
	return normalizeDisabledFeatureIds([...selected]);
}

export function applyVisibleFeatureGroupState(value, groupId, enabled) {
	if (!VISIBLE_FEATURE_GROUPS.some(group => group.id === groupId)) {
		throw new Error(`${MODULE_ID} | Unknown visible feature group: ${groupId}`);
	}

	return VISIBLE_FEATURE_CHOICES
		.filter(entry => entry.group === groupId)
		.reduce(
			(disabled, entry) => applyVisibleFeatureChoiceState(disabled, entry.id, enabled),
			normalizeDisabledFeatureIds(value)
		);
}

export function getAdvancedFeatureGroups() {
	return FEATURE_GROUPS.map(group => ({
		...group,
		features: FEATURE_CATALOG.filter(
			entry => entry.group === group.id && !VISIBLE_MEMBER_IDS.has(entry.id)
		),
	})).filter(group => group.features.length > 0);
}

export function getVisibleFeatureMemberIds() {
	return [...VISIBLE_MEMBER_IDS];
}

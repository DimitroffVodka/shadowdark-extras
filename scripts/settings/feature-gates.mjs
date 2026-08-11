import { MODULE_ID } from "../shared/module-id.mjs";

export const FEATURE_SETTING_KEY = "disabledFeatures";

export const FEATURE_IDS = Object.freeze({
	TRAY: "tray.core",
	TOM_SCENES: "tom.scenes",
	PARTY_MANAGEMENT: "party.management",
	JOURNAL_PINS: "journal.pins",
	PLACEABLE_NOTES: "journal.placeableNotes",
	HEX_PAINTER: "hex.painter",
	DUNGEON_PAINTER: "dungeon.painter",
	DECOR_PAINTER: "hex.decorPainter",
	MARCHING_MODE: "combat.marchingMode",
	FORMATION_SPAWNER: "combat.formationSpawner",
	LIGHT_TRACKER: "canvas.lightTracker",
	CAROUSING: "party.carousing",
	DRAWING_TOOLS: "canvas.drawingTools",
	MAP_GENERATORS: "scene.mapGenerators",
	COORDINATES: "hex.coordinates",
	HEX_TOOLTIP: "hex.tooltip",
	HEX_FOG: "hex.fog",
	SDX_ROLLER: "tray.roller",
	SOLO_HEX_MODE: "hex.soloMode",
	TOM_VIDEO_OVERLAYS: "tom.videoOverlays",
	DAMAGE_CARDS: "combat.damageCards",
	SCROLLING_COMBAT_TEXT: "combat.scrollingText",
	WEAPON_BONUSES: "combat.weaponBonuses",
	SPELL_ACTIVITY: "spells.activitySystem",
	FOCUS_TRACKER: "spells.focusTracker",
	AMMUNITION: "inventory.ammunition",
	MEDKIT: "combat.medkit",
	FREYAS_OMEN: "combat.freyasOmen",
	CRAWL_HELPER_DEATH_TIMER: "combat.crawlHelperDeathTimer",
	ANIMATION_FX: "animation.fx",
	ANIMATION_ITEM_OVERRIDES: "animation.itemOverrides",
	TORCH_ANIMATIONS: "animation.torch",
	LEVEL_UP_ANIMATIONS: "animation.levelUp",
	WEAPON_SPRITES: "animation.weaponSprites",
	TMFX_EDITOR: "animation.tmfxEditor",
	AUTOMATED_ANIMATIONS: "animation.automatedAnimations",
	ENHANCED_HEADER: "character.enhancedHeader",
	HP_WAVES: "character.hpWaves",
	QUICK_CONDITIONS: "character.quickConditions",

	JOURNAL_NOTES: "character.journalNotes",
	ADD_COINS: "character.addCoins",
	SHEET_LOCKING: "character.sheetLocking",
	SHEET_STYLING: "character.sheetStyling",
	BACKGROUND_ADVANCEMENT: "character.backgroundAdvancement",
	SKILLS_BOX: "character.skillsBox",
	SPELLBOOK_FILTER: "character.spellbookFilter",
	ENHANCED_TABS: "character.enhancedTabs",
	CHARACTER_GENERATOR: "character.generator",
	CONTAINERS: "inventory.containers",
	TRADING: "inventory.trading",
	UNIDENTIFIED_ITEMS: "inventory.unidentifiedItems",
	MULTI_SELECT: "inventory.multiSelect",
	INVENTORY_STYLING: "inventory.styling",
	GEM_ENHANCEMENTS: "inventory.gems",
	ITEM_PILES: "inventory.itemPiles",
	PLAYER_TRANSFERS: "inventory.playerTransfers",
	NPC_INVENTORY: "npc.inventory",
	NPC_CREATURE_TYPES: "npc.creatureTypes",
	MYSTERIOUS_CASTING: "npc.mysteriousCasting",
	NPC_CUSTOM_SHEETS: "npc.customSheets",
	DAMAGE_TYPES: "effects.damageTypes",
	PREDEFINED_EFFECTS: "effects.predefinedLibrary",
	TEMPLATE_EFFECTS: "effects.templateEffects",
	AURAS: "effects.auras",
	BREAK_ON_DAMAGE: "effects.breakOnDamage",
	CASTING_BLOCKERS: "effects.castingBlockers",
	INVISIBILITY: "effects.invisibility",
	SOURCE_REQUIREMENTS: "effects.sourceRequirements",
	DISPLAY_CARDS: "journal.displayCards",
	EASY_REFERENCE: "journal.easyReference",
	JOURNAL_NARRATION: "journal.narration",
	ICON_PICKER: "journal.iconPicker",
	TOKEN_TOOLBAR: "canvas.tokenToolbar",
	WALL_CONTEXT_MENU: "canvas.wallContextMenu",
	TOM_SCENE_NAVIGATION: "tom.sceneNavigation",
	TILE_FLATTEN: "canvas.tileFlatten",
	TOM_SCENE_EDITOR: "tom.sceneEditor",
	TOM_PLAYER_VIEW: "tom.playerView",

	ITEM_MACROS: "items.itemMacros",
	MAGIC_ITEM_SHEETS: "items.magicItemSheets",
	SPELL_CONFIGS: "items.spellConfigs",
});

export const FEATURE_GROUPS = Object.freeze([
	{ id: "trayCanvas", name: "Tray & Canvas" },
	{ id: "party", name: "Party & Carousing" },
	{ id: "combat", name: "Combat" },
	{ id: "animation", name: "Animation" },
	{ id: "character", name: "Character Sheets" },
	{ id: "inventory", name: "Inventory" },
	{ id: "npc", name: "NPCs" },
	{ id: "effects", name: "Effects & Spells" },
	{ id: "journal", name: "Journal & Reference" },
	{ id: "tom", name: "Theatre of the Mind" },
	{ id: "items", name: "Item Automation" },
]);

const feature = (id, group, name, description, options = {}) => Object.freeze({
	id,
	group,
	name,
	description,
	dependencies: Object.freeze(options.dependencies ?? []),
	visible: options.visible ?? false,
});

export const FEATURE_CATALOG = Object.freeze([
	feature(FEATURE_IDS.TRAY, "trayCanvas", "SDX Tray", "Show and initialize the SDX sidebar tray.", { visible: true }),
	feature(FEATURE_IDS.PARTY_MANAGEMENT, "party", "Party Management", "Party view, roster, sheet, travel, camping, weather, health cards, token selection, and stat sync.", { visible: true }),
	feature(FEATURE_IDS.CAROUSING, "party", "Carousing", "Carousing sheets, overlay, rolls, tables, outcomes, renown, wealth, and logs.", { visible: true }),
	feature(FEATURE_IDS.JOURNAL_PINS, "trayCanvas", "Journal Pins", "Canvas pins, pin list, pin placement, rendering, and pin tools.", { visible: true }),
	feature(FEATURE_IDS.PLACEABLE_NOTES, "trayCanvas", "Placeable Notes", "Notes attached to placeables and the tray Notes view.", { visible: true }),
	feature(FEATURE_IDS.HEX_PAINTER, "trayCanvas", "Hex Painter", "Hex tile, symbol, POI, and content painting tools.", { visible: true }),
	feature(FEATURE_IDS.DUNGEON_PAINTER, "trayCanvas", "Dungeon Painter", "Dungeon painting, generation, biome, level, and flatten tools.", { visible: true }),
	feature(FEATURE_IDS.DECOR_PAINTER, "trayCanvas", "Decor Painter", "Decor asset painting and POI transform controls.", { dependencies: [FEATURE_IDS.HEX_PAINTER], visible: true }),
	feature(FEATURE_IDS.LIGHT_TRACKER, "trayCanvas", "Light Source Tracker", "SDX light tracker app, token light controls, and tray launcher.", { visible: true }),
	feature(FEATURE_IDS.DRAWING_TOOLS, "trayCanvas", "Drawing Tools", "Synchronized canvas drawing toolbar and tray launcher.", { visible: true }),
	feature(FEATURE_IDS.MAP_GENERATORS, "trayCanvas", "Map Generators", "Bundled Watabou map generators and scene import tools.", { visible: true }),
	feature(FEATURE_IDS.COORDINATES, "trayCanvas", "Map Coordinates", "Hex coordinate overlay, settings, and tray toggle.", { visible: true }),
	feature(FEATURE_IDS.HEX_TOOLTIP, "trayCanvas", "Hex Tooltip / Hexplorer", "Generated hex content shown from canvas hover.", { visible: true }),
	feature(FEATURE_IDS.HEX_FOG, "trayCanvas", "Hex Fog", "Per-hex fog state, reveal controls, and fog effects.", { visible: true }),
	feature(FEATURE_IDS.SDX_ROLLER, "trayCanvas", "SDX Roller", "Cinematic roll app, overlays, recap cards, and socket messages.", { visible: true }),
	feature(FEATURE_IDS.SOLO_HEX_MODE, "trayCanvas", "Solo Hex Mode", "Generate wilderness hex content as a token explores.", { visible: true }),
	feature(FEATURE_IDS.TOKEN_TOOLBAR, "trayCanvas", "Token Toolbar", "Quick canvas controls for effects and equipped items."),
	feature(FEATURE_IDS.WALL_CONTEXT_MENU, "trayCanvas", "Wall Context Menu", "Extra right-click actions for walls."),
	feature(FEATURE_IDS.TILE_FLATTEN, "trayCanvas", "Tile Flatten", "Flatten and restore canvas tiles as scene backgrounds."),

	feature(FEATURE_IDS.DAMAGE_CARDS, "combat", "Enhanced Damage Cards", "Targeting, range checks, multipliers, and damage application."),
	feature(FEATURE_IDS.SCROLLING_COMBAT_TEXT, "combat", "Scrolling Combat Text", "Floating damage and healing numbers above tokens."),
	feature(FEATURE_IDS.WEAPON_BONUSES, "combat", "Weapon Bonuses", "Hit, damage, critical, on-hit, and item-macro weapon bonuses."),
	feature(FEATURE_IDS.MARCHING_MODE, "combat", "Marching Mode", "Party leader selection and synchronized marching movement.", { visible: true }),
	feature(FEATURE_IDS.FORMATION_SPAWNER, "combat", "Formation Spawner", "Arrange and spawn party tokens in a formation.", { visible: true }),
	feature(FEATURE_IDS.FOCUS_TRACKER, "combat", "Focus Spell Tracker", "Focus checks, duration tracking, and effect cleanup."),
	feature(FEATURE_IDS.MEDKIT, "combat", "Medkit", "Actor and world spell-enhancement scans."),
	feature(FEATURE_IDS.FREYAS_OMEN, "combat", "Freya's Omen", "Omen reroll handling on spell cards."),
	feature(FEATURE_IDS.CRAWL_HELPER_DEATH_TIMER, "combat", "Crawl Helper Death Timer", "Death-timer integration with SD Crawler Helper."),

	feature(FEATURE_IDS.ANIMATION_FX, "animation", "Animation FX", "Regex-matched Sequencer animation presets and playback."),

	feature(FEATURE_IDS.ANIMATION_ITEM_OVERRIDES, "animation", "Per-Item Animation Overrides", "Item-level Animation FX configuration on activity and weapon sheets.", { dependencies: [FEATURE_IDS.ANIMATION_FX] }),
	feature(FEATURE_IDS.TORCH_ANIMATIONS, "animation", "Torch Animations", "Persistent torch prop and flame animations on tokens."),
	feature(FEATURE_IDS.LEVEL_UP_ANIMATIONS, "animation", "Level-Up Animations", "Level-up arrows and token celebration effects."),
	feature(FEATURE_IDS.WEAPON_SPRITES, "animation", "Weapon & Shield Sprites", "Equipped weapon and shield sprites rendered on tokens."),
	feature(FEATURE_IDS.TMFX_EDITOR, "animation", "TokenMagic Filter Editor", "Edit TokenMagic filter parameters used by effects and presets."),
	feature(FEATURE_IDS.AUTOMATED_ANIMATIONS, "animation", "Automated Animations Integration", "Coordinate SDX animation playback with Automated Animations."),

	feature(FEATURE_IDS.ENHANCED_HEADER, "character", "Enhanced Header", "HP, AC, abilities, luck, XP, and custom header backgrounds."),
	feature(FEATURE_IDS.HP_WAVES, "character", "HP Wave Animation", "Animated portrait waves based on current HP."),
	feature(FEATURE_IDS.QUICK_CONDITIONS, "character", "Quick Conditions", "Condition controls on player and NPC sheets."),

	feature(FEATURE_IDS.JOURNAL_NOTES, "character", "Character Journal Notes", "Multi-page journal notes on player sheets."),
	feature(FEATURE_IDS.ADD_COINS, "character", "Add Coins Button", "Quick coin adjustment controls on character and party sheets."),
	feature(FEATURE_IDS.SHEET_LOCKING, "character", "Sheet Locking", "Prevent players from editing configured sheet fields."),
	feature(FEATURE_IDS.SHEET_STYLING, "character", "Sheet Styling & Dark Mode", "Sheet frames, panels, colors, backgrounds, and themes."),
	feature(FEATURE_IDS.BACKGROUND_ADVANCEMENT, "character", "Background Sheet & Advancement", "Enhanced background sheets and advancement grants."),
	feature(FEATURE_IDS.SKILLS_BOX, "character", "Skills Box", "Skills display on character sheets."),
	feature(FEATURE_IDS.SPELLBOOK_FILTER, "character", "Spellbook Filter", "Alignment-based spellbook filtering."),
	feature(FEATURE_IDS.ENHANCED_TABS, "character", "Enhanced Sheet Tabs", "Enhanced details, abilities, talents, inventory, spells, and effects tabs."),
	feature(FEATURE_IDS.CHARACTER_GENERATOR, "character", "Character Generator", "Character-generation helpers and chat roll integration."),

	feature(FEATURE_IDS.AMMUNITION, "inventory", "Ammunition per User", "Select, apply bonuses from, and consume actor ammunition."),
	feature(FEATURE_IDS.CONTAINERS, "inventory", "Container System", "Nested storage, coin storage, and container slot calculations."),
	feature(FEATURE_IDS.TRADING, "inventory", "Trading System", "Player trading windows, socket prompts, transfers, and journal."),
	feature(FEATURE_IDS.UNIDENTIFIED_ITEMS, "inventory", "Unidentified Items", "Mask unidentified item identity and preserve its flags."),
	feature(FEATURE_IDS.MULTI_SELECT, "inventory", "Multi-Select & Bulk Delete", "Select and modify multiple inventory rows."),
	feature(FEATURE_IDS.INVENTORY_STYLING, "inventory", "Inventory Styling", "Theme inventory rows by type, magic, rarity, and custom CSS."),
	feature(FEATURE_IDS.GEM_ENHANCEMENTS, "inventory", "Gem Enhancements", "Gem bag, quantity, and value enhancements."),
	feature(FEATURE_IDS.ITEM_PILES, "inventory", "Item Piles Compatibility", "Keep SDX item state safe when Item Piles moves or displays items."),
	feature(FEATURE_IDS.PLAYER_TRANSFERS, "inventory", "Player Transfers", "Actor-to-actor and party inventory transfers."),

	feature(FEATURE_IDS.NPC_INVENTORY, "npc", "NPC Inventory", "Inventory and coin management on NPC sheets."),
	feature(FEATURE_IDS.NPC_CREATURE_TYPES, "npc", "NPC Creature Types", "Creature type assignment and targeting support."),
	feature(FEATURE_IDS.MYSTERIOUS_CASTING, "npc", "Mysterious Casting", "Hide configured NPC spellcasting details."),
	feature(FEATURE_IDS.NPC_CUSTOM_SHEETS, "npc", "NPC Item Sheets", "Dedicated NPC attack, special attack, and feature sheets."),

	feature(FEATURE_IDS.SPELL_ACTIVITY, "effects", "Spell Activity System", "Spell damage, healing, targeting, duration, summoning, item-give, and alignment fields."),
	feature(FEATURE_IDS.DAMAGE_TYPES, "effects", "Damage Type System", "Resistance, immunity, and vulnerability processing by damage type."),
	feature(FEATURE_IDS.PREDEFINED_EFFECTS, "effects", "Predefined Effects Library", "SDX effect definitions, configuration controls, and condition data."),
	feature(FEATURE_IDS.TEMPLATE_EFFECTS, "effects", "Template Effects", "Apply effects when tokens enter or take turns in templates.", { dependencies: [FEATURE_IDS.SPELL_ACTIVITY] }),
	feature(FEATURE_IDS.AURAS, "effects", "Auras", "Persistent aura regions, turn triggers, LOS, Sequencer, and TokenMagic.", { dependencies: [FEATURE_IDS.SPELL_ACTIVITY] }),
	feature(FEATURE_IDS.BREAK_ON_DAMAGE, "effects", "Break on Damage", "Expire configured effects when their bearer takes damage."),
	feature(FEATURE_IDS.CASTING_BLOCKERS, "effects", "Casting Blockers", "Prevent casting under configured active-effect conditions."),
	feature(FEATURE_IDS.INVISIBILITY, "effects", "Invisibility", "Synchronize invisibility effects with token visibility."),
	feature(FEATURE_IDS.SOURCE_REQUIREMENTS, "effects", "Effect Source Requirements", "Enable or suppress effects based on source item state."),

	feature(FEATURE_IDS.DISPLAY_CARDS, "journal", "Display Cards", "NPC, item, and RollTable ProseMirror enrichers."),
	feature(FEATURE_IDS.EASY_REFERENCE, "journal", "Easy Reference Menu", "ProseMirror menu for cards, checks, and dice references."),
	feature(FEATURE_IDS.JOURNAL_NARRATION, "journal", "Journal Narration", "Send selected journal content to chat narration cards."),
	feature(FEATURE_IDS.ICON_PICKER, "journal", "Icon Picker", "Icon selection app used by pins and placeable notes."),

	feature(FEATURE_IDS.TOM_SCENES, "tom", "ToM Scenes & Broadcasting", "Create, edit, organize, broadcast, and stop Theatre of the Mind scenes.", { visible: true }),
	feature(FEATURE_IDS.TOM_VIDEO_OVERLAYS, "tom", "ToM Video Overlays", "Apply video overlays to active Theatre of the Mind scenes.", { dependencies: [FEATURE_IDS.TOM_PLAYER_VIEW], visible: true }),
	feature(FEATURE_IDS.TOM_SCENE_EDITOR, "tom", "ToM Scene Editor", "Scene editor, smart creator, templates, and arena configuration.", { dependencies: [FEATURE_IDS.TOM_SCENES] }),
	feature(FEATURE_IDS.TOM_PLAYER_VIEW, "tom", "ToM Player View", "Player-facing broadcast view and scene transitions.", { dependencies: [FEATURE_IDS.TOM_SCENES] }),
	feature(FEATURE_IDS.TOM_SCENE_NAVIGATION, "tom", "ToM Scene Navigation", "Player scene navigation created by the ToM broadcast path.", { dependencies: [FEATURE_IDS.TOM_PLAYER_VIEW] }),

	feature(FEATURE_IDS.ITEM_MACROS, "items", "Item Macro Engine", "Execute item, effect, spell, weapon, class, and NPC feature macros."),
	feature(FEATURE_IDS.MAGIC_ITEM_SHEETS, "items", "Potion, Scroll, Wand & Staff Enhancements", "Enhanced magic-item sheets, wand charges, and staff spell management."),
	feature(FEATURE_IDS.SPELL_CONFIGS, "items", "Spell Configuration Panels", "Per-spell damage, targeting, summoning, and item-give controls.", { dependencies: [FEATURE_IDS.SPELL_ACTIVITY] }),
]);

const FEATURES_BY_ID = new Map(FEATURE_CATALOG.map(entry => [entry.id, entry]));

export function normalizeDisabledFeatureIds(value) {
	if (!Array.isArray(value)) return [];
	const selected = new Set(value.filter(id => FEATURES_BY_ID.has(id)));
	return FEATURE_CATALOG.filter(entry => selected.has(entry.id)).map(entry => entry.id);
}

export function getDisabledFeatureIds() {
	try {
		return normalizeDisabledFeatureIds(game.settings.get(MODULE_ID, FEATURE_SETTING_KEY));
	}
	catch{
		const worldStorage = globalThis.game?.settings?.storage?.get?.("world");
		const stored = worldStorage?.get?.(`${MODULE_ID}.${FEATURE_SETTING_KEY}`);
		return normalizeDisabledFeatureIds(stored?.value ?? stored);
	}
}

export function getFeatureState(
	featureId, disabledFeatureIds = getDisabledFeatureIds(), trail = new Set()
) {
	const definition = FEATURES_BY_ID.get(featureId);
	if (!definition) throw new Error(`${MODULE_ID} | Unknown feature id: ${featureId}`);
	const disabled = new Set(normalizeDisabledFeatureIds(disabledFeatureIds));
	if (disabled.has(featureId)) return { enabled: false, reason: "disabled", blockedBy: null };
	if (trail.has(featureId)) throw new Error(`${MODULE_ID} | Circular feature dependency at ${featureId}`);

	const nextTrail = new Set(trail).add(featureId);
	for (const dependency of definition.dependencies) {
		const state = getFeatureState(dependency, [...disabled], nextTrail);
		if (!state.enabled) return { enabled: false, reason: "dependency", blockedBy: dependency };
	}
	return { enabled: true, reason: null, blockedBy: null };
}

export function isFeatureEnabled(featureId, disabledFeatureIds) {
	return getFeatureState(featureId, disabledFeatureIds).enabled;
}

export function anyFeatureEnabled(...featureIds) {
	return featureIds.some(featureId => isFeatureEnabled(featureId));
}

export function applyFeatureGroupState(value, groupId, enabled) {
	if (!FEATURE_GROUPS.some(group => group.id === groupId)) {
		throw new Error(`${MODULE_ID} | Unknown feature group: ${groupId}`);
	}
	const selected = new Set(normalizeDisabledFeatureIds(value));
	for (const entry of FEATURE_CATALOG) {
		if (entry.group !== groupId) continue;
		if (enabled) selected.delete(entry.id);
		else selected.add(entry.id);
	}
	return normalizeDisabledFeatureIds([...selected]);
}

export function getFeatureFlagContext(disabledFeatureIds = getDisabledFeatureIds()) {
	return Object.fromEntries(FEATURE_CATALOG.map(entry => [
		entry.id.replace(/\.([a-z])/g, (_match, letter) => letter.toUpperCase()),
		isFeatureEnabled(entry.id, disabledFeatureIds),
	]));
}

export function getVisibleTrayModes({ isGM, canPlayerPaint, showPartyTab, disabledFeatureIds }) {
	const enabled = featureId => isFeatureEnabled(featureId, disabledFeatureIds);
	const modes = [];

	if (isGM && enabled(FEATURE_IDS.TOM_SCENES)) modes.push("scenes");
	else modes.push("player");
	if (showPartyTab && enabled(FEATURE_IDS.PARTY_MANAGEMENT)) modes.push("party");
	if (isGM && enabled(FEATURE_IDS.JOURNAL_PINS)) modes.push("pins");
	if (enabled(FEATURE_IDS.PLACEABLE_NOTES)) modes.push("notes");
	if (isGM && enabled(FEATURE_IDS.HEX_PAINTER)) modes.push("hexes");
	if ((isGM || canPlayerPaint) && enabled(FEATURE_IDS.DUNGEON_PAINTER)) modes.push("dungeons");
	if (isGM && enabled(FEATURE_IDS.DECOR_PAINTER)) modes.push("decor");

	return modes.length ? modes : ["player"];
}

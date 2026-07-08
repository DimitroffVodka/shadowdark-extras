/**
 * Default equipped-weapon sprite presets for the Animation FX master list.
 *
 * These are NOT attack effects. They pin a weapon image to the token via
 * WeaponAnimationSD's persistent Sequencer effect while the weapon is equipped,
 * with an idle motion (wobble / bobbing / floating / rotating).
 *
 * Schema matches what `playWeaponAnimation()` consumes:
 *   { enabled, imagePath, offsetX, offsetY, rotation, scale, animationType,
 *     flipX, flipY, filters }
 * Filters are intentionally omitted here — configure those per item in the
 * Weapon Animation dialog, which remains the override tier.
 *
 * Images are the art bundled in `assets/Weapons` (786 files). Long/ranged
 * weapons are angled across the back (rotation 315, offset -0.25/0.15);
 * one-handers sit at the hip (offset 0.35/0.1, rotation 0).
 *
 * Patterns are tuned for Shadowdark weapon names; magical variants match by
 * substring ("Crossbow of Purity" -> crossbow). Longest match wins, so the
 * generic `\bsword\b|\bblade\b` fallback never beats `greatsword`.
 */

export const DEFAULT_WEAPON_SPRITE_PRESETS = {
	longsword: {
		label: "Longsword",
		patterns: "longsword|long sword|bastard sword|\\bsword\\b|\\bblade\\b",
		enabled: true,
		imagePath: "modules/shadowdark-extras/assets/Weapons/Swords/Longswords/Longsword_A_01_1x2.webp",
		offsetX: 0.35,
		offsetY: 0.1,
		rotation: 0,
		scale: 1.0,
		animationType: "wobble",
		flipX: false,
		flipY: false
	},
	greatsword: {
		label: "Greatsword",
		patterns: "greatsword|great sword",
		enabled: true,
		imagePath: "modules/shadowdark-extras/assets/Weapons/Swords/Greatswords/Greatsword_A_01_1x2.webp",
		offsetX: -0.25,
		offsetY: 0.15,
		rotation: 315,
		scale: 1.0,
		animationType: "wobble",
		flipX: false,
		flipY: false
	},
	shortsword: {
		label: "Shortsword",
		patterns: "shortsword|short sword",
		enabled: true,
		imagePath: "modules/shadowdark-extras/assets/Weapons/Swords/Shortswords/Shortsword_A_01_1x1.webp",
		offsetX: 0.35,
		offsetY: 0.1,
		rotation: 0,
		scale: 1.0,
		animationType: "wobble",
		flipX: false,
		flipY: false
	},
	scimitar: {
		label: "Scimitar",
		patterns: "scimitar",
		enabled: true,
		imagePath: "modules/shadowdark-extras/assets/Weapons/Swords/Scimitars/Scimitar_A1_1x1.webp",
		offsetX: 0.35,
		offsetY: 0.1,
		rotation: 0,
		scale: 1.0,
		animationType: "wobble",
		flipX: false,
		flipY: false
	},
	dagger: {
		label: "Dagger",
		patterns: "dagger|knife",
		enabled: true,
		imagePath: "modules/shadowdark-extras/assets/Weapons/Daggers/Dagger_A_01_1x1.webp",
		offsetX: 0.35,
		offsetY: 0.1,
		rotation: 0,
		scale: 1.0,
		animationType: "wobble",
		flipX: false,
		flipY: false
	},
	greataxe: {
		label: "Greataxe",
		patterns: "greataxe|great axe",
		enabled: true,
		imagePath: "modules/shadowdark-extras/assets/Weapons/Axes/Greataxes/Greataxe_A_01_1x2.webp",
		offsetX: -0.25,
		offsetY: 0.15,
		rotation: 315,
		scale: 1.0,
		animationType: "wobble",
		flipX: false,
		flipY: false
	},
	battleaxe: {
		label: "Battleaxe",
		patterns: "battleaxe|battle axe",
		enabled: true,
		imagePath: "modules/shadowdark-extras/assets/Weapons/Axes/Battleaxes/Battleaxe_A_01_Bloody_1x1.webp",
		offsetX: 0.35,
		offsetY: 0.1,
		rotation: 0,
		scale: 1.0,
		animationType: "wobble",
		flipX: false,
		flipY: false
	},
	handaxe: {
		label: "Handaxe",
		patterns: "handaxe|hand axe",
		enabled: true,
		imagePath: "modules/shadowdark-extras/assets/Weapons/Axes/Handaxes/HandAxe_A_01_1x1.webp",
		offsetX: 0.35,
		offsetY: 0.1,
		rotation: 0,
		scale: 1.0,
		animationType: "wobble",
		flipX: false,
		flipY: false
	},
	mace: {
		label: "Mace",
		patterns: "\\bmace\\b",
		enabled: true,
		imagePath: "modules/shadowdark-extras/assets/Weapons/Blunts/Maces/Mace_A_01_1x1.webp",
		offsetX: 0.35,
		offsetY: 0.1,
		rotation: 0,
		scale: 1.0,
		animationType: "wobble",
		flipX: false,
		flipY: false
	},
	morningstar: {
		label: "Morningstar",
		patterns: "morningstar|morning star",
		enabled: true,
		imagePath: "modules/shadowdark-extras/assets/Weapons/Blunts/Maces/Morningstar_A_01_1x1.webp",
		offsetX: 0.35,
		offsetY: 0.1,
		rotation: 0,
		scale: 1.0,
		animationType: "wobble",
		flipX: false,
		flipY: false
	},
	warhammer: {
		label: "Warhammer",
		patterns: "warhammer|war hammer",
		enabled: true,
		imagePath: "modules/shadowdark-extras/assets/Weapons/Blunts/Hammers/Warhammer_A_01_1x1.webp",
		offsetX: 0.35,
		offsetY: 0.1,
		rotation: 0,
		scale: 1.0,
		animationType: "wobble",
		flipX: false,
		flipY: false
	},
	club: {
		label: "Club",
		patterns: "\\bclub\\b",
		enabled: true,
		imagePath: "modules/shadowdark-extras/assets/Weapons/Blunts/Clubs/Club_A_01_1x1.webp",
		offsetX: 0.35,
		offsetY: 0.1,
		rotation: 0,
		scale: 1.0,
		animationType: "wobble",
		flipX: false,
		flipY: false
	},
	staff: {
		label: "Staff / Stave",
		patterns: "\\bstaff\\b|\\bstave\\b|quarterstaff",
		enabled: true,
		imagePath: "modules/shadowdark-extras/assets/Weapons/Blunts/Quarterstaffs/Quarterstaff_A_01_1x2.webp",
		offsetX: -0.25,
		offsetY: 0.15,
		rotation: 315,
		scale: 1.0,
		animationType: "wobble",
		flipX: false,
		flipY: false
	},
	flail: {
		label: "Flail",
		patterns: "flail",
		enabled: true,
		imagePath: "modules/shadowdark-extras/assets/Weapons/Special/Flail_A_01_1x1.webp",
		offsetX: 0.35,
		offsetY: 0.1,
		rotation: 0,
		scale: 1.0,
		animationType: "wobble",
		flipX: false,
		flipY: false
	},
	spear: {
		label: "Spear",
		patterns: "\\bspear\\b",
		enabled: true,
		imagePath: "modules/shadowdark-extras/assets/Weapons/Polearms/Spear_A_01_1x2.webp",
		offsetX: -0.25,
		offsetY: 0.15,
		rotation: 315,
		scale: 1.0,
		animationType: "wobble",
		flipX: false,
		flipY: false
	},
	trident: {
		label: "Trident",
		patterns: "trident",
		enabled: true,
		imagePath: "modules/shadowdark-extras/assets/Weapons/Special/Trident_A_01_1x2.webp",
		offsetX: -0.25,
		offsetY: 0.15,
		rotation: 315,
		scale: 1.0,
		animationType: "wobble",
		flipX: false,
		flipY: false
	},
	pike: {
		label: "Pike",
		patterns: "\\bpike\\b",
		enabled: true,
		imagePath: "modules/shadowdark-extras/assets/Weapons/Polearms/Pike_A_01_1x3.webp",
		offsetX: -0.25,
		offsetY: 0.15,
		rotation: 315,
		scale: 1.0,
		animationType: "wobble",
		flipX: false,
		flipY: false
	},
	javelin: {
		label: "Javelin",
		patterns: "javelin",
		enabled: true,
		imagePath: "modules/shadowdark-extras/assets/Weapons/Special/Javelin_A_01_1x2.webp",
		offsetX: -0.25,
		offsetY: 0.15,
		rotation: 315,
		scale: 1.0,
		animationType: "wobble",
		flipX: false,
		flipY: false
	},
	whip: {
		label: "Whip / Razor Chain",
		patterns: "\\bwhip\\b|razor chain",
		enabled: true,
		imagePath: "modules/shadowdark-extras/assets/Weapons/Special/Whip_A_01_1x1.webp",
		offsetX: 0.35,
		offsetY: 0.1,
		rotation: 0,
		scale: 1.0,
		animationType: "wobble",
		flipX: false,
		flipY: false
	},
	crossbow: {
		label: "Crossbow",
		patterns: "crossbow",
		enabled: true,
		imagePath: "modules/shadowdark-extras/assets/Weapons/Crossbows/Crossbow_Heavy_A_01_1x2.webp",
		offsetX: -0.25,
		offsetY: 0.15,
		rotation: 315,
		scale: 1.0,
		animationType: "wobble",
		flipX: false,
		flipY: false
	},
	longbow: {
		label: "Longbow",
		patterns: "longbow|long bow",
		enabled: true,
		imagePath: "modules/shadowdark-extras/assets/Weapons/Bows/Longbow_A_01_1x2.webp",
		offsetX: -0.25,
		offsetY: 0.15,
		rotation: 315,
		scale: 1.0,
		animationType: "wobble",
		flipX: false,
		flipY: false
	},
	shortbow: {
		label: "Shortbow",
		patterns: "shortbow|short bow|blowgun",
		enabled: true,
		imagePath: "modules/shadowdark-extras/assets/Weapons/Bows/Shortbow_A_01_1x1.webp",
		offsetX: -0.25,
		offsetY: 0.15,
		rotation: 315,
		scale: 1.0,
		animationType: "wobble",
		flipX: false,
		flipY: false
	},
	shield: {
		label: "Shield",
		patterns: "\\bshield\\b",
		enabled: true,
		imagePath: "modules/shadowdark-extras/assets/Weapons/Shields/Shield_Metal_04_A1_1x1.webp",
		offsetX: 0.35,
		offsetY: 0.1,
		rotation: 0,
		scale: 1.0,
		animationType: "wobble",
		flipX: false,
		flipY: false
	},
};

export default DEFAULT_WEAPON_SPRITE_PRESETS;

/**
 * Default NPC / monster attack animation presets for the Animation FX master list
 * (the `npcActions` category).
 *
 * Built data-first: across 258 monsters in the Shadowdark compendium the most
 * common NPC-attack names are Bite (62), Claw (21), Rend (18), Slam (16),
 * Tentacle (12), Sting (7), plus a long tail of weapon names (Longsword,
 * Spear, Longbow…). The weapon-named ones are intentionally NOT duplicated
 * here — AnimationFxSD.resolvePreset() falls an NPC attack back to the
 * `weapons` category, so a monster's "Longsword" reuses the weapon slash.
 * This file only covers the *natural / special* attacks weapons can't.
 *
 * All files are JB2A (free) raw paths, verified present on disk. type is
 * onToken for melee natural attacks, projectile for thrown, cone for breath.
 * Longest-matched-substring wins, so "fire breath" beats the generic "breath".
 *
 * There is deliberately NO `_default`: an unrecognised NPC attack resolves to
 * null so Automated Animations (if installed) can still cover it.
 */

const C = "modules/JB2A_DnD5e/Library/Generic/Creature/";
const U = "modules/JB2A_DnD5e/Library/Generic/Unarmed_Attacks/Unarmed_Strike/";
const R = "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Ranged/";
const CONE = "modules/JB2A_DnD5e/Library/Generic/Template/Cone/Breath_Weapon/";

export const DEFAULT_NPC_ATTACK_PRESETS = {
	bite: {
		label: "Bite / Maw", patterns: "bite|maw|jaws|chomp|beak|devour",
		type: "onToken", target: "target",
		hit: { file: C + "Bite_01_Regular_Red_400x400.webm", scale: 1, duration: 900 }
	},
	claw: {
		label: "Claw / Rend", patterns: "claw|claws|rend|rake|slash|talon",
		type: "onToken", target: "target",
		hit: { file: C + "Claw/CreatureAttackClaw_001_001_Red_800x600.webm", scale: 1, duration: 900 }
	},
	slam: {
		label: "Slam / Smash", patterns: "slam|smash|pound|stomp|crush|bash",
		type: "onToken", target: "target",
		hit: { file: C + "Fist/CreatureAttackFist_001_001_Red_800x600.webm", scale: 1, duration: 900 }
	},
	fist: {
		label: "Fist / Hooves", patterns: "fist|punch|hoof|hooves|kick|knuckle",
		type: "onToken", target: "target",
		hit: { file: C + "Fist/CreatureAttackFist_001_002_Red_800x600.webm", scale: 1, duration: 900 }
	},
	pincer: {
		label: "Pincer / Claw Pinch", patterns: "pincer|pinch",
		type: "onToken", target: "target",
		hit: { file: C + "Pincer/CreatureAttackPincer_001_001_Red_800x600.webm", scale: 1, duration: 900 }
	},
	gore: {
		label: "Gore / Horn / Tusk", patterns: "gore|horn|tusk|tusks|antler|ram",
		type: "onToken", target: "target",
		hit: { file: C + "Fist/CreatureAttackFist_001_003_Red_800x600.webm", scale: 1, duration: 900 }
	},
	tentacle: {
		label: "Tentacle / Tendril / Lash", patterns: "tentacle|tendril|lash|tongue|whip",
		type: "onToken", target: "target",
		hit: { file: U + "UnarmedStrike_01_Regular_Blue_Physical01_800x600.webm", scale: 1, duration: 900 }
	},
	tail: {
		label: "Tail / Sting", patterns: "tail|sting|stinger|barb",
		type: "onToken", target: "target",
		hit: { file: U + "UnarmedStrike_01_Regular_Blue_Physical02_800x600.webm", scale: 1, duration: 900 }
	},
	constrict: {
		label: "Constrict / Grapple", patterns: "constrict|squeeze|grapple|swallow|engulf",
		type: "onToken", target: "target",
		hit: { file: U + "UnarmedStrike_01_Regular_Blue_Physical01_800x600.webm", scale: 1.2, duration: 1000 }
	},
	touch: {
		label: "Touch / Gaze", patterns: "touch|gaze|stare|glare|drain",
		type: "onToken", target: "target",
		hit: { file: U + "UnarmedStrike_01_Regular_Blue_Magical01_800x600.webm", scale: 1, duration: 900 }
	},
	rock: {
		label: "Rock / Boulder (thrown)", patterns: "rock|boulder|stone|hurl",
		type: "projectile", target: "target",
		hit: { file: R + "ThrowFlask01_01_Regular_Orange_15ft_1000x400.webm", scale: 1, duration: 1200 }
	},
	fire_breath: {
		label: "Fire Breath", patterns: "fire breath|flame breath|breath weapon|breath",
		type: "cone", target: "target",
		hit: { file: CONE + "BreathWeapon_Fire01_Regular_Orange_30ft_Cone_Burst_600x600.webm", scale: 1, duration: 1500 }
	}
};

export default DEFAULT_NPC_ATTACK_PRESETS;

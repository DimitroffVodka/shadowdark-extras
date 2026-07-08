/**
 * Default weapon animation presets for the Animation FX master list.
 *
 * Derived from the curated JB2A (free) + psfx mapping, with regex patterns
 * tuned for Shadowdark weapon names (including magical variants such as
 * "Crossbow of Purity" or "Silver Mace of Wrath", which substring-match the
 * base weapon). Preset resolution scores by longest matched substring, so the
 * generic `\bsword\b|\bblade\b` fallback never beats `greatsword`.
 *
 * type is inferred from the JB2A path:
 *   /Ranged/ or /RangedSpell/ -> projectile   (stretchTo target)
 *   /Template/Cone/           -> cone
 *   everything else           -> onToken
 *
 * Requires JB2A_DnD5e (animations) and psfx (sounds). Presets whose module is
 * inactive are skipped at play time by AnimationFxSD's missing-module guard.
 */

export const DEFAULT_WEAPON_PRESETS = {
	arbalest: {
		label: "Arbalest",
		patterns: "arbalest",
		type: "projectile",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Ranged/Bolt01_01_Regular_Orange_Physical_15ft_1000x400.webm",
			scale: 1,
			duration: 1500,
			sound: "modules/psfx/library/ranged-weapons/longbow/v1/longbow-003-60ft.ogg"
		}
	},
	battleaxe: {
		label: "Battleaxe",
		patterns: "battleaxe|battle axe",
		type: "onToken",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Melee/Group02/MeleeAttack02_BattleAxe01_02_800x600.webm",
			scale: 1,
			duration: 1000,
			sound: "modules/psfx/library/impacts/slashing/v1/meleeattack-impacts-slashing-00.ogg"
		}
	},
	bottle_glass: {
		label: "Bottle, glass",
		patterns: "\\bbottle\\b|flask|vial",
		type: "projectile",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Ranged/ThrowFlask01_01_Regular_Orange_05ft_600x400.webm",
			scale: 1,
			duration: 1500,
			sound: "modules/psfx/library/impacts/magicaleffects/generic/002/impact-magicaleffects-generic-001-03.ogg"
		}
	},
	breath_attack: {
		label: "Breath Attack",
		patterns: "breath|exhale|cone of",
		type: "cone",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Template/Cone/Breath_Weapon/BreathWeapon_Fire01_Regular_Orange_30ft_Cone_Burst_600x600.webm",
			scale: 1,
			duration: 1500,
			sound: "modules/psfx/library/1st-level-spells/burning-hands/v1/burning-hands-01.ogg"
		}
	},
	buckler: {
		label: "Buckler",
		patterns: "buckler",
		type: "onToken",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Melee/Group06/MeleeAttack06_Shield01_01_Regular_White_800x600.webm",
			scale: 1,
			duration: 1000,
			sound: "modules/psfx/library/impacts/bludgeoning/v1/meleeattack-impacts-bludgeoning-00.ogg"
		}
	},
	caestus: {
		label: "Caestus",
		patterns: "caestus",
		type: "onToken",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Creature/Fist/CreatureAttackFist_001_001_Red_800x600.webm",
			scale: 1,
			duration: 1000,
			sound: "modules/psfx/library/impacts/slashing/v1/meleeattack-impacts-slashing-01.ogg"
		}
	},
	club: {
		label: "Club",
		patterns: "\\bclub\\b",
		type: "onToken",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Melee/Club01_05_Regular_White_800x600.webm",
			scale: 1,
			duration: 1000,
			sound: "modules/psfx/library/impacts/bludgeoning/v1/meleeattack-impacts-bludgeoning-01.ogg"
		}
	},
	crossbow: {
		label: "Crossbow",
		patterns: "crossbow",
		type: "projectile",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Ranged/Bolt01_01_Regular_Orange_Physical_15ft_1000x400.webm",
			scale: 1,
			duration: 1500,
			sound: "modules/psfx/library/ranged-weapons/longbow/v1/longbow-003-60ft.ogg"
		}
	},
	crossbow_light: {
		label: "Crossbow, light",
		patterns: "light crossbow|crossbow, light",
		type: "projectile",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Ranged/Bolt01_01_Regular_Orange_Physical_15ft_1000x400.webm",
			scale: 1,
			duration: 1500,
			sound: "modules/psfx/library/ranged-weapons/longbow/v1/longbow-003-60ft.ogg"
		}
	},
	dagger: {
		label: "Dagger",
		patterns: "dagger|knife",
		type: "onToken",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Melee/Dagger02_01_Regular_White_800x600.webm",
			scale: 1,
			duration: 1000,
			sound: "modules/psfx/library/impacts/slashing/v1/meleeattack-impacts-slashing-02.ogg"
		}
	},
	dagger_thrown: {
		label: "Dagger (Thrown)",
		patterns: "shuriken|throwing dagger|boomerang|spear-thrower|spear thrower",
		type: "projectile",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Ranged/Dagger01_01_Regular_White_15ft_1000x400.webm",
			scale: 1,
			duration: 1500,
			sound: "modules/psfx/library/impacts/slashing/v1/meleeattack-impacts-slashing-02.ogg"
		}
	},
	flail: {
		label: "Flail",
		patterns: "flail",
		type: "onToken",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Melee/Mace01_06_Regular_White_800x600.webm",
			scale: 1,
			duration: 1000,
			sound: "modules/psfx/library/impacts/bludgeoning/v1/meleeattack-impacts-bludgeoning-02.ogg"
		}
	},
	garotte_wire: {
		label: "Garotte wire",
		patterns: "garotte|garrote",
		type: "onToken",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Unarmed_Attacks/Unarmed_Strike/UnarmedStrike_01_Regular_Blue_Physical02_800x600.webm",
			scale: 1,
			duration: 1000,
			sound: "modules/psfx/library/impacts/bludgeoning/v1/meleeattack-impacts-bludgeoning-03.ogg"
		}
	},
	gauntlet: {
		label: "Gauntlet",
		patterns: "gauntlet",
		type: "onToken",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Creature/Fist/CreatureAttackFist_002_001_Blue_800x600.webm",
			scale: 1,
			duration: 1000,
			sound: "modules/psfx/library/impacts/bludgeoning/v1/meleeattack-impacts-bludgeoning-00.ogg"
		}
	},
	greataxe: {
		label: "Greataxe",
		patterns: "greataxe|great axe",
		type: "onToken",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Melee/GreatAxe01_01_Regular_White_800x600.webm",
			scale: 1,
			duration: 1000,
			sound: "modules/psfx/library/impacts/slashing/v1/meleeattack-impacts-slashing-03.ogg"
		}
	},
	greatclub: {
		label: "Greatclub",
		patterns: "greatclub|great club",
		type: "onToken",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Melee/GreatClub01_01_Regular_White_800x600.webm",
			scale: 1,
			duration: 1000,
			sound: "modules/psfx/library/impacts/bludgeoning/v1/meleeattack-impacts-bludgeoning-01.ogg"
		}
	},
	greatshield: {
		label: "Greatshield",
		patterns: "greatshield|great shield",
		type: "onToken",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Melee/Group06/MeleeAttack06_Shield01_01_Regular_White_800x600.webm",
			scale: 1,
			duration: 1000,
			sound: "modules/psfx/library/impacts/bludgeoning/v1/meleeattack-impacts-bludgeoning-02.ogg"
		}
	},
	greatsword: {
		label: "Greatsword",
		patterns: "greatsword|great sword",
		type: "onToken",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Melee/GreatSword01_01_Regular_White_800x600.webm",
			scale: 1,
			duration: 1000,
			sound: "modules/psfx/library/impacts/slashing/v1/meleeattack-impacts-slashing-00.ogg"
		}
	},
	handaxe: {
		label: "Handaxe",
		patterns: "handaxe|hand axe",
		type: "onToken",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Melee/HandAxe02_01_Regular_White_800x600.webm",
			scale: 1,
			duration: 1000,
			sound: "modules/psfx/library/impacts/slashing/v1/meleeattack-impacts-slashing-01.ogg"
		}
	},
	handgun: {
		label: "Handgun",
		patterns: "handgun|pistol|revolver",
		type: "projectile",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Ranged/Bullet_01_Regular_Orange_15ft_1000x400.webm",
			scale: 1,
			duration: 1500,
			sound: "modules/psfx/library/ranged-weapons/guns/revolver/single-fire/revolver-single-fire-001-03.ogg"
		}
	},
	javelin: {
		label: "Javelin",
		patterns: "javelin",
		type: "onToken",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Melee/Spear01_04_Regular_White_800x600.webm",
			scale: 1,
			duration: 1000,
			sound: "modules/psfx/library/impacts/bludgeoning/v1/meleeattack-impacts-bludgeoning-03.ogg"
		}
	},
	katar: {
		label: "Katar",
		patterns: "katar",
		type: "onToken",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Melee/Dagger02_01_Regular_White_800x600.webm",
			scale: 1,
			duration: 1000,
			sound: "modules/psfx/library/impacts/bludgeoning/v1/meleeattack-impacts-bludgeoning-00.ogg"
		}
	},
	lance: {
		label: "Lance",
		patterns: "lance",
		type: "onToken",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Melee/Spear01_01_Regular_White_800x600.webm",
			scale: 1,
			duration: 1000,
			sound: "modules/psfx/library/impacts/slashing/v1/meleeattack-impacts-slashing-02.ogg"
		}
	},
	light_hammer: {
		label: "Light hammer",
		patterns: "light hammer",
		type: "onToken",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Melee/Group02/MeleeAttack02_Hammer01_01_800x600.webm",
			scale: 1,
			duration: 1000,
			sound: "modules/psfx/library/impacts/bludgeoning/v1/meleeattack-impacts-bludgeoning-01.ogg"
		}
	},
	longbow: {
		label: "Longbow",
		patterns: "longbow|long bow|blowgun",
		type: "projectile",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Ranged/Arrow01_01_Regular_White_15ft_1000x400.webm",
			scale: 1,
			duration: 1500,
			sound: "modules/psfx/library/ranged-weapons/longbow/v1/longbow-003-60ft.ogg"
		}
	},
	longsword: {
		label: "Longsword",
		patterns: "longsword|long sword|bastard sword|scimitar|\\bsword\\b|\\bblade\\b",
		type: "onToken",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Melee/Sword01_05_Regular_White_800x600.webm",
			scale: 1,
			duration: 1000,
			sound: "modules/psfx/library/impacts/slashing/v1/meleeattack-impacts-slashing-03.ogg"
		}
	},
	lucerne: {
		label: "Lucerne",
		patterns: "lucerne",
		type: "onToken",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Melee/Warhammer01_05_Regular_White_800x600.webm",
			scale: 1,
			duration: 1000,
			sound: "modules/psfx/library/impacts/bludgeoning/v1/meleeattack-impacts-bludgeoning-02.ogg"
		}
	},
	mace: {
		label: "Mace",
		patterns: "\\bmace\\b",
		type: "onToken",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Melee/Mace01_01_Regular_White_800x600.webm",
			scale: 1,
			duration: 1000,
			sound: "modules/psfx/library/impacts/bludgeoning/v1/meleeattack-impacts-bludgeoning-03.ogg"
		}
	},
	morningstar: {
		label: "Morningstar",
		patterns: "morningstar|morning star",
		type: "onToken",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Melee/Mace01_06_Regular_White_800x600.webm",
			scale: 1,
			duration: 1000,
			sound: "modules/psfx/library/impacts/bludgeoning/v1/meleeattack-impacts-bludgeoning-00.ogg"
		}
	},
	net: {
		label: "Net",
		patterns: "\\bnet\\b|bolas",
		type: "onToken",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Marker/MarkerChainSpectralStandard01_02_Regular_Blue_Complete_400x400.webm",
			scale: 1,
			duration: 1000,
			sound: "modules/psfx/library/impacts/bludgeoning/v1/meleeattack-impacts-bludgeoning-01.ogg"
		}
	},
	pike: {
		label: "Pike",
		patterns: "\\bpike\\b",
		type: "onToken",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Melee/Group03/TrailAttack03_01_01_Regular_BlueYellow_800x600.webm",
			scale: 1,
			duration: 1000,
			sound: "modules/psfx/library/impacts/slashing/v1/meleeattack-impacts-slashing-00.ogg"
		}
	},
	poleblade: {
		label: "Poleblade",
		patterns: "poleblade|glaive|halberd",
		type: "onToken",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Melee/Group04/TrailAttack04_01_04_Regular_BlueYellow_800x600.webm",
			scale: 1,
			duration: 1000,
			sound: "modules/psfx/library/impacts/slashing/v1/meleeattack-impacts-slashing-01.ogg"
		}
	},
	rifle: {
		label: "Rifle",
		patterns: "rifle|musket",
		type: "projectile",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Ranged/Snipe_01_Regular_Blue_15ft_1000x400.webm",
			scale: 1,
			duration: 1500,
			sound: "modules/psfx/library/ranged-weapons/guns/revolver/single-fire/revolver-single-fire-001-03.ogg"
		}
	},
	shortbow: {
		label: "Shortbow",
		patterns: "shortbow|short bow",
		type: "projectile",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Ranged/Arrow01_01_Regular_White_15ft_1000x400.webm",
			scale: 1,
			duration: 1500,
			sound: "modules/psfx/library/ranged-weapons/longbow/v1/longbow-003-60ft.ogg"
		}
	},
	shortsword: {
		label: "Shortsword",
		patterns: "shortsword|short sword",
		type: "onToken",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Melee/Shortsword01_03_Regular_White_800x600.webm",
			scale: 1,
			duration: 1000,
			sound: "modules/psfx/library/impacts/slashing/v1/meleeattack-impacts-slashing-02.ogg"
		}
	},
	shotgun: {
		label: "Shotgun",
		patterns: "\\bshotgun\\b",
		type: "projectile",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Ranged/Bullet_02_Regular_Orange_05ft_600x400.webm",
			scale: 1,
			duration: 1500,
			sound: "modules/psfx/library/ranged-weapons/guns/revolver/single-fire/revolver-single-fire-001-03.ogg"
		}
	},
	shotgun_sawed_off: {
		label: "Shotgun, sawed-off",
		patterns: "sawed-off|sawn-off",
		type: "projectile",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Ranged/Bullet_02_Regular_Orange_05ft_600x400.webm",
			scale: 1,
			duration: 1500,
			sound: "modules/psfx/library/ranged-weapons/guns/revolver/single-fire/revolver-single-fire-001-03.ogg"
		}
	},
	sling: {
		label: "Sling",
		patterns: "\\bsling\\b",
		type: "projectile",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Ranged/Bullet_03_Regular_Blue_15ft_1000x400.webm",
			scale: 1,
			duration: 1500,
			sound: "modules/psfx/library/ranged-weapons/guns/revolver/single-fire/revolver-single-fire-001-03.ogg"
		}
	},
	spear: {
		label: "Spear",
		patterns: "\\bspear\\b|trident",
		type: "onToken",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Melee/Spear01_01_Regular_White_800x600.webm",
			scale: 1,
			duration: 1000,
			sound: "modules/psfx/library/impacts/slashing/v1/meleeattack-impacts-slashing-03.ogg"
		}
	},
	staff: {
		label: "Staff",
		patterns: "\\bstaff\\b|\\bstave\\b|quarterstaff",
		type: "onToken",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Melee/Quarterstaff01_03_Regular_White_800x600.webm",
			scale: 1,
			duration: 1000,
			sound: "modules/psfx/library/impacts/bludgeoning/v1/meleeattack-impacts-bludgeoning-02.ogg"
		}
	},
	standard_shield: {
		label: "Standard shield",
		patterns: "\\bshield\\b",
		type: "onToken",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Melee/Group06/MeleeAttack06_Shield01_01_Regular_White_800x600.webm",
			scale: 1,
			duration: 1000,
			sound: "modules/psfx/library/impacts/bludgeoning/v1/meleeattack-impacts-bludgeoning-03.ogg"
		}
	},
	unarmed: {
		label: "Unarmed",
		patterns: "unarmed|\\bfist\\b",
		type: "onToken",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Unarmed_Attacks/Unarmed_Strike/UnarmedStrike_01_Regular_Blue_Physical01_800x600.webm",
			scale: 1,
			duration: 1000,
			sound: "modules/psfx/library/impacts/bludgeoning/v1/meleeattack-impacts-bludgeoning-00.ogg"
		}
	},
	warhammer: {
		label: "Warhammer",
		patterns: "warhammer|war hammer",
		type: "onToken",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Melee/Warhammer01_05_Regular_White_800x600.webm",
			scale: 1,
			duration: 1000,
			sound: "modules/psfx/library/impacts/bludgeoning/v1/meleeattack-impacts-bludgeoning-01.ogg"
		}
	},
	whip_chain: {
		label: "Whip, chain",
		patterns: "razor chain|chain whip|whip, chain",
		type: "projectile",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/RangedSpell/02/RangedInstant02_01_Regular_Yellow_30ft_1600x400.webm",
			scale: 1,
			duration: 1500,
			sound: "modules/psfx/library/impacts/bludgeoning/v1/meleeattack-impacts-bludgeoning-02.ogg"
		}
	},
	whip_leather: {
		label: "Whip, leather",
		patterns: "\\bwhip\\b",
		type: "projectile",
		target: "target",
		hit: {
			file: "modules/JB2A_DnD5e/Library/Generic/RangedSpell/03/RangedProjectile03_01_Regular_BlueGreen_30ft_1600x400.webm",
			scale: 1,
			duration: 1500,
			sound: "modules/psfx/library/impacts/bludgeoning/v1/meleeattack-impacts-bludgeoning-03.ogg"
		}
	},
};

export default DEFAULT_WEAPON_PRESETS;

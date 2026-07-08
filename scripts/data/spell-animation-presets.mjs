/**
 * Default spell animation presets for the Animation FX master list.
 *
 * Unlike the weapon presets (which use raw `modules/JB2A_DnD5e/...` file paths
 * from a curated CSV), spells use **Sequencer Database keys** (`jb2a.*`). That
 * matters for projectiles: a DB key that owns `05ft/15ft/30ft/60ft/90ft`
 * variants lets Sequencer pick the correct-length file for `stretchTo`, whereas
 * a fixed-distance file gets stretched and distorted.
 *
 * Every key below was validated against the installed JB2A free pack with
 * `Sequencer.Database.entryExists()`. Keys with no explicit variant (e.g.
 * `jb2a.condition.curse`) intentionally let Sequencer pick a random child.
 *
 * Coverage: Shadowdark has ~143 spells; JB2A free ships ~49 spell folders, so
 * most entries here are *shape-mapped* (ranged bolt / cone / burst / buff /
 * heal) rather than a dedicated per-spell animation. Patterns are grouped so a
 * single preset covers a family (e.g. all the divination spells share one).
 * Anything unmatched falls through to `spells._default`.
 *
 * Resolution scores by longest matched substring, so specific patterns beat
 * generic ones. Per-item overrides on a spell's Activity tab beat this list.
 */

export const DEFAULT_SPELL_PRESETS = {
	// ── Ranged attack spells (projectile: stretchTo target) ──────────────────
	magic_missile: {
		label: "Magic Missile",
		patterns: "magic missile",
		type: "projectile",
		target: "target",
		hit: { file: "jb2a.magic_missile.purple", scale: 1, duration: 1500 }
	},
	acid_arrow: {
		label: "Acid Arrow",
		patterns: "acid arrow",
		type: "projectile",
		target: "target",
		hit: { file: "jb2a.disintegrate.green", scale: 1, duration: 1500 }
	},
	fire_bolt: {
		label: "Fire Bolt",
		patterns: "fire bolt|firebolt",
		type: "projectile",
		target: "target",
		hit: { file: "jb2a.fire_bolt.orange", scale: 1, duration: 1500 }
	},
	chaos_orb: {
		label: "Chaos / Prismatic Orb",
		patterns: "chaos orb|prismatic orb",
		type: "projectile",
		target: "target",
		hit: { file: "jb2a.overcharged_sphere.01.01.dark_purple", scale: 1, duration: 1500 }
	},
	witchlight_bolt: {
		label: "Witch Bolt",
		patterns: "witch bolt",
		type: "projectile",
		target: "target",
		hit: { file: "jb2a.witch_bolt.blue", scale: 1, duration: 1500 }
	},
	lightning_bolt: {
		label: "Lightning Bolt",
		patterns: "lightning bolt",
		type: "projectile",
		target: "target",
		hit: { file: "jb2a.lightning_bolt.narrow.blue", scale: 1, duration: 1500 }
	},
	thors_thunder: {
		label: "Thor's Thunder (chain lightning)",
		patterns: "thor's thunder|thors thunder",
		type: "projectile",
		target: "target",
		hit: { file: "jb2a.chain_lightning.primary.blue", scale: 1, duration: 1500 }
	},
	finger_of_death: {
		label: "Finger of Death / Void Stare",
		patterns: "finger of death|void stare|disintegrate",
		type: "projectile",
		target: "target",
		hit: { file: "jb2a.energy_beam.normal.bluepink.02", scale: 1, duration: 1500 }
	},

	// ── Cones ────────────────────────────────────────────────────────────────
	burning_hands: {
		label: "Burning Hands",
		patterns: "burning hands",
		type: "cone",
		target: "target",
		hit: { file: "jb2a.burning_hands.01.orange", scale: 1, duration: 1500 }
	},
	howl: {
		label: "Howl",
		patterns: "\\bhowl\\b",
		type: "cone",
		target: "target",
		hit: { file: "jb2a.breath_weapons.cold.cone.blue", scale: 1, duration: 1500 }
	},

	// ── Bursts on the target ─────────────────────────────────────────────────
	fireball: {
		label: "Fireball / Flame Strike",
		patterns: "fireball|flame strike",
		type: "onToken",
		target: "target",
		hit: { file: "jb2a.explosion.01.orange", scale: 1, duration: 1500 }
	},
	smite: {
		label: "Smite / Judgment",
		patterns: "\\bsmite\\b|judgment|divine vengeance",
		type: "onToken",
		target: "target",
		hit: { file: "jb2a.divine_smite.caster.reversed.blueyellow", scale: 1, duration: 1200 }
	},
	turn_undead: {
		label: "Turn Undead / Rebuke Unholy",
		patterns: "turn undead|rebuke unholy|lay to rest|cast out",
		type: "onToken",
		target: "target",
		hit: { file: "jb2a.spirit_guardians.blueyellow.ring", scale: 1, duration: 1500 }
	},
	swarm: {
		label: "Swarm / Frog Rain",
		patterns: "\\bswarm\\b|frog rain",
		type: "onToken",
		target: "target",
		hit: { file: "jb2a.cloud_of_daggers.daggers.blue", scale: 1, duration: 1500 }
	},

	// ── Healing ──────────────────────────────────────────────────────────────
	cure_wounds: {
		label: "Cure Wounds / Heal",
		patterns: "cure wounds|mass cure|\\bheal\\b|restoration|regenerate",
		type: "onToken",
		target: "target",
		hit: { file: "jb2a.cure_wounds.200px.blue", scale: 1, duration: 1200 }
	},

	// ── Self buffs ───────────────────────────────────────────────────────────
	bless: {
		label: "Bless / Chant / Shield of Faith",
		patterns: "\\bbless\\b|\\bchant\\b|shield of faith",
		type: "onToken",
		target: "self",
		hit: { file: "jb2a.bless.200px.intro.yellow", scale: 1, duration: 1200 }
	},
	mage_armor: {
		label: "Mage Armor / Stoneskin",
		patterns: "mage armor|stoneskin|antimagic shell|resilient sphere",
		type: "onToken",
		target: "self",
		hit: { file: "jb2a.shield.01.complete.01.blue", scale: 1, duration: 1500 }
	},
	holy_weapon: {
		label: "Holy / Cleansing Weapon / Wrath",
		patterns: "holy weapon|cleansing weapon|\\bwrath\\b",
		type: "onToken",
		target: "self",
		hit: { file: "jb2a.ward.rune.yellow.01", scale: 1, duration: 1500 }
	},
	invisibility: {
		label: "Invisibility / Cloak of Night",
		patterns: "invisibility|cloak of night|shadowdance|mirror image",
		type: "onToken",
		target: "self",
		hit: { file: "jb2a.on_token_buff.001.001.blue", scale: 1, duration: 1500 }
	},
	polymorph: {
		label: "Polymorph / Shapechanger",
		patterns: "polymorph|shapechanger|wolfshape|alter self|gaseous form",
		type: "onToken",
		target: "self",
		hit: { file: "jb2a.on_token_buff.001.001.purple", scale: 1, duration: 1500 }
	},
	fly: {
		label: "Fly / Levitate",
		patterns: "\\bfly\\b|levitate|feather fall|broomstick",
		type: "onToken",
		target: "self",
		hit: { file: "jb2a.on_token_buff.001.001.green", scale: 1, duration: 1500 }
	},
	animate_dead: {
		label: "Animate Dead / Undeath",
		patterns: "animate dead|create undead|undeath|soul jar|soulbind|speak with dead",
		type: "onToken",
		target: "self",
		hit: { file: "jb2a.arms_of_hadar.dark_purple", scale: 1, duration: 1500 }
	},

	// ── Divination / utility (cast flourish on self) ─────────────────────────
	detect_magic: {
		label: "Detect Magic / Divination",
		patterns: "detect magic|detect thoughts|arcane eye|scrying|divination|commune|augury|prophecy|read the runes",
		type: "onToken",
		target: "self",
		hit: { file: "jb2a.detect_magic.circle.blue", scale: 1, duration: 1500 }
	},
	identify: {
		label: "Identify / Knock / Dispel",
		patterns: "identify|\\bknock\\b|dispel magic|hold portal|\\balarm\\b",
		type: "onToken",
		target: "self",
		hit: { file: "jb2a.on_token_cast.initiate.001.instant.combined.blue.0", scale: 1, duration: 1200 }
	},
	light: {
		label: "Light",
		patterns: "\\blight\\b|witchlight",
		type: "onToken",
		target: "self",
		hit: { file: "jb2a.dancing_light.blueteal", scale: 1, duration: 1500 }
	},

	// ── Teleports ────────────────────────────────────────────────────────────
	misty_step: {
		label: "Misty Step",
		patterns: "misty step",
		type: "onToken",
		target: "self",
		hit: { file: "jb2a.misty_step.01.blue", scale: 1, duration: 1200 }
	},
	teleport: {
		label: "Teleport / Dimension Door",
		patterns: "teleport|dimension door|plane shift|dreamwalk|passwall",
		type: "onToken",
		target: "self",
		hit: { file: "jb2a.teleport.01.blue", scale: 1, duration: 1500 }
	},

	// ── Debuffs / controls on the target ─────────────────────────────────────
	sleep: {
		label: "Sleep / Charm",
		patterns: "\\bsleep\\b|charm person|beguile|hypnotize|puppet|\\bcommand\\b|confusion|dominion",
		type: "onToken",
		target: "target",
		hit: { file: "jb2a.sleep.target.pink", scale: 1, duration: 1500 }
	},
	hold_person: {
		label: "Hold Person / Enfeeble / Curse",
		patterns: "hold person|hold monster|glassbones|enfeeble|\\bcurse\\b|\\bpoison\\b",
		type: "onToken",
		target: "target",
		hit: { file: "jb2a.condition.curse", scale: 1, duration: 1500 }
	},

	// ── Zones / walls placed at the target ───────────────────────────────────
	web: {
		label: "Web / Spidersilk",
		patterns: "\\bweb\\b|spidersilk",
		type: "onToken",
		target: "target",
		hit: { file: "jb2a.web.01", scale: 1, duration: 1500 }
	},
	entangle: {
		label: "Entangle / Oak, Ash, Thorn",
		patterns: "entangle|oak, ash, thorn|mistletoe|toadstool|bogboil",
		type: "onToken",
		target: "target",
		hit: { file: "jb2a.entangle.brown", scale: 1, duration: 1500 }
	},
	fog: {
		label: "Fog / Cloud Kill",
		patterns: "\\bfog\\b|cloud kill",
		type: "onToken",
		target: "target",
		hit: { file: "jb2a.fog_cloud.01.white", scale: 1, duration: 1500 }
	},
	darkness: {
		label: "Darkness / Mother of Night",
		patterns: "darkness|mother of night",
		type: "onToken",
		target: "target",
		hit: { file: "jb2a.darkness.black", scale: 1, duration: 1500 }
	},
	moonbeam: {
		label: "Moonbeam",
		patterns: "moonbeam",
		type: "onToken",
		target: "target",
		hit: { file: "jb2a.moonbeam.01.complete.blue", scale: 1, duration: 1500 }
	},
	wall_of_force: {
		label: "Wall of Force",
		patterns: "wall of force",
		type: "onToken",
		target: "target",
		hit: { file: "jb2a.wall_of_force.horizontal.grey", scale: 1, duration: 1500 }
	},
	silence: {
		label: "Silence / Zone of Truth",
		patterns: "silence|zone of truth|magic circle",
		type: "onToken",
		target: "target",
		hit: { file: "jb2a.template_circle.aura.01.complete.small.bluepurple", scale: 1, duration: 1500 }
	},
	floating_disk: {
		label: "Floating Disk / Telekinesis",
		patterns: "floating disk|telekinesis|fixed object",
		type: "onToken",
		target: "target",
		hit: { file: "jb2a.arcane_hand.blue", scale: 1, duration: 1500 }
	}
};

export default DEFAULT_SPELL_PRESETS;

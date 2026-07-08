/**
 * Default spell animation presets for the Animation FX master list (`spells`).
 *
 * REBUILT against the actual Shadowdark spell corpus — the union of the system
 * pack (`shadowdark.spells`, 156), the world/Enhancer pack (`world.spells`, 105)
 * and SDX's own bundled spells (83) = ~240 distinct spells — NOT the JB2A D&D
 * folder list. Presets are organised by *effect archetype*; each `patterns`
 * regex lists the real Shadowdark / Shadowdark Enhancer spell names that fit,
 * mapped to a JB2A (free) animation. Longest-matched-substring wins, so a
 * specific name (e.g. "fireball") beats a broad keyword (e.g. "fire").
 *
 * All `file` keys are verified present in the installed free JB2A_DnD5e pack.
 * Utility spells with no meaningful visual (Alchemy, Fabricate, Naming, Scrying,
 * Sending, Identify, Commune…) are intentionally omitted — they fall to the
 * generic `_default` or, if that is removed, to nothing.
 */

export const DEFAULT_SPELL_PRESETS = {
	// ── generic fallback ─────────────────────────────────────────────────────
	_default: {
		label: "Generic Arcane Bolt", patterns: "",
		type: "projectile", target: "target",
		hit: { file: "jb2a.magic_missile", scale: 1, duration: 1500 }
	},

	// ── force / arcane ───────────────────────────────────────────────────────
	force_bolt: {
		label: "Force / Arcane Bolt",
		patterns: "magic missile|eldritch|force bolt|witch bolt|anima|push\\/pull|magnetize|telekinesis|arcane|\\bwish\\b",
		type: "projectile", target: "target",
		hit: { file: "jb2a.magic_missile", scale: 1, duration: 1500 }
	},
	disintegrate: {
		label: "Disintegrate / Decay",
		patterns: "disintegrat|dismember|excoriate|wrack|oxidize|dust to dust|ashes to ashes|acid arrow|corrode|envenom",
		type: "projectile", target: "target",
		hit: { file: "jb2a.disintegrate.green", scale: 1, duration: 1500 }
	},

	// ── fire ─────────────────────────────────────────────────────────────────
	fireball: {
		label: "Fireball / Flame Strike",
		patterns: "fireball|flame strike|inferno|fire blast|wheel of flames|chaos orb|prismatic orb|meteor",
		type: "projectile", target: "target",
		hit: { file: "jb2a.fireball", scale: 1, duration: 1800 }
	},
	fire_bolt: {
		label: "Fire Bolt / Flare",
		patterns: "fire bolt|firebolt|flare|scorch|ember|cinder|blazing",
		type: "projectile", target: "target",
		hit: { file: "jb2a.fire_bolt.orange", scale: 1, duration: 1500 }
	},
	burning_hands: {
		label: "Burning Hands (cone)",
		patterns: "burning hands|dragon breath|cone of fire|fire breath",
		type: "cone", target: "target",
		hit: { file: "jb2a.burning_hands", scale: 1, duration: 1500 }
	},
	wall_of_fire: {
		label: "Wall of Fire",
		patterns: "wall of fire|firewall|ring of fire",
		type: "onToken", target: "target",
		hit: { file: "jb2a.wall_of_fire", scale: 1, duration: 1800 }
	},

	// ── lightning / storm ────────────────────────────────────────────────────
	lightning_bolt: {
		label: "Lightning Bolt",
		patterns: "lightning bolt|shock|electrocute",
		type: "projectile", target: "target",
		hit: { file: "jb2a.lightning_bolt.narrow.blue", scale: 1, duration: 1200 }
	},
	chain_lightning: {
		label: "Chain Lightning / Thor's Thunder",
		patterns: "chain lightning|thor's thunder|thors thunder|thunderbolt",
		type: "projectile", target: "target",
		hit: { file: "jb2a.chain_lightning.primary.blue", scale: 1, duration: 1500 }
	},
	call_lightning: {
		label: "Call Lightning / Storm",
		patterns: "call lightning|summon storm|\\bstorm\\b|tempest|maelstrom",
		type: "onToken", target: "target",
		hit: { file: "jb2a.call_lightning", scale: 1, duration: 1800 }
	},
	thunderwave: {
		label: "Thunderwave / Shatter / Earthquake",
		patterns: "thunderwave|shatter|earthquake|tremor|sonic|screech",
		type: "onToken", target: "target",
		hit: { file: "jb2a.shatter", scale: 1, duration: 1200 }
	},

	// ── cold ─────────────────────────────────────────────────────────────────
	frost: {
		label: "Frost / Cold",
		patterns: "ray of frost|frost|\\bice\\b|freeze|\\bcold\\b|chill|rime|glacial|avalanche",
		type: "projectile", target: "target",
		hit: { file: "jb2a.ray_of_frost.blue", scale: 1, duration: 1400 }
	},
	cone_of_cold: {
		label: "Cone of Cold",
		patterns: "cone of cold|frost breath|blizzard",
		type: "cone", target: "target",
		hit: { file: "jb2a.cone_of_cold", scale: 1, duration: 1500 }
	},

	// ── necrotic / death / drain ─────────────────────────────────────────────
	necrotic_bolt: {
		label: "Necrotic / Death Bolt",
		patterns: "finger of death|void stare|power word kill|reap the soul|seal soul|summon soul|soul jar|soulbind|siphon|drain life|\\bdrain\\b|\\bharm\\b|inflict|wither|withermark|blight|contagion|damnation|defile|\\bbane\\b|ghoul touch|unlife|undeath|create undead|speak with dead|final toll|lamentation|necronom|cacklerot|enfeeble|\\bcurse\\b|anathema|cast out|wrack|nightmare|revenant|\\bpoison\\b|glassbones|sacrifice|ragnarok|\\brend\\b",
		type: "projectile", target: "target",
		hit: { file: "jb2a.toll_the_dead.green", scale: 1, duration: 1500 }
	},
	necrotic_burst: {
		label: "Necrotic Burst",
		patterns: "arms of hadar|plague|blood rite|contagion|excoriate",
		type: "onToken", target: "target",
		hit: { file: "jb2a.arms_of_hadar.dark_purple", scale: 1, duration: 1500 }
	},
	swarm_bats: {
		label: "Bats / Raven / Swarm",
		patterns: "\\braven\\b|\\bbats\\b|crows|murder of|\\bflock\\b|\\bcoven\\b|locusts|\\bswarm\\b|frog rain",
		type: "onToken", target: "target",
		hit: { file: "jb2a.bats", scale: 1, duration: 1500 }
	},

	// ── radiant / holy ───────────────────────────────────────────────────────
	holy_smite: {
		label: "Holy / Smite / Judgment",
		patterns: "smite|judgment|judgement|turn undead|rebuke unholy|rebuke|divine vengeance|holy weapon|cleansing weapon|\\bwrath\\b|consecrate|\\bhalo\\b|rapture|prayer|\\bchant\\b|sacred|divine|cleanse|abjure|excommunicate",
		type: "onToken", target: "target",
		hit: { file: "jb2a.divine_smite.caster", scale: 1, duration: 1500 }
	},
	spiritual_weapon: {
		label: "Spiritual / Summoned Weapon",
		patterns: "spiritual weapon|spirit blade|dancing blade",
		type: "onToken", target: "target",
		hit: { file: "jb2a.spiritual_weapon", scale: 1, duration: 1500 }
	},

	// ── healing / restoration ────────────────────────────────────────────────
	heal: {
		label: "Cure Wounds / Heal",
		patterns: "cure wounds|\\bcure\\b|\\bheal\\b|mass cure|regenerate|restoration|revitalize|regrowth|lay to rest|\\bfeast\\b|restore|death ward",
		type: "onToken", target: "target",
		hit: { file: "jb2a.cure_wounds", scale: 1, duration: 1500 }
	},

	// ── nature / druid ───────────────────────────────────────────────────────
	entangle: {
		label: "Entangle / Roots / Thorns",
		patterns: "entangle|oak, ash, thorn|oak ash thorn|\\bthorn\\b|\\broot\\b|barkskin|spidersilk|\\bweb\\b|grease|mycelium|treeshape|bear shape|world tree|world serpent|\\bserpent\\b|riverwalk|mistletoe|toadstool|willowman",
		type: "onToken", target: "self",
		hit: { file: "jb2a.entangle", scale: 1, duration: 1800 }
	},

	// ── enchant / mind / illusion ────────────────────────────────────────────
	enchant: {
		label: "Charm / Mind / Illusion",
		patterns: "charm|beguile|befriend|hypnotize|hypnotise|dominate|dominion|subjugate|pacify|\\bpeace\\b|command|puppet|pin doll|confusion|feeblemind|hallucinate|phantoms|illusion|mirror image|instill|betrayal|mischief|mesmerism|loki's trickery|lokis trickery|\\btrance\\b|\\bsleep\\b|whisper|beckon|glamour|forbid|unhinge|hold person|hold monster|\\bhold\\b|\\bsilence\\b|zone of truth|evoke rage|\\bhowl\\b",
		type: "onToken", target: "target",
		hit: { file: "jb2a.sleep", scale: 1, duration: 1500 }
	},

	// ── buff / ward / self ───────────────────────────────────────────────────
	buff: {
		label: "Bless / Ward / Buff",
		patterns: "bless|shield of faith|mage armor|mage armour|stoneskin|fortify|\\bward\\b|absorb|anchor|stasis|balance|\\bfate\\b|freya's omen|freyas omen|odin's wisdom|odins wisdom|covenant|permanence|protection from|protection|aegis|fortitude|fifth gate|fourth gate|third gate|second gate|first gate|prophecy|invisibility|\\bfly\\b|levitate|feather fall|witchlight|barkskin",
		type: "onToken", target: "self",
		hit: { file: "jb2a.bless", scale: 1, duration: 1500 }
	},
	arcane_shield: {
		label: "Shield / Force Barrier",
		patterns: "^shield$|force shield|wall of force|antimagic|resilient sphere|magic circle|\\bglyph\\b|\\bseal\\b|\\bhold portal\\b",
		type: "onToken", target: "self",
		hit: { file: "jb2a.shield.01", scale: 1, duration: 1500 }
	},

	// ── summon / gate / teleport ─────────────────────────────────────────────
	summon_gate: {
		label: "Gate / Summon / Teleport",
		patterns: "\\bgate\\b|\\bsummon\\b|teleport|dimension door|plane shift|misty step|conjure|banish|valkyrie|planar|portal|dreamwalk|shadowdance|gaseous form|polymorph|shapechanger|wolfshape|alter self|passwall",
		type: "onToken", target: "self",
		hit: { file: "jb2a.misty_step", scale: 1, duration: 1500 }
	},

	// ── control / area (fog, wind, darkness, beam) ───────────────────────────
	fog: {
		label: "Fog / Cloud",
		patterns: "\\bfog\\b|cloud kill|cloudkill|fog cloud|obscuring|\\bmist\\b",
		type: "onToken", target: "target",
		hit: { file: "jb2a.fog_cloud", scale: 1, duration: 1800 }
	},
	darkness: {
		label: "Darkness / Night / Blind",
		patterns: "darkness|mother of night|cloak of night|\\bshadow\\b|blind\\/deafen|\\bblind\\b|eyebite|\\bvoid\\b",
		type: "onToken", target: "target",
		hit: { file: "jb2a.darkness", scale: 1, duration: 1500 }
	},
	wind: {
		label: "Wind / Whirlwind",
		patterns: "gust of wind|whirlwind|\\bgust\\b|cyclone|wind wall|control water|riptide",
		type: "onToken", target: "target",
		hit: { file: "jb2a.gust_of_wind", scale: 1, duration: 1500 }
	},
	moonbeam: {
		label: "Moonbeam / Radiant Beam",
		patterns: "moonbeam|\\bbeam\\b|pillar of|column of light|flame strike",
		type: "onToken", target: "target",
		hit: { file: "jb2a.moonbeam.01", scale: 1, duration: 1800 }
	},

	// ── divination / detection (subtle self) ─────────────────────────────────
	detect: {
		label: "Detect / Divination",
		patterns: "detect magic|\\bdetect\\b|divination|augury|scrying|\\bscry\\b|commune|reveal|\\bvision\\b|read the runes|truespeech|clairvoyance|arcane eye|see invis|cat's eye|cats eye|dispel magic|\\bdispel\\b",
		type: "onToken", target: "self",
		hit: { file: "jb2a.detect_magic", scale: 1, duration: 1500 }
	}
};

export default DEFAULT_SPELL_PRESETS;

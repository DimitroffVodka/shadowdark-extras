import assert from "node:assert/strict";
import test from "node:test";

// The import graph (WeaponBonusConfig -> CreatureTypesApp) destructures
// `foundry.applications.api` at module load time, so a minimal foundry stub
// must exist before the first import of roll-patches.
globalThis.foundry = {
	applications: {
		api: {
			ApplicationV2: class {},
			HandlebarsApplicationMixin: (base) => base,
		},
	},
};
const { setupRollConfigPatches } = await import("../../scripts/combat/roll-patches.mjs");

/**
 * Phase 5.2.1 regression (issue #52) — SDX talent advantage must survive
 * actor updates and embedded-document creation.
 *
 * The bug: the generator wrapper marked the ACTOR document
 * (`actor.__sdxRollConfigPatched`) but wrapped generators that live on
 * `actor.system` (a DataModel class field, PlayerSD.mjs:73). Any actor update
 * rebuilds `actor.system` with pristine generators while the marker survives,
 * so the wrapper was discarded and never reinstated — SDX talent advantage
 * went inert.
 *
 * The fix (option 2): retire the wrapper entirely; the renderRollDialogSD
 * hook owns advantage/disadvantage for all roll types (Player actors only),
 * resolved through `config.actorUuid` so unlinked token actors work too.
 *
 * These tests drive the real roll path the way the game does: the system
 * generator fills the config, then the dialog hook runs. After an
 * `actor.update()` or `createEmbeddedDocuments()` the advantage must still
 * reach `config.mainRoll`, and re-rendering must never accumulate it.
 */

/** A stand-in for an SD 4.x PlayerSD rollConfigGenerators entry. */
function makeGenerator(type, { systemAdvantage } = {}) {
	return async function generator(config) {
		if (type === "attack") {
			config.attack = { type: "melee" };
		}
		if (type === "ability" || type === "check") {
			config.check = { stat: "STR" };
		}
		config.mainRoll = { base: "d20", bonus: "", tooltips: "" };
		if (type === "attack") {
			config.damageRoll = { formula: "1d8", tooltips: "" };
		}
		if (systemAdvantage !== undefined) {
			config.mainRoll.advantage = systemAdvantage;
		}
	};
}

/** A minimal document with DataModel-rebuild semantics. */
function makeActor({ type = "Player", advantage = [], disadvantage = [], systemAdvantage } = {}) {
	const buildSystem = () => ({
		bonuses: { advantage, disadvantage },
		// class-field rollConfigGenerators are re-instantiated pristine
		rollConfigGenerators: {
			attack: makeGenerator("attack", { systemAdvantage }),
			spell: makeGenerator("spell", { systemAdvantage }),
			ability: makeGenerator("ability", { systemAdvantage }),
			check: makeGenerator("check", { systemAdvantage }),
		},
	});
	const actor = {
		id: "actor-1",
		type,
		system: buildSystem(),
		// Foundry Document.update() replaces `system` with a fresh DataModel.
		update() {
			actor.system = buildSystem();
		},
		createEmbeddedDocuments() {
			actor.update();
		},
	};
	return actor;
}

function installWorld(actor, { tokenActor, weaponSlug } = {}) {
	const hooks = new Map();
	const previousHooks = globalThis.Hooks;
	const previousGame = globalThis.game;
	const previousFromUuid = globalThis.fromUuid;

	globalThis.Hooks = {
		on(name, callback) {
			hooks.set(name, callback);
		},
		once() {},
	};
	globalThis.game = {
		actors: {
			get: (id) => (id === actor.id ? actor : undefined),
			[Symbol.iterator]: function* () {
				yield actor;
			},
		},
		user: { targets: { first: () => undefined } },
	};
	globalThis.fromUuid = async (uuid) => {
		if (uuid === "Actor.actor-1") return actor;
		if (uuid === "Token.tok-1") return tokenActor;
		return {
			flags: {},
			name: { slugify: () => weaponSlug ?? uuid.replace("Item.", "") },
			system: { type: "melee" },
		};
	};

	return {
		hooks,
		restore() {
			globalThis.Hooks = previousHooks;
			globalThis.game = previousGame;
			globalThis.fromUuid = previousFromUuid;
		},
	};
}

/** Run the full roll path the game uses: generate, then render the dialog. */
async function rollThroughDialog(actor, hooks, type, { actorUuid } = {}) {
	const config = {
		type,
		actorUuid: actorUuid ?? "Actor.actor-1",
	};
	if (type === "attack") config.itemUuid = "Item.weapon-1";

	await actor.system.rollConfigGenerators[type](config);

	const html = {
		querySelector: () => null,
		querySelectorAll: () => [],
	};
	await hooks.get("renderRollDialogSD")({ config, render: () => {} }, html, {});
	return config;
}

function countTooltip(config, text) {
	return (config.mainRoll?.tooltips.match(new RegExp(text, "g")) || []).length;
}

// ---------------------------------------------------------------- attack

test("attack advantage applies right after setup (harness sanity)", async () => {
	const actor = makeActor({ advantage: ["melee"] });
	const world = installWorld(actor);
	try {
		setupRollConfigPatches();
		const config = await rollThroughDialog(actor, world.hooks, "attack");
		assert.equal(config.mainRoll.advantage, 1);
	} finally {
		world.restore();
	}
});

test("attack advantage survives actor.update()", async () => {
	const actor = makeActor({ advantage: ["melee"] });
	const world = installWorld(actor);
	try {
		setupRollConfigPatches();
		actor.update(); // rebuilds actor.system with pristine generators
		const config = await rollThroughDialog(actor, world.hooks, "attack");
		assert.equal(
			config.mainRoll.advantage,
			1,
			"advantage must still apply after actor.update() rebuilt actor.system"
		);
	} finally {
		world.restore();
	}
});

test("attack advantage survives createEmbeddedDocuments()", async () => {
	const actor = makeActor({ advantage: ["melee"] });
	const world = installWorld(actor);
	try {
		setupRollConfigPatches();
		actor.createEmbeddedDocuments(); // also rebuilds actor.system
		const config = await rollThroughDialog(actor, world.hooks, "attack");
		assert.equal(
			config.mainRoll.advantage,
			1,
			"advantage must still apply after createEmbeddedDocuments() rebuilt actor.system"
		);
	} finally {
		world.restore();
	}
});

test("attack advantage via weapon slug survives actor.update()", async () => {
	const actor = makeActor({ advantage: ["silver-blade"] });
	const world = installWorld(actor, { weaponSlug: "silver-blade" });
	try {
		setupRollConfigPatches();
		actor.update();
		const config = await rollThroughDialog(actor, world.hooks, "attack");
		assert.equal(config.mainRoll.advantage, 1);
	} finally {
		world.restore();
	}
});

test("re-rendering cannot accumulate the same advantage", async () => {
	const actor = makeActor({ advantage: ["melee"] });
	const world = installWorld(actor);
	try {
		setupRollConfigPatches();
		actor.update();
		const first = await rollThroughDialog(actor, world.hooks, "attack");
		const firstBonus = first.mainRoll.bonus;
		assert.equal(countTooltip(first, "SDX Talent Advantage"), 1, "one render, one tooltip");

		// Every re-render path regenerates first (RollDialogSD._onCheckboxChange
		// and the SDX prompt-row click both call the generator again), so a
		// second full pass must produce the same formula, not the bonus twice.
		const second = await rollThroughDialog(actor, world.hooks, "attack");
		assert.equal(second.mainRoll.bonus, firstBonus, "bonus must not accumulate");
		assert.equal(countTooltip(second, "SDX Talent Advantage"), 1, "tooltip must not accumulate");
		assert.equal(second.mainRoll.advantage, 1);
	} finally {
		world.restore();
	}
});

// ------------------------------------------------------- spell / ability

test("spell advantage (spellcasting) survives actor.update()", async () => {
	const actor = makeActor({ advantage: ["spellcasting"] });
	const world = installWorld(actor);
	try {
		setupRollConfigPatches();
		actor.update();
		const config = await rollThroughDialog(actor, world.hooks, "spell");
		assert.equal(config.mainRoll.advantage, 1);
		assert.equal(countTooltip(config, "SDX Talent Advantage"), 1);
	} finally {
		world.restore();
	}
});

test("ability advantage and disadvantage via stat survive actor.update()", async () => {
	for (const [flags, expected] of [
		[{ advantage: ["STR"] }, 1],
		[{ disadvantage: ["STR"] }, -1],
	]) {
		const actor = makeActor(flags);
		const world = installWorld(actor);
		try {
			setupRollConfigPatches();
			actor.update();
			const config = await rollThroughDialog(actor, world.hooks, "ability");
			assert.equal(config.mainRoll.advantage, expected, JSON.stringify(flags));
		} finally {
			world.restore();
		}
	}
});

// ------------------------------------------------------- token / guards

test("unlinked token actor gets advantage through actorUuid", async () => {
	const tokenActor = makeActor({ advantage: ["melee"] });
	tokenActor.id = "tok-1";
	const world = installWorld(makeActor(), { tokenActor });
	try {
		setupRollConfigPatches();
		tokenActor.update(); // tokens get updated too
		const config = await rollThroughDialog(tokenActor, world.hooks, "attack", {
			actorUuid: "Token.tok-1",
		});
		assert.equal(config.mainRoll.advantage, 1);
	} finally {
		world.restore();
	}
});

test("NPC actors never receive SDX talent advantage (Player-only guard)", async () => {
	const npc = makeActor({ type: "NPC", advantage: ["melee"], systemAdvantage: 1 });
	const world = installWorld(npc);
	try {
		setupRollConfigPatches();
		const config = await rollThroughDialog(npc, world.hooks, "attack");
		assert.equal(config.mainRoll.advantage, 1, "system value untouched");
		assert.equal(countTooltip(config, "SDX Talent"), 0);
	} finally {
		world.restore();
	}
});

test("matching advantage and disadvantage cancel: system value preserved", async () => {
	const actor = makeActor({ advantage: ["melee"], disadvantage: ["melee"], systemAdvantage: 1 });
	const world = installWorld(actor);
	try {
		setupRollConfigPatches();
		actor.update();
		const config = await rollThroughDialog(actor, world.hooks, "attack");
		assert.equal(config.mainRoll.advantage, 1, "SDX must not override a system value on tie");
		assert.equal(countTooltip(config, "SDX Talent"), 0);
	} finally {
		world.restore();
	}
});

test("no SDX flags: system advantage preserved, nothing appended", async () => {
	const actor = makeActor({ systemAdvantage: 1 });
	const world = installWorld(actor);
	try {
		setupRollConfigPatches();
		actor.update();
		const config = await rollThroughDialog(actor, world.hooks, "attack");
		assert.equal(config.mainRoll.advantage, 1);
		assert.equal(countTooltip(config, "SDX Talent"), 0);
	} finally {
		world.restore();
	}
});

// ------------------------------------------------ review findings (Codex)

test("submitting the dialog keeps SDX advantage (radio sync)", async () => {
	const actor = makeActor({ advantage: ["melee"] });
	const world = installWorld(actor);
	try {
		setupRollConfigPatches();
		actor.update();

		// The dialog rendered its advantage radios from the config BEFORE the
		// hook ran (RollDialogSD._prepareContext -> advantageOptions) and the
		// submit handler writes the checked radio back into
		// config.mainRoll.advantage. Model both: a stale radio group and the
		// submit read-back.
		const radios = [
			{ value: "1", checked: false },
			{ value: "0", checked: true },
			{ value: "-1", checked: false },
		];
		const html = {
			querySelector: () => null,
			querySelectorAll: (sel) => (sel === 'input[name="advantage"]' ? radios : []),
		};

		const config = {
			type: "attack",
			itemUuid: "Item.weapon-1",
			actorUuid: "Actor.actor-1",
		};
		await actor.system.rollConfigGenerators.attack(config);
		await world.hooks.get("renderRollDialogSD")({ config, render: () => {} }, html, {});

		// RollDialogSD._onSubmit: the checked radio wins.
		const checked = radios.find((radio) => radio.checked);
		config.mainRoll.advantage = checked ? parseInt(checked.value, 10) : undefined;

		assert.equal(config.mainRoll.advantage, 1, "advantage must survive the submit read-back");
	} finally {
		world.restore();
	}
});

test("spell-learning check configs (actorId only) get advantage", async () => {
	const actor = makeActor({ advantage: ["STR"] });
	const world = installWorld(actor);
	try {
		setupRollConfigPatches();
		actor.update();

		// PlayerSD._learnSpell builds { actorId, itemUuid, check: { stat },
		// mainRoll } — no actorUuid. (The mock check generator fills
		// config.check with stat "STR", matching the flag above.)
		const config = {
			type: "check",
			itemUuid: "Item.scroll-1",
			actorId: actor.id,
			check: { stat: "STR" },
		};
		await actor.system.rollConfigGenerators.check(config);
		const html = { querySelector: () => null, querySelectorAll: () => [] };
		await world.hooks.get("renderRollDialogSD")({ config, render: () => {} }, html, {});

		assert.equal(config.mainRoll.advantage, 1);
	} finally {
		world.restore();
	}
});

test("spell advantage tooltip is written into the rendered dialog", async () => {
	const actor = makeActor({ advantage: ["spellcasting"] });
	const world = installWorld(actor);
	try {
		setupRollConfigPatches();
		actor.update();

		const tooltipEl = { textContent: "" };
		const html = {
			querySelector: (sel) =>
				sel === 'input[name="mainRoll.formula"]'
					? { closest: () => ({ querySelector: () => tooltipEl }) }
					: null,
			querySelectorAll: () => [],
		};

		const config = { type: "spell", actorUuid: "Actor.actor-1" };
		await actor.system.rollConfigGenerators.spell(config);
		await world.hooks.get("renderRollDialogSD")({ config, render: () => {} }, html, {});

		assert.ok(tooltipEl.textContent.includes("SDX Talent Advantage"));
	} finally {
		world.restore();
	}
});

// ----------------------------------------- dialog-less rolls (subagent find)

test("dialog-less (skipPrompt) rolls get advantage via rollFromConfig", async () => {
	const actor = makeActor({ advantage: ["STR"] });
	const world = installWorld(actor);
	const rolled = [];
	globalThis.shadowdark = {
		dice: {
			rollFromConfig: async (config) => {
				rolled.push(config);
			},
		},
	};
	try {
		setupRollConfigPatches();
		actor.update();

		// shift-click stat check: generators run, rollDialog returns early on
		// skipPrompt, rollFromConfig is the only chance to apply the talent.
		const config = { type: "check", actorId: actor.id, check: { stat: "STR" } };
		await actor.system.rollConfigGenerators.check(config);
		await globalThis.shadowdark.dice.rollFromConfig(config);

		assert.equal(rolled.length, 1);
		assert.equal(rolled[0].mainRoll.advantage, 1);
	} finally {
		world.restore();
		delete globalThis.shadowdark;
	}
});

test("dialog rolls are not double-applied by the rollFromConfig patch", async () => {
	const actor = makeActor({ advantage: ["melee"] });
	const world = installWorld(actor);
	const rolled = [];
	globalThis.shadowdark = {
		dice: {
			rollFromConfig: async (config) => {
				rolled.push(config);
			},
		},
	};
	try {
		setupRollConfigPatches();
		actor.update();

		// Full dialog path: the hook flags the config, then rollFromConfig runs.
		const config = await rollThroughDialog(actor, world.hooks, "attack");
		await globalThis.shadowdark.dice.rollFromConfig(config);

		assert.equal(rolled.length, 1);
		assert.equal(config.mainRoll.advantage, 1);
		assert.equal(countTooltip(config, "SDX Talent Advantage"), 1);
	} finally {
		world.restore();
		delete globalThis.shadowdark;
	}
});

test("ready setup skips an immutable rollFromConfig descriptor without blocking later ready steps", async () => {
	const readySteps = [];
	const previousHooks = globalThis.Hooks;
	const previousShadowdark = globalThis.shadowdark;
	const originalRollFromConfig = async () => {};
	let readySentinelRan = false;

	globalThis.Hooks = {
		on() {},
		once(name, callback) {
			if (name === "ready") readySteps.push(callback);
		},
	};
	globalThis.shadowdark = { dice: {} };
	Object.defineProperty(globalThis.shadowdark.dice, "rollFromConfig", {
		value: originalRollFromConfig,
		writable: false,
		configurable: false,
	});

	try {
		setupRollConfigPatches();
		Hooks.once("ready", () => {
			readySentinelRan = true;
		});
		await readySteps.at(-1)();

		assert.equal(globalThis.shadowdark.dice.rollFromConfig, originalRollFromConfig);
		assert.equal(globalThis.shadowdark.dice.__sdxRollFromConfigPatched, undefined);
		assert.equal(readySentinelRan, true);
	} finally {
		globalThis.Hooks = previousHooks;
		globalThis.shadowdark = previousShadowdark;
	}
});

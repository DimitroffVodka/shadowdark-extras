/**
 * Crawl-helper integration: let the PLAYER roll the d4 death timer.
 *
 * `shadowdark-crawl-helper` rolls the death timer on the GM client. This
 * replaces `rollDeathTimer` on its crawler combatant data model so the prompt
 * goes to the player who owns the dying character, falling back to the active
 * GM when nobody owns it.
 *
 * Extracted from the composition root in Phase 3 (step 39): 41 lines that
 * scored 3% dispatch — a data-model override written as a hook, which is the
 * shape this pass moves out. It sits in `combat/` rather than beside the other
 * crawl-helper integration (`canvas/carousel-drag.mjs`) because this track
 * classifies by FEATURE, not by which optional module a thing happens to
 * depend on: a death timer is combat, a draggable carousel is canvas UI.
 *
 * ENTIRELY OPTIONAL. The first line returns unless `shadowdark-crawl-helper`
 * is active, and the second returns if its combatant data model is not
 * registered, so on a world without it this is two comparisons and nothing
 * else.
 *
 * VERIFICATION DEBT, STATED PRECISELY. `shadowdark-crawl-helper` is installed
 * but DISABLED in the verification world, so under the real world state
 * execution returns at the FIRST guard below and nothing after it runs.
 *
 * An earlier version of this note, and the PR that introduced it, claimed the
 * probe "exercises both early returns". It did not, and review caught it: the
 * `crawlerModelRegistered: false` reading quoted as evidence was a fact about
 * `CONFIG.Combatant.dataModels` read separately, NOT an observation that the
 * second guard executed — execution had already stopped. Reporting world state
 * as if it were a code path is the same class of mistake as trusting a gate
 * that has stopped reporting.
 *
 * What is actually established, each with its own evidence:
 *
 *   - guard 1 (module inactive): taken. The second guard logs a warning before
 *     returning, and no such warning appears — its ABSENCE is the evidence.
 *   - guard 2 (model missing): exercised separately, by stubbing
 *     `game.modules.get` to report the module active with no crawler model
 *     registered. The warning then appears, so the branch works.
 *   - the override body itself: NOT exercised. Nothing here proves
 *     `rollDeathTimer` behaves correctly, only that the module loads and both
 *     guards behave.
 *
 * This is the second unit in that position — `canvas/carousel-drag.mjs` is the
 * first — and both are Phase 4 release-readiness rows. A byte-identical carry
 * proves the code did not change; it does not prove it works.
 *
 * The body is the root's verbatim; the callback is a named function so its
 * single-tab indentation is preserved rather than reindented.
 */

import { MODULE_ID } from "../shared/module-id.mjs";

function overrideCrawlHelperDeathTimer() {
	if (!game.modules.get("shadowdark-crawl-helper")?.active) return;

	const crawlerModel = CONFIG.Combatant?.dataModels?.["shadowdark-crawl-helper.crawler"];
	if (!crawlerModel) {
		console.warn(`${MODULE_ID} | Could not find crawl-helper combatant data model to override rollDeathTimer`);
		return;
	}

	crawlerModel.prototype.rollDeathTimer = async function () {
		const actor = this.parent.actor;
		const user = game.users.find(u => (u.character?.id === actor.id) && u.active) ?? game.users.activeGM;

		// Prompt the player to roll their death timer
		const defaultFormula = "d4 +" + actor.system.abilities.con.mod;
		const fields = foundry.applications.fields;
		const textInput = fields.createTextInput({ name: "formula", value: defaultFormula });
		const textGroup = fields.createFormGroup({ input: textInput, label: "Roll:" });

		const response = await user.query("dialog", {
			config: {
				window: { title: "Roll Death Timer" },
				content: `${textGroup.outerHTML}`,
				modal: true
			},
			type: "input"
		});

		const formula = Roll.validate(response?.formula) ? response.formula : defaultFormula;
		let roll = await new Roll(formula).evaluate();
		const total = Math.max(roll.total, 1);
		const msg = await ChatMessage.create({
			content: `<div class="shadowdark"><h3 style="color: white;">${actor.name} will die in ${total} rounds</h3><br>${await roll.render()}</div>`,
			speaker: { actor: actor.id },
			user: user,
			rolls: [roll.toJSON()]
		});
		if (game.dice3d) await game.dice3d.waitFor3DAnimationByMessageID(msg.id);
		await this.parent.update({ "system.dyingRounds": total });
	};

	console.log(`${MODULE_ID} | Overrode crawl-helper rollDeathTimer to let player roll`);
}

export function registerCrawlHelperDeathTimer() {
	Hooks.once("ready", overrideCrawlHelperDeathTimer);
}

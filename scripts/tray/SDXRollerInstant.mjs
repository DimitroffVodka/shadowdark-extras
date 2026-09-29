/**
 * The SDX group roll without the cinematic overlay: this client rolls every
 * actor's check in one pass and posts one chat card. Camping & Rest uses it
 * by default (#197); the overlay stays for everything else.
 */

import { buildSdxCheck, buildSdxRecapDice } from "./SDXRollerData.mjs";

const MODULE_ID = "shadowdark-extras";

/**
 * Roll `rollData` (as SDXRollerApp.dispatchGroupRoll takes it) for every actor
 * at once. Resolves as the overlay does: `{ results: { [uuid]: total }, canceled }`.
 * The card is one message carrying every roll, so a dice animation module
 * throws the whole group's dice together. (Roll#toMessage sets `rolls` to the
 * one roll it is called on, so it cannot build a card for several.)
 * @param {Object} rollData
 * @returns {Promise<{results: Object<string, number>, canceled: false}>}
 */
export async function rollGroupInstant(rollData) {
	const dc = Number(rollData.dc);
	const hasDC = Number.isFinite(dc) && dc > 0;
	const results = {};
	const rolls = [];
	const actors = [];
	for (const source of rollData.actors) {
		const actor = fromUuidSync(source);
		if (!actor) continue;
		const mode = rollData.actorRollModes?.[actor.uuid];
		const check = buildSdxCheck(rollData, actor.uuid, actor, mode);
		const roll = await new Roll(check.formula, { mod: check.mod }).evaluate();
		results[actor.uuid] = roll.total;
		rolls.push(roll);
		const dice = roll.dice[0]?.results?.map(die => die.result) ?? [];
		actors.push({
			name: actor.name,
			img: actor.img,
			result: roll.total,
			modLabel: (check.mod >= 0 ? "+" : "") + check.mod,
			abilityShort: rollData.actorAbilities && !check.isNone ? check.abilityId.toUpperCase() : "",
			diceResults: buildSdxRecapDice(dice, check.rollMode),
			showDice: dice.length > 1,
			showPass: hasDC,
			pass: hasDC && roll.total >= dc,
		});
	}

	if (rolls.length) {
		// The overlay's verdict: at least half the group met the DC.
		const passed = actors.filter(entry => entry.pass).length;
		const success = hasDC ? passed >= Math.ceil(actors.length / 2) : undefined;
		const content = await foundry.applications.handlebars.renderTemplate(
			`modules/${MODULE_ID}/templates/sdx-roller-recap.hbs`,
			{
				label: rollData.customLabel || rollData.abilityLabel,
				activityDescription: rollData.activityDescription,
				dc: hasDC ? dc : null,
				success,
				successLabel: success === true ? "SUCCESS" : success === false ? "FAILURE" : null,
				actors,
				contestants: [],
			}
		);
		await ChatMessage.create({
			content,
			rolls,
			speaker: { alias: "SDX Roller" },
			whisper: rollData.hideNames ? ChatMessage.getWhisperRecipients("GM") : [],
		});
	}
	return { results, canceled: false };
}

import { MODULE_ID } from "../shared/module-id.mjs";
import { injectWeaponBonusDisplay } from "./WeaponBonusConfig.mjs";

/**
 * Weapon hit-bonus chat display.
 *
 * Extracted from the composition root in Phase 3, verbatim. These two render the
 * hit-bonus breakdown onto an attack card. They read it from
 * `message.flags.<MODULE_ID>.hitBonus` — a flag stamped during message creation —
 * so they are the tail of a three-stage pipeline and touch none of its state:
 *
 *   1. the `ItemSD.prototype.rollItem` wrapper computes the bonus and stashes it
 *   2. `preCreateChatMessage` consumes the stash and writes the message flag
 *   3. these two read that flag and inject the display
 *
 * Only stage 3 lives here for now; stages 1 and 2 are still in the root.
 */
/**
 * Process weapon bonuses for a chat message
 */
export async function processWeaponBonuses(message, html) {
	// First, check if we have hit bonus info to display - this should happen
	// regardless of other conditions since it was pre-calculated
	const hitBonusInfo = message.flags?.[MODULE_ID]?.hitBonus;
	//console.log(`${MODULE_ID} | processWeaponBonuses - hitBonusInfo:`, hitBonusInfo);
	if (hitBonusInfo) {
		await injectHitBonusDisplay(html, hitBonusInfo);
	}

	// Check if this is a weapon attack roll (for damage bonus display)
	const flags = message.flags?.shadowdark;
	if (!flags?.itemId) return;

	// Get the actor and item
	const actor = game.actors.get(message.speaker?.actor) || canvas.tokens?.get(message.speaker?.token)?.actor;
	if (!actor) return;

	const item = actor.items.get(flags.itemId);
	if (!item || item.type !== "Weapon") return;

	// Check if weapon has damage bonuses configured
	const bonusFlags = item.flags?.[MODULE_ID]?.weaponBonus;
	if (!bonusFlags?.enabled) return;

	// Check if this was a critical hit
	const isCritical = message.rolls?.some(r => {
		const d20Roll = r.terms?.find(t => t.faces === 20);
		return d20Roll?.total === 20;
	});

	// Try to get the target
	const targetToken = message.flags?.shadowdark?.targetToken
		? canvas.tokens?.get(message.flags.shadowdark.targetToken)
		: game.user.targets.first();
	const target = targetToken?.actor;

	// Inject the weapon damage bonus display
	await injectWeaponBonusDisplay(message, html, item, actor, target, isCritical);
}

/**
 * Inject hit bonus information into the chat card
 * @param {jQuery} html - The message HTML
 * @param {Object} hitBonusInfo - { formula, result, parts }
 */
async function injectHitBonusDisplay(html, hitBonusInfo) {
	if (!hitBonusInfo || hitBonusInfo.result === 0) return;

	// Build tooltip from labels
	let tooltip = "";
	if (hitBonusInfo.parts && hitBonusInfo.parts.length > 0) {
		const labels = hitBonusInfo.parts
			.filter(p => p.label)
			.map(p => p.label);
		if (labels.length > 0) {
			tooltip = labels.join(", ");
		}
	}

	const sign = hitBonusInfo.result > 0 ? "+" : "";
	const tooltipAttr = tooltip ? `data-tooltip="${tooltip}"` : "";

	// Always show formula = result format
	let bonusHtml = `<div class="sdx-hit-bonus-display" ${tooltipAttr}>`;
	bonusHtml += `<span class="sdx-hit-bonus-label">Hit Bonus:</span>`;
	bonusHtml += `<span class="sdx-hit-bonus-formula">${hitBonusInfo.formula}</span>`;
	bonusHtml += `<span class="sdx-hit-bonus-equals">=</span>`;
	bonusHtml += `<span class="sdx-hit-bonus-result">${sign}${hitBonusInfo.result}</span>`;
	bonusHtml += `</div>`;

	// Find where to inject (after the roll result but before damage sections)
	const $attackRoll = html.find('.card-attack-roll');
	if ($attackRoll.length) {
		// Insert after the attack roll section
		$attackRoll.after(bonusHtml);
	} else {
		// Fallback: insert after the dice roll
		const $diceRoll = html.find('.dice-roll').first();
		if ($diceRoll.length) {
			$diceRoll.after(bonusHtml);
		}
	}
}

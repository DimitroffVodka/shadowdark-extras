import { MODULE_ID } from "../shared/module-id.mjs";
import { injectWeaponBonusDisplay } from "./WeaponBonusConfig.mjs";

/**
 * Weapon hit-bonus chat display.
 *
 * Reads the breakdown off the roll config that produced the card:
 * `message.rollConfig._sdxHitBonusInfo`, written by the `renderRollDialogSD`
 * handler in combat/roll-patches.mjs as it applies each bonus. Shadowdark
 * stores the whole config as `flags.shadowdark.rollConfig`
 * (ChatSD.renderRollMessage), so the card reports exactly what the dialog
 * applied — including any promptable bonus the player ticked — with no
 * module-scope stash and no actor/item key matching in between.
 *
 * This replaced a three-stage pipeline whose first stage never ran. That writer
 * was wrapped onto `ItemSD.prototype.rollItem`, a method Shadowdark 4.0.6 does
 * not define; the wrapper's `typeof === "function"` guard therefore never
 * passed, and SD 4.x routes attacks through `rollConfigGenerators` /
 * `rollFromConfig` rather than `rollItem` in any case.
 */

/**
 * Process weapon bonuses for a chat message
 *
 * @param {ChatMessage} message
 * @param {HTMLElement} html the message element, as `renderChatMessageHTML` supplies it
 */
export async function processWeaponBonuses(message, html) {
	// The hit-bonus breakdown rides on the roll config, so it is available for
	// any card the roll dialog produced, independent of the checks below.
	const hitBonusInfo = message.rollConfig?._sdxHitBonusInfo;
	if (hitBonusInfo) {
		injectHitBonusDisplay(html, hitBonusInfo);
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
 *
 * `renderChatMessageHTML` hands v14 handlers a plain DOM element — measured off
 * the live hook, `HTMLLIElement`, with `find` undefined — so this uses DOM APIs
 * throughout. It previously used jQuery and threw `html.find is not a function`
 * on every call, invisibly, because the caller does not await it.
 *
 * @param {HTMLElement} html - The message element
 * @param {{formula: string, result: number|null, parts: {label: string}[]}} hitBonusInfo
 */
function injectHitBonusDisplay(html, hitBonusInfo) {
	if (!hitBonusInfo || hitBonusInfo.result === 0) return;
	if (!html?.querySelector) return;

	// Re-rendering a message re-runs this hook; never stack copies.
	html.querySelectorAll(".sdx-hit-bonus-display").forEach(el => el.remove());

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

	const tooltipAttr = tooltip ? `data-tooltip="${tooltip}"` : "";

	// Show "= N" only for a bonus that is entirely constant. A dice-valued bonus
	// is rolled inside the d20 roll, so no total is known here; showing the
	// formula alone beats printing a wrong number — or `undefined`, which is what
	// the previous writer produced, since it never recorded a result at all.
	const hasResult = Number.isFinite(hitBonusInfo.result);
	const sign = hitBonusInfo.result > 0 ? "+" : "";

	let bonusHtml = `<div class="sdx-hit-bonus-display" ${tooltipAttr}>`;
	bonusHtml += "<span class=\"sdx-hit-bonus-label\">Hit Bonus:</span>";
	bonusHtml += `<span class="sdx-hit-bonus-formula">${hitBonusInfo.formula}</span>`;
	if (hasResult) {
		bonusHtml += "<span class=\"sdx-hit-bonus-equals\">=</span>";
		bonusHtml += `<span class="sdx-hit-bonus-result">${sign}${hitBonusInfo.result}</span>`;
	}
	bonusHtml += "</div>";

	// Insert after the roll result but before any damage section.
	const anchor = html.querySelector(".card-attack-roll") ?? html.querySelector(".dice-roll");
	if (anchor) anchor.insertAdjacentHTML("afterend", bonusHtml);
}

// Duration spell UI/chat leaf — extracted from
// scripts/effects/duration-spell.mjs (Phase 5.3 lane-C split).
// Chat damage-apply button handler + the actor-sheet HTML builder.
// Leaf: imports focus-constants + combat-socket.

import { MODULE_ID } from "./focus-constants.mjs";
import { getSocket } from "../shared/combat-socket.mjs";
import { describeDurationRemaining } from "../shared/duration-basis.mjs";

export async function onDurationDamageApplyClick(event) {
	const btn = event.target.closest(".sdx-duration-apply-btn");
	if (!btn) return;

	event.preventDefault();
	event.stopPropagation();

	// Disable immediately to prevent double-clicks
	if (btn.disabled || btn.classList.contains("sdx-duration-applied")) {
		return; // Already applied
	}
	btn.disabled = true;
	const originalHtml = btn.innerHTML;
	btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Applying...';

	const tokenId = btn.dataset.tokenId;
	const damage = parseInt(btn.dataset.damage);
	const actorName = btn.dataset.actorName;

	if (!tokenId || isNaN(damage)) {
		console.warn("shadowdark-extras | Duration apply button missing tokenId or damage");
		btn.disabled = false;
		btn.innerHTML = originalHtml;
		return;
	}

	try {
		// Only GM can apply damage via socket or directly
		if (!game.user.isGM) {
			// Use socket to ask GM to apply
			const socket = getSocket();
			if (socket) {
				// Use the registered applyTokenDamage handler (CombatSettingsSD).
				// Note: the previous call site used "applyDamage" which was never registered.
				socket.executeAsGM("applyTokenDamage", { tokenId, damage, actorName });
			}
			else {
				ui.notifications.warn("Cannot apply damage - no GM connected.");
				btn.disabled = false;
				btn.innerHTML = originalHtml;
				return;
			}
		}
		else {
			// GM applies directly
			const token = canvas.tokens?.get(tokenId);
			if (!token?.actor) {
				ui.notifications.error("Could not find the target token.");
				btn.disabled = false;
				btn.innerHTML = originalHtml;
				return;
			}

			const currentHp = token.actor.system.attributes.hp.value;
			const newHp = Math.max(0, currentHp - damage);
			await token.actor.update({ "system.attributes.hp.value": newHp });
		}

		// Update the button to show it was applied
		btn.innerHTML = '<i class="fas fa-check"></i> Applied';
		btn.classList.add("sdx-duration-applied");

		// Update the message flags (resolve the message from the enclosing chat card)
		const messageId = btn.closest("[data-message-id]")?.dataset.messageId;
		const message = messageId ? game.messages.get(messageId) : null;
		if (message) await message.setFlag(MODULE_ID, "applied", true);

		ui.notifications.info(`Applied ${damage} damage to ${actorName}`);
	}
	catch(err) {
		console.error("shadowdark-extras | Failed to apply duration damage:", err);
		btn.disabled = false;
		btn.innerHTML = originalHtml;
	}
}

export function buildDurationSpellsHtml(actor, activeDuration) {
	const currentRound = game.combat?.round ?? 0;
	let spellsHtml = "";

	for (const duration of activeDuration) {
		const remaining = describeDurationRemaining(duration, {
			round: currentRound, worldTime: game.time?.worldTime ?? null,
		});
		const targetCount = duration.targets?.length || 0;
		// Use instanceId if available, fallback to spellId
		const spellInstanceId = duration.instanceId || duration.spellId;

		// Build target list HTML with individual remove buttons
		let targetsListHtml = "";
		if (duration.targets && duration.targets.length > 0) {
			for (const target of duration.targets) {
				// Check if this target has effects applied
				const hasEffects = duration.targetEffects?.some(te =>
					te.targetTokenId === target.tokenId || te.targetActorId === target.actorId
				);

				targetsListHtml += `
					<div class="sdx-duration-target" data-token-id="${target.tokenId}" data-actor-id="${target.actorId || ""}">
						<span class="sdx-target-name">
							<i class="fas fa-user"></i> ${target.name}
							${hasEffects ? '<i class="fas fa-magic" title="Has effects applied" style="color: #9b59b6; margin-left: 4px;"></i>' : ""}
						</span>
						<a class="sdx-remove-target" data-action="remove-duration-target"
						   data-instance-id="${spellInstanceId}"
						   data-token-id="${target.tokenId}"
						   data-tooltip="Remove from spell (left area)">
							<i class="fas fa-times" style="color: #ff6666;"></i>
						</a>
					</div>
				`;
			}
		}
		else {
			targetsListHtml = '<div class="sdx-no-targets">No targets</div>';
		}

		spellsHtml += `
			<li class="item sdx-duration-spell" data-instance-id="${spellInstanceId}" data-spell-id="${duration.spellId}">
				<div class="sdx-duration-spell-header">
					<div class="item-image" style="background-image: url(${duration.spellImg})">
						<i class="fas fa-clock"></i>
					</div>
					<div class="sdx-focus-info">
						<span class="sdx-duration-spell-name">${duration.spellName}</span>
					</div>
					<span class="sdx-duration-time" title="Remaining duration">
						${remaining}
					</span>
					<span class="sdx-focus-targets">
						<i class="fas fa-bullseye"></i> ${targetCount}
					</span>
					<div class="actions">
						<a data-action="toggle-duration-targets" data-instance-id="${spellInstanceId}"
						   data-tooltip="Show/hide targets">
							<i class="fas fa-chevron-down"></i>
						</a>
						<a data-action="add-duration-target" data-instance-id="${spellInstanceId}"
						   data-tooltip="Add selected token to spell (entered area)">
							<i class="fas fa-plus" style="color: #2ecc71;"></i>
						</a>
						<a data-action="end-duration" data-instance-id="${spellInstanceId}"
						   data-tooltip="End this spell">
							<i class="fa-solid fa-xmark" style="color: #ff6666;"></i>
						</a>
					</div>
				</div>
				<div class="sdx-duration-targets-list" data-instance-id="${spellInstanceId}" style="display: none;">
					${targetsListHtml}
				</div>
			</li>
		`;
	}

	return `
		<div class="SD-box sdx-duration-spells-section">
			<div class="header">
				<label>
					<i class="fas fa-clock"></i>
					Active Duration Spells
				</label>
			</div>
			<div class="content">
				<ol class="SD-list sdx-duration-spells-list">
					${spellsHtml}
				</ol>
			</div>
		</div>
		<br>
	`;
}

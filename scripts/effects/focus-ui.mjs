// Focus spell UI/chat leaf — extracted from
// scripts/effects/focus-spell.mjs (Phase 5.3 lane-C split).
// Focus-ended chat card, actor-sheet HTML builder, duration display.
// Leaf: no sibling imports.


export async function renderFocusEndedChat(focusEntry, reason) {
	const reasonText = game.i18n.localize(`SHADOWDARK_EXTRAS.focus_tracker.reason_${reason}`);

	let targetList = "";
	if (focusEntry.targetEffects.length > 0) {
		targetList = `<ul>${focusEntry.targetEffects.map(te =>
			`<li>${te.targetName}</li>`
		).join("")}</ul>`;
	}

	return `
		<div class="shadowdark chat-card focus-ended">
			<header class="card-header flexrow">
				<img class="focus-ended-icon" src="${focusEntry.spellImg}" alt="${focusEntry.spellName}"/>
				<div class="focus-ended-header-text">
					<h3>${game.i18n.localize("SHADOWDARK_EXTRAS.focus_tracker.focus_ended")}</h3>
					<p class="spell-name">${focusEntry.spellName}</p>
				</div>
			</header>
			<div class="card-content">
				<p class="reason-text">${reasonText}</p>
				${focusEntry.targetEffects.length > 0 ? `
					<p>${game.i18n.localize("SHADOWDARK_EXTRAS.focus_tracker.effects_removed")}:</p>
					${targetList}
				` : ""}
			</div>
		</div>
	`;
}

export function buildFocusSpellsHtml(actor, activeFocus) {
	let spellsHtml = "";

	for (const focus of activeFocus) {
		// Calculate how long focus has been maintained
		const focusedTime = calculateFocusDuration(focus);

		// Filter out concentration effects (effects on the caster) for display
		const nonConcentrationEffects = focus.targetEffects.filter(
			te => te.targetActorId !== focus.casterId
		);
		const targetCount = nonConcentrationEffects.length;

		// Build target list for tooltip (excluding concentration on caster)
		const targetsList = nonConcentrationEffects.map(te => te.targetName).join(", ")
			|| game.i18n.localize("SHADOWDARK_EXTRAS.focus_tracker.no_targets");

		spellsHtml += `
			<li class="item sdx-focus-spell" data-spell-id="${focus.spellId}">
				<div class="item-image" style="background-image: url(${focus.spellImg})">
					<i class="fa-solid fa-brain"></i>
				</div>
				<div class="sdx-focus-info">
					<span class="sdx-focus-spell-name">${focus.spellName}</span>
				</div>
				<span class="sdx-focus-time" title="${game.i18n.localize("SHADOWDARK_EXTRAS.focus_tracker.time_focused")}">${focusedTime}</span>
				<span class="sdx-focus-targets" title="${targetsList}">
					<i class="fas fa-bullseye"></i> ${targetCount}
				</span>
				<div class="actions">
					<a data-action="focus-roll" data-spell-id="${focus.spellId}"
					   data-tooltip="${game.i18n.localize("SHADOWDARK_EXTRAS.focus_tracker.roll_focus")}">
						<i class="fa-solid fa-brain"></i>
					</a>
					<a data-action="end-focus" data-spell-id="${focus.spellId}"
					   data-tooltip="${game.i18n.localize("SHADOWDARK_EXTRAS.focus_tracker.end_focus")}">
						<i class="fa-solid fa-xmark" style="color: #ff6666;"></i>
					</a>
				</div>
			</li>
		`;
	}

	return `
		<div class="SD-box sdx-focus-spells-section">
			<div class="header">
				<label>
					<i class="fa-solid fa-brain"></i>
					${game.i18n.localize("SHADOWDARK_EXTRAS.focus_tracker.active_focus_spells")}
				</label>
			</div>
			<div class="content">
				<ol class="SD-list sdx-focus-spells-list">
					${spellsHtml}
				</ol>
			</div>
		</div>
		<br>
	`;
}

export function calculateFocusDuration(focus) {
	if (game.combat && focus.startRound !== null) {
		const rounds = game.combat.round - focus.startRound;
		return game.i18n.format("SHADOWDARK_EXTRAS.focus_tracker.rounds", { count: rounds });
	}

	const seconds = game.time.worldTime - focus.startTime;

	if (seconds < 60) {
		return game.i18n.format("SHADOWDARK_EXTRAS.focus_tracker.seconds", { count: seconds });
	}
	else if (seconds < 3600) {
		const minutes = Math.floor(seconds / 60);
		return game.i18n.format("SHADOWDARK_EXTRAS.focus_tracker.minutes", { count: minutes });
	}
	else {
		const hours = Math.floor(seconds / 3600);
		return game.i18n.format("SHADOWDARK_EXTRAS.focus_tracker.hours", { count: hours });
	}
}

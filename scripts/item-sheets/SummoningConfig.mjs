import { FEATURE_IDS, isFeatureEnabled } from "../settings/feature-gates.mjs";

/**
 * Generate the Summoning configuration HTML for use with Portal library
 * @param {string} MODULE_ID - The module identifier
 * @param {object} flags - The summoning flags
 * @param {string} summonsList - HTML for the summons profiles list
 * @param {array} summonProfilesArray - Array of summon profiles
 * @returns {string} HTML string
 */
export function generateSummoningConfigHTML(MODULE_ID, flags, summonsList, summonProfilesArray) {
	if (!isFeatureEnabled(FEATURE_IDS.SPELL_CONFIGS)) return "";
	return `
		<div class="SD-box sdx-summoning-box grid-colspan-3">
			<div class="header light">
				<label class="sdx-section-checkbox">
					<input type="checkbox" name="flags.${MODULE_ID}.summoning.enabled"
					       ${flags.enabled ? "checked" : ""}
					       class="sdx-summoning-toggle" />
					<span>Summonings</span>
				</label>
				<span></span>
			</div>
			<div class="content sdx-summoning-content">
				<div class="SD-grid">
					<!-- Summons Profiles List -->
					<h3 class="sdx-section-title">Summon Profiles</h3>
					<div class="sdx-summons-list">
						${summonsList || ""}
					</div>

					<!-- Add Profile Button -->
					<button type="button" class="sdx-add-summon-btn" data-action="addSummonProfile">
						<i class="fas fa-plus"></i> Add Summon Profile
					</button>

					<!-- Hidden input to store JSON data -->
					<input type="hidden" name="flags.${MODULE_ID}.summoning.profiles" class="sdx-summons-data" value="${foundry.utils.escapeHTML(JSON.stringify(summonProfilesArray))}" />

					<!-- Which profiles to summon when more than one is listed -->
					<div class="sdx-summoning-option" style="margin-top: 8px;">
						<label class="sdx-select-label" style="display: flex; align-items: center; gap: 6px;">
							<span>When several are listed <i class="fas fa-question-circle sdx-help-icon" style="opacity: 0.6; font-size: 0.9em;" title="Summon all: every profile is summoned together (the default).&#10;Ask which one: the caster picks a single creature, for spells that read &quot;a zombie or skeleton&quot;.&#10;Only applies when more than one profile is listed."></i></span>
							<select name="flags.${MODULE_ID}.summoning.creatureSelectionMode">
								<option value="all" ${flags.creatureSelectionMode === "prompt" ? "" : "selected"}>Summon all</option>
								<option value="prompt" ${flags.creatureSelectionMode === "prompt" ? "selected" : ""}>Ask which one</option>
							</select>
						</label>
					</div>

					<!-- Delete at expiry option -->
					<div class="sdx-summoning-option" style="margin-top: 8px;">
						<label class="sdx-checkbox-label" style="display: flex; align-items: center; gap: 6px;">
							<input type="checkbox" name="flags.${MODULE_ID}.summoning.deleteAtExpiry"
							       ${flags.deleteAtExpiry ? "checked" : ""} />
							<span>Delete at expiry <i class="fas fa-question-circle sdx-help-icon" style="opacity: 0.6; font-size: 0.9em;" title="Automatically delete summoned tokens when the spell duration expires.&#10;Only works during combat with round/turn-based durations."></i></span>
						</label>
					</div>
				</div>
			</div>
		</div>
	`;
}

/**
 * Generate HTML for a single summon profile
 * @param {object} profile - The summon profile data
 * @param {number} index - Index of the profile
 * @returns {string} HTML string
 */
export function generateSummonProfileHTML(profile, index) {
	const truncatedName = (profile.creatureName || "Unknown").length > 8
		? `${(profile.creatureName || "Unknown").substring(0, 8)}…`
		: (profile.creatureName || "Unknown");

	// Every field here comes from a dropped actor or from GM-typed text, and each
	// lands in an attribute. Truncate first, then escape — escaping first would
	// let substring(0, 8) cut an entity in half.
	const escapedName = foundry.utils.escapeHTML(profile.creatureName || "Unknown");
	const escapedAltName = foundry.utils.escapeHTML(profile.creatureName || "Creature");
	const escapedTruncatedName = foundry.utils.escapeHTML(truncatedName);
	const escapedImg = foundry.utils.escapeHTML(profile.creatureImg || "icons/svg/mystery-man.svg");
	const escapedUuid = foundry.utils.escapeHTML(profile.creatureUuid || "");
	const escapedRawName = foundry.utils.escapeHTML(profile.creatureName || "");
	const escapedRawImg = foundry.utils.escapeHTML(profile.creatureImg || "");
	const escapedCount = foundry.utils.escapeHTML(profile.count || "1");
	const escapedDisplayName = foundry.utils.escapeHTML(profile.displayName || "");

	return `
		<div class="sdx-summon-profile" data-index="${index}">
			<div class="sdx-profile-grid">
				<!-- Creature Drop Zone -->
				<div class="sdx-summon-creature-drop">
					${profile.creatureUuid ? `
						<div class="sdx-summon-creature-display" data-uuid="${escapedUuid}" title="${escapedName}">
							<img src="${escapedImg}" alt="${escapedAltName}" />
							<span>${escapedTruncatedName}</span>
						</div>
					` : `
						<span><i class="fas fa-crosshairs"></i> Drop creature here</span>
					`}
				</div>
				<input type="hidden" class="sdx-creature-uuid" value="${escapedUuid}" />
				<input type="hidden" class="sdx-creature-name" value="${escapedRawName}" />
				<input type="hidden" class="sdx-creature-img" value="${escapedRawImg}" />

				<!-- Count Formula -->
				<div class="sdx-profile-field">
					<label>Count</label>
					<input type="text" class="sdx-summon-count" value="${escapedCount}"
					       placeholder="1, 1d4, etc."
					       title="Number of creatures to summon. Can be a number or dice formula (e.g., 1d4, 2d6)." />
				</div>

				<!-- Display Name -->
				<div class="sdx-profile-field">
					<label>Display Name</label>
					<input type="text" class="sdx-summon-display-name" value="${escapedDisplayName}"
					       placeholder="Optional custom name" />
				</div>

				<!-- Remove Button -->
				<button type="button" class="sdx-remove-summon-btn" data-index="${index}"
				        data-action="removeSummonProfile" title="Remove this summon profile">
					<i class="fas fa-times"></i>
				</button>
			</div>
		</div>
	`;
}

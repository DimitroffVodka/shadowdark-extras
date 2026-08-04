import { MODULE_ID } from "../shared/module-id.mjs";

/**
 * Active Effect configuration sheet behaviour.
 *
 * Extracted from the composition root in Phase 3. Both registrations were
 * verified before the move to be:
 *   - self-contained: they call no top-level helper of the root and touch no
 *     module-scope state, so nothing shared could be split in two;
 *   - the ONLY registration of their hook name in the root, so their position
 *     relative to other registrations cannot affect firing order. Hooks that
 *     the root registers more than once (updateActiveEffect and
 *     deleteActiveEffect, three each) were deliberately left behind: same-name
 *     handlers fire in registration order, so those can only move as a set.
 */

/**
 * Register the Active Effect config hooks. The composition root calls this at
 * the source position the first registration occupied.
 */
export function registerActiveEffectConfigHooks() {
	/**
	 * Hook to add Source Requirement field to Active Effect config
	 */
	Hooks.on("renderActiveEffectConfig", (app, html, data) => {
		// Try multiple ways to get the effect - app.object might be undefined for new effects
		const effect = app.object || app.document || data.effect;

		// Guard: ensure effect exists
		if (!effect) {
			console.warn(`${MODULE_ID} | renderActiveEffectConfig: Could not find effect document`);
			return;
		}

		const currentRequirement = effect.getFlag?.(MODULE_ID, "sourceRequirement") || "";
		// Escape HTML entities for safe insertion into HTML attribute
		const escapedRequirement = currentRequirement.replace(/"/g, "&quot;").replace(/'/g, "&#39;");

		// Get the requireEquipped flag
		const requireEquipped = effect.getFlag?.(MODULE_ID, "requireEquipped") || false;

		// Ensure html is a jQuery object
		const $html = html instanceof jQuery ? html : $(html);

		// Find the Status Conditions section - it's a div.form-group.statuses
		const statusConditions = $html.find(".form-group.statuses");

		// Build the HTML for the require equipped checkbox
		const requireEquippedHtml = `
			<div class="form-group sdx-require-equipped">
				<label>Must be Equipped</label>
				<input type="checkbox" name="flags.${MODULE_ID}.requireEquipped" ${requireEquipped ? "checked" : ""}/>
				<p class="hint">If checked, this Effect will be applied to any Actor that owns this Effect's parent Item only if the Item is equipped.</p>
			</div>
		`;

		// Build the HTML for the source requirement field
		const fieldHtml = `
			<div class="form-group sdx-source-requirement">
				<label>${game.i18n.localize("SHADOWDARK_EXTRAS.effects.sourceRequirement")}</label>
				<div class="form-fields">
					<input type="text" name="flags.${MODULE_ID}.sourceRequirement" value="${escapedRequirement}"
						placeholder="e.g., level > 3"
						title="${game.i18n.localize("SHADOWDARK_EXTRAS.effects.sourceRequirementHint")}"/>
				</div>
				<p class="hint">${game.i18n.localize("SHADOWDARK_EXTRAS.effects.sourceRequirementHint")}</p>
				<details class="sdx-requirement-examples">
					<summary><i class="fas fa-info-circle"></i> Valid Requirement Examples</summary>
					<div class="examples-content">
						<p><strong>Level Requirements:</strong></p>
						<ul>
							<li><code>level > 3</code> - Character level greater than 3</li>
							<li><code>level >= 5</code> - Character level 5 or higher</li>
							<li><code>level === 1</code> - Exactly level 1</li>
						</ul>

						<p><strong>Hit Points Requirements:</strong></p>
						<ul>
							<li><code>actor.system.attributes.hp.value > 10</code> - Current HP greater than 10</li>
							<li><code>actor.system.attributes.hp.value >= actor.system.attributes.hp.max / 2</code> - At least half HP</li>
							<li><code>actor.system.attributes.hp.value < 5</code> - Bloodied (less than 5 HP)</li>
							<li><code>actor.system.attributes.hp.max >= 20</code> - Maximum HP 20 or higher</li>
						</ul>

						<p><strong>Attribute Requirements:</strong></p>
						<ul>
							<li><code>attributes.str.value >= 14</code> - Strength 14 or higher</li>
							<li><code>attributes.dex.value > 12</code> - Dexterity greater than 12</li>
							<li><code>attributes.con.value >= 16</code> - Constitution 16 or higher</li>
						</ul>

						<p><strong>Ability Modifier Requirements:</strong></p>
						<ul>
							<li><code>abilities.str.mod >= 2</code> - Strength modifier +2 or higher</li>
							<li><code>abilities.dex.mod > 0</code> - Positive Dexterity modifier</li>
							<li><code>abilities.int.mod >= 3</code> - Intelligence modifier +3 or higher</li>
						</ul>

						<p><strong>Ancestry Requirements:</strong></p>
						<ul>
							<li><code>ancestry === "elf"</code> - Is an elf</li>
							<li><code>ancestry === "dwarf"</code> - Is a dwarf</li>
							<li><code>ancestry === "halfling"</code> - Is a halfling</li>
							<li><code>ancestry === "human"</code> - Is a human</li>
							<li><code>ancestry.includes("goblin")</code> - Name includes "goblin" (for variations)</li>
						</ul>

						<p><strong>Class Requirements:</strong></p>
						<ul>
							<li><code>charClass === "fighter"</code> - Is a fighter</li>
							<li><code>charClass === "wizard"</code> - Is a wizard</li>
							<li><code>charClass === "cleric"</code> - Is a cleric</li>
							<li><code>charClass === "thief"</code> - Is a thief</li>
							<li><code>charClass.includes("ranger")</code> - Class name includes "ranger" (for variations)</li>
						</ul>

						<p><strong>Background Requirements:</strong></p>
						<ul>
							<li><code>background === "urchin"</code> - Urchin background</li>
							<li><code>background === "merchant"</code> - Merchant background</li>
							<li><code>background.includes("soldier")</code> - Background includes "soldier"</li>
						</ul>

						<p><strong>Alignment Requirements:</strong></p>
						<ul>
							<li><code>alignment === "lawful"</code> - Lawful alignment</li>
							<li><code>alignment === "neutral"</code> - Neutral alignment</li>
							<li><code>alignment === "chaotic"</code> - Chaotic alignment</li>
						</ul>

						<p><strong>Item Ownership Requirements:</strong></p>
						<ul>
							<li><code>actor.items.some(i => i.name === "Sword of Light")</code> - Has "Sword of Light"</li>
							<li><code>actor.items.some(i => i.name.includes("Sword"))</code> - Has any item with "Sword" in name</li>
							<li><code>actor.items.some(i => i.type === "Weapon" && i.name.includes("Magic"))</code> - Has magic weapon</li>
							<li><code>actor.items.some(i => i.type === "Armor" && i.system.equipped)</code> - Has equipped armor</li>
							<li><code>actor.items.filter(i => i.type === "Spell").length >= 3</code> - Has 3 or more spells</li>
						</ul>

						<p><strong>Combined Requirements (AND/OR):</strong></p>
						<ul>
							<li><code>level >= 5 && abilities.str.mod >= 2</code> - Level 5+ AND Str +2+</li>
							<li><code>attributes.str.value >= 16 || attributes.dex.value >= 16</code> - Str 16+ OR Dex 16+</li>
							<li><code>level > 3 && charClass === "wizard"</code> - Level 3+ wizard</li>
							<li><code>actor.items.some(i => i.name === "Holy Symbol") && charClass === "cleric"</code> - Cleric with holy symbol</li>
							<li><code>ancestry === "elf" && abilities.int.mod > 0</code> - Elf with positive Int modifier</li>
							<li><code>alignment === "lawful" && charClass === "cleric"</code> - Lawful cleric</li>
						</ul>

						<p><strong>Token Requirements (if token exists):</strong></p>
						<ul>
							<li><code>token?.elevation > 0</code> - Token is elevated</li>
							<li><code>token?.disposition === 1</code> - Friendly token</li>
						</ul>

						<p class="notes"><strong>Available Variables:</strong> <code>actor</code>, <code>token</code>, <code>level</code>, <code>attributes</code>, <code>abilities</code>, <code>ancestry</code>, <code>charClass</code>, <code>background</code>, <code>alignment</code><br><br><strong>Note:</strong> <code>ancestry</code>, <code>charClass</code>, <code>background</code>, and <code>alignment</code> are automatically resolved from Compendium UUIDs to lowercase names (e.g., "wizard", "elf", "chaotic").</p>
					</div>
				</details>
			</div>
		`;

		// Insert after Status Conditions if found, otherwise at the end of the details tab
		if (statusConditions.length > 0) {
			statusConditions.after(requireEquippedHtml + fieldHtml);
		}
		else {
			// Fallback: insert at the end of the details tab
			const detailsTab = $html.find('section[data-tab="details"]');
			if (detailsTab.length > 0) {
				detailsTab.append(requireEquippedHtml + fieldHtml);
			}
		}

		// Intercept form submission to save the source requirement
		const form = $html.closest("form");
		if (form.length > 0) {
			// Store the original submit method

			form.on("submit", async event => {
				// Get the requirement value
				const requirementInput = $html.find(`input[name="flags.${MODULE_ID}.sourceRequirement"]`);
				if (requirementInput.length > 0) {
					const newRequirement = requirementInput.val()?.trim() || "";

					// Store it in a temp variable on the effect to be picked up by preUpdate hook
					effect._pendingSourceRequirement = newRequirement;
				}

				// Get the requireEquipped checkbox value
				const requireEquippedInput = $html.find(`input[name="flags.${MODULE_ID}.requireEquipped"]`);
				if (requireEquippedInput.length > 0) {
					const newRequireEquipped = requireEquippedInput.is(":checked");

					// Store it in a temp variable on the effect to be picked up by preUpdate hook
					effect._pendingRequireEquipped = newRequireEquipped;
				}
			});
		}

		// Adjust app height to accommodate new field
		app.setPosition({ height: "auto" });
	});

	/**
	 * Hook to save the source requirement when effect is updated
	 */
	Hooks.on("preUpdateActiveEffect", (effect, changes, options, userId) => {

		// Check if there's a pending source requirement from the form
		if (effect._pendingSourceRequirement !== undefined) {

			// Merge the requirement into the changes
			if (!changes.flags) changes.flags = {};
			if (!changes.flags[MODULE_ID]) changes.flags[MODULE_ID] = {};
			changes.flags[MODULE_ID].sourceRequirement = effect._pendingSourceRequirement;

			// Clean up the temp variable
			delete effect._pendingSourceRequirement;

		}

		// Check if there's a pending requireEquipped from the form
		if (effect._pendingRequireEquipped !== undefined) {

			// Merge the requireEquipped into the changes
			if (!changes.flags) changes.flags = {};
			if (!changes.flags[MODULE_ID]) changes.flags[MODULE_ID] = {};
			changes.flags[MODULE_ID].requireEquipped = effect._pendingRequireEquipped;

			// Clean up the temp variable
			delete effect._pendingRequireEquipped;

		}

		// Check if there's a flags update with our source requirement
		if (changes.flags?.[MODULE_ID]?.sourceRequirement !== undefined) {
			// no immediate action; evaluated by the requirement engine
		}

		// Check if there's a flags update with our requireEquipped
		if (changes.flags?.[MODULE_ID]?.requireEquipped !== undefined) {
			// no immediate action; evaluated by the requirement engine
		}
	});
}

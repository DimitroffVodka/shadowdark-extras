import { MODULE_ID } from "../shared/module-id.mjs";
import { generateSpellConfig } from "./ItemTypeConfigs.mjs";
import { activateTemplateTargetingListeners } from "./TemplateTargetingConfig.mjs";
import {
	activateTemplateTokenMagicStackHandlers,
	setupActivityRadioToggles,
	activateAnimationFxListeners,
} from "./activity-tab-widgets.mjs";

// v13+ FilePicker namespaced under foundry.applications.apps.
const FilePicker = foundry.applications.apps.FilePicker?.implementation ?? globalThis.FilePicker;

/**
 * Spell item sheet enhancement.
 *
 * Extracted from the composition root in Phase 3, verbatim. Two injections that
 * the root's single `renderItemSheet` dispatch calls back to back, each in its
 * own try/catch:
 *
 *   - `enhanceSpellSheet` builds the whole Activity tab — damage/heal,
 *     conditions, summoning, item-give, targeting, template and Animation FX —
 *     then hands the rendered markup to the shared Activity-tab widget wiring.
 *   - `injectSpellAlignmentField` adds the alignment select on the Details tab.
 *
 * This is the jQuery `ItemSheetSD` path. Spells, Scrolls and Wands render
 * through it; Potions do NOT — they use SDX's own `PotionSheetSD` (AppV2), so
 * `enhancePotionSheet` never fires for them in a world where that sheet is
 * registered. Check `item.sheet.constructor.name` before reading an empty sheet
 * as a regression.
 *
 * The `SummoningConfig` / `ItemGiveConfig` imports stay dynamic, as they were in
 * the root; only their paths changed, since `./item-sheets/X` was relative to
 * the root and this module already lives in that folder.
 */
/**
 * Inject alignment select field into spell item sheets
 */
export function injectSpellAlignmentField(app, html) {
	// Only for Spell items
	const item = app.item;
	if (!item || item.type !== "Spell") return;

	// Check if already injected
	if (html.find(".sdx-spell-alignment-select").length > 0) return;

	// Find the Caster Classes box by looking for the header with "Caster Classes" text
	const $casterClassesBox = html.find(".SD-box").filter(function() {
		const headerText = $(this).find(".header label").text().trim();
		return headerText === "Caster Classes";
	});

	if (!$casterClassesBox.length) {
		//console.log(`${MODULE_ID} | Could not find Caster Classes box in spell sheet`);
		return;
	}

	// Get current alignment from flags
	const currentAlignment = item.getFlag(MODULE_ID, "alignment") || "";

	// Build alignment options using Shadowdark's config
	const alignments = CONFIG.SHADOWDARK.ALIGNMENTS || {
		lawful: "SHADOWDARK.alignment.lawful",
		neutral: "SHADOWDARK.alignment.neutral",
		chaotic: "SHADOWDARK.alignment.chaotic",
	};

	const optionsHtml = Object.entries(alignments).map(([key, label]) => {
		const localizedLabel = game.i18n.localize(label);
		return `<option value="${key}" ${currentAlignment === key ? "selected" : ""}>${localizedLabel}</option>`;
	}).join("");

	// Create the alignment field HTML matching the existing style
	const alignmentHtml = `
		<h3>Alignment</h3>
		<select class="sdx-spell-alignment-select" name="flags.${MODULE_ID}.alignment">
			<option value="">—</option>
			${optionsHtml}
		</select>
	`;

	// Find the content area of the Caster Classes box
	const $content = $casterClassesBox.find(".content");
	if ($content.length) {
		// Find the grid-1-columns div and append to it
		const $grid = $content.find(".grid-1-columns");
		if ($grid.length) {
			// Append to the grid
			$grid.append(alignmentHtml);
		}
		else {
			// Fallback: append directly to content
			$content.append(alignmentHtml);
		}
	}
	else {
		//console.log(`${MODULE_ID} | Could not find content area in Caster Classes box`);
		return;
	}

	// Handle change event
	html.find(".sdx-spell-alignment-select").on("change", async function(e) {
		e.stopPropagation();
		const newAlignment = $(this).val();
		await item.setFlag(MODULE_ID, "alignment", newAlignment);
		//console.log(`${MODULE_ID} | Set spell alignment to: ${newAlignment}`);
	});

	//console.log(`${MODULE_ID} | Injected alignment field for spell: ${item.name}`);
}

/**
 * Enhance spell item sheets with damage/heal configuration
 */
export async function enhanceSpellSheet(app, html) {
	// Check if spell enhancement is enabled
	try {
		if (!game.settings.get(MODULE_ID, "enhanceSpells")) return;
	}
	catch {
		return;
	}

	// Only enhance Spell items
	const item = app.item;
	if (!item || item.type !== "Spell") return;

	//console.log(`${MODULE_ID} | Enhancing spell sheet for`, item.name);

	// Remove any existing damage/heal boxes to prevent duplicates
	html.find(".sdx-spell-damage-box").remove();

	// Initialize flags if they don't exist
	const spellDamageFlags = item.flags?.[MODULE_ID]?.spellDamage || {
		enabled: false,
		isDamage: true, // true = damage, false = heal
		numDice: 1,
		dieType: "d6",
		bonus: 0,
		damageType: "",
		scaling: "every-level", // "none", "every-level", "every-other-level"
		scalingDice: 1,
		formula: "",
		damageRequirement: "", // Formula that must evaluate to true for damage to apply
		damageRequirementFailAction: "zero", // "zero" or "half" - what to do when requirement fails
		effectsRequirement: "", // Formula that must evaluate to true for effects to apply
		effects: [], // Array of effect document UUIDs
		applyToTarget: true, // true = apply damage/heal to target, false = apply to self
		effectsApplyToTarget: true, // true = apply effects to target, false = apply to self
	};

	// Initialize summoning flags
	const summoningFlags = item.flags?.[MODULE_ID]?.summoning || {
		enabled: false,
		profiles: [],
	};

	// Initialize item give flags
	const itemGiveFlags = item.flags?.[MODULE_ID]?.itemGive || {
		enabled: false,
		profiles: [],
	};

	// Initialize item macro flags
	const itemMacroFlags = item.flags?.[MODULE_ID]?.itemMacro || {
		runAsGm: false,
		triggers: [],
	};

	// Initialize targeting flags
	const targetingFlags = item.flags?.[MODULE_ID]?.targeting || {
		mode: "targeted",
		template: {
			type: "circle",
			size: 30,
			placement: "choose",
			fillColor: "#4e9a06",
			deleteMode: "none",
			deleteDuration: 3,
			hideOutline: false,
		},
	};

	// Initialize template effects flags
	const templateEffectsFlags = item.flags?.[MODULE_ID]?.templateEffects || {
		enabled: false,
		triggers: {
			onEnter: false,
			onTurnStart: false,
			onTurnEnd: false,
			onLeave: false,
		},
		damage: {
			formula: "",
			type: "",
		},
		save: {
			enabled: false,
			dc: 12,
			ability: "dex",
			halfOnSuccess: true,
		},
		applyConfiguredEffects: false,
	};

	// Initialize aura effects flags
	const auraEffectsFlags = item.flags?.[MODULE_ID]?.auraEffects || {
		enabled: false,
		attachTo: "caster",
		radius: 30,
		triggers: {
			onEnter: false,
			onLeave: false,
			onSourceTurnStart: false,
			onSourceTurnEnd: false,
			onTargetTurnStart: false,
			onTargetTurnEnd: false,
		},
		damage: { formula: "", type: "" },
		damageTriggers: { onEnter: false, onLeave: false, onSourceTurnStart: false, onSourceTurnEnd: false, onTargetTurnStart: false, onTargetTurnEnd: false },
		save: { enabled: false, dc: 12, ability: "con", halfOnSave: false },
		animation: { enabled: true, style: "circle", tint: "#4488ff", opacity: 0.6, scaleMultiplier: 1.0 },
		tokenFilters: { enabled: false, preset: "" },
		disposition: "all",
		includeSelf: false,
		includeAuraBearer: false,
		applyToOriginator: true,
		checkVisibility: false,
		applyConfiguredEffects: false,
		effectsTriggers: { onEnter: false, onLeave: false, onSourceTurnStart: false, onSourceTurnEnd: false, onTargetTurnStart: false, onTargetTurnEnd: false },
		runItemMacro: false,
		macroTriggers: { onEnter: false, onLeave: false, onSourceTurnStart: false, onSourceTurnEnd: false, onTargetTurnStart: false, onTargetTurnEnd: false },
	};

	// Combine all flags for template
	const flags = {
		...spellDamageFlags,
		macroCommand: item.getFlag(MODULE_ID, "macroCommand") ?? item.flags?.itemacro?.macro?.command,
		animationFx: item.flags?.[MODULE_ID]?.animationFx,
		summoning: summoningFlags,
		itemGive: itemGiveFlags,
		itemMacro: itemMacroFlags,
		targeting: targetingFlags,
		templateEffects: templateEffectsFlags,
		auraEffects: auraEffectsFlags,
	};

	// Convert applyToTarget to boolean (in case it was stored as string)
	const applyToTarget = spellDamageFlags.applyToTarget === "false" ? false : (spellDamageFlags.applyToTarget === false ? false : true);
	const effectsApplyToTarget = spellDamageFlags.effectsApplyToTarget === "false" ? false : (spellDamageFlags.effectsApplyToTarget === false ? false : true);

	// Preserve active tab across re-renders
	if (!app._shadowdarkExtrasActiveTab) {
		app._shadowdarkExtrasActiveTab = "tab-details"; // Default to details
	}

	// Check which tab is currently active
	const $currentActiveTab = html.find("nav.SD-nav a.navigation-tab.active");
	if ($currentActiveTab.length) {
		const currentTab = $currentActiveTab.data("tab");
		if (currentTab) {
			app._shadowdarkExtrasActiveTab = currentTab;
		}
	}

	// Create a new "Activity" tab after Details tab
	const $tabs = html.find("nav.SD-nav");

	// Check if Activity tab already exists
	if (!html.find('section[data-tab="tab-activity"]').length) {
		// Add Activity tab to navigation (after Details)
		const activityTabLink = "<a class=\"navigation-tab\" data-tab=\"tab-activity\">Activity</a>";
		const $detailsLink = $tabs.find('a[data-tab="tab-details"]');
		if ($detailsLink.length) {
			$detailsLink.after(activityTabLink);
			//console.log(`${MODULE_ID} | Activity tab link added to navigation`);
		}
		else {
			console.warn(`${MODULE_ID} | Could not find Details tab link`);
		}

		// Create Activity tab content container with correct structure
		const activityTabContent = "<section class=\"tab tab-activity\" data-group=\"primary\" data-tab=\"tab-activity\"></section>";
		const $detailsTab = html.find('section.tab-details[data-tab="tab-details"]');
		if ($detailsTab.length) {
			$detailsTab.after(activityTabContent);
			//console.log(`${MODULE_ID} | Activity tab content created`);
		}
		else {
			console.warn(`${MODULE_ID} | Could not find Details tab content`);
		}

		// Add click handler to track tab changes
		$tabs.find("a.navigation-tab").on("click", function() {
			const tabName = $(this).data("tab");
			if (tabName) {
				app._shadowdarkExtrasActiveTab = tabName;
			}
		});
	}

	// Restore the previously active tab
	setTimeout(() => {
		const $targetTab = $tabs.find(`a.navigation-tab[data-tab="${app._shadowdarkExtrasActiveTab}"]`);
		const $targetSection = html.find(`section[data-tab="${app._shadowdarkExtrasActiveTab}"]`);

		if ($targetTab.length && $targetSection.length) {
			// Remove active class from all tabs
			$tabs.find("a.navigation-tab").removeClass("active");
			html.find('section[data-group="primary"]').removeClass("active");

			// Add active class to target tab
			$targetTab.addClass("active");
			$targetSection.addClass("active");
		}
	}, 0);

	// Find the Activity tab content
	const $activityTab = html.find('section.tab-activity[data-tab="tab-activity"]');
	if (!$activityTab.length) {
		console.warn(`${MODULE_ID} | Activity tab not found in spell sheet`);
		return;
	}

	//console.log(`${MODULE_ID} | Activity tab found/created`);

	// Build list of current effects from stored UUIDs
	let effectsListHtml = "";

	// Handle case where effects might be a string instead of an array (from form submission)
	let effectsArray = flags.effects || [];
	if (typeof effectsArray === "string") {
		try {
			effectsArray = JSON.parse(effectsArray);
		}
		catch (err) {
			console.warn(`${MODULE_ID} | Could not parse effects string:`, effectsArray, err);
			effectsArray = [];
		}
	}

	// Normalize effects array - convert old UUID strings to new object format
	effectsArray = effectsArray.map(effect => {
		if (typeof effect === "string") {
			return { uuid: effect, duration: {} };
		}
		return effect;
	});

	if (effectsArray && effectsArray.length > 0) {
		//console.log(`${MODULE_ID} | Loading ${effectsArray.length} effects from UUIDs:`, effectsArray);

		// Load all effects in parallel and wait for them all
		const effectPromises = effectsArray.map(effect => fromUuid(effect.uuid || effect));
		const effectDocs = await Promise.all(effectPromises);

		for (let i = 0; i < effectDocs.length; i++) {
			const doc = effectDocs[i];
			const effectData = effectsArray[i];
			const uuid = effectData.uuid || effectData;
			const duration = effectData.duration || {};

			if (doc) {
				effectsListHtml += `
					<div class="sdx-spell-effect-item" data-uuid="${uuid}" data-effect-index="${i}">
						<div class="sdx-effect-header">
							<img src="${doc.img || "icons/svg/mystery-man.svg"}" alt="${doc.name}" />
							<span class="sdx-effect-name">${doc.name}</span>
							<a class="sdx-remove-effect" data-tooltip="Remove"><i class="fas fa-times"></i></a>
						</div>
						<div class="sdx-effect-duration-override">
							<div class="sdx-duration-row">
								<div class="sdx-duration-field">
									<label>Seconds</label>
									<input type="number" class="sdx-duration-input" data-field="seconds" value="${duration.seconds || ""}" placeholder="Default" />
								</div>
								<div class="sdx-duration-field">
									<label>Start Time</label>
									<input type="number" class="sdx-duration-input" data-field="startTime" value="${duration.startTime || ""}" placeholder="Default" />
								</div>
							</div>
							<div class="sdx-duration-row">
								<div class="sdx-duration-field">
									<label>Rounds</label>
									<input type="number" class="sdx-duration-input" data-field="rounds" value="${duration.rounds || ""}" placeholder="Default" />
								</div>
								<div class="sdx-duration-field">
									<label>Turns</label>
									<input type="number" class="sdx-duration-input" data-field="turns" value="${duration.turns || ""}" placeholder="Default" />
								</div>
							</div>
							<div class="sdx-duration-row">
								<div class="sdx-duration-field">
									<label>Start Round</label>
									<input type="number" class="sdx-duration-input" data-field="startRound" value="${duration.startRound || ""}" placeholder="Default" />
								</div>
								<div class="sdx-duration-field">
									<label>Start Turn</label>
									<input type="number" class="sdx-duration-input" data-field="startTurn" value="${duration.startTurn || ""}" placeholder="Default" />
								</div>
							</div>
						</div>
					</div>
				`;
			}
			else {
				console.warn(`${MODULE_ID} | Could not load effect from UUID:`, uuid);
			}
		}

		//console.log(`${MODULE_ID} | Loaded effects HTML, length:`, effectsListHtml.length);
	}

	// Build summons list HTML
	let summonsList = "";
	let summonProfilesArray = summoningFlags.profiles || [];

	// Handle case where profiles might be a string
	if (typeof summonProfilesArray === "string") {
		try {
			summonProfilesArray = JSON.parse(summonProfilesArray);
		}
		catch (err) {
			console.warn(`${MODULE_ID} | Could not parse summon profiles string:`, summonProfilesArray, err);
			summonProfilesArray = [];
		}
	}

	if (summonProfilesArray && summonProfilesArray.length > 0) {
		const { generateSummonProfileHTML } = await import("./SummoningConfig.mjs");
		for (let i = 0; i < summonProfilesArray.length; i++) {
			const profile = summonProfilesArray[i];
			summonsList += generateSummonProfileHTML(profile, i);
		}
	}

	let itemGiveList = "";
	let itemGiveProfilesArray = itemGiveFlags.profiles || [];

	if (typeof itemGiveProfilesArray === "string") {
		try {
			itemGiveProfilesArray = JSON.parse(itemGiveProfilesArray);
		}
		catch (err) {
			console.warn(`${MODULE_ID} | Could not parse item give profiles string:`, itemGiveProfilesArray, err);
			itemGiveProfilesArray = [];
		}
	}

	if (itemGiveProfilesArray && itemGiveProfilesArray.length > 0) {
		const { generateItemGiveProfileHTML } = await import("./ItemGiveConfig.mjs");
		for (let i = 0; i < itemGiveProfilesArray.length; i++) {
			const profile = itemGiveProfilesArray[i];
			itemGiveList += generateItemGiveProfileHTML(profile, i);
		}
	}

	// Build list of current critical effects from stored UUIDs
	let criticalEffectsListHtml = "";

	// Handle case where critical effects might be a string instead of an array
	let criticalEffectsArray = flags.criticalEffects || [];
	if (typeof criticalEffectsArray === "string") {
		try {
			criticalEffectsArray = JSON.parse(criticalEffectsArray);
		}
		catch (err) {
			console.warn(`${MODULE_ID} | Could not parse critical effects string:`, criticalEffectsArray, err);
			criticalEffectsArray = [];
		}
	}

	// Normalize critical effects array
	criticalEffectsArray = criticalEffectsArray.map(effect => {
		if (typeof effect === "string") {
			return { uuid: effect, duration: {} };
		}
		return effect;
	});

	if (criticalEffectsArray && criticalEffectsArray.length > 0) {
		//console.log(`${MODULE_ID} | Loading ${criticalEffectsArray.length} critical effects from UUIDs:`, criticalEffectsArray);

		const critEffectPromises = criticalEffectsArray.map(effect => fromUuid(effect.uuid || effect));
		const critEffectDocs = await Promise.all(critEffectPromises);

		for (let i = 0; i < critEffectDocs.length; i++) {
			const doc = critEffectDocs[i];
			const effectData = criticalEffectsArray[i];
			const uuid = effectData.uuid || effectData;
			const duration = effectData.duration || {};

			if (doc) {
				criticalEffectsListHtml += `
					<div class="sdx-spell-effect-item sdx-critical-effect-item" data-uuid="${uuid}" data-effect-index="${i}">
						<div class="sdx-effect-header">
							<img src="${doc.img || "icons/svg/mystery-man.svg"}" alt="${doc.name}" />
							<span class="sdx-effect-name">${doc.name}</span>
							<a class="sdx-remove-critical-effect" data-tooltip="Remove"><i class="fas fa-times"></i></a>
						</div>
					</div>
				`;
			}
			else {
				console.warn(`${MODULE_ID} | Could not load critical effect from UUID:`, uuid);
			}
		}

		//console.log(`${MODULE_ID} | Loaded critical effects HTML, length:`, criticalEffectsListHtml.length);
	}

	// Build the damage/heal UI HTML using template (now includes summoning)
	const damageHealHtml = generateSpellConfig(MODULE_ID, flags, effectsListHtml, effectsArray, effectsApplyToTarget, summonsList, summonProfilesArray, itemGiveList, itemGiveProfilesArray, criticalEffectsListHtml, criticalEffectsArray, item);

	// Insert into Activity tab
	$activityTab.append(damageHealHtml);
	//console.log(`${MODULE_ID} | Damage/Heal box inserted into Activity tab`);

	// Prevent auto-submission of form inputs in Activity tab to avoid unwanted re-renders
	$activityTab.find("input:not(.sdx-duration-input), select, textarea").on("change", function(e) {
		// Skip Item Macro inputs - they have their own handlers
		if ($(this).hasClass("sdx-spell-macro-run-as-gm") ||
			$(this).hasClass("sdx-spell-macro-trigger-checkbox")) {
			return; // Let the event propagate to the Item Macro handlers
		}

		e.stopPropagation(); // Prevent event from bubbling up to form auto-submit
		e.preventDefault(); // Prevent default form submission

		// Manually update the item without re-rendering
		const fieldName = $(this).attr("name");
		if (fieldName) {
			let value = $(this).val();

			// Handle checkboxes
			if ($(this).attr("type") === "checkbox") {
				value = $(this).is(":checked");
			}
			// Handle radio buttons
			else if ($(this).attr("type") === "radio" && !$(this).is(":checked")) {
				return; // Don't update for unchecked radios
			}
			// Handle number inputs
			else if ($(this).attr("type") === "number") {
				value = parseFloat(value) || 0;
			}

			const updateData = {};
			updateData[fieldName] = value;

			// Update without re-rendering
			item.update(updateData, { render: false }).then(() => {
				//console.log(`${MODULE_ID} | Updated ${fieldName}:`, value);
			}).catch(err => {
				console.error(`${MODULE_ID} | Failed to update ${fieldName}:`, err);
			});
		}
	});

	// Attach toggle listener
	html.find(".sdx-spell-damage-toggle").on("change", function() {
		const $content = $(this).closest(".sdx-spell-damage-box").find(".sdx-spell-damage-content");
		if ($(this).is(":checked")) {
			$content.slideDown(200);
		}
		else {
			$content.slideUp(200);
		}
	});

	// Targeting mode toggle listener - show/hide template settings
	html.find(".sdx-targeting-mode-radio").on("change", function() {
		const $templateSettings = $(this).closest(".sdx-targeting-content").find(".sdx-template-settings");
		if ($(this).val() === "template") {
			$templateSettings.slideDown(200);
		}
		else {
			$templateSettings.slideUp(200);
		}
	});

	// Delete mode toggle listener - enable/disable duration input
	html.find(".sdx-delete-mode-radio").on("change", function() {
		const $container = $(this).closest(".sdx-delete-options");
		$container.find(".sdx-duration-input").prop("disabled", true);
		$(this).siblings(".sdx-duration-input").prop("disabled", false);
	});

	// Color picker sync with text input
	html.find(".sdx-targeting-box .sdx-color-picker").on("input", function() {
		$(this).siblings(".sdx-color-text").val($(this).val());
	});
	html.find(".sdx-targeting-box .sdx-color-text").on("input", function() {
		const colorVal = $(this).val();
		if (/^#[0-9A-Fa-f]{6}$/.test(colorVal)) {
			$(this).siblings(".sdx-color-picker").val(colorVal);
		}
	});

	// TokenMagic texture file picker
	html.find(".sdx-tm-texture-picker").on("click", async function(e) {
		e.preventDefault();
		const $input = $(this).siblings(".sdx-tm-texture-input");
		const fp = new FilePicker({
			type: "image",
			current: $input.val(),
			callback: path => {
				$input.val(path).trigger("change");
			},
		});
		fp.browse();
	});

	// TokenMagic opacity slider value display
	html.find(".sdx-tm-opacity-slider").on("input", function() {
		$(this).siblings(".sdx-tm-opacity-value").text($(this).val());
	});

	// TokenMagic preset dropdown - enable/disable tint inputs
	html.find(".sdx-tm-preset-select").on("change", function() {
		const preset = $(this).val();
		const $tintGroup = $(this).closest(".sdx-tokenmagic-section").find(".sdx-tint-input-group");
		const isNoFx = preset === "NOFX";
		$tintGroup.find("input").prop("disabled", isNoFx);
	});

	// TokenMagic tint color picker sync
	html.find(".sdx-tm-tint-picker").on("input", function() {
		$(this).siblings(".sdx-tm-tint-text").val($(this).val());
	});
	html.find(".sdx-tm-tint-text").on("input", function() {
		const colorVal = $(this).val();
		if (/^#[0-9A-Fa-f]{6}$/.test(colorVal)) {
			$(this).siblings(".sdx-tm-tint-picker").val(colorVal);
		}
	});

	// Template Effects: Enable/disable config section based on checkbox
	html.find(".sdx-template-effects-enabled").on("change", function() {
		const $config = $(this).closest(".sdx-template-effects-section").find(".sdx-template-effects-config");
		if ($(this).is(":checked")) {
			$config.css({ opacity: "", pointerEvents: "" });
		}
		else {
			$config.css({ opacity: "0.5", pointerEvents: "none" });
		}
	});

	// Template Effects: Enable/disable save config section based on checkbox
	html.find(".sdx-template-save-enabled").on("change", function() {
		const $config = $(this).closest(".sdx-template-effects-section").find(".sdx-template-save-config");
		if ($(this).is(":checked")) {
			$config.css({ opacity: "", pointerEvents: "" });
		}
		else {
			$config.css({ opacity: "0.5", pointerEvents: "none" });
		}
	});

	// Handle formula type radio buttons
	html.find(".sdx-formula-type-radio").on("change", function() {
		const selectedType = $(this).val();
		const $box = $(this).closest(".sdx-spell-damage-box");

		// Hide all formula sections
		$box.find(".sdx-formula-section").hide();

		// Show the selected formula section
		if (selectedType === "basic") {
			$box.find(".sdx-basic-formula").show();
		}
		else if (selectedType === "formula") {
			$box.find(".sdx-custom-formula").show();
		}
		else if (selectedType === "tiered") {
			$box.find(".sdx-tiered-formula").show();
		}

		// Save the formula type preference
		const updateData = {};
		updateData[`flags.${MODULE_ID}.spellDamage.formulaType`] = selectedType;
		item.update(updateData, { render: false });
	});

	// Attach drag and drop listeners for effects
	const $dropArea = html.find(".sdx-spell-effects-drop-area:not(.sdx-critical-effects-drop-area)");
	const $effectsList = html.find(".sdx-spell-effects-list");
	const $effectsData = html.find(".sdx-effects-data");

	// Update the hidden input when effects change
	function updateEffectsData() {
		const effects = [];
		$effectsList.find(".sdx-spell-effect-item").each(function() {
			const $item = $(this);
			const uuid = $item.data("uuid");

			// Collect duration overrides
			const duration = {};
			$item.find(".sdx-duration-input").each(function() {
				const field = $(this).data("field");
				const value = $(this).val();
				if (value !== "") {
					duration[field] = parseFloat(value);
				}
			});

			effects.push({ uuid, duration });
		});
		$effectsData.val(JSON.stringify(effects));

		// Save immediately to the item without re-rendering
		const updateData = {};
		updateData[`flags.${MODULE_ID}.spellDamage.effects`] = effects;
		item.update(updateData, { render: false }).then(() => {
			//console.log(`${MODULE_ID} | Saved spell effects:`, effects);
		}).catch(err => {
			console.error(`${MODULE_ID} | Failed to save spell effects:`, err);
		});

		// Remove "no effects" placeholder if we have effects
		if (effects.length > 0) {
			$effectsList.find(".sdx-no-effects").remove();
		}
		else if ($effectsList.find(".sdx-spell-effect-item").length === 0) {
			$effectsList.html('<div class="sdx-no-effects">Drag and drop conditions or effects here</div>');
		}
	}

	// Handle drag over
	$dropArea.on("dragover", function(event) {
		event.preventDefault();
		event.stopPropagation();
		$(this).addClass("sdx-drag-over");
	});

	// Handle drag leave
	$dropArea.on("dragleave", function(event) {
		event.preventDefault();
		event.stopPropagation();
		$(this).removeClass("sdx-drag-over");
	});

	// Handle drop
	$dropArea.on("drop", async function(event) {
		event.preventDefault();
		event.stopPropagation();
		$(this).removeClass("sdx-drag-over");

		try {
			const data = JSON.parse(event.originalEvent.dataTransfer.getData("text/plain"));

			// Get the document from the dropped data
			let doc = null;
			if (data.uuid) {
				doc = await fromUuid(data.uuid);
			}
			else if (data.type === "Item" && data.id) {
				// Handle items from compendiums or world
				if (data.pack) {
					const pack = game.packs.get(data.pack);
					doc = await pack.getDocument(data.id);
				}
				else {
					doc = game.items.get(data.id);
				}
			}

			if (!doc) {
				ui.notifications.warn("Could not load dropped item");
				return;
			}

			// Check if it's an effect or condition type
			const validTypes = ["Effect", "Condition", "NPC Feature"];
			if (!validTypes.includes(doc.type)) {
				ui.notifications.warn("Only Effect, Condition, or NPC Feature items can be dropped here");
				return;
			}

			// Check if already added
			const uuid = doc.uuid;
			if ($effectsList.find(`[data-uuid="${uuid}"]`).length > 0) {
				ui.notifications.info(`${doc.name} is already in the effects list`);
				return;
			}

			// Add the effect to the list
			const effectIndex = $effectsList.find(".sdx-spell-effect-item").length;
			const effectHtml = `
				<div class="sdx-spell-effect-item" data-uuid="${uuid}" data-effect-index="${effectIndex}">
					<div class="sdx-effect-header">
						<img src="${doc.img || "icons/svg/mystery-man.svg"}" alt="${doc.name}" />
						<span class="sdx-effect-name">${doc.name}</span>
						<a class="sdx-remove-effect" data-tooltip="Remove"><i class="fas fa-times"></i></a>
					</div>
					<div class="sdx-effect-duration-override">
						<div class="sdx-duration-row">
							<div class="sdx-duration-field">
								<label>Seconds</label>
								<input type="number" class="sdx-duration-input" data-field="seconds" value="" placeholder="Default" />
							</div>
							<div class="sdx-duration-field">
								<label>Start Time</label>
								<input type="number" class="sdx-duration-input" data-field="startTime" value="" placeholder="Default" />
							</div>
						</div>
						<div class="sdx-duration-row">
							<div class="sdx-duration-field">
								<label>Rounds</label>
								<input type="number" class="sdx-duration-input" data-field="rounds" value="" placeholder="Default" />
							</div>
							<div class="sdx-duration-field">
								<label>Turns</label>
								<input type="number" class="sdx-duration-input" data-field="turns" value="" placeholder="Default" />
							</div>
						</div>
						<div class="sdx-duration-row">
							<div class="sdx-duration-field">
								<label>Start Round</label>
								<input type="number" class="sdx-duration-input" data-field="startRound" value="" placeholder="Default" />
							</div>
							<div class="sdx-duration-field">
								<label>Start Turn</label>
								<input type="number" class="sdx-duration-input" data-field="startTurn" value="" placeholder="Default" />
							</div>
						</div>
					</div>
				</div>
			`;

			$effectsList.find(".sdx-no-effects").remove();
			$effectsList.append(effectHtml);
			updateEffectsData();

			ui.notifications.info(`Added ${doc.name} to spell effects`);
		}
		catch (err) {
			console.error(`${MODULE_ID} | Error handling drop:`, err);
			ui.notifications.error("Failed to add effect");
		}
	});

	// Handle remove effect button
	html.on("click", ".sdx-remove-effect", function(event) {
		event.preventDefault();
		event.stopPropagation();

		$(this).closest(".sdx-spell-effect-item").remove();
		updateEffectsData();
	});

	// Handle duration input changes
	html.on("change", ".sdx-duration-input", function(event) {
		event.preventDefault();
		event.stopPropagation();

		if ($(this).closest(".sdx-critical-effect-item").length > 0) {
			updateCriticalEffectsData();
		}
		else {
			updateEffectsData();
		}
	});

	// ===== CRITICAL EFFECTS HANDLERS =====
	const $critDropArea = html.find(".sdx-critical-effects-drop-area");
	const $critEffectsList = html.find(".sdx-spell-critical-effects-list");
	const $critEffectsData = html.find(".sdx-critical-effects-data");

	// Update the hidden input when critical effects change
	function updateCriticalEffectsData() {
		const effects = [];
		$critEffectsList.find(".sdx-critical-effect-item").each(function() {
			const $item = $(this);
			const uuid = $item.data("uuid");

			// Collect duration overrides
			const duration = {};
			$item.find(".sdx-duration-input").each(function() {
				const field = $(this).data("field");
				const value = $(this).val();
				if (value !== "") {
					duration[field] = parseFloat(value);
				}
			});

			effects.push({ uuid, duration });
		});
		$critEffectsData.val(JSON.stringify(effects));

		// Save immediately to the item without re-rendering
		const updateData = {};
		updateData[`flags.${MODULE_ID}.spellDamage.criticalEffects`] = effects;
		item.update(updateData, { render: false }).then(() => {
			//console.log(`${MODULE_ID} | Saved spell critical effects:`, effects);
		}).catch(err => {
			console.error(`${MODULE_ID} | Failed to save spell critical effects:`, err);
		});

		// Remove "no effects" placeholder if we have effects
		if (effects.length > 0) {
			$critEffectsList.find(".sdx-no-effects").remove();
		}
		else if ($critEffectsList.find(".sdx-critical-effect-item").length === 0) {
			$critEffectsList.html('<div class="sdx-no-effects"><i class="fas fa-star-exclamation"></i> Optional</div>');
		}
	}

	// Handle drag over for critical effects
	$critDropArea.on("dragover", function(event) {
		event.preventDefault();
		event.stopPropagation();
		$(this).addClass("sdx-drag-over");
	});

	// Handle drag leave for critical effects
	$critDropArea.on("dragleave", function(event) {
		event.preventDefault();
		event.stopPropagation();
		$(this).removeClass("sdx-drag-over");
	});

	// Handle drop for critical effects
	$critDropArea.on("drop", async function(event) {
		event.preventDefault();
		event.stopPropagation();
		$(this).removeClass("sdx-drag-over");

		try {
			const data = JSON.parse(event.originalEvent.dataTransfer.getData("text/plain"));

			// Get the document from the dropped data
			let doc = null;
			if (data.uuid) {
				doc = await fromUuid(data.uuid);
			}
			else if (data.type === "Item" && data.id) {
				if (data.pack) {
					const pack = game.packs.get(data.pack);
					doc = await pack.getDocument(data.id);
				}
				else {
					doc = game.items.get(data.id);
				}
			}

			if (!doc) {
				ui.notifications.warn("Could not load dropped item");
				return;
			}

			// Check if it's an effect or condition type
			const validTypes = ["Effect", "Condition", "NPC Feature"];
			if (!validTypes.includes(doc.type)) {
				ui.notifications.warn("Only Effect, Condition, or NPC Feature items can be dropped here");
				return;
			}

			// Check if already added
			const uuid = doc.uuid;
			if ($critEffectsList.find(`[data-uuid="${uuid}"]`).length > 0) {
				ui.notifications.info(`${doc.name} is already in the critical effects list`);
				return;
			}

			// Add the effect to the list (simplified without duration override)
			const effectIndex = $critEffectsList.find(".sdx-critical-effect-item").length;
			const effectHtml = `
				<div class="sdx-spell-effect-item sdx-critical-effect-item" data-uuid="${uuid}" data-effect-index="${effectIndex}">
					<div class="sdx-effect-header">
						<img src="${doc.img || "icons/svg/mystery-man.svg"}" alt="${doc.name}" />
						<span class="sdx-effect-name">${doc.name}</span>
						<a class="sdx-remove-critical-effect" data-tooltip="Remove"><i class="fas fa-times"></i></a>
					</div>
				</div>
			`;

			$critEffectsList.find(".sdx-no-effects").remove();
			$critEffectsList.append(effectHtml);
			updateCriticalEffectsData();

			ui.notifications.info(`Added ${doc.name} to critical effects`);
		}
		catch (err) {
			console.error(`${MODULE_ID} | Error handling critical effect drop:`, err);
			ui.notifications.error("Failed to add critical effect");
		}
	});

	// Handle remove critical effect button
	html.on("click", ".sdx-remove-critical-effect", function(event) {
		event.preventDefault();
		event.stopPropagation();

		$(this).closest(".sdx-critical-effect-item").remove();
		updateCriticalEffectsData();
	});

	// Also save applyToTarget when radio buttons change
	html.on("change", 'input[name="flags.shadowdark-extras.spellDamage.applyToTarget"]', function() {
		const applyToTargetValue = $(this).val() === "true";
		const updateData = {};
		updateData[`flags.${MODULE_ID}.spellDamage.applyToTarget`] = applyToTargetValue;

		item.update(updateData).then(() => {
			//console.log(`${MODULE_ID} | Saved applyToTarget:`, applyToTargetValue);
		}).catch(err => {
			console.error(`${MODULE_ID} | Failed to save applyToTarget:`, err);
		});
	});

	// ===== SUMMONING HANDLERS =====

	// Toggle summoning section - acts like radio button (only one activity can be enabled)
	html.on("change", ".sdx-summoning-toggle", function(e) {
		e.stopPropagation();
		const enabled = $(this).prop("checked");

		//console.log(`${MODULE_ID} | Summoning toggle changed to:`, enabled);

		if (enabled) {
			// Disable other activities
			html.find(".sdx-spell-damage-toggle").prop("checked", false);
			html.find(".sdx-spell-damage-content").slideUp(200);
			html.find(".sdx-item-give-toggle").prop("checked", false);
			// Save all states at once
			const updateData = {};
			updateData[`flags.${MODULE_ID}.spellDamage.enabled`] = false;
			updateData[`flags.${MODULE_ID}.summoning.enabled`] = true;
			updateData[`flags.${MODULE_ID}.itemGive.enabled`] = false;
			item.update(updateData, { render: false });
		}
		else {
			// Just disable this one
			const updateData = {};
			updateData[`flags.${MODULE_ID}.summoning.enabled`] = false;
			item.update(updateData, { render: false });
		}
	});

	// Add summon profile button
	html.on("click", ".sdx-add-summon-btn", async function(e) {
		e.preventDefault();
		e.stopPropagation();

		const { generateSummonProfileHTML } = await import("./SummoningConfig.mjs");
		const $summonsList = $(this).closest(".sdx-summoning-content").find(".sdx-summons-list");
		const index = $summonsList.find(".sdx-summon-profile").length;

		const newProfile = {
			creatureUuid: "",
			creatureName: "",
			creatureImg: "",
			count: "1",
			displayName: "",
		};

		const profileHtml = generateSummonProfileHTML(newProfile, index);
		$summonsList.append(profileHtml);

		updateSummonsData();
	});

	// Remove summon profile
	html.on("click", ".sdx-remove-summon-btn", function(e) {
		e.preventDefault();
		e.stopPropagation();

		$(this).closest(".sdx-summon-profile").remove();

		// Re-index remaining profiles
		const $summonsList = $(this).closest(".sdx-summons-list");
		$summonsList.find(".sdx-summon-profile").each(function(idx) {
			$(this).attr("data-index", idx);
			$(this).find(".sdx-remove-summon-btn").attr("data-index", idx);
		});

		updateSummonsData();
	});

	// Handle summon profile input changes
	html.on("change input", ".sdx-summon-count, .sdx-summon-display-name", function(e) {
		e.stopPropagation(); // Prevent form auto-submit
		updateSummonsData();
	});

	// Handle drop on creature drop zone
	html.on("dragover", ".sdx-summon-creature-drop", function(event) {
		event.preventDefault();
		event.stopPropagation();
		$(this).addClass("sdx-drag-over");
	});

	html.on("dragleave", ".sdx-summon-creature-drop", function(event) {
		event.preventDefault();
		event.stopPropagation();
		$(this).removeClass("sdx-drag-over");
	});

	html.on("drop", ".sdx-summon-creature-drop", async function(event) {
		event.preventDefault();
		event.stopPropagation();
		$(this).removeClass("sdx-drag-over");

		try {
			const data = JSON.parse(event.originalEvent.dataTransfer.getData("text/plain"));

			// Get the document from the dropped data
			let doc = null;
			if (data.uuid) {
				doc = await fromUuid(data.uuid);
			}
			else if (data.type === "Actor" && data.id) {
				// Handle actors from compendiums or world
				if (data.pack) {
					const pack = game.packs.get(data.pack);
					doc = await pack.getDocument(data.id);
				}
				else {
					doc = game.actors.get(data.id);
				}
			}

			if (!doc) {
				ui.notifications.warn("Could not load dropped actor");
				return;
			}

			// Must be an Actor
			if (!(doc instanceof Actor)) {
				ui.notifications.warn("Only actors can be dropped here");
				return;
			}

			// Update the profile display
			const $profile = $(this).closest(".sdx-summon-profile");
			const creatureName = doc.name;
			const creatureImg = doc.img || doc.prototypeToken?.texture?.src || "icons/svg/mystery-man.svg";
			const creatureUuid = doc.uuid;

			// Update hidden inputs
			$profile.find(".sdx-creature-uuid").val(creatureUuid);
			$profile.find(".sdx-creature-name").val(creatureName);
			$profile.find(".sdx-creature-img").val(creatureImg);

			// Update display
			$(this).html(`
				<div class="sdx-summon-creature-display" data-uuid="${creatureUuid}">
					<img src="${creatureImg}" alt="${creatureName}" style="width: 40px; height: 40px; border-radius: 4px;" />
					<span style="margin-left: 4px; font-size: 0.9em;">${creatureName}</span>
				</div>
			`);

			updateSummonsData();
			ui.notifications.info(`Added ${creatureName} to summon profile`);
		}
		catch (err) {
			console.error(`${MODULE_ID} | Error handling creature drop:`, err);
			ui.notifications.error("Failed to add creature");
		}
	});

	// Function to collect and save summons data
	function updateSummonsData() {
		const profiles = [];
		html.find(".sdx-summon-profile").each(function() {
			const $profile = $(this);
			profiles.push({
				creatureUuid: $profile.find(".sdx-creature-uuid").val(),
				creatureName: $profile.find(".sdx-creature-name").val(),
				creatureImg: $profile.find(".sdx-creature-img").val(),
				count: $profile.find(".sdx-summon-count").val() || "1",
				displayName: $profile.find(".sdx-summon-display-name").val() || "",
			});
		});

		// Update hidden input
		html.find(".sdx-summons-data").val(JSON.stringify(profiles));

		// Save to item
		const updateData = {};
		updateData[`flags.${MODULE_ID}.summoning.profiles`] = profiles;
		item.update(updateData, { render: false }).then(() => {
			//console.log(`${MODULE_ID} | Saved summon profiles:`, profiles);
		}).catch(err => {
			console.error(`${MODULE_ID} | Failed to save summon profiles:`, err);
		});
	}

	// ---- Item give handlers ----
	html.on("change", ".sdx-item-give-toggle", function(e) {
		e.stopPropagation();
		const enabled = $(this).is(":checked");
		const updateData = {};
		updateData[`flags.${MODULE_ID}.itemGive.enabled`] = enabled;
		item.update(updateData, { render: false }).then(() => {
			//console.log(`${MODULE_ID} | Item give enabled state saved:`, enabled);
		});
	});

	html.on("click", ".sdx-add-item-give-btn", async function(e) {
		e.preventDefault();
		e.stopPropagation();
		const { generateItemGiveProfileHTML } = await import("./ItemGiveConfig.mjs");
		const $list = $(this).closest(".sdx-item-give-content").find(".sdx-item-give-list");
		const index = $list.find(".sdx-item-give-profile").length;
		const newProfile = {
			itemUuid: "",
			itemName: "",
			itemImg: "",
			quantity: "1",
		};
		$list.append(generateItemGiveProfileHTML(newProfile, index));
		updateItemGiveData();
	});

	html.on("click", ".sdx-remove-item-give-btn", function(e) {
		e.preventDefault();
		e.stopPropagation();
		$(this).closest(".sdx-item-give-profile").remove();
		updateItemGiveData();
	});

	html.on("change input", ".sdx-item-give-quantity", function(e) {
		e.stopPropagation();
		updateItemGiveData();
	});

	html.on("dragover", ".sdx-item-give-drop", function(event) {
		event.preventDefault();
		event.stopPropagation();
		$(this).addClass("sdx-drag-over");
	});

	html.on("dragleave", ".sdx-item-give-drop", function(event) {
		event.preventDefault();
		event.stopPropagation();
		$(this).removeClass("sdx-drag-over");
	});

	html.on("drop", ".sdx-item-give-drop", async function(event) {
		event.preventDefault();
		event.stopPropagation();
		$(this).removeClass("sdx-drag-over");
		try {
			const data = JSON.parse(event.originalEvent.dataTransfer.getData("text/plain"));
			let doc = null;
			if (data.uuid) {
				doc = await fromUuid(data.uuid);
			}
			else if (data.type === "Item" && data.id) {
				if (data.pack) {
					const pack = game.packs.get(data.pack);
					doc = await pack.getDocument(data.id);
				}
				else {
					doc = game.items.get(data.id);
				}
			}
			if (!doc) {
				ui.notifications.warn("Could not load dropped item");
				return;
			}
			if (!(doc instanceof Item)) {
				ui.notifications.warn("Only items can be dropped here");
				return;
			}
			const $profile = $(this).closest(".sdx-item-give-profile");
			const itemName = doc.name;
			const itemImg = doc.img || "icons/svg/mystery-man.svg";
			const itemUuid = doc.uuid;
			$profile.find(".sdx-item-give-uuid").val(itemUuid);
			$profile.find(".sdx-item-give-name").val(itemName);
			$profile.find(".sdx-item-give-img").val(itemImg);
			$(this).html(`
				<div class="sdx-item-give-display" data-uuid="${itemUuid}">
					<img src="${itemImg}" alt="${itemName}" style="width: 40px; height: 40px; border-radius: 4px;" />
					<span style="margin-left: 4px; font-size: 0.9em;">${itemName}</span>
				</div>
			`);
			updateItemGiveData();
			ui.notifications.info(`Added ${itemName} to caster item list`);
		}
		catch (err) {
			console.error(`${MODULE_ID} | Error handling item drop:`, err);
			ui.notifications.error("Failed to add item");
		}
	});

	function updateItemGiveData() {
		const profiles = [];
		html.find(".sdx-item-give-profile").each(function(idx) {
			const $profile = $(this);
			$profile.attr("data-index", idx);
			$profile.find(".sdx-remove-item-give-btn").attr("data-index", idx);
			profiles.push({
				itemUuid: $profile.find(".sdx-item-give-uuid").val(),
				itemName: $profile.find(".sdx-item-give-name").val(),
				itemImg: $profile.find(".sdx-item-give-img").val(),
				quantity: $profile.find(".sdx-item-give-quantity").val() || "1",
			});
		});
		html.find(".sdx-item-give-data").val(JSON.stringify(profiles));
		const updateData = {};
		updateData[`flags.${MODULE_ID}.itemGive.profiles`] = profiles;
		item.update(updateData, { render: false }).then(() => {
			//console.log(`${MODULE_ID} | Saved item give profiles:`, profiles);
		}).catch(err => {
			console.error(`${MODULE_ID} | Failed to save item give profiles:`, err);
		});
	}

	// ===== ITEM MACRO HANDLERS =====

	// Handle spell macro GM toggle
	html.on("change", ".sdx-spell-macro-run-as-gm", function(e) {
		e.stopPropagation();
		const runAsGm = $(this).prop("checked");
		const updateData = {};
		updateData[`flags.${MODULE_ID}.itemMacro.runAsGm`] = runAsGm;
		item.update(updateData, { render: false }).then(() => {
			//console.log(`${MODULE_ID} | Saved itemMacro.runAsGm:`, runAsGm);
		}).catch(err => {
			console.error(`${MODULE_ID} | Failed to save itemMacro.runAsGm:`, err);
		});
	});

	// Handle spell macro trigger checkboxes
	html.on("change", ".sdx-spell-macro-trigger-checkbox", function(e) {
		e.stopPropagation();
		// Collect all checked triggers
		const triggers = [];
		html.find(".sdx-spell-macro-trigger-checkbox:checked").each(function() {
			triggers.push($(this).data("trigger"));
		});
		const updateData = {};
		updateData[`flags.${MODULE_ID}.itemMacro.triggers`] = triggers;
		item.update(updateData, { render: false }).then(() => {
			//console.log(`${MODULE_ID} | Saved itemMacro.triggers:`, triggers);
		}).catch(err => {
			console.error(`${MODULE_ID} | Failed to save itemMacro.triggers:`, err);
		});
	});

	// ===== ANIMATION FX HANDLERS =====
	activateAnimationFxListeners(html, item);

	// Setup activity toggles as radio buttons (only one can be active at a time)
	setupActivityRadioToggles(html, item);

	// Setup UI listeners for targeting and aura effects
	activateTemplateTargetingListeners(html[0], MODULE_ID);
	activateTemplateTokenMagicStackHandlers(html, item);

	//console.log(`${MODULE_ID} | Spell sheet enhanced for`, item.name);
}

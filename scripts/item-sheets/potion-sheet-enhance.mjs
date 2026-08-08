import { MODULE_ID } from "../shared/module-id.mjs";
import { generatePotionConfig } from "./ItemTypeConfigs.mjs";
import { activateTemplateTargetingListeners } from "./TemplateTargetingConfig.mjs";
import {
	activateTemplateTokenMagicStackHandlers,
	setupActivityRadioToggles,
} from "./activity-tab-widgets.mjs";

/**
 * Potion item sheet enhancement.
 *
 * Extracted from the composition root in Phase 3, verbatim. Builds the Activity
 * tab — damage/heal, conditions, summoning, item-give, targeting and template —
 * then hands the rendered markup to the shared Activity-tab widget wiring. It
 * takes no Animation FX wiring; that is the one thing the Spell, Scroll and Wand
 * enhancers do and this one does not.
 *
 * IMPORTANT, and the reason a "nothing rendered" reading here is easy to
 * misjudge: this hangs off the root's `renderItemSheet` dispatch, which fires
 * for the jQuery `ItemSheetSD`. In a world where SDX's own `PotionSheetSD`
 * (ApplicationV2) is registered for Potions — as it is in world 0100 — Potions
 * never take this path, so an unenhanced Potion sheet is correct rather than a
 * regression. Confirm with `item.sheet.constructor.name` before treating it as
 * one. See docs/architecture/phase3-handoff.md.
 *
 * The `SummoningConfig` / `ItemGiveConfig` imports stay dynamic, as they were in
 * the root; only their paths changed, since `./item-sheets/X` was relative to
 * the root and this module already lives in that folder.
 */
/**
 * Enhance Potion item sheets with damage/heal and conditions UI
 */
export async function enhancePotionSheet(app, html) {
	// Check if spell enhancement is enabled (reuse spell enhancement setting)
	try {
		if (!game.settings.get(MODULE_ID, "enhanceSpells")) return;
	}
	catch{
		return;
	}

	// Only enhance Potion items
	const item = app.item;
	if (!item || item.type !== "Potion") return;


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
		scaling: "none", // potions don't scale by level
		scalingDice: 0,
		formula: "",
		damageRequirement: "", // Formula that must evaluate to true for damage to apply
		damageRequirementFailAction: "zero", // "zero" or "half" - what to do when requirement fails
		effectsRequirement: "", // Formula that must evaluate to true for effects to apply
		effects: [], // Array of effect document UUIDs
		applyToTarget: false, // potions apply to self (drinker) by default
		effectsApplyToTarget: false, // potions apply effects to self by default
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
		auraEffects: auraEffectsFlags,
	};

	// Convert applyToTarget to boolean (in case it was stored as string)
	const applyToTarget = flags.applyToTarget === "true" ? true : (flags.applyToTarget === true ? true : false);
	const effectsApplyToTarget = flags.effectsApplyToTarget === "true" ? true : (flags.effectsApplyToTarget === true ? true : false);

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
		}
		else {
			console.warn(`${MODULE_ID} | Could not find Details tab link`);
		}

		// Create Activity tab content container with correct structure
		const activityTabContent = "<section class=\"tab tab-activity\" data-group=\"primary\" data-tab=\"tab-activity\"></section>";
		const $detailsTab = html.find('section.tab-details[data-tab="tab-details"]');
		if ($detailsTab.length) {
			$detailsTab.after(activityTabContent);
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
		console.warn(`${MODULE_ID} | Activity tab not found in potion sheet`);
		return;
	}


	// Build list of current effects from stored UUIDs
	let effectsListHtml = "";

	// Handle case where effects might be a string instead of an array (from form submission)
	let effectsArray = flags.effects || [];
	if (typeof effectsArray === "string") {
		try {
			effectsArray = JSON.parse(effectsArray);
		}
		catch(err) {
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

	}

	// Build summons list HTML
	let summonsList = "";
	let summonProfilesArray = summoningFlags.profiles || [];

	// Handle case where profiles might be a string
	if (typeof summonProfilesArray === "string") {
		try {
			summonProfilesArray = JSON.parse(summonProfilesArray);
		}
		catch(err) {
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
		catch(err) {
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

	// Build the damage/heal UI HTML using template
	const damageHealHtml = generatePotionConfig(MODULE_ID, flags, effectsListHtml, effectsArray, effectsApplyToTarget, summonsList, summonProfilesArray, itemGiveList, itemGiveProfilesArray);

	// Insert into Activity tab
	$activityTab.append(damageHealHtml);

	// Prevent auto-submission of form inputs in Activity tab to avoid unwanted re-renders
	$activityTab.find("input, select, textarea").on("change", function(e) {
		// Skip Item Macro inputs - they have their own handlers
		if ($(this).hasClass("sdx-spell-macro-run-as-gm")
			|| $(this).hasClass("sdx-spell-macro-trigger-checkbox")) {
			return; // Let the event propagate to the Item Macro handlers
		}

		e.stopPropagation(); // Prevent event from bubbling up to form auto-submit

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
				if (value && value.trim() !== "") {
					duration[field] = parseFloat(value);
				}
			});

			effects.push({ uuid, duration });
		});
		$effectsData.val(JSON.stringify(effects));

		// Save immediately to the item
		const updateData = {};
		updateData[`flags.${MODULE_ID}.spellDamage.effects`] = effects;
		item.update(updateData).then(() => {
		}).catch(err => {
			console.error(`${MODULE_ID} | Failed to save potion effects:`, err);
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
			const effectHtml = `
				<div class="sdx-spell-effect-item" data-uuid="${uuid}">
					<img src="${doc.img || "icons/svg/mystery-man.svg"}" alt="${doc.name}" />
					<span>${doc.name}</span>
					<a class="sdx-remove-effect" data-tooltip="Remove"><i class="fas fa-times"></i></a>
				</div>
			`;

			$effectsList.find(".sdx-no-effects").remove();
			$effectsList.append(effectHtml);
			updateEffectsData();

			ui.notifications.info(`Added ${doc.name} to potion effects`);
		}
		catch(err) {
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

	// Also save effectsApplyToTarget when radio buttons change
	html.on("change", 'input[name="flags.shadowdark-extras.spellDamage.effectsApplyToTarget"]', function() {
		const effectsApplyToTargetValue = $(this).val() === "true";
		const updateData = {};
		updateData[`flags.${MODULE_ID}.spellDamage.effectsApplyToTarget`] = effectsApplyToTargetValue;

		item.update(updateData).then(() => {
		}).catch(err => {
			console.error(`${MODULE_ID} | Failed to save effectsApplyToTarget:`, err);
		});
	});

	// ---- Summoning handlers ----
	html.on("change", ".sdx-summoning-toggle", function(e) {
		e.stopPropagation();
		const enabled = $(this).is(":checked");
		const updateData = {};
		updateData[`flags.${MODULE_ID}.summoning.enabled`] = enabled;
		item.update(updateData, { render: false }).then(() => {
		});
	});

	html.on("click", ".sdx-add-summon-btn", async function(e) {
		e.preventDefault();
		e.stopPropagation();
		const { generateSummonProfileHTML } = await import("./SummoningConfig.mjs");
		const $list = $(this).closest(".sdx-summoning-content").find(".sdx-summons-list");
		const index = $list.find(".sdx-summon-profile").length;
		const newProfile = {
			creatureUuid: "",
			creatureName: "",
			creatureImg: "",
			count: "1",
			displayName: "",
		};
		$list.append(generateSummonProfileHTML(newProfile, index));
		updateSummonsData();
	});

	html.on("click", ".sdx-remove-summon-btn", function(e) {
		e.preventDefault();
		e.stopPropagation();
		$(this).closest(".sdx-summon-profile").remove();
		updateSummonsData();
	});

	html.on("change input", ".sdx-summon-count, .sdx-summon-display-name", function(e) {
		e.stopPropagation();
		updateSummonsData();
	});

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
		catch(err) {
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
		catch(err) {
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
		}).catch(err => {
			console.error(`${MODULE_ID} | Failed to save itemMacro.runAsGm:`, err);
		});
	});

	// Handle spell macro trigger checkboxes
	html.on("change", ".sdx-spell-macro-trigger-checkbox", function(e) {
		e.stopPropagation();
		const triggers = [];
		html.find(".sdx-spell-macro-trigger-checkbox:checked").each(function() {
			triggers.push($(this).data("trigger"));
		});
		const updateData = {};
		updateData[`flags.${MODULE_ID}.itemMacro.triggers`] = triggers;
		item.update(updateData, { render: false }).then(() => {
		}).catch(err => {
			console.error(`${MODULE_ID} | Failed to save itemMacro.triggers:`, err);
		});
	});

	// Setup activity toggles as radio buttons (only one can be active at a time)
	setupActivityRadioToggles(html, item);

	// Setup UI listeners for targeting and aura effects
	activateTemplateTargetingListeners(html[0], MODULE_ID);
	activateTemplateTokenMagicStackHandlers(html, item);

}

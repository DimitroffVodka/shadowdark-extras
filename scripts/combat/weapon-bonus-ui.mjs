/**
 * Weapon bonus configuration UI and sheet listeners. Extracted from
 * WeaponBonusConfig.mjs; public names are re-exported by the facade.
 */

import { FEATURE_IDS, isFeatureEnabled } from "../settings/feature-gates.mjs";
import { getCreatureTypes } from "../npc/CreatureTypesApp.mjs";

const MODULE_ID = "shadowdark-extras";

const npcCreatureTypesEnabled = () => isFeatureEnabled(FEATURE_IDS.NPC_CREATURE_TYPES)
	&& game.settings.get(MODULE_ID, "enableNpcCreatureType");

/**
 * Persisted `type` for the creature-type requirement. The stored value stays
 * `targetSubtype` — every existing weapon config and `macros/cleansing-weapon.mjs`
 * write it — while the label users see is now "Target Creature Type", matching
 * the NPC Creature Types feature it actually reads.
 */
const CREATURE_TYPE_REQUIREMENT = "targetSubtype";

/** Escape a user-supplied string for interpolation into an HTML attribute. */
function escapeAttr(value) {
	return String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

/**
 * Requirement type options, shared by all four requirement row builders.
 *
 * `selectedType` is always present in the result even when its option would
 * otherwise be filtered out (a creature-type requirement saved while the NPC
 * Creature Types feature was on, then read back with it off). Without that, the
 * `<select>` renders with nothing selected, the browser reports option 0, and
 * the next save silently rewrites the requirement to `targetName`.
 *
 * @param {string} selectedType - the requirement's persisted type
 * @returns {{value: string, label: string}[]}
 */
function getRequirementTypeOptions(selectedType) {
	const options = [
		{ value: "targetName", label: "Target Name" },
		{ value: "targetCondition", label: "Target Has Condition" },
		{ value: "targetHpPercent", label: "Target HP %" },
		{ value: "attackerHpPercent", label: "Attacker HP %" },
		{ value: "targetAncestry", label: "Target Ancestry" },
		{ value: "targetAlignment", label: "Target Alignment" },
	];

	if (npcCreatureTypesEnabled() || selectedType === CREATURE_TYPE_REQUIREMENT) {
		options.push({ value: CREATURE_TYPE_REQUIREMENT, label: "Target Creature Type" });
	}

	return options;
}

/** Render an option list, marking `selected` as chosen. */
function buildOptionsHtml(options, selected) {
	return options
		.map(opt => `<option value="${escapeAttr(opt.value)}" ${selected === opt.value ? "selected" : ""}>${opt.label}</option>`)
		.join("");
}

/**
 * The value control for a requirement row.
 *
 * A creature-type requirement gets a dropdown of the configured creature types
 * rather than free text — the value has to match `getEffectiveCreatureType()`
 * exactly, and typing it by hand was the main way to get a requirement that
 * never fires. Every other type keeps its free-text input.
 *
 * The saved value is always offered as an option, so a type removed from the
 * world's list (or one written by a macro) is not silently rewritten to the
 * first entry on the next save.
 *
 * @param {string} cssClass - the row's value-control class, e.g. `sdx-hit-bonus-req-value`
 * @param {string} type - the requirement's persisted type
 * @param {string} value - the requirement's persisted value
 * @returns {string} HTML for an `<input>` or a `<select>` carrying `cssClass`
 */
function buildRequirementValueHtml(cssClass, type, value) {
	if (type !== CREATURE_TYPE_REQUIREMENT) {
		return `<input type="text" class="${cssClass}" value="${escapeAttr(value)}" placeholder="${getPlaceholderForType(type)}" />`;
	}

	const types = [...getCreatureTypes()];
	if (value && !types.includes(value)) types.push(value);

	const options = types.map(t => ({
		value: t,
		label: t || game.i18n?.localize("SHADOWDARK_EXTRAS.npc.creature_type.none") || "(None)",
	}));

	return `<select class="${cssClass}">${buildOptionsHtml(options, value)}</select>`;
}

/**
 * Re-render the sheet with the Bonuses tab still active.
 *
 * Changing a requirement's type has to rebuild its row: the operator list is
 * type-dependent, and a creature-type requirement swaps its free-text value box
 * for a dropdown. The other requirement fields save in place without this — a
 * re-render on every keystroke would steal focus.
 */
function rerenderBonusesTab(app) {
	app._shadowdarkExtrasActiveTab = "tab-bonuses";
	app.render(false);
}

async function saveWeaponBonusConfig(item, updates) {
	const currentFlags = item.flags?.[MODULE_ID]?.weaponBonus || getDefaultWeaponBonusConfig();
	const newFlags = foundry.utils.mergeObject(currentFlags, updates);

	await item.update({
		[`flags.${MODULE_ID}.weaponBonus`]: newFlags,
	}, { render: false });

	console.log(`${MODULE_ID} | Saved weapon bonus config:`, newFlags);
}

/**
 * Default weapon bonus configuration
 */
export function getDefaultWeaponBonusConfig() {
	return {
		enabled: false,
		// Per-weapon exploding damage dice, overriding the system's world-wide
		// Momentum Mode setting (issue #134)
		momentum: false,
		// Multiple to-hit bonuses with individual requirements
		hitBonuses: [],
		// Multiple damage bonuses with individual requirements
		damageBonuses: [],
		// Legacy single bonus (for migration)
		damageBonus: "",
		// Critical hit bonuses
		criticalExtraDice: "",
		criticalExtraDamage: "",
		// Critical hit bonus requirements
		criticalDiceRequirements: [],
		criticalDamageRequirements: [],
		// Legacy requirements (for migration)
		requirements: [],
		// Effects to apply on hit
		effects: [],
		// Item Macro configuration
		itemMacro: {
			enabled: false,
			runAsGm: false,
			// beforeAttack, onHit, onCritical, onMiss, onCriticalMiss, onEquip, onUnequip
			triggers: [],
		},
	};
}
/**
 * Activate the Bonuses tab in an item sheet
 */
function activateBonusesTab(app, html) {
	const $html = html || app.element;
	if (!$html || !$html.length) return;

	// Remove active class from all tabs/sections
	$html.find('nav.SD-nav[data-group="primary"] .navigation-tab').removeClass("active");
	$html.find('.SD-content-body .tab[data-group="primary"]').removeClass("active");

	// Add active class to bonuses tab
	$html.find('nav.SD-nav[data-group="primary"] [data-tab="tab-bonuses"]').addClass("active");
	$html.find('.tab[data-tab="tab-bonuses"]').addClass("active");

	// Also update Foundry's tab controller if available
	if (app._tabs && app._tabs.length > 0) {
		for (const tabs of app._tabs) {
			if (tabs._group === "primary") {
				tabs.active = "tab-bonuses";
				break;
			}
		}
	}
}

/**
 * Inject the Bonuses tab into weapon item sheets
 */
export function injectWeaponBonusTab(app, html, item) {
	// Only for Weapon type items
	if (item.type !== "Weapon") return;

	// Find the nav tabs - Shadowdark uses SD-nav with navigation-tab class
	const $nav = html.find('nav.SD-nav[data-group="primary"]');
	if (!$nav.length) {
		console.log(`${MODULE_ID} | No nav tabs found for weapon bonus injection`);
		return;
	}

	// Shadowdark 4.x now ships a native `tab-bonuses` on weapon sheets, so
	// our nav-tab + content injection is redundant when it exists. Still
	// inject the visual controls because this function has standalone callers.
	if ($nav.find('[data-tab="tab-bonuses"]').length) {
		injectWeaponAnimationButton(html, item);
		return;
	}

	// Add the Bonuses tab to navigation (before Source tab)
	const bonusTabNav = "<a class=\"navigation-tab\" data-tab=\"tab-bonuses\"><i class=\"fas fa-dice-d20\"></i> Bonuses</a>";
	const $sourceTab = $nav.find('[data-tab="tab-source"]');
	if ($sourceTab.length) {
		$sourceTab.before(bonusTabNav);
	}
	else {
		$nav.append(bonusTabNav);
	}

	// Get current configuration
	const flags = item.flags?.[MODULE_ID]?.weaponBonus || getDefaultWeaponBonusConfig();

	// Build the tab content
	const tabContent = buildWeaponBonusTabHtml(flags, item);

	// Find the sheet body/content area - Shadowdark uses SD-content-body
	const $sheetBody = html.find(".SD-content-body, section.SD-content-body");
	if ($sheetBody.length) {
		$sheetBody.append(tabContent);
		console.log(`${MODULE_ID} | Injected bonuses tab content`);
	}
	else {
		console.log(`${MODULE_ID} | Could not find SD-content-body`);
	}

	// Activate tab functionality
	activateWeaponBonusListeners(html, app, item);

	// Restore active tab if it was the Bonuses tab - use setTimeout to run after
	// Foundry's native handlers
	if (app._shadowdarkExtrasActiveTab === "tab-bonuses") {
		setTimeout(() => activateBonusesTab(app, html), 0);
	}

	// Track tab changes to handle re-renders
	html.find('nav.SD-nav[data-group="primary"] .navigation-tab').on("click", function() {
		const tabName = $(this).data("tab");
		if (tabName) {
			app._shadowdarkExtrasActiveTab = tabName;
		}
	});

	// Preserve standalone behavior. The namespaced event binding in the
	// injector makes the composition root's later call idempotent.
	injectWeaponAnimationButton(html, item);

}

/**
 * Inject Attack FX / Equipped Sprite controls into supported item sheets.
 * @param {jQuery} html - The sheet HTML
 * @param {Item} item - The weapon, armor, or spell item
 */
export function injectWeaponAnimationButton(html, item) {
	const $nav = html.find('nav.SD-nav[data-group="primary"]');
	if (!$nav.length) return;

	const ownsAttackFx = ["Weapon", "Spell"].includes(item?.type)
		&& isFeatureEnabled(FEATURE_IDS.ANIMATION_ITEM_OVERRIDES);
	const ownsEquippedSprite = ["Weapon", "Armor"].includes(item?.type)
		&& isFeatureEnabled(FEATURE_IDS.WEAPON_SPRITES);
	const buttons = [];
	if (
		ownsAttackFx
		&& !$nav.find(".sdx-weapon-attack-fx-btn, .sdx-spell-attack-fx-btn").length
	) {
		const buttonClass = item.type === "Spell" ? "sdx-spell-attack-fx-btn" : "sdx-weapon-attack-fx-btn";
		const buttonTitle = item.type === "Spell"
			? game.i18n.localize("SHADOWDARK_EXTRAS.weaponAnimation.spellFxButton")
			: game.i18n.localize("SHADOWDARK_EXTRAS.weaponAnimation.attackFxButton");
		buttons.push(`<a class="sdx-weapon-visual-btn ${buttonClass} navigation-tab" data-item-uuid="${item.uuid}" title="${buttonTitle}"><i class="fas fa-wand-magic-sparkles"></i></a>`);
	}
	if (
		ownsEquippedSprite
		&& !$nav.find(".sdx-weapon-animation-btn").length
	) {
		buttons.push(`<a class="sdx-weapon-visual-btn sdx-weapon-animation-btn navigation-tab" data-item-uuid="${item.uuid}" title="${game.i18n.localize("SHADOWDARK_EXTRAS.weaponAnimation.equippedSpriteButton")}"><i class="fas fa-sword"></i></a>`);
	}
	if (buttons.length) {
		const $bonusesTab = $nav.find('[data-tab="tab-bonuses"]');
		if ($bonusesTab.length) {
			$bonusesTab.after(buttons.join(""));
		}
		else {
			$nav.append(buttons.join(""));
		}
	}

	const itemButtonSelector = `[data-item-uuid="${item.uuid}"]`;
	if (ownsAttackFx) {
		html.find(`.sdx-weapon-attack-fx-btn${itemButtonSelector}, .sdx-spell-attack-fx-btn${itemButtonSelector}`)
			.off("click.sdxItemVisuals")
			.on("click.sdxItemVisuals", async event => {
				event.preventDefault();
				event.stopPropagation();
				const { openWeaponAttackFxConfig } = await import("../animation/WeaponAttackFxConfig.mjs");
				openWeaponAttackFxConfig(item);
			});
	}

	if (ownsEquippedSprite) {
		html.find(`.sdx-weapon-animation-btn${itemButtonSelector}`)
			.off("click.sdxItemVisuals")
			.on("click.sdxItemVisuals", async event => {
				event.preventDefault();
				event.stopPropagation();
				const { openWeaponAnimationConfig } = await import("../animation/WeaponAnimationConfig.mjs");
				openWeaponAnimationConfig(item);
			});
	}

	if (buttons.length) console.log(`${MODULE_ID} | Injected item visual controls`);
}

/**
 * Build the HTML for the Bonuses tab
 */
function buildWeaponBonusTabHtml(flags, item) {
	const enabled = flags.enabled || false;
	const momentum = flags.momentum || false;
	const criticalExtraDice = flags.criticalExtraDice || "";
	const criticalExtraDamage = flags.criticalExtraDamage || "";
	const criticalDiceRequirements = flags.criticalDiceRequirements || [];
	const criticalDamageRequirements = flags.criticalDamageRequirements || [];
	const effects = flags.effects || [];

	// Item Macro configuration
	const itemMacro = flags.itemMacro || { enabled: false, runAsGm: false, triggers: [] };
	const itemMacroCommand = item.getFlag(MODULE_ID, "macroCommand") || item.flags?.itemacro?.macro?.command || "";

	// Handle hit bonuses
	let hitBonuses = flags.hitBonuses || [];

	// Handle damage bonuses (with migration from legacy single bonus)
	let damageBonuses = flags.damageBonuses || [];
	if (damageBonuses.length === 0 && flags.damageBonus) {
		// Migrate legacy single bonus
		damageBonuses = [{
			formula: flags.damageBonus,
			label: "",
			requirements: flags.requirements || [],
		}];
	}

	// Build hit bonuses list HTML
	let hitBonusesHtml = "";
	hitBonuses.forEach((bonus, index) => {
		hitBonusesHtml += buildHitBonusRowHtml(bonus, index);
	});

	// Build damage bonuses list HTML
	let damageBonusesHtml = "";
	damageBonuses.forEach((bonus, index) => {
		damageBonusesHtml += buildDamageBonusRowHtml(bonus, index);
	});

	// Build effects list HTML
	let effectsHtml = "";
	effects.forEach((effect, index) => {
		effectsHtml += buildEffectRowHtml(effect, index);
	});

	// Build Item Macro section HTML
	const itemMacroHtml = isFeatureEnabled(FEATURE_IDS.ITEM_MACROS)
		? buildItemMacroSectionHtml(itemMacro, itemMacroCommand)
		: "";

	// Build critical requirements HTML
	let criticalDiceReqsHtml = "";
	criticalDiceRequirements.forEach((req, reqIndex) => {
		criticalDiceReqsHtml += buildCriticalRequirementRowHtml(req, "dice", reqIndex);
	});

	let criticalDamageReqsHtml = "";
	criticalDamageRequirements.forEach((req, reqIndex) => {
		criticalDamageReqsHtml += buildCriticalRequirementRowHtml(req, "damage", reqIndex);
	});

	return `
		<div class="tab" data-group="primary" data-tab="tab-bonuses">
			<div class="sdx-weapon-bonus-config">
				<!-- Enable Toggle -->
				<div class="sdx-bonus-section sdx-bonus-enable">
					<label class="sdx-toggle-label">
						<input type="checkbox" class="sdx-weapon-bonus-enabled" ${enabled ? "checked" : ""} />
						<span>Enable Weapon Bonuses</span>
					</label>

					<!--
						Momentum is a peer of the master switch, not a child of it: a
						weapon can explode without switching on the bonus machinery.
						It must stay OUTSIDE .sdx-bonus-content, which greys out and
						takes pointer-events: none when the master switch is off.
					-->
					<label class="sdx-toggle-label">
						<input type="checkbox" class="sdx-weapon-momentum-enabled" ${momentum ? "checked" : ""} />
						<span><i class="fas fa-dice-d6"></i> Exploding damage dice (Momentum)</span>
					</label>
					<p class="sdx-section-hint">A damage die rolling its maximum is rolled again and added. Overrides the system's world-wide Momentum Mode, so this weapon explodes even when that setting is off. Works independently of Enable Weapon Bonuses.</p>
				</div>

				<div class="sdx-bonus-content ${enabled ? "" : "sdx-disabled"}">
					<!-- To Hit Bonuses Section -->
					<fieldset class="sdx-bonus-fieldset sdx-hit-bonuses-fieldset">
						<legend><i class="fas fa-bullseye"></i> To Hit Bonuses</legend>
						<p class="sdx-section-hint">Add bonuses to attack rolls with optional requirements. Bonuses without requirements always apply.</p>

						<div class="sdx-hit-bonuses-list">
							${hitBonusesHtml}
						</div>

						<button type="button" class="sdx-add-hit-bonus">
							<i class="fas fa-plus"></i> Add To Hit Bonus
						</button>
					</fieldset>

					<!-- Damage Bonuses Section -->
					<fieldset class="sdx-bonus-fieldset sdx-damage-bonuses-fieldset">
						<legend><i class="fas fa-burst"></i> Damage Bonuses</legend>
						<p class="sdx-section-hint">Add damage bonuses with optional requirements. Bonuses without requirements always apply.</p>

						<div class="sdx-damage-bonuses-list">
							${damageBonusesHtml}
						</div>

						<button type="button" class="sdx-add-damage-bonus">
							<i class="fas fa-plus"></i> Add Damage Bonus
						</button>
					</fieldset>

					<!-- Critical Hit Section -->
					<fieldset class="sdx-bonus-fieldset sdx-critical-bonuses-fieldset">
						<legend><i class="fas fa-crosshairs"></i> Critical Hit Bonuses</legend>

						<div class="sdx-critical-bonus-entry" data-critical-type="dice">
							<div class="sdx-bonus-field">
								<label>Extra Critical Hit Dice</label>
								<input type="text" class="sdx-critical-extra-dice" value="${criticalExtraDice}"
									placeholder="e.g., 1 or 2" />
								<p class="hint">Additional number of damage dice to roll on a critical hit.</p>
							</div>
							<div class="sdx-critical-requirements">
								<div class="sdx-requirements-header">
									<span>Requirements (optional):</span>
									<button type="button" class="sdx-add-critical-requirement" data-critical-type="dice" title="Add requirement">
										<i class="fas fa-plus"></i>
									</button>
								</div>
								<div class="sdx-critical-dice-requirements-list">
									${criticalDiceReqsHtml}
								</div>
							</div>
						</div>

						<div class="sdx-critical-bonus-entry" data-critical-type="damage">
							<div class="sdx-bonus-field">
								<label>Extra Critical Hit Damage</label>
								<input type="text" class="sdx-critical-extra-damage" value="${criticalExtraDamage}"
									placeholder="e.g., 1d6 or @abilities.str.mod" />
								<p class="hint">Additional damage to add on critical hits. Supports formulas.</p>
							</div>
							<div class="sdx-critical-requirements">
								<div class="sdx-requirements-header">
									<span>Requirements (optional):</span>
									<button type="button" class="sdx-add-critical-requirement" data-critical-type="damage" title="Add requirement">
										<i class="fas fa-plus"></i>
									</button>
								</div>
								<div class="sdx-critical-damage-requirements-list">
									${criticalDamageReqsHtml}
								</div>
							</div>
						</div>
					</fieldset>

					<!-- Effects on Hit Section -->
					<fieldset class="sdx-bonus-fieldset">
						<legend><i class="fas fa-magic"></i> Apply Effects on Hit</legend>
						<p class="sdx-section-hint">Drag Effect or Condition items here to apply them when this weapon hits.</p>

						<div class="sdx-effects-drop-area" data-drop-type="effect">
							<div class="sdx-effects-list">
								${effectsHtml}
							</div>
							<div class="sdx-drop-placeholder ${effects.length ? "hidden" : ""}">
								<i class="fas fa-hand-point-down"></i>
								<span>Drop Effect/Condition items here</span>
							</div>
						</div>
					</fieldset>

					<!-- Item Macro Section -->
					${itemMacroHtml}

					<!-- Formula Reference -->
					<fieldset class="sdx-bonus-fieldset sdx-formula-reference">
						<legend><i class="fas fa-book"></i> Formula Reference</legend>
						<div class="sdx-reference-grid">
							<div class="sdx-reference-column">
								<h4>Attacker Stats</h4>
								<code>@abilities.str.mod</code> - STR modifier<br>
								<code>@abilities.dex.mod</code> - DEX modifier<br>
								<code>@abilities.con.mod</code> - CON modifier<br>
								<code>@abilities.int.mod</code> - INT modifier<br>
								<code>@abilities.wis.mod</code> - WIS modifier<br>
								<code>@abilities.cha.mod</code> - CHA modifier<br>
								<code>@details.level</code> - Character level
							</div>
							<div class="sdx-reference-column">
								<h4>Requirement Types</h4>
								<strong>Target Name</strong> - Check target's name<br>
								<strong>Target Condition</strong> - Check target's effects<br>
								<strong>Target HP %</strong> - Target's health percentage<br>
								<strong>Attacker HP %</strong> - Your health percentage<br>
								<strong>Target Ancestry</strong> - Target's ancestry (Players only; NPCs have none)<br>
								<strong>Target Alignment</strong> - Target's alignment (chaotic, neutral, lawful)<br>
								${npcCreatureTypesEnabled() ? "<strong>Target Creature Type</strong> - Target's creature type, e.g. Undead" : ""}
							</div>
						</div>
					</fieldset>
				</div>
			</div>
		</div>
	`;
}

/**
 * Build HTML for a single hit bonus row with its own requirements
 */
function buildHitBonusRowHtml(bonus, index) {
	const formula = bonus.formula || "";
	const label = bonus.label || "";
	const exclusive = bonus.exclusive || false;
	const prompt = bonus.prompt || false;
	const requirements = bonus.requirements || [];

	// Build requirements for this hit bonus
	let reqsHtml = "";
	requirements.forEach((req, reqIndex) => {
		reqsHtml += buildHitBonusRequirementRowHtml(req, index, reqIndex);
	});

	return `
		<div class="sdx-hit-bonus-row" data-index="${index}">
			<div class="sdx-hit-bonus-header">
				<div class="sdx-hit-bonus-inputs">
					<input type="text" class="sdx-hit-bonus-formula" value="${foundry.utils.escapeHTML(formula)}"
						placeholder="e.g., 2 or @abilities.dex.mod" title="To hit bonus" />
					<input type="text" class="sdx-hit-bonus-label" value="${foundry.utils.escapeHTML(label)}"
						placeholder="Label (optional, e.g., vs Undead)" title="Label" />
				</div>
				<button type="button" class="sdx-remove-hit-bonus" data-index="${index}">
					<i class="fas fa-trash"></i>
				</button>
			</div>
			<div class="sdx-hit-bonus-requirements">
				<div class="sdx-hit-bonus-reqs-header">
					<span>Requirements (optional):</span>
					<label class="sdx-exclusive-label" title="If checked and requirements are met, only this bonus applies (ignores other bonuses)">
						<input type="checkbox" class="sdx-hit-bonus-exclusive" data-bonus-index="${index}" ${exclusive ? "checked" : ""} />
						<span>Exclusive</span>
					</label>
					<label class="sdx-prompt-label" title="If checked, this bonus will appear in the attack roll dialog for optional activation">
						<input type="checkbox" class="sdx-hit-bonus-prompt" data-bonus-index="${index}" ${prompt ? "checked" : ""} />
						<span>Prompt</span>
					</label>
					<button type="button" class="sdx-add-hit-bonus-requirement" data-bonus-index="${index}">
						<i class="fas fa-plus"></i>
					</button>
				</div>
				<div class="sdx-hit-bonus-reqs-list" data-bonus-index="${index}">
					${reqsHtml}
				</div>
			</div>
		</div>
	`;
}

/**
 * Build HTML for a requirement row within a hit bonus
 */
function buildHitBonusRequirementRowHtml(req, bonusIndex, reqIndex) {
	const type = req.type || "targetName";
	const operator = req.operator || "contains";
	const value = req.value || "";

	return `
		<div class="sdx-hit-bonus-req-row" data-bonus-index="${bonusIndex}" data-req-index="${reqIndex}">
			<select class="sdx-hit-bonus-req-type">
				${buildOptionsHtml(getRequirementTypeOptions(type), type)}
			</select>
			<select class="sdx-hit-bonus-req-operator">
				${buildOptionsHtml(getOperatorsForType(type), operator)}
			</select>
			${buildRequirementValueHtml("sdx-hit-bonus-req-value", type, value)}
			<button type="button" class="sdx-remove-hit-bonus-requirement" data-bonus-index="${bonusIndex}" data-req-index="${reqIndex}">
				<i class="fas fa-times"></i>
			</button>
		</div>
	`;
}

/**
 * Build HTML for a single damage bonus row with its own requirements
 */
function buildDamageBonusRowHtml(bonus, index) {
	const formula = bonus.formula || "";
	const label = bonus.label || "";
	const exclusive = bonus.exclusive || false;
	const prompt = bonus.prompt || false;
	const requirements = bonus.requirements || [];
	// Usage: null/undefined/"" = permanent, number > 0 = limited uses
	const usage = bonus.usage !== undefined && bonus.usage !== null && bonus.usage !== "" ? bonus.usage : "";

	// Build requirements for this damage bonus
	let reqsHtml = "";
	requirements.forEach((req, reqIndex) => {
		reqsHtml += buildDamageBonusRequirementRowHtml(req, index, reqIndex);
	});

	return `
		<div class="sdx-damage-bonus-row" data-index="${index}">
			<div class="sdx-damage-bonus-header">
				<div class="sdx-damage-bonus-inputs">
					<input type="text" class="sdx-damage-bonus-formula" value="${foundry.utils.escapeHTML(formula)}"
						placeholder="e.g., 1d4 or @abilities.str.mod" title="Damage formula" />
					<input type="text" class="sdx-damage-bonus-label" value="${foundry.utils.escapeHTML(label)}"
						placeholder="Label (optional, e.g., vs Undead)" title="Label" />
					<select class="sdx-damage-bonus-type" title="Damage Type">
						<option value="" ${!bonus.damageType ? "selected" : ""}>Standard Damage</option>
						<option value="bludgeoning" ${bonus.damageType === "bludgeoning" ? "selected" : ""}>Bludgeoning</option>
						<option value="slashing" ${bonus.damageType === "slashing" ? "selected" : ""}>Slashing</option>
						<option value="piercing" ${bonus.damageType === "piercing" ? "selected" : ""}>Piercing</option>
						<option value="physical" ${bonus.damageType === "physical" ? "selected" : ""}>Physical (Generic)</option>
						<option value="fire" ${bonus.damageType === "fire" ? "selected" : ""}>Fire</option>
						<option value="cold" ${bonus.damageType === "cold" ? "selected" : ""}>Cold</option>
						<option value="lightning" ${bonus.damageType === "lightning" ? "selected" : ""}>Lightning</option>
						<option value="acid" ${bonus.damageType === "acid" ? "selected" : ""}>Acid</option>
						<option value="poison" ${bonus.damageType === "poison" ? "selected" : ""}>Poison</option>
						<option value="necrotic" ${bonus.damageType === "necrotic" ? "selected" : ""}>Necrotic</option>
						<option value="radiant" ${bonus.damageType === "radiant" ? "selected" : ""}>Radiant</option>
						<option value="psychic" ${bonus.damageType === "psychic" ? "selected" : ""}>Psychic</option>
						<option value="force" ${bonus.damageType === "force" ? "selected" : ""}>Force</option>
					</select>
					<input type="number" class="sdx-damage-bonus-usage" value="${usage}" min="0" step="1"
						placeholder="∞" title="${game.i18n.localize("SHADOWDARK_EXTRAS.weaponBonus.usage.tooltip")}" />
				</div>
				<button type="button" class="sdx-remove-damage-bonus" data-index="${index}">
					<i class="fas fa-trash"></i>
				</button>
			</div>
			<div class="sdx-damage-bonus-requirements">
				<div class="sdx-damage-bonus-reqs-header">
					<span>Requirements (optional):</span>
					<label class="sdx-exclusive-label" title="If checked and requirements are met, only this bonus applies (ignores other bonuses)">
						<input type="checkbox" class="sdx-damage-bonus-exclusive" data-bonus-index="${index}" ${exclusive ? "checked" : ""} />
						<span>Exclusive</span>
					</label>
					<label class="sdx-prompt-label" title="If checked, this bonus will appear in the attack roll dialog for optional activation">
						<input type="checkbox" class="sdx-damage-bonus-prompt" data-bonus-index="${index}" ${prompt ? "checked" : ""} />
						<span>Prompt</span>
					</label>
					<button type="button" class="sdx-add-damage-bonus-requirement" data-bonus-index="${index}">
						<i class="fas fa-plus"></i>
					</button>
				</div>
				<div class="sdx-damage-bonus-reqs-list" data-bonus-index="${index}">
					${reqsHtml}
				</div>
			</div>
		</div>
	`;
}

/**
 * Build HTML for a requirement row within a damage bonus
 */
function buildDamageBonusRequirementRowHtml(req, bonusIndex, reqIndex) {
	const type = req.type || "targetName";
	const operator = req.operator || "contains";
	const value = req.value || "";

	return `
		<div class="sdx-damage-bonus-req-row" data-bonus-index="${bonusIndex}" data-req-index="${reqIndex}">
			<select class="sdx-damage-bonus-req-type">
				${buildOptionsHtml(getRequirementTypeOptions(type), type)}
			</select>
			<select class="sdx-damage-bonus-req-operator">
				${buildOptionsHtml(getOperatorsForType(type), operator)}
			</select>
			${buildRequirementValueHtml("sdx-damage-bonus-req-value", type, value)}
			<button type="button" class="sdx-remove-damage-bonus-requirement" data-bonus-index="${bonusIndex}" data-req-index="${reqIndex}">
				<i class="fas fa-times"></i>
			</button>
		</div>
	`;
}

/**
 * Build HTML for a critical bonus requirement row
 * @param {Object} req - The requirement object
 * @param {string} criticalType - Either 'dice' or 'damage'
 * @param {number} reqIndex - The requirement index
 */
function buildCriticalRequirementRowHtml(req, criticalType, reqIndex) {
	const type = req.type || "targetName";
	const operator = req.operator || "contains";
	const value = req.value || "";

	return `
		<div class="sdx-critical-req-row" data-critical-type="${criticalType}" data-req-index="${reqIndex}">
			<select class="sdx-critical-req-type">
				${buildOptionsHtml(getRequirementTypeOptions(type), type)}
			</select>
			<select class="sdx-critical-req-operator">
				${buildOptionsHtml(getOperatorsForType(type), operator)}
			</select>
			${buildRequirementValueHtml("sdx-critical-req-value", type, value)}
			<button type="button" class="sdx-remove-critical-requirement" data-critical-type="${criticalType}" data-req-index="${reqIndex}">
				<i class="fas fa-times"></i>
			</button>
		</div>
	`;
}

/**
 * Get operators available for a requirement type
 */
function getOperatorsForType(type) {
	if (type === "targetHpPercent" || type === "attackerHpPercent") {
		return [
			{ value: "lessThan", label: "Less than" },
			{ value: "lessThanOrEqual", label: "Less than or equal" },
			{ value: "greaterThan", label: "Greater than" },
			{ value: "greaterThanOrEqual", label: "Greater than or equal" },
			{ value: "equals", label: "Equals" },
		];
	}

	return [
		{ value: "contains", label: "Contains" },
		{ value: "equals", label: "Equals" },
		{ value: "startsWith", label: "Starts with" },
		{ value: "endsWith", label: "Ends with" },
		{ value: "notContains", label: "Does not contain" },
		{ value: "notEquals", label: "Does not equal" },
	];
}

/**
 * Get placeholder text for a requirement type
 */
function getPlaceholderForType(type) {
	switch (type) {
		case "targetName": return "e.g., Orc, Goblin, Skeleton";
		case "targetCondition": return "e.g., Frightened, Paralyzed";
		case "targetHpPercent": return "e.g., 30";
		case "attackerHpPercent": return "e.g., 50";
		case "targetAncestry": return "e.g., Dwarf, Elf, Human";
		case "targetAlignment": return "e.g., chaotic, neutral, lawful";
		case "targetSubtype": return "e.g., Beast, Ooze, Undead";
		case "attackerCondition": return "e.g., Blessed, Inspired";
		default: return "";
	}
}

/**
 * Build HTML for a single effect row
 */
function buildEffectRowHtml(effect, index) {
	const uuid = effect.uuid || "";
	const name = effect.name || "Unknown Effect";
	const img = effect.img || "icons/svg/aura.svg";
	const escapedName = foundry.utils.escapeHTML(name);
	const escapedImg = foundry.utils.escapeHTML(img);
	const chance = effect.chance ?? 100;
	// Default to true for backward compatibility
	const applyToTarget = effect.applyToTarget !== false;
	// Default to true for backward compatibility (stack effects)
	const cumulative = effect.cumulative !== false;
	const requirements = effect.requirements || [];

	// Build mini requirements for this effect
	let effectReqsHtml = "";
	requirements.forEach((req, reqIndex) => {
		effectReqsHtml += buildEffectRequirementRowHtml(req, index, reqIndex);
	});

	return `
		<div class="sdx-effect-row" data-index="${index}" data-uuid="${uuid}">
			<div class="sdx-effect-header">
				<img src="${escapedImg}" class="sdx-effect-img" />
				<span class="sdx-effect-name">${escapedName}</span>
				<div class="sdx-effect-chance">
					<label>Chance:</label>
					<input type="number" class="sdx-effect-chance-input" value="${chance}" min="0" max="100" />
					<span>%</span>
				</div>
				<button type="button" class="sdx-remove-effect" data-index="${index}">
					<i class="fas fa-trash"></i>
				</button>
			</div>
			<div class="sdx-effect-apply-to">
				<span class="sdx-apply-to-label">Apply to:</span>
				<label class="sdx-radio-label">
					<input type="radio" name="sdx-effect-apply-to-${index}" class="sdx-effect-apply-to-radio"
					       data-effect-index="${index}" value="target" ${applyToTarget ? "checked" : ""} />
					<i class="fas fa-crosshairs"></i> Target
				</label>
				<label class="sdx-radio-label">
					<input type="radio" name="sdx-effect-apply-to-${index}" class="sdx-effect-apply-to-radio"
					       data-effect-index="${index}" value="attacker" ${!applyToTarget ? "checked" : ""} />
					<i class="fas fa-user"></i> Attacker
				</label>
				<span class="sdx-effect-separator">|</span>
				<label class="sdx-checkbox-label" title="If unchecked, won't apply if target already has this condition">
					<input type="checkbox" class="sdx-effect-cumulative-checkbox" data-effect-index="${index}" ${cumulative ? "checked" : ""} />
					<i class="fas fa-layer-group"></i> Cumulative
				</label>
			</div>
			<div class="sdx-effect-requirements">
				<div class="sdx-effect-reqs-header">
					<span>Application Requirements (optional):</span>
					<button type="button" class="sdx-add-effect-requirement" data-effect-index="${index}">
						<i class="fas fa-plus"></i>
					</button>
				</div>
				<div class="sdx-effect-reqs-list" data-effect-index="${index}">
					${effectReqsHtml}
				</div>
			</div>
		</div>
	`;
}

/**
 * Build HTML for a requirement row within an effect
 */
function buildEffectRequirementRowHtml(req, effectIndex, reqIndex) {
	const type = req.type || "targetName";
	const operator = req.operator || "contains";
	const value = req.value || "";

	return `
		<div class="sdx-effect-req-row" data-effect-index="${effectIndex}" data-req-index="${reqIndex}">
			<select class="sdx-effect-req-type">
				${buildOptionsHtml(getRequirementTypeOptions(type), type)}
			</select>
			<select class="sdx-effect-req-operator">
				${buildOptionsHtml(getOperatorsForType(type), operator)}
			</select>
			${buildRequirementValueHtml("sdx-effect-req-value", type, value)}
			<button type="button" class="sdx-remove-effect-requirement" data-effect-index="${effectIndex}" data-req-index="${reqIndex}">
				<i class="fas fa-times"></i>
			</button>
		</div>
	`;
}

/**
 * Build HTML for the Item Macro section
 * @param {Object} itemMacro - The item macro configuration
 * @param {boolean} moduleActive - Whether the Item Macro module is active
 * @returns {string} - HTML string
 */
function buildItemMacroSectionHtml(itemMacro, macroCommand) {
	const runAsGm = itemMacro.runAsGm || false;
	const triggers = itemMacro.triggers || [];

	// Define available triggers
	const triggerOptions = [
		{ value: "beforeAttack", label: "Run macro before attack roll", icon: "fa-hourglass-start" },
		{ value: "onHit", label: "Run macro if hit", icon: "fa-bullseye" },
		{ value: "onCritical", label: "Run macro if critical hit", icon: "fa-burst" },
		{ value: "onMiss", label: "Run macro if miss", icon: "fa-times-circle" },
		{ value: "onCriticalMiss", label: "Run macro if critical miss", icon: "fa-skull" },
		{ value: "onEquip", label: "Run macro on equip", icon: "fa-hand-holding" },
		{ value: "onUnequip", label: "Run macro on unequip", icon: "fa-hand" },
	];

	// Build trigger checkboxes
	const triggerCheckboxesHtml = triggerOptions.map(opt => `
		<label class="sdx-macro-trigger-option">
			<input type="checkbox" class="sdx-macro-trigger-checkbox" value="${opt.value}"
				${triggers.includes(opt.value) ? "checked" : ""} />
			<i class="fas ${opt.icon}"></i>
			<span>${opt.label}</span>
		</label>
	`).join("");

	return `
		<fieldset class="sdx-bonus-fieldset sdx-item-macro-fieldset">
			<legend><i class="fas fa-scroll"></i> Item Macro</legend>
			<p class="sdx-section-hint">Configure when to execute this weapon's Item Macro during combat.</p>

			<div class="sdx-macro-editor-section">
				<label class="sdx-triggers-label">Macro Command (JavaScript):</label>
				<textarea class="sdx-item-macro-command"
					placeholder="// Write your macro here... (actor, token, item, args are available)"
					spellcheck="false">${macroCommand}</textarea>
			</div>

			<div class="sdx-macro-gm-toggle">
				<label class="sdx-toggle-label">
					<input type="checkbox" class="sdx-macro-run-as-gm" ${runAsGm ? "checked" : ""} />
					<i class="fas fa-crown"></i>
					<span>Run macro as GM</span>
				</label>
				<p class="hint">Execute the macro with GM permissions using socketlib.</p>
			</div>

			<div class="sdx-macro-triggers-section">
				<label class="sdx-triggers-label">Execute macro on:</label>
				<div class="sdx-macro-trigger-grid">
					${triggerCheckboxesHtml}
				</div>
			</div>

			<details class="sdx-macro-guide">
				<summary><i class="fas fa-book-open"></i> Macro Development Guide</summary>
				<div class="sdx-macro-guide-content">
					<h4>Available Arguments</h4>
					<p>Item Macro provides these variables to your macro:</p>
					<pre><code>// Standard Item Macro variables:
item          // The weapon item
actor         // The attacking actor
token         // The attacker's token
speaker       // ChatMessage speaker data
character     // The user's assigned character

// SDX-specific data in args:
args.isHit        // Boolean - did the attack hit?
args.isMiss       // Boolean - did the attack miss?
args.isCritical   // Boolean - was it a critical hit?
args.isCriticalMiss // Boolean - was it a critical miss?
args.rollResult   // Attack roll result (total)
args.rollData     // Full roll data object
args.trigger      // String - which trigger fired
args.targets      // Array of targeted tokens
args.target       // First target token
args.targetActor  // First target's actor</code></pre>

					<h4>Example: Play Effect on Critical Hit</h4>
					<pre><code>if (args.isCritical && token) {
  new Sequence()
    .effect()
    .file("jb2a.divine_smite.caster.yellowwhite")
    .atLocation(token)
    .play();
}</code></pre>

					<h4>Example: Extra Damage vs Undead</h4>
					<pre><code>if (args.isHit) {
  const ancestry = args.targetActor?.system?.ancestry?.name;
  if (ancestry?.toLowerCase().includes("undead")) {
    ChatMessage.create({
      content: \`\${item.name} burns the undead!\`,
      speaker: speaker
    });
  }
}</code></pre>

					<h4>Example: Heal on Kill (requires GM execution)</h4>
					<pre><code>if (args.isHit && args.targetActor) {
  const hp = args.targetActor.system.attributes.hp;
  if (hp.value <= 0) {
    const healing = 5;
    const current = actor.system.attributes.hp.value;
    const max = actor.system.attributes.hp.max;
    await actor.update({
      "system.attributes.hp.value": Math.min(max, current + healing)
    });
    ui.notifications.info(\`Healed \${healing} HP!\`);
  }
}</code></pre>
				</div>
			</details>
		</fieldset>
	`;
}

/**
 * Activate event listeners for the Bonuses tab
 */
function activateWeaponBonusListeners(html, app, item) {
	const $tab = html.find('[data-tab="tab-bonuses"]');
	if (!$tab.length) {
		console.log(`${MODULE_ID} | Could not find bonuses tab for listeners`);
		return;
	}

	console.log(`${MODULE_ID} | Activating weapon bonus listeners`);

	// Enable/disable toggle
	$tab.find(".sdx-weapon-bonus-enabled").on("change", async function() {
		const enabled = $(this).is(":checked");
		const $content = $tab.find(".sdx-bonus-content");

		if (enabled) {
			$content.removeClass("sdx-disabled");
		}
		else {
			$content.addClass("sdx-disabled");
		}

		await saveWeaponBonusConfig(item, { enabled });
	});

	// Momentum (exploding damage dice) toggle
	$tab.find(".sdx-weapon-momentum-enabled").on("change", async function() {
		await saveWeaponBonusConfig(item, { momentum: $(this).is(":checked") });
	});

	// Critical hit fields - debounced save
	let saveTimeout;
	$tab.find(".sdx-critical-extra-dice, .sdx-critical-extra-damage").on("input", function() {
		clearTimeout(saveTimeout);
		saveTimeout = setTimeout(async () => {
			await saveCriticalBonusFields($tab, item);
		}, 500);
	});

	$tab.find(".sdx-critical-extra-dice, .sdx-critical-extra-damage").on("blur", async function() {
		clearTimeout(saveTimeout);
		await saveCriticalBonusFields($tab, item);
	});

	// ========== CRITICAL REQUIREMENTS LISTENERS ==========

	// Add critical requirement
	$tab.on("click", ".sdx-add-critical-requirement", async function(e) {
		e.preventDefault();
		e.stopPropagation();
		const criticalType = $(this).data("critical-type");
		const currentFlags = item.flags?.[MODULE_ID]?.weaponBonus || getDefaultWeaponBonusConfig();

		const reqKey = criticalType === "dice" ? "criticalDiceRequirements" : "criticalDamageRequirements";
		const requirements = currentFlags[reqKey] || [];
		requirements.push({
			type: "targetName",
			operator: "contains",
			value: "",
		});

		await saveWeaponBonusConfig(item, { [reqKey]: requirements });
		app._shadowdarkExtrasActiveTab = "tab-bonuses";
		app.render(false);
	});

	// Remove critical requirement
	$tab.on("click", ".sdx-remove-critical-requirement", async function(e) {
		e.preventDefault();
		e.stopPropagation();
		const criticalType = $(this).data("critical-type");
		const reqIndex = parseInt($(this).data("req-index"));
		const currentFlags = item.flags?.[MODULE_ID]?.weaponBonus || getDefaultWeaponBonusConfig();

		const reqKey = criticalType === "dice" ? "criticalDiceRequirements" : "criticalDamageRequirements";
		const requirements = currentFlags[reqKey] || [];
		requirements.splice(reqIndex, 1);

		await saveWeaponBonusConfig(item, { [reqKey]: requirements });
		app._shadowdarkExtrasActiveTab = "tab-bonuses";
		app.render(false);
	});

	// Critical requirement changes - immediate save on select/input change
	$tab.on("change", ".sdx-critical-req-type, .sdx-critical-req-operator", async function() {
		await saveCriticalRequirementsFromDom($tab, item);
		if ($(this).hasClass("sdx-critical-req-type")) rerenderBonusesTab(app);
	});

	$tab.on("input", ".sdx-critical-req-value", function() {
		clearTimeout(saveTimeout);
		saveTimeout = setTimeout(async () => {
			await saveCriticalRequirementsFromDom($tab, item);
		}, 500);
	});

	$tab.on("blur", ".sdx-critical-req-value", async function() {
		clearTimeout(saveTimeout);
		await saveCriticalRequirementsFromDom($tab, item);
	});

	// ========== HIT BONUS LISTENERS ==========

	// Add hit bonus button
	$tab.find(".sdx-add-hit-bonus").on("click", async function(e) {
		e.preventDefault();
		e.stopPropagation();
		const currentFlags = item.flags?.[MODULE_ID]?.weaponBonus || getDefaultWeaponBonusConfig();
		const hitBonuses = currentFlags.hitBonuses || [];
		hitBonuses.push({
			formula: "",
			label: "",
			requirements: [],
		});
		await saveWeaponBonusConfig(item, { hitBonuses });
		app._shadowdarkExtrasActiveTab = "tab-bonuses";
		app.render(false);
	});

	// Remove hit bonus button
	$tab.on("click", ".sdx-remove-hit-bonus", async function(e) {
		e.preventDefault();
		e.stopPropagation();
		const index = parseInt($(this).data("index"));
		const currentFlags = item.flags?.[MODULE_ID]?.weaponBonus || getDefaultWeaponBonusConfig();
		const hitBonuses = currentFlags.hitBonuses || [];
		hitBonuses.splice(index, 1);
		await saveWeaponBonusConfig(item, { hitBonuses });
		app._shadowdarkExtrasActiveTab = "tab-bonuses";
		app.render(false);
	});

	// Hit bonus formula/label change - debounced save
	$tab.on("input", ".sdx-hit-bonus-formula, .sdx-hit-bonus-label", function() {
		clearTimeout(saveTimeout);
		saveTimeout = setTimeout(async () => {
			await saveHitBonusesFromDom($tab, item);
		}, 500);
	});

	$tab.on("blur", ".sdx-hit-bonus-formula, .sdx-hit-bonus-label", async function() {
		clearTimeout(saveTimeout);
		await saveHitBonusesFromDom($tab, item);
	});

	// Add hit bonus requirement
	$tab.on("click", ".sdx-add-hit-bonus-requirement", async function(e) {
		e.preventDefault();
		e.stopPropagation();
		const bonusIndex = parseInt($(this).data("bonus-index"));
		const currentFlags = item.flags?.[MODULE_ID]?.weaponBonus || getDefaultWeaponBonusConfig();
		const hitBonuses = currentFlags.hitBonuses || [];

		if (hitBonuses[bonusIndex]) {
			hitBonuses[bonusIndex].requirements = hitBonuses[bonusIndex].requirements || [];
			hitBonuses[bonusIndex].requirements.push({
				type: "targetName",
				operator: "contains",
				value: "",
			});
			await saveWeaponBonusConfig(item, { hitBonuses });
			app._shadowdarkExtrasActiveTab = "tab-bonuses";
			app.render(false);
		}
	});

	// Remove hit bonus requirement
	$tab.on("click", ".sdx-remove-hit-bonus-requirement", async function(e) {
		e.preventDefault();
		e.stopPropagation();
		const bonusIndex = parseInt($(this).data("bonus-index"));
		const reqIndex = parseInt($(this).data("req-index"));
		const currentFlags = item.flags?.[MODULE_ID]?.weaponBonus || getDefaultWeaponBonusConfig();
		const hitBonuses = currentFlags.hitBonuses || [];

		if (hitBonuses[bonusIndex]?.requirements) {
			hitBonuses[bonusIndex].requirements.splice(reqIndex, 1);
			await saveWeaponBonusConfig(item, { hitBonuses });
			app._shadowdarkExtrasActiveTab = "tab-bonuses";
			app.render(false);
		}
	});

	// Hit bonus requirement type/operator/value change
	$tab.on("change", ".sdx-hit-bonus-req-type, .sdx-hit-bonus-req-operator, .sdx-hit-bonus-req-value", async function() {
		await saveHitBonusesFromDom($tab, item);
		if ($(this).hasClass("sdx-hit-bonus-req-type")) rerenderBonusesTab(app);
	});

	// Hit bonus exclusive checkbox change
	$tab.on("change", ".sdx-hit-bonus-exclusive", async function() {
		if ($(this).is(":checked")) {
			// Uncheck all other exclusive checkboxes for hit bonuses
			$tab.find(".sdx-hit-bonus-exclusive").not(this).prop("checked", false);
		}
		await saveHitBonusesFromDom($tab, item);
	});

	// Hit bonus prompt checkbox change
	$tab.on("change", ".sdx-hit-bonus-prompt", async function() {
		await saveHitBonusesFromDom($tab, item);
	});

	// ========== DAMAGE BONUS LISTENERS ==========

	// Add damage bonus button
	$tab.find(".sdx-add-damage-bonus").on("click", async function(e) {
		e.preventDefault();
		e.stopPropagation();
		const currentFlags = item.flags?.[MODULE_ID]?.weaponBonus || getDefaultWeaponBonusConfig();
		const damageBonuses = currentFlags.damageBonuses || [];
		damageBonuses.push({
			formula: "",
			label: "",
			requirements: [],
		});
		await saveWeaponBonusConfig(item, { damageBonuses });
		app._shadowdarkExtrasActiveTab = "tab-bonuses";
		app.render(false);
	});

	// Remove damage bonus button
	$tab.on("click", ".sdx-remove-damage-bonus", async function(e) {
		e.preventDefault();
		e.stopPropagation();
		const index = parseInt($(this).data("index"));
		const currentFlags = item.flags?.[MODULE_ID]?.weaponBonus || getDefaultWeaponBonusConfig();
		const damageBonuses = currentFlags.damageBonuses || [];
		damageBonuses.splice(index, 1);
		await saveWeaponBonusConfig(item, { damageBonuses });
		app._shadowdarkExtrasActiveTab = "tab-bonuses";
		app.render(false);
	});

	// Damage bonus formula/label change - debounced save
	$tab.on("input", ".sdx-damage-bonus-formula, .sdx-damage-bonus-label", function() {
		clearTimeout(saveTimeout);
		saveTimeout = setTimeout(async () => {
			await saveDamageBonusesFromDom($tab, item);
		}, 500);
	});

	$tab.on("blur", ".sdx-damage-bonus-formula, .sdx-damage-bonus-label", async function() {
		clearTimeout(saveTimeout);
		await saveDamageBonusesFromDom($tab, item);
	});

	// Damage bonus type change
	$tab.on("change", ".sdx-damage-bonus-type", async function() {
		await saveDamageBonusesFromDom($tab, item);
	});

	// Damage bonus usage change
	$tab.on("change", ".sdx-damage-bonus-usage", async function() {
		await saveDamageBonusesFromDom($tab, item);
	});

	// Add damage bonus requirement
	$tab.on("click", ".sdx-add-damage-bonus-requirement", async function(e) {
		e.preventDefault();
		e.stopPropagation();
		const bonusIndex = parseInt($(this).data("bonus-index"));
		const currentFlags = item.flags?.[MODULE_ID]?.weaponBonus || getDefaultWeaponBonusConfig();
		const damageBonuses = currentFlags.damageBonuses || [];

		if (damageBonuses[bonusIndex]) {
			damageBonuses[bonusIndex].requirements = damageBonuses[bonusIndex].requirements || [];
			damageBonuses[bonusIndex].requirements.push({
				type: "targetName",
				operator: "contains",
				value: "",
			});
			await saveWeaponBonusConfig(item, { damageBonuses });
			app._shadowdarkExtrasActiveTab = "tab-bonuses";
			app.render(false);
		}
	});

	// Remove damage bonus requirement
	$tab.on("click", ".sdx-remove-damage-bonus-requirement", async function(e) {
		e.preventDefault();
		e.stopPropagation();
		const bonusIndex = parseInt($(this).data("bonus-index"));
		const reqIndex = parseInt($(this).data("req-index"));
		const currentFlags = item.flags?.[MODULE_ID]?.weaponBonus || getDefaultWeaponBonusConfig();
		const damageBonuses = currentFlags.damageBonuses || [];

		if (damageBonuses[bonusIndex]?.requirements) {
			damageBonuses[bonusIndex].requirements.splice(reqIndex, 1);
			await saveWeaponBonusConfig(item, { damageBonuses });
			app._shadowdarkExtrasActiveTab = "tab-bonuses";
			app.render(false);
		}
	});

	// Damage bonus requirement type/operator/value change
	$tab.on("change", ".sdx-damage-bonus-req-type, .sdx-damage-bonus-req-operator, .sdx-damage-bonus-req-value", async function() {
		await saveDamageBonusesFromDom($tab, item);
		if ($(this).hasClass("sdx-damage-bonus-req-type")) rerenderBonusesTab(app);
	});

	// Exclusive checkbox change - only one can be exclusive at a time
	$tab.on("change", ".sdx-damage-bonus-exclusive", async function() {
		if ($(this).is(":checked")) {
			// Uncheck all other exclusive checkboxes
			$tab.find(".sdx-damage-bonus-exclusive").not(this).prop("checked", false);
		}
		await saveDamageBonusesFromDom($tab, item);
	});

	// Damage bonus prompt checkbox change
	$tab.on("change", ".sdx-damage-bonus-prompt", async function() {
		await saveDamageBonusesFromDom($tab, item);
	});

	// Effect drop area
	const $dropArea = $tab.find(".sdx-effects-drop-area");
	$dropArea.on("dragover", function(e) {
		e.preventDefault();
		$(this).addClass("sdx-drag-over");
	});

	$dropArea.on("dragleave", function(e) {
		$(this).removeClass("sdx-drag-over");
	});

	$dropArea.on("drop", async function(e) {
		e.preventDefault();
		$(this).removeClass("sdx-drag-over");

		const data = TextEditor.getDragEventData(e.originalEvent);
		if (data?.type !== "Item") {
			ui.notifications.warn("Only items can be dropped here");
			return;
		}

		const droppedItem = await fromUuid(data.uuid);
		if (!droppedItem) {
			ui.notifications.warn("Could not find the dropped item");
			return;
		}

		// Only accept Effect, Condition, or NPC Feature items
		const validTypes = ["Effect", "Condition", "NPC Feature"];
		if (!validTypes.includes(droppedItem.type) && droppedItem.system?.category !== "effect") {
			ui.notifications.warn("Only Effect, Condition, or NPC Feature items can be dropped here");
			return;
		}

		const currentFlags = item.flags?.[MODULE_ID]?.weaponBonus || getDefaultWeaponBonusConfig();
		const effects = currentFlags.effects || [];

		// Check if already added
		if (effects.some(e => e.uuid === data.uuid)) {
			ui.notifications.warn("This effect is already added");
			return;
		}

		effects.push({
			uuid: data.uuid,
			name: droppedItem.name,
			img: droppedItem.img,
			chance: 100,
			applyToTarget: true,
			requirements: [],
		});

		await saveWeaponBonusConfig(item, { effects });
		app._shadowdarkExtrasActiveTab = "tab-bonuses";
		app.render(false);
	});

	// Remove effect button
	$tab.on("click", ".sdx-remove-effect", async function(e) {
		e.preventDefault();
		e.stopPropagation();
		const index = parseInt($(this).data("index"));
		const currentFlags = item.flags?.[MODULE_ID]?.weaponBonus || getDefaultWeaponBonusConfig();
		const effects = currentFlags.effects || [];
		effects.splice(index, 1);
		await saveWeaponBonusConfig(item, { effects });
		app._shadowdarkExtrasActiveTab = "tab-bonuses";
		app.render(false);
	});

	// Effect chance change
	$tab.on("change", ".sdx-effect-chance-input", async function() {
		const $row = $(this).closest(".sdx-effect-row");
		const index = parseInt($row.data("index"));
		const chance = Math.min(100, Math.max(0, parseInt($(this).val()) || 100));

		const currentFlags = item.flags?.[MODULE_ID]?.weaponBonus || getDefaultWeaponBonusConfig();
		const effects = currentFlags.effects || [];
		if (effects[index]) {
			effects[index].chance = chance;
			await saveWeaponBonusConfig(item, { effects });
		}
	});

	// Effect apply-to radio button change
	$tab.on("change", ".sdx-effect-apply-to-radio", async function() {
		const effectIndex = parseInt($(this).data("effect-index"));
		const applyToTarget = $(this).val() === "target";

		const currentFlags = item.flags?.[MODULE_ID]?.weaponBonus || getDefaultWeaponBonusConfig();
		const effects = currentFlags.effects || [];
		if (effects[effectIndex]) {
			effects[effectIndex].applyToTarget = applyToTarget;
			await saveWeaponBonusConfig(item, { effects });
		}
	});

	// Effect cumulative checkbox change
	$tab.on("change", ".sdx-effect-cumulative-checkbox", async function() {
		const effectIndex = parseInt($(this).data("effect-index"));
		const cumulative = $(this).is(":checked");

		const currentFlags = item.flags?.[MODULE_ID]?.weaponBonus || getDefaultWeaponBonusConfig();
		const effects = currentFlags.effects || [];
		if (effects[effectIndex]) {
			effects[effectIndex].cumulative = cumulative;
			await saveWeaponBonusConfig(item, { effects });
		}
	});

	// Add effect requirement
	$tab.on("click", ".sdx-add-effect-requirement", async function(e) {
		e.preventDefault();
		e.stopPropagation();
		const effectIndex = parseInt($(this).data("effect-index"));
		const currentFlags = item.flags?.[MODULE_ID]?.weaponBonus || getDefaultWeaponBonusConfig();
		const effects = currentFlags.effects || [];

		if (effects[effectIndex]) {
			effects[effectIndex].requirements = effects[effectIndex].requirements || [];
			effects[effectIndex].requirements.push({
				type: "targetName",
				operator: "contains",
				value: "",
			});
			await saveWeaponBonusConfig(item, { effects });
			app._shadowdarkExtrasActiveTab = "tab-bonuses";
			app.render(false);
		}
	});

	// Remove effect requirement
	$tab.on("click", ".sdx-remove-effect-requirement", async function(e) {
		e.preventDefault();
		e.stopPropagation();
		const effectIndex = parseInt($(this).data("effect-index"));
		const reqIndex = parseInt($(this).data("req-index"));
		const currentFlags = item.flags?.[MODULE_ID]?.weaponBonus || getDefaultWeaponBonusConfig();
		const effects = currentFlags.effects || [];

		if (effects[effectIndex]?.requirements) {
			effects[effectIndex].requirements.splice(reqIndex, 1);
			await saveWeaponBonusConfig(item, { effects });
			app._shadowdarkExtrasActiveTab = "tab-bonuses";
			app.render(false);
		}
	});

	// Effect requirement changes
	$tab.on("change", ".sdx-effect-req-type, .sdx-effect-req-operator, .sdx-effect-req-value", async function() {
		await saveEffectRequirementsFromDom($tab, item);
		if ($(this).hasClass("sdx-effect-req-type")) rerenderBonusesTab(app);
	});

	if (isFeatureEnabled(FEATURE_IDS.ITEM_MACROS)) {
		// ========== ITEM MACRO LISTENERS ==========

		// Item Macro: Run as GM toggle
		$tab.on("change", ".sdx-macro-run-as-gm", async function() {
			const runAsGm = $(this).is(":checked");
			const currentFlags = item.flags?.[MODULE_ID]?.weaponBonus
				|| getDefaultWeaponBonusConfig();
			const itemMacro = currentFlags.itemMacro || {
				enabled: false,
				runAsGm: false,
				triggers: [],
			};
			itemMacro.runAsGm = runAsGm;
			await saveWeaponBonusConfig(item, { itemMacro });
		});

		// Item Macro: Command text change - debounced save
		$tab.on("input", ".sdx-item-macro-command", function() {
			clearTimeout(saveTimeout);
			saveTimeout = setTimeout(async () => {
				const command = $(this).val();
				await item.setFlag(MODULE_ID, "macroCommand", command);
			}, 500);
		});

		$tab.on("blur", ".sdx-item-macro-command", async function() {
			clearTimeout(saveTimeout);
			const command = $(this).val();
			await item.setFlag(MODULE_ID, "macroCommand", command);
		});

		// Item Macro: Trigger checkboxes
		$tab.on("change", ".sdx-macro-trigger-checkbox", async function() {
			const currentFlags = item.flags?.[MODULE_ID]?.weaponBonus
				|| getDefaultWeaponBonusConfig();
			const itemMacro = currentFlags.itemMacro || {
				enabled: false,
				runAsGm: false,
				triggers: [],
			};

			// Collect all checked triggers
			const triggers = [];
			$tab.find(".sdx-macro-trigger-checkbox:checked").each(function() {
				triggers.push($(this).val());
			});

			itemMacro.triggers = triggers;
			// Enable item macro if any triggers are selected
			itemMacro.enabled = triggers.length > 0;
			await saveWeaponBonusConfig(item, { itemMacro });
		});
	}
}

/**
 * Save critical hit bonus fields from the form
 */
async function saveCriticalBonusFields($tab, item) {
	const criticalExtraDice = $tab.find(".sdx-critical-extra-dice").val() || "";
	const criticalExtraDamage = $tab.find(".sdx-critical-extra-damage").val() || "";

	await saveWeaponBonusConfig(item, {
		criticalExtraDice,
		criticalExtraDamage,
	});
}

/**
 * Save critical requirements from DOM
 */
async function saveCriticalRequirementsFromDom($tab, item) {
	const criticalDiceRequirements = [];
	const criticalDamageRequirements = [];

	$tab.find(".sdx-critical-req-row").each(function() {
		const $row = $(this);
		const criticalType = $row.data("critical-type");
		const req = {
			type: $row.find(".sdx-critical-req-type").val(),
			operator: $row.find(".sdx-critical-req-operator").val(),
			value: $row.find(".sdx-critical-req-value").val(),
		};

		if (criticalType === "dice") {
			criticalDiceRequirements.push(req);
		}
		else {
			criticalDamageRequirements.push(req);
		}
	});

	await saveWeaponBonusConfig(item, {
		criticalDiceRequirements,
		criticalDamageRequirements,
	});
}

/**
 * Save hit bonuses from DOM
 */
async function saveHitBonusesFromDom($tab, item) {
	const hitBonuses = [];
	$tab.find(".sdx-hit-bonus-row").each(function() {
		const $row = $(this);
		const requirements = [];

		$row.find(".sdx-hit-bonus-req-row").each(function() {
			requirements.push({
				type: $(this).find(".sdx-hit-bonus-req-type").val(),
				operator: $(this).find(".sdx-hit-bonus-req-operator").val(),
				value: $(this).find(".sdx-hit-bonus-req-value").val(),
			});
		});

		hitBonuses.push({
			formula: $row.find(".sdx-hit-bonus-formula").val() || "",
			label: $row.find(".sdx-hit-bonus-label").val() || "",
			exclusive: $row.find(".sdx-hit-bonus-exclusive").is(":checked"),
			prompt: $row.find(".sdx-hit-bonus-prompt").is(":checked"),
			requirements: requirements,
		});
	});
	await saveWeaponBonusConfig(item, { hitBonuses });
}

/**
 * Save damage bonuses from DOM
 */
async function saveDamageBonusesFromDom($tab, item) {
	const damageBonuses = [];
	$tab.find(".sdx-damage-bonus-row").each(function() {
		const $row = $(this);
		const requirements = [];

		$row.find(".sdx-damage-bonus-req-row").each(function() {
			requirements.push({
				type: $(this).find(".sdx-damage-bonus-req-type").val(),
				operator: $(this).find(".sdx-damage-bonus-req-operator").val(),
				value: $(this).find(".sdx-damage-bonus-req-value").val(),
			});
		});

		// Parse usage: empty string = null (permanent), otherwise parse as integer
		const usageVal = $row.find(".sdx-damage-bonus-usage").val();
		const usage = usageVal === "" || usageVal === undefined ? null : parseInt(usageVal, 10);

		damageBonuses.push({
			formula: $row.find(".sdx-damage-bonus-formula").val() || "",
			label: $row.find(".sdx-damage-bonus-label").val() || "",
			damageType: $row.find(".sdx-damage-bonus-type").val() || "",
			exclusive: $row.find(".sdx-damage-bonus-exclusive").is(":checked"),
			prompt: $row.find(".sdx-damage-bonus-prompt").is(":checked"),
			requirements: requirements,
			usage: usage,
		});
	});
	await saveWeaponBonusConfig(item, { damageBonuses });
}

/**
 * Save effect requirements from DOM
 */
async function saveEffectRequirementsFromDom($tab, item) {
	const currentFlags = item.flags?.[MODULE_ID]?.weaponBonus || getDefaultWeaponBonusConfig();
	const effects = currentFlags.effects || [];

	$tab.find(".sdx-effect-row").each(function() {
		const effectIndex = parseInt($(this).data("index"));
		if (effects[effectIndex]) {
			const requirements = [];
			$(this).find(".sdx-effect-req-row").each(function() {
				requirements.push({
					type: $(this).find(".sdx-effect-req-type").val(),
					operator: $(this).find(".sdx-effect-req-operator").val(),
					value: $(this).find(".sdx-effect-req-value").val(),
				});
			});
			effects[effectIndex].requirements = requirements;
		}
	});

	await saveWeaponBonusConfig(item, { effects });
}

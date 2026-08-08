/**
 * The root's ENHANCED HEADER section, moved verbatim.
 *
 * The character-sheet header: XP/level display, the header customisation and
 * background controls, the party-sheet variant, and the Add Coins and Trade
 * buttons.
 *
 * The last of the big sheet sections, and the one with the most inbound
 * dependencies — it was blocked twice over. ENHANCED INVENTORY TAB had to move
 * first for HP_QUICK_ADJUST_TOOLTIP/setActorHpValue/applyHpQuickAdjust, and
 * PLAYER-TO-PLAYER TRANSFERS for showCoinTransferDialog/transferCoinsToPlayer.
 *
 * Five of the nine functions are exported; getXpForNextLevel,
 * applyHeaderBackground, applyPartyHeaderBackground and showAddCoinsDialog
 * have no callers outside this file and stay private.
 *
 * `FilePicker` is declared locally as the same two-line v13+ shim nine other
 * modules already carry, rather than imported from the root — that is the
 * convention this track settled on in PR #15's sheet extractions.
 *
 * Zero registrations, so the registration snapshot is untouched.
 */

// v13+ FilePicker namespaced under foundry.applications.apps.
const FilePicker = foundry.applications.apps.FilePicker?.implementation ?? globalThis.FilePicker;

import { MODULE_ID } from "../shared/module-id.mjs";
import { getHpWaveColor, isHpWavesEnabled } from "./HpWavesSettingsSD.mjs";
import { HP_QUICK_ADJUST_TOOLTIP, setActorHpValue, applyHpQuickAdjust } from "./enhanced-inventory-tab.mjs";
import { showCoinTransferDialog, transferCoinsToPlayer } from "../inventory/player-transfers.mjs";
import { showTradeDialog } from "../inventory/TradeWindowSD.mjs";

// ============================================
// ENHANCED HEADER
// ============================================

/**
 * Inject the enhanced interactive header into player sheets
 * Replaces the default header with HP bar, stats, AC, luck, XP, level display
 */
export async function injectEnhancedHeader(app, html, actor) {
	// Check if enhanced header is enabled
	try {
		if (!game.settings.get(MODULE_ID, "enableEnhancedHeader")) return;
	}
	catch{
		return;
	}

	if (actor.type !== "Player") return;

	const $header = html.find(".SD-header").first();
	if (!$header.length) return;

	// Clean up any existing enhanced content first (in case of re-render)
	$header.find(".sdx-enhanced-content").remove();

	// Mark as enhanced
	$header.addClass("sdx-enhanced-header");

	// Get actor data
	const sys = actor.system;
	const hp = sys.attributes?.hp || { value: 0, max: 0 };
	const ac = sys.attributes?.ac?.value ?? 10;
	const level = sys.level?.value ?? 1;
	const xp = sys.level?.xp ?? 0;
	const xpForNextLevel = getXpForNextLevel(level);
	const xpPercent = xpForNextLevel > 0 ? Math.min(100, (xp / xpForNextLevel) * 100) : 0;
	const levelUp = xp >= xpForNextLevel;

	// Check if pulp mode is enabled
	const usePulpMode = game.settings.get("shadowdark", "usePulpMode");
	const luck = usePulpMode ? (sys.luck?.remaining ?? 0) : (sys.luck?.available ?? false);

	// Get character details - need to fetch actual item names from UUIDs
	let ancestryName = "";
	let className = "";
	let backgroundName = "";

	try {
		if (sys.ancestry) {
			const ancestryItem = await fromUuid(sys.ancestry);
			ancestryName = ancestryItem?.name || "";
		}
		if (sys.class) {
			const classItem = await fromUuid(sys.class);
			className = classItem?.name || "";
		}
		if (sys.background) {
			const backgroundItem = await fromUuid(sys.background);
			backgroundName = backgroundItem?.name || "";
		}
	}
	catch(e) {
		console.warn("shadowdark-extras | Error fetching character details:", e);
	}

	const abilities = sys.abilities || {};
	const abilityOrder = ["str", "dex", "con", "int", "wis", "cha"];

	// Calculate HP percentage for bar
	const hpPercent = hp.max > 0 ? Math.min(100, Math.max(0, (hp.value / hp.max) * 100)) : 0;
	const hpColor = hpPercent > 50 ? "#4ade80" : hpPercent > 25 ? "#fbbf24" : "#ef4444";
	// Wave translate: at 100% HP waves are hidden (translateY 85%), at 0% HP fully visible (translateY 0%)
	const hpWaveTranslate = Math.max(0, Math.round(hpPercent) - 15);
	const hpWaveClass = hpPercent >= 100 ? "hp-full" : (hpPercent <= 0 ? "hp-dead" : "");
	// Get wave color based on ancestry settings (pass resolved ancestryName)
	const hpWaveColor = getHpWaveColor(actor, ancestryName);
	const hpWavesEnabled = isHpWavesEnabled();

	// Build abilities HTML
	let abilitiesHtml = "";
	for (const key of abilityOrder) {
		const ab = abilities[key] || {};
		const value = ab.value ?? 10;
		const mod = ab.mod ?? Math.floor((value - 10) / 2);
		const modSign = mod >= 0 ? "+" : "";

		abilitiesHtml += `
			<div class="sdx-ability" data-ability="${key}" data-tooltip="${key.toUpperCase()}">
				<div class="sdx-ability-label">${key.toUpperCase()}</div>
				<div class="sdx-ability-mod">${modSign}${mod}</div>
			</div>
		`;
	}

	// Calculate initiative modifier with proper sign
	const initMod = abilities.dex?.mod ?? 0;
	const initModSign = initMod >= 0 ? "+" : "";

	// Build the luck container HTML based on mode
	let luckHtml;
	if (usePulpMode) {
		// Pulp mode: show editable number
		luckHtml = `
			<div class="sdx-luck-container pulp-mode" data-tooltip="Luck Tokens: ${luck}">
				<div class="sdx-luck-value">${luck}</div>
				<div class="sdx-luck-label">LUCK</div>
			</div>
		`;
	}
	else {
		// Standard mode: show toggle icon
		const hasLuck = luck ? "has-luck" : "";
		const luckStatus = luck ? "Available" : "Used";
		luckHtml = `
			<div class="sdx-luck-container standard-mode ${hasLuck}" data-tooltip="Luck (${luckStatus})">
				<i class="fa-solid fa-dice-d20"></i>
				<div class="sdx-luck-label">LUCK</div>
			</div>
		`;
	}

	// Build HP waves HTML if enabled
	const hpWavesHtml = hpWavesEnabled ? `
				<div class="hp-wave-container ${hpWaveClass}" style="--hp-translate: ${hpWaveTranslate}%; --hp-wave-color: ${hpWaveColor}; border-radius: 0;">
					<svg class="hp-waves" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 100" preserveAspectRatio="none">
						<path class="wave-path" d="M0 5 C 100 0, 200 10, 300 5 C 400 0, 500 10, 600 5 V 100 H 0 Z"/>
						<path class="wave-path" d="M0 10 C 100 15, 200 5, 300 10 C 400 15, 500 5, 600 10 V 100 H 0 Z"/>
						<path class="wave-path" d="M0 15 C 100 10, 200 20, 300 15 C 400 10, 500 20, 600 15 V 100 H 0 Z"/>
						<path class="wave-path" d="M0 20 C 100 25, 200 15, 300 20 C 400 25, 500 15, 600 20 V 100 H 0 Z"/>
					</svg>
				</div>` : "";

	// Build the enhanced header content
	const enhancedContent = `
		<div class="sdx-enhanced-content">
			<div class="sdx-portrait-container">
				<img class="sdx-portrait" src="${actor.img}" data-edit="img" data-tooltip="${actor.name}" />
				${hpWavesHtml}
				<div class="sdx-hp-bar-container" data-tooltip="${HP_QUICK_ADJUST_TOOLTIP}">
					<div class="sdx-hp-bar" style="width: ${hpPercent}%; background-color: ${hpColor};"></div>
					<div class="sdx-hp-text">
						<span class="sdx-hp-value" data-field="hp-value">${hp.value}</span>
						<span class="sdx-hp-separator">/</span>
						<span class="sdx-hp-max">${hp.max}</span>
					</div>
				</div>
			</div>

			<div class="sdx-header-main">
				<div class="sdx-actor-name-row">
					<input class="sdx-actor-name" data-field="name" type="text" value="${actor.name}" placeholder="Character Name" />
				</div>

				<div class="sdx-char-details-row">
					${ancestryName ? `<span class="sdx-char-ancestry">${ancestryName}</span>` : ""}
					${className ? `<span class="sdx-char-class">${className}</span>` : ""}
					${backgroundName ? `<span class="sdx-char-background">${backgroundName}</span>` : ""}
				</div>

				<div class="sdx-xp-row" data-tooltip="XP: ${xp} / ${xpForNextLevel}">
					<span class="sdx-xp-label">XP</span>
					<span class="sdx-xp-value">${xp}</span>
					<span class="sdx-xp-separator">/</span>
					<span class="sdx-xp-max">${xpForNextLevel}</span>
					<div class="sdx-xp-bar">
						<div class="sdx-xp-bar-fill" style="width: ${xpPercent}%;"></div>
					</div>
				</div>

				<div class="sdx-stats-row">
					<div class="sdx-ac-container" data-tooltip="Armor Class">
						<div class="sdx-ac-label">AC</div>
						<div class="sdx-ac-value">${ac}</div>
					</div>

					<div class="sdx-abilities-container">
						${abilitiesHtml}
					</div>

					<div class="sdx-right-stats">
						<div class="sdx-init-container" data-tooltip="Initiative" data-ability="dex">
							<div class="sdx-init-mod">${initModSign}${initMod}</div>
							<div class="sdx-init-label">INIT</div>
						</div>
					</div>
				</div>
			</div>

			<div class="sdx-header-right">
				${luckHtml}
				<div class="sdx-level-container ${levelUp ? "can-level-up" : ""}" data-tooltip="${levelUp ? "Ready to Level Up!" : "Level"}">
					${levelUp
		? '<i class="fas fa-arrow-up fa-beat"></i>'
		: `<div class="sdx-level-value">${level}</div><div class="sdx-level-label">LVL</div>`
}
				</div>
			</div>
		</div>
	`;

	// Clear the existing header content and inject enhanced version
	const $portrait = $header.find(".portrait");
	const $logo = $header.find(".shadowdark-logo");
	const $title = $header.find(".SD-title");

	// Hide original elements
	$portrait.hide();
	$logo.hide();
	$title.hide();

	// Append enhanced content
	$header.append(enhancedContent);

	// Wire up interactivity
	const $enhancedContent = $header.find(".sdx-enhanced-content");

	// Portrait click to launch tokenizer (if vtta-tokenizer module is active)
	// Hold Shift to open the default Foundry file picker instead
	$enhancedContent.find(".sdx-portrait").on("click", async e => {
		if (!actor.isOwner) return;
		e.stopPropagation();

		// If ctrl is held, open ImagePopout (Show to Players)
		if (e.ctrlKey) {
			new ImagePopout(actor.img, {
				title: actor.name,
				uuid: actor.uuid,
			}).render(true);
			return;
		}

		// If shift is held, open the default file picker
		if (e.shiftKey) {
			const fp = new FilePicker({
				type: "image",
				current: actor.img,
				callback: async path => {
					await actor.update({ img: path });
				},
			});
			return fp.browse();
		}

		// Check if vtta-tokenizer module is active and available
		if (!window.Tokenizer && !game.modules.get("vtta-tokenizer")?.active) {
			// No tokenizer available, fall back to file picker
			const fp = new FilePicker({
				type: "image",
				current: actor.img,
				callback: async path => {
					await actor.update({ img: path });
				},
			});
			return fp.browse();
		}

		try {
			// Use tokenizeActor for direct tokenization, or launch for UI
			if (window.Tokenizer?.tokenizeActor) {
				await window.Tokenizer.tokenizeActor(actor);
			}
			else if (window.Tokenizer?.launch) {
				// Launch with options
				const options = {
					name: actor.name,
					type: actor.type.toLowerCase(),
					avatarFilename: actor.img,
				};
				window.Tokenizer.launch(options, response => {
					ui.notifications.success(`Tokenizer completed for ${actor.name}!`);
				});
			}
			else {
				// Fallback to file picker if Tokenizer API not found
				const fp = new FilePicker({
					type: "image",
					current: actor.img,
					callback: async path => {
						await actor.update({ img: path });
					},
				});
				return fp.browse();
			}
		}
		catch(error) {
			console.error("shadowdark-extras | Error launching tokenizer:", error);
			ui.notifications.error(`Failed to launch tokenizer: ${error.message}`);
		}
	});

	// HP quick adjust and direct number edit
	const $sheet = html instanceof jQuery ? html : $(html);
	const openHpInput = () => {
		if (!actor.isOwner) return;

		const $hpValue = $enhancedContent.find(".sdx-hp-value");
		if (!$hpValue.length || $enhancedContent.find(".sdx-hp-input").length) return;
		// Read live: quick-adjust updates use render:false, so the render-time
		// `hp` closure can be stale by the time the editor is opened.
		const currentHp = Number(actor.system?.attributes?.hp?.value ?? hp.value);

		// Create inline input
		const $input = $(`<input type="number" class="sdx-hp-input" value="${currentHp}" min="0" />`);
		$hpValue.replaceWith($input);
		$input.focus().select();

		const saveHp = async () => {
			await setActorHpValue(actor, $input.val());
		};

		$input.on("blur", saveHp);
		$input.on("keydown", e => {
			if (e.key === "Enter") {
				e.preventDefault();
				$input.blur();
			}
			else if (e.key === "Escape") {
				$input.val(currentHp);
				$input.blur();
			}
		});
	};

	$enhancedContent.find(".sdx-hp-value").on("click", e => {
		e.preventDefault();
		e.stopPropagation();
		openHpInput();
	});

	$enhancedContent.find(".sdx-hp-bar-container").on("click", async e => {
		if (!actor.isOwner) return;
		if ($(e.target).is("input, textarea, select, button, a") || $(e.target).closest(".sdx-hp-value").length) return;
		e.preventDefault();
		e.stopPropagation();
		applyHpQuickAdjust(actor, -1, $sheet);
	});

	$enhancedContent.find(".sdx-hp-bar-container").on("contextmenu", async e => {
		if (!actor.isOwner) return;
		if ($(e.target).is("input, textarea, select, button, a")) return;
		e.preventDefault();
		e.stopPropagation();
		applyHpQuickAdjust(actor, 1, $sheet);
	});

	// Luck interaction - toggle or edit based on mode
	const $luckContainer = $enhancedContent.find(".sdx-luck-container");

	if (usePulpMode) {
		// Pulp mode: click to edit the number
		$luckContainer.on("click", async e => {
			if (!actor.isOwner) return;
			e.stopPropagation();

			const $luckValue = $luckContainer.find(".sdx-luck-value");
			// Don't create input if it already exists
			if ($luckContainer.find(".sdx-luck-input").length > 0) return;

			const currentLuck = sys.luck?.remaining ?? 0;

			// Create inline input
			const $input = $(`<input type="number" class="sdx-luck-input" value="${currentLuck}" min="0" />`);
			$luckValue.replaceWith($input);
			$input.focus().select();

			const saveLuck = async () => {
				const newLuck = Math.max(0, parseInt($input.val()) || 0);
				// Restore the luck value display with panel background
				const $newLuckValue = $(`<div class="sdx-luck-value">${newLuck}</div>`);
				$input.replaceWith($newLuckValue);
				// Update the actor data
				await actor.update({ "system.luck.remaining": newLuck });
			};

			$input.on("blur", saveLuck);
			$input.on("keydown", e => {
				if (e.key === "Enter") {
					e.preventDefault();
					$input.blur();
				}
				else if (e.key === "Escape") {
					// Restore original value display without saving
					const $newLuckValue = $(`<div class="sdx-luck-value">${currentLuck}</div>`);
					$input.replaceWith($newLuckValue);
				}
			});
		});
	}
	else {
		// Standard mode: toggle on/off
		$luckContainer.on("click", async () => {
			if (!actor.isOwner) return;
			await actor.update({ "system.luck.available": !luck });
		});
	}

	// XP inline edit on click — the SD system's editable XP input lives on
	// the Details tab and is easy to miss; mirror the luck container pattern.
	const $xpRow = $enhancedContent.find(".sdx-xp-row");
	$xpRow.on("click", async e => {
		if (!actor.isOwner) return;
		e.stopPropagation();
		if ($xpRow.find(".sdx-xp-input").length > 0) return;

		const $xpValue = $xpRow.find(".sdx-xp-value");
		const currentXp = sys.level?.xp ?? 0;

		const $input = $(`<input type="number" class="sdx-xp-input" value="${currentXp}" min="0" />`);
		$xpValue.replaceWith($input);
		$input.focus().select();

		const saveXp = async () => {
			const newXp = Math.max(0, parseInt($input.val()) || 0);
			const $newXpValue = $(`<span class="sdx-xp-value">${newXp}</span>`);
			$input.replaceWith($newXpValue);
			await actor.update({ "system.level.xp": newXp });
		};

		$input.on("blur", saveXp);
		$input.on("keydown", ev => {
			if (ev.key === "Enter") {
				ev.preventDefault();
				$input.blur();
			}
			else if (ev.key === "Escape") {
				const $newXpValue = $(`<span class="sdx-xp-value">${currentXp}</span>`);
				$input.replaceWith($newXpValue);
			}
		});
	});

	// Actor name change
	$enhancedContent.find(".sdx-actor-name").on("change", async function() {
		if (!actor.isOwner) return;
		const newName = $(this).val().trim();
		if (newName && newName !== actor.name) {
			await actor.update({ name: newName });
		}
	});

	// Level-up interaction
	$enhancedContent.find(".sdx-level-container.can-level-up").on("click", async e => {
		if (!actor.isOwner) return;
		e.stopPropagation();
		e.preventDefault();

		// Check if this is level 0 advancing
		let actorClass = null;
		try {
			if (sys.class) {
				actorClass = await fromUuid(sys.class);
			}
		}
		catch(err) {
			console.warn("shadowdark-extras | Could not fetch actor class:", err);
		}

		// Route to Character Generator if (a) no class is assigned, or (b) Level 0 funnel actor.
		// SD's LevelUpSD.getData reads `class.system.classTalentTable` and crashes
		// with `Cannot read properties of null` when actor.system.class is empty.
		if (!actorClass || (level === 0 && actorClass?.name?.includes("Level 0"))) {
			new shadowdark.apps.CharacterGeneratorSD(actor._id).render(true);
		}
		else {
			// Standard level up
			new shadowdark.apps.LevelUpSD(actor._id).render(true);
		}
	});

	// Ability rolls on click — SD 4.x uses actor.system.rollStatCheck (rollAbility was removed)
	$enhancedContent.find(".sdx-ability").on("click", async function(event) {
		const ability = $(this).data("ability");
		if (!ability) return;
		const skipPrompt = event?.shiftKey === true;
		if (typeof actor.system?.rollStatCheck === "function") {
			await actor.system.rollStatCheck(String(ability).toLowerCase(), { skipPrompt });
		}
		else if (typeof actor.rollAbility === "function") {
			// Legacy SD <4.x
			actor.rollAbility(ability);
		}
		else {
			console.warn(`${MODULE_ID} | No ability-roll API on actor for "${ability}"`);
		}
	});

	// Initiative roll - if in combat, roll for combat initiative; otherwise just roll dex
	$enhancedContent.find(".sdx-init-container").on("click", async () => {
		// Check if there's an active combat and this actor has a combatant in it
		if (game.combat) {
			const combatant = game.combat.combatants.find(c => c.actorId === actor.id);
			if (combatant) {
				// Roll initiative for combat
				await game.combat.rollInitiative(combatant.id, { updateTurn: false });
				return;
			}
		}
		// Fallback: just roll a dex stat check if not in combat (SD 4.x: rollStatCheck)
		if (typeof actor.system?.rollStatCheck === "function") {
			await actor.system.rollStatCheck("dex");
		}
		else if (typeof actor.rollAbility === "function") {
			actor.rollAbility("dex");
		}
	});
}

/**
 * Get the XP required for the next level in Shadowdark
 */
function getXpForNextLevel(currentLevel) {
	// Shadowdark XP requirements per level (linear progression: level * 10)
	// Level 1 needs 10 XP to reach level 2
	// Level 2 needs 20 XP to reach level 3
	// Level 3 needs 30 XP to reach level 4, etc.
	return currentLevel * 10;
}

/**
 * Inject header background customization for player sheets
 * Allows GMs and sheet owners to set a custom background image for the header
 */
export function injectHeaderCustomization(app, html, actor) {
	const $header = html.find(".SD-header").first();
	if (!$header.length) return;

	// Clean up any existing elements first (in case of re-render)
	$header.find(".sdx-header-settings-btn").remove();
	$header.find(".sdx-header-settings-menu").remove();

	// Apply any existing custom backgrounds
	applyHeaderBackground(html, actor);

	// Check if user can edit this actor (GM or owner)
	const canEdit = game.user.isGM || actor.isOwner;
	if (!canEdit) {
		return;
	}

	// Make header position relative for absolute positioned children
	$header.css("position", "relative");

	// Create the settings button
	const $settingsBtn = $(`
		<button type="button" class="sdx-header-settings-btn" data-tooltip="${game.i18n.localize("SHADOWDARK_EXTRAS.header.customize_tooltip") || "Customize Header"}">
			<i class="fas fa-cog"></i>
		</button>
	`);

	// Create the settings menu with header background option
	const $settingsMenu = $(`
		<div class="sdx-header-settings-menu">
			<div class="sdx-settings-section">
				<div class="sdx-settings-label">Header Background</div>
				<button type="button" class="sdx-header-select-image">
					<i class="fas fa-image"></i>
					<span>${game.i18n.localize("SHADOWDARK_EXTRAS.header.select_image") || "Select Image"}</span>
				</button>
				<button type="button" class="sdx-header-remove-image danger">
					<i class="fas fa-trash"></i>
					<span>${game.i18n.localize("SHADOWDARK_EXTRAS.header.remove_image") || "Remove"}</span>
				</button>
			</div>
		</div>
	`);

	$header.append($settingsBtn);
	$header.append($settingsMenu);

	// Use a unique namespace for this app instance to avoid conflicts
	const eventNS = `.sdxHeaderMenu${app.appId}`;

	// Clean up any existing handlers first (in case of re-render)
	$(document).off(eventNS);

	// Toggle menu visibility
	$settingsBtn.on("click", event => {
		event.preventDefault();
		event.stopPropagation();
		$settingsBtn.toggleClass("active");
		$settingsMenu.toggleClass("visible");
	});

	// Close menu when clicking outside
	$(document).on(`click${eventNS}`, event => {
		if (!$(event.target).closest(".sdx-header-settings-btn, .sdx-header-settings-menu").length) {
			$settingsBtn.removeClass("active");
			$settingsMenu.removeClass("visible");
		}
	});

	// Handle select image button
	$settingsMenu.find(".sdx-header-select-image").on("click", async event => {
		event.preventDefault();
		event.stopPropagation();

		// Close the menu
		$settingsBtn.removeClass("active");
		$settingsMenu.removeClass("visible");

		// Open file picker - use imagevideo to allow webm files
		const currentImage = actor.getFlag(MODULE_ID, "headerBackground") || "";
		const fp = new FilePicker({
			type: "imagevideo",
			current: currentImage,
			callback: async path => {
				await actor.setFlag(MODULE_ID, "headerBackground", path);
				// Force sheet re-render to apply the background properly
				app.render(false);
			},
		});
		fp.render(true);
	});

	// Handle remove image button
	$settingsMenu.find(".sdx-header-remove-image").on("click", async event => {
		event.preventDefault();
		event.stopPropagation();

		// Close the menu
		$settingsBtn.removeClass("active");
		$settingsMenu.removeClass("visible");

		// Remove the custom background
		await actor.unsetFlag(MODULE_ID, "headerBackground");

		// Force sheet re-render
		app.render(false);
	});
}

/**
 * Apply the custom header background if one is set
 * Supports both images and videos (mp4, webm)
 * Extends background to cover header and navigation tabs only
 */
function applyHeaderBackground(html, actor) {
	// Get actor-specific background first
	let headerBg = actor.getFlag(MODULE_ID, "headerBackground");
	let isDefaultBg = false;

	// If no actor-specific background, check for default background
	if (!headerBg) {
		const enableDefaultBg = game.settings.get(MODULE_ID, "enableDefaultHeaderBg");
		const defaultBgPath = game.settings.get(MODULE_ID, "defaultHeaderBgPath");
		if (enableDefaultBg && defaultBgPath) {
			headerBg = defaultBgPath;
			isDefaultBg = true;
		}
	}
	// Find the form - html might BE the form or contain it
	let $form = html.is("form") ? html : html.find("form").first();
	if (!$form.length) $form = html.closest("form");
	if (!$form.length) return;

	const $header = $form.find(".SD-header").first();
	const $nav = $form.find(".SD-nav").first();

	if (!$header.length) return;

	// Remove any existing background extension
	$form.find(".sdx-header-bg-extension").remove();

	if (!headerBg) {
		$header.removeClass("sdx-custom-header");
		$header.css("background-image", "");
		return;
	}

	$header.addClass("sdx-custom-header");

	// Calculate the height needed to cover header + nav (including margins, padding, borders)
	const updateBgHeight = () => {
		const headerRect = $header[0]?.getBoundingClientRect();
		const navRect = $nav[0]?.getBoundingClientRect();
		const formRect = $form[0]?.getBoundingClientRect();

		if (!headerRect || !navRect || !formRect) return;

		// Calculate from the top of header to the bottom of nav, relative to form
		// Add extra padding to ensure it covers the full nav including border-bottom
		const totalHeight = (navRect.bottom - formRect.top) + 30;
		$form.find(".sdx-header-bg-extension").css("height", `${totalHeight}px`);
	};

	// Check if it's a video file
	const isVideo = /\.(mp4|webm|ogg)$/i.test(headerBg);

	// Create the background extension element
	const $bgExtension = $('<div class="sdx-header-bg-extension"></div>');

	if (isVideo) {
		const videoType = headerBg.split(".").pop().toLowerCase();
		const $video = $(`
			<video autoplay loop muted playsinline>
				<source src="${headerBg}" type="video/${videoType}">
			</video>
		`);
		$bgExtension.append($video);
	}
	else {
		$bgExtension.css("background-image", `url("${headerBg}")`);
	}

	// Insert at the beginning of the form
	$form.prepend($bgExtension);

	// Update height now and after a short delay (for rendering)
	updateBgHeight();
	setTimeout(updateBgHeight, 100);
	setTimeout(updateBgHeight, 300);
}

/**
 * Inject header background customization for party sheets
 * Similar to player sheet customization but adapted for party layout
 */
export function injectPartyHeaderCustomization(app, html, actor) {
	const $header = html.find(".party-header.SD-header").first();
	if (!$header.length) return;

	// Clean up any existing elements first (in case of re-render)
	$header.find(".sdx-header-settings-btn").remove();
	$header.find(".sdx-header-settings-menu").remove();

	// Apply any existing custom backgrounds
	applyPartyHeaderBackground(html, actor);

	// Check if user can edit this actor (GM or owner)
	const canEdit = game.user.isGM || actor.isOwner;
	if (!canEdit) {
		return;
	}

	// Make header position relative for absolute positioned children
	$header.css("position", "relative");

	// Create the settings button
	const $settingsBtn = $(`
		<button type="button" class="sdx-header-settings-btn" data-tooltip="${game.i18n.localize("SHADOWDARK_EXTRAS.header.customize_tooltip") || "Customize Header"}">
			<i class="fas fa-cog"></i>
		</button>
	`);

	// Create the settings menu with header background option
	const $settingsMenu = $(`
		<div class="sdx-header-settings-menu">
			<div class="sdx-settings-section">
				<div class="sdx-settings-label">Header Background</div>
				<button type="button" class="sdx-header-select-image">
					<i class="fas fa-image"></i>
					<span>${game.i18n.localize("SHADOWDARK_EXTRAS.header.select_image") || "Select Image"}</span>
				</button>
				<button type="button" class="sdx-header-remove-image danger">
					<i class="fas fa-trash"></i>
					<span>${game.i18n.localize("SHADOWDARK_EXTRAS.header.remove_image") || "Remove"}</span>
				</button>
			</div>
		</div>
	`);

	$header.append($settingsBtn);
	$header.append($settingsMenu);

	// Use a unique namespace for this app instance to avoid conflicts
	const eventNS = `.sdxPartyHeaderMenu${app.appId}`;

	// Clean up any existing handlers first (in case of re-render)
	$(document).off(eventNS);

	// Toggle menu visibility
	$settingsBtn.on("click", event => {
		event.preventDefault();
		event.stopPropagation();
		$settingsBtn.toggleClass("active");
		$settingsMenu.toggleClass("visible");
	});

	// Close menu when clicking outside
	$(document).on(`click${eventNS}`, event => {
		if (!$(event.target).closest(".sdx-header-settings-btn, .sdx-header-settings-menu").length) {
			$settingsBtn.removeClass("active");
			$settingsMenu.removeClass("visible");
		}
	});

	// Handle select image button
	$settingsMenu.find(".sdx-header-select-image").on("click", async event => {
		event.preventDefault();
		event.stopPropagation();

		// Close the menu
		$settingsBtn.removeClass("active");
		$settingsMenu.removeClass("visible");

		// Open file picker - use imagevideo to allow webm files
		const currentImage = actor.getFlag(MODULE_ID, "partyHeaderBackground") || "";
		const fp = new FilePicker({
			type: "imagevideo",
			current: currentImage,
			callback: async path => {
				await actor.setFlag(MODULE_ID, "partyHeaderBackground", path);
				// Force sheet re-render to apply the background properly
				app.render(false);
			},
		});
		fp.render(true);
	});

	// Handle remove image button
	$settingsMenu.find(".sdx-header-remove-image").on("click", async event => {
		event.preventDefault();
		event.stopPropagation();

		// Close the menu
		$settingsBtn.removeClass("active");
		$settingsMenu.removeClass("visible");

		// Remove the custom background
		await actor.unsetFlag(MODULE_ID, "partyHeaderBackground");

		// Force sheet re-render
		app.render(false);
	});

	// Portrait click to launch tokenizer (if vtta-tokenizer module is active)
	// Hold Shift to open the default Foundry file picker instead
	const $portrait = $header.find(".party-portrait");
	$portrait.off("click.sdxPartyPortrait").on("click.sdxPartyPortrait", async e => {
		if (!actor.isOwner && !game.user.isGM) return;
		e.preventDefault();
		e.stopPropagation();

		// If shift is held, open the default file picker
		if (e.shiftKey) {
			const fp = new FilePicker({
				type: "image",
				current: actor.img,
				callback: async path => {
					await actor.update({ img: path });
				},
			});
			return fp.browse();
		}

		// Check if vtta-tokenizer module is active and available
		if (!window.Tokenizer && !game.modules.get("vtta-tokenizer")?.active) {
			// No tokenizer available, fall back to file picker
			const fp = new FilePicker({
				type: "image",
				current: actor.img,
				callback: async path => {
					await actor.update({ img: path });
				},
			});
			return fp.browse();
		}

		try {
			// Use tokenizeActor for direct tokenization, or launch for UI
			if (window.Tokenizer?.tokenizeActor) {
				await window.Tokenizer.tokenizeActor(actor);
			}
			else if (window.Tokenizer?.launch) {
				// Launch with options
				const options = {
					name: actor.name,
					type: "npc", // Party actors are NPC type
					avatarFilename: actor.img,
				};
				window.Tokenizer.launch(options, response => {
					ui.notifications.success(`Tokenizer completed for ${actor.name}!`);
				});
			}
			else {
				// Fallback to file picker if Tokenizer API not found
				const fp = new FilePicker({
					type: "image",
					current: actor.img,
					callback: async path => {
						await actor.update({ img: path });
					},
				});
				return fp.browse();
			}
		}
		catch(error) {
			console.error("shadowdark-extras | Error launching tokenizer:", error);
			ui.notifications.error(`Failed to launch tokenizer: ${error.message}`);
		}
	});
}

/**
 * Apply the custom header background for party sheets
 * Supports both images and videos (mp4, webm)
 */
function applyPartyHeaderBackground(html, actor) {
	// Get party-specific background first
	let headerBg = actor.getFlag(MODULE_ID, "partyHeaderBackground");
	let isDefaultBg = false;

	// If no party-specific background, check for default background
	if (!headerBg) {
		const enableDefaultBg = game.settings.get(MODULE_ID, "enableDefaultHeaderBg");
		const defaultBgPath = game.settings.get(MODULE_ID, "defaultHeaderBgPath");
		if (enableDefaultBg && defaultBgPath) {
			headerBg = defaultBgPath;
			isDefaultBg = true;
		}
	}

	// Find the form - html might BE the form or contain it
	let $form = html.is("form") ? html : html.find("form").first();
	if (!$form.length) $form = html.closest("form");
	if (!$form.length) return;

	const $header = $form.find(".party-header.SD-header").first();
	const $nav = $form.find(".SD-nav").first();

	if (!$header.length) return;

	// Remove any existing background extension
	$form.find(".sdx-party-header-bg-extension").remove();

	if (!headerBg) {
		$header.removeClass("sdx-custom-party-header");
		return;
	}

	$header.addClass("sdx-custom-party-header");

	// Calculate the height needed to cover header + nav
	const updateBgHeight = () => {
		const headerRect = $header[0]?.getBoundingClientRect();
		const navRect = $nav[0]?.getBoundingClientRect();
		const formRect = $form[0]?.getBoundingClientRect();

		if (!headerRect || !navRect || !formRect) return;

		// Calculate from the top of header to the bottom of nav, relative to form
		// Add extra padding to ensure background covers full tab area
		const totalHeight = (navRect.bottom - formRect.top) + 30;
		$form.find(".sdx-party-header-bg-extension").css("height", `${totalHeight}px`);
	};

	// Check if it's a video file
	const isVideo = /\.(mp4|webm|ogg)$/i.test(headerBg);

	// Create the background extension element
	const $bgExtension = $('<div class="sdx-party-header-bg-extension"></div>');

	if (isVideo) {
		const videoType = headerBg.split(".").pop().toLowerCase();
		const $video = $(`
			<video autoplay loop muted playsinline>
				<source src="${headerBg}" type="video/${videoType}">
			</video>
		`);
		$bgExtension.append($video);
	}
	else {
		$bgExtension.css("background-image", `url("${headerBg}")`);
	}

	// Insert at the beginning of the form
	$form.prepend($bgExtension);

	// Update height now and after a short delay (for rendering)
	updateBgHeight();
	setTimeout(updateBgHeight, 100);
	setTimeout(updateBgHeight, 300);
}

/**
 * Inject the Trade button into the player sheet under the Gems section
 */
/**
 * Inject Add Coins button into player sheet coins section
 * @param {jQuery} html - The sheet HTML
 * @param {Actor} actor - The player actor
 */
export function injectAddCoinsButton(html, actor) {
	// Check if add coins button is enabled
	if (!game.settings.get(MODULE_ID, "enableAddCoinsButton")) return;

	// Only show if user owns the actor or is GM
	if (!actor.isOwner && !game.user?.isGM) return;

	// Find the coins box in the inventory sidebar
	// The coins box has a header with label "COINS" and an empty span
	const coinsBox = html.find(".tab-inventory .SD-box").filter((_, el) => {
		const hasCoinsInput = $(el).find('input[name*="coins"]').length > 0;
		return hasCoinsInput;
	});

	if (coinsBox.length === 0) return;

	// Find the empty span in the header and add the buttons
	const headerSpan = coinsBox.find(".header span").first();
	if (headerSpan.length === 0) return;

	// Check if there are other players/Party to transfer to
	const hasTransferTargets = game.actors.some(a => {
		if (a.id === actor.id) return false;
		const isParty = a.type === "NPC" && a.getFlag(MODULE_ID, "isParty");
		if (a.type !== "Player" && !isParty) return false;
		if (!isParty) {
			return game.users.some(u => a.testUserPermission(u, "OWNER"));
		}
		return true;
	});

	// Build buttons HTML - Add + Transfer
	let buttonsHtml = `<a class="sdx-add-coins-btn" data-action="add-coins" data-tooltip="${game.i18n.localize("SHADOWDARK_EXTRAS.party.add_coins_title")}"><i class="fas fa-plus"></i></a>`;

	// Only add transfer button if there are targets
	if (hasTransferTargets) {
		buttonsHtml += `<a class="sdx-transfer-coins-btn" data-action="transfer-coins" data-tooltip="${game.i18n.localize("SHADOWDARK_EXTRAS.dialog.transfer_coins_title")}" style="margin-left: 6px;"><i class="fas fa-share"></i></a>`;
	}

	headerSpan.html(buttonsHtml);

	// Attach click handler for add coins
	coinsBox.find('[data-action="add-coins"]').on("click", async event => {
		event.preventDefault();
		await showAddCoinsDialog(actor);
	});

	// Attach click handler for transfer coins
	coinsBox.find('[data-action="transfer-coins"]').on("click", async event => {
		event.preventDefault();
		const result = await showCoinTransferDialog(actor);
		if (result) {
			await transferCoinsToPlayer(actor, result.coins, result.targetActorId);
		}
	});
}


/**
 * Show dialog to add/remove coins from an actor
 * @param {Actor} actor - The actor to modify coins for
 */
async function showAddCoinsDialog(actor) {
	const gpLabel = game.i18n.localize("SHADOWDARK_EXTRAS.party.coin_gp");
	const spLabel = game.i18n.localize("SHADOWDARK_EXTRAS.party.coin_sp");
	const cpLabel = game.i18n.localize("SHADOWDARK_EXTRAS.party.coin_cp");

	const content = `
		<form class="add-coins-form">
			<p>${game.i18n.localize("SHADOWDARK_EXTRAS.party.add_coins_prompt")}</p>
			<div class="form-group">
				<label>${gpLabel}</label>
				<input type="number" name="gp" value="0" />
			</div>
			<div class="form-group">
				<label>${spLabel}</label>
				<input type="number" name="sp" value="0" />
			</div>
			<div class="form-group">
				<label>${cpLabel}</label>
				<input type="number" name="cp" value="0" autofocus />
			</div>
		</form>
	`;

	const result = await foundry.applications.api.DialogV2.prompt({
		window: { title: game.i18n.localize("SHADOWDARK_EXTRAS.party.add_coins_title") },
		content,
		ok: {
			callback: (event, button, dialog) => {
				const form = dialog.element.querySelector("form");
				return {
					gp: parseInt(form.gp.value) || 0,
					sp: parseInt(form.sp.value) || 0,
					cp: parseInt(form.cp.value) || 0,
				};
			},
		},
		rejectClose: false,
	});

	if (!result) return;

	const { gp, sp, cp } = result;
	if (gp === 0 && sp === 0 && cp === 0) return;

	// Get current coins and add the new amounts
	const currentCoins = actor.system.coins || { gp: 0, sp: 0, cp: 0 };
	const newGp = Math.max(0, (parseInt(currentCoins.gp) || 0) + gp);
	const newSp = Math.max(0, (parseInt(currentCoins.sp) || 0) + sp);
	const newCp = Math.max(0, (parseInt(currentCoins.cp) || 0) + cp);

	await actor.update({
		"system.coins.gp": newGp,
		"system.coins.sp": newSp,
		"system.coins.cp": newCp,
	});

	// Build notification message
	const parts = [];
	if (gp !== 0) parts.push(`${gp > 0 ? "+" : ""}${gp} ${gpLabel}`);
	if (sp !== 0) parts.push(`${sp > 0 ? "+" : ""}${sp} ${spLabel}`);
	if (cp !== 0) parts.push(`${cp > 0 ? "+" : ""}${cp} ${cpLabel}`);

	ui.notifications.info(
		game.i18n.format("SHADOWDARK_EXTRAS.coins_updated", { coins: parts.join(", ") })
	);
}

export function injectTradeButton(html, actor) {
	// Check if trading is enabled
	if (!game.settings.get(MODULE_ID, "enableTrading")) return;

	// Only show if user owns the actor
	if (!actor.isOwner) return;

	// Check if there are other player characters available with DIFFERENT online owners
	const otherPlayers = game.actors.filter(a => {
		if (a.type !== "Player" || a.id === actor.id) return false;
		return game.users.some(u => a.testUserPermission(u, "OWNER") && u.id !== game.user.id && u.active);
	});

	// Don't show button if no one to trade with
	if (otherPlayers.length === 0) return;

	// Find the Gems section in the inventory sidebar
	const gemsSection = html.find('.tab-inventory .SD-box:has([data-action="open-gem-bag"])');

	if (gemsSection.length === 0) return;

	// Create trade button HTML
	const tradeButtonHtml = `
		<div class="SD-box shadowdark-extras-trade-button">
			<button type="button" class="trade-btn" data-action="open-trade">
				<i class="fas fa-exchange-alt"></i>
				${game.i18n.localize("SHADOWDARK_EXTRAS.trade.title")}
			</button>
		</div>
	`;

	// Insert after Gems section
	gemsSection.after(tradeButtonHtml);

	// Attach click handler
	html.find('.trade-btn[data-action="open-trade"]').on("click", async event => {
		event.preventDefault();
		await showTradeDialog(actor);
	});
}

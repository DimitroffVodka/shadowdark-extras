import { MODULE_ID } from "../shared/module-id.mjs";
import StaffSpellManager from "./StaffSpellManager.mjs";

/**
 * Weapon ("staff") spells: spells bound to a Weapon item and cast from it.
 *
 * Extracted from the composition root in Phase 3, verbatim. The feature is
 * spread across three sheets and one prototype patch, which is why it reads as
 * six loosely related functions rather than one entry point:
 *
 *   - the weapon item sheet gets a button opening `StaffSpellManager`
 *   - the player sheet gets a spell list (Spells tab) and per-weapon recharge
 *     buttons (Inventory tab)
 *   - `PlayerSD#canUseMagicItems` is widened so an equipped weapon carrying
 *     spells counts, alongside wands and scrolls
 *
 * All six read the same `flags.<MODULE_ID>.staffSpells` array, which is what
 * makes them one unit. The root still owns the hooks that call the four
 * exported entry points; only the `updateItem` re-render hook, which exists
 * solely to refresh an open weapon sheet after that flag changes, moves here.
 */

/**
 * Inject a weapon spell configuration button after the header light
 */
export function injectStaffSpellButton(app, html, item) {
	// Only for Weapon type items
	if (item.type !== "Weapon") return;

	// Check if already injected
	if (html.find('.sdx-staff-spell-button').length > 0) return;

	// Find the header with class "light" (ITEM PROPERTIES header)
	const $headerLight = html.find('.SD-box .header.light').first();
	if (!$headerLight.length) {
		//console.log(`${MODULE_ID} | Could not find header.light in weapon sheet`);
		return;
	}

	// Get the number of attached spells
	const staffSpells = item.getFlag(MODULE_ID, "staffSpells") || [];
	const spellCount = staffSpells.length;
	const countText = spellCount > 0 ? ` (${spellCount})` : "";

	// Create a settings button
	const $button = $(`
		<button type="button" class="sdx-staff-spell-button" title="Configure Weapon Spells">
			<i class="fas fa-wand-magic-sparkles"></i> Configure Weapon Spells${countText}
		</button>
	`);

	// Handle button click
	$button.on('click', async function (e) {
		e.preventDefault();
		const manager = new StaffSpellManager(item);
		manager.render(true);
	});

	// Insert button after the header light
	$headerLight.after($button);

	//console.log(`${MODULE_ID} | Injected weapon spell button for weapon: ${item.name}`);
}

/**
 * Get all equipped weapons and their attached spells
 */
async function getEquippedStaffSpells(actor) {
	const staffSpells = [];

	// Find all equipped weapon items
	const equippedWeapons = actor.items.filter(item =>
		item.type === "Weapon" &&
		item.system?.equipped === true
	);

	// Load spells from each weapon
	for (const staff of equippedWeapons) {
		const spellRefs = staff.getFlag(MODULE_ID, "staffSpells") || [];

		for (const spellRef of spellRefs) {
			try {
				const spell = await fromUuid(spellRef.uuid);
				if (spell && spell.type === "Spell") {
					staffSpells.push({
						staffId: staff.id,
						staffName: staff.name,
						spell: spell,
						spellId: spell.id,
						spellName: spell.name,
						spellImg: spell.img,
						spellData: spell,
						maxUses: spellRef.maxUses,
						currentUses: spellRef.currentUses
					});
				}
			} catch (err) {
				console.warn(`${MODULE_ID} | Could not load spell ${spellRef.uuid} from weapon ${staff.name}:`, err);
			}
		}
	}

	return staffSpells;
}

/**
 * Build HTML for weapon spells section
 */
function buildStaffSpellsHtml(staffSpells) {
	let spellsHtml = "";

	for (const { staffName, staffId, spell, spellName, spellImg, currentUses, maxUses, spellData } of staffSpells) {
		// Get spell duration and range
		const durationType = spellData?.system?.duration?.type || "";
		const durationValue = spellData?.system?.duration?.value || "";
		const rangeKey = spellData?.system?.range || "";

		// Format duration display
		let durationDisplay = "";
		if (durationType === "focus") {
			durationDisplay = "Focus";
		} else if (durationType === "instant") {
			durationDisplay = "Instant";
		} else if (durationType === "rounds") {
			durationDisplay = `${durationValue} rounds`;
		} else if (durationType === "minutes") {
			durationDisplay = `${durationValue} minutes`;
		} else if (durationType === "hours") {
			durationDisplay = `${durationValue} hours`;
		} else if (durationDisplay) {
			durationDisplay = durationType;
		}

		// Check if depleted
		const isDepleted = maxUses !== null && currentUses === 0;

		// Build uses display for actions section
		let usesHtml = "";
		if (maxUses !== null && maxUses !== undefined) {
			const current = currentUses ?? maxUses;
			const usesClass = current === 0 ? "sdx-staff-spell-uses-depleted" : "sdx-staff-spell-uses";
			usesHtml = `<span class="${usesClass}" data-tooltip="Uses remaining">${current}/${maxUses}</span>`;
		}

		// Create a clickable spell entry similar to regular spells
		spellsHtml += `
			<li class="item sdx-staff-spell" data-spell-uuid="${spell.uuid}" data-staff-id="${staffId}" data-item-type="Spell">
				<div class="item-image" style="background-image: url(${spellImg})">
					<i class="fas fa-comment fa-lg"></i>
				</div>
				<a class="item-name sdx-staff-spell-name" data-action="show-details" title="From ${staffName}">${spellName}</a>
				<div class="duration">${durationDisplay}</div>
				<div class="range">${rangeKey ? CONFIG.SHADOWDARK?.spellRanges?.[rangeKey] || rangeKey : ""}</div>
				<div class="actions">
					${usesHtml}
					${durationType === "focus" ? `
						<a
							data-action="focus-staff-spell"
							data-spell-uuid="${spell.uuid}"
							data-staff-id="${staffId}"
							data-tooltip="Focus on this spell"
							${isDepleted ? 'style="opacity: 0.3; pointer-events: none;"' : ''}
						>
							<i class="fa-solid fa-brain"></i>
						</a>
					` : ''}
					${!isDepleted ? `
						<a
							data-action="cast-staff-spell"
							data-spell-uuid="${spell.uuid}"
							data-staff-id="${staffId}"
							data-tooltip="Cast spell from weapon"
						>
							<i class="fa-solid fa-wand-magic-sparkles"></i>
						</a>
					` : `
						<a style="opacity: 0.3; pointer-events: none;" data-tooltip="No uses remaining">
							<i class="fa-solid fa-wand-magic-sparkles"></i>
						</a>
					`}
				</div>
			</li>
		`;
	}

	return `
		<div class="SD-box sdx-staff-spells-section">
			<div class="header">
				<label>
					<i class="fas fa-wand-magic-sparkles"></i>
					Spells From Equipped Weapons
				</label>
			</div>
			<div class="content">
				<ol class="SD-list sdx-staff-spells-list">
					<li class="header">
						<div class="item-name">Weapon Spell</div>
						<div class="duration">Duration</div>
						<div class="range">Range</div>
						<div class="actions"></div>
					</li>
					${spellsHtml}
				</ol>
			</div>
		</div>
	`;
}

/**
 * Inject weapon spells UI into the player sheet's spell tab
 */
export async function injectStaffSpellsUI(sheet, html, data) {
	const actor = sheet.actor;
	if (!actor) return;

	// Get equipped weapon spells
	const staffSpells = await getEquippedStaffSpells(actor);
	if (staffSpells.length === 0) return;

	// Find the spells tab
	const spellsTab = html.find(".tab-spells, section[data-tab='tab-spells']");
	if (spellsTab.length === 0) return;

	// Build and inject weapon spells section
	const staffSpellsHtml = buildStaffSpellsHtml(staffSpells);
	spellsTab.prepend(staffSpellsHtml);

	// Attach click handler to show spell details
	spellsTab.find("[data-action='show-details']").on("click", async (event) => {
		event.preventDefault();
		const $spell = $(event.currentTarget).closest(".sdx-staff-spell");
		const spellUuid = $spell.data("spell-uuid");

		if (!spellUuid) return;

		try {
			const spell = await fromUuid(spellUuid);
			if (spell && spell.sheet) {
				spell.sheet.render(true);
			}
		} catch (err) {
			console.error(`${MODULE_ID} | Error opening staff spell sheet:`, err);
		}
	});

	// Attach click handler to cast staff spells
	spellsTab.find("[data-action='cast-staff-spell']").on("click", async (event) => {
		event.preventDefault();
		const $link = $(event.currentTarget);
		const spellUuid = $link.data("spell-uuid");
		const staffId = $link.data("staff-id");

		if (!spellUuid || !staffId) return;

		try {
			// Get the staff weapon
			const staff = actor.items.get(staffId);
			if (!staff) {
				ui.notifications.error("Staff weapon not found");
				return;
			}

			// Get spell reference
			const staffSpells = staff.getFlag(MODULE_ID, "staffSpells") || [];
			const spellRef = staffSpells.find(s => s.uuid === spellUuid);

			if (!spellRef) {
				ui.notifications.error("Spell not found on staff");
				return;
			}

			// Check if has uses remaining
			if (spellRef.maxUses !== null && spellRef.currentUses === 0) {
				ui.notifications.warn("This spell has no uses remaining");
				return;
			}

			// Load the spell from UUID
			const spellDoc = await fromUuid(spellUuid);
			if (!spellDoc) {
				ui.notifications.error("Could not load spell");
				return;
			}

			// Create a temporary wand item (so it bypasses class restrictions)
			const spellData = spellDoc.toObject();

			// Determine spellcasting ability (use actor's primary if available, otherwise INT)
			let spellAbility = "int";
			const characterClass = await actor.getClass();
			if (characterClass?.system?.spellcasting?.ability) {
				spellAbility = characterClass.system.spellcasting.ability;
			}

			// Get the spell image - use staff image as fallback
			const spellImage = spellData.img || staff.img || "icons/svg/mystery-man.svg";

			// Copy all spell data to wand, including flags for damage/effects/etc
			const wandData = {
				name: `${staff.name} - ${spellData.name}`,
				type: "Wand",
				img: spellImage,
				system: {
					spellName: spellData.name,
					description: spellData.system.description,
					duration: spellData.system.duration,
					range: spellData.system.range,
					tier: spellData.system.tier,
					ability: spellAbility,
					cost: { gp: 0, sp: 0, cp: 0 },
					slots: { slots_used: 0 },
					equipped: true,
					lost: false,
					stashed: false
				},
				// Copy all flags from the spell (includes spellDamage, effects, etc.)
				flags: spellData.flags || {},
				// Copy effects from the spell
				effects: spellData.effects || []
			};

			const [tempWand] = await actor.createEmbeddedDocuments("Item", [wandData]);

			// Build options for skip prompt (like shift-click)
			const options = actor.buildOptionsForSkipPrompt(event, {});

			// Get ability bonus for the spell
			const abilityId = spellAbility;
			const abilityBonus = actor.abilityModifier(abilityId);

			// Get base difficulty (use 10 + tier as default if no class)
			let baseDifficulty = 10 + (wandData.system.tier || 1);
			if (characterClass?.system?.spellcasting?.baseDifficulty) {
				baseDifficulty = characterClass.system.spellcasting.baseDifficulty;
			}

			// Build roll data
			const rollType = wandData.system.spellName.slugify();
			const data = {
				rollType,
				item: tempWand,
				actor: actor,
				abilityBonus: abilityBonus,
				baseDifficulty: baseDifficulty,
				talentBonus: actor.system.spellcasting?.bonus || 0,
			};

			const parts = ["1d20", "@abilityBonus", "@talentBonus"];

			// Call rollSpell directly on the wand item, bypassing class checks
			await tempWand.rollSpell(parts, data, options);

			// Delay deletion to allow damage cards and automation to complete
			// Delete after 1 second to ensure all chat messages and automation finish
			setTimeout(async () => {
				try {
					await tempWand.delete();
				} catch (err) {
					// Item may already be deleted, ignore error
				}
			}, 1000);

			// Consume a use if limited
			if (spellRef.maxUses !== null && spellRef.maxUses > 0) {
				spellRef.currentUses = Math.max(0, (spellRef.currentUses ?? spellRef.maxUses) - 1);
				await staff.setFlag(MODULE_ID, "staffSpells", staffSpells);

				// Notify if depleted
				if (spellRef.currentUses === 0) {
					ui.notifications.warn(`${spellDoc.name} on ${staff.name} has no uses remaining`);

					// Check if weapon should be destroyed when all spells depleted
					const destroyAtZero = staff.getFlag(MODULE_ID, "destroyAtZero");
					if (destroyAtZero) {
						// Check if ALL spells are at 0 uses
						const allDepleted = staffSpells.every(s => {
							// Spell is depleted if it has maxUses set and currentUses is 0
							if (s.maxUses === null || s.maxUses === undefined) {
								return false; // Unlimited uses, never depleted
							}
							return (s.currentUses ?? s.maxUses) === 0;
						});

						if (allDepleted) {
							ui.notifications.warn(`${staff.name} has been destroyed - all spells depleted!`);
							await staff.delete();
							return; // Exit early since weapon is deleted
						}
					}
				}

				// Re-render the sheet to update the uses display
				sheet.render(false);
			}
		} catch (err) {
			console.error(`${MODULE_ID} | Error casting staff spell:`, err);
			ui.notifications.error("Failed to cast spell from staff");
		}
	});

	// Attach click handler to focus on staff spells
	spellsTab.find("[data-action='focus-staff-spell']").on("click", async (event) => {
		event.preventDefault();
		const $link = $(event.currentTarget);
		const spellUuid = $link.data("spell-uuid");
		const staffId = $link.data("staff-id");

		if (!spellUuid || !staffId) return;

		try {
			// Get the staff weapon
			const staff = actor.items.get(staffId);
			if (!staff) {
				ui.notifications.error("Staff weapon not found");
				return;
			}

			// Get spell reference
			const staffSpells = staff.getFlag(MODULE_ID, "staffSpells") || [];
			const spellRef = staffSpells.find(s => s.uuid === spellUuid);

			if (!spellRef) {
				ui.notifications.error("Spell not found on staff");
				return;
			}

			// Check if has uses remaining
			if (spellRef.maxUses !== null && spellRef.currentUses === 0) {
				ui.notifications.warn("This spell has no uses remaining");
				return;
			}

			// Load the spell from UUID
			const spellDoc = await fromUuid(spellUuid);
			if (!spellDoc) {
				ui.notifications.error("Could not load spell");
				return;
			}

			// Create a temporary wand item (so it bypasses class restrictions)
			const spellData = spellDoc.toObject();

			// Determine spellcasting ability (use actor's primary if available, otherwise INT)
			let spellAbility = "int";
			const characterClass = await actor.getClass();
			if (characterClass?.system?.spellcasting?.ability) {
				spellAbility = characterClass.system.spellcasting.ability;
			}

			// Get the spell image - use staff image as fallback
			const spellImage = spellData.img || staff.img || "icons/svg/mystery-man.svg";

			// Copy all spell data to wand, including flags for damage/effects/etc
			const wandData = {
				name: `${staff.name} - ${spellData.name}`,
				type: "Wand",
				img: spellImage,
				system: {
					spellName: spellData.name,
					description: spellData.system.description,
					duration: spellData.system.duration,
					range: spellData.system.range,
					tier: spellData.system.tier,
					ability: spellAbility,
					cost: { gp: 0, sp: 0, cp: 0 },
					slots: { slots_used: 0 },
					equipped: true,
					lost: false,
					stashed: false
				},
				// Copy all flags from the spell (includes spellDamage, effects, etc.)
				flags: spellData.flags || {},
				// Copy effects from the spell
				effects: spellData.effects || []
			};

			const [tempWand] = await actor.createEmbeddedDocuments("Item", [wandData]);

			// Build options for skip prompt (like shift-click)
			const options = actor.buildOptionsForSkipPrompt(event, {});

			// Get ability bonus for the spell
			const abilityId = spellAbility;
			const abilityBonus = actor.abilityModifier(abilityId);

			// Get base difficulty (use 10 + tier as default if no class)
			let baseDifficulty = 10 + (wandData.system.tier || 1);
			if (characterClass?.system?.spellcasting?.baseDifficulty) {
				baseDifficulty = characterClass.system.spellcasting.baseDifficulty;
			}

			// Build roll data
			const rollType = wandData.system.spellName.slugify();
			const data = {
				rollType,
				item: tempWand,
				actor: actor,
				abilityBonus: abilityBonus,
				baseDifficulty: baseDifficulty,
				talentBonus: actor.system.spellcasting?.bonus || 0,
			};

			const parts = ["1d20", "@abilityBonus", "@talentBonus"];

			// Call rollSpell directly on the wand item, bypassing class checks
			await tempWand.rollSpell(parts, data, options);

			// Delay deletion to allow damage cards and automation to complete
			// Delete after 1 second to ensure all chat messages and automation finish
			setTimeout(async () => {
				try {
					await tempWand.delete();
				} catch (err) {
					// Item may already be deleted, ignore error
				}
			}, 1000);

			// Consume a use if limited
			if (spellRef.maxUses !== null && spellRef.maxUses > 0) {
				spellRef.currentUses = Math.max(0, (spellRef.currentUses ?? spellRef.maxUses) - 1);
				await staff.setFlag(MODULE_ID, "staffSpells", staffSpells);

				// Notify if depleted
				if (spellRef.currentUses === 0) {
					ui.notifications.warn(`${spellDoc.name} on ${staff.name} has no uses remaining`);
				}

				// Re-render the sheet to update the uses display
				sheet.render(false);
			}
		} catch (err) {
			console.error(`${MODULE_ID} | Error focusing on staff spell:`, err);
			ui.notifications.error("Failed to focus on spell from staff");
		}
	});

	//console.log(`${MODULE_ID} | Injected ${staffSpells.length} weapon spells for actor: ${actor.name}`);
}

/**
 * Inject recharge buttons for equipped weapons with spells in the inventory tab
 */
export function injectWeaponSpellRechargeButtons(app, html, actor) {
	if (!actor || actor.type !== "Player") return;

	// Find the inventory tab
	const $inventoryTab = html.find('.tab[data-tab="tab-inventory"]');
	if (!$inventoryTab.length) return;

	// Find all equipped weapon items and check if they have spells
	actor.items.forEach(item => {
		if (item.type !== "Weapon") return;
		if (!item.system?.equipped) return;

		const staffSpells = item.getFlag(MODULE_ID, "staffSpells") || [];
		if (staffSpells.length === 0) return;

		// Find this item's row in the inventory
		const $itemRow = $inventoryTab.find(`[data-item-id="${item.id}"]`).closest('.item');
		if (!$itemRow.length) return;

		// Find the actions div for this item
		const $actions = $itemRow.find('.actions');
		if (!$actions.length) return;

		// Check if recharge button already exists
		if ($actions.find('.sdx-recharge-weapon-spells').length > 0) return;

		// Create recharge button
		const $rechargeBtn = $(`
			<a class="sdx-recharge-weapon-spells"
			   data-item-id="${item.id}"
			   data-tooltip="Recharge all weapon spells"
			   style="color: #4ade80;">
				<i class="fas fa-arrows-rotate"></i>
			</a>
		`);

		// Add click handler
		$rechargeBtn.on('click', async (event) => {
			event.preventDefault();
			const itemId = $(event.currentTarget).data('item-id');
			const weapon = actor.items.get(itemId);
			if (!weapon) return;

			const spells = weapon.getFlag(MODULE_ID, "staffSpells") || [];
			if (spells.length === 0) return;

			// Restore all spell uses to maximum
			let recharged = false;
			spells.forEach(spell => {
				if (spell.maxUses !== null && spell.maxUses !== undefined) {
					if ((spell.currentUses ?? spell.maxUses) < spell.maxUses) {
						spell.currentUses = spell.maxUses;
						recharged = true;
					}
				}
			});

			if (recharged) {
				await weapon.setFlag(MODULE_ID, "staffSpells", spells);
				ui.notifications.info(`Recharged all spells on ${weapon.name}`);
				// Re-render the sheet to update displays
				app.render(false);
			} else {
				ui.notifications.info(`All spells on ${weapon.name} are already fully charged`);
			}
		});

		// Prepend the button to actions (so it appears first)
		$actions.prepend($rechargeBtn);
	});
}

/**
 * Patch the canUseMagicItems() method to also check for wands, scrolls, and equipped weapons with spells
 */
export function patchCanUseMagicItems() {
	// Shadowdark 4.x moved canUseMagicItems from ActorSD instance method to a
	// getter on the PlayerSD data model. libWrapper does not cleanly support
	// getter wrapping across all versions, so we override the descriptor
	// directly. Inside the getter `this` is the data model; the actor is
	// reached via `this.parent`.
	const Player = CONFIG.Actor.dataModels?.Player;
	const desc = Player?.prototype && Object.getOwnPropertyDescriptor(Player.prototype, "canUseMagicItems");
	if (!desc?.get) {
		console.warn(`${MODULE_ID} | canUseMagicItems getter not found on PlayerSD; skipping patch`);
		return;
	}
	if (Player.prototype.__sdxCanUseMagicItemsPatched) return;
	const originalGet = desc.get;
	Object.defineProperty(Player.prototype, "canUseMagicItems", {
		configurable: true,
		enumerable: desc.enumerable,
		set: desc.set,
		get() {
			const originalResult = originalGet.call(this);
			if (originalResult) return true;

			const actor = this.parent;
			if (!actor) return originalResult;

			const hasWands = actor.items.some(item => item.type === "Wand" && !item.system?.stashed);
			const hasScrolls = actor.items.some(item => item.type === "Scroll" && !item.system?.stashed);
			const equippedWeapons = actor.items.filter(item =>
				item.type === "Weapon" && item.system?.equipped === true
			);
			const hasWeaponSpells = equippedWeapons.some(weapon => {
				const spellRefs = weapon.getFlag(MODULE_ID, "staffSpells") || [];
				return spellRefs.length > 0;
			});

			return hasWands || hasScrolls || hasWeaponSpells;
		}
	});
	Player.prototype.__sdxCanUseMagicItemsPatched = true;
}

/**
 * Register the hook that keeps an open weapon sheet in step with its spells.
 *
 * Called from the root at the position this hook occupied, so its place in the
 * `updateItem` registration order is unchanged.
 */
export function registerStaffSpellHooks() {
	// Re-render weapon sheet when staff spells are updated
	Hooks.on("updateItem", (item, changes, options, userId) => {
		// Check if staffSpells flag was updated
		if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.staffSpells`)) {
			// Re-render any open item sheets for this weapon
			Object.values(item.apps).forEach(app => {
				if (app.rendered) {
					app.render(false);
				}
			});
		}
	});
}

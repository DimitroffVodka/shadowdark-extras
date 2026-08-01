/**
 * Broadcasting Shadowdark's character-generator rolls to chat.
 *
 * Extracted from the composition root in Phase 3. Patches the system's own
 * `CharacterGeneratorSD` so every player sees the generation results instead
 * of only the roller.
 *
 * Owned by character-sheet: it is PC-facing creation behaviour, and the
 * feature map's Character sheets row is the only bucket that covers the
 * player-character lifecycle. It is not shared/ — that takes a helper at its
 * second consumer, and the root's single call is the only one.
 *
 * Registration-free. The patch installs when `patchCharacterGeneratorRolls`
 * is called, which the root still does from its original position.
 */

import { MODULE_ID } from "../shared/module-id.mjs";

// ============================================
// CHARACTER GENERATOR ROLL PATCH
// ============================================

/**
 * Patch CharacterGeneratorSD to show dice rolls in chat
 * So all players can see character generation results
 */
export function patchCharacterGeneratorRolls() {
	// Get the CharacterGeneratorSD class from the shadowdark namespace
	const CharacterGeneratorSD = CONFIG.SHADOWDARK?.applications?.CharacterGeneratorSD
		|| globalThis.shadowdark?.apps?.CharacterGeneratorSD
		|| game.shadowdark?.apps?.CharacterGeneratorSD;

	if (!CharacterGeneratorSD) {
		console.warn(`${MODULE_ID} | CharacterGeneratorSD not found, skipping roll patch`);
		return;
	}

	// Correct ability order: STR, DEX, CON, INT, WIS, CHA
	const ABILITY_ORDER = ["str", "dex", "con", "int", "wis", "cha"];
	const ABILITY_NAMES = {
		str: "Strength",
		dex: "Dexterity",
		con: "Constitution",
		int: "Intelligence",
		wis: "Wisdom",
		cha: "Charisma",
	};

	// Override _randomizeStats to use correct order and show per-ability rolls
	// If no ability reaches 14+, all results are colored red
	CharacterGeneratorSD.prototype._randomizeStats = async function() {
		// Roll all abilities first (silently)
		const rolls = {};
		let hasHighStat = false;

		for (const key of ABILITY_ORDER) {
			const roll = await new Roll("3d6").evaluate();
			rolls[key] = roll;
			if (roll.total >= 14) hasHighStat = true;
		}

		// Collect message IDs if we need to update them
		const messageIds = [];

		// Send messages one at a time. roll.toMessage() handles render() +
		// ChatMessage.create + DSN hook properly (ChatMessage.create with just
		// `rolls: [...]` leaves the dice unrendered in v13+, only the formula shows).
		for (const key of ABILITY_ORDER) {
			const roll = rolls[key];
			const message = await roll.toMessage({
				speaker: ChatMessage.getSpeaker({ user: game.user }),
				flavor: `<b>Character Generator</b> - ${ABILITY_NAMES[key]}`,
			});
			if (message) messageIds.push(message.id);

			// SD 4.x migrated abilities.base -> abilities.value (PlayerSD.mjs:15);
			// _calculateModifiers() reads `.value` to compute the modifier.
			this.formData.actor.system.abilities[key].value = roll.total;
		}

		// If no high stat, update all messages to show red totals
		if (!hasHighStat) {
			// Small delay to let messages render
			setTimeout(() => {
				for (const msgId of messageIds) {
					const msgElement = document.querySelector(`[data-message-id="${msgId}"] .dice-total`);
					if (msgElement) {
						msgElement.style.color = "#cc0000";
						msgElement.style.fontWeight = "bold";
					}
				}
			}, 100);
		}

		this._calculateModifiers();
	};

	// Override _randomizeGold to show gold roll
	CharacterGeneratorSD.prototype._randomizeGold = async function() {
		const roll = await new Roll("2d6").evaluate();
		const startingGold = roll.total * 5;

		// roll.toMessage triggers DSN automatically via Foundry hooks
		await roll.toMessage({
			speaker: ChatMessage.getSpeaker({ user: game.user }),
			flavor: `<b>Character Generator</b> - Starting Gold (×5 = ${startingGold} GP)`,
		});

		this.formData.actor.system.coins.gp = startingGold;
	};

	// Override _randomizeAlignment to show alignment roll
	CharacterGeneratorSD.prototype._randomizeAlignment = async function() {
		const roll = await new Roll("d6").evaluate();
		let alignment;

		switch (roll.total) {
			case 1:
			case 2:
			case 3:
				alignment = "lawful";
				break;
			case 4:
			case 5:
				alignment = "neutral";
				break;
			default:
				alignment = "chaotic";
		}

		// roll.toMessage triggers DSN automatically via Foundry hooks
		await roll.toMessage({
			speaker: ChatMessage.getSpeaker({ user: game.user }),
			flavor: `<b>Character Generator</b> - Alignment (${alignment.charAt(0).toUpperCase() + alignment.slice(1)})`,
		});

		this.formData.actor.system.alignment = alignment;
	};

	console.log(`${MODULE_ID} | Patched CharacterGeneratorSD to show rolls in chat`);
}

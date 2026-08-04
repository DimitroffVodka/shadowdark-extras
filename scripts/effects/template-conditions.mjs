// Template conditions leaf — extracted from
// scripts/effects/TemplateEffectsSD.mjs (Phase 5.3 lane-C split).
// Condition/Effect item application + removal with focus/duration
// tracker linking. Leaf: local MODULE_ID const; no sibling imports.

const MODULE_ID = "shadowdark-extras";

export async function applyTemplateConditions(templateDoc, token, effectUuids) {
	// Handle edge case where effectUuids is a JSON-encoded string (incorrectly stored flag)
	if (typeof effectUuids === "string") {
		try {
			if (effectUuids.trim().startsWith("[") || effectUuids.trim().startsWith("{")) {
				const parsed = JSON.parse(effectUuids);
				// Recursively call with the parsed data
				await applyTemplateConditions(
					templateDoc, token, Array.isArray(parsed) ? parsed : [parsed]
				);
				return;
			}
		}
		catch(e) {
			console.warn("shadowdark-extras | Failed to parse stringified effectUuids:", e);
		}
	}

	console.log(`shadowdark-extras | applyTemplateConditions: Called with ${effectUuids?.length} UUIDs for ${token.name}`);

	if (!effectUuids || effectUuids.length === 0) {
		console.warn("shadowdark-extras | applyTemplateConditions: No effect UUIDs provided");
		return;
	}

	const actor = token.actor;
	if (!actor) {
		console.warn("shadowdark-extras | applyTemplateConditions: No actor found for token");
		return;
	}

	for (const effectRef of effectUuids) {
		try {
			console.log("shadowdark-extras | applyTemplateConditions: Processing effect ref", typeof effectRef);

			let effectData;
			let effectName;

			if (typeof effectRef === "string") {
				const effectDoc = await fromUuid(effectRef);
				if (!effectDoc) {
					console.warn(`shadowdark-extras | applyTemplateConditions: Could not find effect for UUID ${effectRef}`);
					continue;
				}
				effectData = effectDoc.toObject();
				effectName = effectDoc.name;
			}
			else if (typeof effectRef === "object") {
				if (effectRef.uuid && typeof effectRef.uuid === "string" && !effectRef.changes && !effectRef.effects) {
					console.log(`shadowdark-extras | applyTemplateConditions: Found UUID wrapper object, resolving ${effectRef.uuid}`);
					const effectDoc = await fromUuid(effectRef.uuid);
					if (!effectDoc) {
						console.warn(`shadowdark-extras | applyTemplateConditions: Could not find effect for UUID ${effectRef.uuid}`);
						continue;
					}
					effectData = effectDoc.toObject();
					effectName = effectDoc.name;
				}
				else if (typeof effectRef.toObject === "function") {
					effectData = effectRef.toObject();
					effectName = effectRef.name;
				}
				else {
					effectData = foundry.utils.deepClone(effectRef);
					effectName = effectData.name || "Effect";
				}
			}
			else {
				console.warn(`shadowdark-extras | applyTemplateConditions: Invalid effect reference type: ${typeof effectRef}`);
				continue;
			}

			if (!effectName && effectData.label) effectName = effectData.label;
			if (!effectName) effectName = "Template Effect";
			effectData.name = effectName;

			if (!effectData.type) {
				if (effectData.changes || effectData.duration) {
					console.log("shadowdark-extras | applyTemplateConditions: Detected ActiveEffect data. Wrapping in Item...");
					const aeData = foundry.utils.deepClone(effectData);
					aeData.name = aeData.name || aeData.label || effectName;
					effectData = {
						name: effectName,
						type: "Effect",
						img: aeData.icon || "icons/svg/aura.svg",
						effects: [aeData],
					};
				}
				else {
					console.warn("shadowdark-extras | applyTemplateConditions: Missing type on effect data, forcing 'Effect'");
					effectData.type = "Effect";
				}
			}
			// Check if actor already has this effect from this template
			// Also check the original Spell's effect (Focus Tracker application)
			// We check the CASTER's flags because Focus Tracker effects might not have origin set
			const config = templateDoc.flags?.[MODULE_ID]?.templateEffects;
			let focusEffectId = null;

			if (config?.casterActorId && config?.spellId) {
				const caster = game.actors.get(config.casterActorId);
				if (caster) {
					// Check Focus Spells
					const activeFocus = caster.getFlag(MODULE_ID, "activeFocusSpells") || [];
					const focusEntry = activeFocus.find(f => f.spellId === config.spellId);
					if (focusEntry) {
						const targetEntry = focusEntry.targetEffects?.find(te =>
							te.targetActorId === actor.id || te.targetTokenId === token.id
						);
						if (targetEntry) focusEffectId = targetEntry.effectItemId;
					}

					// Check Duration Spells (e.g. Web)
					if (!focusEffectId) {
						const activeDuration = caster.getFlag(MODULE_ID, "activeDurationSpells") || [];
						const durationEntry = activeDuration.find(
							d => d.spellId === config.spellId
						);
						if (durationEntry) {
							const targetEntry = durationEntry.targetEffects?.find(te =>
								te.targetActorId === actor.id || te.targetTokenId === token.id
							);
							if (targetEntry) focusEffectId = targetEntry.effectItemId;
						}
					}
				}
			}

			const existingEffect = actor.items.find(i =>
				i.type === "Effect"
						&& (
							i.getFlag(MODULE_ID, "templateOrigin") === templateDoc.id
					|| (focusEffectId && i.id === focusEffectId)
						)
			);

			if (existingEffect) {
				console.log("shadowdark-extras | applyTemplateConditions: Effect already exists (Template or Focus Tracker), skipping");
				continue; // Don't stack
			}
			effectData.flags = effectData.flags || {};
			effectData.flags[MODULE_ID] = effectData.flags[MODULE_ID] || {};
			effectData.flags[MODULE_ID].templateOrigin = templateDoc.id;
			effectData.origin = templateDoc.uuid;

			console.log(`shadowdark-extras | applyTemplateConditions: Setting templateOrigin flag to ${templateDoc.id} for new effect`);

			// -------------------------------------------------------------
			// REQUIREMENT CHECK
			// -------------------------------------------------------------

			console.log("shadowdark-extras | debug: inspecting effectData", JSON.stringify(effectData, null, 2));

			// Shadowdark effects often have a system.requirements field (e.g., "@target.level < 3")
			// We must evaluate this against the target actor.
			// Requirement is stored on the template flags (copied from Spell config)
			const requirements =
				templateDoc.flags?.[MODULE_ID]?.templateEffects?.effectsRequirement;

			if (requirements && typeof requirements === "string" && requirements.trim().length > 0) {
				try {
					// Replace @target. references with actor data
					// We use Roll.safeEval or a simple Function evaluation with restricted scope
					// For safety/simplicity try Foundry's Roll parser if possible,
					// or simple string substitution for common properties.

					// Prepare data object
					const rollData = actor.getRollData();
					const targetData = rollData; // In alias context, @target is the actor

					// Replace @target. with just target. prop for eval, or replace with values
					// Let's use Roll.replaceFormulaData logic if available, or manual replacement
					// Shadowdark system uses @target syntax.

					// Simple regex replacement for common properties to raw values
					let evalString = requirements;

					// Helper to resolve dot notation
					const resolveProp = (obj, path) => path.split(".").reduce((o, i) => o?.[i], obj);

					// Replace @target.path
					evalString = evalString.replace(/@target\.([\w.]+)/g, (match, path) => {
						let val = resolveProp(targetData, path);
						// Some Shadowdark stats are objects with a .value property
						if (val !== null && typeof val === "object" && val.value !== undefined) {
							val = val.value;
						}
						return val !== undefined ? val : 0;
					});

					// Replace @level treated as target level
					evalString = evalString.replace(/@level/g, match => {
						return targetData.level?.value ?? targetData.level ?? 0;
					});

					// Evaluate
					const result = Roll.safeEval(evalString);

					if (!result) {
						console.log(`shadowdark-extras | Requirement not met for ${effectName} on ${token.name}. Req: "${requirements}" -> "${evalString}"`);
						ui.notifications.info(`${actor.name} resists ${effectName} (Requirement not met)`);
						continue; // Skip application
					}

					console.log(`shadowdark-extras | Requirement met for ${effectName}: "${requirements}" -> ${result}`);

				}
				catch(err) {
					console.warn(`shadowdark-extras | Error evaluating requirement "${requirements}":`, err);
					// On error, do we fail safe or permissive? Usually permissive unless critical.
					// Bad syntax likely: allow it to be safe?
					// Or fail? Let's log and proceed for now, blocking only on definite false.
				}
			}

			console.log(`shadowdark-extras | applyTemplateConditions: Creating effect ${effectName} on ${token.name} with origin ${templateDoc.id}`);
			const createdEffects = await actor.createEmbeddedDocuments("Item", [effectData]);
			console.log(`shadowdark-extras | Applied effect ${effectName} to ${token.name}`);

			// Link to Focus Tracker so the UI counter updates on re-enter
			if (config?.casterActorId && config?.spellId && createdEffects.length > 0) {
				const newEffectId = createdEffects[0].id;
				const caster = game.actors.get(config.casterActorId);
				if (caster) {
					// We must fetch fresh flags to avoid overwriting recent changes
					const activeFocus = caster.getFlag(MODULE_ID, "activeFocusSpells") || [];
					const focusEntry = activeFocus.find(f => f.spellId === config.spellId);

					if (focusEntry) {
						// Avoid duplicates in the list
						const isAlreadyLinked = focusEntry.targetEffects.some(
							te => te.effectItemId === newEffectId
						);
						if (!isAlreadyLinked) {
							focusEntry.targetEffects.push({
								targetActorId: actor.id,
								targetTokenId: token.id,
								effectItemId: newEffectId,
								targetName: token.name || actor.name,
							});
							await caster.setFlag(MODULE_ID, "activeFocusSpells", activeFocus);
							// Refresh sheet to show updated count
							if (caster.sheet?.rendered) caster.sheet.render(false);
							console.log(`shadowdark-extras | Linked re-applied effect ${newEffectId} to focus spell ${config.spellId}`);
						}
					}
				}
			}

		}
		catch(err) {
			console.error("shadowdark-extras | Error applying effect:", err);
		}
	}
}

/**
 * Remove effects applied by a template when token leaves
 */
export async function removeTemplateEffects(templateDoc, token) {
	const actor = token.actor;
	if (!actor) return;

	// Get Focus Tracker effect ID from Caster's flags
	const config = templateDoc.flags?.[MODULE_ID]?.templateEffects;
	let focusEffectId = null;

	if (config?.casterActorId && config?.spellId) {
		const caster = game.actors.get(config.casterActorId);
		if (caster) {
			// Check Focus Spells
			const activeFocus = caster.getFlag(MODULE_ID, "activeFocusSpells") || [];
			const focusEntry = activeFocus.find(f => f.spellId === config.spellId);
			if (focusEntry) {
				const targetEntry = focusEntry.targetEffects?.find(te =>
					te.targetActorId === actor.id || te.targetTokenId === token.id
				);
				if (targetEntry) focusEffectId = targetEntry.effectItemId;
			}

			// Check Duration Spells (e.g. Web)
			if (!focusEffectId) {
				const activeDuration = caster.getFlag(MODULE_ID, "activeDurationSpells") || [];
				const durationEntry = activeDuration.find(d => d.spellId === config.spellId);
				if (durationEntry) {
					const targetEntry = durationEntry.targetEffects?.find(te =>
						te.targetActorId === actor.id || te.targetTokenId === token.id
					);
					if (targetEntry) focusEffectId = targetEntry.effectItemId;
				}
			}
		}
	}

	// Find effects from this template OR from the original spell (Focus Tracker)
	const effectsToRemove = actor.items.filter(i =>
		i.type === "Effect"
				&& (
					i.getFlag(MODULE_ID, "templateOrigin") === templateDoc.id
				|| i.origin === templateDoc.uuid
            || (focusEffectId && i.id === focusEffectId)
				)
	);

	console.log(`shadowdark-extras | removeTemplateEffects: Found ${effectsToRemove.length} effects to remove from ${token.name}`);

	if (effectsToRemove.length > 0) {
		const ids = effectsToRemove.map(e => e.id);
		await actor.deleteEmbeddedDocuments("Item", ids);
		console.log(`shadowdark-extras | Removed ${ids.length} template effects from ${token.name}`);
	}
}

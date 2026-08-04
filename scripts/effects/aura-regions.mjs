import { MODULE_ID } from "./aura-constants.mjs";

// Aura region creation/FX cluster — extracted from
// scripts/effects/AuraEffectsSD.mjs (Phase 5.1 split).
// Bearer-token lookup, region creation + visual FX, deletion, and the
// createAuraOnActor entry point. Reaches the engine (SD) via dynamic
// imports inside async createAuraOnActor only.

// Dedupe guard for in-flight aura creation (declared here — only the
// regions cluster reads/writes it).
const _auraCreationInFlight = new Set();

function getAuraBearerToken(actor, bearerTokenId = null) {
	if (!canvas?.tokens) return null;
	if (bearerTokenId) {
		const explicit = canvas.tokens.get(bearerTokenId);
		if (explicit?.actor?.id === actor?.id) return explicit;
	}
	return canvas.tokens.placeables.find(t => t.actor?.id === actor?.id) || null;
}

async function createAuraRegion(token, effect, config, sourceItem) {
	try {
		if (!game.user.isGM) return null;

		const tokenDoc = token?.document;
		if (!tokenDoc?.persisted || !canvas?.scene) return null;

		const RegionDocument = foundry.documents?.RegionDocument?.implementation
			?? foundry.documents?.RegionDocument;
		if (typeof RegionDocument?.createTokenEmanation !== "function") return null;

		const nativeRegion = config.nativeRegion || {};
		const color = nativeRegion.color || "#ffffff";
		const radius = Number(config.radius) || 30;
		const auraRegionVisibility = CONST.REGION_VISIBILITY?.LAYER_UNLOCKED ?? 4;

		const region = await RegionDocument.createTokenEmanation(tokenDoc, radius, {
			name: `${sourceItem.name} (Aura)`,
			color,
			visibility: auraRegionVisibility,
			restriction: {
				enabled: true,
				type: "move",
				priority: 0,
			},
			hidden: !!tokenDoc.hidden,
			locked: false,
			flags: {
				[MODULE_ID]: {
					auraRegion: true,
					auraEffectId: effect.id,
					auraActorId: effect.parent?.id,
					sourceItemUuid: sourceItem.uuid,
					tokenFilters: foundry.utils.deepClone(config.tokenFilters || {}),
				},
			},
		}, {
			excludeToken: false,
			gridBased: false,
		});

		if (region) {
			await region.update({
				[`flags.${MODULE_ID}.auraRegion`]: true,
				[`flags.${MODULE_ID}.auraEffectId`]: effect.id,
				[`flags.${MODULE_ID}.auraActorId`]: effect.parent?.id,
				[`flags.${MODULE_ID}.sourceItemUuid`]: sourceItem.uuid,
				[`flags.${MODULE_ID}.tokenFilters`]: foundry.utils.deepClone(config.tokenFilters || {}),
				"visibility": auraRegionVisibility,
				"restriction.enabled": true,
				"restriction.type": "move",
				"restriction.priority": 0,
			});
			await effect.update({ [`flags.${MODULE_ID}.aura.regionId`]: region.id });
			await applyAuraRegionVisualFx(region, config.visualFx);
		}

		return region;
	}
	catch(err) {
		console.warn("shadowdark-extras | Failed to create attached aura Region:", err);
		return null;
	}
}

function getTokenMagicTintValue(tint) {
	if (!tint) return null;
	if (typeof tint === "number") return tint;
	const parsed = parseInt(String(tint).replace("#", ""), 16);
	return Number.isFinite(parsed) ? parsed : null;
}

async function applyTokenMagicAuraRegionFx(region, visualFx) {
	const tmfx = visualFx?.tmfx || {};
	const preset = tmfx.preset || "NOFX";
	if (!(preset && preset !== "NOFX")) return;
	if (!game.modules.get("tokenmagic")?.active || !globalThis.TokenMagic?.addFilters) return;

	await region.update({
		"flags.tokenmagic.regionData": { opacity: Number(tmfx.opacity ?? 0.5) },
	});

	const tintValue = getTokenMagicTintValue(tmfx.tint);
	const withTint = request => tintValue === null ? request : { ...request, color: tintValue };

	let presetParams = null;
	if (typeof globalThis.TokenMagic.getPreset === "function") {
		const candidates = [
			{ name: preset, library: "tmfx-region" },
			{ name: preset, library: "tmfx-template" },
			{ name: preset, library: "tmfx-main" },
			preset,
		];

		for (const candidate of candidates) {
			presetParams = globalThis.TokenMagic.getPreset(withTint(candidate));
			if (Array.isArray(presetParams) && presetParams.length) break;
		}

		if (!(Array.isArray(presetParams) && presetParams.length)) {
			try {
				const presets = game.settings.get("tokenmagic", "presets") || [];
				const match = presets.find(p =>
					String(p?.name || "").toLowerCase() === String(preset).toLowerCase()
                    && ["tmfx-region", "tmfx-template", "tmfx-main"].includes(p?.library)
				);
				if (match) {
					presetParams = globalThis.TokenMagic.getPreset(
						withTint({ name: match.name, library: match.library })
					);
				}
			}
			catch(e) {
				// The setting is not guaranteed to exist across TokenMagic versions.
			}
		}
	}

	if (Array.isArray(presetParams) && presetParams.length) {
		await globalThis.TokenMagic.addFilters(region, presetParams, true);
	}
	else {
		console.warn(`shadowdark-extras | TokenMagic aura preset not found or has no filters: ${preset}`);
	}
}

function applyIndyFxAuraRegion(region, visualFx) {
	const indyFx = visualFx?.indy || {};
	if (!indyFx.shaderId) return;
	if (!game.modules.get("indy-fx")?.active || typeof game.indyFX?.shaderOnRegion !== "function") return;

	game.indyFX.shaderOnRegion(region.id, {
		shaderId: indyFx.shaderId,
		layer: indyFx.layer || "inherit",
		alpha: Number(indyFx.alpha ?? 1),
		speed: Number(indyFx.speed ?? 1),
		scale: Number(indyFx.scale ?? 1),
		scaleX: Number(indyFx.scale ?? 1),
		scaleY: Number(indyFx.scale ?? 1),
		displayTimeMs: 0,
	});
}

async function applyAuraRegionVisualFx(region, visualFx) {
	try {
		const engine = visualFx?.engine || "none";
		if (engine === "tmfx") await applyTokenMagicAuraRegionFx(region, visualFx);
		else if (engine === "indy") applyIndyFxAuraRegion(region, visualFx);
	}
	catch(err) {
		console.warn("shadowdark-extras | Failed to apply aura Region visual FX:", err);
	}
}

export async function deleteAuraRegion(effect) {
	try {
		const scene = canvas?.scene;
		if (!scene) return;

		const auraConfig = effect.flags?.[MODULE_ID]?.aura;
		const regionId = auraConfig?.regionId;
		const flaggedRegions = [...(scene.regions || [])].filter(r =>
			r.id === regionId
			|| (r.flags?.[MODULE_ID]?.auraRegion
				&& r.flags?.[MODULE_ID]?.auraEffectId === effect.id)
		);

		const ids = flaggedRegions.map(r => r.id);
		if (ids.length) await scene.deleteEmbeddedDocuments("Region", ids);
	}
	catch(err) {
		console.warn("shadowdark-extras | Failed to delete attached aura Region:", err);
	}
}

export async function removeExistingAurasForSource(actor, sourceItem) {
	if (!game.user.isGM || !actor || !sourceItem) return;

	const existing = [...(actor.effects || [])].filter(effect => {
		const auraConfig = effect.flags?.[MODULE_ID]?.aura;
		if (!auraConfig?.enabled) return false;
		return auraConfig.spellId === sourceItem.id || effect.origin === sourceItem.uuid;
	});

	for (const effect of existing) {
		await deleteAuraRegion(effect);
		// Dynamic import breaks the cluster<->SD cycle (Phase 5.1 split)
		const { removeAuraEffectsFromAll } = await import("./AuraEffectsSD.mjs");
		await removeAuraEffectsFromAll(effect);
	}

	const ids = existing.map(effect => effect.id).filter(Boolean);
	if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
}

/**
 * Create aura effect on an actor
 * @param {Actor} actor - The actor to receive the aura
 * @param {Object} auraConfig - The aura configuration
 * @param {Item} sourceItem - The source item (spell)
 * @returns {ActiveEffect} The created effect
 */
export async function createAuraOnActor(actor, auraConfig, sourceItem, duration = null,
	expiryRounds = null) {
	const creationKey = `${actor?.id || "actor"}:${sourceItem?.uuid || sourceItem?.id || "source"}`;
	if (_auraCreationInFlight.has(creationKey)) {
		await new Promise(resolve => {
			setTimeout(resolve, 300);
		});
		const existing = [...(actor.effects || [])].find(effect => {
			const existingConfig = effect.flags?.[MODULE_ID]?.aura;
			if (!existingConfig?.enabled) return false;
			return existingConfig.spellId === sourceItem.id
				|| existingConfig.sourceItemUuid === sourceItem.uuid
				|| effect.origin === sourceItem.uuid;
		});
		if (existing) return existing;
	}

	_auraCreationInFlight.add(creationKey);

	try {
		// Snapshot combat state BEFORE the awaited document writes below.
		// Writing actor flags/effects makes game.combat transiently return null
		// for a few hundred ms, so reading it afterwards recorded an undefined
		// start round for the aura.
		const inCombat = !!game.combat;
		const combatId = game.combat?.id ?? null;
		const combatRound = game.combat?.round ?? null;
		const combatTurn = game.combat?.turn ?? null;

		await removeExistingAurasForSource(actor, sourceItem);

		// Generate a unique status ID for this aura
		const auraStatusId = `sdx-aura-${sourceItem.id}`;

		const effectData = {
			name: `${sourceItem.name} (Aura)`,
			img: sourceItem.img,
			origin: sourceItem.uuid,
			// Add statuses to show as icon on token
			statuses: [auraStatusId],
			// v14 ActiveEffect duration is {value, units, expiry, expired}; combat
			// anchoring moved to a sibling `start`. The old {rounds, startRound,
			// startTime} keys only survive via the legacy migration shim.
			duration: { value: expiryRounds, units: "rounds", expiry: "turnStart" },
			start: inCombat
				? {
					combat: combatId,
					round: combatRound,
					turn: combatTurn,
					time: game.time.worldTime,
				}
				: { time: game.time.worldTime },
			flags: {
				[MODULE_ID]: {
					aura: {
						enabled: true,
						radius: auraConfig.radius || 30,
						triggers: auraConfig.triggers || {},
						damage: auraConfig.damage || {},
						save: auraConfig.save || {},
						effects: auraConfig.effects || [],
						tokenFilters: auraConfig.tokenFilters || {},
						nativeRegion: auraConfig.nativeRegion || {},
						visualFx: auraConfig.visualFx || {},
						disposition: auraConfig.disposition || "all",
						includeSelf: auraConfig.includeSelf || false,
						checkVisibility: auraConfig.checkVisibility || false,
						applyConfiguredEffects: auraConfig.applyConfiguredEffects || false,
						effectsTriggers: auraConfig.effectsTriggers || {},
						damageTriggers: auraConfig.damageTriggers || {},
						runItemMacro: auraConfig.runItemMacro || false,
						macroTriggers: auraConfig.macroTriggers || {},
						spellId: sourceItem.id,
						sourceItemUuid: sourceItem.uuid,
						casterActorId: auraConfig.casterActorId || sourceItem.actor?.id || null,
						trackerType: auraConfig.trackerType || null,
						trackerInstanceId: auraConfig.trackerInstanceId || null,
					},
				},
			},
		};

		const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [effectData]);

		const bearerToken = getAuraBearerToken(actor, auraConfig.bearerTokenId);
		if (bearerToken && auraConfig.nativeRegion?.enabled !== false) {
			await createAuraRegion(bearerToken, effect, auraConfig, sourceItem);
		}

		// Process initial tokens in aura range (apply effects immediately on creation)
		// Use canvas.tokens.placeables (Token objects with .center), NOT actor.token
		const sourceToken = getAuraBearerToken(actor, auraConfig.bearerTokenId);
		// Dynamic import breaks the cluster<->SD cycle (Phase 5.1 split)
		const { shouldAnyComponentTrigger } = await import("./AuraEffectsSD.mjs");
		if (sourceToken && shouldAnyComponentTrigger(auraConfig, "enter")) {

			const config = {
				radius: auraConfig.radius || 30,
				triggers: auraConfig.triggers || {},
				damage: auraConfig.damage || {},
				save: auraConfig.save || {},
				effects: auraConfig.effects || [],
				tokenFilters: auraConfig.tokenFilters || {},
				nativeRegion: auraConfig.nativeRegion || {},
				visualFx: auraConfig.visualFx || {},
				disposition: auraConfig.disposition || "all",
				includeSelf: auraConfig.includeSelf || false,
				checkVisibility: auraConfig.checkVisibility || false,
				applyConfiguredEffects: auraConfig.applyConfiguredEffects || false,
				effectsTriggers: auraConfig.effectsTriggers || {},
				damageTriggers: auraConfig.damageTriggers || {},
				runItemMacro: auraConfig.runItemMacro || false,
				macroTriggers: auraConfig.macroTriggers || {},
				spellId: sourceItem.id,
				sourceItemUuid: sourceItem.uuid,
				casterActorId: auraConfig.casterActorId || sourceItem.actor?.id || null,
				trackerType: auraConfig.trackerType || null,
				trackerInstanceId: auraConfig.trackerInstanceId || null,
			};

			// Get all tokens in scene

			for (const otherToken of canvas.tokens.placeables) {
				// 1. Basic Skip Checks
				if (otherToken.id === sourceToken.id && !config.includeSelf) continue;
				if (!otherToken.actor) continue;

				// 2. Range Check
				// Dynamic import breaks the cluster<->SD cycle (Phase 5.1 split)
				const { isTokenInAura } = await import("./AuraEffectsSD.mjs");
				const isInRange = isTokenInAura(sourceToken, otherToken, config.radius);
				if (!isInRange) continue;

				// 3. Disposition Check
				// Dynamic import breaks the cluster<->SD cycle (Phase 5.1 split)
				const { checkDisposition } = await import("./AuraEffectsSD.mjs");
				const dispOk = checkDisposition(sourceToken, otherToken, config.disposition);
				if (!dispOk) {
					continue;
				}

				// 4. Visibility Check
				if (config.checkVisibility) {
					// Dynamic import breaks the cluster<->SD cycle (Phase 5.1 split)
					const { checkAuraVisibility } = await import("./AuraEffectsSD.mjs");
					const isVisible = checkAuraVisibility(sourceToken, otherToken);
					if (!isVisible) {
						continue;
					}
				}

				// Dynamic import breaks the cluster<->SD cycle (Phase 5.1 split)
				const { applyAuraEffect } = await import("./AuraEffectsSD.mjs");
				await applyAuraEffect(sourceToken, otherToken, "enter", config, effect);
			}
		}
		else if (!sourceToken) {
			// no source token to inspect
		}

		return effect;
	}
	finally {
		_auraCreationInFlight.delete(creationKey);
	}
}

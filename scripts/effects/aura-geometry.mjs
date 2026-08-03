// Aura geometry / query leaf — extracted from
// scripts/effects/AuraEffectsSD.mjs (Phase 5.3 lane-C split).
// Pure canvas queries: containment, visibility, disposition.
// Leaf: imports only aura-constants.

import { MODULE_ID } from "./aura-constants.mjs";

/**
 * Whether this client has an initialised canvas with a token layer.
 * Guards the transient case a normal client also hits — canvas not ready yet,
 * or no active scene — which the `noCanvas` check below cannot cover.
 */
export function isCanvasAvailable() {
	return !!(canvas?.ready && canvas.tokens);
}

/**
 * Get all active aura effects on the scene
 * @returns {Array} Array of {effect, token, config} objects
 */
export function getActiveAuras() {
	const auras = [];
	const seenAuras = new Set();
	if (!isCanvasAvailable()) return auras;

	for (const token of canvas.tokens.placeables) {
		if (!token.actor) continue;

		// Check all effects on the actor for aura configurations
		const effects = token.actor.effects || [];
		for (const effect of effects) {
			const auraConfig = effect.flags?.[MODULE_ID]?.aura;
			if (auraConfig?.enabled) {
				const auraKey = `${token.id}:${auraConfig.spellId || effect.origin || effect.id}`;
				if (seenAuras.has(auraKey)) continue;
				seenAuras.add(auraKey);
				auras.push({
					effect: effect,
					token: token,
					config: auraConfig,
				});
			}
		}
	}

	return auras;
}

/**
 * Get tokens within an aura's radius
 * @param {Token} sourceToken - The token with the aura
 * @param {number} radiusFeet - Radius in feet
 * @param {string} disposition - 'ally', 'enemy', or 'all'
 * @param {boolean} includeSelf - Whether to include the source token
 * @returns {Token[]} Array of tokens within the aura
 */
export function getTokensInAura(sourceToken, radiusFeet, disposition = "all", includeSelf = false) {
	const tokens = [];
	if (!isCanvasAvailable()) return tokens;
	const gridDistance = canvas.scene.grid.distance || 5; // feet per grid unit
	const radiusPixels = (radiusFeet / gridDistance) * canvas.grid.size;

	const sourceCenter = sourceToken.center;

	for (const token of canvas.tokens.placeables) {
		if (!token.actor) continue;
		if (!includeSelf && token.id === sourceToken.id) continue;

		// Check disposition
		if (disposition !== "all") {
			const sourceDisp = sourceToken.document.disposition;
			const tokenDisp = token.document.disposition;

			if (disposition === "ally" && sourceDisp !== tokenDisp) continue;
			if (disposition === "enemy" && sourceDisp === tokenDisp) continue;
		}

		// Calculate distance from source center to token center
		const tokenCenter = token.center;
		const distance = Math.hypot(tokenCenter.x - sourceCenter.x, tokenCenter.y - sourceCenter.y);

		if (distance <= radiusPixels) {
			tokens.push(token);
		}
	}

	return tokens;
}

/**
 * Check if a token is within an aura
 * @param {Token} sourceToken - The aura source token
 * @param {Token} testToken - The token to test
 * @param {number} radiusFeet - Radius in feet
 * @returns {boolean}
 */
export function isTokenInAura(sourceToken, testToken, radiusFeet) {
	// Safety check for missing center properties
	if (!sourceToken?.center || !testToken?.center) {
		return false;
	}

	const gridDistance = canvas.scene.grid.distance || 5;
	const radiusPixels = (radiusFeet / gridDistance) * canvas.grid.size;

	const distance = Math.hypot(
		testToken.center.x - sourceToken.center.x,
		testToken.center.y - sourceToken.center.y
	);

	return distance <= radiusPixels;
}

/**
 * Check if a position is within aura range of a source position (for source movement)
 */
export function isPositionInAuraAtPosition(sourceCenter, testCenter, radiusFeet) {
	const gridDistance = canvas.grid.distance || canvas.scene?.grid?.distance || 5;
	const radiusPixels = (radiusFeet / gridDistance) * canvas.grid.size;
	const distance = Math.hypot(testCenter.x - sourceCenter.x, testCenter.y - sourceCenter.y);
	return distance <= radiusPixels;
}

/**
 * Check if the aura source can see the target token
 * @param {Token} sourceToken - The token carrying the aura
 * @param {Token} targetToken - The target token
 * @param {Object} [fromPosition] - Optional position to check from (instead of sourceToken.center)
 * @param {Object} [toPosition] - Optional position to check to (instead of targetToken.center)
 * @returns {boolean} - True if visible or if visibility check should be bypassed
 */
export function checkAuraVisibility(sourceToken, targetToken, fromPosition = null,
	toPosition = null) {
	const startPos = fromPosition || sourceToken.center;
	const endPos = toPosition || (targetToken.getCenterPoint
		? targetToken.getCenterPoint() : targetToken.center);

	// 1. Primary Foundry Visibility Check (V11/V12/V13)
	const visibilityApi = canvas.visibility || canvas.effects?.visibility;
	if (visibilityApi?.testVisibility) {
		const isVisible = visibilityApi.testVisibility(endPos, { object: sourceToken });
		if (isVisible) {
			return true;
		}
	}

	// 2. Wall collision fallback (Sight-blocking Ray Casting)
	// We check from center to center as primary
	let isBlocked = false;
	if (window.foundry?.canvas?.geometry?.Ray) {
		// V13 check
		if (CONFIG.Canvas?.polygonBackends?.sight?.testCollision) {
			isBlocked = CONFIG.Canvas.polygonBackends.sight.testCollision(startPos, endPos, { mode: "any", type: "sight" });
		}
		else if (canvas.edges?.testCollision) {
			isBlocked = canvas.edges.testCollision(startPos, endPos, { mode: "any", type: "sight" });
		}
	}
	else if (canvas.walls?.checkCollision) {
		// Fallback for V11/V12
		const RayClass = foundry.canvas?.geometry?.Ray || globalThis.Ray;
		const ray = new RayClass(startPos, endPos);
		isBlocked = canvas.walls.checkCollision(ray, { mode: "any", type: "sight" });
	}

	// If center is blocked, try a tiny offset to avoid snapping issues at wall edges
	if (isBlocked) {
		const offset = 2;
		const offsets = [
			{ x: offset, y: 0 }, { x: -offset, y: 0 }, { x: 0, y: offset }, { x: 0, y: -offset },
		];

		for (const off of offsets) {
			const testEnd = { x: endPos.x + off.x, y: endPos.y + off.y };
			let secondaryBlocked = true;
			if (CONFIG.Canvas?.polygonBackends?.sight?.testCollision) {
				secondaryBlocked = CONFIG.Canvas.polygonBackends.sight.testCollision(startPos, testEnd, { mode: "any", type: "sight" });
			}
			else if (canvas.edges?.testCollision) {
				secondaryBlocked = canvas.edges.testCollision(startPos, testEnd, { mode: "any", type: "sight" });
			}
			else if (canvas.walls?.checkCollision) {
				const RayClass = foundry.canvas?.geometry?.Ray || globalThis.Ray;
				secondaryBlocked = canvas.walls.checkCollision(new RayClass(startPos, testEnd), { mode: "any", type: "sight" });
			}

			if (!secondaryBlocked) {
				return true;
			}
		}
	}

	return !isBlocked;
}

/**
 * Check if token matches disposition filter
 */
export function checkDisposition(sourceToken, targetToken, disposition) {
	if (disposition === "all") return true;

	const sourceDisp = sourceToken.document.disposition;
	const targetDisp = targetToken.document.disposition;

	if (disposition === "ally") return sourceDisp === targetDisp;
	if (disposition === "enemy") return sourceDisp !== targetDisp;

	return true;
}

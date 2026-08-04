// Template geometry leaf — extracted from
// scripts/effects/TemplateEffectsSD.mjs (Phase 5.3 lane-C split).
// Region/template containment queries, level + shape helpers.
// Leaf: local MODULE_ID const; no sibling imports.

const MODULE_ID = "shadowdark-extras";

export function _isSameLevel(tokenLevelId, templateDoc) {
	try {
		// ── 1. Region.levels Set (v14, on RegionDocument) ────────────────────
		const rawLevels = templateDoc.levels;
		if (rawLevels != null) {
			const levelsArr = rawLevels instanceof Set ? [...rawLevels]
				: (Array.isArray(rawLevels) ? rawLevels : []);
			const specificIds = levelsArr.filter(id => id !== "defaultLevel0000");
			if (specificIds.length > 0) {
				if (!tokenLevelId) return false;
				return specificIds.includes(tokenLevelId);
			}
			// Only defaultLevel0000 or empty → fall through
		}

		// ── 2. casterLevelId in module flags (MeasuredTemplate, v14) ─────────
		// MeasuredTemplate documents have no .levels field, but they carry
		// flags[MODULE_ID].casterLevelId written into the creation data.
		const casterLevelId = templateDoc.flags?.[MODULE_ID]?.casterLevelId ?? null;
		if (casterLevelId) {
			if (!tokenLevelId) return false;
			return tokenLevelId === casterLevelId;
		}
	}
	catch(e) {
		console.warn("shadowdark-extras | _isSameLevel failed:", e);
	}
	return true; // no level info → no restriction
}

/**
 * v14 helper: force-compute a placeable template's .shape (lazy in v14).
 * Returns true if shape is ready after the call.
 */
export function ensureTemplateShape(template) {
	if (!template) return false;
	// Region placeables expose testPoint() but may not have .shape — accept them directly
	if (typeof template.testPoint === "function") return true;
	if (template.shape) return true;
	if (typeof template._refreshShape === "function") {
		try {
			template._refreshShape();
		}
		catch(e) {
			console.warn(`${MODULE_ID} | _refreshShape failed:`, e);
		}
	}
	return !!template.shape;
}

/**
 * Get all tokens currently inside a template
 * @param {MeasuredTemplateDocument} templateDoc - The template document
 * @returns {Token[]} Array of tokens inside the template
 */
export function getTokensInTemplate(templateDoc) {
	// In v14 a MeasuredTemplate auto-creates a Region with the EXACT SAME document ID.
	// The Region carries the levels field; use it for the level check when available.
	let levelDoc = templateDoc;
	if (!(templateDoc.levels instanceof Set) && templateDoc.parent) {
		const region = templateDoc.parent.regions?.get(templateDoc.id);
		if (region) levelDoc = region;
	}

	const template = templateDoc.object;
	if (!ensureTemplateShape(template)) return [];

	const tokens = [];
	const scene = templateDoc.parent;

	const useTestPoint = typeof template.testPoint === "function";
	const anchorX = templateDoc.x ?? template.x;
	const anchorY = templateDoc.y ?? template.y;

	for (const tokenDoc of scene.tokens) {
		const token = tokenDoc.object;
		if (!token) continue;

		// Skip tokens not on the same level as the template (use Region for level info)
		if (!_isSameLevel(tokenDoc.level ?? null, levelDoc)) continue;

		const inside = useTestPoint
			? template.testPoint(token.center)
			: template.shape.contains(token.center.x - anchorX, token.center.y - anchorY);

		if (inside) tokens.push(token);
	}

	return tokens;
}

/**
 * Get all templates that contain a specific token
 * @param {Token} token - The token to check
 * @returns {MeasuredTemplateDocument[]} Array of template documents
 */
export function getTemplatesContainingToken(token) {
	if (!token || !canvas.scene) return [];

	const tokenLevelId  = token.document?.level     ?? null;
	const tokenElevation = token.document?.elevation ?? 0;
	const templates = [];
	// v14: iterate Regions (carry levels + testPoint with elevation support)
	const collection = canvas.scene.regions
        ?? canvas.scene.templates;
	for (const templateDoc of collection) {
		if (!_isSameLevel(tokenLevelId, templateDoc)) continue;

		let inside = false;
		if (typeof templateDoc.testPoint === "function") {
			// v14: RegionDocument#testPoint({x, y, elevation})
			inside = templateDoc.testPoint({ x: token.center.x, y: token.center.y,
				elevation: tokenElevation });
		}
		else {
			// Pre-v14 fallback
			const template = templateDoc.object;
			if (!ensureTemplateShape(template)) continue;
			const anchorX = templateDoc.x ?? template.x;
			const anchorY = templateDoc.y ?? template.y;
			inside = typeof template.testPoint === "function"
				? template.testPoint(token.center)
				: template.shape.contains(token.center.x - anchorX, token.center.y - anchorY);
		}

		if (inside) templates.push(templateDoc);
	}

	return templates;
}

/**
 * Get templates containing a specific point
 * @param {number} x - X coordinate (center)
 * @param {number} y - Y coordinate (center)
 * @param {Scene} scene - The scene to check
 * @returns {MeasuredTemplateDocument[]} Array of template documents
 */
export function getTemplatesContainingPoint(x, y, scene, tokenLevelId = null, tokenElevation = 0) {
	if (!scene) return [];

	const templates = [];
	const collection = scene.regions
        ?? scene.templates;

	const regionCount = [...collection].length;
	console.log(`SDX | getTemplatesContainingPoint (${x.toFixed(0)},${y.toFixed(0)}) level=${tokenLevelId} elev=${tokenElevation} — checking ${regionCount} regions`);

	const pt = { x, y };
	for (const templateDoc of collection) {
		if (!_isSameLevel(tokenLevelId, templateDoc)) continue;

		let inside = false;
		if (typeof templateDoc.testPoint === "function") {
			// v14: RegionDocument#testPoint({x, y, elevation}) — correct API
			inside = templateDoc.testPoint({ x, y, elevation: tokenElevation });
		}
		else {
			// Pre-v14 fallback: MeasuredTemplate placeable shape check
			const obj = templateDoc.object;
			if (!ensureTemplateShape(obj)) continue;
			const anchorX = templateDoc.x ?? obj.x;
			const anchorY = templateDoc.y ?? obj.y;
			inside = typeof obj.testPoint === "function"
				? obj.testPoint(pt)
				: obj.shape.contains(x - anchorX, y - anchorY);
		}
		if (inside) templates.push(templateDoc);
	}

	return templates;
}

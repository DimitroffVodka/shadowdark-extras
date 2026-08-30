/**
 * Resolve canvas targets for an Animation FX preview. On-token effects honor
 * their configured anchor; projectile and cone previews always need a distinct
 * endpoint for stretch/angle geometry.
 */
export function resolveAnimationPreviewTargets(preset, source, controlled = [], userTarget = null) {
	if (!source) return [];
	if (preset?.type === "onToken" && preset?.target === "self") return [source];

	const secondControlled = controlled.find(token => (
		token && token !== source && token.id !== source.id
	));
	if (secondControlled) return [secondControlled];
	if (userTarget && userTarget !== source && userTarget.id !== source.id) return [userTarget];
	if (preset?.type === "onToken") return [source];

	return [{
		x: source.x + (source.w ?? 0) + 400,
		y: source.y,
		w: 1,
		h: source.h ?? 1,
		id: "_preview_offset",
	}];
}

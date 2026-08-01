// Scrolling combat text — extracted from combat/CombatSettingsSD.mjs (Phase 5.1 split).
// Shared by the combat socket handlers and CombatSettingsSD's own scrolling-text hook.

export function showScrollingText(token, amount, isHealing) {
	if (!token || !canvas.interface) return;

	// Get the text to display
	const displayAmount = Math.abs(amount);
	const text = isHealing ? `+${displayAmount}` : `-${displayAmount}`;

	// Configure the scrolling text style
	const style = {
		anchor: CONST.TEXT_ANCHOR_POINTS.TOP,
		direction: isHealing ? CONST.TEXT_ANCHOR_POINTS.TOP : CONST.TEXT_ANCHOR_POINTS.BOTTOM,
		fontSize: 48,
		fill: isHealing ? "#00ff00" : "#ff0000",
		stroke: "#000000",
		strokeThickness: 4,
		jitter: 0.25,
	};

	// Create the scrolling text
	canvas.interface.createScrollingText(token.center, text, style);
}

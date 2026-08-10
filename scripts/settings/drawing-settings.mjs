import { MODULE_ID } from "../shared/module-id.mjs";
import { FEATURE_IDS, isFeatureEnabled } from "./feature-gates.mjs";

/**
 * Register drawing-tool settings and its hold-to-draw keybinding.
 *
 * This seam keeps the drawing settings together without changing their
 * registration order within registerSettings().
 */
export function registerDrawingSettings() {
	if (!isFeatureEnabled(FEATURE_IDS.DRAWING_TOOLS)) return;

	// ═══════════════════════════════════════════════════════════════
	// 12. DRAWING TOOLS
	// ═══════════════════════════════════════════════════════════════

	game.settings.register(MODULE_ID, "drawing.enablePlayerDrawing", {
		name: "Allow Player Drawing",
		hint: "When enabled, players can use the drawing tools to mark up the map.",
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
	});

	game.settings.register(MODULE_ID, "drawing.timedEraseTimeout", {
		name: "Timed Erase Timeout (seconds)",
		hint: "How long drawings persist before fading when Timed Erase is enabled.",
		scope: "world",
		config: true,
		default: 30,
		type: Number,
		range: { min: 5, max: 120, step: 5 },
	});

	game.settings.register(MODULE_ID, "drawing.hotkeyEnabled", {
		name: "Enable Drawing Hotkey",
		hint: "Allow using a hotkey (hold) to quickly draw without opening the toolbar.",
		scope: "client",
		config: true,
		default: true,
		type: Boolean,
	});

	game.settings.register(MODULE_ID, "drawing.blockWhenTyping", {
		name: "Block Drawing While Typing",
		hint: "Prevent the drawing hotkey from activating while typing in text fields.",
		scope: "client",
		config: true,
		default: true,
		type: Boolean,
	});

	// Hidden toolbar state settings (persist between sessions)
	game.settings.register(MODULE_ID, "drawing.toolbar.drawingMode", { scope: "client", config: false, default: "sketch", type: String });
	game.settings.register(MODULE_ID, "drawing.toolbar.stampStyle", { scope: "client", config: false, default: "plus", type: String });
	game.settings.register(MODULE_ID, "drawing.toolbar.symbolSize", { scope: "client", config: false, default: "medium", type: String });
	game.settings.register(MODULE_ID, "drawing.toolbar.lineWidth", { scope: "client", config: false, default: 6, type: Number });
	game.settings.register(MODULE_ID, "drawing.toolbar.lineStyle", { scope: "client", config: false, default: "solid", type: String });
	game.settings.register(MODULE_ID, "drawing.toolbar.color", { scope: "client", config: false, default: "", type: String });
	game.settings.register(MODULE_ID, "drawing.toolbar.timedEraseEnabled", { scope: "client", config: false, default: false, type: Boolean });
	game.settings.register(MODULE_ID, "drawing.toolbar.opacity", { scope: "client", config: false, default: 1.0, type: Number });
	game.settings.register(MODULE_ID, "drawing.toolbar.position", { scope: "client", config: false, default: "", type: String });

	// Keybinding: Hold to draw
	game.keybindings.register(MODULE_ID, "drawHotkey", {
		name: "Drawing Tool Hotkey (Hold)",
		hint: "Hold this key to draw on the canvas. Release to finish the stroke.",
		editable: [{ key: "KeyL" }],
		onDown: () => {
			if (!game.settings.get(MODULE_ID, "drawing.hotkeyEnabled")) return false;
			if (game.settings.get(MODULE_ID, "drawing.blockWhenTyping")) {
				const active = document.activeElement;
				if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return false;
			}
			if (!canvas?.ready) return false;
			if (game.shadowdarkExtras?.drawingTool) {
				game.shadowdarkExtras.drawingTool.onHoldKeyDown();
				return true;
			}
			return false;
		},
		onUp: () => {
			if (game.shadowdarkExtras?.drawingTool) {
				game.shadowdarkExtras.drawingTool.onHoldKeyUp();
				return true;
			}
			return false;
		},
		restricted: false,
		precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
	});
}

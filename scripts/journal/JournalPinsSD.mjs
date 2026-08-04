/**
 * Journal Pins System for Shadowdark Extras
 * Allows placing journal/page pins on the canvas via Ctrl+drag
 */

// GSAP PixiPlugin registration. PixiPlugin.min.js auto-registers itself with
// gsap on load, but it needs `PixiPlugin.registerPIXI(PIXI)` to know which PIXI
// instance to operate on. Without that, tweens of the `pixi` property
// (brightness/hue filters) warn "Missing plugin? gsap.registerPlugin()" every
// frame. Defer to "init" so window.PIXI is guaranteed to be set up.
import { MODULE_ID, FLAG_KEY, LAYER_NAME, getPinStyle, DEFAULT_PIN_STYLE, normalizeImageTint } from "./pin-style.mjs";
function _registerGsapPixiPlugin() {
	if (!window.gsap || !window.PixiPlugin || !window.PIXI) return;
	try {
		window.gsap.registerPlugin(window.PixiPlugin);
		window.PixiPlugin.registerPIXI(window.PIXI);
	}
	catch(e) {
		console.warn("SDX Journal Pins | GSAP PixiPlugin registration failed:", e);
	}
}
// Try at module load (usually PIXI is already a global by then)…
_registerGsapPixiPlugin();
// …and again at init, in case PIXI wasn't ready yet.
Hooks.once("init", _registerGsapPixiPlugin);

// World-shared pin folders (P2). Definitions live here and appear on every
// scene; pins always remain per-scene, grouped under the shared folder.
Hooks.once("init", () => {
	game.settings.register(MODULE_ID, "pinFoldersWorld", {
		scope: "world",
		config: false,
		type: Array,
		default: [],
	});
});

// ================================================================
// PIN SCHEMA & DEFAULTS
// ================================================================


// ================================================================
// CUSTOM CANVAS LAYER
// ================================================================

class JournalPinsLayer extends foundry.canvas.layers.CanvasLayer {
	async _draw() {

		// Make layer interactive
		this.eventMode = "passive";
		this.interactiveChildren = true;

		JournalPinRenderer.initialize(this);
	}

	activate() {
		if (canvas?.scene && JournalPinRenderer.getContainer()) {
			const pins = JournalPinManager.list({ sceneId: canvas.scene.id });
			JournalPinRenderer.loadScenePins(canvas.scene.id, pins);
		}
	}

	deactivate() {
	}
}

// ================================================================
// LAYER REGISTRATION - Must be called during init hook
// ================================================================

const hookCanvas = () => {
	const origLayers = CONFIG.Canvas.layers;
	CONFIG.Canvas.layers = Object.keys(origLayers).reduce((layers, key) => {
		layers[key] = origLayers[key];

		// Inject after walls layer (like Blacksmith does)
		if (key === "walls") {
			layers[LAYER_NAME] = {
				layerClass: JournalPinsLayer,
				group: "interface",
			};
		}

		return layers;
	}, {});
};

// ================================================================
// PIN MANAGER - CRUD operations stored in scene flags
// ================================================================

function initJournalPins() {
	// Initialize drop handler
	JournalPinDropHandler.initialize();

	// Register Socket Listener for "Bring Players Here"
	Hooks.once("ready", () => {
		game.socket.on("module.shadowdark-extras", data => {
			if (data.type === "panToPin") {
				// Check scene match
				if (canvas.scene?.id !== data.sceneId) return;

				canvas.animatePan({ x: data.x, y: data.y });

				// Try to find the pin for custom animation
				let pin;
				if (data.pinId) {
					pin = JournalPinRenderer.getPin(data.pinId);
				}

				if (pin && pin.animatePing) {
					pin.animatePing("bring");
				}
				else if (canvas.ping) {
					canvas.ping({ x: data.x, y: data.y });
				}
			}
			else if (data.type === "pingPin") {
				if (canvas.scene?.id !== data.sceneId) return;

				let pin;
				if (data.pinId) {
					pin = JournalPinRenderer.getPin(data.pinId);
				}
				if (pin && pin.animatePing) {
					pin.animatePing();
				}
			}
		});
	});

	// Load pins when canvas is ready
	Hooks.on("canvasReady", () => {
		console.log("SDX Journal Pins | Canvas ready");

		// Always use canvas.interface for now (most reliable for interactivity)
		JournalPinRenderer.initializeOnInterface();

		if (canvas.scene) {
			const pins = JournalPinManager.list({ sceneId: canvas.scene.id });
			JournalPinRenderer.loadScenePins(canvas.scene.id, pins);
		}
	});

	// Cleanup on teardown
	Hooks.on("canvasTearDown", () => {
		JournalPinRenderer.cleanup();
	});

	// Reload on scene flag changes
	Hooks.on("updateScene", (scene, changes) => {
		if (scene.id === canvas?.scene?.id && changes.flags?.[MODULE_ID]?.[FLAG_KEY]) {
			const pins = JournalPinManager.list({ sceneId: scene.id });
			JournalPinRenderer.loadScenePins(scene.id, pins);
		}
	});

	// Refresh pins when tokens move (for vision-based visibility)
	Hooks.on("updateToken", (tokenDoc, changes) => {
		if (changes.x !== undefined || changes.y !== undefined) {
			// Token moved, only update visibility (add/remove), don't rebuild existing pins
			if (canvas?.scene) {
				const pins = JournalPinManager.list({ sceneId: canvas.scene.id });
				JournalPinRenderer.loadScenePins(canvas.scene.id, pins, { visibilityOnly: true });
			}
		}
	});

	// Refresh pins when sight/vision changes
	// Debounce to prevent flickering during animation
	Hooks.on("sightRefresh", foundry.utils.debounce(() => {
		if (canvas?.scene) {
			// Only update visibility (add/remove), don't rebuild existing pin graphics
			const pins = JournalPinManager.list({ sceneId: canvas.scene.id });
			JournalPinRenderer.loadScenePins(canvas.scene.id, pins, { visibilityOnly: true });
		}
	}, 100));

	// Ensure style is correct after all settings are loaded (Foundry refresh/init)
	Hooks.once("ready", () => {
		if (canvas.ready && canvas.scene) {
			console.log("SDX Journal Pins | Game ready, refreshing pin styles");
			// Ensure renderer is initialized if canvasReady fired too early or not at all
			if (!JournalPinRenderer.getContainer()) {
				JournalPinRenderer.initializeOnInterface();
			}
			const pins = JournalPinManager.list({ sceneId: canvas.scene.id });
			JournalPinRenderer.loadScenePins(canvas.scene.id, pins);
		}
	});

	// Patch TokenMagic if active
	Hooks.once("ready", () => {
		if (game.modules.get("tokenmagic")?.active && window.TokenMagic && !window.TokenMagic._sdxPatched) {
			// Patch getPlaceableById on window.TokenMagic for general use
			const originalGetPlaceableById = window.TokenMagic.getPlaceableById;
			window.TokenMagic.getPlaceableById = (id, type) => {
				if (type === "JournalPin") {
					return JournalPinRenderer.getPin(id);
				}
				return originalGetPlaceableById(id, type);
			};

			// Patch PIXI.Filter.prototype.getPlaceable because the internal logic
			// of filters uses an imported version of getPlaceableById which we can't easily patch
			if (PIXI.Filter.prototype.getPlaceable) {
				const originalGetPlaceable = PIXI.Filter.prototype.getPlaceable;
				PIXI.Filter.prototype.getPlaceable = function() {
					// this.placeableType is set by TokenMagic when assigning the filter
					if (this.placeableType === "JournalPin") {
						return JournalPinRenderer.getPin(this.placeableId);
					}
					return originalGetPlaceable.call(this);
				};
			}

			// Patch calculatePadding to fail gracefully if the placeable image is missing
			// This prevents crashes during scene transitions or world load race conditions
			if (PIXI.Filter.prototype.calculatePadding) {
				const originalCalculatePadding = PIXI.Filter.prototype.calculatePadding;
				PIXI.Filter.prototype.calculatePadding = function() {
					if (!this.placeableImg && this.placeableType === "JournalPin") return;
					try {
						return originalCalculatePadding.call(this);
					}
					catch(err) {
						// Ignore rotation errors for pins that are being destroyed/removed
						if (this.placeableType === "JournalPin") return;
						throw err;
					}
				};
			}

			window.TokenMagic._sdxPatched = true;
			console.log("SDX Journal Pins | Patched TokenMagic for JournalPin support");

			// Re-apply filters for all pins on the current scene to ensure they show up
			// This fixes the 'persistence' issue where filters are in flags but not rendering
			if (canvas.ready) {
				const pins = JournalPinManager.list({ sceneId: canvas.scene.id });
				for (const pinData of pins) {
					const graphics = JournalPinRenderer.getPin(pinData.id);
					if (graphics) {
						const filters = graphics.getFlag("tokenmagic", "filters");
						if (filters) {
							window.TokenMagic._clearImgFiltersByPlaceable(graphics);
							window.TokenMagic._assignFilters(graphics, filters);
							// Force a build refresh to ensure textures and filters sync up
							graphics.update(graphics.pinData);
						}
					}
				}
			}
		}
	});

	// Expose globally for settings onChange handlers
	window.JournalPinManager = JournalPinManager;
	window.JournalPinRenderer = JournalPinRenderer;

	console.log("SDX Journal Pins | initJournalPins called");
}

// Names moved to the split modules (Phase 5.1) — imported for initJournalPins
// and re-exported to preserve the original JournalPinsSD surface.
import { JournalPinManager, JournalPinDropHandler, PinPlacer } from "./pin-manager.mjs";
import { JournalPinRenderer, JournalPinTooltip } from "./pin-rendering.mjs";
export { JournalPinTooltip, JournalPinManager, JournalPinRenderer, PinPlacer, normalizeImageTint, DEFAULT_PIN_STYLE, getPinStyle, initJournalPins };

// ================================================================
// INITIALIZATION
// ================================================================

// Register layer IMMEDIATELY at module load time
// Check if CONFIG.Canvas.layers exists (it should during init phase)
if (typeof CONFIG !== "undefined" && CONFIG.Canvas?.layers) {
	hookCanvas();
	console.log("SDX Journal Pins | hookCanvas called at module load");
}
else {
	// Fallback: try during init hook
	Hooks.once("init", () => {
		hookCanvas();
		console.log("SDX Journal Pins | hookCanvas called during init hook");
	});
	console.log("SDX Journal Pins | hookCanvas scheduled for init hook");
}

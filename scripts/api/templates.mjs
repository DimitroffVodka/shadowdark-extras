import { MODULE_ID } from "../shared/module-id.mjs";

/**
 * `SDX.templates` — the developer-facing template placement and targeting API.
 *
 * Phase 3 step 13: extracted verbatim from the composition root, joining
 * `template-target-sync.mjs`, which was parked here waiting for it. The two are
 * two ends of one call — a player places a template and targets locally, then
 * asks the GM to mirror those targets — but they run on different clients, so
 * they stay in separate files.
 *
 * CONSUMERS REACH THIS THROUGH THE GLOBAL, NOT THROUGH AN IMPORT.
 * `CombatSettingsSD` calls `SDX.templates.placeAndTarget` at six sites behind a
 * `typeof SDX !== 'undefined'` guard, and world macros use it the same way. So
 * the export below is the REGISTRATION, not the API: nothing imports
 * `SDX_TEMPLATES` by name, and renaming it changes nothing a caller can see.
 * Renaming a method on it is a public API break.
 *
 * WHY THE ASSIGNMENT IS DEFERRED TO A REGISTER CALL. `globalThis.SDX` is
 * created here, and the composition root's DEV HELPERS block assigns `SDX.dev`
 * to it further down the same file. Import-time evaluation would move this
 * namespace creation ahead of everything in the root's body — safe today, but
 * a reordering no gate can see. Calling `registerTemplatesApi()` from the
 * position the section occupied keeps the original evaluation order exactly.
 */

/**
 * Fix for square template rotation
 * Override MeasuredTemplate.getRectShape to properly handle rotation
 * Based on df-templates by flamewave000
 */
function installSquareTemplateRotationFix() {
	const _originalGetRectShape = foundry.canvas.placeables.MeasuredTemplate.getRectShape;
	foundry.canvas.placeables.MeasuredTemplate.getRectShape = function(distance, direction, adjustForRoundingError = false) {
		// Generate a rotation matrix to apply the rect against. The base rotation must be rotated
		// CCW by 45° before applying the real direction rotation.
		const matrix = PIXI.Matrix.IDENTITY.rotate(Math.toRadians(-45 + direction));
		// If the shape will be used for collision, shrink the rectangle by a fixed EPSILON amount to account for rounding errors
		const EPSILON = adjustForRoundingError ? 0.0001 : 0;
		// Use simple Pythagoras to calculate the square's size from the diagonal "distance".
		const size = (Math.sqrt((distance * distance) / 2) * canvas.dimensions.distancePixels) - EPSILON;
		// Create the square's 4 corners with origin being the Top-Left corner and apply the
		// rotation matrix against each.
		const topLeft = matrix.apply(new PIXI.Point(EPSILON, EPSILON));
		const topRight = matrix.apply(new PIXI.Point(size, EPSILON));
		const botLeft = matrix.apply(new PIXI.Point(EPSILON, size));
		const botRight = matrix.apply(new PIXI.Point(size, size));
		// Inject the vector data into a Polygon object to create a closed shape.
		const shape = new PIXI.Polygon([topLeft.x, topLeft.y, topRight.x, topRight.y, botRight.x, botRight.y, botLeft.x, botLeft.y, topLeft.x, topLeft.y]);
		// Add these fields so that the Sequencer mod doesn't have a stroke
		shape.x = topLeft.x;
		shape.y = topLeft.y;
		shape.width = size;
		shape.height = size;
		return shape;
	};
	//console.log(`${MODULE_ID} | Square template rotation fix applied`);
}

/**
 * Return the scene Level ID that contains the given absolute elevation.
 * Prefers named levels with finite bounds over the defaultLevel0000 catch-all.
 */
function _sdxLevelIdForElevation(elevation) {
	const sceneLevels = canvas.scene?.levels;
	if (!sceneLevels?.size) return null;
	let catchAll = null;
	for (const level of sceneLevels) {
		const bottom = level.elevation?.bottom ?? -Infinity;
		const top    = level.elevation?.top   ??  Infinity;
		if (elevation < bottom || elevation > top) continue;
		// Never return defaultLevel0000 as a specific match — treat it as catch-all
		// regardless of whatever elevation values Foundry gives it.
		if (level.id === "defaultLevel0000") { catchAll = level.id; continue; }
		if (isFinite(bottom) || isFinite(top)) return level.id;
		catchAll = level.id;
	}
	return catchAll;
}

/**
 * Returns true when the token is on the same scene level as a template whose
 * elevation is `templateElevation`.  Falls back to exact numeric elevation
 * comparison on scenes without named levels.
 */
function _sdxTokenMatchesTemplateLevel(token, templateElevation) {
	const sceneLevels = canvas.scene?.levels;
	if (sceneLevels?.size > 1) {
		const tokenLevelId    = token.document?.level ?? null;
		const templateLevelId = _sdxLevelIdForElevation(templateElevation);
		if (tokenLevelId && templateLevelId) {
			return tokenLevelId === templateLevelId;
		}
	}
	// Fallback: exact elevation match (flat scenes or no level data)
	return (token.document?.elevation ?? 0) === templateElevation;
}

/**
 * SDX.templates - Template placement and targeting API
 *
 * Usage:
 *   const template = await SDX.templates.place({ type: "rect", size: 30 });
 *   const tokens = SDX.templates.getTokensInTemplate(template);
 *   const { template, tokens } = await SDX.templates.placeAndTarget({ type: "rect", size: 30, autoDelete: 3000 });
 */
const SDX_TEMPLATES = {
	/**
	 * Get the auto-generated Region companion for a MeasuredTemplate.
	 * In Foundry v14, the auto-created Region shares the exact same document ID.
	 * @param {MeasuredTemplateDocument} templateDoc
	 * @returns {RegionDocument|null}
	 */
	getPairedRegion(templateDoc) {
		if (!templateDoc?.parent) return null;
		return templateDoc.parent.regions.get(templateDoc.id) || null;
	},

	/**
	 * Interactive template placement
	 * @param {Object} options - Template options
	 * @param {string} options.type - Template type: "rect", "circle", "cone", "ray"
	 * @param {number} options.size - Size in feet
	 * @param {number} [options.width] - Width for cones/rays (defaults to size)
	 * @param {number} [options.angle] - Angle for cones (defaults to 53.13)
	 * @param {string} [options.fillColor] - Fill color (defaults to "#4e9a06")
	 * @param {string} [options.borderColor] - Border color (defaults to "#000000")
	 * @param {number} [options.autoDelete] - Auto-delete template after X milliseconds (e.g., 3000 for 3 seconds)
	 * @param {Object} [options.originFromCaster] - Lock origin to caster position (for cones/rays)
	 * @param {number} options.originFromCaster.x - X coordinate of caster
	 * @param {number} options.originFromCaster.y - Y coordinate of caster
	 * @returns {Promise<MeasuredTemplateDocument|null>} - The placed template or null if cancelled
	 */
	async place(options = {}) {
		const {
			type = "rect",
			size = 30,
			width = null,
			angle = 53.13,
			fillColor = "#4e9a06",
			borderColor = "#000000",
			autoDelete = null,
			originFromCaster = null,
			elevation = null,  // Initial elevation; defaults to caster elevation when provided
			texture = null,
			textureOpacity = 0.5,
			tmfxPreset = null,
			tmfxTint = null,
			excludeCasterTokenId = null,  // Token ID to exclude from highlighting
			templateFlags = null,  // v14: module flags written at create-time only (post-create setFlag silently drops)
			levels = null,  // v14: Region.levels array of Level IDs — must be in creation data
		} = options;

		// Build template data based on type
		let templateData = {
			t: type,
			user: game.user.id,
			fillColor,
			borderColor,
			angle: 0,
			direction: 0,
			flags: templateFlags ? foundry.utils.deepClone(templateFlags) : {},
		};

		// Add texture if provided
		if (texture) {
			templateData.texture = texture;
		}

		// Add TokenMagic flags for effects (uses their template auto-apply system)
		// See: https://github.com/Feu-Secret/Tokenmagic
		if (texture || tmfxPreset) {
			templateData.flags = templateData.flags || {};
			templateData.flags.tokenmagic = templateData.flags.tokenmagic || {};
			templateData.flags.tokenmagic.options = {
				tmfxTextureAlpha: textureOpacity,
			};

			// Add preset if specified
			if (tmfxPreset && tmfxPreset !== "NOFX") {
				templateData.flags.tokenmagic.options.tmfxPreset = tmfxPreset;

				// Add tint if specified (must be a number, not hex string)
				if (tmfxTint) {
					const tintNum = typeof tmfxTint === "string"
						? parseInt(tmfxTint.replace("#", ""), 16)
						: tmfxTint;
					templateData.flags.tokenmagic.options.tmfxTint = tintNum;
				}
			}
		}

		// Track current direction for rotation
		let currentDirection = 0;

		// Configure based on template type
		switch (type) {
			case "rect":
				// For axis-aligned squares, use diagonal distance at 45 degrees
				templateData.distance = size * Math.SQRT2;
				templateData.direction = 45;
				currentDirection = 45;
				templateData.width = 0;
				break;
			case "circle":
				templateData.distance = size;
				templateData.direction = 0;
				break;
			case "cone":
				templateData.distance = size;
				templateData.direction = 0;
				templateData.angle = angle;
				break;
			case "ray":
				templateData.distance = size;
				templateData.direction = 0;
				templateData.width = width || 5;
				break;
			default:
				templateData.distance = size;
				templateData.direction = 0;
		}

		return new Promise((resolve) => {
			let resolved = false;
			let highlightedTokens = new Set(); // Track highlighted tokens
			let currentElevation = elevation ?? originFromCaster?.elevation ?? 0; // Track template elevation

			// Clear all existing targets before starting template preview
			// This prevents previously targeted tokens from interfering with template targeting
			// Helper to force clear targets (bypassing system hook crash)
			const forceClearTargets = () => {
				const targets = [...game.user.targets];

				// 1. Try standard detargeting. Foundry v13/v14 Token#setTarget is
				// synchronous and returns void — calling .catch() on it threw
				// "Cannot read properties of undefined (reading 'catch')", which
				// aborted template placement whenever a token was targeted
				// (healing/template items then did nothing). Wrap instead.
				game.user.targets.forEach(t => {
					try { t.setTarget(false, { user: game.user, releaseOthers: false }); } catch (e) { /* ignore */ }
				});

				// 2. Force local cleanup (bypass hooks) to ensure state is clear
				game.user.targets.clear();
				for (const t of targets) {
					if (t.targeted.has(game.user)) {
						t.targeted.delete(game.user);
						t.renderFlags.set({ refreshTarget: true });
					}
				}
			};

			// Clear all existing targets before starting template preview
			// This prevents previously targeted tokens from interfering with template targeting
			forceClearTargets();

			// Initial position - use caster position if originFromCaster, otherwise mouse position.
			// v14: must be on templateData BEFORE constructing the doc so the shape computes during draw().
			let initialPos;
			if (originFromCaster) {
				initialPos = { x: originFromCaster.x, y: originFromCaster.y };
			} else {
				try {
					initialPos = canvas.app.renderer.events.pointer.getLocalPosition(canvas.stage);
				} catch {
					initialPos = { x: 0, y: 0 };
				}
			}
			templateData.x = initialPos.x;
			templateData.y = initialPos.y;

			// Create the template document (v14 namespace with v13 fallback)
			const MTDocClass = foundry.documents?.MeasuredTemplateDocument || MeasuredTemplateDocument;
			const doc = new MTDocClass(templateData, { parent: canvas.scene });

			// Create the template object for preview
			const template = new CONFIG.MeasuredTemplate.objectClass(doc);

			// Add to preview layer, then await draw before activating layer / refreshing
			// (v14: template.draw() is async; not awaiting leaves shape=null and the preview invisible)
			canvas.templates.preview.addChild(template);
			template.draw().then(() => {
				if (resolved) return;
				if (canvas.activeLayer !== canvas.templates) canvas.templates.activate();
				template.renderFlags.set({ refresh: true });
				updateTokenHighlighting();
			}).catch(err => console.error(`${MODULE_ID} | template.draw() failed:`, err));
			// Throttle token highlighting to 15fps for performance
			let lastHighlightTime = 0;
			const HIGHLIGHT_THROTTLE = 1000 / 15; // 15fps

			// Function to add visual-only highlight effect to a token (does NOT add to game.user.targets)
			const addPreviewHighlight = (token) => {
				if (!token || token._sdxPreviewHighlight) return;

				// Create a graphics object for the highlight border
				const highlight = new PIXI.Graphics();
				const bounds = token.bounds;
				const padding = 4;

				// Draw a pulsing orange border around the token
				highlight.lineStyle(3, 0xff6600, 0.9);
				highlight.drawRoundedRect(
					-token.document.width * canvas.grid.size / 2 - padding,
					-token.document.height * canvas.grid.size / 2 - padding,
					token.document.width * canvas.grid.size + padding * 2,
					token.document.height * canvas.grid.size + padding * 2,
					8
				);

				// Position at token center
				highlight.position.set(token.document.width * canvas.grid.size / 2, token.document.height * canvas.grid.size / 2);

				// Add to token and track
				token.addChild(highlight);
				token._sdxPreviewHighlight = highlight;
			};

			// Function to remove visual highlight effect from a token
			const removePreviewHighlight = (token) => {
				if (!token || !token._sdxPreviewHighlight) return;

				token.removeChild(token._sdxPreviewHighlight);
				token._sdxPreviewHighlight.destroy();
				token._sdxPreviewHighlight = null;
			};

			// Function to highlight tokens inside the template preview
			// Uses visual-only highlighting that does NOT affect game.user.targets
			const updateTokenHighlighting = () => {
				// v14: preview placeable's .shape is lazy — refresh if missing
				if (!template.shape && typeof template._refreshShape === "function") {
					try { template._refreshShape(); } catch {}
				}
				if (!template.shape) return;

				const tokensInTemplate = new Set();

				// Find all tokens inside the template
				for (const token of canvas.tokens.placeables) {
					// Skip caster token if excludeCasterTokenId is set
					if (excludeCasterTokenId && token.id === excludeCasterTokenId) continue;

					// Level filter: levels[0] is the caster's Level ID set at cast time
					const casterLevelId = levels?.[0] ?? null;
					if (casterLevelId) {
						if ((token.document?.level ?? null) !== casterLevelId) continue;
					} else {
						// No level system — fall back to exact elevation match
						if ((token.document?.elevation ?? 0) !== currentElevation) continue;
					}

					// Test if token center is inside the template shape
					const localX = token.center.x - template.document.x;
					const localY = token.center.y - template.document.y;

					if (template.shape.contains(localX, localY)) {
						tokensInTemplate.add(token.id);

						// Add visual highlight if not already highlighted
						if (!highlightedTokens.has(token.id)) {
							addPreviewHighlight(token);
							highlightedTokens.add(token.id);
						}
					}
				}

				// Remove highlighting from tokens no longer in template
				for (const tokenId of highlightedTokens) {
					if (!tokensInTemplate.has(tokenId)) {
						const token = canvas.tokens.get(tokenId);
						if (token) {
							removePreviewHighlight(token);
						}
						highlightedTokens.delete(tokenId);
					}
				}
			};

			// Clear all token highlighting (visual only)
			const clearTokenHighlighting = () => {
				for (const tokenId of highlightedTokens) {
					const token = canvas.tokens.get(tokenId);
					if (token) {
						removePreviewHighlight(token);
					}
				}
				highlightedTokens.clear();
			};

			// Create elevation indicator text (add to stage, not template)
			const elevationText = new PIXI.Text(`Elevation: ${currentElevation}`, {
				fontFamily: "Modesto Condensed, Old Newspaper, serif",
				fontSize: 36,
				fontWeight: "bold",
				fill: 0x000000, // Black text
				stroke: 0xFFFFFF, // White outline
				strokeThickness: 6,
				align: "center",
				dropShadow: true,
				dropShadowColor: 0x000000,
				dropShadowBlur: 4,
				dropShadowDistance: 2,
			});
			elevationText.anchor.set(0.5, 1); // Anchor at bottom center
			elevationText.zIndex = 10000; // Very high z-index to be on top
			canvas.stage.addChild(elevationText);

			// Function to update elevation text position
			const updateElevationTextPosition = () => {
				elevationText.position.set(
					template.document.x,
					template.document.y - 80
				);
			};
			updateElevationTextPosition();

			// Cleanup function
			const cleanup = () => {
				if (resolved) return;
				resolved = true;
				canvas.stage.off("pointermove", onMouseMove);
				canvas.stage.off("pointerdown", onLeftClick);
				canvas.stage.off("rightdown", onRightClick);
				canvas.app.view.removeEventListener("wheel", onWheel);
				document.removeEventListener("keydown", onKeyDown);

				// Remove and destroy elevation text
				if (elevationText && elevationText.parent) {
					canvas.stage.removeChild(elevationText);
					elevationText.destroy({ children: true, texture: true, baseTexture: true });
				}

				if (template.parent) {
					canvas.templates.preview.removeChild(template);
				}
				template.destroy({ children: true });
			};

			// Mouse move handler - update template position (or direction if originFromCaster)
			const onMouseMove = (event) => {
				if (resolved) return;
				const pos = event.getLocalPosition(canvas.stage);

				if (originFromCaster) {
					// Origin is locked - calculate direction from origin to mouse
					const dx = pos.x - originFromCaster.x;
					const dy = pos.y - originFromCaster.y;
					const angle = Math.atan2(dy, dx);
					const degrees = Math.toDegrees(angle);
					currentDirection = degrees;
					template.document.updateSource({ direction: currentDirection });
				} else {
					// Normal mode - follow mouse
					const snapped = canvas.templates.getSnappedPoint(pos);
					template.document.updateSource({ x: snapped.x, y: snapped.y });
				}
				template.renderFlags.set({ refresh: true });

				// Update elevation text position to follow template
				updateElevationTextPosition();

				// Throttled token highlighting
				const now = Date.now();
				if (now - lastHighlightTime >= HIGHLIGHT_THROTTLE) {
					lastHighlightTime = now;
					updateTokenHighlighting();
				}
			};

			// Mouse wheel handler - rotate template when holding Shift, elevation when holding Alt
			// Ctrl = angle snap to 45° increments
			const onWheel = (event) => {
				if (resolved) return;

				// Alt key = elevation control
				if (event.altKey && !event.shiftKey) {
					event.preventDefault();
					event.stopPropagation();

					const sign = Math.sign(event.deltaY);
					currentElevation = Math.max(0, currentElevation - sign); // Invert scroll direction for intuitive up/down

					// Update elevation indicator
					elevationText.text = `Elevation: ${currentElevation}`;

					// Update token highlighting after elevation change
					updateTokenHighlighting();
					return;
				}

				// Shift key = rotation
				if (!event.shiftKey) return;

				event.preventDefault();
				event.stopPropagation();

				// Angle snap mode (Ctrl held) - snap to 45° increments
				// Normal mode - rotate by 5° (or 15° with both Shift+Ctrl)
				let snap;
				if (event.ctrlKey) {
					// Snap to 45° increments (8 positions around the circle)
					snap = 45;
				} else {
					// Fine rotation: 5° per tick
					snap = 5;
				}

				const sign = Math.sign(event.deltaY);

				if (event.ctrlKey) {
					// Angle snap mode - snap to nearest increment
					let direction = currentDirection;
					if (direction < 0) direction += 360;
					direction = direction - (direction % snap);
					if (currentDirection % snap !== 0 && sign < 0)
						direction += snap;
					currentDirection = (direction + (snap * sign)) % 360;
				} else {
					// Normal fine rotation
					currentDirection = (currentDirection + (snap * sign)) % 360;
				}

				if (currentDirection < 0) currentDirection += 360;

				template.document.updateSource({ direction: currentDirection });
				template.renderFlags.set({ refresh: true });

				// Update token highlighting after rotation
				updateTokenHighlighting();
			};

			// Left click handler - place the template
			const onLeftClick = async (event) => {
				if (resolved) return;

				// Only respond to left mouse button (button 0)
				if (event.button !== 0) return;

				// Get final position - use originFromCaster if set, otherwise click position
				let finalX; let finalY;
				if (originFromCaster) {
					finalX = originFromCaster.x;
					finalY = originFromCaster.y;
				} else {
					const pos = event.getLocalPosition(canvas.stage);
					const snapped = canvas.templates.getSnappedPoint(pos);
					finalX = snapped.x;
					finalY = snapped.y;
				}

				// Get current direction from the preview template
				const finalDirection = template.document.direction;

				clearTokenHighlighting(); // Clear visual highlights on placement
				cleanup();

				// Create the actual template document in the scene
				const creationData = {
					...templateData,
					x: finalX,
					y: finalY,
					direction: finalDirection,
					elevation: currentElevation,
				};
				const created = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [creationData]);

				const placedTemplate = created[0];

				// v14: The MeasuredTemplate creation auto-produces a RegionDocument
				// with the EXACT SAME ID. Find that Region and set levels on it.
				if (levels?.length) {
					try {
						// Wait for the region to exist (auto-creation can take a few ms)
						let attempts = 0;
						let newRegion = canvas.scene.regions?.get(placedTemplate.id);
						while (!newRegion && attempts < 10) {
							await new Promise(r => setTimeout(r, 50));
							newRegion = canvas.scene.regions?.get(placedTemplate.id);
							attempts++;
						}

						if (newRegion) {
							await newRegion.update({ levels });
							console.log(`shadowdark-extras | Set region.levels=${JSON.stringify(levels)} on ${newRegion.id}`);
						} else {
							console.warn(`shadowdark-extras | Could not find auto-created Region with ID ${placedTemplate.id} to set levels`);
						}
					} catch (e) {
						console.warn("shadowdark-extras | Failed to set region.levels:", e);
					}
				}

				// Auto-delete if specified
				if (autoDelete && autoDelete > 0) {
					setTimeout(async () => {
						try {
							if (placedTemplate && canvas.scene.templates.get(placedTemplate.id)) {
								await placedTemplate.delete();
							}
						} catch (e) {
							console.warn(`${MODULE_ID} | Failed to auto-delete template:`, e);
						}
					}, autoDelete);
				}

				resolve(placedTemplate);
			};

			// Right click handler - cancel placement
			const onRightClick = (event) => {
				if (resolved) return;
				event.preventDefault();
				event.stopPropagation();
				clearTokenHighlighting(); // Clear targeting when cancelled
				cleanup();
				ui.notifications.info("Template placement cancelled.");
				resolve(null);
			};

			// Escape key handler - cancel placement
			const onKeyDown = (event) => {
				if (resolved) return;

				if (event.key === "Escape") {
					clearTokenHighlighting(); // Clear targeting when cancelled
					cleanup();
					ui.notifications.info("Template placement cancelled.");
					resolve(null);
				}
			};

			// Key up handler - no longer needed
			const onKeyUp = (event) => {
				// Removed - Alt key is checked directly in wheel handler
			};

			// Attach event listeners
			canvas.stage.on("pointermove", onMouseMove);
			canvas.stage.on("pointerdown", onLeftClick);
			canvas.stage.on("rightdown", onRightClick);
			canvas.app.view.addEventListener("wheel", onWheel, { passive: false });
			document.addEventListener("keydown", onKeyDown);

			ui.notifications.info("Left-click to place | Right-click/Esc to cancel | Shift+Wheel to rotate | Alt+Wheel for elevation");
		});
	},

	/**
	 * Get all tokens inside a template
	 * @param {MeasuredTemplateDocument} templateDoc - The template document
	 * @returns {Token[]} - Array of Token objects inside the template
	 */
	getTokensInTemplate(templateDoc, overrideLevelId = null) {
		if (!templateDoc?.object) {
			console.warn(`${MODULE_ID} | getTokensInTemplate: Template object not found`);
			return [];
		}

		const templateObject = templateDoc.object;
		const templateElevation = templateDoc.elevation || 0;

		// v14: placeable doesn't auto-compute .shape on doc creation; force it before testPoint
		if (!templateObject.shape && typeof templateObject._refreshShape === "function") {
			try { templateObject._refreshShape(); } catch (e) { console.warn(`${MODULE_ID} | _refreshShape failed:`, e); }
		}
		if (!templateObject.shape) {
			console.warn(`${MODULE_ID} | getTokensInTemplate: shape still null after refresh; returning []`);
			return [];
		}

		// Level ID priority: caller-supplied → template flags → elevation fallback
		const casterLevelId = overrideLevelId
			?? templateDoc.flags?.["shadowdark-extras"]?.casterLevelId
			?? null;

		return canvas.tokens.placeables.filter(t => {
			// Level filter
			if (casterLevelId) {
				if ((t.document?.level ?? null) !== casterLevelId) return false;
			} else if (!_sdxTokenMatchesTemplateLevel(t, templateElevation)) {
				return false;
			}

			// Shape containment
			return templateObject.testPoint(t.center);
		});
	},

	/**
	 * Place a template and return both the template and tokens inside it
	 * Also targets the tokens automatically
	 * @param {Object} options - Same options as place(), plus:
	 * @param {number} [options.autoDelete] - Auto-delete template after X ms (e.g., 3000)
	 * @param {string} [options.excludeCasterTokenId] - Token ID to exclude from targeting
	 * @returns {Promise<{template: MeasuredTemplateDocument|null, tokens: Token[]}>}
	 */
	async placeAndTarget(options = {}) {
		const { excludeCasterTokenId } = options;
		const template = await this.place(options);

		if (!template) {
			return { template: null, tokens: [] };
		}

		// Wait one tick for the placeable to be attached, then force-compute its shape.
		// (v14: placeable.shape is lazy and not auto-computed; getTokensInTemplate will _refreshShape internally)
		await new Promise(r => setTimeout(r, 50));
		// Pass the caster's level ID directly so level filtering doesn't depend on flag lookup
		const casterLevelId = options.levels?.[0] ?? null;
		let tokens = this.getTokensInTemplate(template, casterLevelId);

		// Filter out caster if excludeCasterTokenId is set
		if (excludeCasterTokenId) {
			tokens = tokens.filter(t => t.id !== excludeCasterTokenId);
		}

		// Target the tokens (safely)
		// We wrap this in try/catch because the shadowdark system targeting hook
		// has a bug that can crash (TypeError: game.user.updateTokenTargets is not a function)
		// We must ensure this function returns the tokens even if targeting fails.
		// Target the tokens (safely)
		// We wrap EACH call in try/catch to ensure we attempt all tokens
		console.log(`${MODULE_ID} | placeAndTarget found ${tokens.length} tokens. Targeting...`);

		// Enable multi-target bypass for players during template targeting
		if (game.shadowdarkExtras) game.shadowdarkExtras.allowMultiTarget = true;
		try {
			for (const token of tokens) {
				try {
					await token.setTarget(true, { user: game.user, releaseOthers: false });
				} catch (e) {
					console.warn(`${MODULE_ID} | Safe targeting failed for token ${token.id} (system bug ignored):`, e);
				}
			}
		} finally {
			// Always reset the bypass flag
			if (game.shadowdarkExtras) game.shadowdarkExtras.allowMultiTarget = false;
		}

		// Sync targets to GM via socket (so GM can interact with the damage card)
		if (!game.user.isGM && tokens.length > 0) {
			const module = game.modules.get(MODULE_ID);
			if (module?.socket) {
				const tokenIds = tokens.map(t => t.id);
				console.log(`${MODULE_ID} | Syncing targets to GM:`, tokenIds);
				module.socket.executeAsGM("syncTargetsToGM", tokenIds);
			}
		}

		// Clear targets after 8 seconds to clean up targeting state
		setTimeout(() => {
			canvas.tokens.setTargets([])
		}, 8000);

		return { template, tokens };
	},
};

//console.log(`${MODULE_ID} | SDX.templates API loaded`);

/**
 * Install the square-template rotation fix and publish `SDX.templates`.
 *
 * Call position is load-bearing — see the module docblock.
 */
export function registerTemplatesApi() {
	installSquareTemplateRotationFix();
	globalThis.SDX = globalThis.SDX || {};
	// Through `globalThis` rather than the bare global the root used. Same
	// binding, but the binding gate reads a bare `SDX` as an unbound
	// identifier, and baselining a name that is genuinely resolvable is worse
	// than writing where it comes from.
	globalThis.SDX.templates = SDX_TEMPLATES;
}

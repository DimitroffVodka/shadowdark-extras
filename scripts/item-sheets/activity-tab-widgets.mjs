import { MODULE_ID } from "../shared/module-id.mjs";
import AnimationFxSD from "../animation/AnimationFxSD.mjs";
import { FEATURE_IDS, isFeatureEnabled } from "../settings/feature-gates.mjs";

/**
 * Activity-tab widget wiring, shared by every item-type sheet enhancer.
 *
 * Extracted from the composition root in Phase 3, verbatim. These three are one
 * unit because they are the Activity tab: the Spell, Potion, Scroll and Wand
 * enhancers each call the same handlers against their own rendered sheet, and
 * none of them owns the behaviour.
 *
 *   - `activateTemplateTokenMagicStackHandlers` — template / Token Magic FX
 *     filter stack (all four enhancers)
 *   - `setupActivityRadioToggles` — makes the activity toggles mutually
 *     exclusive (all four enhancers)
 *   - `activateAnimationFxListeners` — per-item Animation FX override, persisted
 *     to `flags.<MODULE_ID>.animationFx` (Spell, Scroll and Wand)
 *
 * Every handler here binds DIRECTLY to its input rather than delegating from an
 * ancestor. That is load-bearing: the Activity tab installs a blanket per-input
 * `change` handler that calls `stopPropagation()` to block Foundry's form
 * auto-submit, so a delegated handler on any ancestor never fires.
 */

/**
 * Wire the template / Token Magic FX filter-stack controls on the Activity tab.
 * @param {jQuery} html - The HTML element
 * @param {Item} item - The item being edited
 */
export function activateTemplateTokenMagicStackHandlers(html, item) {
	if (!isFeatureEnabled(FEATURE_IDS.TMFX_EDITOR)) return;
	if (!html?.on || !item) return;

	const getFilters = () => {
		const filters = item.getFlag(MODULE_ID, "targeting")?.template?.tokenMagic?.filters;
		return Array.isArray(filters) ? foundry.utils.deepClone(filters) : [];
	};

	const saveFilters = async filters => {
		const clonedFilters = Array.isArray(filters) ? foundry.utils.deepClone(filters) : [];
		await item.update({
			[`flags.${MODULE_ID}.targeting.template.tokenMagic.filters`]: clonedFilters,
		}, { render: false });
		item.updateSource?.({
			[`flags.${MODULE_ID}.targeting.template.tokenMagic.filters`]: foundry.utils.deepClone(clonedFilters),
		});
	};

	const refreshOpenTMFXStackWindows = () => {
		const proxyId = `${item.id}-tmfx`;
		const selector = foundry.applications.instances.get(`tmfx-filter-selector-${proxyId}`);
		if (selector) selector.render(true);

		for (const [appId, app] of foundry.applications.instances) {
			if (String(appId).startsWith(`tmfx-filter-editor-${proxyId}-`)) app.render(true);
		}
	};

	const updateStackSummary = () => {
		const count = getFilters().length;
		const summary = html.find(".sdx-tm-stack-summary");
		if (summary.length) summary.text(count ? `${count} effect${count === 1 ? "" : "s"} saved` : "No custom stack");
		html.find(".sdx-tm-clear-stack").prop("disabled", count === 0);
	};

	const updateStoredFilter = async data => {
		const currentFilters = getFilters();
		const filterIndex = currentFilters.findIndex(f => {
			if (f.tmFilters?.tmFilterInternalId === data.filterInternalId) return true;
			if (f.filterInternalId === data.filterInternalId) return true;
			if (f.tmParams?.filterInternalId === data.filterInternalId) return true;
			if (f.tmFilters?.tmParams?.filterInternalId === data.filterInternalId) return true;
			return false;
		});
		if (filterIndex < 0) return;

		const existing = currentFilters[filterIndex];
		if (existing.tmFilters?.tmParams) {
			currentFilters[filterIndex] = {
				...existing,
				...data,
				tmFilters: {
					...existing.tmFilters,
					tmParams: foundry.utils.mergeObject(existing.tmFilters.tmParams, data, { inplace: false }),
				},
			};
		}
		else if (existing.tmParams) {
			currentFilters[filterIndex] = {
				...existing,
				...data,
				tmParams: foundry.utils.mergeObject(existing.tmParams, data, { inplace: false }),
			};
		}
		else {
			currentFilters[filterIndex] = { ...existing, ...data };
		}

		await saveFilters(currentFilters);
		updateStackSummary();
		refreshOpenTMFXStackWindows();
	};

	const buildStoredFilterEntries = (paramsArray, replace = false) => {
		const entries = replace ? [] : getFilters();
		const maxRank = () => {
			const ranks = entries
				.map(f => f?.tmFilters?.tmParams?.rank ?? f?.tmParams?.rank ?? f?.rank)
				.filter(r => Number.isFinite(Number(r)))
				.map(Number);
			return ranks.length ? Math.max(...ranks) + 1 : 10000;
		};

		for (const rawParams of paramsArray || []) {
			if (!rawParams?.filterType) continue;
			const params = foundry.utils.deepClone(rawParams);
			if (!Number.isFinite(Number(params.rank))) params.rank = maxRank();
			if (!params.filterId) params.filterId = foundry.utils.randomID();
			if (typeof params.enabled !== "boolean") params.enabled = true;
			params.placeableId = `${item.id}-tmfx`;
			params.filterInternalId = foundry.utils.randomID();
			params.filterOwner = game.user.id;
			params.placeableType = "Region";
			params.updateId = foundry.utils.randomID();

			entries.push({
				tmFilters: {
					tmFilterId: params.filterId,
					tmFilterInternalId: params.filterInternalId,
					tmFilterType: params.filterType,
					tmFilterOwner: params.filterOwner,
					tmParams: params,
				},
			});
		}

		return entries;
	};

	const makeProxyDocument = () => ({
		id: `${item.id}-tmfx`,
		name: item.name,
		sdxTitle: item.name || "Spell Activity",
		_sdxVirtualTMFX: true,
		parent: { id: game.scenes?.current?.id ?? "sdx-item-activity" },
		get documentName() {
			return "SDXItemTMFX";
		},
		get isOwner() {
			return item.isOwner;
		},
		getFlag: (scope, key) => {
			if (scope === "tokenmagic" && key === "filters") return getFilters();
			return item.flags?.[scope]?.[key];
		},
		update: async data => {
			if (data?.filterInternalId && data?.filterType) {
				await updateStoredFilter(data);
				return;
			}

			const filters = data?.["flags.tokenmagic.filters"] ?? data?.flags?.tokenmagic?.filters;
			if (Array.isArray(filters)) {
				await saveFilters(filters);
				updateStackSummary();
				refreshOpenTMFXStackWindows();
			}
		},
		_TMFXgetPlaceableType: () => "Region",
		_TMFXgetMaxFilterRank: () => {
			const ranks = getFilters()
				.map(f => f?.tmFilters?.tmParams?.rank ?? f?.tmParams?.rank ?? f?.rank)
				.filter(r => Number.isFinite(Number(r)))
				.map(Number);
			return ranks.length ? Math.max(...ranks) + 1 : 10000;
		},
		_TMFXsetFlag: async filters => {
			await saveFilters(filters);
			updateStackSummary();
			refreshOpenTMFXStackWindows();
		},
		_TMFXunsetFlag: async () => {
			await saveFilters([]);
			updateStackSummary();
			refreshOpenTMFXStackWindows();
		},
		_SDXaddFilterParams: async (paramsArray, options = {}) => {
			const filters = buildStoredFilterEntries(paramsArray, Boolean(options.replace));
			await saveFilters(filters);
			updateStackSummary();
			refreshOpenTMFXStackWindows();
		},
		_TMFXsetAnimeFlag: async () => {},
		_TMFXunsetAnimeFlag: async () => {},
	});

	html.on("click", ".sdx-tm-edit-stack", async function(event) {
		event.preventDefault();
		event.stopPropagation();
		if (!game.modules.get("tokenmagic")?.active || !globalThis.TokenMagic) {
			ui.notifications.warn("TokenMagic FX is not active.");
			return;
		}
		const { filterEditor } = await import("../animation/TMFXFilterEditor.mjs");
		filterEditor(makeProxyDocument(), event.currentTarget.getBoundingClientRect());
	});

	html.on("click", ".sdx-tm-clear-stack", async function(event) {
		event.preventDefault();
		event.stopPropagation();
		await saveFilters([]);
		updateStackSummary();
		refreshOpenTMFXStackWindows();
	});
}

/**
 * Setup activity toggles to act like radio buttons - only one can be active at a time
 * @param {jQuery} html - The HTML element
 * @param {Item} item - The item being edited
 */
export function setupActivityRadioToggles(html, item) {
	// Spell Damage toggle
	html.find(".sdx-spell-damage-toggle").off("change").on("change", function(e) {
		e.stopPropagation();
		e.preventDefault();
		const isEnabled = $(this).is(":checked");
		const $content = $(this).closest(".sdx-spell-damage-box").find(".sdx-spell-damage-content");

		if (isEnabled) {
			$content.slideDown(200);
			// Disable other activities visually
			html.find(".sdx-summoning-toggle").prop("checked", false);
			html.find(".sdx-item-give-toggle").prop("checked", false);
			// Save all states at once
			const updateData = {};
			updateData[`flags.${MODULE_ID}.spellDamage.enabled`] = true;
			updateData[`flags.${MODULE_ID}.summoning.enabled`] = false;
			updateData[`flags.${MODULE_ID}.itemGive.enabled`] = false;
			item.update(updateData, { render: false });
		}
		else {
			$content.slideUp(200);
			const updateData = {};
			updateData[`flags.${MODULE_ID}.spellDamage.enabled`] = false;
			item.update(updateData, { render: false });
		}
	});

	// Track Duration toggle
	html.find(".sdx-track-duration-toggle").off("change").on("change", function(e) {
		e.stopPropagation();
		const isEnabled = $(this).is(":checked");
		const $content = $(this).closest(".sdx-spell-damage-content").find(".sdx-duration-content");

		if (isEnabled) {
			$content.slideDown(200);
		}
		else {
			$content.slideUp(200);
		}

		const updateData = {};
		updateData[`flags.${MODULE_ID}.spellDamage.trackDuration`] = isEnabled;
		item.update(updateData, { render: false });
	});

	// Summoning toggle
	html.find(".sdx-summoning-toggle").off("change").on("change", function(e) {
		e.stopPropagation();
		e.preventDefault();
		const isEnabled = $(this).is(":checked");

		if (isEnabled) {
			// Disable other activities visually
			html.find(".sdx-spell-damage-toggle").prop("checked", false);
			html.find(".sdx-spell-damage-content").slideUp(200);
			html.find(".sdx-item-give-toggle").prop("checked", false);
			// Save all states at once
			const updateData = {};
			updateData[`flags.${MODULE_ID}.spellDamage.enabled`] = false;
			updateData[`flags.${MODULE_ID}.summoning.enabled`] = true;
			updateData[`flags.${MODULE_ID}.itemGive.enabled`] = false;
			item.update(updateData, { render: false });
		}
		else {
			const updateData = {};
			updateData[`flags.${MODULE_ID}.summoning.enabled`] = false;
			item.update(updateData, { render: false });
		}
	});

	// Item Give toggle
	html.find(".sdx-item-give-toggle").off("change").on("change", function(e) {
		e.stopPropagation();
		e.preventDefault();
		const isEnabled = $(this).is(":checked");

		if (isEnabled) {
			// Disable other activities visually
			html.find(".sdx-spell-damage-toggle").prop("checked", false);
			html.find(".sdx-spell-damage-content").slideUp(200);
			html.find(".sdx-summoning-toggle").prop("checked", false);
			// Save all states at once
			const updateData = {};
			updateData[`flags.${MODULE_ID}.spellDamage.enabled`] = false;
			updateData[`flags.${MODULE_ID}.summoning.enabled`] = false;
			updateData[`flags.${MODULE_ID}.itemGive.enabled`] = true;
			item.update(updateData, { render: false });
		}
		else {
			const updateData = {};
			updateData[`flags.${MODULE_ID}.itemGive.enabled`] = false;
			item.update(updateData, { render: false });
		}
	});
}

/**
 * Wire the per-item Animation FX section (Activity tab) to persist into
 * flags.shadowdark-extras.animationFx = { enabled, preset }.
 */
export function activateAnimationFxListeners(html, item) {
	const $box = html.find(".sdx-animation-fx-box");
	if (!$box.length) return;

	const TINT_FIELDS = ".sdx-animfx-tint-color, .sdx-animfx-tint-color-text, .sdx-animfx-tint-contrast, .sdx-animfx-tint-saturation";
	const FIELDS = `.sdx-animfx-type, .sdx-animfx-target, .sdx-animfx-file, .sdx-animfx-native-color, .sdx-animfx-sound, .sdx-animfx-scale, .sdx-animfx-duration, .sdx-animfx-opacity, .sdx-animfx-tint-enabled, ${TINT_FIELDS}`;

	/** Read the panel's current values as a master-list-shaped preset. */
	function readPreset() {
		const sound = ($box.find(".sdx-animfx-sound").val() || "").trim();
		const duration = parseInt($box.find(".sdx-animfx-duration").val(), 10);
		return {
			label: item.name,
			type: $box.find(".sdx-animfx-type").val() || "projectile",
			target: $box.find(".sdx-animfx-target").val() || "target",
			opacity: parseFloat($box.find(".sdx-animfx-opacity").val()) || 1,
			tint: {
				enabled: $box.find(".sdx-animfx-tint-enabled").prop("checked"),
				color: ($box.find(".sdx-animfx-tint-color-text").val() || "#ffffff").trim(),
				contrast: parseFloat($box.find(".sdx-animfx-tint-contrast").val()) || 0,
				saturation: parseFloat($box.find(".sdx-animfx-tint-saturation").val()) || 0,
			},
			hit: {
				file: ($box.find(".sdx-animfx-file").val() || "").trim(),
				// Blank clears the sound rather than storing "".
				...(sound ? { sound } : {}),
				scale: parseFloat($box.find(".sdx-animfx-scale").val()) || 1,
				duration: Number.isFinite(duration) ? Math.max(0, duration) : 0,
			},
		};
	}

	/**
	 * Keep the header badge honest without a full re-render. Rebuilt from the
	 * data-inh-* attributes rather than stashing the rendered badge, because the
	 * panel may have rendered in the "Override active" state to begin with.
	 */
	function updateBadge(overriding) {
		const $badge = $box.find(".sdx-animfx-badge");
		if (!$badge.length) return;
		if (overriding) {
			$badge.attr("class", "sdx-animfx-badge sdx-animfx-badge-override").text("Override active");
			return;
		}
		const label = $box.attr("data-inh-label") || "";
		if ($box.attr("data-inh-file")) {
			$badge.attr("class", "sdx-animfx-badge sdx-animfx-badge-inherited")
				.html(`<i class="fas fa-link"></i> Inherited: ${foundry.utils.escapeHTML(label || "master list")}`);
		}
		else {
			$badge.attr("class", "sdx-animfx-badge sdx-animfx-badge-none").text("No preset");
		}
	}

	function saveAnimationFx() {
		const updateData = {};
		updateData[`flags.${MODULE_ID}.animationFx`] = { enabled: true, preset: readPreset() };
		item.update(updateData, { render: false }).catch(err => {
			console.error(`${MODULE_ID} | Failed to save animationFx:`, err);
		});
	}

	function syncTintControls() {
		const overriding = $box.find(".sdx-animfx-enabled").prop("checked");
		const tinting = $box.find(".sdx-animfx-tint-enabled").prop("checked");
		$box.find(TINT_FIELDS).prop("disabled", !overriding || !tinting);
		$box.find(".sdx-animfx-tint-controls").toggleClass("sdx-animfx-readonly", !tinting);
	}

	function syncAnchorControl() {
		const overriding = $box.find(".sdx-animfx-enabled").prop("checked");
		const $type = $box.find(".sdx-animfx-type");
		const $anchor = $box.find(".sdx-animfx-target");
		if ($type.val() === "onToken") {
			$anchor.prop("disabled", !overriding);
			if (overriding) $anchor.val($anchor.attr("data-on-token-target") || $anchor.val() || "target");
			return;
		}
		if (!$anchor.prop("disabled")) $anchor.attr("data-on-token-target", $anchor.val() || "target");
		$anchor.val("target").prop("disabled", true);
	}

	function refreshNativeColors(file) {
		const variants = AnimationFxSD.nativeColorVariants(file);
		const $row = $box.find(".sdx-animfx-native-color-row");
		const $select = $box.find(".sdx-animfx-native-color").empty();
		for (const variant of variants) {
			$select.append($("<option>")
				.val(variant.path)
				.text(variant.label)
				.prop("selected", variant.current));
		}
		$row.prop("hidden", variants.length === 0);
	}

	// NOTE: these must be bound *directly*, not delegated off $box. The Activity
	// tab installs a blanket per-input `change` handler that calls
	// stopPropagation() to suppress Foundry's form auto-submit (see
	// enhanceSpellSheet), so nothing here ever bubbles to an ancestor. Handlers
	// on the same node still all run.

	// Keep compound controls synchronized before the shared persistence handler.
	$box.find(".sdx-animfx-file").on("change", function() {
		refreshNativeColors($(this).val());
	});
	$box.find(".sdx-animfx-native-color").on("change", function() {
		$box.find(".sdx-animfx-file").val($(this).val());
	});
	$box.find(".sdx-animfx-tint-color").on("change", function() {
		$box.find(".sdx-animfx-tint-color-text").val($(this).val());
	});
	$box.find(".sdx-animfx-tint-color-text").on("change", function() {
		if (/^#[0-9a-f]{6}$/i.test($(this).val())) {
			$box.find(".sdx-animfx-tint-color").val($(this).val());
		}
	});
	$box.find(".sdx-animfx-tint-enabled").on("change", syncTintControls);
	$box.find(".sdx-animfx-type").on("change", syncAnchorControl);
	syncAnchorControl();

	// Field edits only ever persist while the override is on — when it's off the
	// panel is a read-only view of the master list and must not write to the item.
	$box.find(FIELDS).on("change", function(e) {
		e.stopPropagation();
		if (!$box.find(".sdx-animfx-enabled").prop("checked")) return;
		saveAnimationFx();
	});

	// Override toggle: on -> capture what's displayed as this item's own preset;
	// off -> drop the override entirely and restore the inherited display.
	$box.find(".sdx-animfx-enabled").on("change", function(e) {
		e.stopPropagation();
		const on = $box.find(".sdx-animfx-enabled").prop("checked");
		$box.find(FIELDS).prop("disabled", !on);
		syncTintControls();
		syncAnchorControl();
		$box.find(".SD-grid").toggleClass("sdx-animfx-readonly", !on);
		updateBadge(on);

		if (on) {
			saveAnimationFx();
			return;
		}

		// Restore the master-list values the panel was rendered with.
		$box.find(".sdx-animfx-file").val($box.attr("data-inh-file") || "");
		$box.find(".sdx-animfx-sound").val($box.attr("data-inh-sound") || "");
		$box.find(".sdx-animfx-type").val($box.attr("data-inh-type") || "projectile");
		$box.find(".sdx-animfx-target").val($box.attr("data-inh-target") || "target");
		$box.find(".sdx-animfx-scale").val($box.attr("data-inh-scale") || 1);
		$box.find(".sdx-animfx-duration").val($box.attr("data-inh-duration") || 0);
		$box.find(".sdx-animfx-opacity").val($box.attr("data-inh-opacity") || 1);
		refreshNativeColors($box.attr("data-inh-file") || "");
		const inheritedTint = $box.attr("data-inh-tint-enabled") === "true";
		const inheritedColor = $box.attr("data-inh-tint-color") || "#ffffff";
		$box.find(".sdx-animfx-tint-enabled").prop("checked", inheritedTint);
		$box.find(".sdx-animfx-tint-color, .sdx-animfx-tint-color-text").val(inheritedColor);
		$box.find(".sdx-animfx-tint-contrast").val($box.attr("data-inh-tint-contrast") || 0);
		$box.find(".sdx-animfx-tint-saturation").val($box.attr("data-inh-tint-saturation") || 0);
		syncTintControls();
		syncAnchorControl();

		const updateData = {};
		updateData[`flags.${MODULE_ID}.-=animationFx`] = null;
		item.update(updateData, { render: false }).catch(err => {
			console.error(`${MODULE_ID} | Failed to clear animationFx:`, err);
		});
	});

	// Inline thumbnail: play on hover, rewind on leave (mirrors the master list).
	$box.find("video.sdx-animfx-item-thumb").each(function() {
		const vid = this;
		vid.addEventListener("mouseenter", () => {
			vid.play().catch(() => { });
		});
		vid.addEventListener("mouseleave", () => {
			vid.pause(); vid.currentTime = 0;
		});
		vid.addEventListener("error", () => {
			const ph = document.createElement("div");
			ph.className = "sdx-animfx-item-thumb sdx-animfx-item-thumb-missing";
			ph.textContent = "no preview";
			vid.replaceWith(ph);
		});
	});

	// Play the displayed preset on the canvas from the selected token.
	$box.find(".sdx-animfx-preview").on("click", async function(e) {
		e.preventDefault();
		e.stopPropagation();
		await AnimationFxSD.previewPreset(readPreset(), { outcome: e.shiftKey ? "miss" : "hit" });
	});

	// Play just the sound, so it can be auditioned without the animation.
	$box.find(".sdx-animfx-preview-sound").on("click", async function(e) {
		e.preventDefault();
		e.stopPropagation();
		const sound = ($box.find(".sdx-animfx-sound").val() || "").trim();
		if (!sound) {
			ui.notifications.warn("No sound file set.");
			return;
		}
		await AnimationFxSD._playSound({ sound });
	});

	// Sequencer Database browser button
	$box.find(".sdx-animfx-pick-file").on("click", function(e) {
		e.preventDefault();
		e.stopPropagation();
		try {
			if (globalThis.Sequencer?.DatabaseViewer?.show) {
				globalThis.Sequencer.DatabaseViewer.show();
			}
			else if (globalThis.Sequencer?.Database?.show) {
				globalThis.Sequencer.Database.show();
			}
			else {
				ui.notifications.warn("Sequencer Database viewer is not available.");
			}
		}
		catch(err) {
			console.warn(`${MODULE_ID} | Could not open Sequencer Database:`, err);
		}
	});
}

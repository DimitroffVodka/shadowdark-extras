/**
 * The root's ENHANCED INVENTORY TAB section, moved verbatim.
 *
 * The banner undersells it: only `enhanceInventoryTab` is about the inventory
 * tab. The other eight functions are the native HP quick-adjust controls —
 * reading the displayed HP, painting it, queueing and flushing adjustments,
 * and attaching the controls to a sheet. They travelled together in the root
 * under one banner and are moved together here.
 *
 * Splitting them into an inventory module and an hp-controls module is a
 * judgement call about module shape, not a move, so it is deliberately not
 * taken here. The section name is kept for the file so the two are easy to
 * match up.
 *
 * Five names are exported because five are used outside: `enhanceInventoryTab`
 * and `attachNativeHpQuickControls` from the sheet dispatch, and
 * `applyHpQuickAdjust`/`setActorHpValue` from the ENHANCED HEADER section,
 * which is why this one had to move first.
 *
 * Zero registrations, so the registration snapshot is untouched.
 * `HP_QUICK_ADJUST_TOOLTIP` is exported too: it is declared in this section but
 * read by the ENHANCED HEADER markup still in the root. The binding gate caught
 * that — a dependency scan over function names alone had missed the const.
 */


// ============================================
// ENHANCED INVENTORY TAB
// ============================================

/**
 * Enhance the Inventory tab with improved styling and organization
 */
export function enhanceInventoryTab(app, html, actor) {
	if (actor.type !== "Player") return;

	const $inventoryTab = html.find('.tab[data-tab="tab-inventory"]');
	if (!$inventoryTab.length) return;

	// Add enhanced class to the inventory tab
	$inventoryTab.addClass("sdx-enhanced-inventory");

	// Style light toggle icons based on active state
	html.find('[data-action="toggle-light"]').each(function() {
		const $toggle = $(this);
		const itemId = $toggle.data("item-id");
		const item = actor.items.get(itemId);

		if (item?.system?.light?.active) {
			// Light is active - add glow effect
			$toggle.find("i").addClass("sdx-light-active");
			$toggle.addClass("sdx-light-toggle-active");
		}
		else {
			// Light is not active - ensure classes are removed
			$toggle.find("i").removeClass("sdx-light-active");
			$toggle.removeClass("sdx-light-toggle-active");
		}
	});
}

export const HP_QUICK_ADJUST_TOOLTIP = "Left-click: -1 HP | Right-click: +1 HP";
const hpQuickAdjustments = new Map();

function getActorHpData(actor) {
	const hp = actor?.system?.attributes?.hp ?? {};
	return {
		value: Number(hp.value ?? 0),
		max: Number(hp.max ?? 0),
	};
}

// Read the HP value currently shown in a sheet scope, preferring the enhanced
// header readout and falling back to the native current-HP input. Returns null
// if neither is present (caller then skips the optimistic paint).
function readDisplayedHp($scope) {
	const $val = $scope.find(".sdx-hp-value").first();
	if ($val.length) {
		const n = Number.parseInt($val.text(), 10);
		if (Number.isFinite(n)) return n;
	}
	const $input = $scope.find('[name="system.attributes.hp.value"]').first();
	if ($input.length) {
		const n = Number.parseInt($input.val(), 10);
		if (Number.isFinite(n)) return n;
	}
	return null;
}

// Optimistically paint a new HP value into every HP display in a sheet scope so
// clicks feel instant. The authoritative actor.update + reconcile render is the
// backstop, so this only needs to be approximately right.
function paintHpValue($scope, newValue) {
	const $val = $scope.find(".sdx-hp-value");
	if ($val.length) {
		$val.text(newValue);
		const max = Number.parseInt($scope.find(".sdx-hp-max").first().text(), 10);
		if (Number.isFinite(max) && max > 0) {
			const pct = Math.min(100, Math.max(0, (newValue / max) * 100));
			const color = pct > 50 ? "#4ade80" : pct > 25 ? "#fbbf24" : "#ef4444";
			$scope.find(".sdx-hp-bar").css({ "width": `${pct}%`, "background-color": color });
			$scope.find(".hp-wave-container").css("--hp-translate", `${Math.max(0, Math.round(pct) - 15)}%`);
		}
	}
	const $input = $scope.find('[name="system.attributes.hp.value"]');
	if ($input.length) $input.val(newValue);
}

// Instant feedback: paint the projected value, then queue the real update.
// Reading the current value from the DOM (not a render-time closure) lets rapid
// clicks chain correctly even while updates are suppressing re-renders.
export function applyHpQuickAdjust(actor, delta, $scope) {
	if (!actor?.isOwner) return;
	if ($scope && $scope.length) {
		const cur = readDisplayedHp($scope);
		if (cur !== null) paintHpValue($scope, Math.max(0, cur + delta));
	}
	queueActorHpAdjustment(actor, delta);
}

async function flushActorHpAdjustment(actorUuid) {
	const state = hpQuickAdjustments.get(actorUuid);
	if (!state || state.flushing) return;

	state.flushing = true;
	try {
		while (state.delta !== 0) {
			const delta = state.delta;
			state.delta = 0;
			const actor = await fromUuid(actorUuid);
			if (!actor?.isOwner) break;

			const hp = getActorHpData(actor);
			const newHp = Math.max(0, hp.value + delta);
			// render:false keeps rapid clicks smooth: the optimistic DOM paint
			// (see applyHpQuickAdjust) already shows the new value, and skipping
			// the per-tick sheet re-render avoids the number visibly jumping
			// backward to a mid-burst authoritative value. Token bars still
			// update via the updateActor hook regardless of this flag.
			await actor.update({ "system.attributes.hp.value": newHp }, { render: false });
		}
	}
	finally {
		state.flushing = false;
		if (state.delta !== 0) {
			// A click landed during the final in-flight update; drain it on the
			// next tick (no artificial delay — just yields so the update settles).
			state.timer = window.setTimeout(() => flushActorHpAdjustment(actorUuid), 0);
		}
		else {
			hpQuickAdjustments.delete(actorUuid);
			// Burst complete: one authoritative re-render reconciles any drift
			// between the optimistic paint and the stored value (the per-tick
			// updates above suppressed rendering to stay flicker-free).
			try {
				const actor = await fromUuid(actorUuid);
				if (actor?.sheet?.rendered) actor.sheet.render(false);
			}
			catch(_e) { /* sheet closed mid-burst — nothing to reconcile */ }
		}
	}
}

function queueActorHpAdjustment(actor, delta) {
	if (!actor?.isOwner) return;

	const actorUuid = actor.uuid;
	const state = hpQuickAdjustments.get(actorUuid) ?? { delta: 0, timer: null, flushing: false };
	state.delta += delta;
	hpQuickAdjustments.set(actorUuid, state);
	// Leading-edge: apply immediately instead of waiting out a debounce window.
	// The `flushing` flag serializes concurrent flushes and the while-loop in
	// flushActorHpAdjustment coalesces any clicks that arrive mid-update, so no
	// click is lost and no 50ms delay is paid before the first HP change lands.
	flushActorHpAdjustment(actorUuid);
}

export async function setActorHpValue(actor, value) {
	if (!actor?.isOwner) return;
	const parsed = Number.parseInt(value, 10);
	const newHp = Math.max(0, Number.isFinite(parsed) ? parsed : 0);
	await actor.update({ "system.attributes.hp.value": newHp });
}

export function attachNativeHpQuickControls(app, html, actor) {
	if (!actor?.isOwner) return;

	const $html = html instanceof jQuery ? html : $(html);
	const $hpInput = $html.find('[name="system.attributes.hp.value"]').first();
	if (!$hpInput.length) return;

	$hpInput.prop("disabled", false);
	$hpInput.attr("data-tooltip", "Current HP");

	const $hpBox = $hpInput.closest(".SD-box");
	if (!$hpBox.length) return;

	$hpBox.attr("data-tooltip", HP_QUICK_ADJUST_TOOLTIP);
	$hpBox.css("cursor", "pointer");
	$hpBox.off("click.sdxQuickHp contextmenu.sdxQuickHp");

	$hpBox.on("click.sdxQuickHp", async event => {
		if ($(event.target).is("input, textarea, select, button, a")) return;
		event.preventDefault();
		event.stopPropagation();
		applyHpQuickAdjust(actor, -1, $html);
	});

	$hpBox.on("contextmenu.sdxQuickHp", async event => {
		if ($(event.target).is("input, textarea, select, button, a")) return;
		event.preventDefault();
		event.stopPropagation();
		applyHpQuickAdjust(actor, 1, $html);
	});
}

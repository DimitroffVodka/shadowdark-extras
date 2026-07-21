/**
 * Per-item Animation FX configuration section for the Activity tab.
 *
 * Renders an override editor storing into
 *   flags.shadowdark-extras.animationFx = { enabled, preset }
 * where preset is the same schema the master list uses:
 *   { label, type, target, opacity, hit: { file, sound, scale, duration } }
 *
 * When enabled with a file, AnimationFxSD.resolvePreset() uses this instead of
 * the master pattern list.
 *
 * When the override is OFF, the fields are read-only and show whatever the
 * master list would give this item *by name pattern* (see
 * AnimationFxSD.inheritedPresetFor) — so an item covered by a named preset
 * reads at a glance, while one covered only by the category `_default` stays
 * blank. Nothing is written to the item until the override is ticked, so the
 * master list stays authoritative and the display can never go stale.
 */

import { AnimationFxSD } from "../AnimationFxSD.mjs";

/** Escape a value for interpolation into an HTML attribute. */
function esc(v) {
	return String(v ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

export function generateAnimationFxConfigHTML(MODULE_ID, flags, item = null) {
	const fx = flags.animationFx || {};
	const stored = fx.preset || {};
	const enabled = !!fx.enabled;

	// What the master list gives this item by name pattern (never `_default`).
	let inherited = null;
	try {
		inherited = AnimationFxSD.inheritedPresetFor(item);
	} catch (e) {
		console.warn(`${MODULE_ID} | Could not resolve inherited animation preset:`, e);
	}

	// The override owns the fields once ticked; otherwise show the inherited
	// preset (or blanks when nothing but the generic default covers this item).
	const shown = enabled ? stored : (inherited?.preset ?? {});
	const shownHit = shown.hit || {};

	const type = shown.type || "projectile";
	const target = shown.target || "target";
	const file = shownHit.file ?? "";
	const sound = shownHit.sound ?? "";
	const scale = shownHit.scale ?? 1;
	const duration = shownHit.duration ?? 1500;
	const opacity = shown.opacity ?? 1;

	// Values to restore into the fields when the override is switched back off.
	const inhHit = inherited?.preset?.hit || {};
	const inhData = [
		`data-inh-label="${esc(inherited?.label ?? "")}"`,
		`data-inh-file="${esc(inhHit.file ?? "")}"`,
		`data-inh-sound="${esc(inhHit.sound ?? "")}"`,
		`data-inh-type="${esc(inherited?.preset?.type ?? "projectile")}"`,
		`data-inh-target="${esc(inherited?.preset?.target ?? "target")}"`,
		`data-inh-scale="${esc(inhHit.scale ?? 1)}"`,
		`data-inh-duration="${esc(inhHit.duration ?? 1500)}"`,
		`data-inh-opacity="${esc(inherited?.preset?.opacity ?? 1)}"`
	].join(" ");

	const ro = enabled ? "" : "disabled";
	const roClass = enabled ? "" : " sdx-animfx-readonly";

	const typeOpt = (v, label) =>
		`<option value="${v}" ${type === v ? "selected" : ""}>${label}</option>`;
	const targetOpt = (v, label) =>
		`<option value="${v}" ${target === v ? "selected" : ""}>${label}</option>`;

	// Header badge: tells you at a glance whether this item is already covered.
	let badge = "";
	if (enabled) {
		badge = `<span class="sdx-animfx-badge sdx-animfx-badge-override">Override active</span>`;
	} else if (inherited) {
		const off = inherited.categoryEnabled ? "" : " — category disabled";
		badge = `<span class="sdx-animfx-badge sdx-animfx-badge-inherited"
			data-tooltip="Matched by name pattern in the Animation FX master list">
			<i class="fas fa-link"></i> Inherited: ${esc(inherited.label || "master list")}${esc(off)}</span>`;
	} else {
		badge = `<span class="sdx-animfx-badge sdx-animfx-badge-none"
			data-tooltip="No named preset matches this item. The category default (if any) still plays.">No preset</span>`;
	}

	const videoSrc = file ? AnimationFxSD.resolveVideoSrc(file) : "";
	const thumb = videoSrc
		? `<video class="sdx-animfx-item-thumb" src="${esc(videoSrc)}" muted loop preload="none" playsinline
			data-tooltip="Hover to play"></video>`
		: `<div class="sdx-animfx-item-thumb sdx-animfx-item-thumb-missing">no preview</div>`;

	const hint = enabled
		? `Overriding the master list. Untick to hand this item back to the master list
			(the values below are discarded).`
		: (inherited
			? `Read-only — these values come from the master list preset that matches this
				item's name. Tick <em>Override master list</em> to edit them for this item only.`
			: `No named master-list preset matches this item. Tick <em>Override master list</em>
				to give it its own animation.`);

	return `
		<div class="SD-box sdx-animation-fx-box grid-colspan-3" ${inhData}>
			<div class="header light">
				<label class="sdx-section-label">
					<i class="fas fa-wand-magic-sparkles"></i>
					<span>Animation FX</span>
				</label>
				${badge}
				<label class="sdx-toggle-label sdx-animfx-enable-wrap">
					<input type="checkbox" class="sdx-animfx-enabled" ${enabled ? "checked" : ""} />
					<span>Override master list</span>
				</label>
			</div>
			<div class="content">
				<p class="notes">${hint}</p>
				<div class="SD-grid${roClass}">
					<div class="sdx-animfx-field grid-colspan-3">
						<label>Animation File (JB2A DB path or file path)</label>
						<div class="sdx-animfx-file-row">
							${thumb}
							<input type="text" class="sdx-animfx-file" value="${esc(file)}"
								placeholder="e.g. jb2a.magic_missile" spellcheck="false" ${ro} />
							<a class="sdx-animfx-preview" data-tooltip="Play on canvas from the selected token (shift = miss variant)">
								<i class="fas fa-play"></i>
							</a>
							<a class="sdx-animfx-pick-file" data-tooltip="Browse Sequencer Database">
								<i class="fas fa-database"></i>
							</a>
						</div>
					</div>

					<div class="sdx-animfx-field grid-colspan-3">
						<label>Sound (file path — blank = silent)</label>
						<div class="sdx-animfx-file-row">
							<input type="text" class="sdx-animfx-sound" value="${esc(sound)}"
								placeholder="e.g. modules/my-sfx/fireball.ogg" spellcheck="false" ${ro} />
							<a class="sdx-animfx-preview-sound" data-tooltip="Play this sound">
								<i class="fas fa-volume-high"></i>
							</a>
						</div>
					</div>

					<div class="sdx-animfx-field">
						<label>Type</label>
						<select class="sdx-animfx-type" ${ro}>
							${typeOpt("projectile", "Projectile (ranged)")}
							${typeOpt("onToken", "On Token (melee/buff)")}
							${typeOpt("cone", "Cone (breath)")}
						</select>
					</div>

					<div class="sdx-animfx-field">
						<label>Anchor</label>
						<select class="sdx-animfx-target" ${ro}>
							${targetOpt("target", "Target")}
							${targetOpt("self", "Caster")}
						</select>
					</div>

					<div class="sdx-animfx-field">
						<label>Scale</label>
						<input type="number" step="0.1" min="0" class="sdx-animfx-scale" value="${esc(scale)}" ${ro} />
					</div>

					<div class="sdx-animfx-field">
						<label>Duration (ms)</label>
						<input type="number" step="50" min="0" class="sdx-animfx-duration" value="${esc(duration)}" ${ro} />
					</div>

					<div class="sdx-animfx-field">
						<label>Opacity</label>
						<input type="number" step="0.05" min="0" max="1" class="sdx-animfx-opacity" value="${esc(opacity)}" ${ro} />
					</div>
				</div>
			</div>
		</div>
	`;
}

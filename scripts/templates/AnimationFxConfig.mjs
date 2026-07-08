/**
 * Per-item Animation FX configuration section for the Activity tab.
 *
 * Renders an override editor storing into
 *   flags.shadowdark-extras.animationFx = { enabled, preset }
 * where preset is the same schema the master list uses:
 *   { label, type, target, opacity, hit: { file, scale, duration } }
 *
 * When enabled with a file, AnimationFxSD.resolvePreset() uses this instead of
 * the master pattern list.
 */

export function generateAnimationFxConfigHTML(MODULE_ID, flags) {
	const fx = flags.animationFx || {};
	const preset = fx.preset || {};
	const hit = preset.hit || {};

	const enabled = !!fx.enabled;
	const type = preset.type || "projectile";
	const target = preset.target || "target";
	const file = hit.file ?? "";
	const scale = hit.scale ?? 1;
	const duration = hit.duration ?? 1500;
	const opacity = preset.opacity ?? 1;

	const typeOpt = (v, label) =>
		`<option value="${v}" ${type === v ? "selected" : ""}>${label}</option>`;
	const targetOpt = (v, label) =>
		`<option value="${v}" ${target === v ? "selected" : ""}>${label}</option>`;

	return `
		<div class="SD-box sdx-animation-fx-box grid-colspan-3">
			<div class="header light">
				<label class="sdx-section-label">
					<i class="fas fa-wand-magic-sparkles"></i>
					<span>Animation FX</span>
				</label>
				<label class="sdx-toggle-label sdx-animfx-enable-wrap">
					<input type="checkbox" class="sdx-animfx-enabled" ${enabled ? "checked" : ""} />
					<span>Override master list</span>
				</label>
			</div>
			<div class="content">
				<p class="notes">
					Fire a Sequencer/JB2A animation for this item on cast/attack. When the
					override is off, the world master list is used (matched by item name).
				</p>
				<div class="SD-grid">
					<div class="sdx-animfx-field grid-colspan-3">
						<label>Animation File (JB2A DB path or file path)</label>
						<div class="sdx-animfx-file-row">
							<input type="text" class="sdx-animfx-file" value="${file}"
								placeholder="e.g. jb2a.magic_missile" spellcheck="false" />
							<a class="sdx-animfx-pick-file" data-tooltip="Browse Sequencer Database">
								<i class="fas fa-database"></i>
							</a>
						</div>
					</div>

					<div class="sdx-animfx-field">
						<label>Type</label>
						<select class="sdx-animfx-type">
							${typeOpt("projectile", "Projectile (ranged)")}
							${typeOpt("onToken", "On Token (melee/buff)")}
							${typeOpt("cone", "Cone (breath)")}
						</select>
					</div>

					<div class="sdx-animfx-field">
						<label>Anchor</label>
						<select class="sdx-animfx-target">
							${targetOpt("target", "Target")}
							${targetOpt("self", "Caster")}
						</select>
					</div>

					<div class="sdx-animfx-field">
						<label>Scale</label>
						<input type="number" step="0.1" min="0" class="sdx-animfx-scale" value="${scale}" />
					</div>

					<div class="sdx-animfx-field">
						<label>Duration (ms)</label>
						<input type="number" step="50" min="0" class="sdx-animfx-duration" value="${duration}" />
					</div>

					<div class="sdx-animfx-field">
						<label>Opacity</label>
						<input type="number" step="0.05" min="0" max="1" class="sdx-animfx-opacity" value="${opacity}" />
					</div>
				</div>
			</div>
		</div>
	`;
}

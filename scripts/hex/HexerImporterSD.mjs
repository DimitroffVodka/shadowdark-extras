import { convertHexerMap } from "./hexer-data.mjs";

const MODULE_ID = "shadowdark-extras";

function requireHexApi() {
	if (!game.user?.isGM) throw new Error("Hexer import requires GM permission.");
	const api = game.modules.get(MODULE_ID)?.api?.hex;
	if (!api?.buildHexcrawl) throw new Error("Enable Hex Painter before importing Hexer maps.");
	return api;
}

async function importPlan(plan, { view = true } = {}) {
	const api = requireHexApi();
	const scenes = [];
	try {
		for (const { layer, dataset, flags } of plan.maps) {
			// A file import always creates new scenes; it never replaces a GM's map.
			const result = await api.buildHexcrawl(dataset, { view: false, overwrite: false });
			scenes.push({ layer, ...result });
			await game.scenes.get(result.sceneId).update({ flags: { [MODULE_ID]: flags } });
		}
		if (view && scenes.length) await game.scenes.get(scenes[0].sceneId).view();
	}
	catch(error) {
		// Keep completed scenes on a storage failure; report their IDs for recovery.
		error.message += ` Completed Hexer scenes: ${scenes.map(s => s.sceneId).join(", ") || "none"}.`;
		throw error;
	}
	return { scenes, warnings: plan.warnings };
}

/** Import a parsed Hexer v6 export, leaving its source object untouched. */
export async function importHexerMap(data, options = {}) {
	requireHexApi();
	if (!options || typeof options !== "object" || Array.isArray(options)) {
		throw new Error("Hexer import options must be an object.");
	}
	for (const key of Object.keys(options)) {
		if (!["view", "sceneName"].includes(key)) throw new Error(`Unknown Hexer option: ${key}`);
	}
	if (options.view !== undefined && typeof options.view !== "boolean") {
		throw new Error("Hexer view must be boolean.");
	}
	return importPlan(convertHexerMap(data, options), options);
}

/** Native file picker and a preflight summary: no writes until GM confirmation. */
export async function openHexerImportDialog() {
	try {
		requireHexApi();
		const Dialog = foundry.applications.api.DialogV2;
		const file = await Dialog.prompt({
			window: { title: "Import Hexer JSON" },
			content: `<p>Choose a Hexer schema-version-6 JSON export. Each layer becomes a new painted scene.</p>
				<p>Pointy maps are transposed to SDX's flat-top grid. Tokens and point-crawl data are not imported.</p>
				<div class="form-group"><label for="sdx-hexer-file">Hexer JSON file</label>
				<input id="sdx-hexer-file" name="hexerFile" type="file" accept=".json,application/json" required></div>`,
			ok: { label: "Preview import", callback: (_event, button) => button.form.elements.hexerFile.files[0] },
			rejectClose: false,
		});
		if (!file) return null;
		if (file.size > 20 * 1024 * 1024) throw new Error("Hexer JSON exceeds the 20 MiB import limit.");
		const plan = convertHexerMap(JSON.parse(await file.text()));
		const esc = foundry.utils.escapeHTML;
		const summary = `<ul>${plan.maps.map(({ dataset }) =>
			`<li>${esc(dataset.name)}: ${dataset.grid.cols} × ${dataset.grid.rows} source cells</li>`).join("")}</ul>`;
		const warnings = `<ul>${plan.warnings.map(warning => `<li>${esc(warning)}</li>`).join("")}</ul>`;
		const confirmed = await Dialog.confirm({
			window: { title: "Confirm Hexer import" },
			content: `<p>Create ${plan.maps.length} new scene(s)? Existing scenes are not changed.</p>${summary}${warnings}
				<p>SDX hex notes are not confidential storage: hidden notes control presentation, not document access.</p>`,
			modal: true,
			rejectClose: false,
		});
		if (!confirmed) return null;
		const result = await importPlan(plan);
		await Dialog.wait({
			window: { title: "Hexer import complete" },
			content: `<p>Created ${result.scenes.length} scene(s).</p>${summary}${warnings}`,
			buttons: [{ action: "close", label: "Close", default: true }],
			rejectClose: false,
		});
		return result;
	}
	catch(error) {
		ui.notifications.error(`SDX | ${error.message}`);
		return null;
	}
}

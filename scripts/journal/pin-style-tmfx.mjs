// TokenMagic FX controls for the pin style editor — extracted from
// scripts/journal/PinStyleEditorSD.mjs (Phase 5.3 split). Prototype mixin:
// listing presets from both libraries, reading the filters already on a pin,
// and the apply/save/delete/remove/clear/edit handlers behind the TMFX panel.
// Merged via Object.assign(PinStyleEditorApp.prototype, PinStyleTMFX).

import { FilterEditor, getCloneFilterParams } from "../animation/TMFXFilterEditor.mjs";
import { JournalPinManager, JournalPinRenderer } from "./JournalPinsSD.mjs";

export const PinStyleTMFX = {
	_getTMFXPresets() {
		if (!game.modules.get("tokenmagic")?.active || !window.TokenMagic) return [];

		try {
			// Fetch presets from libraries
			const mainPresets = window.TokenMagic.getPresets("tmfx-main") || [];
			const sdxPresets = window.TokenMagic.getPresets("sdx-presets") || [];

			const allPresets = [
				...mainPresets.map(p => ({ ...p, library: "tmfx-main", removable: false })),
				...sdxPresets.map(p => ({ ...p, library: "sdx-presets", removable: true })),
			];

			return allPresets.map(p => ({
				name: p.name,
				library: p.library,
				removable: p.removable,
				label: p.name.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
			})).sort((a, b) => a.label.localeCompare(b.label));
		}
		catch(err) {
			console.error("SDX | Error fetching TMFX presets:", err);
			return [];
		}
	},

	_getActiveFilters() {
		if (!this.pinId) return [];
		const pin = JournalPinManager.get(this.pinId);
		const filters = pin?.flags?.tokenmagic?.filters;
		if (!filters || !Array.isArray(filters)) return [];

		console.log(`SDX Pin Editor | Active TMFX Filters for ${this.pinId}:`, filters);

		return filters.map(f => {
			// TokenMagic might nest data under tmFilters or use top-level tmFilterId/tmFilterType
			// We'll search both levels for anything that looks like a type or ID
			const data = f.tmFilters || f;

			const id = data.tmFilterId || data.filterId || data.id || f.id || "";
			const type = data.tmFilterType || data.filterType || data.type || data.tmType || f.filterType || "unknown";

			// Check for common TMFX internal type names if still unknown
			let label = "Unknown";
			const rawType = type.toLowerCase();

			if (rawType !== "unknown") {
				label = type.charAt(0).toUpperCase() + type.slice(1);
			}
			else if (id && id.toLowerCase() !== "unknown") {
				label = id.charAt(0).toUpperCase() + id.slice(1);
			}

			return {
				id: id,
				type: type,
				internalId: data.tmFilterInternalId || data.filterInternalId || "",
				label: label,
			};
		});
	},

	async _onApplyTMFX() {
		if (!this.pinId) return;
		const select = this.element.querySelector('[name="tmfxPreset"]');
		const presetName = select?.value;
		const option = select?.options[select.selectedIndex];
		const library = option?.dataset.library || "tmfx-main";

		if (!presetName) {
			ui.notifications.warn("Please select a preset first.");
			return;
		}

		const graphics = JournalPinRenderer.getPin(this.pinId);
		if (!graphics) {
			ui.notifications.error("Could not find the pin on the canvas.");
			return;
		}

		try {
			// Fetch preset from TokenMagic library
			const libraryPresets = window.TokenMagic.getPresets(library) || [];
			const preset = libraryPresets.find(p => p.name === presetName);

			if (!preset) {
				ui.notifications.error(
					`Could not find TokenMagic preset: ${presetName} in library ${library}`
				);
				return;
			}

			// Apply preset via TokenMagic API
			await window.TokenMagic.addFilters(graphics, preset.params);

			ui.notifications.info(`Applied TokenMagic FX: ${presetName}`);

			// Small delay to ensure flag updates propagate before re-render
			setTimeout(() => this.render(), 100);
		}
		catch(err) {
			console.error("SDX | Error applying TMFX preset:", err);
			ui.notifications.error("Failed to apply TokenMagic FX preset.");
		}
	},

	async _onSaveTMFXPreset() {
		if (!this.pinId) return;
		const pin = JournalPinManager.get(this.pinId);
		if (!pin) return;

		const params = getCloneFilterParams(pin);
		if (!params || params.length === 0) {
			ui.notifications.warn("No active filters to save.");
			return;
		}

		const name = await foundry.applications.api.DialogV2.prompt({
			window: { title: "Save as Token Magic Preset" },
			content: `
                <div class="form-group">
                    <label>Preset Name</label>
                    <div class="form-fields">
                        <input type="text" name="name" placeholder="sdx-my-preset" autofocus />
                    </div>
                </div>
                <p class="hint">Prefix 'sdx-' will be added automatically if not provided.</p>
            `,
			ok: {
				label: "Save",
				callback: (event, button, dialog) => button.form.elements.name.value,
			},
		});

		if (!name) return;

		// Add prefix if missing
		const finalName = name.startsWith("sdx-") ? name : `sdx-${name}`;

		try {
			await window.TokenMagic.addPreset({
				name: finalName,
				library: "sdx-presets",
			}, params);
			ui.notifications.info(`Saved preset: ${finalName}`);
			this.render();
		}
		catch(err) {
			console.error("SDX | Error saving TMFX preset:", err);
			ui.notifications.error("Failed to save preset.");
		}
	},

	async _onDeleteTMFXPreset() {
		const select = this.element.querySelector('[name="tmfxPreset"]');
		const option = select?.options[select.selectedIndex];
		if (!option || !option.value) return;

		const presetName = option.value;
		const library = option.dataset.library;
		const removable = option.dataset.removable === "true";

		if (!removable) {
			ui.notifications.warn("Cannot delete built-in presets.");
			return;
		}

		const confirm = await foundry.applications.api.DialogV2.confirm({
			window: { title: "Delete Preset" },
			content: `<p>Are you sure you want to delete the preset <strong>${presetName}</strong>?</p>`,
		});

		if (!confirm) return;

		try {
			await window.TokenMagic.deletePreset({
				name: presetName,
				library: library,
			});
			ui.notifications.info(`Deleted preset: ${presetName}`);
			this.render();
		}
		catch(err) {
			console.error("SDX | Error deleting TMFX preset:", err);
			ui.notifications.error("Failed to delete preset.");
		}
	},

	async _onRemoveTMFX(filterId) {
		if (!this.pinId) return;
		const graphics = JournalPinRenderer.getPin(this.pinId);
		if (!graphics) return;

		try {
			await window.TokenMagic.deleteFilters(graphics, filterId);
			ui.notifications.info(`Removed filter: ${filterId}`);

			// Force a sync of the graphics object with the database state
			const updatedPin = JournalPinManager.get(this.pinId);
			if (updatedPin) graphics.update(updatedPin);

			// Small delay to ensure flag updates propagate before re-render
			setTimeout(() => this.render(), 100);
		}
		catch(err) {
			console.error(`SDX Pin Editor | Error removing TMFX filter ${filterId}:`, err);
		}
	},

	async _onClearTMFX() {
		if (!this.pinId) return;
		const graphics = JournalPinRenderer.getPin(this.pinId);
		if (!graphics) return;

		try {
			await window.TokenMagic.deleteFilters(graphics);
			ui.notifications.info("Cleared all TokenMagic FX effects.");

			// Force a sync of the graphics object with the database state
			const updatedPin = JournalPinManager.get(this.pinId);
			if (updatedPin) graphics.update(updatedPin);

			// Small delay to ensure flag updates propagate before re-render
			setTimeout(() => this.render(), 100);
		}
		catch(err) {
			console.error("SDX | Error clearing TMFX filters:", err);
		}
	},

	async _onEditTMFXFilter({ filterId, filterType, filterInternalId }) {
		if (!this.pinId) return;
		const pin = JournalPinManager.get(this.pinId);
		if (!pin) return;

		const filterIdentifier = { filterId, filterType, filterInternalId };

		// Create a proxy object that mimics a Foundry Document for TokenMagic
		const proxy = {
			id: pin.id,
			get documentName() {
				return "SDXPin";
			},
			get isOwner() {
				return game.user.isGM;
			},
			getFlag: (scope, key) => {
				if (scope === "tokenmagic" && key === "filters") {
					return pin.flags?.tokenmagic?.filters || [];
				}
				return pin.flags?.[scope]?.[key];
			},
			update: async (data, options) => {
				console.log("SDX Pin Editor | Proxy update called with:", data);

				// Check if this is a TMFX filter parameter update
				// TMFXFilterEditor sends flat params like {rotation: 35, filterId: "...",
				// filterType: "...", filterInternalId: "..."}
				if (data.filterInternalId && data.filterType) {
					// Get the current filters from the pin
					const currentFilters = foundry.utils.deepClone(
						pin.flags?.tokenmagic?.filters || []
					);
					console.log("SDX Pin Editor | Current filters:", currentFilters);

					// Find the filter to update by its internal ID
					// TokenMagic stores filters with nested structure: {tmFilters:
					// {tmFilterInternalId: "..."}}
					// or flat structure: {filterInternalId: "..."}
					const filterIndex = currentFilters.findIndex(f => {
						// Check nested structure first (tmFilters.tmFilterInternalId)
						if (f.tmFilters?.tmFilterInternalId === data.filterInternalId) return true;
						// Check flat structure
						if (f.filterInternalId === data.filterInternalId) return true;
						// Also check tmParams which may contain the filterInternalId
						if (f.tmParams?.filterInternalId === data.filterInternalId) return true;
						return false;
					});

					if (filterIndex >= 0) {
						// Merge the new parameters into the existing filter
						// For nested structure, we need to update tmParams
						const existingFilter = currentFilters[filterIndex];
						let updatedFilter;

						if (existingFilter.tmFilters?.tmParams) {
							// Deeply nested structure: tmFilters.tmParams
							updatedFilter = {
								...existingFilter,
								...data,  // Update top-level properties
								tmFilters: {
									...existingFilter.tmFilters,
									tmParams: foundry.utils.mergeObject(
										existingFilter.tmFilters.tmParams, data
									),
								},
							};
						}
						else if (existingFilter.tmParams) {
							// Nested structure - update BOTH top-level AND tmParams
							updatedFilter = {
								...existingFilter,
								...data,  // Update top-level properties
								// Update tmParams
								tmParams: foundry.utils.mergeObject(existingFilter.tmParams, data),
							};
						}
						else {
							// Flat structure - direct merge
							updatedFilter = { ...existingFilter, ...data };
						}
						currentFilters[filterIndex] = updatedFilter;

						console.log(
							"SDX Pin Editor | Updating filter at index", filterIndex, "with:",
							updatedFilter
						);

						// Use the correct flag format for JournalPinManager.update
						await JournalPinManager.update(pin.id, {
							"flags.tokenmagic.filters": currentFilters,
						});

						// Also update the local pin reference so subsequent calls have fresh data
						if (pin.flags) {
							if (!pin.flags.tokenmagic) pin.flags.tokenmagic = {};
							pin.flags.tokenmagic.filters = currentFilters;
						}
					}
					else {
						console.warn(
							"SDX Pin Editor | Filter not found for update:", data.filterInternalId
						);
						console.warn("SDX Pin Editor | Available filters:", currentFilters.map(f => ({
							tmFilterInternalId: f.tmFilters?.tmFilterInternalId,
							filterInternalId: f.filterInternalId,
							tmParamsFilterInternalId: f.tmParams?.filterInternalId,
						})));
					}
				}
				else {
					// Standard update (non-TMFX data)
					await JournalPinManager.update(pin.id, data);
				}
			},
		};

		const appId = FilterEditor.genId(proxy, filterIdentifier);
		const activeInstance = foundry.applications.instances.get(appId);

		if (activeInstance) {
			activeInstance.close();
		}
		else {
			// Position the editor near the styling app
			const { left, top, width } = this.position;
			new FilterEditor(
				{ document: proxy, filterIdentifier },
				{
					id: appId,
					position: {
						left: left + width + 10,
						top: top,
					},
				}
			).render(true);
		}
	},
};

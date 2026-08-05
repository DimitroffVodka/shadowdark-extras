// Journal pin and map note list bindings — extracted from
// scripts/tray/TrayApp.mjs (Phase 5.3 split). Prototype mixin: the pin list
// and its folders, note entries, the drag-drop that assigns pins to folders,
// the Map-Notes conversion dialog, and the search box together with the
// filter it drives. Merged via Object.assign(TrayApp.prototype, ...).

import { JournalPinManager, JournalPinRenderer } from "../journal/JournalPinsSD.mjs";
import { PinStyleEditorApp } from "../journal/PinStyleEditorSD.mjs";
import { PlaceableNotesSD } from "../journal/PlaceableNotesSD.mjs";

export const PinListBindings = {
	/**
     * Journal pins and map notes: the pin list, its folders, the note
     * entries, drag-drop assignment, and the search box.
     * @param {HTMLElement} elem - The rendered tray root
     */
	_bindPinListEvents(elem) {

		// Pin/Note List Pan Action
		elem.querySelectorAll(".pin-control").forEach(btn => {
			btn.addEventListener("click", async e => {
				e.preventDefault();
				e.stopPropagation();

				const action = btn.dataset.action;
				const entry = btn.closest(".pin-entry");
				const id = entry.dataset.id;

				if (!id) return;

				if (action === "pan") {
					const x = parseFloat(entry.dataset.x);
					const y = parseFloat(entry.dataset.y);
					if (!isNaN(x) && !isNaN(y)) {
						canvas.animatePan({ x, y, scale: 1.5, duration: 500 });
					}
				}
				else if (action === "ping-pin") {
					if (!JournalPinRenderer.getContainer()) return;
					const pin = JournalPinRenderer.getContainer().children.find(
						c => c.pinData?.id === id
					);

					if (game.user.isGM) {
						if (pin && pin.animatePing) pin.animatePing("ping");
						game.socket.emit("module.shadowdark-extras", {
							type: "pingPin",
							sceneId: canvas.scene?.id,
							pinId: id,
						});
					}
					else {
						ui.notifications.warn("Only GM can ping pins.");
					}
				}
				else if (action === "bring-players") {
					const x = parseFloat(entry.dataset.x);
					const y = parseFloat(entry.dataset.y);

					if (game.user.isGM) {
						if (!isNaN(x) && !isNaN(y)) {
							canvas.animatePan({ x, y, scale: 1.5, duration: 500 });
							if (JournalPinRenderer.getContainer()) {
								const pin = JournalPinRenderer.getContainer().children.find(
									c => c.pinData?.id === id
								);
								if (pin && pin.animatePing) pin.animatePing("bring");
							}
							game.socket.emit("module.shadowdark-extras", {
								type: "panToPin",
								x: x,
								y: y,
								sceneId: canvas.scene?.id,
								pinId: id,
							});
						}
					}
					else {
						ui.notifications.warn("Only GM can bring players.");
					}
				}
				else if (action === "edit-pin") {
					const pinData = JournalPinManager.get(id);
					if (pinData) {
						new PinStyleEditorApp({ pinId: id }).render(true);
					}
				}
				else if (action === "toggle-gm-only") {
					const pinData = JournalPinManager.get(id);
					if (pinData) {
						if (game.user.isGM) {
							const current = pinData.gmOnly || false;
							await JournalPinManager.update(id, { gmOnly: !current });
						}
						else {
							ui.notifications.warn("Only GM can toggle visibility.");
						}
					}
				}
				else if (action === "toggle-vision") {
					const pinData = JournalPinManager.get(id);
					if (pinData) {
						if (game.user.isGM) {
							const current = pinData.requiresVision || false;
							await JournalPinManager.update(id, { requiresVision: !current });
						}
						else {
							ui.notifications.warn("Only GM can toggle vision requirement.");
						}
					}
				}
				else if (action === "delete-pin") {
					const confirmed = await foundry.applications.api.DialogV2.confirm({
						window: { title: "Delete Pin" },
						content: "<p>Are you sure you want to delete this pin?</p>",
						modal: true,
					});
					if (confirmed) await JournalPinManager.delete(id);
				}
				else if (action === "copy-style") {
					const pinData = JournalPinManager.get(id);
					if (pinData) {
						JournalPinManager.copyStyle(pinData);
					}
				}
				else if (action === "paste-style") {
					await JournalPinManager.pasteStyle(id);
				}
				else if (action === "duplicate-pin") {
					await JournalPinManager.duplicate(id);
				}
				else if (action === "ungroup-pin") {
					if (game.user.isGM) await JournalPinManager.movePin(id, null);
				}
			});
		});

		// ───────────────────────── PIN FOLDERS (GM) ─────────────────────────
		const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;")
			.replace(/</g, "&lt;").replace(/>/g, "&gt;");

		const promptFolderName = async (title, initial = "") => {
			return foundry.applications.api.DialogV2.prompt({
				window: { title },
				content: `<div class="form-group"><label>Folder Name</label>
                    <input type="text" name="name" value="${esc(initial)}" autofocus></div>`,
				ok: {
					label: "OK",
					callback: (event, button) => button.form.elements.name.value.trim(),
				},
			}).catch(() => null);
		};

		const ICON_DIR = "modules/shadowdark-extras/assets/icons/";
		const FilePickerImpl = foundry.applications.apps.FilePicker?.implementation
			?? globalThis.FilePicker;

		const editFolderDialog = async folderId => {
			const f = JournalPinManager.listFolders().find(x => x.id === folderId);
			if (!f) return;
			const content = `
                <div class="form-group"><label>Name</label>
                    <input type="text" name="name" value="${esc(f.name)}"></div>
                <div class="form-group"><label>Color</label>
                    <input type="color" name="color" value="${esc(f.color || "#85733f")}"></div>
                <div class="form-group"><label>Scope</label>
                    <select name="scope">
                        <option value="scene" ${f.scope !== "world" ? "selected" : ""}>This scene only</option>
                        <option value="world" ${f.scope === "world" ? "selected" : ""}>All scenes (world)</option>
                    </select>
                    <p class="notes">World folders appear on every scene; pins still belong to their own scene.</p></div>
                <div class="form-group"><label>Icon</label>
                    <div class="form-fields">
                        <input type="text" name="icon" value="${esc(f.icon || "")}"
                            placeholder="image path or fa-solid fa-skull">
                        <button type="button" class="sdx-folder-icon-browse" title="Browse Files">
                            <i class="fas fa-file-import fa-fw"></i></button>
                    </div>
                    <p class="notes">Pick an image, or type a FontAwesome class.</p></div>`;

			// Wire the Browse button once the dialog renders (FilePicker starts in assets/icons/)
			Hooks.once("renderDialogV2", (app, html) => {
				const root = html instanceof HTMLElement ? html : (html?.[0] ?? app.element);
				const input = root?.querySelector('[name="icon"]');
				root?.querySelector(".sdx-folder-icon-browse")?.addEventListener("click", () => {
					const cur = (input?.value && input.value.includes("/")) ? input.value : ICON_DIR;
					new FilePickerImpl({
						type: "image",
						current: cur,
						callback: path => {
							if (input) input.value = path;
						},
					}).browse();
				});
			});

			const data = await foundry.applications.api.DialogV2.prompt({
				window: { title: "Edit Folder" },
				content,
				ok: {
					label: "Save", callback: (event, button) => {
						const fm = button.form.elements;
						return {
							name: fm.name.value.trim() || f.name,
							color: fm.color.value || null,
							icon: (fm.icon.value || "").trim() || null,
							scope: fm.scope?.value === "world" ? "world" : "scene",
						};
					},
				},
			}).catch(() => null);
			if (data) await JournalPinManager.updateFolder(folderId, data);
		};

		// New top-level folder
		elem.querySelector(".pin-folder-newbtn[data-action='folder-new']")?.addEventListener("click", async e => {
			e.preventDefault();
			const name = await promptFolderName("New Folder", "New Folder");
			if (name) await JournalPinManager.createFolder({ name });
		});

		// Convert Map Notes -> pins (shared by the toolbar = all, and per-note buttons)
		const runConvertDialog = async (noteIds = null) => {
			const noteCount = noteIds ? noteIds.length : (canvas.scene?.notes?.size ?? 0);
			if (!noteCount) {
				ui.notifications.info("No map notes on this scene to convert."); return;
			}
			const folderOpts = JournalPinManager.listFolders()
				.map(f => `<option value="${esc(f.id)}">${esc(f.name)}${f.scope === "world" ? " (world)" : ""}</option>`)
				.join("");
			const content = `
                <p>Convert <strong>${noteCount}</strong> map note${noteCount === 1 ? "" : "s"} into journal pins.</p>
                <div class="form-group"><label>Target folder</label>
                    <select name="folderId"><option value="">Ungrouped</option>${folderOpts}</select></div>
                <div class="form-group"><label><input type="checkbox" name="deleteOriginals"> Delete the original map note${noteCount === 1 ? "" : "s"} after converting</label></div>`;
			const data = await foundry.applications.api.DialogV2.prompt({
				window: { title: "Convert Map Notes → Pins" },
				content,
				ok: {
					label: "Convert", callback: (event, button) => {
						const fm = button.form.elements;
						return {
							folderId: fm.folderId.value || null,
							deleteOriginals: fm.deleteOriginals.checked,
						};
					},
				},
			}).catch(() => null);
			if (!data) return;
			const res = await JournalPinManager.convertNotesToPins({
				noteIds: noteIds || undefined, folderId: data.folderId,
				deleteOriginals: data.deleteOriginals,
			});
			ui.notifications.info(`Created ${res.created} pin${res.created === 1 ? "" : "s"}${
				res.deleted ? `, removed ${res.deleted} note${res.deleted === 1 ? "" : "s"}.` : "."}`);
		};
		this._runConvertDialog = runConvertDialog;

		elem.querySelector(".pin-folder-newbtn[data-action='convert-notes']")?.addEventListener("click", e => {
			e.preventDefault();
			runConvertDialog(null);
		});

		// Folder header controls + collapse toggle
		elem.querySelectorAll(".pin-folder-header").forEach(header => {
			const folderId = header.dataset.folderId;
			const toggle = async e => {
				e.preventDefault(); e.stopPropagation();
				const f = JournalPinManager.listFolders().find(x => x.id === folderId);
				await JournalPinManager.setFolderCollapsed(folderId, !(f?.collapsed));
			};
			header.querySelector(".pin-folder-caret")?.addEventListener("click", toggle);
			header.querySelector(".pin-folder-name")?.addEventListener("click", toggle);

			header.querySelectorAll(".pin-folder-control").forEach(btn => {
				btn.addEventListener("click", async e => {
					e.preventDefault(); e.stopPropagation();
					const action = btn.dataset.action;
					if (action === "folder-add-child") {
						const name = await promptFolderName("New Subfolder", "New Folder");
						if (name) {
							await JournalPinManager.createFolder({ name, parentId: folderId });
						}
					}
					else if (action === "folder-edit") {
						await editFolderDialog(folderId);
					}
					else if (action === "folder-delete") {
						const ok = await foundry.applications.api.DialogV2.confirm({
							window: { title: "Delete Folder" },
							content: "<p>Delete this folder? Its pins move to <strong>Ungrouped</strong> (pins are not deleted).</p>",
							modal: true,
						});
						if (ok) await JournalPinManager.deleteFolder(folderId);
					}
				});
			});
		});

		// Drag & drop (GM only): assign/reorder pins, re-nest folders
		const pinsList = elem.querySelector(".pins-view .sdx-pin-list:not(.map-notes-list)");
		if (game.user.isGM && pinsList) {
			let drag = null;
			const clearOver = () => pinsList.querySelectorAll(".drag-over").forEach(
				n => n.classList.remove("drag-over")
			);

			pinsList.querySelectorAll(".pin-entry[draggable='true'], .pin-folder-header[draggable='true']").forEach(row => {
				row.addEventListener("dragstart", e => {
					drag = row.classList.contains("pin-folder-header")
						? { type: "folder", id: row.dataset.folderId }
						: { type: "pin", id: row.dataset.id };
					e.dataTransfer.effectAllowed = "move";
					try {
						e.dataTransfer.setData("text/plain", drag.id);
					}
					catch(_) { }
					row.classList.add("sdx-dragging");
				});
				row.addEventListener("dragend", () => {
					row.classList.remove("sdx-dragging"); clearOver(); drag = null;
				});
			});

			pinsList.addEventListener("dragover", e => {
				if (!drag) return;
				e.preventDefault();
				e.dataTransfer.dropEffect = "move";
				clearOver();
				const target = e.target.closest(".pin-folder-header, .pin-entry");
				if (target) target.classList.add("drag-over");
			});
			pinsList.addEventListener("dragleave", e => {
				if (e.target === pinsList) clearOver();
			});

			pinsList.addEventListener("drop", async e => {
				if (!drag) return;
				e.preventDefault();
				clearOver();
				const folderHeader = e.target.closest(".pin-folder-header");
				const pinRow = e.target.closest(".pin-entry");
				const dragged = drag; drag = null;
				try {
					if (dragged.type === "pin") {
						if (folderHeader) {
							await JournalPinManager.movePin(
								dragged.id, folderHeader.dataset.folderId
							);
						}
						else if (pinRow && pinRow.dataset.id !== dragged.id) {
							await JournalPinManager.movePin(
								dragged.id, pinRow.dataset.folderId || null, pinRow.dataset.id
							);
						}
						else if (!folderHeader && !pinRow) {
							await JournalPinManager.movePin(dragged.id, null);
						}
					}
					else if (dragged.type === "folder") {
						if (folderHeader && folderHeader.dataset.folderId !== dragged.id) {
							await JournalPinManager.updateFolder(
								dragged.id, { parentId: folderHeader.dataset.folderId }
							);
						}
						else if (!folderHeader && !pinRow) {
							await JournalPinManager.updateFolder(dragged.id, { parentId: null });
						}
					}
				}
				catch(err) {
					console.error("SDX | pin folder DnD error", err);
				}
			});
		}

		// Note Actions
		elem.querySelectorAll(".note-control").forEach(btn => {
			btn.addEventListener("click", async e => {
				e.preventDefault();
				e.stopPropagation();
				const action = btn.dataset.action;
				const entry = btn.closest(".note-entry");
				const id = entry.dataset.id;
				const type = entry.querySelector(".note-icon i").className.includes("fa-user") ? "Token"
					: entry.querySelector(".note-icon i").className.includes("fa-lightbulb") ? "AmbientLight"
						: entry.querySelector(".note-icon i").className.includes("fa-volume-high") ? "AmbientSound"
							: entry.querySelector(".note-icon i").className.includes("fa-image") ? "Tile"
								: entry.querySelector(".note-icon i").className.includes("fa-block-brick") ? "Wall" : null;

				if (!type) return;

				// Find the document
				let doc;
				if (type === "Token") {
					const token = canvas.tokens.get(id);
					if (token) {
						const tokenDoc = token.document;
						// Check if token has its own note
						const tokenNote = tokenDoc.getFlag("shadowdark-extras", "notes");
						// If token has no note, but actor does, edit the actor's note (matching
						// display logic)
						if (!tokenNote && token.actor && token.actor.getFlag("shadowdark-extras", "notes")) {
							doc = token.actor;
						}
						else {
							doc = tokenDoc;
						}
					}
				}
				else if (type === "AmbientLight") doc = canvas.lighting.get(id)?.document;
				else if (type === "AmbientSound") doc = canvas.sounds.get(id)?.document;
				else if (type === "Tile") doc = canvas.tiles.get(id)?.document;
				else if (type === "Wall") doc = canvas.walls.get(id)?.document;

				if (!doc) return;

				if (action === "pan") {
					const x = parseFloat(entry.dataset.x);
					const y = parseFloat(entry.dataset.y);
					canvas.animatePan({ x, y, scale: 1.5, duration: 500 });
				}
				else if (action === "rename") {
					const currentName = doc.getFlag("shadowdark-extras", "customName") || doc.name || "";
					new foundry.applications.api.DialogV2({
						window: { title: "Rename Placeable Note" },
						content: `
                            <form>
                                <div class="form-group">
                                    <label>Name:</label>
                                    <input type="text" name="name" value="${currentName}" autofocus>
                                </div>
                            </form>
                        `,
						buttons: [
							{
								action: "save",
								label: "Save",
								icon: "fas fa-check",
								default: true,
								callback: async (event, button) => {
									const newName = button.form.elements.name.value;
									await doc.setFlag("shadowdark-extras", "customName", newName);
								},
							},
							{
								action: "reset",
								label: "Reset",
								icon: "fas fa-undo",
								callback: async () => {
									await doc.unsetFlag("shadowdark-extras", "customName");
								},
							},
						],
					}).render({ force: true });
				}
				else if (action === "toggle-visibility") {
					const isVisible = !!doc.getFlag("shadowdark-extras", "noteVisible");
					await doc.setFlag("shadowdark-extras", "noteVisible", !isVisible);
				}
				else if (action === "delete") {
					const ok = await foundry.applications.api.DialogV2.confirm({
						window: { title: "Delete Note" },
						content: `<p>Are you sure you want to delete the note for <strong>${doc.name}</strong>?</p>`,
						modal: true,
					});
					if (ok) {
						await doc.unsetFlag("shadowdark-extras", "notes");
						await doc.unsetFlag("shadowdark-extras", "noteVisible");
					}
				}
			});
		});

		// Note Toggle Action
		elem.querySelectorAll(".note-header").forEach(header => {
			header.addEventListener("click", e => {
				// Don't toggle if clicking a control button
				if (e.target.closest(".note-controls")) return;

				e.preventDefault();
				e.stopPropagation();
				const entry = header.closest(".note-entry");
				const content = entry.querySelector(".note-content");
				if (content) {
					content.classList.toggle("hidden");
					const icon = header.querySelector(".toggle-icon i");
					if (icon) {
						icon.classList.toggle("fa-chevron-right");
						icon.classList.toggle("fa-chevron-down");
					}
				}
			});
		});

		// Note Entry Context Menu (Edit)
		elem.querySelectorAll(".note-entry").forEach(entry => {
			entry.addEventListener("contextmenu", e => {
				if (!game.user.isGM) return;
				e.preventDefault();
				e.stopPropagation();

				const id = entry.dataset.id;
				const type = entry.querySelector(".note-icon i").className.includes("fa-user") ? "Token"
					: entry.querySelector(".note-icon i").className.includes("fa-lightbulb") ? "AmbientLight"
						: entry.querySelector(".note-icon i").className.includes("fa-volume-high") ? "AmbientSound"
							: entry.querySelector(".note-icon i").className.includes("fa-image") ? "Tile"
								: entry.querySelector(".note-icon i").className.includes("fa-block-brick") ? "Wall" : null;

				if (!type) return;

				// Find the document
				let doc;
				if (type === "Token") {
					const token = canvas.tokens.get(id);
					if (token) {
						const tokenDoc = token.document;
						// Check if token has its own note
						const tokenNote = tokenDoc.getFlag("shadowdark-extras", "notes");
						// If token has no note, but actor does, edit the actor's note (matching
						// display logic)
						if (!tokenNote && token.actor && token.actor.getFlag("shadowdark-extras", "notes")) {
							doc = token.actor;
						}
						else {
							doc = tokenDoc;
						}
					}
				}
				else if (type === "AmbientLight") doc = canvas.lighting.get(id)?.document;
				else if (type === "AmbientSound") doc = canvas.sounds.get(id)?.document;
				else if (type === "Tile") doc = canvas.tiles.get(id)?.document;
				else if (type === "Wall") doc = canvas.walls.get(id)?.document;

				if (!doc) return;

				new PlaceableNotesSD(doc).render(true);
			});
		});

		// Map Note Actions
		elem.querySelectorAll(".map-note-control").forEach(btn => {
			btn.addEventListener("click", async e => {
				e.preventDefault();
				e.stopPropagation();

				const action = btn.dataset.action;
				const entry = btn.closest(".map-note-entry");
				const id = entry.dataset.id;
				const uuid = entry.dataset.uuid;

				if (!id) return;

				if (action === "pan") {
					const x = parseFloat(entry.dataset.x);
					const y = parseFloat(entry.dataset.y);
					if (!isNaN(x) && !isNaN(y)) {
						canvas.animatePan({ x, y, scale: 1.5, duration: 500 });
					}
				}
				else if (action === "delete") {
					const note = fromUuidSync(uuid);
					if (!note) return;

					const ok = await foundry.applications.api.DialogV2.confirm({
						window: { title: "Delete Map Note" },
						content: `<p>Are you sure you want to delete the map note <strong>${note.text || note.name}</strong>?</p>`,
						modal: true,
					});
					if (ok) await note.delete();
				}
				else if (action === "open") {
					const note = fromUuidSync(uuid);
					if (note) note.sheet.render(true);
				}
				else if (action === "convert") {
					await runConvertDialog([id]);
				}
			});
		});

		// Pin Search Input
		const searchInput = elem.querySelector(".pin-search-input");
		if (searchInput) {
			// Restore focus if we re-rendered and input was focused (simple heuristic)
			// But actually ApplicationV2 re-renders the whole thing, so focus is lost.
			// We can rely on value={pinSearchTerm} to restore value,
			// but for smooth typing we might want to avoid full re-render on every keystroke if
			// possible,
			// or just use client-side filtering without re-render.

			// We will use client-side filtering for better performance (no re-render)
			searchInput.addEventListener("input", e => {
				e.preventDefault();
				const term = e.target.value;
				this._pinSearchTerm = term;
				this._filterPins(term);
			});

			// Initial filter application (in case of re-render with existing term)
			if (this._pinSearchTerm) {
				this._filterPins(this._pinSearchTerm);
			}
		}
	},

	/**
     * Filter the pin list based on search term
     * @param {string} term
     */
	_filterPins(term) {
		const elem = document.querySelector(".sdx-tray");
		if (!elem) return;
		const lowerTerm = (term || "").toLowerCase().trim();

		// Map-note entries: simple name filter (unchanged behavior)
		elem.querySelectorAll(".map-notes-list .pin-entry").forEach(entry => {
			const name = entry.querySelector(".pin-name")?.textContent.toLowerCase() || "";
			entry.style.display = (!lowerTerm || name.includes(lowerTerm)) ? "" : "none";
		});

		const pinsList = elem.querySelector(".pins-view .sdx-pin-list:not(.map-notes-list)");
		if (!pinsList) return;
		const pinRows = pinsList.querySelectorAll(".pin-entry");
		const folderRows = pinsList.querySelectorAll(".pin-folder-header");

		if (!lowerTerm) {
			// Restore collapse-based visibility (clear inline display; CSS .sdx-row-hidden handles
			// collapse)
			pinRows.forEach(r => {
				r.style.display = "";
			});
			folderRows.forEach(r => {
				r.style.display = "";
			});
			return;
		}

		// Match pins; reveal matches even inside collapsed folders (inline display wins over CSS).
		const matchedAncestors = new Set();
		pinRows.forEach(entry => {
			const name = entry.querySelector(".pin-name")?.textContent.toLowerCase() || "";
			const page = entry.querySelector(".pin-page-name")?.textContent.toLowerCase() || "";
			const match = name.includes(lowerTerm) || page.includes(lowerTerm);
			entry.style.display = match ? "flex" : "none";
			if (match) (entry.dataset.ancestors || "").split(" ").filter(Boolean).forEach(a => matchedAncestors.add(a));
		});
		// A folder is shown only if it is an ancestor of a matched pin.
		folderRows.forEach(f => {
			f.style.display = matchedAncestors.has(f.dataset.folderId) ? "flex" : "none";
		});
	},
};

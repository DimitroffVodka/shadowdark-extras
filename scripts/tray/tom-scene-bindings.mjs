// Theatre of the Mind scenes tab bindings — extracted from
// scripts/tray/TrayApp.mjs (Phase 5.3 split). Prototype mixin: scene and
// folder CRUD, broadcast control, and the drag-drop that files scenes into
// folders. _promptFolderName travels with them because both this tab and
// tom-panels.mjs open that dialog. Merged onto TrayApp.prototype.

import { FEATURE_IDS, isFeatureEnabled } from "../settings/feature-gates.mjs";

export const TomSceneBindings = {
	/**
     * Theatre of the Mind scenes tab: scene and folder CRUD, broadcast
     * control, and the drag-drop that files scenes into folders.
     * @param {HTMLElement} elem - The rendered tray root
     */
	_bindTomSceneEvents(elem) {
		const sceneEditorEnabled = isFeatureEnabled(FEATURE_IDS.TOM_SCENE_EDITOR);
		const playerViewEnabled = isFeatureEnabled(FEATURE_IDS.TOM_PLAYER_VIEW);
		const editorElement = selector => sceneEditorEnabled ? elem.querySelector(selector) : null;
		const playerElement = selector => playerViewEnabled ? elem.querySelector(selector) : null;
		const editorElements = selector => sceneEditorEnabled ? elem.querySelectorAll(selector) : [];
		if (!sceneEditorEnabled) {
			elem.querySelectorAll([
				"[data-action='create-scene']",
				"[data-action='create-folder']",
				"[data-action='rename-folder']",
				"[data-action='delete-folder']",
				"[data-action='edit-scene']",
				"[data-action='delete-scene']",
			].join(",")).forEach(control => control.remove());
		}

		/* ------------------------------------------- */
		/*  SCENES TAB ACTIONS                        */
		/* ------------------------------------------- */

		// Create Scene
		editorElement("[data-action='create-scene']")?.addEventListener("click", async e => {
			e.preventDefault();
			const { TomSceneEditor } = await import("../tom/TomEditors.mjs");
			new TomSceneEditor().render(true);
		});

		// Create Folder
		editorElement("[data-action='create-folder']")?.addEventListener("click", async e => {
			e.preventDefault();
			const name = await this._promptFolderName("Create Folder", "New Folder");
			if (!name) return;
			const { TomStore } = await import("../tom/TomStore.mjs");
			TomStore.createFolder(name);
			this.render();
		});

		// Stop Broadcast (Header Button)
		playerElement("[data-action='stop-broadcast']")?.addEventListener("click", async e => {
			e.preventDefault();
			const { TomSocketHandler } = await import("../tom/TomSocketHandler.mjs");
			const { TomStore } = await import("../tom/TomStore.mjs");
			const activeSceneId = TomStore.activeSceneId;
			const activeScene = activeSceneId ? TomStore.scenes.get(activeSceneId) : null;
			const outAnimation = activeScene?.outAnimation || "fade";
			TomSocketHandler.emitStopBroadcast(outAnimation);
		});

		// Inlined Overlay Controls — multi-select toggle.
		// Each item toggles itself; Clear removes all. Header toggles collapse.
		elem.querySelector("[data-action='tom-overlays-toggle']")?.addEventListener("click", e => {
			// Clear click must not toggle the section.
			if (e.target.closest("[data-action='tom-overlay-clear']")) return;
			e.preventDefault();
			this._tomOverlaysCollapsed = !this._tomOverlaysCollapsed;
			try {
				globalThis.localStorage?.setItem("sdx.tomOverlaysCollapsed", String(this._tomOverlaysCollapsed));
			}
			catch{ /* no-op */ }
			this.render();
		});
		// Clear all must not bubble to the toggle handler above.
		elem.querySelector("[data-action='tom-overlay-clear']")?.addEventListener("click", async e => {
			e.preventDefault();
			e.stopPropagation();
			const { TomSocketHandler } = await import("../tom/TomSocketHandler.mjs");
			TomSocketHandler.emitOverlayClear();
			// Optimistic UI: dim until TomStore propagates
			e.currentTarget?.classList.add("disabled");
			if (e.currentTarget && "disabled" in e.currentTarget) e.currentTarget.disabled = true;
		});
		elem.querySelectorAll("[data-action='tom-overlay-toggle']").forEach(btn => {
			btn.addEventListener("click", async e => {
				e.preventDefault();
				const path = e.currentTarget?.dataset?.overlayPath
					|| btn.dataset.overlayPath
					|| e.currentTarget?.getAttribute?.("data-overlay-path");
				if (!path) return;
				const { TomSocketHandler } = await import("../tom/TomSocketHandler.mjs");
				TomSocketHandler.emitOverlayToggle(path);
			});
		});
		// Back-compat: old tray dom used tom-overlay-set as a single-select
		// click. Map it to toggle so stale callers stack correctly.n't break — map to the same toggle for now.
		elem.querySelectorAll("[data-action='tom-overlay-set']").forEach(btn => {
			btn.addEventListener("click", async e => {
				e.preventDefault();
				const path = e.currentTarget?.dataset?.overlayPath
					|| btn.dataset.overlayPath
					|| e.currentTarget?.getAttribute?.("data-overlay-path");
				if (!path) return;
				const { TomSocketHandler } = await import("../tom/TomSocketHandler.mjs");
				TomSocketHandler.emitOverlayToggle(path);
			});
		});

		// Folder Actions
		elem.querySelectorAll("[data-action='toggle-folder']").forEach(header => {
			header.addEventListener("click", async e => {
				// Don't toggle if clicking an action button inside the header
				if (e.target.closest("[data-action='rename-folder']") || e.target.closest("[data-action='delete-folder']")) return;
				e.preventDefault();
				const folderId = header.dataset.folderId;
				const { TomStore } = await import("../tom/TomStore.mjs");
				TomStore.toggleFolderCollapsed(folderId);
				this.render();
			});
		});

		editorElements("[data-action='rename-folder']").forEach(btn => {
			btn.addEventListener("click", async e => {
				e.preventDefault();
				e.stopPropagation();
				const folderId = btn.dataset.folderId;
				const currentName = btn.dataset.folderName;
				const newName = await this._promptFolderName("Rename Folder", currentName);
				if (!newName) return;
				const { TomStore } = await import("../tom/TomStore.mjs");
				TomStore.renameFolder(folderId, newName);
				this.render();
			});
		});

		editorElements("[data-action='delete-folder']").forEach(btn => {
			btn.addEventListener("click", async e => {
				e.preventDefault();
				e.stopPropagation();
				const folderId = btn.dataset.folderId;
				const folderName = btn.dataset.folderName;
				const confirmed = await foundry.applications.api.DialogV2.confirm({
					window: { title: "Delete Folder" },
					content: `<p>Delete folder <strong>${folderName}</strong>?</p><p>Scenes inside will become uncategorized.</p>`,
					modal: true,
				});
				if (!confirmed) return;
				const { TomStore } = await import("../tom/TomStore.mjs");
				TomStore.deleteFolder(folderId);
			});
		});

		// Drag-drop onto folders and uncategorized container
		editorElements(".scene-folder, .scene-uncat-container").forEach(dropZone => {
			const folderId = dropZone.dataset.folderId || null;

			dropZone.addEventListener("dragover", e => {
				e.preventDefault();
				e.dataTransfer.dropEffect = "move";
				dropZone.classList.add("drag-over");
			});
			dropZone.addEventListener("dragleave", e => {
				if (!dropZone.contains(e.relatedTarget)) {
					dropZone.classList.remove("drag-over");
				}
			});
			dropZone.addEventListener("drop", async e => {
				e.preventDefault();
				e.stopPropagation();
				dropZone.classList.remove("drag-over");

				const draggedSceneId = e.dataTransfer.getData("text/plain");
				if (!draggedSceneId) return;

				// Check if this is a reorder within the same container or a folder move
				const targetCard = e.target.closest(".scene-card");
				const targetFolderId = folderId || null;

				const { TomStore } = await import("../tom/TomStore.mjs");
				const draggedScene = TomStore.scenes.get(draggedSceneId);
				if (!draggedScene) return;

				const currentFolderId = draggedScene.folderId || null;

				if (currentFolderId !== targetFolderId) {
					// Moving to a different folder
					TomStore.moveSceneToFolder(draggedSceneId, targetFolderId);
				}
				else if (targetCard) {
					// Same folder — reorder
					const targetId = targetCard.dataset.sceneId;
					if (draggedSceneId === targetId) return;

					const currentScenes = Array.from(TomStore.scenes.values());
					const sceneIds = currentScenes.map(s => s.id);
					const draggedIndex = sceneIds.indexOf(draggedSceneId);
					const targetIndex = sceneIds.indexOf(targetId);
					if (draggedIndex === -1 || targetIndex === -1) return;

					sceneIds.splice(draggedIndex, 1);
					sceneIds.splice(targetIndex, 0, draggedSceneId);
					TomStore.reorderScenes(sceneIds);
				}
			});
		});

		// Scene Card Actions
		elem.querySelectorAll(".scene-card").forEach(card => {
			const sceneId = card.dataset.sceneId;

			// Activate Scene (Broadcast) - Clicking the thumbnail/name
			(playerViewEnabled ? card.querySelector(".scene-card-activate") : null)?.addEventListener("click", async e => {
				e.preventDefault();
				e.stopPropagation();
				const { TomSocketHandler } = await import("../tom/TomSocketHandler.mjs");
				const { TomStore } = await import("../tom/TomStore.mjs");
				const scene = TomStore.scenes.get(sceneId);
				const inAnimation = scene?.inAnimation || "fade";
				TomSocketHandler.emitBroadcastScene(sceneId, inAnimation);
			});

			// Edit Scene
			card.querySelector("[data-action='edit-scene']")?.addEventListener("click", async e => {
				e.preventDefault();
				e.stopPropagation();
				const { TomSceneEditor } = await import("../tom/TomEditors.mjs");
				new TomSceneEditor(sceneId).render(true);
			});

			// Delete Scene
			card.querySelector("[data-action='delete-scene']")?.addEventListener("click", async e => {
				e.preventDefault();
				e.stopPropagation();
				const sceneName = card.querySelector(".scene-name").textContent;

				const confirmed = await foundry.applications.api.DialogV2.confirm({
					window: { title: "Delete Scene" },
					content: `<p>Are you sure you want to delete <strong>${sceneName}</strong>?</p><p>This action cannot be undone.</p>`,
					modal: true,
				});

				if (confirmed) {
					const { TomStore } = await import("../tom/TomStore.mjs");
					TomStore.deleteItem(sceneId, "scene");
					ui.notifications.info(`Scene \"${sceneName}\" deleted.`);
				}
			});
			if (!sceneEditorEnabled) return;

			// Drag and Drop — set data for folder-level drop handler
			card.addEventListener("dragstart", e => {
				e.stopPropagation();
				card.classList.add("dragging");
				e.dataTransfer.effectAllowed = "move";
				e.dataTransfer.setData("text/plain", sceneId);
			});

			card.addEventListener("dragend", e => {
				e.stopPropagation();
				card.classList.remove("dragging");
				elem.querySelectorAll(".scene-card").forEach(c => c.classList.remove("drag-over"));
				elem.querySelectorAll(".scene-folder, .scene-uncat-container").forEach(
					z => z.classList.remove("drag-over")
				);
			});

			card.addEventListener("dragover", e => {
				e.preventDefault();
				e.stopPropagation();
				e.dataTransfer.dropEffect = "move";
				const draggingCard = elem.querySelector(".scene-card.dragging");
				if (draggingCard && draggingCard !== card) {
					card.classList.add("drag-over");
				}
			});

			card.addEventListener("dragleave", e => {
				e.stopPropagation();
				if (!card.contains(e.relatedTarget)) {
					card.classList.remove("drag-over");
				}
			});
		});
	},

	async _promptFolderName(title, defaultName = "") {
		return new Promise(resolve => {
			const dialog = new foundry.applications.api.DialogV2({
				window: { title },
				content: `<div class="form-group"><label>Folder Name</label><input type="text" name="folderName" value="${defaultName}" autofocus></div>`,
				buttons: [
					{
						action: "ok",
						icon: "fas fa-check",
						label: "OK",
						default: true,
						callback: (event, button) => {
							const name = button.form.elements.folderName.value?.trim();
							resolve(name || null);
						},
					},
					{
						action: "cancel",
						icon: "fas fa-times",
						label: "Cancel",
						callback: () => resolve(null),
					},
				],
				close: () => resolve(null),
			});
			dialog.render({ force: true }).then(() => {
				dialog.element.querySelector('[name="folderName"]')?.select();
			});
		});
	},
};

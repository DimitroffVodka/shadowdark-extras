// TOM panel methods — extracted from scripts/tray/TrayApp.mjs (Phase 5.1 split).
// Prototype-mixin object: overlay/cast/scene panels for the Theatre of the
// Mind workflow. TrayApp merges these onto its prototype via
// Object.assign(TrayApp.prototype, TomPanels).

export const TomPanels = {
	/* ═══════════════════════════════════════════════════════════════
       TOM SCENE SWITCHER (Quick scene switching during broadcast)
       ═══════════════════════════════════════════════════════════════ */


	/**
     * Handle broadcast stop — refresh UI to hide overlay manager
     */
	onBroadcastStopped() {
		this._tomActiveSceneId = null;
		this.render();
	},


	// Cast manager button has been removed


	/**
     * Hide the Tom cast manager button
     */
	hideTomCastManager() {
		const btn = document.querySelector(".tom-cast-manager-btn");
		if (btn) btn.remove();

		const panel = document.querySelector(".tom-cast-manager-panel");
		if (panel) panel.remove();
	},



	/**
     * Toggle the overlay manager panel
     */
	async _toggleTomOverlayPanel() {
		// Close other panels first
		document.querySelector(".tom-scene-switcher-panel")?.remove();
		document.querySelector(".tom-cast-manager-panel")?.remove();

		const existingPanel = document.querySelector(".tom-overlay-manager-panel");
		if (existingPanel) {
			existingPanel.remove();
			return;
		}

		// Available overlays (hardcoded for now, could be made dynamic)
		const overlays = [
			{ name: "Fire", file: "fire.webm" },
			{ name: "Snow", file: "snow.webm" },
			{ name: "Wind", file: "wind.webm" },
			{ name: "Rain", file: "rain.webm" },
			{ name: "Dust", file: "dust.webm" },
			{ name: "Campfire", file: "campfire.webm" },
			{ name: "Burning", file: "burning.webm" },
			{ name: "Gold", file: "gold.webm" },
			{ name: "Purple", file: "purple.webm" },
			{ name: "Light", file: "light.webm" },
			{ name: "Storm", file: "storm.webm" },
			{ name: "Fog", file: "fog.webm" },
			{ name: "Gente Snow", file: "gentlesnow.mp4" },
			{ name: "Light Rain", file: "lightrain.mp4" },
			{ name: "Slow Snow", file: "slowsnow.mp4" },
			{ name: "Light Snow", file: "lightsnow.mp4" },
			{ name: "Blue Rays", file: "bluerays.mp4" },
			{ name: "Embers", file: "embers.mp4" },
			{ name: "Sparks", file: "sparks.mp4" },
			{ name: "Glow", file: "aurora.mp4" },

		];

		const basePath = "modules/shadowdark-extras/assets/Tom/overlays/";

		// Get current overlay from TomStore
		const { TomStore } = await import("../tom/TomStore.mjs");
		const currentOverlay = TomStore.currentOverlay;

		// Create panel
		const panel = document.createElement("div");
		panel.className = "tom-overlay-manager-panel";

		// Header
		const header = document.createElement("div");
		header.className = "tom-overlay-header";
		header.innerHTML = "<span><i class=\"fas fa-film\"></i> Video Overlays</span>";
		panel.appendChild(header);

		// Clear overlay button
		const clearBtn = document.createElement("button");
		clearBtn.className = `tom-overlay-clear-btn ${!currentOverlay ? "disabled" : ""}`;
		clearBtn.innerHTML = '<i class="fas fa-times"></i> Clear Overlay';
		clearBtn.disabled = !currentOverlay;
		clearBtn.addEventListener("click", async (e) => {
			e.preventDefault();
			e.stopPropagation();
			const { TomSocketHandler } = await import("../tom/TomSocketHandler.mjs");
			TomSocketHandler.emitOverlayClear();
			panel.remove();
			this._toggleTomOverlayPanel(); // Refresh panel
		});
		panel.appendChild(clearBtn);

		// Build overlay list
		const list = document.createElement("div");
		list.className = "tom-overlay-list";

		for (const overlay of overlays) {
			const overlayPath = basePath + overlay.file;
			const isActive = currentOverlay === overlayPath;

			const item = document.createElement("div");
			item.className = `tom-overlay-item ${isActive ? "active" : ""}`;
			item.dataset.path = overlayPath;

			// Preview thumbnail (use video poster or just colored box)
			const preview = document.createElement("div");
			preview.className = "tom-overlay-preview";
			preview.innerHTML = "<i class=\"fas fa-play\"></i>";

			// Name
			const name = document.createElement("div");
			name.className = "tom-overlay-name";
			name.textContent = overlay.name;

			// Active indicator
			if (isActive) {
				const indicator = document.createElement("div");
				indicator.className = "tom-overlay-active-indicator";
				indicator.innerHTML = '<i class="fas fa-check"></i>';
				item.appendChild(indicator);
			}

			item.appendChild(preview);
			item.appendChild(name);
			list.appendChild(item);

			// Click handler
			item.addEventListener("click", async (e) => {
				e.preventDefault();
				e.stopPropagation();

				const { TomSocketHandler } = await import("../tom/TomSocketHandler.mjs");

				if (isActive) {
					// Clicking active overlay clears it
					TomSocketHandler.emitOverlayClear();
				}
				else {
					// Set new overlay
					TomSocketHandler.emitOverlaySet(overlayPath);
				}

				panel.remove();
				this._toggleTomOverlayPanel(); // Refresh panel
			});
		}

		panel.appendChild(list);

		// Position panel next to button
		const btn = document.querySelector(".tray-handle-button-tool[data-action='tom-overlay-manager']");
		if (btn) {
			const rect = btn.getBoundingClientRect();
			panel.style.position = "fixed";
			panel.style.left = `${rect.right + 10}px`;
			panel.style.top = `${rect.top}px`;
		}

		document.body.appendChild(panel);

		// Close on click outside
		const closeHandler = (e) => {
			if (!panel.contains(e.target) && !e.target.closest(".tray-handle-button-tool[data-action='tom-overlay-manager']")) {
				panel.remove();
				document.removeEventListener("click", closeHandler);
			}
		};
		setTimeout(() => document.addEventListener("click", closeHandler), 10);
	},


	/**
     * Toggle the cast manager panel
     */
	async _toggleTomCastPanel() {
		// Close other panels first
		document.querySelector(".tom-scene-switcher-panel")?.remove();
		document.querySelector(".tom-overlay-manager-panel")?.remove();

		const existingPanel = document.querySelector(".tom-cast-manager-panel");
		if (existingPanel) {
			existingPanel.remove();
			return;
		}

		// Get Tom data from store
		const { TomStore } = await import("../tom/TomStore.mjs");
		const scene = this._tomActiveSceneId ? TomStore.scenes.get(this._tomActiveSceneId) : null;
		const broadcasting = !!scene;

		// Characters are no longer managed through Tom


		// Create panel
		const panel = document.createElement("div");
		panel.className = "tom-cast-manager-panel";

		// Header — shows scene name only while broadcasting
		const header = document.createElement("div");
		header.className = "tom-cast-header";
		if (broadcasting) {
			header.innerHTML = `<span><i class="fas fa-users"></i> Manage Cast</span><span class="tom-cast-scene-name">${scene.name}</span>`;
		}
		else {
			header.innerHTML = "<span><i class=\"fas fa-users\"></i> Characters</span>";
		}
		panel.appendChild(header);

		// Character creation has been removed


		// Character list has been removed


		// Position panel next to button
		const btn = document.querySelector(".tom-cast-manager-btn");
		if (btn) {
			const rect = btn.getBoundingClientRect();
			panel.style.position = "fixed";
			panel.style.left = `${rect.right + 10}px`;
			panel.style.top = `${rect.top}px`;
		}

		document.body.appendChild(panel);

		// Close on click outside
		const closeHandler = (e) => {
			if (!panel.contains(e.target) && !e.target.closest(".tom-cast-manager-btn")) {
				panel.remove();
				document.removeEventListener("click", closeHandler);
			}
		};
		setTimeout(() => document.addEventListener("click", closeHandler), 10);
	},


	/**
     * Refresh the cast manager panel if it is open
     */
	refreshTomCastPanel() {
		if (document.querySelector(".tom-cast-manager-panel")) {
			this._toggleTomCastPanel(); // This will close it
			this._toggleTomCastPanel(); // This will open it again (refreshing data)
		}
	},


	/**
     * Update the active scene highlight in the panel
     * @param {string} sceneId - New active scene ID
     */
	updateTomSceneSwitcher(sceneId) {
		this._tomActiveSceneId = sceneId;

		// Update highlight if panel is open
		const panel = document.querySelector(".tom-scene-switcher-panel");
		if (panel) {
			panel.querySelectorAll(".tom-switcher-scene").forEach(item => {
				item.classList.toggle("active", item.dataset.sceneId === sceneId);
			});
		}
	},


	/**
     * Toggle the scene switcher panel
     */
	async _toggleTomScenePanel() {
		// Close other panels first
		document.querySelector(".tom-cast-manager-panel")?.remove();
		document.querySelector(".tom-overlay-manager-panel")?.remove();

		const existingPanel = document.querySelector(".tom-scene-switcher-panel");
		if (existingPanel) {
			existingPanel.remove();
			return;
		}

		// Get Tom scenes and folders from store
		const { TomStore } = await import("../tom/TomStore.mjs");
		const scenes = Array.from(TomStore.scenes.values());
		const folders = TomStore.folders || [];

		// Create panel
		const panel = document.createElement("div");
		panel.className = "tom-scene-switcher-panel";

		// Create new scene button (always at top)
		const createSceneBtn = document.createElement("button");
		createSceneBtn.className = "tom-switcher-create-btn";
		createSceneBtn.innerHTML = '<i class="fas fa-plus"></i> Create new scene';
		createSceneBtn.addEventListener("click", async (e) => {
			e.preventDefault();
			e.stopPropagation();
			panel.remove();
			const { TomSceneEditor } = await import("../tom/TomEditors.mjs");
			new TomSceneEditor().render(true);
		});
		panel.appendChild(createSceneBtn);

		// Create new folder button
		const createFolderBtn = document.createElement("button");
		createFolderBtn.className = "tom-switcher-create-folder-btn";
		createFolderBtn.innerHTML = '<i class="fas fa-folder-plus"></i> Create new folder';
		createFolderBtn.addEventListener("click", async (e) => {
			e.preventDefault();
			e.stopPropagation();
			const name = await this._promptFolderName("Create Folder", "New Folder");
			if (!name) return;
			TomStore.createFolder(name);
			// Re-open panel to refresh
			panel.remove();
			this._toggleTomScenePanel();
		});
		panel.appendChild(createFolderBtn);

		// Stop Broadcasting button — only shown while actively broadcasting
		if (this._tomActiveSceneId) {
			const stopBtn = document.createElement("button");
			stopBtn.className = "tom-switcher-stop-btn";
			stopBtn.innerHTML = '<i class="fas fa-stop"></i> Stop Broadcasting';
			stopBtn.addEventListener("click", async (e) => {
				e.preventDefault();
				e.stopPropagation();
				panel.remove();

				const { TomSocketHandler } = await import("../tom/TomSocketHandler.mjs");
				const activeScene = TomStore.scenes.get(this._tomActiveSceneId);
				const outAnimation = activeScene?.outAnimation || "fade";
				TomSocketHandler.emitStopBroadcast(outAnimation);
			});
			panel.appendChild(stopBtn);
		}

		// Build scene list container
		const list = document.createElement("div");
		list.className = "tom-switcher-list";

		// Helper to create a scene item element
		const createSceneItem = (scene) => {
			const item = document.createElement("div");
			item.className = `tom-switcher-scene ${scene.id === this._tomActiveSceneId ? "active" : ""}`;
			item.dataset.sceneId = scene.id;
			item.draggable = true;

			// Drag start — store scene ID
			item.addEventListener("dragstart", (e) => {
				e.dataTransfer.setData("text/plain", JSON.stringify({ type: "tom-scene", sceneId: scene.id }));
				e.dataTransfer.effectAllowed = "move";
				item.classList.add("dragging");
			});
			item.addEventListener("dragend", () => {
				item.classList.remove("dragging");
			});

			// Thumbnail
			const thumb = document.createElement("div");
			thumb.className = "tom-switcher-thumb";
			if (scene.background) {
				thumb.style.backgroundImage = `url('${scene.background}')`;
			}

			// Name
			const name = document.createElement("div");
			name.className = "tom-switcher-name";
			name.textContent = scene.name;

			// Arena tag
			if (scene.isArena) {
				const tag = document.createElement("span");
				tag.className = "tom-switcher-tag";
				tag.textContent = "Arena";
				name.appendChild(document.createElement("br"));
				name.appendChild(tag);
			}

			// Playing indicator
			if (scene.id === this._tomActiveSceneId) {
				const indicator = document.createElement("i");
				indicator.className = "fas fa-play tom-switcher-playing";
				thumb.appendChild(indicator);
			}

			// Edit / Delete action buttons
			const actions = document.createElement("div");
			actions.className = "tom-switcher-actions";

			const editBtn = document.createElement("button");
			editBtn.className = "tom-switcher-action-btn tom-switcher-action-edit";
			editBtn.title = "Edit Scene";
			editBtn.innerHTML = '<i class="fas fa-pen-to-square"></i>';
			editBtn.addEventListener("click", async (e) => {
				e.preventDefault();
				e.stopPropagation();
				panel.remove();
				const { TomSceneEditor } = await import("../tom/TomEditors.mjs");
				new TomSceneEditor(scene.id).render(true);
			});

			const deleteBtn = document.createElement("button");
			deleteBtn.className = "tom-switcher-action-btn tom-switcher-action-delete";
			deleteBtn.title = "Delete Scene";
			deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
			deleteBtn.addEventListener("click", async (e) => {
				e.preventDefault();
				e.stopPropagation();
				const confirmed = await foundry.applications.api.DialogV2.confirm({
					window: { title: "Delete Scene" },
					content: `<p>Are you sure you want to delete <strong>${scene.name}</strong>?</p><p>This action cannot be undone.</p>`,
					modal: true,
				});
				if (!confirmed) return;
				panel.remove();
				TomStore.deleteItem(scene.id, "scene");
				ui.notifications.info(`Scene "${scene.name}" deleted.`);
			});

			actions.appendChild(editBtn);
			actions.appendChild(deleteBtn);

			item.appendChild(thumb);
			item.appendChild(name);
			item.appendChild(actions);

			// Click handler — broadcast scene
			item.addEventListener("click", async (e) => {
				e.preventDefault();
				e.stopPropagation();

				if (scene.id === this._tomActiveSceneId) return; // Already playing

				panel.remove();

				const { TomSocketHandler } = await import("../tom/TomSocketHandler.mjs");
				const inAnimation = scene?.inAnimation || "fade";

				if (this._tomActiveSceneId) {
					TomSocketHandler.emitSceneFadeTransition(scene.id);
				}
				else {
					TomSocketHandler.emitBroadcastScene(scene.id, inAnimation);
				}

				this._tomActiveSceneId = scene.id;
			});

			return item;
		};

		// Helper to set up drag-drop on a folder container (accepts scenes)
		const setupFolderDrop = (dropTarget, folderId) => {
			dropTarget.addEventListener("dragover", (e) => {
				e.preventDefault();
				e.dataTransfer.dropEffect = "move";
				dropTarget.classList.add("drag-over");
			});
			dropTarget.addEventListener("dragleave", (e) => {
				// Only remove if leaving the actual target, not entering a child
				if (!dropTarget.contains(e.relatedTarget)) {
					dropTarget.classList.remove("drag-over");
				}
			});
			dropTarget.addEventListener("drop", async (e) => {
				e.preventDefault();
				e.stopPropagation();
				dropTarget.classList.remove("drag-over");
				try {
					const data = JSON.parse(e.dataTransfer.getData("text/plain"));
					if (data.type === "tom-scene" && data.sceneId) {
						TomStore.moveSceneToFolder(data.sceneId, folderId);
						// Refresh panel
						panel.remove();
						this._toggleTomScenePanel();
					}
				}
				catch (err) { /* ignore non-scene drops */ }
			});
		};

		// Render folders with their scenes
		for (const folder of folders) {
			const folderContainer = document.createElement("div");
			folderContainer.className = "tom-switcher-folder";
			folderContainer.dataset.folderId = folder.id;

			// Folder header
			const folderHeader = document.createElement("div");
			folderHeader.className = `tom-switcher-folder-header ${folder.collapsed ? "collapsed" : ""}`;

			const folderChevron = document.createElement("i");
			folderChevron.className = `fas ${folder.collapsed ? "fa-caret-right" : "fa-caret-down"} tom-folder-chevron`;

			const folderIcon = document.createElement("i");
			folderIcon.className = `fas ${folder.collapsed ? "fa-folder" : "fa-folder-open"} tom-folder-icon`;

			const folderName = document.createElement("span");
			folderName.className = "tom-switcher-folder-name";
			folderName.textContent = folder.name;

			const folderCount = document.createElement("span");
			folderCount.className = "tom-switcher-folder-count";
			const sceneCount = TomStore.getScenesInFolder(folder.id).length;
			folderCount.textContent = `(${sceneCount})`;

			// Folder actions
			const folderActions = document.createElement("div");
			folderActions.className = "tom-switcher-folder-actions";

			const renameBtn = document.createElement("button");
			renameBtn.className = "tom-switcher-action-btn";
			renameBtn.title = "Rename Folder";
			renameBtn.innerHTML = '<i class="fas fa-pen"></i>';
			renameBtn.addEventListener("click", async (e) => {
				e.preventDefault();
				e.stopPropagation();
				const newName = await this._promptFolderName("Rename Folder", folder.name);
				if (!newName) return;
				TomStore.renameFolder(folder.id, newName);
				panel.remove();
				this._toggleTomScenePanel();
			});

			const deleteFolderBtn = document.createElement("button");
			deleteFolderBtn.className = "tom-switcher-action-btn tom-switcher-action-delete";
			deleteFolderBtn.title = "Delete Folder";
			deleteFolderBtn.innerHTML = '<i class="fas fa-trash"></i>';
			deleteFolderBtn.addEventListener("click", async (e) => {
				e.preventDefault();
				e.stopPropagation();
				const confirmed = await foundry.applications.api.DialogV2.confirm({
					window: { title: "Delete Folder" },
					content: `<p>Delete folder <strong>${folder.name}</strong>?</p><p>Scenes inside will become uncategorized.</p>`,
					modal: true,
				});
				if (!confirmed) return;
				TomStore.deleteFolder(folder.id);
				panel.remove();
				this._toggleTomScenePanel();
			});

			folderActions.appendChild(renameBtn);
			folderActions.appendChild(deleteFolderBtn);

			folderHeader.appendChild(folderChevron);
			folderHeader.appendChild(folderIcon);
			folderHeader.appendChild(folderName);
			folderHeader.appendChild(folderCount);
			folderHeader.appendChild(folderActions);

			// Toggle collapse on header click
			folderHeader.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				TomStore.toggleFolderCollapsed(folder.id);
				panel.remove();
				this._toggleTomScenePanel();
			});

			folderContainer.appendChild(folderHeader);

			// Folder content (scenes)
			const folderContent = document.createElement("div");
			folderContent.className = "tom-switcher-folder-content";
			if (folder.collapsed) {
				folderContent.style.display = "none";
			}

			const folderScenes = TomStore.getScenesInFolder(folder.id);
			for (const scene of folderScenes) {
				folderContent.appendChild(createSceneItem(scene));
			}

			if (folderScenes.length === 0) {
				const emptyHint = document.createElement("div");
				emptyHint.className = "tom-switcher-folder-empty";
				emptyHint.textContent = "Drag scenes here";
				folderContent.appendChild(emptyHint);
			}

			folderContainer.appendChild(folderContent);

			// Make the entire folder a drop target
			setupFolderDrop(folderContainer, folder.id);

			list.appendChild(folderContainer);
		}

		// Uncategorized scenes (no folderId)
		const uncategorized = scenes.filter(s => !s.folderId);
		if (uncategorized.length > 0 || folders.length > 0) {
			// Only show "Uncategorized" header if folders exist
			if (folders.length > 0) {
				const uncatHeader = document.createElement("div");
				uncatHeader.className = "tom-switcher-uncat-header";
				uncatHeader.textContent = "Uncategorized";
				list.appendChild(uncatHeader);
			}

			const uncatContainer = document.createElement("div");
			uncatContainer.className = "tom-switcher-uncat-container";

			for (const scene of uncategorized) {
				uncatContainer.appendChild(createSceneItem(scene));
			}

			// Uncategorized is also a drop target (to remove from folder)
			setupFolderDrop(uncatContainer, null);

			list.appendChild(uncatContainer);
		}

		// If no scenes at all
		if (scenes.length === 0 && folders.length === 0) {
			const empty = document.createElement("div");
			empty.className = "tom-switcher-empty";
			empty.textContent = "Click above to create a new Scene";
			list.appendChild(empty);
		}

		panel.appendChild(list);

		// Position panel next to button
		const btn = document.querySelector(".tray-handle-button-tool[data-action='tom-scene-switcher']");
		if (btn) {
			const rect = btn.getBoundingClientRect();
			panel.style.position = "fixed";
			panel.style.left = `${rect.right + 10}px`;
			panel.style.top = `${rect.top}px`;
		}

		document.body.appendChild(panel);

		// Close on click outside
		const closeHandler = (e) => {
			if (!panel.contains(e.target) && !e.target.closest(".tray-handle-button-tool[data-action='tom-scene-switcher']")) {
				panel.remove();
				document.removeEventListener("click", closeHandler);
			}
		};
		setTimeout(() => document.addEventListener("click", closeHandler), 10);
	},
};

// Decor-import unit — extracted from scripts/tray/TrayApp.mjs (Phase 5.1 split).
// The decor asset import dialog (DecorImportApp) + its path helpers.

import { reloadDecorAssets, registerDecorAsset } from "../hex/HexPainterSD.mjs";

const { ApplicationV2 } = foundry.applications.api;
const MODULE_ID = "shadowdark-extras";
const DECOR_IMPORT_DESTINATION = "decor";
const DECOR_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"];

function isSupportedDecorImage(file) {
	const lower = String(file?.name || "").toLowerCase();
	return DECOR_IMAGE_EXTENSIONS.some(ext => lower.endsWith(ext));
}

function isSupportedDecorPath(path) {
	const lower = String(path || "").toLowerCase().split("?")[0];
	return DECOR_IMAGE_EXTENSIONS.some(ext => lower.endsWith(ext));
}

function normalizeDecorPathPart(part) {
	return String(part || "")
		.replace(/\\/g, "/")
		.replace(/[<>:"|?*\x00-\x1F]/g, "_")
		.replace(/^\.+$/, "_")
		.trim();
}

function splitDecorRelativePath(file) {
	const raw = file.webkitRelativePath || file.name;
	const parts = raw.split(/[\\/]+/).map(normalizeDecorPathPart).filter(Boolean);
	if (parts.length > 1) parts.shift();
	if (!parts.length) parts.push(normalizeDecorPathPart(file.name) || "decor-image");
	if (parts.length === 1) parts.unshift("Imported");
	return parts;
}

function joinDecorPath(parts) {
	return parts.filter(Boolean).join("/");
}

function withDecorNumericSuffix(filename, index) {
	const dot = filename.lastIndexOf(".");
	if (dot <= 0) return `${filename}-${index}`;
	return `${filename.slice(0, dot)}-${index}${filename.slice(dot)}`;
}

async function ensureDecorDirectory(path) {
	const FP = foundry.applications.apps.FilePicker.implementation;
	const parts = String(path || "").split("/").filter(Boolean);
	let current = "";
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		try {
			await FP.browse("data", current);
		}
		catch{
			await FP.createDirectory("data", current);
		}
	}
}

async function decorFileExists(path) {
	const FP = foundry.applications.apps.FilePicker.implementation;
	const parts = String(path || "").split("/").filter(Boolean);
	const filename = parts.pop();
	const folder = parts.join("/") || DECOR_IMPORT_DESTINATION;
	try {
		const listing = await FP.browse("data", folder);
		return (listing.files || []).some(file => file === path || file.endsWith(`/${filename}`));
	}
	catch{
		return false;
	}
}

async function resolveAvailableDecorUpload(parts) {
	const fileName = parts.at(-1);
	const folderParts = parts.slice(0, -1);
	let candidateName = fileName;
	let candidatePath = `${DECOR_IMPORT_DESTINATION}/${joinDecorPath([...folderParts, candidateName])}`;
	let index = 2;
	while (await decorFileExists(candidatePath)) {
		candidateName = withDecorNumericSuffix(fileName, index++);
		candidatePath = `${DECOR_IMPORT_DESTINATION}/${joinDecorPath([...folderParts, candidateName])}`;
	}
	return {
		folder: joinDecorPath([DECOR_IMPORT_DESTINATION, ...folderParts]),
		filename: candidateName,
	};
}

export class DecorImportApp extends ApplicationV2 {
	static DEFAULT_OPTIONS = {
		id: "sdx-decor-import",
		classes: ["sdx-decor-import"],
		tag: "div",
		window: {
			frame: true,
			positioned: true,
			title: "Add Decor Asset",
			resizable: true,
		},
		position: {
			width: 760,
			height: 620,
		},
	};

	constructor(options = {}) {
		super(options);
		this.files = [];
		this.selected = new Set();
		this.objectUrls = new Map();
		this.importing = false;
		this.sourceMode = "foundry";
		this.foundryPath = "";
		this.webUrl = "";
	}

	async _renderHTML() {
		const container = document.createElement("div");
		container.className = "sdx-decor-import-root";
		return container;
	}

	_replaceHTML(result, content) {
		content.replaceChildren(result);
	}

	async _onRender() {
		this._renderContent();
	}

	async _onClose() {
		for (const url of this.objectUrls.values()) URL.revokeObjectURL(url);
		this.objectUrls.clear();
	}

	_renderContent() {
		const root = this.element.querySelector(".sdx-decor-import-root");
		if (!root) return;
		root.replaceChildren();

		const header = document.createElement("div");
		header.className = "sdx-decor-import-header";

		const tabs = document.createElement("div");
		tabs.className = "sdx-decor-source-tabs";
		for (const [mode, label] of [["foundry", "Foundry Library"], ["local", "Local Upload"], ["web", "Web URL"]]) {
			const tab = document.createElement("button");
			tab.type = "button";
			tab.className = "sdx-decor-source-tab";
			if (this.sourceMode === mode) tab.classList.add("active");
			tab.textContent = label;
			tab.addEventListener("click", () => {
				this.sourceMode = mode;
				this._renderContent();
			});
			tabs.appendChild(tab);
		}

		const intro = document.createElement("p");
		intro.className = "sdx-decor-import-intro";
		intro.textContent = this._getIntroText();

		const controls = document.createElement("div");
		controls.className = "sdx-decor-import-controls";
		if (this.sourceMode === "foundry") this._renderFoundryControls(controls);
		else if (this.sourceMode === "web") this._renderWebControls(controls);
		else this._renderLocalControls(controls);

		header.append(tabs, intro, controls);

		if (this.sourceMode === "local") {
			const status = document.createElement("div");
			status.className = "sdx-decor-import-status";
			status.textContent = this.files.length
				? `${this.files.length} image${this.files.length === 1 ? "" : "s"} ready for preview.`
				: "Choose individual files for one-off imports, or choose a folder for batch browsing.";
			header.appendChild(status);
		}

		const grid = document.createElement("div");
		grid.className = "sdx-decor-import-grid";
		if (this.sourceMode === "local") {
			for (const entry of this.files) grid.appendChild(this._createFileCard(entry));
		}
		else {
			grid.appendChild(this._createServerPreview());
		}

		root.append(header, grid);
	}

	_getIntroText() {
		if (this.sourceMode === "foundry") return "Pick an image already visible to Foundry and add it to the Decor browser.";
		if (this.sourceMode === "web") return "Paste a direct image URL and add it to the Decor browser.";
		return "Choose local files or browse a folder, preview images, then upload only selected decor to Foundry Data/decor.";
	}

	_renderLocalControls(controls) {
		const fileInput = document.createElement("input");
		fileInput.type = "file";
		fileInput.className = "sdx-decor-file-input";
		fileInput.id = "sdx-decor-file-input";
		fileInput.multiple = true;
		fileInput.accept = "image/*";
		fileInput.addEventListener("change", event => this._onFilesSelected(event));

		const folderInput = document.createElement("input");
		folderInput.type = "file";
		folderInput.className = "sdx-decor-folder-input";
		folderInput.id = "sdx-decor-folder-input";
		folderInput.multiple = true;
		folderInput.accept = "image/*";
		folderInput.setAttribute("webkitdirectory", "");
		folderInput.addEventListener("change", event => this._onFilesSelected(event));

		const fileLabel = document.createElement("label");
		fileLabel.className = "sdx-decor-folder-label";
		fileLabel.htmlFor = fileInput.id;
		fileLabel.textContent = "Choose Files";

		const pickerLabel = document.createElement("label");
		pickerLabel.className = "sdx-decor-folder-label";
		pickerLabel.htmlFor = folderInput.id;
		pickerLabel.textContent = "Choose Folder";

		const importButton = document.createElement("button");
		importButton.type = "button";
		importButton.className = "sdx-decor-import-selected";
		importButton.disabled = this.selected.size === 0 || this.importing;
		importButton.textContent = this.importing ? "Importing..." : `Import Selected (${this.selected.size})`;
		importButton.addEventListener("click", () => this._importSelected());

		controls.append(fileLabel, fileInput, pickerLabel, folderInput, importButton);
	}

	_renderFoundryControls(controls) {
		const browseButton = document.createElement("button");
		browseButton.type = "button";
		browseButton.className = "sdx-decor-folder-label";
		browseButton.textContent = "Browse Image";
		browseButton.addEventListener("click", () => this._browseFoundry());

		const browseFolderButton = document.createElement("button");
		browseFolderButton.type = "button";
		browseFolderButton.className = "sdx-decor-folder-label";
		browseFolderButton.textContent = "Browse Folder";
		browseFolderButton.addEventListener("click", () => this._browseFoundryFolder());

		const pathInput = document.createElement("input");
		pathInput.type = "text";
		pathInput.className = "sdx-decor-source-input";
		pathInput.value = this.foundryPath;
		pathInput.placeholder = "decor/path/to/image.webp or decor/folder";
		pathInput.addEventListener("change", event => {
			this.foundryPath = event.currentTarget.value.trim();
			this._renderContent();
		});

		const addButton = document.createElement("button");
		addButton.type = "button";
		addButton.className = "sdx-decor-import-selected";
		addButton.disabled = !isSupportedDecorPath(this.foundryPath);
		addButton.textContent = "Add Image";
		addButton.addEventListener("click", () => this._registerServerAsset(this.foundryPath, "foundry"));

		const addFolderButton = document.createElement("button");
		addFolderButton.type = "button";
		addFolderButton.className = "sdx-decor-import-selected";
		addFolderButton.disabled = !this.foundryPath;
		addFolderButton.textContent = "Add Folder";
		addFolderButton.addEventListener("click", () => this._registerFoundryFolder(this.foundryPath));

		controls.append(browseButton, browseFolderButton, pathInput, addButton, addFolderButton);
	}

	_renderWebControls(controls) {
		const urlInput = document.createElement("input");
		urlInput.type = "url";
		urlInput.className = "sdx-decor-source-input";
		urlInput.value = this.webUrl;
		urlInput.placeholder = "https://example.com/decor.webp";
		urlInput.addEventListener("input", event => {
			this.webUrl = event.currentTarget.value.trim();
			this._renderContent();
		});

		const addButton = document.createElement("button");
		addButton.type = "button";
		addButton.className = "sdx-decor-import-selected";
		addButton.disabled = !this.webUrl;
		addButton.textContent = "Add URL";
		addButton.addEventListener("click", () => this._registerServerAsset(this.webUrl, "web"));

		controls.append(urlInput, addButton);
	}

	_createServerPreview() {
		const path = this.sourceMode === "web" ? this.webUrl : this.foundryPath;
		const wrapper = document.createElement("div");
		wrapper.className = "sdx-decor-source-preview";
		if (!path) {
			wrapper.textContent = this.sourceMode === "web"
				? "Paste a direct image URL to preview it here."
				: "Choose an image from Foundry to preview it here.";
			return wrapper;
		}

		if (this.sourceMode === "foundry" && !isSupportedDecorPath(path)) {
			const icon = document.createElement("i");
			icon.className = "fas fa-folder-open";
			icon.style.fontSize = "36px";
			icon.style.color = "#c9aa58";
			const label = document.createElement("div");
			label.className = "sdx-decor-source-path";
			label.textContent = path;
			const hint = document.createElement("small");
			hint.textContent = "Folder selected. Use Add Folder to register supported images inside it.";
			wrapper.append(icon, label, hint);
			return wrapper;
		}

		const img = document.createElement("img");
		img.src = path;
		img.alt = path.split("/").pop() || "Decor asset";
		const label = document.createElement("div");
		label.className = "sdx-decor-source-path";
		label.textContent = path;
		wrapper.append(img, label);
		return wrapper;
	}

	_createFileCard(entry) {
		const card = document.createElement("button");
		card.type = "button";
		card.className = "sdx-decor-import-card";
		if (this.selected.has(entry.id)) card.classList.add("selected");
		card.title = entry.relativePath;
		const img = document.createElement("img");
		img.src = entry.url;
		img.alt = entry.file.name;
		const label = document.createElement("span");
		label.textContent = entry.file.name;
		const path = document.createElement("small");
		path.textContent = entry.relativePath;
		card.append(img, label, path);
		card.addEventListener("click", () => {
			if (this.selected.has(entry.id)) this.selected.delete(entry.id);
			else this.selected.add(entry.id);
			this._renderContent();
		});
		return card;
	}

	_onFilesSelected(event) {
		for (const url of this.objectUrls.values()) URL.revokeObjectURL(url);
		this.objectUrls.clear();
		this.selected.clear();
		const files = [...(event.currentTarget.files || [])].filter(isSupportedDecorImage);
		this.files = files.map((file, index) => {
			const relativePath = splitDecorRelativePath(file).join("/");
			const url = URL.createObjectURL(file);
			const id = `${index}:${relativePath}:${file.size}`;
			this.objectUrls.set(id, url);
			return { id, file, relativePath, url };
		});
		this._renderContent();
	}

	async _importSelected() {
		if (!game.user?.isGM) {
			ui.notifications.warn("Only GMs can import decor assets.");
			return;
		}
		const selected = this.files.filter(entry => this.selected.has(entry.id));
		if (!selected.length) return;

		this.importing = true;
		this._renderContent();
		try {
			await ensureDecorDirectory(DECOR_IMPORT_DESTINATION);
			let imported = 0;
			const FP = foundry.applications.apps.FilePicker.implementation;
			for (const entry of selected) {
				const relativeParts = splitDecorRelativePath(entry.file);
				const target = await resolveAvailableDecorUpload(relativeParts);
				await ensureDecorDirectory(target.folder);
				const uploadFile = target.filename === entry.file.name
					? entry.file
					: new File([entry.file], target.filename, { type: entry.file.type, lastModified: entry.file.lastModified });
				await FP.upload("data", target.folder, uploadFile, {}, { notify: false });
				imported++;
			}
			await reloadDecorAssets();
			Hooks.callAll("sdx.decorAssetsImported");
			ui.notifications.info(`Imported ${imported} decor asset${imported === 1 ? "" : "s"} to ${DECOR_IMPORT_DESTINATION}/.`);
			this.selected.clear();
		}
		catch(err) {
			console.error(`${MODULE_ID} | Failed to import decor assets:`, err);
			ui.notifications.error(`Failed to import decor assets: ${err?.message || err}`);
		}
		finally {
			this.importing = false;
			this._renderContent();
		}
	}

	_browseFoundry() {
		const FilePicker = foundry.applications.apps.FilePicker?.implementation ?? globalThis.FilePicker;
		new FilePicker({
			type: "image",
			current: isSupportedDecorPath(this.foundryPath)
				? this.foundryPath
				: (this.foundryPath || DECOR_IMPORT_DESTINATION),
			callback: path => {
				this.foundryPath = path;
				this._renderContent();
			},
		}).browse();
	}

	_browseFoundryFolder() {
		const FilePicker = foundry.applications.apps.FilePicker?.implementation ?? globalThis.FilePicker;
		const current = isSupportedDecorPath(this.foundryPath)
			? this.foundryPath.split("/").slice(0, -1).join("/")
			: this.foundryPath;
		new FilePicker({
			type: "folder",
			current: current || DECOR_IMPORT_DESTINATION,
			callback: path => {
				this.foundryPath = path;
				this._renderContent();
			},
		}).browse();
	}

	async _registerServerAsset(path, source) {
		if (!game.user?.isGM) {
			ui.notifications.warn("Only GMs can add decor assets.");
			return;
		}
		try {
			await registerDecorAsset(path, { source });
			Hooks.callAll("sdx.decorAssetsImported");
			ui.notifications.info("Added decor asset to the Decor browser.");
		}
		catch(err) {
			console.error(`${MODULE_ID} | Failed to add decor asset:`, err);
			ui.notifications.error(`Failed to add decor asset: ${err?.message || err}`);
		}
	}

	async _registerFoundryFolder(path) {
		if (!game.user?.isGM) {
			ui.notifications.warn("Only GMs can add decor folders.");
			return;
		}
		const root = String(path || "").replace(/\/+$/, "");
		if (!root) return;

		try {
			const images = await this._scanFoundryFolder(root);
			if (!images.length) {
				ui.notifications.warn("No supported image files found in that folder.");
				return;
			}
			for (const imagePath of images) {
				await registerDecorAsset(imagePath, {
					source: "foundry-folder",
					category: this._decorCategoryForFoundryFolder(root, imagePath),
				});
			}
			await reloadDecorAssets();
			Hooks.callAll("sdx.decorAssetsImported");
			ui.notifications.info(`Added ${images.length} decor asset${images.length === 1 ? "" : "s"} from Foundry folder.`);
		}
		catch(err) {
			console.error(`${MODULE_ID} | Failed to add decor folder:`, err);
			ui.notifications.error(`Failed to add decor folder: ${err?.message || err}`);
		}
	}

	async _scanFoundryFolder(folderPath, out = []) {
		const FP = foundry.applications.apps.FilePicker.implementation;
		const listing = await FP.browse("data", folderPath);
		for (const filePath of listing.files || []) {
			if (DECOR_IMAGE_EXTENSIONS.some(ext => filePath.toLowerCase().split("?")[0].endsWith(ext))) {
				out.push(filePath);
			}
		}
		for (const dir of listing.dirs || []) {
			await this._scanFoundryFolder(dir, out);
		}
		return out;
	}

	_decorCategoryForFoundryFolder(root, imagePath) {
		const cleanRoot = String(root || "").replace(/\/+$/, "");
		const cleanPath = String(imagePath || "");
		const parent = cleanPath.split("/").slice(0, -1).join("/");
		let relative = parent.startsWith(cleanRoot) ? parent.slice(cleanRoot.length).replace(/^\/+/, "") : parent;
		const rootLabel = cleanRoot.split("/").filter(Boolean).pop() || "Foundry Folder";
		return relative ? `${rootLabel}/${relative}` : rootLabel;
	}
}

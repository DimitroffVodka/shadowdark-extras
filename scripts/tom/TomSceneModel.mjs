import { DEFAULT_SCENE_BACKGROUND } from "./tom-defaults.mjs";

export class TomSceneModel {
	constructor(data = {}) {
		this.id = data.id || foundry.utils.randomID();
		this.name = data.name || "New Scene";
		this.type = "scene";
		this.background = data.background || DEFAULT_SCENE_BACKGROUND;
		this.bgType = data.bgType || "image";
		this.isArena = data.isArena || false;
		this.arenaType = data.arenaType || "isometric";
		this.arenaScale = Number.isFinite(data.arenaScale) ? Math.min(5, Math.max(0.25, data.arenaScale)) : 1;
		this.inAnimation = data.inAnimation || "fade";
		this.outAnimation = data.outAnimation || "fade";
		this.folderId = data.folderId || null;
	}

	get thumbnail() {
		return this.background;
	}

	get image() {
		return this.background;
	}

	toJSON() {
		const { id, name, type, background, bgType, isArena, arenaType, arenaScale, inAnimation, outAnimation, folderId } = this;
		const result = {
			id,
			name,
			type,
			background,
			bgType,
			isArena,
			arenaType,
			arenaScale,
			inAnimation,
			outAnimation,
			folderId,
		};
		return result;
	}
}

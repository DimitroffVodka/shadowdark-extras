/**
 * SDX Roller — Group Ability Check Roller for Shadowdark
 *
 * A dialog-style application that lets the GM pick actors,
 * choose an ability, set a DC, and launch a cinematic
 * group roll overlay visible to every connected client.
 */

import {
	getSdxActorAbility,
	isSdxRollAuthority,
} from "./SDXRollerData.mjs";

const MODULE_ID = "shadowdark-extras";

/* ------------------------------------------------------------------ */
/*  Ability map for Shadowdark                                        */
/* ------------------------------------------------------------------ */
const SD_ABILITIES = {
	none: "None",
	str: "SHADOWDARK.ability_strength",
	dex: "SHADOWDARK.ability_dexterity",
	con: "SHADOWDARK.ability_constitution",
	int: "SHADOWDARK.ability_intelligence",
	wis: "SHADOWDARK.ability_wisdom",
	cha: "SHADOWDARK.ability_charisma",
};

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/* ------------------------------------------------------------------ */
/*  SDXRollerApp – configuration window                               */
/* ------------------------------------------------------------------ */
export class SDXRollerApp extends HandlebarsApplicationMixin(ApplicationV2) {

	constructor(options = {}) {
		super(options);
		this._participants = [];    // {uuid, contestant:false}
		this._contestants = [];     // {uuid, contestant:true}
		this._selectedAbility = "str";
		this._dc = 12;
		this._showDc = false;
		this._hideNames = false;
		this._useAverage = false;
		this._customLabel = "";
		this._filter = "";
	}

	/* ---------- Foundry overrides ---------- */

	static DEFAULT_OPTIONS = {
		id: "sdx-roller-app",
		tag: "form",
		classes: ["sdx-roller-window"],
		window: {
			title: "SDX Roller",
			resizable: false,
			controls: [],
		},
		position: {
			width: 380,
			height: "auto",
		},
		actions: {
			roll: SDXRollerApp._onStartRoll,
			cancel: (app) => app.close(),
			"remove-participant": SDXRollerApp._onRemoveParticipant,
			"toggle-favorite": SDXRollerApp._onToggleFavorite, // Note: not in original but good for V2
		},
	};

	static PARTS = {
		main: {
			template: `modules/${MODULE_ID}/templates/sdx-roller.hbs`,
		},
	};

	async _prepareContext(options) {
		const actors = this._getAvailableActors();
		const abilities = Object.entries(SD_ABILITIES).map(([key, label]) => ({
			key,
			label: game.i18n.localize(label),
			selected: key === this._selectedAbility,
		}));
		return {
			actors,
			participants: this._participants.map(p => {
				const a = fromUuidSync(p.uuid);
				return { uuid: p.uuid, name: a?.name ?? "???", img: a?.img ?? "", contestant: false };
			}),
			contestants: this._contestants.map(p => {
				const a = fromUuidSync(p.uuid);
				return { uuid: p.uuid, name: a?.name ?? "???", img: a?.img ?? "", contestant: true };
			}),
			abilities,
			dc: this._dc,
			showDc: this._showDc,
			hideNames: this._hideNames,
			useAverage: this._useAverage,
			customLabel: this._customLabel,
			filter: this._filter,
			isGM: game.user.isGM,
		};
	}

	_onRender(context, options) {
		super._onRender(context, options);
		const el = this.element;

		// Actor portrait clicks → add to participants
		el.querySelectorAll(".sdx-roller-actor-portrait").forEach(img => {
			img.addEventListener("click", ev => {
				const uuid = ev.currentTarget.dataset.uuid;
				if (!this._participants.find(p => p.uuid === uuid) && !this._contestants.find(p => p.uuid === uuid)) {
					this._participants.push({ uuid });
					this.render();
				}
			});
			// Right-click → add as contestant
			img.addEventListener("contextmenu", ev => {
				ev.preventDefault();
				const uuid = ev.currentTarget.dataset.uuid;
				if (!this._contestants.find(p => p.uuid === uuid) && !this._participants.find(p => p.uuid === uuid)) {
					this._contestants.push({ uuid });
					this.render();
				}
			});
		});

		// Ability select
		const abilitySelect = el.querySelector(".sdx-roller-ability-select");
		if (abilitySelect) {
			abilitySelect.addEventListener("change", ev => {
				this._selectedAbility = ev.currentTarget.value;
			});
		}

		// DC
		const dcInput = el.querySelector(".sdx-roller-dc-input");
		if (dcInput) {
			dcInput.addEventListener("change", ev => {
				this._dc = parseInt(ev.currentTarget.value) || 0;
			});
		}

		// Toggles
		this._bindToggle(el, ".sdx-roller-toggle-showdc", "showDc");
		this._bindToggle(el, ".sdx-roller-toggle-hidenames", "hideNames");
		this._bindToggle(el, ".sdx-roller-toggle-useavg", "useAverage");

		// Custom label
		const labelInput = el.querySelector(".sdx-roller-label-input");
		if (labelInput) {
			labelInput.addEventListener("change", ev => {
				this._customLabel = ev.currentTarget.value;
			});
		}

		// Filter search
		const filterInput = el.querySelector(".sdx-roller-filter-input");
		if (filterInput) {
			filterInput.addEventListener("input", ev => {
				this._filter = ev.currentTarget.value;
				this._applyFilter(el);
			});
		}
	}

	/* ---------- Internals ---------- */

	static _onRemoveParticipant(event, target) {
		const uuid = target.dataset.uuid;
		this._participants = this._participants.filter(p => p.uuid !== uuid);
		this._contestants = this._contestants.filter(p => p.uuid !== uuid);
		this.render();
	}

	static _onStartRoll(event, target) {
		this._startRoll();
	}

	_bindToggle(el, selector, prop) {
		const toggle = el.querySelector(selector);
		if (!toggle) return;
		toggle.addEventListener("click", () => {
			const privateProp = `_${prop}`;
			this[privateProp] = !this[privateProp];
			toggle.classList.toggle("active", this[privateProp]);
		});
	}

	_applyFilter(el) {
		const term = this._filter.toLowerCase();
		el.querySelectorAll(".sdx-roller-actor-portrait").forEach(p => {
			const name = (p.dataset.name || "").toLowerCase();
			p.style.display = (!term || name.includes(term)) ? "" : "none";
		});
	}

	_getAvailableActors() {
		const actors = [];
		// All actors on canvas tokens
		const tokenActors = canvas.tokens?.placeables?.map(t => t.actor).filter(Boolean) ?? [];
		// All world actors with player ownership
		const worldPlayerActors = game.actors.filter(a => a.hasPlayerOwner);
		const seen = new Set();
		for (const a of [...tokenActors, ...worldPlayerActors]) {
			if (seen.has(a.uuid)) continue;
			seen.add(a.uuid);
			actors.push({ uuid: a.uuid, name: a.name, img: a.img, type: a.type });
		}
		actors.sort((a, b) => a.name.localeCompare(b.name));
		return actors;
	}

	_startRoll() {
		if (!this._participants.length && !this._contestants.length) {
			ui.notifications.warn("Add at least one participant.");
			return;
		}
		const abilityLabel = game.i18n.localize(SD_ABILITIES[this._selectedAbility]);
		const rollData = {
			actors: this._participants.map(p => p.uuid),
			contestants: this._contestants.map(p => p.uuid),
			ability: this._selectedAbility,
			abilityLabel,
			dc: this._dc,
			showDc: this._showDc,
			hideNames: this._hideNames,
			useAverage: this._useAverage,
			customLabel: this._customLabel,
		};
		// Dispatch via game.socket
		SDXRollerApp.dispatchGroupRoll(rollData);
		this.close();
	}

	/* ------------------------------------------------------------------ */
	/*  Static: socket dispatch                                            */
	/* ------------------------------------------------------------------ */

	static dispatchGroupRoll(rollData) {
		const scopedRollData = {
			...rollData,
			rollId: foundry.utils.randomID(),
			authorityClientId: SDXRollerApp._getClientId(),
		};
		// Show locally
		const overlay = SDXRollerApp._launchOverlay(scopedRollData);
		// Broadcast to others
		game.socket.emit(`module.${MODULE_ID}`, {
			action: "sdxRollerDispatch",
			rollData: scopedRollData,
		});
		return overlay.promise;
	}

	static handleSocketMessage(data) {
		if (data.action === "sdxRollerDispatch") {
			SDXRollerApp._launchOverlay(data.rollData);
		}
		if (data.action === "sdxRollerUpdate") {
			SDXRollerApp._activeOverlay?.handleRemoteUpdate(data.payload);
		}
		if (data.action === "sdxRollerEnd") {
			SDXRollerApp._activeOverlay?.handleRemoteEnd(data.payload);
		}
		if (data.action === "sdxRollerToggle") {
			SDXRollerApp._activeOverlay?.handleRemoteToggle(data.payload);
		}
	}

	static _activeOverlay = null;
	static _clientId = null;

	static _getClientId() {
		SDXRollerApp._clientId ??= foundry.utils.randomID();
		return SDXRollerApp._clientId;
	}

	static _launchOverlay(rollData) {
		const activeOverlay = SDXRollerApp._activeOverlay;
		if (activeOverlay) {
			activeOverlay.cancelRoll().catch(error => {
				console.warn(`${MODULE_ID} | Could not close the replaced SDX roll`, error);
			});
		}
		const overlay = new SDXRollerOverlay(rollData);
		SDXRollerApp._activeOverlay = overlay;
		overlay.render(true);
		return overlay;
	}
}

/* ------------------------------------------------------------------ */
/*  SDXRollerOverlay – full-screen cinematic roll overlay              */
/* ------------------------------------------------------------------ */
export class SDXRollerOverlay extends HandlebarsApplicationMixin(ApplicationV2) {

	constructor(rollData, options = {}) {
		super(options);
		this.rollData = rollData;
		this.actors = rollData.actors.map(uuid => fromUuidSync(uuid)).filter(Boolean);
		this.contestants = rollData.contestants.map(uuid => fromUuidSync(uuid)).filter(Boolean);
		this._results = {};
		this._rolls = {};
		this._messageIds = new Set();
		this._ending = false;
		this._settled = false;

		this._resolve = null;
		this._reject = null;
		this.promise = new Promise((resolve, reject) => {
			this._resolve = resolve;
			this._reject = reject;
		});
	}

	static DEFAULT_OPTIONS = {
		id: "sdx-roller-overlay",
		classes: ["sdx-roller-overlay-app"],
		window: {
			frame: false,
			positioned: false,
		},
		position: {
			width: "100%",
			height: "100%",
		},
	};

	static PARTS = {
		main: {
			template: `modules/${MODULE_ID}/templates/sdx-roller-overlay.hbs`,
		},
	};

	async _prepareContext(options) {
		const showDC = (this.rollData.showDc) || game.user.isGM;
		const label = this.rollData.customLabel
            || this._buildLabel(showDC);
		this._introLabel = label;
		const addMod = (a) => {
			const abilityId = getSdxActorAbility(this.rollData, a.uuid);
			const isNone = abilityId === "none";
			const defaultRollMode = this.rollData.actorRollModes?.[a.uuid] ?? "normal";
			// Shadowdark 4.x: use computed mod from system.abilities
			const mod = isNone ? 0 : (a.system?.abilities?.[abilityId]?.mod ?? 0);
			const modLabel = isNone ? "" : (mod >= 0 ? "+" : "") + mod;
			return {
				uuid: a.uuid,
				name: a.name,
				img: a.img,
				isOwner: a.isOwner,
				mod,
				modLabel,
				abilityShort: this.rollData.actorAbilities && !isNone ? abilityId.toUpperCase() : "",
				hasAdvantage: defaultRollMode === "advantage",
				hasDisadvantage: defaultRollMode === "disadvantage",
			};
		};
		return {
			introLabel: label,
			actors: this.actors.map(addMod),
			contestants: this.contestants.map(addMod),
			options: this.rollData,
			isGM: game.user.isGM,
		};
	}

	_buildLabel(showDC) {
		const abilityLabel = this.rollData.abilityLabel;
		let label = abilityLabel === "None" ? "Roll" : abilityLabel + " Check";
		if (showDC && Number.isFinite(this.rollData.dc) && this.rollData.dc > 0 && !this.contestants.length) {
			label = `DC ${this.rollData.dc} ${label}`;
		}
		return label;
	}

	_onRender(context, options) {
		super._onRender(context, options);
		const el = this.element;
		this._applyBannerImage(el);
		this._runIntroSequence(el);

		// Advantage / Disadvantage toggle buttons
		el.querySelectorAll(".sdx-adv-btn").forEach(btn => {
			btn.addEventListener("click", ev => {
				const tileEl = ev.currentTarget.closest(".sdx-overlay-tile");
				const mode = ev.currentTarget.dataset.mode; // "advantage" or "disadvantage"
				const isActive = ev.currentTarget.classList.contains("sdx-active");

				// Deactivate all adv/dis buttons in this tile first
				tileEl.querySelectorAll(".sdx-adv-btn").forEach(b => b.classList.remove("sdx-active"));

				// Toggle: if it was active, turn off; otherwise activate the clicked one
				if (!isActive) {
					ev.currentTarget.classList.add("sdx-active");
				}
			});
		});

		// Roll buttons
		el.querySelectorAll(".sdx-roll-btn").forEach(btn => {
			btn.addEventListener("click", ev => this._performRoll(ev));
		});

		// Close button (GM only)
		el.querySelector(".sdx-overlay-close")?.addEventListener("click", () => {
			this._broadcastEnd({ abort: true });
		});

		// Manual complete
		el.querySelector(".sdx-overlay-complete")?.addEventListener("click", (ev) => {
			ev.currentTarget.classList.add("sdx-hidden-vis");
			this._broadcastEnd({ button: true });
		});
	}

	/**
     * Use activity-specific artwork for travel rolls while retaining the
     * standard SDX banner as a fallback for empty or missing image paths.
     * @param {HTMLElement} el
     */
	_applyBannerImage(el) {
		const stripe = el?.querySelector(".sdx-overlay-stripe");
		const bannerImage = String(this.rollData.bannerImage ?? "").trim();
		if (!stripe || !bannerImage) return;

		const fallbackImage = `modules/${MODULE_ID}/assets/banner.webp`;
		stripe.style.backgroundImage =
            `url(${JSON.stringify(bannerImage)}), url(${JSON.stringify(fallbackImage)})`;
	}

	/* ---------- Intro / Outro animations ---------- */

	async _runIntroSequence(el) {
		const introEl = el.querySelector(".sdx-overlay-intro-label");
		if (!introEl) return;

		// Play intro sound
		foundry.audio.AudioHelper.play({ src: `modules/${MODULE_ID}/assets/intro.mp3`, volume: 0.8, loop: false }, true);

		// Wait for intro text animation to finish
		await new Promise(resolve => {
			introEl.addEventListener("animationend", () => {
				introEl.remove();
				resolve();
			});
		});

		// Reveal actor tiles
		const tilesContainer = el.querySelector(".sdx-overlay-tiles");
		if (tilesContainer) {
			tilesContainer.classList.remove("sdx-hidden");
			const tiles = tilesContainer.querySelectorAll(".sdx-overlay-tile");
			const count = tiles.length;
			tiles.forEach((tile, i) => {
				tile.animate(
					[{ opacity: 0, transform: "scale(0.7)" }, { opacity: 1, transform: "scale(1)" }],
					{ duration: 400, easing: "ease-out", fill: "forwards", delay: (count - i) * 80 }
				);
			});
		}
	}

	async _runOutroSequence(el, isSuccess) {
		await SDXRollerOverlay._wait(1500);
		const tilesContainer = el.querySelector(".sdx-overlay-tiles");
		if (tilesContainer) {
			const tiles = tilesContainer.querySelectorAll(".sdx-overlay-tile");
			const count = tiles.length;
			tiles.forEach((tile, i) => {
				tile.animate(
					[{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(0.7)" }],
					{ duration: 350, easing: "ease-in", fill: "forwards", delay: i * 60 }
				);
			});
			await SDXRollerOverlay._wait(350 + count * 60);
			tilesContainer.remove();
		}

		// Show verdict
		if (isSuccess !== undefined) {
			// Play outro sound — drums for success, failure sound for failure
			const outroSrc = isSuccess ? "sounds/drums.wav" : `modules/${MODULE_ID}/assets/failure.mp3`;
			foundry.audio.AudioHelper.play({ src: outroSrc, volume: 0.8, loop: false }, true);

			const outroEl = el.querySelector(".sdx-overlay-outro-label");
			if (outroEl) {
				outroEl.textContent = isSuccess ? "SUCCESS" : "FAILURE";
				outroEl.classList.remove("sdx-hidden");
				outroEl.animate([{ opacity: 0 }, { opacity: 1 }], {
					duration: 300, easing: "ease-in-out", fill: "forwards",
				});
				await SDXRollerOverlay._wait(2500);
			}
		}

		// Fade the whole overlay
		el.animate([{ opacity: 1 }, { opacity: 0 }], {
			duration: 400, easing: "ease-in-out", fill: "forwards",
		});
		await SDXRollerOverlay._wait(400);
		await this.close();
	}

	/* ---------- Rolling ---------- */

	async _performRoll(ev) {
		const tileEl = ev.currentTarget.closest(".sdx-overlay-tile");
		const uuid = tileEl.dataset.uuid;
		const actor = fromUuidSync(uuid);
		if (!actor) return;

		// Detect advantage/disadvantage from tile buttons
		const advBtn = tileEl.querySelector('.sdx-adv-btn[data-mode="advantage"]');
		const disBtn = tileEl.querySelector('.sdx-adv-btn[data-mode="disadvantage"]');
		const hasAdv = advBtn?.classList.contains("sdx-active");
		const hasDis = disBtn?.classList.contains("sdx-active");

		// Toggle spinner state
		this._broadcastToggle({ uuid, rolling: true });

		const abilityId = getSdxActorAbility(this.rollData, uuid);
		const isNone = abilityId === "none";
		const mod = isNone ? 0 : (actor.system?.abilities?.[abilityId]?.mod ?? 0);

		// Build roll formula based on advantage/disadvantage
		let formula = isNone ? "1d20" : "1d20 + @mod";
		let rollMode = "normal";
		if (hasAdv) {
			formula = isNone ? "2d20kh" : "2d20kh + @mod"; rollMode = "advantage";
		}
		else if (hasDis) {
			formula = isNone ? "2d20kl" : "2d20kl + @mod"; rollMode = "disadvantage";
		}

		const roll = new Roll(formula, { mod });
		await roll.evaluate();

		// Play dice sound
		foundry.audio.AudioHelper.play({ src: "sounds/dice.wav", volume: 0.8, loop: false }, true);

		const value = roll.total;
		// For adv/dis, the "kept" die is the one that matters for crit/fumble
		const diceResults = roll.dice[0]?.results?.map(r => r.result) ?? [];
		const keptDie = (hasAdv || hasDis)
			? roll.dice[0]?.results?.find(r => r.active)?.result
			: roll.dice[0]?.total;
		const isCrit = keptDie === 20;
		const isFumble = keptDie === 1;

		// Create chat message
		const abilityLabel = game.i18n.localize(SD_ABILITIES[abilityId]);
		const modeTag = rollMode === "advantage" ? " (ADV)" : rollMode === "disadvantage" ? " (DIS)" : "";
		const flavor = isNone
			? `${actor.name} — Roll${modeTag}`
			: `${actor.name} — ${abilityLabel} Check${modeTag}`;
		const msg = await roll.toMessage(
			{ speaker: ChatMessage.getSpeaker({ actor }), flavor },
			{ create: true }
		);

		this._broadcastToggle({ uuid, rolling: false });

		// Broadcast update
		const modLabel = (mod >= 0 ? "+" : "") + mod;
		const payload = {
			rollId: this.rollData.rollId,
			uuid,
			value,
			mod,
			modLabel,
			isCrit,
			isFumble,
			rollMode,
			diceResults,
			ability: abilityId,
			abilityShort: this.rollData.actorAbilities && !isNone ? abilityId.toUpperCase() : "",
			messageId: msg?.id ?? null,
		};
		this._applyResult(payload);
		game.socket.emit(`module.${MODULE_ID}`, {
			action: "sdxRollerUpdate",
			payload,
		});
	}

	handleRemoteUpdate(payload) {
		if (!this._matchesRoll(payload)) return;
		this._applyResult(payload);
	}

	async _applyResult(data) {
		this._results[data.uuid] = data.value;
		this._rolls[data.uuid] = data;
		if (data.messageId) this._messageIds.add(data.messageId);

		const el = this.element;
		if (!el) return;
		const tileEl = el.querySelector(`.sdx-overlay-tile[data-uuid="${data.uuid}"]`);
		if (!tileEl) return;

		const resultEl = tileEl.querySelector(".sdx-result-value");
		const rollBtn = tileEl.querySelector(".sdx-roll-btn");

		// Animate dice spin then fade before showing result
		if (rollBtn && !rollBtn.classList.contains("sdx-hidden")) {
			rollBtn.classList.add("sdx-roulette");
			await SDXRollerOverlay._wait(1200);
			rollBtn.animate(
				[{ opacity: 1 }, { opacity: 0 }],
				{ duration: 300, easing: "ease-in", fill: "forwards" }
			);
			await SDXRollerOverlay._wait(300);
			rollBtn.classList.add("sdx-hidden");
		}

		if (resultEl) {
			resultEl.textContent = data.value;
			resultEl.classList.remove("sdx-hidden");
			resultEl.animate(
				[{ opacity: 0, transform: "scale(0.5)" }, { opacity: 1, transform: "scale(1)" }],
				{ duration: 300, easing: "ease-out", fill: "forwards" }
			);
			if (data.isCrit) resultEl.classList.add("sdx-crit");
			if (data.isFumble) resultEl.classList.add("sdx-fumble");
		}

		// Show modifier under the result
		const modEl = tileEl.querySelector(".sdx-tile-mod-result");
		if (modEl && data.modLabel) {
			modEl.textContent = data.modLabel;
			modEl.classList.remove("sdx-hidden");
		}

		tileEl.querySelector(".sdx-roll-btn")?.classList.add("sdx-hidden");
		// Hide advantage/disadvantage buttons after roll
		tileEl.querySelectorAll(".sdx-adv-btn").forEach(b => b.classList.add("sdx-hidden"));

		// Pulse animation
		tileEl.animate(
			[{ transform: "scale(1)" }, { transform: "scale(1.08)" }, { transform: "scale(1)" }],
			{ duration: 350, easing: "cubic-bezier(0.22,1,0.36,1)" }
		);

		// Check if all done
		const allActors = [...this.actors, ...this.contestants];
		const allDone = allActors.every(a => Number.isFinite(this._results[a.uuid]));
		if (allDone && this._isAuthorityClient()) {
			this._broadcastEnd({ abort: false });
		}
	}

	/* ---------- Toggle rolling state ---------- */

	_broadcastToggle(payload) {
		const scopedPayload = { ...payload, rollId: this.rollData.rollId };
		this._applyToggle(scopedPayload);
		game.socket.emit(`module.${MODULE_ID}`, {
			action: "sdxRollerToggle",
			payload: scopedPayload,
		});
	}

	handleRemoteToggle(payload) {
		if (!this._matchesRoll(payload)) return;
		this._applyToggle(payload);
	}

	_applyToggle({ uuid, rolling }) {
		const el = this.element;
		if (!el) return;
		const tileEl = el.querySelector(`.sdx-overlay-tile[data-uuid="${uuid}"]`);
		if (!tileEl) return;
		const btn = tileEl.querySelector(".sdx-roll-btn");
		if (!btn) return;
		btn.style.pointerEvents = rolling ? "none" : "auto";
		btn.classList.toggle("sdx-rolling", rolling);
	}

	/* ---------- End roll ---------- */

	_broadcastEnd(payload) {
		const scopedPayload = { ...payload, rollId: this.rollData.rollId };
		const completion = this._handleEnd(scopedPayload);
		game.socket.emit(`module.${MODULE_ID}`, {
			action: "sdxRollerEnd",
			payload: scopedPayload,
		});
		return completion;
	}

	handleRemoteEnd(payload) {
		if (!this._matchesRoll(payload)) return;
		this._handleEnd(payload);
	}

	_matchesRoll(payload) {
		const incomingRollId = String(payload?.rollId ?? "").trim();
		const activeRollId = String(this.rollData.rollId ?? "").trim();
		return !incomingRollId || !activeRollId || incomingRollId === activeRollId;
	}

	_isAuthorityClient() {
		return isSdxRollAuthority(this.rollData, SDXRollerApp._getClientId());
	}

	async _handleEnd({ abort, button }) {
		if (abort) {
			await this.cancelRoll();
			return;
		}
		if (this._ending || this._settled) return;
		this._ending = true;

		const result = {
			canceled: false,
			success: this._computeSuccess(),
			results: this._results,
		};
		try {
			await this._createChatRecap(result.success);
			const el = this.element;
			if (el) await this._runOutroSequence(el, result.success);
		}
		catch (error) {
			console.error(`${MODULE_ID} | Could not finish the SDX roll overlay`, error);
			try {
				await this.close();
			}
			catch (closeError) {
				console.warn(`${MODULE_ID} | Could not close the failed SDX roll overlay`, closeError);
			}
		}
		finally {
			if (SDXRollerApp._activeOverlay === this) {
				SDXRollerApp._activeOverlay = null;
			}
			this._settleRoll(result);
		}
	}

	_settleRoll(result) {
		if (this._settled) return false;
		this._settled = true;
		this._resolve?.(result);
		this._resolve = null;
		this._reject = null;
		return true;
	}

	async cancelRoll() {
		this._ending = true;
		this._settleRoll({ canceled: true, results: [] });
		try {
			await this.close();
		}
		catch (error) {
			console.warn(`${MODULE_ID} | Could not close the canceled SDX roll overlay`, error);
		}
	}

	_computeSuccess() {
		const dc = this.contestants.length
			? this.contestants.reduce((sum, c) => sum + (this._results[c.uuid] ?? 0), 0) / this.contestants.length
			: this.rollData.dc;

		if (!Number.isFinite(dc) || dc <= 0) return undefined;

		if (this.rollData.useAverage) {
			const avg = this.actors.reduce((sum, a) => sum + (this._results[a.uuid] ?? 0), 0) / this.actors.length;
			return avg >= dc;
		}
		const passCount = this.actors.filter(a => (this._results[a.uuid] ?? 0) >= dc).length;
		return passCount >= Math.ceil(this.actors.length / 2);
	}

	async _createChatRecap(success) {
		if (!this._isAuthorityClient()) return;

		const dc = this.contestants.length
			? Math.round(this.contestants.reduce((sum, c) => sum + (this._results[c.uuid] ?? 0), 0) / this.contestants.length)
			: this.rollData.dc;

		const hasDC = Number.isFinite(dc) && dc > 0;
		const buildDice = (r) => {
			const dice = r.diceResults ?? [];
			const mode = r.rollMode ?? "normal";
			if (dice.length <= 1 || mode === "normal") return dice.map(v => ({ value: v, css: "" }));
			const kept = mode === "advantage" ? Math.max(...dice) : Math.min(...dice);
			let marked = false;
			return dice.map(v => {
				if (!marked && v === kept) {
					marked = true;
					return { value: v, css: mode === "advantage" ? "sdx-die-adv" : "sdx-die-dis" };
				}
				return { value: v, css: "sdx-die-dropped" };
			});
		};
		const entries = this.actors.map(a => {
			const r = this._rolls[a.uuid] ?? {};
			return {
				name: a.name, img: a.img,
				result: this._results[a.uuid] ?? "—",
				modLabel: r.modLabel ?? "",
				abilityShort: r.abilityShort ?? "",
				rollMode: r.rollMode ?? "normal",
				diceResults: buildDice(r),
				showDice: (r.diceResults?.length ?? 0) > 1,
				showPass: hasDC,
				pass: hasDC ? (this._results[a.uuid] ?? 0) >= dc : false,
			};
		});
		const contestEntries = this.contestants.map(a => {
			const r = this._rolls[a.uuid] ?? {};
			return {
				name: a.name, img: a.img,
				result: this._results[a.uuid] ?? "—",
				modLabel: r.modLabel ?? "",
				abilityShort: r.abilityShort ?? "",
				rollMode: r.rollMode ?? "normal",
				diceResults: buildDice(r),
				showDice: (r.diceResults?.length ?? 0) > 1,
				showPass: false,
				pass: false,
			};
		});

		const templateData = {
			label: this._introLabel,
			activityDescription: this.rollData.activityDescription,
			dc: Number.isFinite(dc) && dc > 0 ? dc : null,
			success,
			successLabel: success === true ? "SUCCESS" : success === false ? "FAILURE" : null,
			actors: entries,
			contestants: contestEntries,
		};

		const html = await renderTemplate(
			`modules/${MODULE_ID}/templates/sdx-roller-recap.hbs`,
			templateData
		);

		await ChatMessage.create({
			content: html,
			speaker: { alias: "SDX Roller" },
			whisper: this.rollData.hideNames ? ChatMessage.getWhisperRecipients("GM") : [],
		});
	}

	async close(...args) {
		if (SDXRollerApp._activeOverlay === this) {
			SDXRollerApp._activeOverlay = null;
		}
		if (!this._ending && !this._settled) {
			this._ending = true;
			this._settleRoll({ canceled: true, results: [] });
		}
		return super.close(...args);
	}

	static _wait(ms) {
		return new Promise(r => {
			setTimeout(r, ms);
		});
	}
}

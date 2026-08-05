// Party XP/NPC-spawn/reward handlers — extracted from scripts/party/PartySheetSD.mjs
// (Phase 5.1 split). Prototype mixin merged via Object.assign.

const MODULE_ID = "shadowdark-extras";

export const PartyXp = {

	_getNpcSpawnCounts() {
		const counts = this.actor.getFlag(MODULE_ID, "npcSpawnCounts");
		return (counts && typeof counts === "object") ? counts : {};
	},

	_getNpcSpawnFormula(actorId) {
		const counts = this._getNpcSpawnCounts();
		const raw = counts?.[actorId];
		if (raw === undefined || raw === null) return "1";
		if (typeof raw === "number") return String(Math.max(1, Math.floor(raw)));
		if (typeof raw === "string") return this._normalizeNpcSpawnFormula(raw);
		return "1";
	},

	_normalizeNpcSpawnFormula(formula) {
		const f = String(formula ?? "").trim();
		if (!f) return "1";
		// Pure number
		if (/^\d+$/.test(f)) return String(Math.max(1, Math.floor(Number(f))));
		// NdX (allow spaces; allow missing N)
		const m = f.match(/^\s*(\d*)\s*d\s*(\d+)\s*$/i);
		if (m) {
			const n = Math.max(1, Number(m[1] || 1));
			const faces = Math.max(1, Number(m[2]));
			return `${Math.floor(n)}d${Math.floor(faces)}`;
		}
		return f;
	},

	async _setNpcSpawnFormula(actorId, formula) {
		const counts = { ...this._getNpcSpawnCounts() };
		counts[actorId] = this._normalizeNpcSpawnFormula(formula);
		await this.actor.setFlag(MODULE_ID, "npcSpawnCounts", counts);
	},

	_adjustNpcSpawnFormula(formula, delta) {
		const f = this._normalizeNpcSpawnFormula(formula);
		// Number
		if (/^\d+$/.test(f)) {
			const n = Math.max(1, Math.floor(Number(f) + delta));
			return String(n);
		}
		// NdX with optional suffix (e.g. 1d4+2) - keep suffix as-is
		const m = f.match(/^\s*(\d*)\s*d\s*(\d+)(.*)$/i);
		if (m) {
			const n0 = Math.max(1, Number(m[1] || 1));
			const faces = Math.max(1, Number(m[2]));
			const suffix = String(m[3] ?? "");
			const n = Math.max(1, Math.floor(n0 + delta));
			return `${n}d${Math.floor(faces)}${suffix}`;
		}
		// Unknown expression: leave unchanged
		return f;
	},

	async _rollNpcSpawnDesiredCount(actorId) {
		const formula = this._getNpcSpawnFormula(actorId);
		try {
			const roll = await (new Roll(formula)).evaluate({ async: true });
			const total = Math.floor(Number(roll.total));
			return Math.max(1, Number.isFinite(total) ? total : 1);
		}
		catch(e) {
			ui.notifications.warn(`Invalid NPC spawn formula: ${formula}`);
			return 1;
		}
	},

	/**
	 * Get member UUIDs for the party
	 * @returns {string[]}
	 */

	/**
	 * Increment member XP
	 * @param {Event} event
	 */
	async _onXpIncrement(event) {
		event.preventDefault();
		event.stopPropagation();

		const memberKey = event.currentTarget.dataset.memberId;
		const member = await this._getActorFromKey(memberKey);
		if (!member || !member.isOwner) return;

		const currentXp = member.system.level?.xp ?? 0;
		await member.update({ "system.level.xp": currentXp + 1 });
	},

	/**
	 * Decrement member XP
	 * @param {Event} event
	 */
	async _onXpDecrement(event) {
		event.preventDefault();
		event.stopPropagation();

		const memberKey = event.currentTarget.dataset.memberId;
		const member = await this._getActorFromKey(memberKey);
		if (!member || !member.isOwner) return;

		const currentXp = member.system.level?.xp ?? 0;
		if (currentXp > 0) {
			await member.update({ "system.level.xp": currentXp - 1 });
		}
	},

	async _onNpcCountIncrement(event) {
		event.preventDefault();
		event.stopPropagation();
		if (!this.actor.isOwner) return;

		const memberKey = event.currentTarget.dataset.memberId;
		const member = await this._getActorFromKey(memberKey);
		if (!member || member.type !== "NPC") return;

		const current = this._getNpcSpawnFormula(memberKey);
		await this._setNpcSpawnFormula(memberKey, this._adjustNpcSpawnFormula(current, +1));
	},

	async _onNpcCountDecrement(event) {
		event.preventDefault();
		event.stopPropagation();
		if (!this.actor.isOwner) return;

		const memberKey = event.currentTarget.dataset.memberId;
		const member = await this._getActorFromKey(memberKey);
		if (!member || member.type !== "NPC") return;

		const current = this._getNpcSpawnFormula(memberKey);
		await this._setNpcSpawnFormula(memberKey, this._adjustNpcSpawnFormula(current, -1));
	},

	async _onNpcCountChange(event) {
		event.preventDefault();
		event.stopPropagation();
		if (!this.actor.isOwner) return;

		const memberKey = event.currentTarget.dataset.memberId;
		const member = await this._getActorFromKey(memberKey);
		if (!member || member.type !== "NPC") return;

		const value = String(event.currentTarget.value ?? "");
		await this._setNpcSpawnFormula(memberKey, value);
		// Normalize UI in case of invalid input
		this.render(false);
	},

	/**
	 * Place all party members on the canvas one by one with crosshair targeting
	 * @param {Event} event
	 */

	/**
	 * Reward XP to all party members
	 * @param {Event} event
	 */
	async _onRewardXp(event) {
		event.preventDefault();

		const members = this.members.filter(m => m.type === "Player" && m.isOwner);
		if (members.length === 0) {
			ui.notifications.warn(game.i18n.localize("SHADOWDARK_EXTRAS.party.warn.no_members"));
			return;
		}

		// Prompt for XP amount
		const content = `
			<form>
				<div class="form-group">
					<label>${game.i18n.localize("SHADOWDARK_EXTRAS.party.reward_xp_prompt")}</label>
					<input type="number" name="xp" value="1" min="1" autofocus/>
				</div>
			</form>
		`;

		const xpAmount = await foundry.applications.api.DialogV2.prompt({
			window: { title: game.i18n.localize("SHADOWDARK_EXTRAS.party.reward_xp_title") },
			content,
			ok: {
				callback: (event, button, dialog) => {
					const form = dialog.element.querySelector("form");
					return parseInt(form.xp.value) || 0;
				},
			},
			rejectClose: false,
		});

		if (!xpAmount || xpAmount <= 0) return;

		// Award XP to each member
		for (const member of members) {
			const currentXp = member.system.level?.xp ?? 0;
			await member.update({ "system.level.xp": currentXp + xpAmount });
		}

		ui.notifications.info(
			game.i18n.format("SHADOWDARK_EXTRAS.party.xp_rewarded", {
				xp: xpAmount,
				count: members.length,
			})
		);
	},

	/**
	 * Reward coins to all player members
	 * @param {Event} event
	 */
	async _onRewardCoins(event) {
		event.preventDefault();

		const members = this.members.filter(m => m.type === "Player" && m.isOwner);
		if (members.length === 0) {
			ui.notifications.warn(game.i18n.localize("SHADOWDARK_EXTRAS.party.warn.no_members"));
			return;
		}

		// Get localized labels
		const gpLabel = game.i18n.localize("SHADOWDARK_EXTRAS.party.coin_gp");
		const spLabel = game.i18n.localize("SHADOWDARK_EXTRAS.party.coin_sp");
		const cpLabel = game.i18n.localize("SHADOWDARK_EXTRAS.party.coin_cp");

		// Dialog content with clear warning that coins go to EACH member
		const content = `
			<form class="reward-coins-form">
				<p style="color: #1f1f1fff; font-weight: bold; text-align: center; margin-bottom: 10px; padding: 8px; background: rgba(201, 169, 97, 0.1); border-radius: 4px;">
					<i class="fas fa-info-circle"></i>
					${game.i18n.localize("SHADOWDARK_EXTRAS.party.reward_coins_warning")}
				</p>
				<div class="form-group">
					<label>${gpLabel}</label>
					<input type="number" name="gp" value="0" min="0" />
				</div>
				<div class="form-group">
					<label>${spLabel}</label>
					<input type="number" name="sp" value="0" min="0" />
				</div>
				<div class="form-group">
					<label>${cpLabel}</label>
					<input type="number" name="cp" value="0" min="0" />
				</div>
				<p style="font-size: 0.85em; color: #272727ff; text-align: center; margin-top: 10px;">
					${game.i18n.format("SHADOWDARK_EXTRAS.party.reward_coins_members", { count: members.length })}
				</p>
			</form>
		`;

		const result = await foundry.applications.api.DialogV2.prompt({
			window: { title: game.i18n.localize("SHADOWDARK_EXTRAS.party.reward_coins_title") },
			content,
			ok: {
				callback: (event, button, dialog) => {
					const form = dialog.element.querySelector("form");
					return {
						gp: parseInt(form.gp.value) || 0,
						sp: parseInt(form.sp.value) || 0,
						cp: parseInt(form.cp.value) || 0,
					};
				},
			},
			rejectClose: false,
		});

		if (!result) return;
		const { gp, sp, cp } = result;

		// Check if any coins to award
		if (gp <= 0 && sp <= 0 && cp <= 0) return;

		// Award coins to each member
		for (const member of members) {
			const currentGp = member.system.coins?.gp ?? 0;
			const currentSp = member.system.coins?.sp ?? 0;
			const currentCp = member.system.coins?.cp ?? 0;

			await member.update({
				"system.coins.gp": currentGp + gp,
				"system.coins.sp": currentSp + sp,
				"system.coins.cp": currentCp + cp,
			});
		}

		// Build notification message
		const coinParts = [];
		if (gp > 0) coinParts.push(`${gp} ${gpLabel}`);
		if (sp > 0) coinParts.push(`${sp} ${spLabel}`);
		if (cp > 0) coinParts.push(`${cp} ${cpLabel}`);

		ui.notifications.info(
			game.i18n.format("SHADOWDARK_EXTRAS.party.coins_rewarded", {
				coins: coinParts.join(", "),
				count: members.length,
			})
		);
	},
};

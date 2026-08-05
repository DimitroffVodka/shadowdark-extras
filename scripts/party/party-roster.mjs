// Party roster preparation — extracted from scripts/party/PartySheetSD.mjs
// (Phase 5.3 split). Prototype mixin: turning member actors into the rows the
// template renders, the Shadowdark ability modifier ladder, class and ancestry
// lookup, and the aggregate party statistics.
// Merged via Object.assign(PartySheetSD.prototype, PartyRoster).

import { getHpWaveColor, isHpWavesEnabled } from "../character-sheet/HpWavesSettingsSD.mjs";

export const PartyRoster = {
	/**
	 * Prepare member data for display
	 * @returns {Promise<Object[]>}
	 */
	async _prepareMembers() {
		const members = await this.getMembers();
		const memberData = [];
		const players = [];
		const npcs = [];

		for (const member of members) {
			if (!member) continue;
			const isNPC = member.type === "NPC";
			const slotsUsed = isNPC ? 0 : this._calculateActorInventorySlotsUsed(member);
			// Use the actor's system.slots which correctly calculates max slots
			// based on STR, talents (like Hauler), and effects
			const slotsMax = isNPC ? 0 : (member.system?.slots ?? 10);
			const slotsFree = Math.max(0, slotsMax - slotsUsed);

			// Use UUID for compendium actors, ID for world actors (consistent with storage)
			const isCompendiumActor = member.uuid?.startsWith("Compendium.");
			const memberKey = isCompendiumActor ? member.uuid : member.id;

			const data = {
				id: member.id,
				uuid: member.uuid,
				memberKey, // The key used for storage (ID or UUID)
				name: member.name,
				img: member.img,
				isNPC,
				isCompendiumActor,
				spawnFormula: isNPC ? this._getNpcSpawnFormula(memberKey) : null,
				hp: {
					value: member.system?.attributes?.hp?.value ?? 0,
					max: member.system?.attributes?.hp?.max ?? 0,
				},
				ac: member.system?.attributes?.ac?.value ?? 0,
				level: isNPC ? null : (member.system?.level?.value ?? 1),
				xp: {
					current: member.system?.level?.xp ?? 0,
					next: (member.system?.level?.value ?? 1) * 10,  // Shadowdark: 10 XP per level
				},
				className: await this._getMemberClassName(member),
				ancestryName: await this._getMemberAncestryName(member),
				isOwner: member.isOwner,
				// Calculate HP percentage for visual bar
				hpPercent: Math.round(
					((member.system?.attributes?.hp?.value ?? 0)
						/ (member.system?.attributes?.hp?.max ?? 1)) * 100
				) || 0,
				// Wave translate: HP% - 15 = translateY% (100% HP = 85% hidden, 0% HP = visible)
				hpWaveTranslate: Math.max(0, Math.round(
					((member.system?.attributes?.hp?.value ?? 0)
						/ (member.system?.attributes?.hp?.max ?? 1)) * 100
				) - 15) || 0,
				// HP wave color based on ancestry (resolved name)
				hpWaveColor: getHpWaveColor(member, await this._getMemberAncestryName(member)),
				// HP waves enabled
				hpWavesEnabled: isHpWavesEnabled(),
				// HP wave CSS class
				hpWaveClass: (() => {
					const hpVal = member.system?.attributes?.hp?.value ?? 0;
					const hpMax = member.system?.attributes?.hp?.max ?? 1;
					const pct = Math.round((hpVal / hpMax) * 100) || 0;
					if (pct >= 100) return "hp-full";
					if (pct <= 0) return "hp-dead";
					return "";
				})(),
				// Active effects
				effects: member.effects.filter(e => !e.disabled).map(e => ({
					id: e.id,
					name: e.name,
					img: e.img || "icons/svg/aura.svg",
				})),
				slots: {
					used: slotsUsed,
					max: slotsMax,
					free: slotsFree,
				},
				// Ability modifiers
				abilities: {
					str: member.system.abilities?.str?.mod ?? this._calculateMod(
						member.system.abilities?.str?.value ?? 10
					),
					dex: member.system.abilities?.dex?.mod ?? this._calculateMod(
						member.system.abilities?.dex?.value ?? 10
					),
					con: member.system.abilities?.con?.mod ?? this._calculateMod(
						member.system.abilities?.con?.value ?? 10
					),
					int: member.system.abilities?.int?.mod ?? this._calculateMod(
						member.system.abilities?.int?.value ?? 10
					),
					wis: member.system.abilities?.wis?.mod ?? this._calculateMod(
						member.system.abilities?.wis?.value ?? 10
					),
					cha: member.system.abilities?.cha?.mod ?? this._calculateMod(
						member.system.abilities?.cha?.value ?? 10
					),
				},
			};

			memberData.push(data);
			if (isNPC) npcs.push(data);
			else players.push(data);
		}

		return { all: memberData, players, npcs };
	},

	/**
	 * Calculate ability modifier from score
	 * @param {number} score
	 * @returns {number}
	 */
	_calculateMod(score) {
		if (score >= 1 && score <= 3) return -4;
		if (score >= 4 && score <= 5) return -3;
		if (score >= 6 && score <= 7) return -2;
		if (score >= 8 && score <= 9) return -1;
		if (score >= 10 && score <= 11) return 0;
		if (score >= 12 && score <= 13) return 1;
		if (score >= 14 && score <= 15) return 2;
		if (score >= 16 && score <= 17) return 3;
		if (score >= 18) return 4;
		return 0;
	},

	/**
	 * Get member's class name
	 * @param {Actor} member
	 * @returns {Promise<string>}
	 */
	async _getMemberClassName(member) {
		if (!member.system.class) return "";
		const classItem = await fromUuid(member.system.class);
		return classItem?.name ?? "";
	},

	/**
	 * Get the ancestry name for a party member
	 * @param {Actor} member
	 * @returns {Promise<string>}
	 */
	async _getMemberAncestryName(member) {
		if (!member.system.ancestry) return "";
		const ancestryItem = await fromUuid(member.system.ancestry);
		return ancestryItem?.name ?? "";
	},

	/**
	 * Calculate aggregated party statistics
	 * @param {Object[]} members
	 * @returns {Object}
	 */
	_calculatePartyStats(members) {
		if (members.length === 0) {
			return {
				totalHp: 0,
				maxHp: 0,
				avgAc: 0,
				avgLevel: 0,
			};
		}

		const totalHp = members.reduce((sum, m) => sum + m.hp.value, 0);
		const maxHp = members.reduce((sum, m) => sum + m.hp.max, 0);
		const avgAc = Math.round(members.reduce((sum, m) => sum + m.ac, 0) / members.length);
		const levelMembers = members.filter(m => !m.isNPC && Number.isFinite(Number(m.level)));
		const avgLevel = levelMembers.length
			? Math.round(
				levelMembers.reduce((sum, m) => sum + Number(m.level), 0) / levelMembers.length
			)
			: 0;

		return { totalHp, maxHp, avgAc, avgLevel };
	},
};

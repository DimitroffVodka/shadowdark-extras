/**
 * Party quests (#150): the party sheet's Quests tab and an optional on-screen
 * tracker, both read-only views of Shadowdark Enhancer's quest log.
 *
 * Nothing is stored here. Every read goes through
 * `game.shadowdarkEnhancer.quests` (and `.rumors` when Enhancer has it) behind
 * a feature check, the way carousing renown hands off to Enhancer: without it
 * there is no tab and no tracker setting, and nothing throws.
 *
 * "The party's quests" are the ones assigned to the party plus each member's
 * personal ones, deduplicated by id (Enhancer docs/API.md, `quests`).
 */

const MODULE_ID = "shadowdark-extras";
const STATUS_ORDER = ["available", "active", "completed", "failed", "hidden"];

/** Enhancer's quest API, or null when Enhancer (or a version with quests) is absent. */
export function questApi() {
	const quests = globalThis.game?.shadowdarkEnhancer?.quests;
	return typeof quests?.list === "function" ? quests : null;
}

// ── parties ─────────────────────────────────────────────────────────────────

const isParty = actor => actor?.type === "NPC" && actor.getFlag?.(MODULE_ID, "isParty") === true;

/** Every party actor in the world. Public as `api.party.list()`. */
export function listParties() {
	return (game.actors?.contents ?? []).filter(isParty);
}

/**
 * A party's members as actor UUIDs: a world id resolves to its actor's UUID, a
 * stored UUID passes through. Public as `api.party.members(party)`.
 * @param {Actor|string} ref  the party actor, its UUID or its world id
 * @returns {string[]} empty for anything that is not a party
 */
export function partyMemberUuids(ref) {
	const party = typeof ref === "object" ? ref : listParties().find(p => p.id === ref || p.uuid === ref);
	if (!isParty(party)) return [];
	return (party.getFlag(MODULE_ID, "members") ?? [])
		.map(key => game.actors?.get(key)?.uuid ?? (String(key).includes(".") ? String(key) : null))
		.filter(Boolean);
}

/**
 * The party the tracker follows: the one with a token on the current scene,
 * else the one the user's character is in, else the world's only party.
 * @param {Actor[]} parties
 * @param {{sceneActorIds?: string[], characterUuid?: string|null}} where
 * @returns {Actor|null}
 */
export function pickActiveParty(parties, { sceneActorIds = [], characterUuid = null } = {}) {
	return parties.find(p => sceneActorIds.includes(p.id))
		?? (characterUuid ? parties.find(p => partyMemberUuids(p).includes(characterUuid)) : null)
		?? (parties.length === 1 ? parties[0] : null);
}

// ── quests ──────────────────────────────────────────────────────────────────

/**
 * The party's quests, once each, newest first. Enhancer already leaves Hidden
 * quests out for a player; they are dropped here too, so a player never sees
 * one whatever Enhancer returns.
 * @param {object} quests  Enhancer's `quests` API
 * @param {string} partyUuid
 * @param {string[]} memberUuids
 * @param {boolean} isGM
 */
export function collectPartyQuests(quests, partyUuid, memberUuids, isGM) {
	const byId = new Map();
	const lists = [
		quests.list({ party: partyUuid }),
		...memberUuids.map(character => quests.list({ character })),
	];
	for (const quest of lists.flat()) {
		if (quest?.id && !byId.has(quest.id)) byId.set(quest.id, quest);
	}
	return [...byId.values()]
		.filter(quest => isGM || quest.status !== "hidden")
		.sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
}

/** Non-empty status groups in the log's order: Available, Active, Completed, Failed, Hidden. */
export function groupByStatus(list) {
	return STATUS_ORDER
		.map(status => ({ status, quests: list.filter(quest => quest.status === status) }))
		.filter(group => group.quests.length);
}

/** Rumors with text, newest first by the real date they were heard. */
export function newestRumors(rumors) {
	const time = rumor => new Date(rumor?.heardAt?.real ?? 0).getTime() || 0;
	return (Array.isArray(rumors) ? rumors : [])
		.filter(rumor => rumor?.text)
		.sort((a, b) => time(b) - time(a));
}

/**
 * The Quests tab's context, or null when there is no tab: Enhancer is absent,
 * or its read failed (logged; the rest of the sheet still renders).
 * @param {Actor} party
 */
export async function questTabData(party) {
	const quests = questApi();
	if (!quests) return null;
	try {
		const isGM = !!game.user?.isGM;
		const list = collectPartyQuests(quests, party.uuid, partyMemberUuids(party), isGM);
		const groups = groupByStatus(list).map(group => ({
			...group,
			label: game.i18n.localize(`SHADOWDARK_EXTRAS.party.quests.status.${group.status}`),
		}));
		const rumorApi = game.shadowdarkEnhancer?.rumors;
		const rumors = typeof rumorApi?.heard === "function"
			? { list: newestRumors(await rumorApi.heard()).map(rumor => ({
				text: rumor.text,
				region: rumor.region ?? "",
				date: rumor.heardAt?.real ? new Date(rumor.heardAt.real).toLocaleDateString() : "",
			})) }
			: null;
		return { groups, rumors };
	}
	catch(err) {
		console.warn(`${MODULE_ID} | could not read Shadowdark Enhancer's quest log`, err);
		return null;
	}
}

/** Open a quest's journal entry. */
export async function openQuest(uuid) {
	const entry = uuid ? await fromUuid(uuid) : null;
	entry?.sheet?.render(true);
}

// ── tracker ─────────────────────────────────────────────────────────────────

let tracker = null;

/**
 * A small movable window listing the active party's Active quests and their
 * objectives. One per client, shown while the per-user setting is on.
 */
class QuestTrackerSD extends foundry.applications.api.ApplicationV2 {
	static DEFAULT_OPTIONS = {
		id: "sdx-quest-tracker",
		classes: ["sdx-quest-tracker"],
		window: {
			title: "SHADOWDARK_EXTRAS.party.quests.tracker.title",
			icon: "fas fa-scroll",
			minimizable: true,
		},
		position: { width: 280, height: "auto", top: 80, left: 120 },
	};

	async _renderHTML() {
		const esc = foundry.utils.escapeHTML;
		const loc = key => esc(game.i18n.localize(`SHADOWDARK_EXTRAS.party.quests.tracker.${key}`));
		const party = pickActiveParty(listParties(), {
			sceneActorIds: (canvas?.scene?.tokens?.contents ?? []).map(token => token.actorId),
			characterUuid: game.user?.character?.uuid ?? null,
		});
		const quests = questApi();
		if (!party || !quests) return `<p class="sdx-qt-empty">${loc("no_party")}</p>`;
		const isGM = !!game.user?.isGM;
		let active = [];
		try {
			active = collectPartyQuests(quests, party.uuid, partyMemberUuids(party), isGM)
				.filter(quest => quest.status === "active");
		}
		catch(err) {
			console.warn(`${MODULE_ID} | could not read Shadowdark Enhancer's quest log`, err);
		}
		const items = active.map(quest => `<li class="sdx-qt-quest">
			<a class="sdx-qt-name" data-uuid="${esc(quest.uuid ?? "")}">${esc(quest.name ?? "")}</a>
			<ul class="sdx-qt-objectives">${(quest.objectives ?? []).map(objective => `
				<li class="${objective.done ? "done" : ""}"><i class="far ${objective.done ? "fa-square-check" : "fa-square"}"></i> ${esc(objective.text ?? "")}</li>`).join("")}
			</ul></li>`).join("");
		const body = items ? `<ol class="sdx-qt-list">${items}</ol>` : `<p class="sdx-qt-empty">${loc("none")}</p>`;
		return `<h4 class="sdx-qt-party">${esc(party.name)}</h4>${body}`;
	}

	_replaceHTML(result, content) {
		content.innerHTML = result;
	}

	_onRender() {
		for (const link of this.element.querySelectorAll(".sdx-qt-name")) {
			link.addEventListener("click", () => openQuest(link.dataset.uuid));
		}
	}
}

const refreshTracker = () => {
	if (tracker?.rendered) tracker.render();
};

function showTracker(on) {
	if (!on) return tracker?.close();
	tracker ??= new QuestTrackerSD();
	return tracker.render({ force: true });
}

/**
 * The tracker's per-user setting and its hooks. The setting is registered at
 * setup, once every module's init has run, and only when Enhancer's quest API
 * is there: without Enhancer there is no option to turn on.
 */
export function registerPartyQuests() {
	Hooks.once("setup", () => {
		if (!questApi()) return;
		game.settings.register(MODULE_ID, "questTracker", {
			name: "SHADOWDARK_EXTRAS.party.quests.tracker.setting_name",
			hint: "SHADOWDARK_EXTRAS.party.quests.tracker.setting_hint",
			scope: "user",
			config: true,
			type: Boolean,
			default: false,
			onChange: showTracker,
		});
		Hooks.once("ready", () => {
			if (game.settings.get(MODULE_ID, "questTracker")) showTracker(true);
		});
	});
	Hooks.on("shadowdark-enhancer.questsChanged", refreshTracker);
	Hooks.on("canvasReady", refreshTracker);
	Hooks.on("createToken", refreshTracker);
	Hooks.on("deleteToken", refreshTracker);
}

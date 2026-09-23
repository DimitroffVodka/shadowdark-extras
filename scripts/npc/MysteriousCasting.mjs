import { readSdDamageRoll } from "../shared/sd4Compat.mjs";

export const MODULE_ID = "shadowdark-extras";

// In-memory set of actor IDs with mysterious mode enabled.
// Using a Set instead of actor flags avoids the linked/unlinked token mismatch
// where setFlag on a synthetic token actor is invisible to game.actors.get().
const _mysteriousActors = new Set();

/**
 * Get the base (world) actor ID for any actor, whether it's a
 * world actor or a synthetic token actor.
 */
function getBaseActorId(actor) {
	if (!actor) return null;
	// Synthetic token actors: get the base actor ID from the token document
	if (actor.isToken) {
		return actor.token?.actorId ?? actor.id;
	}
	return actor.id;
}

export function initMysteriousCasting() {
	// Register Settings
	game.settings.register(MODULE_ID, "mysteriousCastingMessage", {
		name: "Mysterious Casting Message",
		hint: "The text to display when a spell or attack is used mysteriously.",
		scope: "world",
		config: true,
		type: String,
		default: "The creature casts a mysterious spell...",
	});

	// ── Inject toggle into NPC sheet header ──
	Hooks.on("renderNpcSheetSD", (app, html, data) => {
		if (!game.user.isGM) return;
		if (app.actor?.type !== "NPC") return;

		const actor = app.actor;
		const baseId = getBaseActorId(actor);
		const isActive = _mysteriousActors.has(baseId);
		const activeClass = isActive ? "active" : "";
		const tooltip = isActive
			? "Mysterious Mode: ON — players see a masked card, you see the full one"
			: "Mysterious Mode: OFF — rolls shown normally";

		const $header = html.find(".SD-header");
		if (!$header.length) return;
		if ($header.find(".sdx-mysterious-toggle").length) return;

		const toggleHtml = `
            <a class="sdx-mysterious-toggle ${activeClass}"
               data-tooltip="${foundry.utils.escapeHTML(tooltip)}"
               title="${foundry.utils.escapeHTML(tooltip)}">
                <i class="fas fa-mask"></i>
            </a>`;

		$header.append(toggleHtml);

		// Click handler
		$header.find(".sdx-mysterious-toggle").on("click", async event => {
			event.preventDefault();
			event.stopPropagation();

			if (_mysteriousActors.has(baseId)) {
				_mysteriousActors.delete(baseId);
			}
			else {
				_mysteriousActors.add(baseId);
			}

			// Re-render the sheet to update the toggle visual
			app.render(false);
		});
	});

	// ── Hook into chat message creation ──
	Hooks.on("preCreateChatMessage", (messageDoc, data, options, userId) => {
		// Only relevant for GMs
		if (!game.user.isGM) return true;

		const content = messageDoc.content ?? "";

		// SD 4.x dropped item-card/chat-card wrappers; rollConfig and dice-roll mark SD roll
		// messages.
		if (!content.includes("item-card")
            && !content.includes("dice-roll")
            && !messageDoc.flags?.shadowdark?.rollConfig) return true;

		// Skip ability check rolls — those should always be visible
		if (content.includes("card-ability-roll")) return true;

		// Get the actor from the speaker
		const actorId = messageDoc.speaker?.actor;
		if (!actorId) return true;

		// Check if mysterious mode is enabled for this actor
		if (!_mysteriousActors.has(actorId)) return true;

		// Flag only: the stored card stays whole, so the GM (and the GM-side card
		// pipelines, which read content and flavor) see the real roll and effects.
		// Players get the mask at render time below.
		messageDoc.updateSource({ "flags.shadowdark.isMysterious": true });
		return true;
	});

	// ── Mask the card for players; the GM keeps the full card ──
	// ponytail: the real card still travels to player clients in the message
	// data (as it always has); whisper a separate GM copy if that ever matters.
	Hooks.on("renderChatMessageHTML", (message, html) => {
		if (game.user.isGM || !message.flags?.shadowdark?.isMysterious) return;

		const content = message.content ?? "";
		const isAttack = content.includes("card-attack-roll")
            || content.includes("card-damage-roll")
            || !!readSdDamageRoll(message).roll;
		const mysteriousLabel = isAttack ? "Unknown Attack" : "Unknown Spell";
		const mysteriousText = game.settings.get(MODULE_ID, "mysteriousCastingMessage");
		const mysteriousIcon = "icons/magic/symbols/question-stone-yellow.webp";

		html.querySelector(".flavor-text")?.replaceChildren(mysteriousLabel);
		const body = html.querySelector(".message-content");
		if (!body) return;
		body.innerHTML = `
            <div class="shadowdark chat-card item-card">
                <header class="card-header flexrow">
                    <img src="${foundry.utils.escapeHTML(mysteriousIcon)}" title="${foundry.utils.escapeHTML(mysteriousLabel)}" width="36" height="36"/>
                    <h3 class="item-name">${mysteriousLabel}</h3>
                </header>
                <div class="card-content">
                    <p><em>${mysteriousText}</em></p>
                </div>
            </div>
        `;
	});
}

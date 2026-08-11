// Party token placement — extracted from scripts/party/PartySheetSD.mjs
// (Phase 5.3 split). Prototype mixin: dropping the whole party onto the
// canvas, and the click-to-place preview that positions one member token.
// Merged via Object.assign(PartySheetSD.prototype, PartyTokenPlacement).

import { MODULE_ID } from "../shared/module-id.mjs";

/**
 * Find every token on a scene whose actor is a Player member of the Party.
 * NPC members, unrelated actors, and the Party actor itself are excluded.
 * @param {Scene} scene
 * @param {Actor[]} members
 * @returns {string[]}
 */
export function getRecallablePlayerTokenIds(scene, members) {
	const players = members.filter(member => member?.type === "Player");
	const playerActorIds = new Set(players.map(member => member.id).filter(Boolean));
	const playerSourceUuids = new Set(
		players.map(member => member.uuid).filter(uuid => uuid?.startsWith("Compendium."))
	);
	if (playerActorIds.size === 0 && playerSourceUuids.size === 0) return [];

	const tokens = scene?.tokens?.contents
		?? (scene?.tokens && typeof scene.tokens.values === "function" ? [...scene.tokens.values()] : []);
	return tokens
		.filter(token => {
			if (playerActorIds.has(token.actorId ?? token.actor?.id)) return true;
			const sourceUuid = token.actor?._stats?.compendiumSource
				?? token.actor?._source?._stats?.compendiumSource
				?? token.actor?.flags?.core?.sourceId;
			return playerSourceUuids.has(sourceUuid);
		})
		.map(token => token.id);
}

export const PartyTokenPlacement = {
	async _onPlaceMembers(event) {
		event.preventDefault();

		if (!canvas.scene) {
			ui.notifications.warn(game.i18n.localize("SHADOWDARK_EXTRAS.party.warn.no_scene"));
			return;
		}

		const allMembers = await this.getMembers();
		if (allMembers.length === 0) {
			ui.notifications.warn(game.i18n.localize("SHADOWDARK_EXTRAS.party.warn.no_members"));
			return;
		}

		// Check what types of members we have
		const hasPlayers = allMembers.some(m => m.type === "Player");
		const hasNpcs = allMembers.some(m => m.type === "NPC");

		// If we have both types, show a selection dialog
		let filter = "all";
		if (hasPlayers && hasNpcs) {
			filter = await new Promise(resolve => {
				new foundry.applications.api.DialogV2({
					window: {
						title: game.i18n.localize("SHADOWDARK_EXTRAS.party.place_tokens_title"),
					},
					content: `<p>${game.i18n.localize("SHADOWDARK_EXTRAS.party.place_tokens_prompt")}</p>`,
					buttons: [
						{
							action: "all",
							icon: "fas fa-users",
							label: game.i18n.localize("SHADOWDARK_EXTRAS.party.place_all"),
							default: true,
							callback: () => resolve("all"),
						},
						{
							action: "players",
							icon: "fas fa-user",
							label: game.i18n.localize("SHADOWDARK_EXTRAS.party.place_players"),
							callback: () => resolve("players"),
						},
						{
							action: "npcs",
							icon: "fas fa-dragon",
							label: game.i18n.localize("SHADOWDARK_EXTRAS.party.place_npcs"),
							callback: () => resolve("npcs"),
						},
					],
					close: () => resolve(null),
				}).render({ force: true });
			});

			if (!filter) return; // User closed the dialog
		}

		// Filter members based on selection
		const members = filter === "players" ? allMembers.filter(m => m.type === "Player")
			: filter === "npcs" ? allMembers.filter(m => m.type === "NPC")
				: allMembers;

		// Build list of members to place
		// PCs: place once. NPCs: roll configured formula and place that many.
		const membersToPlace = [];
		for (const member of members) {
			// Use UUID for compendium actors, ID for world actors
			const isCompendiumActor = member.uuid?.startsWith("Compendium.");
			const memberKey = isCompendiumActor ? member.uuid : member.id;

			if (member.type === "Player") {
				membersToPlace.push(member);
				continue;
			}
			if (member.type === "NPC") {
				const desired = await this._rollNpcSpawnDesiredCount(memberKey);
				for (let i = 0; i < desired; i++) membersToPlace.push(member);
			}
		}

		if (membersToPlace.length === 0) {
			ui.notifications.info(
				game.i18n.localize("SHADOWDARK_EXTRAS.party.all_members_present")
			);
			return;
		}

		// Minimize the sheet to allow canvas interaction
		this.minimize();

		let placedCount = 0;

		// Place each token one by one
		for (const member of membersToPlace) {
			const placed = await this._placeTokenWithPreview(member);
			if (placed) {
				placedCount++;
			}
			else {
				// User cancelled, stop placing
				break;
			}
		}

		// Restore the sheet
		this.maximize();

		if (placedCount > 0) {
			ui.notifications.info(
				game.i18n.format("SHADOWDARK_EXTRAS.party.members_placed", { count: placedCount })
			);
		}
	},

	async _onRecallMembers(event) {
		event.preventDefault();
		if (!game.user.isGM) return;

		const scene = canvas.scene;
		if (!scene) {
			ui.notifications.warn(game.i18n.localize("SHADOWDARK_EXTRAS.party.warn.no_scene"));
			return;
		}

		const members = await this.getMembers();
		const tokenIds = getRecallablePlayerTokenIds(scene, members);
		if (tokenIds.length === 0) {
			ui.notifications.info(
				game.i18n.localize("SHADOWDARK_EXTRAS.party.recall_none")
			);
			return;
		}

		const confirmed = await foundry.applications.api.DialogV2.confirm({
			window: {
				title: game.i18n.localize("SHADOWDARK_EXTRAS.party.recall_title"),
			},
			content: `<p>${game.i18n.format(
				"SHADOWDARK_EXTRAS.party.recall_confirm", { count: tokenIds.length }
			)}</p>`,
			modal: true,
		});
		if (!confirmed) return;

		try {
			await scene.deleteEmbeddedDocuments("Token", tokenIds);
			ui.notifications.info(game.i18n.format(
				"SHADOWDARK_EXTRAS.party.recalled", { count: tokenIds.length }
			));
		}
		catch(error) {
			console.error(`${MODULE_ID} | Failed to recall Party player tokens`, error);
			ui.notifications.error(game.i18n.format(
				"SHADOWDARK_EXTRAS.party.recall_failed", { message: error.message }
			));
		}
	},

	/**
	 * Place a single token with crosshair preview
	 * @param {Actor} member - The actor to place
	 * @returns {Promise<boolean>} - Whether the token was placed
	 */
	async _placeTokenWithPreview(member) {
		// For compendium actors, we need to import them to the world first
		let actorToPlace = member;
		const isCompendiumActor = member.uuid?.startsWith("Compendium.");

		if (isCompendiumActor) {
			// Check if already imported by looking for an actor with same name and compendium
			// source
			let existingActor = game.actors.find(a =>
				a.name === member.name
				&& a.flags?.core?.sourceId === member.uuid
			);

			if (!existingActor) {
				// Import the actor from compendium
				try {
					const imported = await Actor.implementation.create(member.toObject());
					if (imported) {
						// Record the compendium source on the imported actor without using the
						// deprecated core.sourceId flag
						try {
							await imported.update({ "_stats.compendiumSource": member.uuid });
						}
						catch{
							// Fallback to writing the legacy flag if update fails for any reason
							await imported.setFlag("core", "sourceId", member.uuid);
						}
						existingActor = imported;
						ui.notifications.info(
							game.i18n.format(
								"SHADOWDARK_EXTRAS.party.actor_imported", { name: member.name }
							)
						);
					}
				}
				catch(e) {
					console.error(`${MODULE_ID} | Failed to import compendium actor`, e);
					ui.notifications.error(
						game.i18n.format(
							"SHADOWDARK_EXTRAS.party.import_failed", { name: member.name }
						)
					);
					return false;
				}
			}

			if (!existingActor) {
				ui.notifications.error(
					game.i18n.format("SHADOWDARK_EXTRAS.party.import_failed", { name: member.name })
				);
				return false;
			}

			actorToPlace = existingActor;
		}

		// Get the token document for this actor
		const tokenDocument = await actorToPlace.getTokenDocument();
		const tokenData = tokenDocument.toObject();

		// Create a preview token sprite for the cursor
		const texture = await foundry.canvas.loadTexture(tokenData.texture.src);
		const preview = new PIXI.Sprite(texture);
		const gridSize = canvas.grid.size;
		const tokenSize = tokenData.width * gridSize;

		preview.anchor.set(0.5);
		preview.width = tokenSize;
		preview.height = tokenSize;
		preview.alpha = 0.7;
		preview.visible = false;

		canvas.stage.addChild(preview);

		return new Promise(resolve => {
			// Show placement instructions
			ui.notifications.info(
				game.i18n.format(
					"SHADOWDARK_EXTRAS.party.place_member_instruction", { name: member.name }
				)
			);

			const onMouseMove = event => {
				const pos = event.data.getLocalPosition(canvas.stage);
				// Snap to grid
				const snapped = canvas.grid.getSnappedPoint(
					{ x: pos.x, y: pos.y }, { mode: CONST.GRID_SNAPPING_MODES.TOP_LEFT_CORNER }
				);
				preview.position.set(snapped.x + (tokenSize / 2), snapped.y + (tokenSize / 2));
				preview.visible = true;
			};

			const onClick = async event => {
				// Left click to place
				const pos = event.data.getLocalPosition(canvas.stage);
				const snapped = canvas.grid.getSnappedPoint(
					{ x: pos.x, y: pos.y }, { mode: CONST.GRID_SNAPPING_MODES.TOP_LEFT_CORNER }
				);

				// Cleanup
				canvas.stage.off("mousemove", onMouseMove);
				canvas.stage.off("mousedown", onClick);
				canvas.stage.off("rightdown", onRightClick);
				document.removeEventListener("keydown", onKeyDown);
				canvas.stage.removeChild(preview);
				preview.destroy();

				// Create the token
				tokenData.x = snapped.x;
				tokenData.y = snapped.y;
				await canvas.scene.createEmbeddedDocuments("Token", [tokenData]);

				resolve(true);
			};

			const onRightClick = event => {
				// Right click to cancel
				canvas.stage.off("mousemove", onMouseMove);
				canvas.stage.off("mousedown", onClick);
				canvas.stage.off("rightdown", onRightClick);
				document.removeEventListener("keydown", onKeyDown);
				canvas.stage.removeChild(preview);
				preview.destroy();

				resolve(false);
			};

			const onKeyDown = event => {
				if (event.key === "Escape") {
					canvas.stage.off("mousemove", onMouseMove);
					canvas.stage.off("mousedown", onClick);
					canvas.stage.off("rightdown", onRightClick);
					canvas.stage.removeChild(preview);
					preview.destroy();
					document.removeEventListener("keydown", onKeyDown);
					resolve(false);
				}
			};

			canvas.stage.on("mousemove", onMouseMove);
			canvas.stage.on("mousedown", onClick);
			canvas.stage.on("rightdown", onRightClick);
			document.addEventListener("keydown", onKeyDown);
		});
	},
};

/**
 * Enter the existing click-to-place flow for any world actor.
 * @param {Actor} actor
 * @returns {Promise<boolean>}
 */
export function placeActorTokenWithPreview(actor) {
	return PartyTokenPlacement._placeTokenWithPreview(actor);
}

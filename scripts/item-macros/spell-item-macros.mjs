import { MODULE_ID } from "../shared/module-id.mjs";
import { isUnidentified } from "../macros/identify.mjs";
import { getMacroExecuteSocket } from "./macro-socket.mjs";
import { hasItemMacro } from "./item-macro-engine.mjs";

/**
 * Spell item macro execution — the spell/scroll/wand/potion half of the
 * item-macro stack, plus every socket handler the spell macros route through.
 *
 * Extracted from the composition root in Phase 3 as one unit, because the
 * executor and its GM-side handler are two ends of the same call: a `runAsGm`
 * spell macro on a player client serialises its context, sends
 * `executeSpellItemMacroAsGM`, and the handler rehydrates it and calls the
 * executor back on the GM.
 *
 * The other seven handlers registered here are the spell macros' own GM
 * bridges. They dispatch through `module.api` rather than importing the macro
 * implementations, which is why this file does not depend on
 * `macros/holy-weapon.mjs` and friends.
 *
 * `isUnidentified` comes from `macros/identify.mjs`, the canonical copy that
 * `SpellMacrosSD` also re-exports. The composition root carries its own
 * byte-equivalent duplicate for six unrelated call sites; see the known gaps in
 * the Phase 3 handoff — its sibling `getUnidentifiedName` has already diverged
 * between the two copies, so consolidating them is a decision of its own rather
 * than something to fold into a move.
 */

/**
 * Get the Item Macro configuration for a spell/wand/scroll/potion
 * @param {Item} item - The spell-type item
 * @returns {Object} - The macro configuration
 */
export function getSpellItemMacroConfig(item) {
	const flags = item.flags?.[MODULE_ID]?.itemMacro || {};
	return {
		enabled: flags.triggers?.length > 0,
		runAsGm: flags.runAsGm || false,
		triggers: flags.triggers || []
	};
}

/**
 * Execute a spell's Item Macro
 * @param {Item} spellItem - The spell/wand/scroll/potion item
 * @param {Actor} actor - The actor casting the spell
 * @param {string} trigger - The trigger type (onCast, onSuccess, onFailure, onCritical, onCriticalFail)
 * @param {Object} context - Additional context for the macro
 */
export async function executeSpellItemMacro(spellItem, actor, trigger, context = {}) {
	// Native executor — no longer requires the itemacro module. Falls back to
	// reading legacy `flags.itemacro.macro.command` so pre-Phase-4 worlds keep
	// working until the migration hook runs.
	if (!hasItemMacro(spellItem)) {
		return;
	}

	//console.log(`${MODULE_ID} | Executing spell Item Macro for ${spellItem.name}, trigger: ${trigger}`);

	// Get the caster's token. A `runAsGm` socket execution has already resolved
	// the caster's token from its UUID and passes it here — honour that even when
	// it is null, because on the GM's client the canvas search would either miss
	// (GM viewing a different scene than the caster) or, for a linked actor with
	// tokens on several scenes, silently resolve the WRONG token. The canvas
	// search is only correct on the casting client, where no token was supplied.
	const token = Object.hasOwn(context, "token")
		? (context.token || null)
		: (canvas.tokens?.placeables?.find(t => t.actor?.id === actor.id) || null);

	// Get current targets
	const targets = context.targets || Array.from(game.user.targets || []);

	// Build the scope object to pass to the macro
	const scope = {
		actor,
		token,
		item: spellItem,
		targets,
		target: targets[0] || null,
		targetActor: targets[0]?.actor || null,
		trigger,
		isSuccess: context.isSuccess ?? false,
		isFailure: context.isFailure ?? false,
		isCritical: context.isCritical ?? false,
		isCriticalFail: context.isCriticalFail ?? false,
		rollResult: context.rollResult ?? null,
		rollData: context.rollData ?? null,
		speaker: ChatMessage.getSpeaker({ actor }),
		flags: spellItem.flags?.[MODULE_ID] || {},
		// Originating user — Holy Weapon and other dialog-routing macros use
		// this to remote-trigger the caller's dialog from a GM-side
		// `runAsGm` execution. Socket path overrides via serializedContext.
		originatingUserId: context.originatingUserId ?? game.user.id
	};

	const macroConfig = getSpellItemMacroConfig(spellItem);

	// If running as GM and we're not the GM, send via socket
	if (macroConfig.runAsGm && !game.user.isGM) {
		// Serialize context for socket transmission
		const serializedContext = {
			actorId: actor.id,
			itemId: spellItem.id,
			tokenUuid: token?.document?.uuid,
			targetUuids: targets.map(t => t.document.uuid),
			trigger,
			isSuccess: context.isSuccess,
			isFailure: context.isFailure,
			isCritical: context.isCritical,
			isCriticalFail: context.isCriticalFail,
			rollResult: context.rollResult,
			rollDataJson: context.rollData ? JSON.stringify(context.rollData) : null,
			originatingUserId: game.user.id  // Track who initiated the spell for dialog routing
		};

		//console.log(`${MODULE_ID} | Sending spell Item Macro to GM for execution`);
		const macroExecuteSocket = getMacroExecuteSocket();
		if (macroExecuteSocket) {
			await macroExecuteSocket.executeAsGM("executeSpellItemMacroAsGM", serializedContext);
		}
		return;
	}

	// Execute locally. Inline AsyncFunction preserves the rich scope variables
	// (target, targets, isSuccess, etc.) that existing trigger macros may rely
	// on. Reads SDX flag first, falls back to legacy itemacro flag.
	try {
		const macroCommand = spellItem.getFlag(MODULE_ID, "macroCommand")
			?? spellItem.flags?.itemacro?.macro?.command;
		if (!macroCommand) return;

		// `args` is a back-compat object for macros written against the older
		// `executeItemMacro` API, which exposed everything under args.*
		// Verified surface across the 7 bundled SDX scripted spells:
		//   Cloud Kill        → args.trigger
		//   Turn Undead       → args.rollResult
		//   Wrath             → args.isCritical
		//   Prismatic Orb     → args.isCritical
		//   Holy Weapon       → args.isCritical, args.originatingUserId
		//   Cleansing Weapon  → args.isCritical
		//   Burning Hands     → args.isCritical
		// Bundle every scope field so future macros can use any of them.
		const args = {
			actor: scope.actor,
			token: scope.token,
			item: scope.item,
			targets: scope.targets,
			target: scope.target,
			targetActor: scope.targetActor,
			trigger: scope.trigger,
			isSuccess: scope.isSuccess,
			isFailure: scope.isFailure,
			isCritical: scope.isCritical,
			isCriticalFail: scope.isCriticalFail,
			rollResult: scope.rollResult,
			rollData: scope.rollData,
			speaker: scope.speaker,
			flags: scope.flags,
			originatingUserId: scope.originatingUserId
		};

		const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;

		// Async functions are strict — redeclaring a named parameter with const/let/var
		// inside the body throws SyntaxError. Scan the macro command and drop any
		// parameter whose name is re-declared in the body. Every dropped name is still
		// accessible via args.<name> so macro behaviour is preserved.
		const allParams = [
			"actor", "token", "item", "targets", "target", "targetActor",
			"trigger", "isSuccess", "isFailure", "isCritical", "isCriticalFail",
			"rollResult", "rollData", "speaker", "flags", "args"
		];
		const safeParams = allParams.filter(
			p => !new RegExp(`\\b(?:const|let|var)\\s+${p}\\b`).test(macroCommand)
		);
		const safeValues = safeParams.map(p => (p === "args" ? args : scope[p]));

		const macroFn = new AsyncFunction(...safeParams, macroCommand);
		await macroFn.call(scope, ...safeValues);
	} catch (error) {
		console.error(`${MODULE_ID} | Error executing spell macro:`, error);
		ui.notifications.error("There was an error in your macro syntax. See the console (F12) for details");
	}
}

/**
 * Register the spell socket handlers. The composition root calls this at the
 * source position this registration occupied.
 *
 * This keeps its own `ready` hook rather than joining the root's socket hook.
 * That hook runs earlier — it is the one that creates the socket — so by the
 * time this one fires, `getMacroExecuteSocket()` is populated. Both are
 * synchronous, so source order is what guarantees it; moving these eight
 * registrations into the earlier hook would be a timing change rather than a
 * move, and belongs in its own commit if it is wanted.
 */
export function registerSpellItemMacroSocket() {
	// Register socket handlers for Spell API functions
	Hooks.once("ready", () => {
		// The socket is created synchronously at the top of the earlier ready hook,
		// so it is set by the time this one runs.
		const macroExecuteSocket = getMacroExecuteSocket();
		if (macroExecuteSocket) {
			macroExecuteSocket.register("executeSpellItemMacroAsGM", async function(serializedContext) {
				const sender = game.users.get(this.socketdata?.userId);
				if (!sender) return;

				const actor = game.actors.get(serializedContext.actorId);
				if (!actor) return;

				// Verify authorization
				if (!sender.isGM && !actor.testUserPermission(sender, "OWNER")) {
					console.warn(`${MODULE_ID} | Unauthorized spell macro execution attempt from user ${sender.name}`);
					return;
				}

				const spellItem = actor.items.get(serializedContext.itemId);
				if (!spellItem) return;

				// Resolve token and targets from UUIDs. `TokenDocument#object` is only
				// populated for the scene currently rendered on this client, so a GM
				// viewing a different scene than the caster resolves null here. Pass the
				// result on explicitly (null included) — executeSpellItemMacro must not
				// fall back to a same-actor canvas search, which would pick a token from
				// whatever scene the GM happens to be viewing.
				const tokenDoc = serializedContext.tokenUuid ? await fromUuid(serializedContext.tokenUuid) : null;
				const token = tokenDoc?.object || null;
				if (serializedContext.tokenUuid && !token) {
					console.warn(`${MODULE_ID} | Caster token ${serializedContext.tokenUuid} is not on the scene this GM is viewing; macro runs without a caster token`);
				}

				const targets = [];
				if (serializedContext.targetUuids) {
					for (const uuid of serializedContext.targetUuids) {
						const tDoc = await fromUuid(uuid);
						if (tDoc?.object) targets.push(tDoc.object);
						else console.warn(`${MODULE_ID} | Target token ${uuid} could not be resolved on this GM's canvas; dropping it from the macro's targets`);
					}
				}

				const context = {
					token,
					targets,
					trigger: serializedContext.trigger,
					isSuccess: serializedContext.isSuccess,
					isFailure: serializedContext.isFailure,
					isCritical: serializedContext.isCritical,
					isCriticalFail: serializedContext.isCriticalFail,
					rollResult: serializedContext.rollResult,
					rollData: serializedContext.rollDataJson ? JSON.parse(serializedContext.rollDataJson) : null,
					originatingUserId: serializedContext.originatingUserId
				};

				return executeSpellItemMacro(spellItem, actor, serializedContext.trigger, context);
			});

			macroExecuteSocket.register("applyHolyWeaponAsGM", async function(weaponUuid, casterUuid, itemUuid, targetActorUuid, targetTokenUuid) {
				const sender = game.users.get(this.socketdata?.userId);
				if (!sender) return;

				// Items return the document directly from fromUuid, not a wrapper
				const weapon = await fromUuid(weaponUuid);
				const casterActor = await fromUuid(casterUuid);

				// Verify authorization
				if (!sender.isGM && (!casterActor || !casterActor.testUserPermission(sender, "OWNER"))) {
					console.warn(`${MODULE_ID} | Unauthorized applyHolyWeaponAsGM attempt from user ${sender.name}`);
					return;
				}

				const casterItem = await fromUuid(itemUuid);
				const targetActor = await fromUuid(targetActorUuid);
				const targetTokenDoc = targetTokenUuid ? await fromUuid(targetTokenUuid) : null;
				const targetToken = targetTokenDoc?.object || null;

				if (weapon && casterActor && casterItem && targetActor) {
					const module = game.modules.get(MODULE_ID);
					if (module?.api?.applyHolyWeapon) {
						await module.api.applyHolyWeapon(weapon, casterActor, casterItem, targetActor, targetToken);
					}
				}
			});

			macroExecuteSocket.register("applyCleansingWeaponAsGM", async function(weaponUuid, casterUuid, itemUuid, targetActorUuid, targetTokenUuid) {
				const sender = game.users.get(this.socketdata?.userId);
				if (!sender) return;

				// Items return the document directly from fromUuid, not a wrapper
				const weapon = await fromUuid(weaponUuid);
				const casterActor = await fromUuid(casterUuid);

				// Verify authorization
				if (!sender.isGM && (!casterActor || !casterActor.testUserPermission(sender, "OWNER"))) {
					console.warn(`${MODULE_ID} | Unauthorized applyCleansingWeaponAsGM attempt from user ${sender.name}`);
					return;
				}

				const casterItem = await fromUuid(itemUuid);
				const targetActor = await fromUuid(targetActorUuid);
				const targetTokenDoc = targetTokenUuid ? await fromUuid(targetTokenUuid) : null;
				const targetToken = targetTokenDoc?.object || null;

				if (weapon && casterActor && casterItem && targetActor) {
					const module = game.modules.get(MODULE_ID);
					if (module?.api?.applyCleansingWeapon) {
						await module.api.applyCleansingWeapon(weapon, casterActor, casterItem, targetActor, targetToken);
					}
				}
			});

			macroExecuteSocket.register("applyWrathWeaponAsGM", async function(weaponUuid, casterUuid, itemUuid, targetActorUuid, targetTokenUuid) {
				const sender = game.users.get(this.socketdata?.userId);
				if (!sender) return;

				const weapon = await fromUuid(weaponUuid);
				const casterActor = await fromUuid(casterUuid);

				// Verify authorization
				if (!sender.isGM && (!casterActor || !casterActor.testUserPermission(sender, "OWNER"))) {
					console.warn(`${MODULE_ID} | Unauthorized applyWrathWeaponAsGM attempt from user ${sender.name}`);
					return;
				}

				const casterItem = await fromUuid(itemUuid);
				const targetActor = await fromUuid(targetActorUuid);
				const targetTokenDoc = targetTokenUuid ? await fromUuid(targetTokenUuid) : null;
				const targetToken = targetTokenDoc?.object || null;

				if (weapon && casterActor && casterItem && targetActor) {
					const module = game.modules.get(MODULE_ID);
					if (module?.api?.applyWrathWeapon) {
						await module.api.applyWrathWeapon(weapon, casterActor, casterItem, targetActor, targetToken);
					}
				}
			});

			macroExecuteSocket.register("applyWrathToAllWeaponsAsGM", async function(casterUuid, itemUuid, isCritical) {
				const sender = game.users.get(this.socketdata?.userId);
				if (!sender) return;

				const casterActor = await fromUuid(casterUuid);

				// Verify authorization
				if (!sender.isGM && (!casterActor || !casterActor.testUserPermission(sender, "OWNER"))) {
					console.warn(`${MODULE_ID} | Unauthorized applyWrathToAllWeaponsAsGM attempt from user ${sender.name}`);
					return;
				}

				const casterItem = await fromUuid(itemUuid);

				if (casterActor && casterItem) {
					const module = game.modules.get(MODULE_ID);
					if (module?.api?.applyWrathToAllWeapons) {
						await module.api.applyWrathToAllWeapons(casterActor, casterItem, null, isCritical);
					}
				}
			});

			// Handler: GM identifies item via SD 4.x native toggleIdentified(),
			// then routes the reveal dialog back to the originating player.
			macroExecuteSocket.register("sdxIdentifyItemAsGM", async function({ itemUuid, spellUuid, maskedName }) {
				const sender = game.users.get(this.socketdata?.userId);
				if (!sender) return;

				const item = await fromUuid(itemUuid);
				if (!item) return;

				// Authorization. GMs and owners of the item always pass. This socket
				// path exists precisely for non-owner senders (a player casting
				// Identify on another actor's item), so those are authorized when the
				// item is genuinely unidentified AND the Identify spell they cast
				// lives on an actor they own — revealing is then a spell effect, not
				// a permission escalation on the target document.
				let authorized = sender.isGM || item.testUserPermission(sender, "OWNER");
				if (!authorized && isUnidentified(item)) {
					const spell = spellUuid ? await fromUuid(spellUuid) : null;
					// Identify can be cast from a spell, scroll, or wand (the
					// spell-macro dispatch covers all three item types) — but the
					// item must genuinely be Identify, not just any owned castable.
					// The canonical marker is the same item-macro command the
					// dispatch executes (module flag, legacy itemacro fallback):
					// the bundled Identify spell's command calls the identify API.
					const macroCommand = spell?.getFlag?.(MODULE_ID, "macroCommand")
						?? spell?.flags?.itemacro?.macro?.command ?? "";
					authorized = ["Spell", "Scroll", "Wand"].includes(spell?.type)
						&& /\b(?:showIdentifyDialog|identifyItem)\b/.test(macroCommand)
						&& Boolean(spell.actor?.testUserPermission(sender, "OWNER"));
				}
				if (!authorized) {
					console.warn(`${MODULE_ID} | Unauthorized sdxIdentifyItemAsGM attempt from user ${sender.name}`);
					return;
				}

				// Reveal. SD 4.x native swaps name ↔ identification.name and flips the
				// identified flag; legacy (SD 3.x) worlds just clear the SDX flags.
				if (item.system?.identification !== undefined) {
					if (!item.system.isIdentified) await item.system.toggleIdentified();
				} else {
					await item.unsetFlag(MODULE_ID, "unidentified");
					await item.unsetFlag(MODULE_ID, "unidentifiedName");
				}
				const escapedItemImg = foundry.utils.escapeHTML(item.img ?? "");

				// Post chat message visible to all
				await ChatMessage.create({
					content: `
						<div class="shadowdark chat-card sdx-identify-chat">
							<header class="card-header flexrow">
								<img class="item-image" src="${escapedItemImg}" alt="${foundry.utils.escapeHTML(item.name)}"/>
								<div class="header-text">
									<h3><i class="fas fa-sparkles"></i> ${game.i18n.localize("SHADOWDARK_EXTRAS.identify.revealed")}</h3>
								</div>
							</header>
							<div class="card-content">
								<p class="reveal-text">
									<em>${foundry.utils.escapeHTML(maskedName)}</em>
									${game.i18n.localize("SHADOWDARK_EXTRAS.identify.isActually")}
								</p>
								<p class="item-name"><strong>${foundry.utils.escapeHTML(item.name)}</strong></p>
								${item.system?.description ? `<div class="item-description">${item.system.description}</div>` : ""}
							</div>
						</div>
					`,
					speaker: ChatMessage.getSpeaker({ actor: item.actor }),
				});

				// Route reveal dialog back to the requesting player (or show locally
				// if GM cast). The recipient is the authenticated socket sender —
				// never a client-supplied user id, which could be forged.
				if (sender.id !== game.user.id) {
					await macroExecuteSocket.executeAsUser("sdxShowItemRevealForUser", sender.id, {
						itemUuid: item.uuid,
						maskedName
					});
				} else {
					const sdxModule = game.modules.get(MODULE_ID);
					if (sdxModule?.api?.showItemReveal) {
						await sdxModule.api.showItemReveal(item, maskedName);
					}
				}

				ui.notifications.info(game.i18n.format("SHADOWDARK_EXTRAS.identify.success", { name: item.name }));
			});

			// Handler: Show item reveal dialog on the originating player's client
			macroExecuteSocket.register("sdxShowItemRevealForUser", async ({ itemUuid, maskedName }) => {
				const item = await fromUuid(itemUuid);
				if (!item) return;
				const sdxModule = game.modules.get(MODULE_ID);
				if (sdxModule?.api?.showItemReveal) {
					await sdxModule.api.showItemReveal(item, maskedName);
				}
			});

			// Handler: Show identify dialog on the originating player's client (GM routing)
			macroExecuteSocket.register("sdxShowIdentifyDialog", async ({ targetActorId, unidentifiedItemIds, identifySpellId, casterActorId }) => {
				const targetActor = game.actors.get(targetActorId);
				const casterActor = casterActorId ? game.actors.get(casterActorId) : null;
				const identifySpell = casterActor?.items.get(identifySpellId) ?? null;
				if (!targetActor) return;
				const unidentifiedItems = (unidentifiedItemIds || [])
					.map(id => targetActor.items.get(id))
					.filter(Boolean);
				const sdxModule = game.modules.get(MODULE_ID);
				if (sdxModule?.api?.showIdentifyDialog) {
					await sdxModule.api.showIdentifyDialog(targetActor, unidentifiedItems, identifySpell);
				}
			});
		}
	});
}

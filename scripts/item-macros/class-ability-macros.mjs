import { MODULE_ID } from "../shared/module-id.mjs";
import { readSdRollOutcome } from "../shared/sd4Compat.mjs";
import { getMacroExecuteSocket } from "./macro-socket.mjs";
import { hasItemMacro } from "./item-macro-engine.mjs";

/**
 * Class Ability item macro execution.
 *
 * Extracted from the composition root in Phase 3. The feature map puts the
 * Class Ability *sheet* under item-sheets and its macro *execution* here, which
 * is what this module is: the local executor, the GM-side socket handler, and
 * the `Player#useAbility` patch that triggers both.
 *
 * Both registrations are `ready` hooks and the root registers many others, so
 * order matters. They were adjacent in the root with only a function
 * declaration between them, and the root calls registerClassAbilityItemMacros()
 * at that same position — so their position relative to every other
 * registration is unchanged.
 */

/**
 * Execute the item macro for a Class Ability when used
 * @param {Item} item - The Class Ability item
 * @param {Actor} actor - The actor using the item
 * @param {Object} context - Additional context (rollResult, success, critical)
 */
async function executeClassAbilityItemMacro(item, actor, context = {}) {
	const macroConfig = item.getFlag(MODULE_ID, "itemMacro") || {};
	const macroTrigger = macroConfig.macroTrigger ?? "all";

	// Check if the macro should run based on the trigger condition
	const { success, critical } = context;
	const rolled = context.rolled ?? false;

	if (rolled && macroTrigger !== "all") {
		const isCriticalSuccess = critical === "success";
		const isSuccess = success === true;
		const isFailure = success === false;

		if (macroTrigger === "onSuccess" && !isSuccess) return;
		if (macroTrigger === "onCritical" && !isCriticalSuccess) return;
		if (macroTrigger === "onFailure" && !isFailure) return;
	}

	// Check if the item has a macro (native check; no itemacro dependency)
	if (!hasItemMacro(item)) return;

	const token = canvas.tokens?.placeables?.find(t => t.actor?.id === actor.id)
		|| canvas.tokens?.controlled?.find(t => t.actor?.id === actor.id) || null;
	const targets = Array.from(game.user?.targets || []);

	const scope = {
		actor,
		token,
		item,
		targets,
		target: targets[0] || null,
		targetActor: targets[0]?.actor || null,
		speaker: ChatMessage.getSpeaker({ actor }),
		flags: item.flags?.[MODULE_ID] || {},
		success,
		critical,
		rolled,
		scene: canvas.scene,
		game,
		...context,
	};

	// If running as GM and we're not the GM, send via socket
	if (macroConfig.runAsGm && !game.user.isGM) {
		const serializedContext = {
			actorId: actor.id,
			itemId: item.id,
			tokenUuid: token?.document?.uuid,
			targetUuids: targets.map(t => t.document.uuid),
			originatingUserId: game.user.id,
			success,
			critical,
			rolled,
		};

		const macroExecuteSocket = getMacroExecuteSocket();
		if (macroExecuteSocket) {
			await macroExecuteSocket.executeAsGM("executeClassAbilityMacroAsGM", serializedContext);
		}
		return;
	}

	// Execute the macro directly. Read from SDX flag namespace first, fall
	// back to legacy itemacro namespace for unmigrated worlds.
	try {
		const macroCommand = item.getFlag(MODULE_ID, "macroCommand")
			?? item.flags?.itemacro?.macro?.command;
		if (!macroCommand) return;

		const AsyncFunction = Object.getPrototypeOf(async function() { }).constructor;
		const macroFn = new AsyncFunction(
			"actor", "token", "item", "targets", "target", "targetActor",
			"speaker", "flags", "success", "critical", "rolled", "scene", "game",
			macroCommand
		);

		await macroFn.call(scope,
			scope.actor, scope.token, scope.item, scope.targets, scope.target, scope.targetActor,
			scope.speaker, scope.flags, scope.success, scope.critical, scope.rolled, scope.scene, scope.game
		);
	} catch (error) {
		console.error(`${MODULE_ID} | Error executing Class Ability macro:`, error);
		ui.notifications.error("There was an error in your macro syntax. See the console (F12) for details");
	}
}

/**
 * Register the Class Ability macro hooks. The composition root calls this at
 * the source position these two registrations occupied.
 */
export function registerClassAbilityItemMacros() {
	// Register socket handler for GM execution of Class Ability Item Macros
	Hooks.once("ready", () => {
		const macroExecuteSocket = getMacroExecuteSocket();
		if (macroExecuteSocket) {
			macroExecuteSocket.register("executeClassAbilityMacroAsGM", async (serializedContext) => {
				const actor = game.actors.get(serializedContext.actorId);
				if (!actor) return;

				const item = actor.items.get(serializedContext.itemId);
				if (!item) return;

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

				const scope = {
					actor,
					token,
					item,
					targets,
					target: targets[0] || null,
					targetActor: targets[0]?.actor || null,
					speaker: ChatMessage.getSpeaker({ actor }),
					flags: item.flags?.[MODULE_ID] || {},
					originatingUserId: serializedContext.originatingUserId,
					success: serializedContext.success,
					critical: serializedContext.critical,
					rolled: serializedContext.rolled,
					// The caster's scene, not the one this GM happens to be viewing —
					// `canvas.scene` on a GM-side execution is whatever is open here.
					scene: tokenDoc?.parent ?? canvas.scene ?? null,
					game,
				};

				try {
					const macroCommand = item.getFlag(MODULE_ID, "macroCommand")
						?? item.flags?.itemacro?.macro?.command;
					if (!macroCommand) return;

					const AsyncFunction = Object.getPrototypeOf(async function() { }).constructor;
					const macroFn = new AsyncFunction(
						"actor", "token", "item", "targets", "target", "targetActor",
						"speaker", "flags", "success", "critical", "rolled", "scene", "game",
						macroCommand
					);
					await macroFn.call(scope,
						scope.actor, scope.token, scope.item, scope.targets, scope.target, scope.targetActor,
						scope.speaker, scope.flags, scope.success, scope.critical, scope.rolled, scope.scene, scope.game
					);
				} catch (error) {
					console.error(`${MODULE_ID} | GM execution of Class Ability macro failed:`, error);
				}
			});
		}
	});

	// Patch Player#useAbility for Class Ability item macros. SD 4.x: useAbility
	// lives on the Player data model (actor.system), takes an ability UUID, and
	// runs with `this` = the data model (so the actor is `this.parent`).
	Hooks.once("ready", () => {
		setTimeout(() => {
			const PlayerDM = CONFIG.Actor.dataModels?.Player;
			if (!PlayerDM?.prototype?.useAbility) {
				console.warn(`${MODULE_ID} | Player.useAbility not found, cannot patch Class Ability macro execution`);
				return;
			}
			if (PlayerDM.prototype.__sdxUseAbilityMacroPatched) return;
			PlayerDM.prototype.__sdxUseAbilityMacroPatched = true;

			const originalUseAbility = PlayerDM.prototype.useAbility;

			PlayerDM.prototype.useAbility = async function(abilityUuid, config = {}) {
				const actor = this.parent;
				let item = null;
				try { item = await fromUuid(abilityUuid); } catch (_) { }

				// Only intercept Class Ability items
				if (!item || item.type !== "Class Ability") {
					return originalUseAbility.call(this, abilityUuid, config);
				}

				// Call original method first
				const result = await originalUseAbility.call(this, abilityUuid, config);

				// If the ability had a roll check, derive the outcome from the latest roll card.
				let rolled = false;
				let success = true;
				let critical = null;

				if (item.system.ability) {
					rolled = true;
					const recentMessages = game.messages.contents.slice(-5);
					for (let i = recentMessages.length - 1; i >= 0; i--) {
						const msg = recentMessages[i];
						const rollData = readSdRollOutcome(msg);
						if (rollData.mainRoll && !rollData.isMasked && msg.speaker?.actor === actor?.id) {
							success = rollData.isSuccess;
							critical = rollData.isCriticalSuccess
								? "success"
								: rollData.isCriticalFailure
									? "failure"
									: null;
							break;
						}
					}
				}

				// Execute the macro
				await executeClassAbilityItemMacro(item, actor, { rolled, success, critical });

				return result;
			};

			console.log(`${MODULE_ID} | Patched Player.useAbility for Class Ability macro execution`);
		}, 100);
	});
}

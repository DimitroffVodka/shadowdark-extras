import { MODULE_ID } from "../shared/module-id.mjs";

/**
 * GM-side target syncing for the templates API.
 *
 * Extracted from the composition root in Phase 3. A player placing a template
 * targets tokens on their own client; the GM has to end up targeting the same
 * tokens, or the GM cannot interact with the damage card that follows.
 *
 * This is the first file in `api/`, which the feature map reserves for the
 * public `module.api` and the developer/templates surface. Its only caller is
 * the `SDX.templates` block still in the root, which follows in step 13 — the
 * two halves are inherently on different clients, so they do not need to be
 * co-located to be reviewable.
 */

/**
 * Register the GM-side handler that mirrors a player's template targets.
 *
 * The socket is passed in rather than fetched. The root registers all socket
 * handlers from one hook, synchronously with `ready`, so that none of them can
 * be delayed by unrelated work — taking the socket as an argument keeps that
 * the single place the ordering is decided.
 *
 * @param {object} socket - The module's socketlib socket.
 */
export function registerTemplateTargetSyncSocket(socket) {
	// Register handler to sync template targets to GM
	socket.register("syncTargetsToGM", async (tokenIds) => {
		// This runs on the GM's client - target the same tokens the player targeted
		if (!game.user.isGM) return;

		// socketlib may elect any connected GM, and a GM client without a canvas
		// cannot hold targets at all — `canvas.tokens` is undefined there, so the
		// lookup below would throw. Bail before clearing, or the elected GM ends
		// up with its targets wiped and nothing put back.
		if (!canvas?.ready || !canvas.tokens) {
			console.warn(`${MODULE_ID} | syncTargetsToGM: no canvas on this GM client, targets not mirrored`);
			return;
		}

		console.log(`${MODULE_ID} | GM syncing targets from player:`, tokenIds);

		// Clear current GM targets first
		game.user.targets.forEach(t => t.setTarget(false, { user: game.user, releaseOthers: false }));

		// Target each token
		for (const tokenId of tokenIds) {
			const token = canvas.tokens.get(tokenId);
			if (token) {
				await token.setTarget(true, { user: game.user, releaseOthers: false });
			}
		}
	});
}

/**
 * Which tokens an actor-scoped animation applies to.
 *
 * This lived as three byte-identical private copies in TorchAnimationSD,
 * WeaponAnimationSD and LevelUpAnimationSD. Issue #122 lifted them here and
 * exported the result so the behaviour could be tested at all — none of the
 * three copies was reachable from the suite.
 *
 * The answer is deliberately link-aware, and that is the decision #122 records:
 *
 *   - A synthetic (unlinked-token) actor resolves to exactly its own token.
 *     An unlinked token carries its own copy of the actor data, so a change to
 *     one is not a change to its siblings, even when they were all stamped from
 *     the same base actor and share an actorId.
 *   - A base (world) actor resolves to its LINKED tokens only. Unlinked tokens
 *     do not follow base-actor changes, because their item data is their own.
 *
 * Concretely, for N tokens sharing one actorId:
 *
 *   3 unlinked, queried via a synthetic actor  -> 1  (the queried token)
 *   3 unlinked, queried via the base actor     -> 0  (none of them follow it)
 *   1 linked + 1 unlinked, via the base actor  -> 1  (the linked one)
 *
 * An abandoned branch (phase53/issue105-token-resolution) once asserted 3, 3
 * and 2 — every sibling sharing the actorId, link-agnostic. That was coherent
 * under the pre-#105 design, where the Sequencer effect NAME carried token
 * identity. #105 moved identity onto Sequencer's object/source and made the
 * name a pure classification key, and under that model animating ten siblings
 * whose actors did not change is wrong. The link-aware answer is the intended
 * one; these are not accidental return values.
 *
 * @see dev/tests/animation-token-resolution.test.mjs
 */

/**
 * Get the tokens on the current scene that an actor-scoped animation applies to.
 *
 * @param {Actor} actor - The actor whose animation changed
 * @returns {Token[]} The tokens to animate; empty when there is no scene
 */
export function getTokensForActor(actor) {
	if (!canvas.scene) return [];

	// For synthetic/unlinked tokens
	if (actor.isToken) {
		const token = canvas.tokens.get(actor.token?.id);
		return token ? [token] : [];
	}

	// For linked tokens, find all tokens on the scene
	return canvas.tokens.placeables.filter(t =>
		t.actor?.id === actor.id && t.document.actorLink
	);
}

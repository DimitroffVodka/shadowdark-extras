/**
 * Client-local duplicate guard for persistent idle animation layers.
 *
 * Sequencer broadcasts effect endings by IDs visible to the sending client.
 * A suspended/background client can retain an older effect ID that has already
 * disappeared from persistence and every other client. When the replacement
 * arrives, both sprites animate out of phase and look like they are vibrating.
 *
 * Cleanup must stay local: public `endEffects()` broadcasts and removes
 * persistent database flags, which would also delete the current replacement.
 */

const MODULE_EFFECT_PATTERN = /^shadowdark-extras-(?:torch|weapon|levelup)-/;
let _initialized = false;
let _cleanupTimer = null;

function getEffectId(effect) {
	return effect?.id ?? effect?.data?._id ?? "";
}

function getCreationTimestamp(effect) {
	const timestamp = Number(effect?.data?.creationTimestamp);
	return Number.isFinite(timestamp) ? timestamp : 0;
}

/**
 * Return stale duplicates while preserving one newest effect per visual layer.
 * zIndex distinguishes the torch prop/glow (2) from its flame/particles (3),
 * which intentionally share a name and source.
 *
 * @param {Array<object>} effects
 * @returns {Array<object>}
 */
export function getDuplicateAnimationEffects(effects = []) {
	const keepers = new Map();
	const duplicates = [];

	for (const effect of effects) {
		const data = effect?.data;
		if (!data || !MODULE_EFFECT_PATTERN.test(data.name ?? "") || !data.source) continue;

		const key = `${data.name}\u0000${data.source}\u0000${data.zIndex ?? ""}`;
		const keeper = keepers.get(key);
		if (!keeper) {
			keepers.set(key, effect);
			continue;
		}

		const keeperTimestamp = getCreationTimestamp(keeper);
		const effectTimestamp = getCreationTimestamp(effect);
		const effectIsNewer = effectTimestamp > keeperTimestamp
			|| (effectTimestamp === keeperTimestamp && getEffectId(effect) > getEffectId(keeper));

		if (effectIsNewer) {
			duplicates.push(keeper);
			keepers.set(key, effect);
		}
		else {
			duplicates.push(effect);
		}
	}

	return duplicates;
}

/**
 * Remove stale sprites from this client only. Sequencer's private remover is
 * used deliberately because its public API mutates persistence and broadcasts.
 *
 * @param {object} effectManager
 * @returns {Promise<number>}
 */
export async function removeDuplicateAnimationEffects(
	effectManager = globalThis.Sequencer?.EffectManager
) {
	if (!effectManager || typeof effectManager._removeEffect !== "function") return 0;

	const duplicates = getDuplicateAnimationEffects(effectManager.effects ?? []);
	for (const effect of duplicates) {
		if (effect?.isDestroyed) continue;
		await effectManager._removeEffect(effect);
	}
	return duplicates.length;
}

async function cleanClientDuplicates() {
	try {
		const count = await removeDuplicateAnimationEffects();
		if (count > 0) {
			console.warn(`shadowdark-extras | Removed ${count} stale local animation effect${count === 1 ? "" : "s"}`);
		}
	}
	catch(error) {
		console.warn("shadowdark-extras | Could not remove stale local animation effects", error);
	}
}

/** Register the guard once, regardless of which animation feature initializes first. */
export function initAnimationEffectDedup() {
	if (_initialized || !globalThis.Hooks || !globalThis.Sequencer?.EffectManager) return;
	_initialized = true;

	Hooks.on("sequencerEffectManagerReady", cleanClientDuplicates);
	Hooks.on("createSequencerEffect", effect => {
		if (!MODULE_EFFECT_PATTERN.test(effect?.data?.name ?? "")) return;
		clearTimeout(_cleanupTimer);
		_cleanupTimer = setTimeout(cleanClientDuplicates, 0);
	});
}

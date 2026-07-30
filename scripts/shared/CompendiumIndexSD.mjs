/**
 * Foundry v14 can cache a compendium document's frozen source object as an
 * index entry. A later getIndex({fields: ["system"]}) then tries to merge new
 * fields into that frozen object and throws. Replace only affected Item index
 * entries with mutable clones before Shadowdark prepares gear sheets.
 */
export function ensureMutableItemCompendiumIndexes(
	packs,
	clone = globalThis.foundry?.utils?.deepClone ?? globalThis.structuredClone
) {
	if (typeof clone !== "function") {
		throw new TypeError("A compendium index clone function is required");
	}

	let replacements = 0;
	for (const pack of packs ?? []) {
		if (pack?.metadata?.type !== "Item") continue;

		for (const [id, entry] of pack.index?.entries?.() ?? []) {
			if (!entry?.system || Object.isExtensible(entry.system)) continue;

			pack.index.set(id, {
				...entry,
				system: clone(entry.system),
			});
			replacements += 1;
		}
	}

	return replacements;
}

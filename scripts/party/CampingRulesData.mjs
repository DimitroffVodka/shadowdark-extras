/**
 * Pure camping activity data and legacy normalization.
 * Kept free of Foundry globals so the rules can be regression tested.
 */

export const DEFAULT_TRAVEL_ACTIVITIES = [
	{
		key: "battenDown",
		name: "Bed Down",
		abilities: ["WIS", "CON"],
		campfire: true,
		description: "Success: You do not need checks to benefit from this rest if your sleep is interrupted.",
		bannerImage: "modules/shadowdark-extras/assets/travel/batten_down.webp",
	},
	{
		key: "cook",
		name: "Cook",
		abilities: ["INT", "WIS"],
		campfire: true,
		description: "Success: Each character who consumes a ration gains +2 HP, up to 2 HP above maximum.",
		bannerImage: "modules/shadowdark-extras/assets/travel/cook.webp",
	},
	{
		key: "craft",
		name: "Craft",
		abilities: ["DEX"],
		campfire: true,
		description: "Success: Create 2d4 pieces of mundane weapon ammunition or one torch, or repair one broken piece of mundane gear.",
		bannerImage: "modules/shadowdark-extras/assets/travel/craft.webp",
	},
	{
		key: "entertain",
		name: "Entertain",
		abilities: ["CHA"],
		campfire: true,
		description: "Success: Grant 1 luck token to another character.",
		bannerImage: "modules/shadowdark-extras/assets/travel/entertain.webp",
	},
	{
		key: "firewood",
		name: "Firewood",
		abilities: ["STR", "CON"],
		campfire: false,
		description: "Success: Make one free campfire during this rest without expending torches.",
		bannerImage: "modules/shadowdark-extras/assets/travel/firewood.webp",
	},
	{
		key: "hunt",
		name: "Hunt",
		abilities: ["STR", "DEX"],
		campfire: false,
		description: "Success: Find 1d4 rations. You cannot hunt if you pushed during today's travel.",
		bannerImage: "modules/shadowdark-extras/assets/travel/hunt.webp",
	},
	{
		key: "keepWatch",
		name: "Keep Watch",
		abilities: ["WIS"],
		campfire: true,
		description: "Success: The party cannot be surprised during one half of the rest; choose which half.",
		bannerImage: "modules/shadowdark-extras/assets/travel/keep_watch.webp",
	},
	{
		key: "predict",
		name: "Predict",
		abilities: ["INT", "WIS"],
		campfire: false,
		description: "Success: After learning tomorrow's weather result, you may force it to be re-rolled.",
		bannerImage: "modules/shadowdark-extras/assets/travel/predict.webp",
	},
];

/**
 * Add newly supplied rule details to saved activities without replacing
 * intentional user customizations. The two known legacy Bed Down errors are
 * corrected only when their original shipped values are still present.
 * @param {Object[]} activities
 * @returns {Object[]}
 */
export function normalizeTravelActivities(activities = []) {
	const defaultsByKey = new Map(
		DEFAULT_TRAVEL_ACTIVITIES.map(activity => [activity.key, activity])
	);

	return activities.map(activity => {
		const normalized = {
			...activity,
			abilities: Array.isArray(activity?.abilities) ? [...activity.abilities] : [],
		};
		const defaultActivity = defaultsByKey.get(normalized.key);

		if (normalized.key === "battenDown") {
			if (normalized.name === "Batten Down") {
				normalized.name = "Bed Down";
			}
			if (
				normalized.abilities.length === 2
				&& normalized.abilities[0] === "INT"
				&& normalized.abilities[1] === "CON"
			) {
				normalized.abilities = ["WIS", "CON"];
			}
		}

		if (
			normalized.key === "cook"
			&& normalized.description
				=== "Success: Each character who consumes a ration gains +2 temporary HP for 1 day."
		) {
			normalized.description = defaultActivity.description;
		}

		if (
			defaultActivity
			&& !Object.prototype.hasOwnProperty.call(normalized, "description")
		) {
			normalized.description = defaultActivity.description;
		}

		return normalized;
	});
}

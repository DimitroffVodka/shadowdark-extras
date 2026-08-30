const DEFAULT_FILTERS = {
	colorMatrix: {
		hue: 0,
		brightness: 1,
		contrast: 1,
		saturate: 0,
	},
	glow: {
		enabled: false,
		distance: 10,
		outerStrength: 4,
		innerStrength: 0,
		color: "#ffffff",
		quality: 0.1,
		knockout: false,
	},
	dropShadow: {
		enabled: false,
		color: "#000000",
		alpha: 0.5,
		blur: 2,
		distance: 5,
		rotation: 45,
	},
};

const DEFAULT_CONFIG = {
	enabled: false,
	imagePath: "",
	offsetX: 0.35,
	offsetY: 0.1,
	rotation: 0,
	scale: 1,
	animationType: "wobble",
	flipX: false,
	flipY: false,
};

function withDefaults(source = {}) {
	const filters = source.filters ?? {};
	return {
		...DEFAULT_CONFIG,
		...source,
		filters: {
			...DEFAULT_FILTERS,
			...filters,
			colorMatrix: { ...DEFAULT_FILTERS.colorMatrix, ...filters.colorMatrix },
			glow: { ...DEFAULT_FILTERS.glow, ...filters.glow },
			dropShadow: { ...DEFAULT_FILTERS.dropShadow, ...filters.dropShadow },
		},
	};
}

/**
 * Build the equipped-sprite editor state without conflating "no item override"
 * with "disabled". The master preset remains authoritative until the user edits
 * sprite fields; an explicit item flag with enabled:false is terminal.
 */
export function resolveWeaponSpriteFormState(storedConfig, inheritedConfig) {
	const inherited = inheritedConfig?.enabled !== false && inheritedConfig?.imagePath
		? inheritedConfig
		: null;
	const custom = storedConfig?.enabled === true && storedConfig?.imagePath
		? storedConfig
		: null;
	const explicitlyDisabled = storedConfig?.enabled === false;

	let mode = "none";
	let source = {};
	if (custom) {
		mode = "custom";
		source = custom;
	}
	else if (explicitlyDisabled) {
		mode = "disabled";
		source = storedConfig?.imagePath ? storedConfig : (inherited ?? storedConfig ?? {});
	}
	else if (inherited) {
		mode = "inherited";
		source = inherited;
	}

	const config = withDefaults(source);
	config.enabled = mode === "custom" || mode === "inherited";

	return {
		mode,
		config,
		hasInherited: !!inherited,
		inherited,
		hasItemOverride: mode === "custom" || mode === "disabled",
	};
}

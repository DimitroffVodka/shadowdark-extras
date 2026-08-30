import { generateAnimationFxConfigHTML } from "./AnimationFxConfig.mjs";
import { activateAnimationFxListeners } from "../item-sheets/activity-tab-widgets.mjs";

const MODULE_ID = "shadowdark-extras";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Standalone per-weapon editor for transient attack effects. */
export default class WeaponAttackFxConfig extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "weapon-attack-fx-config-{id}",
		classes: ["shadowdark", "shadowdark-extras", "weapon-attack-fx-config"],
		tag: "div",
		window: {
			frame: true,
			positioned: true,
			icon: "fas fa-wand-magic-sparkles",
			resizable: true,
			minimizable: false,
		},
		position: {
			width: 680,
			height: 720,
		},
		actions: {
			close: WeaponAttackFxConfig.#onClose,
		},
	};

	static PARTS = {
		form: {
			template: `modules/${MODULE_ID}/templates/weapon-attack-fx-config.hbs`,
		},
	};

	constructor(options = {}) {
		super(options);
		this.item = options.item;
	}

	get effectHeading() {
		return this.item?.type === "Spell"
			? game.i18n.localize("SHADOWDARK_EXTRAS.weaponAnimation.spellFxButton")
			: game.i18n.localize("SHADOWDARK_EXTRAS.weaponAnimation.attackFxButton");
	}

	get title() {
		return `${this.effectHeading}: ${this.item?.name ?? "Item"}`;
	}

	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		context.configHtml = generateAnimationFxConfigHTML(
			MODULE_ID,
			this.item?.flags?.[MODULE_ID] ?? {},
			this.item,
			{
				heading: this.effectHeading,
			}
		);
		return context;
	}

	_onRender(context, options) {
		super._onRender(context, options);
		activateAnimationFxListeners($(this.element), this.item);
	}

	static #onClose() {
		this.close();
	}
}

export function openWeaponAttackFxConfig(item) {
	return new WeaponAttackFxConfig({ item }).render(true);
}

/**
 * Light templates: the default table, the resolver, and the editor app.
 *
 * Moved verbatim out of the composition root. Custom light templates are
 * stored in the `customLightTemplates` setting and replace what used to be a
 * hardcoded EXTRA_LIGHT_SOURCES list.
 *
 * canvas/ because lighting is a canvas concern and `LightTrackerAppSD.mjs`,
 * the other consumer of light-source data, already lives here.
 *
 * `getCustomLightSources` was one of the composition root's only two
 * `export`s, and `party/PartySheetSD.mjs` imported it FROM the root. That is
 * the feature→root direction this track exists to remove, so the import now
 * points here instead and the root is left with a single export.
 *
 * Zero registrations, so the registration snapshot is untouched. The
 * api-export snapshot DOES change — see the commit message.
 */

import { MODULE_ID } from "../shared/module-id.mjs";

// Default light templates (replacing hardcoded EXTRA_LIGHT_SOURCES)
export const DEFAULT_LIGHT_TEMPLATES = [
	{
		key: "candle",
		name: "Candle",
		bright: 5,
		dim: 5,
		angle: 360,
		color: "#d1c846",
		alpha: 0.2,
		animationType: "torch",
		animationSpeed: 1,
		animationIntensity: 1,
		animationReverse: false,
		coloration: 1,
		attenuation: 0.5,
		luminosity: 0.5,
		saturation: 0,
		contrast: 0,
		shadows: 0,
		darknessMin: 0,
		darknessMax: 1,
		priority: 0,
		negative: false
	}
];

/**
 * Get custom light sources from settings
 * @returns {Object} object with keys as template IDs and values as template data
 */
export function getCustomLightSources() {
	const templates = game.settings.get(MODULE_ID, "customLightTemplates") || DEFAULT_LIGHT_TEMPLATES;

	const sources = {};
	for (const t of templates) {
		sources[t.key] = {
			lang: t.name, // Used for dropdown label
			light: {
				alpha: t.alpha,
				angle: t.angle,
				animation: {
					speed: t.animationSpeed,
					intensity: t.animationIntensity,
					reverse: t.animationReverse,
					type: t.animationType
				},
				attenuation: t.attenuation,
				bright: t.bright,
				color: t.color,
				coloration: t.coloration,
				contrast: t.contrast,
				darkness: {
					min: t.darknessMin,
					max: t.darknessMax
				},
				dim: t.dim,
				luminosity: t.luminosity,
				saturation: t.saturation,
				shadows: t.shadows,
				priority: t.priority,
				negative: t.negative
			}
		};
	}

	return sources;
}

/**
 * Application for editing custom light templates
 */
export class LightTemplateEditor extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "sdx-light-editor",
		classes: ["shadowdark-extras", "light-editor"],
		tag: "form",
		window: {
			title: "Light Template Editor",
			resizable: true
		},
		position: {
			width: 600,
			height: "auto"
		},
		form: {
			handler: LightTemplateEditor.formHandler,
			submitOnChange: false,
			closeOnSubmit: false
		}
	};

	static PARTS = {
		form: {
			template: `modules/shadowdark-extras/templates/light-template-editor.hbs`
		}
	};

	constructor(options = {}) {
		super(options);
		this.editData = null;
	}

	async _prepareContext(options) {
		const templates = game.settings.get(MODULE_ID, "customLightTemplates") || foundry.utils.deepClone(DEFAULT_LIGHT_TEMPLATES);

		// Animation types for select dropdown
		const animationTypes = {
			"": "None",
			"torch": "Torch",
			"pulse": "Pulse",
			"chroma": "Chroma",
			"wave": "Wave",
			"fog": "Fog",
			"sunburst": "Sunburst",
			"dome": "Light Dome",
			"emanation": "Mysterious Emanation",
			"hexa": "Hexa Dome",
			"ghost": "Ghostly Light",
			"energy": "Energy Field",
			"roiling": "Roiling Mass",
			"hole": "Black Hole"
		};
		// Add more from core if needed, but these are common

		// Coloration techniques
		const colorationTechniques = {
			0: "Legacy Coloration",
			1: "Adaptive Luminance",
			2: "Internal Halo",
			3: "External Halo",
			4: "Color Burn",
			5: "Internal Color Burn",
			6: "External Color Burn",
			7: "Low Absorption",
			8: "High Absorption",
			9: "Invert Absorption",
			10: "Natural Light"
		};

		return {
			templates,
			isEditing: !!this.editData,
			editData: this.editData,
			animationTypes,
			colorationTechniques
		};
	}

	_onRender(context, options) {
		const root = this.element;
		if (!root) return;
		const html = $(root);

		// Add Template
		html.find('[data-action="addTemplate"]').on('click', () => {
			this.editData = {
				key: "",
				name: "",
				bright: 10,
				dim: 20,
				angle: 360,
				color: "#ffffff",
				alpha: 0.5,
				animationType: "",
				animationSpeed: 5,
				animationIntensity: 5,
				animationReverse: false,
				coloration: 1,
				attenuation: 0.5,
				luminosity: 0.5,
				saturation: 0,
				contrast: 0,
				shadows: 0,
				darknessMin: 0,
				darknessMax: 1,
				priority: 0,
				negative: false
			};
			this.render(true);
		});

		// Edit Template
		html.find('[data-action="editTemplate"]').on('click', (ev) => {
			const index = $(ev.currentTarget).data('index');
			const templates = game.settings.get(MODULE_ID, "customLightTemplates") || DEFAULT_LIGHT_TEMPLATES;
			this.editData = { ...templates[index], id: index }; // Use index as ID for update
			this.render(true);
		});

		// Duplicate Template
		html.find('[data-action="duplicateTemplate"]').on('click', async (ev) => {
			const index = $(ev.currentTarget).data('index');
			const templates = game.settings.get(MODULE_ID, "customLightTemplates") || DEFAULT_LIGHT_TEMPLATES;
			const template = foundry.utils.deepClone(templates[index]);

			template.name = `${template.name} (Copy)`;
			template.key = `${template.key}_copy`;

			const newTemplates = [...templates, template];
			await game.settings.set(MODULE_ID, "customLightTemplates", newTemplates);
			this.render(true);
		});

		// Delete Template
		html.find('[data-action="deleteTemplate"]').on('click', async (ev) => {
			const index = $(ev.currentTarget).data('index');
			const templates = game.settings.get(MODULE_ID, "customLightTemplates") || DEFAULT_LIGHT_TEMPLATES;

			const confirmed = await foundry.applications.api.DialogV2.confirm({
				window: { title: "Delete Light Template" },
				content: `<p>Are you sure you want to delete <strong>${templates[index].name}</strong>?</p>`,
				modal: true
			});

			if (confirmed) {
				const newTemplates = templates.filter((_, i) => i !== index);
				await game.settings.set(MODULE_ID, "customLightTemplates", newTemplates);
				this.render(true);
			}
		});

		// Cancel Edit
		html.find('[data-action="cancelEdit"]').on('click', () => {
			this.editData = null;
			this.render(true);
		});

		// Tab navigation
		if (this.editData) {
			const tabs = new foundry.applications.ux.Tabs({
				navSelector: ".sheet-tabs",
				contentSelector: ".content",
				initial: "basic",
				callback: () => { }
			});
			tabs.bind(root);
		}
	}

	static async formHandler(event, form, formData) {
		const flat = formData.object;
		if (!this.editData) return; // Only process submit in edit mode

		const templates = game.settings.get(MODULE_ID, "customLightTemplates") || foundry.utils.deepClone(DEFAULT_LIGHT_TEMPLATES);

		// Helper to properly handle checkboxes and numbers
		const processFormData = (data) => {
			// Auto-generate key from name if empty
			let key = data.key;

			// If key is undefined (disabled input during edit), use existing key
			if (key === undefined && this.editData.id !== undefined) {
				key = this.editData.key;
			}

			if (!key && data.name) {
				key = data.name.toLowerCase()
					.replace(/[^a-z0-9]+/g, "_")
					.replace(/^_+|_+$/g, "");
			}

			return {
				key: key,
				name: data.name,
				bright: Number(data.bright),
				dim: Number(data.dim),
				angle: Number(data.angle),
				color: data.color,
				alpha: Number(data.alpha),
				priority: Number(data.priority),
				negative: Boolean(data.negative),
				animationType: data.animationType,
				animationSpeed: Number(data.animationSpeed),
				animationIntensity: Number(data.animationIntensity),
				animationReverse: Boolean(data.animationReverse),
				coloration: Number(data.coloration),
				attenuation: Number(data.attenuation),
				luminosity: Number(data.luminosity),
				saturation: Number(data.saturation),
				contrast: Number(data.contrast),
				shadows: Number(data.shadows),
				darknessMin: 0, // Hidden fields kept default
				darknessMax: 1
			};
		};

		const newTemplateData = processFormData(flat);

		// Validate Key
		if (!newTemplateData.key.match(/^[a-zA-Z0-9_]+$/)) {
			ui.notifications.error("Invalid Key. Only alphanumeric characters and underscores are allowed.");
			return;
		}

		if (this.editData.id !== undefined) {
			templates[this.editData.id] = newTemplateData;
		} else {
			if (templates.some(t => t.key === newTemplateData.key)) {
				ui.notifications.error(`Template with key "${newTemplateData.key}" already exists.`);
				return;
			}
			templates.push(newTemplateData);
		}

		await game.settings.set(MODULE_ID, "customLightTemplates", templates);

		this.editData = null;
		this.render({ force: true });
	}
}

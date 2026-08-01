/**
 * The root's SKILLS BOX section, moved verbatim.
 *
 * Injects the skills box into the Player sheet. Registration-free, and apart
 * from MODULE_ID it depended on nothing outside itself, so this is a clean
 * lift with one export: `injectSkillsBox`, called from the sheet dispatch.
 *
 * Zero registrations, so the registration snapshot is untouched.
 */

import { MODULE_ID } from "../shared/module-id.mjs";

// ============================================
// SKILLS BOX
// ============================================

/**
 * Escape a string for safe interpolation into HTML
 */
function escapeHtmlSkills(str) {
	return String(str)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

/**
 * Inject the Skills SD-box into the Abilities tab right column
 */
export function injectSkillsBox(html, actor) {
	if (actor.type !== "Player") return;

	const $abilitiesTab = html.find('.tab[data-tab="tab-abilities"]');
	if (!$abilitiesTab.length) return;
	if ($abilitiesTab.find(".sdx-skills-box").length) return;

	const $gridRight = $abilitiesTab.find(".grid-1-columns");
	if (!$gridRight.length) return;

	const skills = actor.getFlag(MODULE_ID, "skills") || [];
	const isOwner = actor.isOwner;

	const skillRowsHtml = skills.map(skill => {
		const abilityLabel = skill.ability !== "none"
			? skill.ability.charAt(0).toUpperCase() + skill.ability.slice(1)
			: "";
		return `
			<div class="sdx-skill-row" data-skill-id="${skill.id}">
				<span class="sdx-skill-name">${escapeHtmlSkills(skill.name)}</span>
				<span class="sdx-skill-ability">${abilityLabel}</span>
				<span class="sdx-skill-actions">
					<a class="sdx-skill-roll" data-skill-id="${skill.id}" data-skill-name="${escapeHtmlSkills(skill.name)}" data-skill-ability="${skill.ability}"><i class="fas fa-dice-d20"></i></a>
					${isOwner ? `<a class="sdx-skill-edit" data-skill-id="${skill.id}"><i class="fas fa-pen"></i></a>
					<a class="sdx-skill-delete" data-skill-id="${skill.id}"><i class="fas fa-times"></i></a>` : ""}
				</span>
			</div>`;
	}).join("");

	const skillsBoxHtml = `
		<div class="SD-box sdx-skills-box">
			<div class="header">
				<label>Skills</label>
				<span>${isOwner ? '<a class="sdx-skills-add-btn"><i class="fas fa-plus"></i></a>' : ""}</span>
			</div>
			<div class="content">
				<div class="sdx-skills-list">
					${skillRowsHtml}
				</div>
			</div>
		</div>`;

	$gridRight.append(skillsBoxHtml);

	// Roll (any viewer can roll)
	$gridRight.find(".sdx-skill-roll").on("click", async function() {
		await rollSkill(actor, $(this).data("skill-name"), $(this).data("skill-ability"));
	});

	if (!isOwner) return;

	// Add
	$gridRight.find(".sdx-skills-add-btn").on("click", () => {
		openSkillDialog(actor, null);
	});

	// Edit
	$gridRight.find(".sdx-skill-edit").on("click", function() {
		const skillId = $(this).data("skill-id");
		const skill = (actor.getFlag(MODULE_ID, "skills") || []).find(s => s.id === skillId);
		if (skill) openSkillDialog(actor, skill);
	});

	// Delete
	$gridRight.find(".sdx-skill-delete").on("click", async function() {
		const skillId = $(this).data("skill-id");
		const skills = (actor.getFlag(MODULE_ID, "skills") || []).filter(s => s.id !== skillId);
		await actor.setFlag(MODULE_ID, "skills", skills);
	});
}

/**
 * Open DialogV2 to add or edit a skill
 */
function openSkillDialog(actor, existingSkill) {
	const abilities = ["none", "str", "dex", "con", "int", "wis", "cha"];
	const abilityLabels = { none: "None", str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA" };

	const optionsHtml = abilities.map(ab =>
		`<option value="${ab}" ${existingSkill?.ability === ab ? "selected" : ""}>${abilityLabels[ab]}</option>`
	).join("");

	const dialog = new foundry.applications.api.DialogV2({
		window: {
			title: existingSkill ? "Edit Skill" : "Add Skill",
			icon: "fas fa-star",
		},
		content: `
			<div class="form-group">
				<label>Name</label>
				<div class="form-fields">
					<input type="text" name="name" value="${escapeHtmlSkills(existingSkill?.name || "")}" autofocus />
				</div>
			</div>
			<div class="form-group">
				<label>Ability Modifier</label>
				<div class="form-fields">
					<select name="ability">${optionsHtml}</select>
				</div>
			</div>`,
		buttons: [
			{
				action: "cancel",
				label: "Cancel",
				icon: "fas fa-times",
			},
			{
				action: "save",
				label: "Save",
				icon: "fas fa-check",
				default: true,
				callback: async (event, button, dialogApp) => {
					const name = dialogApp.element.querySelector('input[name="name"]').value.trim();
					const ability = dialogApp.element.querySelector('select[name="ability"]').value;
					if (!name) {
						ui.notifications.warn("Please enter a skill name.");
						return false;
					}
					let skills = actor.getFlag(MODULE_ID, "skills") || [];
					if (existingSkill) {
						skills = skills.map(s => s.id === existingSkill.id ? { ...s, name, ability } : s);
					} else {
						skills.push({ id: foundry.utils.randomID(), name, ability });
					}
					await actor.setFlag(MODULE_ID, "skills", skills);
					return true;
				},
			},
		],
	});

	dialog.render({ force: true });
}

/**
 * Roll 1d20 + ability mod for a skill, posting to chat
 */
async function rollSkill(actor, skillName, ability) {
	const abilityMod = ability !== "none" ? (actor.system.abilities[ability]?.mod ?? 0) : 0;

	const abilityLabel = ability !== "none"
		? ability.charAt(0).toUpperCase() + ability.slice(1)
		: "None";

	const dialogContent = `
		<form>
			<div class="form-group">
				<label>Ability (${abilityLabel})</label>
				<div class="form-fields">
					<input type="number" disabled value="${abilityMod}" style="text-align: center;">
				</div>
			</div>
			<div class="form-group">
				<label>Bonus</label>
				<div class="form-fields">
					<input type="number" name="bonus" value="0" autofocus style="text-align: center;">
				</div>
			</div>
			<div class="form-group">
				<label>Rolling Mode</label>
				<div class="form-fields">
					<select name="rollMode">
						<option value="publicroll">Public Roll</option>
						<option value="gmroll">Private GM Roll</option>
						<option value="blindroll">Blind GM Roll</option>
						<option value="selfroll">Self Roll</option>
					</select>
				</div>
			</div>
		</form>
	`;

	const dialog = new foundry.applications.api.DialogV2({
		window: { title: `Roll ${skillName}` },
		content: dialogContent,
		buttons: [
			{
				action: "advantage",
				label: "Advantage",
				callback: (event, button, dialog) => processRoll("advantage", dialog),
			},
			{
				action: "normal",
				label: "Normal",
				default: true,
				callback: (event, button, dialog) => processRoll("normal", dialog),
			},
			{
				action: "disadvantage",
				label: "Disadvantage",
				callback: (event, button, dialog) => processRoll("disadvantage", dialog),
			},
		],
		submit: (result) => {
			// fallback if enter pressed (defaults to normal via default button, but just in case)
			return "normal";
		},
	});

	dialog.render(true);

	async function processRoll(mode, dialogApp) {
		const bonusInput = dialogApp.element.querySelector('input[name="bonus"]');
		const rollModeInput = dialogApp.element.querySelector('select[name="rollMode"]');
		const bonus = parseInt(bonusInput.value) || 0;
		const rollMode = rollModeInput.value;

		let d20 = "1d20";
		if (mode === "advantage") d20 = "2d20kh";
		else if (mode === "disadvantage") d20 = "2d20kl";

		// Construct formula
		const parts = [d20];
		if (abilityMod !== 0) parts.push(abilityMod);
		if (bonus !== 0) parts.push(bonus);

		const formula = parts.join(" + ");

		const roll = await new Roll(formula).evaluate();

		// Flavor text
		let flavor = `<b>${escapeHtmlSkills(skillName)}</b>`;
		const flavorParts = [];
		if (ability !== "none") flavorParts.push(`${abilityLabel} mod: ${abilityMod >= 0 ? "+" + abilityMod : abilityMod}`);
		if (bonus !== 0) flavorParts.push(`Bonus: ${bonus >= 0 ? "+" + bonus : bonus}`);

		if (flavorParts.length > 0) {
			flavor += ` (${flavorParts.join(", ")})`;
		}

		if (mode === "advantage") flavor += " (Advantage)";
		else if (mode === "disadvantage") flavor += " (Disadvantage)";

		await roll.toMessage({
			speaker: ChatMessage.getSpeaker({ actor }),
			flavor: flavor,
		}, {
			rollMode: rollMode,
		});
	}
}

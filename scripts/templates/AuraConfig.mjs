/**
 * Aura Configuration UI
 * Generates HTML for the aura configuration section in spell/scroll/wand Activity tab
 */

const MODULE_ID = "shadowdark-extras";

function normalizeTokenMagicPresetEntries(source, allowedLibraries = null) {
    const entries = [];
    const pushEntry = (value, fallbackName = null) => {
        if (!value) return;
        if (typeof value === 'string') {
            entries.push({ name: value });
            return;
        }
        if (typeof value !== 'object') return;
        if (allowedLibraries && value.library && !allowedLibraries.has(value.library)) return;
        const name = value.name || value.label || value.title || value.id || fallbackName;
        if (!name || name === 'NOFX') return;
        entries.push({ name: String(name) });
    };

    if (Array.isArray(source)) {
        for (const entry of source) pushEntry(entry);
    } else if (source instanceof Map) {
        for (const [key, value] of source.entries()) pushEntry(value, key);
    } else if (source && typeof source === 'object') {
        for (const [key, value] of Object.entries(source)) pushEntry(value, key);
    }

    return entries;
}

function getTokenMagicRegionPresets() {
    if (!globalThis.TokenMagic) return [];

    const presets = [];
    const allowedLibraries = new Set(['tmfx-region', 'tmfx-template', 'tmfx-main']);
    const addPresets = (source) => presets.push(...normalizeTokenMagicPresetEntries(source, allowedLibraries));
    const tokenMagic = globalThis.TokenMagic;

    try {
        if (typeof tokenMagic.getPresets === 'function') {
            addPresets(tokenMagic.getPresets('tmfx-region'));
            addPresets(tokenMagic.getPresets('tmfx-template'));
            addPresets(tokenMagic.getPresets('tmfx-main'));
        }
    } catch (e) {
        console.warn('shadowdark-extras | Failed to read TokenMagic aura presets:', e);
    }

    for (const key of ['presets', 'Presets', 'defaultPresets', 'templatePresets', 'tmfxPresets', '_presets']) {
        try {
            addPresets(tokenMagic[key]);
        } catch (e) {
            // Ignore unstable TokenMagic internals.
        }
    }

    for (const settingKey of ['presets', 'templatePresets', 'defaultPresets', 'customPresets', 'tmfxPresets']) {
        try {
            addPresets(game.settings.get('tokenmagic', settingKey));
        } catch (e) {
            // Setting may not exist in this TokenMagic version.
        }
    }

    const seen = new Set();
    return presets
        .filter(p => {
            const name = p?.name?.trim?.();
            if (!name || seen.has(name)) return false;
            seen.add(name);
            return true;
        })
        .sort((a, b) => a.name.localeCompare(b.name));
}

function getIndyFxShaderChoices() {
    try {
        const choices = globalThis.game?.indyFX?.shaders?.choices?.();
        if (!choices || typeof choices !== 'object') return [];
        return Object.entries(choices)
            .map(([id, label]) => ({ id: String(id), label: String(label || id) }))
            .filter(shader => shader.id)
            .sort((a, b) => a.label.localeCompare(b.label));
    } catch (e) {
        console.warn('shadowdark-extras | Failed to read Indy FX aura shader choices:', e);
        return [];
    }
}

function escapeAttribute(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[c]));
}

/**
 * Generate the Aura Effects configuration HTML
 * @param {string} MODULE_ID - The module ID
 * @param {Object} flags - The item flags
 * @returns {string} HTML string for the aura effects configuration
 */
export function generateAuraConfigHTML(moduleId, flags) {
    const auraConfig = flags.auraEffects || {
        enabled: false,
        attachTo: 'caster', // 'caster' or 'target'
        radius: 30,
        triggers: {
            onEnter: false,
            onLeave: false,
            onTurnStart: false,
            onTurnEnd: false
        },
        damage: {
            formula: '',
            type: ''
        },
        save: {
            enabled: false,
            dc: 12,
            ability: 'con',
            halfOnSuccess: false
        },
        nativeRegion: {
            enabled: true,
            color: '#ffffff'
        },
        visualFx: {
            engine: 'none',
            tmfx: {
                preset: 'NOFX',
                tint: '',
                opacity: 0.5
            },
            indy: {
                shaderId: '',
                alpha: 1,
                speed: 1,
                scale: 1,
                layer: 'inherit'
            }
        },
        tokenFilters: {
            enabled: false,
            preset: ''
        },
        disposition: 'all',
        includeSelf: false,
        applyToOriginator: true,
        checkVisibility: false,
        applyConfiguredEffects: false,
        effectsTriggers: {
            onEnter: false,
            onTurnStart: false,
            onTurnEnd: false
        },
        damageTriggers: {
            onEnter: false,
            onTurnStart: false,
            onTurnEnd: false
        },
        runItemMacro: false,
        macroTriggers: {
            onEnter: false,
            onTurnStart: false,
            onTurnEnd: false
        }
    };

    const enabled = auraConfig.enabled || false;
    const attachTo = auraConfig.attachTo || 'caster';
    const radius = auraConfig.radius || 30;
    const triggers = auraConfig.triggers || {};
    const damage = auraConfig.damage || {};
    const save = auraConfig.save || {};
    const nativeRegion = auraConfig.nativeRegion || {};
    const nativeRegionEnabled = nativeRegion.enabled !== false;
    const nativeRegionColor = nativeRegion.color || '#ffffff';
    const visualFx = auraConfig.visualFx || {};
    const tmfx = visualFx.tmfx || {};
    const indyFx = visualFx.indy || {};
    const tokenFilters = auraConfig.tokenFilters || {};
    const disposition = auraConfig.disposition || 'all';
    const includeSelf = auraConfig.includeSelf || false;
    const applyToOriginator = auraConfig.applyToOriginator !== false; // default true
    const checkVisibility = auraConfig.checkVisibility || false;
    const applyConfiguredEffects = auraConfig.applyConfiguredEffects || false;
    const effectsTriggers = auraConfig.effectsTriggers || {};
    const damageTriggers = auraConfig.damageTriggers || {};
    const runItemMacro = auraConfig.runItemMacro || false;
    const macroTriggers = auraConfig.macroTriggers || {};

    // Check if TokenMagic module is active for token filters
    const tokenMagicActive = game.modules.get('tokenmagic')?.active ?? false;
    const indyFxActive = game.modules.get('indy-fx')?.active && Boolean(game.indyFX?.shaders?.choices);
    const auraFxEngine = visualFx.engine || (tokenMagicActive ? 'tmfx' : (indyFxActive ? 'indy' : 'none'));
    const tmPreset = tmfx.preset || 'NOFX';
    const tmTint = tmfx.tint || '';
    const tmOpacity = tmfx.opacity ?? 0.5;
    const indyShaderId = indyFx.shaderId || '';
    const indyAlpha = indyFx.alpha ?? 1;
    const indySpeed = indyFx.speed ?? 1;
    const indyScale = indyFx.scale ?? 1;
    const indyLayer = indyFx.layer || 'inherit';

    // Get TokenMagic presets for token filters
    let tmTokenPresets = [];
    if (tokenMagicActive && globalThis.TokenMagic?.getPresets) {
        try {
            tmTokenPresets = TokenMagic.getPresets('tmfx-main') || [];
        } catch (e) {
            console.warn('shadowdark-extras | Failed to get TokenMagic token presets:', e);
        }
    }

    let tmRegionPresets = tokenMagicActive ? getTokenMagicRegionPresets() : [];
    if (tmPreset && tmPreset !== 'NOFX' && !tmRegionPresets.some(p => p.name === tmPreset)) {
        tmRegionPresets = [{ name: tmPreset }, ...tmRegionPresets];
    }

    let indyShaders = indyFxActive ? getIndyFxShaderChoices() : [];
    if (indyShaderId && !indyShaders.some(s => s.id === indyShaderId)) {
        indyShaders = [{ id: indyShaderId, label: indyShaderId }, ...indyShaders];
    }

    return `
        <div class="sdx-aura-effects-section" style="grid-column: 1 / -1; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--color-border-light-tertiary);">
            <h3 style="margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
                <i class="fas fa-circle-notch" style="color: #4488ff;"></i> 
                Aura Effects
                <label style="margin-left: auto; font-weight: normal; font-size: 12px;">
                    <input type="checkbox" 
                        name="flags.${moduleId}.auraEffects.enabled"
                        class="sdx-aura-effects-enabled"
                        ${enabled ? 'checked' : ''}>
                    Enable
                </label>
            </h3>
            
            <div class="sdx-aura-effects-config" style="${enabled ? '' : 'opacity: 0.5; pointer-events: none;'}">
                <!-- Attach To & Size Row -->
                <div class="SD-grid" style="grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
                    <div>
                        <label style="font-size: 11px; color: #999; display: block; margin-bottom: 4px;">Attach To</label>
                        <div style="display: flex; gap: 12px;">
                            <label style="display: flex; align-items: center; gap: 4px;">
                                <input type="radio" 
                                    name="flags.${moduleId}.auraEffects.attachTo"
                                    value="caster"
                                    ${attachTo === 'caster' ? 'checked' : ''}>
                                <span>Caster</span>
                            </label>
                            <label style="display: flex; align-items: center; gap: 4px;">
                                <input type="radio" 
                                    name="flags.${moduleId}.auraEffects.attachTo"
                                    value="target"
                                    ${attachTo === 'target' ? 'checked' : ''}>
                                <span>Target</span>
                            </label>
                        </div>
                    </div>
                    <div>
                        <label style="font-size: 11px; color: #999;">Radius (feet)</label>
                        <input type="number" 
                            name="flags.${moduleId}.auraEffects.radius"
                            value="${radius}"
                            min="5" max="300" step="5"
                            style="width: 100%;">
                    </div>
                </div>

                <div class="SD-grid" style="grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
                    <label class="sdx-checkbox-option" style="display: flex; align-items: center; gap: 6px;" title="Create a native Foundry Region attached to the aura bearer, so the visible area follows the caster or target token.">
                        <input type="checkbox"
                            name="flags.${moduleId}.auraEffects.nativeRegion.enabled"
                            ${nativeRegionEnabled ? 'checked' : ''}>
                        <span>Follow with Region</span>
                    </label>
                    <div>
                        <label style="font-size: 11px; color: #999;">Region Color</label>
                        <div style="display: flex; gap: 4px; align-items: center;">
                            <input type="color"
                                name="flags.${moduleId}.auraEffects.nativeRegion.color"
                                value="${nativeRegionColor}"
                                style="width: 100%;">
                        </div>
                    </div>
                </div>

                ${(tokenMagicActive || indyFxActive) ? `
                <div class="sdx-aura-visual-fx-section" style="margin-bottom: 12px; padding-top: 8px; border-top: 1px dashed var(--color-border-light-tertiary);">
                    <h4 style="margin: 0 0 8px 0;">
                        <i class="fas fa-magic"></i> Aura Visual FX
                    </h4>
                    <div class="SD-grid" style="grid-template-columns: 1fr 2fr; gap: 8px; align-items: center;">
                        <label>Engine</label>
                        <select name="flags.${moduleId}.auraEffects.visualFx.engine" class="sdx-aura-fx-engine-select">
                            <option value="none" ${auraFxEngine === 'none' ? 'selected' : ''}>None</option>
                            ${tokenMagicActive ? `<option value="tmfx" ${auraFxEngine === 'tmfx' ? 'selected' : ''}>TokenMagic FX</option>` : ''}
                            ${indyFxActive ? `<option value="indy" ${auraFxEngine === 'indy' ? 'selected' : ''}>Indy FX</option>` : ''}
                        </select>
                    </div>

                    ${tokenMagicActive ? `
                    <div class="SD-grid sdx-aura-tmfx-settings" style="grid-template-columns: 1fr 2fr; gap: 8px; align-items: center; margin-top: 8px; ${auraFxEngine === 'tmfx' ? '' : 'display: none;'}">
                        <label>Special Effect</label>
                        <select name="flags.${moduleId}.auraEffects.visualFx.tmfx.preset">
                            <option value="NOFX" ${tmPreset === 'NOFX' ? 'selected' : ''}>None</option>
                            ${tmRegionPresets.map(p => `<option value="${escapeAttribute(p.name)}" ${tmPreset === p.name ? 'selected' : ''}>${escapeAttribute(p.name)}</option>`).join('')}
                        </select>

                        <label>Effect Tint</label>
                        <input type="color"
                            name="flags.${moduleId}.auraEffects.visualFx.tmfx.tint"
                            value="${tmTint || '#ffffff'}">

                        <label>Opacity</label>
                        <input type="number"
                            name="flags.${moduleId}.auraEffects.visualFx.tmfx.opacity"
                            value="${tmOpacity}"
                            min="0" max="1" step="0.05">
                    </div>
                    ` : ''}

                    ${indyFxActive ? `
                    <div class="SD-grid sdx-aura-indyfx-settings" style="grid-template-columns: 1fr 2fr; gap: 8px; align-items: center; margin-top: 8px; ${auraFxEngine === 'indy' ? '' : 'display: none;'}">
                        <label>Shader</label>
                        <select name="flags.${moduleId}.auraEffects.visualFx.indy.shaderId">
                            <option value="" ${!indyShaderId ? 'selected' : ''}>Choose shader...</option>
                            ${indyShaders.map(s => `<option value="${escapeAttribute(s.id)}" ${indyShaderId === s.id ? 'selected' : ''}>${escapeAttribute(s.label)}</option>`).join('')}
                        </select>

                        <label>Alpha</label>
                        <input type="number" name="flags.${moduleId}.auraEffects.visualFx.indy.alpha" value="${indyAlpha}" min="0" max="1" step="0.05">

                        <label>Speed</label>
                        <input type="number" name="flags.${moduleId}.auraEffects.visualFx.indy.speed" value="${indySpeed}" min="0" max="10" step="0.05">

                        <label>Scale</label>
                        <input type="number" name="flags.${moduleId}.auraEffects.visualFx.indy.scale" value="${indyScale}" min="0.1" max="10" step="0.05">

                        <label>Layer</label>
                        <select name="flags.${moduleId}.auraEffects.visualFx.indy.layer">
                            <option value="inherit" ${indyLayer === 'inherit' ? 'selected' : ''}>Inherit</option>
                            <option value="interfacePrimary" ${indyLayer === 'interfacePrimary' ? 'selected' : ''}>Above tokens</option>
                            <option value="belowTokens" ${indyLayer === 'belowTokens' ? 'selected' : ''}>Below tokens</option>
                            <option value="belowTiles" ${indyLayer === 'belowTiles' ? 'selected' : ''}>Below tiles</option>
                            <option value="sceneRaw" ${indyLayer === 'sceneRaw' ? 'selected' : ''}>Scene raw</option>
                            <option value="drawings" ${indyLayer === 'drawings' ? 'selected' : ''}>Drawings</option>
                        </select>
                    </div>
                    ` : ''}
                </div>
                ` : ''}

                <!-- Triggers Row -->
                <div style="margin-bottom: 12px;">
                    <label style="font-size: 11px; color: #999; display: block; margin-bottom: 2px;">When to Apply Effects</label>
                    <span style="font-size: 9px; color: #aaa; display: block; margin-bottom: 6px;">Default triggers for damage, effects, and macros. Override per-component below.</span>
                    <div class="SD-grid" style="grid-template-columns: 1fr 1fr; gap: 8px;">
                        <label class="sdx-checkbox-option" style="display: flex; align-items: center; gap: 4px;" title="Apply effects when a token enters the aura">
                            <input type="checkbox" 
                                name="flags.${moduleId}.auraEffects.triggers.onEnter"
                                ${triggers.onEnter ? 'checked' : ''}>
                            <span>On Enter</span>
                        </label>
                        <label class="sdx-checkbox-option" style="display: flex; align-items: center; gap: 4px;" title="REMOVE applied effects when a token leaves the aura">
                            <input type="checkbox" 
                                name="flags.${moduleId}.auraEffects.triggers.onLeave"
                                ${triggers.onLeave ? 'checked' : ''}>
                            <span>Remove effect on leave</span>
                        </label>
                    </div>
                    <div class="SD-grid" style="grid-template-columns: 1fr 1fr 1fr 1fr; gap: 8px; margin-top: 8px;">
                        <label class="sdx-checkbox-option" style="display: flex; align-items: center; gap: 4px;" title="Triggers when the aura SOURCE's turn starts (affects all tokens in aura)">
                            <input type="checkbox" 
                                name="flags.${moduleId}.auraEffects.triggers.onSourceTurnStart"
                                ${triggers.onSourceTurnStart ? 'checked' : ''}>
                            <span style="font-size: 10px;">Source Turn Start</span>
                        </label>
                        <label class="sdx-checkbox-option" style="display: flex; align-items: center; gap: 4px;" title="Triggers when the aura SOURCE's turn ends (affects all tokens in aura)">
                            <input type="checkbox" 
                                name="flags.${moduleId}.auraEffects.triggers.onSourceTurnEnd"
                                ${triggers.onSourceTurnEnd ? 'checked' : ''}>
                            <span style="font-size: 10px;">Source Turn End</span>
                        </label>
                        <label class="sdx-checkbox-option" style="display: flex; align-items: center; gap: 4px;" title="Triggers when each TARGET's turn starts (affects only that token)">
                            <input type="checkbox" 
                                name="flags.${moduleId}.auraEffects.triggers.onTargetTurnStart"
                                ${triggers.onTargetTurnStart ? 'checked' : ''}>
                            <span style="font-size: 10px;">Target Turn Start</span>
                        </label>
                        <label class="sdx-checkbox-option" style="display: flex; align-items: center; gap: 4px;" title="Triggers when each TARGET's turn ends (affects only that token)">
                            <input type="checkbox" 
                                name="flags.${moduleId}.auraEffects.triggers.onTargetTurnEnd"
                                ${triggers.onTargetTurnEnd ? 'checked' : ''}>
                            <span style="font-size: 10px;">Target Turn End</span>
                        </label>
                    </div>
                </div>

                <!-- Damage Row -->
                <div class="SD-grid" style="grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
                    <div>
                        <label style="font-size: 11px; color: #999;">Damage Formula</label>
                        <input type="text" 
                            name="flags.${moduleId}.auraEffects.damage.formula"
                            value="${damage.formula || ''}"
                            placeholder="e.g., 2d6"
                            style="width: 100%;">
                    </div>
                    <div>
                        <label style="font-size: 11px; color: #999;">Damage Type</label>
                        <select name="flags.${moduleId}.auraEffects.damage.type" style="width: 100%;">
                            <option value="" ${!damage.type ? 'selected' : ''}>-- None --</option>
                            <option value="fire" ${damage.type === 'fire' ? 'selected' : ''}>Fire</option>
                            <option value="cold" ${damage.type === 'cold' ? 'selected' : ''}>Cold</option>
                            <option value="lightning" ${damage.type === 'lightning' ? 'selected' : ''}>Lightning</option>
                            <option value="acid" ${damage.type === 'acid' ? 'selected' : ''}>Acid</option>
                            <option value="poison" ${damage.type === 'poison' ? 'selected' : ''}>Poison</option>
                            <option value="necrotic" ${damage.type === 'necrotic' ? 'selected' : ''}>Necrotic</option>
                            <option value="radiant" ${damage.type === 'radiant' ? 'selected' : ''}>Radiant</option>
                            <option value="psychic" ${damage.type === 'psychic' ? 'selected' : ''}>Psychic</option>
                            <option value="force" ${damage.type === 'force' ? 'selected' : ''}>Force</option>
                            <option value="healing" ${damage.type === 'healing' ? 'selected' : ''}>Healing</option>
                            <option value="temphp" ${damage.type === 'temphp' ? 'selected' : ''}>Temp HP</option>
                        </select>
                    </div>
                </div>

                <!-- Damage Overrides -->
                <div style="margin-bottom: 8px;">
                    <span style="font-size: 10px; color: #888; display: block; margin-bottom: 4px;">Damage Triggers:</span>
                    <div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">
                        <label style="font-size: 9px; display: flex; align-items: center; gap: 2px;">
                            <input type="checkbox" name="flags.${moduleId}.auraEffects.damageTriggers.onEnter" ${damageTriggers.onEnter ? 'checked' : ''}> Enter
                        </label>
                        <label style="font-size: 9px; display: flex; align-items: center; gap: 2px;">
                            <input type="checkbox" name="flags.${moduleId}.auraEffects.damageTriggers.onLeave" ${damageTriggers.onLeave ? 'checked' : ''}> Leave
                        </label>
                        <label style="font-size: 9px; display: flex; align-items: center; gap: 2px;" title="Source Turn Start">
                            <input type="checkbox" name="flags.${moduleId}.auraEffects.damageTriggers.onSourceTurnStart" ${damageTriggers.onSourceTurnStart ? 'checked' : ''}> Src Start
                        </label>
                        <label style="font-size: 9px; display: flex; align-items: center; gap: 2px;" title="Source Turn End">
                            <input type="checkbox" name="flags.${moduleId}.auraEffects.damageTriggers.onSourceTurnEnd" ${damageTriggers.onSourceTurnEnd ? 'checked' : ''}> Src End
                        </label>
                        <label style="font-size: 9px; display: flex; align-items: center; gap: 2px;" title="Target Turn Start">
                            <input type="checkbox" name="flags.${moduleId}.auraEffects.damageTriggers.onTargetTurnStart" ${damageTriggers.onTargetTurnStart ? 'checked' : ''}> Tgt Start
                        </label>
                        <label style="font-size: 9px; display: flex; align-items: center; gap: 2px;" title="Target Turn End">
                            <input type="checkbox" name="flags.${moduleId}.auraEffects.damageTriggers.onTargetTurnEnd" ${damageTriggers.onTargetTurnEnd ? 'checked' : ''}> Tgt End
                        </label>
                        <span style="font-size: 8px; color: #bbb; font-style: italic;">(if none, uses Standard)</span>
                    </div>
                </div>

                <!-- Save Section -->
                <div style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--color-border-light-tertiary);">
                    <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                        <input type="checkbox" 
                            name="flags.${moduleId}.auraEffects.save.enabled"
                            class="sdx-aura-save-enabled"
                            ${save.enabled ? 'checked' : ''}>
                        <span style="font-weight: bold;">Allow Saving Throw</span>
                    </label>
                    
                    <div class="sdx-aura-save-config SD-grid" style="grid-template-columns: 1fr 1fr 1fr; gap: 8px; ${save.enabled ? '' : 'opacity: 0.5; pointer-events: none;'}">
                        <div>
                            <label style="font-size: 11px; color: #999;">Save DC</label>
                            <input type="number" 
                                name="flags.${moduleId}.auraEffects.save.dc"
                                value="${save.dc || 12}"
                                min="1" max="30"
                                style="width: 100%;">
                        </div>
                        <div>
                            <label style="font-size: 11px; color: #999;">Ability</label>
                            <select name="flags.${moduleId}.auraEffects.save.ability" style="width: 100%;">
                                <option value="str" ${save.ability === 'str' ? 'selected' : ''}>Strength</option>
                                <option value="dex" ${save.ability === 'dex' ? 'selected' : ''}>Dexterity</option>
                                <option value="con" ${save.ability === 'con' ? 'selected' : ''}>Constitution</option>
                                <option value="int" ${save.ability === 'int' ? 'selected' : ''}>Intelligence</option>
                                <option value="wis" ${save.ability === 'wis' ? 'selected' : ''}>Wisdom</option>
                                <option value="cha" ${save.ability === 'cha' ? 'selected' : ''}>Charisma</option>
                            </select>
                        </div>
                        <div>
                            <label style="font-size: 11px; color: #999;">&nbsp;</label>
                            <label style="display: flex; align-items: center; gap: 4px;">
                                <input type="checkbox" 
                                    name="flags.${moduleId}.auraEffects.save.halfOnSuccess"
                                    ${save.halfOnSuccess ? 'checked' : ''}>
                                <span style="font-size: 11px;">Half on Save</span>
                            </label>
                        </div>
                    </div>
                </div>

                <!-- Disposition & Include Self -->
                <div style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--color-border-light-tertiary);">
                    <div class="SD-grid" style="grid-template-columns: 1fr 1fr; gap: 12px;">
                        <div>
                            <label style="font-size: 11px; color: #999;">Affects</label>
                            <select name="flags.${moduleId}.auraEffects.disposition" style="width: 100%;">
                                <option value="all" ${disposition === 'all' ? 'selected' : ''}>All Tokens</option>
                                <option value="ally" ${disposition === 'ally' ? 'selected' : ''}>Allies Only</option>
                                <option value="enemy" ${disposition === 'enemy' ? 'selected' : ''}>Enemies Only</option>
                            </select>
                        </div>
                        <div>
                            <label style="font-size: 11px; color: #999;">&nbsp;</label>
                            <label style="display: flex; align-items: center; gap: 4px;">
                                <input type="checkbox" 
                                    name="flags.${moduleId}.auraEffects.includeSelf"
                                    ${includeSelf ? 'checked' : ''}>
                                <span style="font-size: 11px;">Include Aura Bearer</span>
                            </label>
                            <label style="display: flex; align-items: center; gap: 4px; margin-top: 4px;">
                                <input type="checkbox" 
                                    name="flags.${moduleId}.auraEffects.applyToOriginator"
                                    ${applyToOriginator ? 'checked' : ''}>
                                <span style="font-size: 11px;">Apply Effects to Originator</span>
                            </label>
                            <label style="display: flex; align-items: center; gap: 4px; margin-top: 4px;">
                                <input type="checkbox" 
                                    name="flags.${moduleId}.auraEffects.checkVisibility"
                                    ${checkVisibility ? 'checked' : ''}>
                                <span style="font-size: 11px;">Check Visibility (LOS)</span>
                            </label>
                        </div>
                    </div>
                </div>

                ${tokenMagicActive ? `
                <div style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--color-border-light-tertiary);">
                        <div class="sdx-token-filters-column">
                            <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                                <input type="checkbox" 
                                    name="flags.${moduleId}.auraEffects.tokenFilters.enabled"
                                    class="sdx-aura-token-filters-enabled"
                                    ${tokenFilters.enabled ? 'checked' : ''}>
                                <span style="font-weight: bold;"><i class="fas fa-filter"></i> Apply Token Filters</span>
                            </label>
                            
                            <div class="sdx-aura-token-filters-config" style="${tokenFilters.enabled ? '' : 'opacity: 0.5; pointer-events: none;'}">
                                <div>
                                    <label style="font-size: 11px; color: #999;">TokenMagic Preset</label>
                                    <select name="flags.${moduleId}.auraEffects.tokenFilters.preset" style="width: 100%;">
                                        <option value="" ${!tokenFilters.preset ? 'selected' : ''}>-- Select Preset --</option>
                                        ${tmTokenPresets.map(p => `<option value="${p.name}" ${tokenFilters.preset === p.name ? 'selected' : ''}>${p.name}</option>`).join('')}
                                    </select>
                                </div>
                                <p style="font-size: 10px; color: #888; margin: 8px 0 0 0;">
                                    Filter applied to tokens in aura, removed when they leave.
                                </p>
                            </div>
                        </div>
                </div>
                ` : ''}

                <!-- Effects Section -->
                <div style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--color-border-light-tertiary);">
                    <label style="display: flex; align-items: center; gap: 8px;">
                        <input type="checkbox" 
                            name="flags.${moduleId}.auraEffects.applyConfiguredEffects"
                            ${applyConfiguredEffects ? 'checked' : ''}>
                        <span>Apply Configured Effects (from Activity tab) on trigger</span>
                    </label>
                    <div style="margin: 4px 0 0 24px;">
                        <span style="font-size: 10px; color: #888; display: block; margin-bottom: 4px;">Effect Triggers:</span>
                        <div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">
                            <label style="font-size: 9px; display: flex; align-items: center; gap: 2px;">
                                <input type="checkbox" name="flags.${moduleId}.auraEffects.effectsTriggers.onEnter" ${effectsTriggers.onEnter ? 'checked' : ''}> Enter
                            </label>
                            <label style="font-size: 9px; display: flex; align-items: center; gap: 2px;">
                                <input type="checkbox" name="flags.${moduleId}.auraEffects.effectsTriggers.onLeave" ${effectsTriggers.onLeave ? 'checked' : ''}> Leave
                            </label>
                            <label style="font-size: 9px; display: flex; align-items: center; gap: 2px;" title="Source Turn Start">
                                <input type="checkbox" name="flags.${moduleId}.auraEffects.effectsTriggers.onSourceTurnStart" ${effectsTriggers.onSourceTurnStart ? 'checked' : ''}> Src Start
                            </label>
                            <label style="font-size: 9px; display: flex; align-items: center; gap: 2px;" title="Source Turn End">
                                <input type="checkbox" name="flags.${moduleId}.auraEffects.effectsTriggers.onSourceTurnEnd" ${effectsTriggers.onSourceTurnEnd ? 'checked' : ''}> Src End
                            </label>
                            <label style="font-size: 9px; display: flex; align-items: center; gap: 2px;" title="Target Turn Start">
                                <input type="checkbox" name="flags.${moduleId}.auraEffects.effectsTriggers.onTargetTurnStart" ${effectsTriggers.onTargetTurnStart ? 'checked' : ''}> Tgt Start
                            </label>
                            <label style="font-size: 9px; display: flex; align-items: center; gap: 2px;" title="Target Turn End">
                                <input type="checkbox" name="flags.${moduleId}.auraEffects.effectsTriggers.onTargetTurnEnd" ${effectsTriggers.onTargetTurnEnd ? 'checked' : ''}> Tgt End
                            </label>
                        </div>
                    </div>
                </div>

                <!-- Item Macro Section -->
                <div style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--color-border-light-tertiary);">
                    <label style="display: flex; align-items: center; gap: 8px;">
                        <input type="checkbox" 
                            name="flags.${moduleId}.auraEffects.runItemMacro"
                            ${runItemMacro ? 'checked' : ''}>
                        <span><i class="fas fa-code" style="margin-right: 4px;"></i>Run Item Macro on trigger</span>
                    </label>
                    <div style="margin: 4px 0 0 24px;">
                        <span style="font-size: 10px; color: #888; display: block; margin-bottom: 4px;">Macro Triggers:</span>
                        <div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">
                            <label style="font-size: 9px; display: flex; align-items: center; gap: 2px;">
                                <input type="checkbox" name="flags.${moduleId}.auraEffects.macroTriggers.onEnter" ${macroTriggers.onEnter ? 'checked' : ''}> Enter
                            </label>
                            <label style="font-size: 9px; display: flex; align-items: center; gap: 2px;">
                                <input type="checkbox" name="flags.${moduleId}.auraEffects.macroTriggers.onLeave" ${macroTriggers.onLeave ? 'checked' : ''}> Leave
                            </label>
                            <label style="font-size: 9px; display: flex; align-items: center; gap: 2px;" title="Source Turn Start">
                                <input type="checkbox" name="flags.${moduleId}.auraEffects.macroTriggers.onSourceTurnStart" ${macroTriggers.onSourceTurnStart ? 'checked' : ''}> Src Start
                            </label>
                            <label style="font-size: 9px; display: flex; align-items: center; gap: 2px;" title="Source Turn End">
                                <input type="checkbox" name="flags.${moduleId}.auraEffects.macroTriggers.onSourceTurnEnd" ${macroTriggers.onSourceTurnEnd ? 'checked' : ''}> Src End
                            </label>
                            <label style="font-size: 9px; display: flex; align-items: center; gap: 2px;" title="Target Turn Start">
                                <input type="checkbox" name="flags.${moduleId}.auraEffects.macroTriggers.onTargetTurnStart" ${macroTriggers.onTargetTurnStart ? 'checked' : ''}> Tgt Start
                            </label>
                            <label style="font-size: 9px; display: flex; align-items: center; gap: 2px;" title="Target Turn End">
                                <input type="checkbox" name="flags.${moduleId}.auraEffects.macroTriggers.onTargetTurnEnd" ${macroTriggers.onTargetTurnEnd ? 'checked' : ''}> Tgt End
                            </label>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

/**
 * Setup event handlers for the aura config UI
 * @param {HTMLElement|JQuery} html - The form HTML (can be jQuery or native DOM)
 */
export function setupAuraConfigHandlers(html) {
    // Ensure we have native DOM element
    const element = html instanceof jQuery ? html[0] : html;
    if (!element) return;

    // Toggle aura config visibility
    const auraEnabledCheckbox = element.querySelector('.sdx-aura-effects-enabled');
    const auraConfig = element.querySelector('.sdx-aura-effects-config');

    if (auraEnabledCheckbox && auraConfig) {
        auraEnabledCheckbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                auraConfig.style.opacity = '1';
                auraConfig.style.pointerEvents = 'auto';
            } else {
                auraConfig.style.opacity = '0.5';
                auraConfig.style.pointerEvents = 'none';
            }
        });
    }

    const auraFxEngineSelect = element.querySelector('.sdx-aura-fx-engine-select');
    if (auraFxEngineSelect) {
        auraFxEngineSelect.addEventListener('change', (e) => {
            const engine = e.target.value;
            const tmfxSettings = element.querySelector('.sdx-aura-tmfx-settings');
            const indySettings = element.querySelector('.sdx-aura-indyfx-settings');
            if (tmfxSettings) tmfxSettings.style.display = engine === 'tmfx' ? '' : 'none';
            if (indySettings) indySettings.style.display = engine === 'indy' ? '' : 'none';
        });
    }

    // Toggle save config visibility
    const saveEnabledCheckbox = element.querySelector('.sdx-aura-save-enabled');
    const saveConfig = element.querySelector('.sdx-aura-save-config');

    if (saveEnabledCheckbox && saveConfig) {
        saveEnabledCheckbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                saveConfig.style.opacity = '1';
                saveConfig.style.pointerEvents = 'auto';
            } else {
                saveConfig.style.opacity = '0.5';
                saveConfig.style.pointerEvents = 'none';
            }
        });
    }

    // Toggle token filters config visibility
    const tokenFiltersEnabledCheckbox = element.querySelector('.sdx-aura-token-filters-enabled');
    const tokenFiltersConfig = element.querySelector('.sdx-aura-token-filters-config');

    if (tokenFiltersEnabledCheckbox && tokenFiltersConfig) {
        tokenFiltersEnabledCheckbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                tokenFiltersConfig.style.opacity = '1';
                tokenFiltersConfig.style.pointerEvents = 'auto';
            } else {
                tokenFiltersConfig.style.opacity = '0.5';
                tokenFiltersConfig.style.pointerEvents = 'none';
            }
        });
    }
}

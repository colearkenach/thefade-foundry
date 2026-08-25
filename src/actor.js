// TheFadeActor document class (extracted from thefade.js).
import {
    BODY_PARTS,
    COMBAT_DAMAGE_TYPES,
    COMBAT_IMMUNITY_DAMAGE_TYPES,
    COMBAT_IMMUNITY_EFFECTS,
    COMBAT_STATUS_IMMUNITIES,
    DEFAULT_COMBAT_TRAITS,
    FALLBACK_ACTOR_DATA,
    UNIVERSAL_ABILITY_CATEGORIES
} from './constants.js';
import {
    aggregateConditionState,
    computeRollModifiers,
    summarizeConditionState,
    CONDITION_EFFECTS,
    CONDITION_INTENSITIES,
    getConditionKeyFromStatusId
} from './conditions.js';
import { applyBaseDefenseStances, applyPassiveStances, summarizeStance, getDamageMitigation } from './stances.js';
import { applyAddictionPenalties, isDarkMagicSpell, resetDailySin } from './dark-magic.js';
import { applyAbilityEffects, getActiveTemporaryBonusEntries } from './abilities.js';
import { applyCreatureRuleEffects } from './creature-rules.js';
import {
    getUniversalAbilityDefinition,
    normalizeMechanicalBonus,
    parseMechanicalBonusImmunity
} from './mechanical-bonuses.js';
import { getSkill, slugifySkill } from './skills.js';
import { isItemPowerActive } from './item-power-rules.js';

function coerceSheetNumber(value, fallback = 0) {
    if (Number.isFinite(Number(value))) return Number(value);
    if (typeof value === "string") {
        for (const part of value.split(",")) {
            const number = Number(part.trim());
            if (Number.isFinite(number)) return number;
        }
    }
    return fallback;
}

/**
* Base Actor class for The Fade system
* Handles core actor data preparation and functionality
*/
export class TheFadeActor extends Actor {

    /**
     * Keep Foundry's native status-effect documents and The Fade's mechanical
     * condition data in lockstep. Left-click toggles a status. Right-click on
     * a tiered status applies it or advances Trivial → Moderate → Severe.
     */
    async toggleStatusEffect(statusId, { active, overlay = false } = {}) {
        const conditionKey = getConditionKeyFromStatusId(statusId);
        if (!conditionKey) return super.toggleStatusEffect(statusId, { active, overlay });

        const definition = CONDITION_EFFECTS[conditionKey];
        const state = this.system?.conditions?.[conditionKey] || {};
        const immune = this.system?.statusImmunityLocks?.[conditionKey] === true;
        const cycling = overlay && definition.tiered;
        const activating = cycling || active === true;

        if (activating && immune) {
            ui.notifications.warn(game.i18n.format("THEFADE.TokenConditionImmune", {
                actor: this.name,
                condition: definition.label
            }));
            return false;
        }

        this._thefadeStatusEffectSync = true;
        let result;
        try {
            if (cycling) {
                if (state.active !== true) {
                    result = await super.toggleStatusEffect(statusId, { active: true, overlay: false });
                } else {
                    result = true;
                }
            } else {
                result = await super.toggleStatusEffect(statusId, { active, overlay: false });
            }
        } finally {
            this._thefadeStatusEffectSync = false;
        }

        const update = {};
        if (cycling) {
            const currentIndex = CONDITION_INTENSITIES.indexOf(state.intensity || "trivial");
            const nextIntensity = state.active === true
                ? CONDITION_INTENSITIES[(Math.max(0, currentIndex) + 1) % CONDITION_INTENSITIES.length]
                : "trivial";
            update[`system.conditions.${conditionKey}.active`] = true;
            update[`system.conditions.${conditionKey}.intensity`] = nextIntensity;
        } else {
            const nextActive = typeof active === "boolean" ? active : state.active !== true;
            if (state.active !== nextActive) update[`system.conditions.${conditionKey}.active`] = nextActive;
        }

        if (Object.keys(update).length) await this.update(update);
        return result;
    }

    /**
    * Prepare actor data - called automatically by Foundry
    */
    prepareData() {
        super.prepareData();

        // Ensure this actor exists and has an id (is properly initialized)
        if (!this || !this.id) {
            console.warn("Actor not properly initialized, skipping prepareData");
            return;
        }

        const actorData = this;

        // Initialize system data if it doesn't exist
        if (!actorData.system || typeof actorData.system !== 'object') {
            console.warn("Actor system data missing, initializing with fallback data");
            actorData.system = foundry.utils.deepClone(FALLBACK_ACTOR_DATA);
        }

        const data = actorData.system;
        const flags = actorData.flags || {};

        // Ensure all required system properties exist before processing
        this._ensureSystemDataIntegrity(data);

        // Make separate methods for each Actor type (character, npc, etc.)
        if (actorData.type === 'character') {
            this._prepareCharacterData(actorData);
        } else if (actorData.type === 'npc') {
            this._prepareNPCData(actorData);
        }
    }

    /**
     * Ensure system data has all required properties
     * @param {Object} data - Actor system data
     */
    _ensureSystemDataIntegrity(data) {
        // Initialize attributes if undefined
        if (!data.attributes || typeof data.attributes !== 'object') {
            data.attributes = {
                physique: { value: 1, speciesBonus: 0 },
                finesse: { value: 1, speciesBonus: 0 },
                mind: { value: 1, speciesBonus: 0 },
                presence: { value: 1, speciesBonus: 0 },
                soul: { value: 1, speciesBonus: 0 }
            };
        }

        // Ensure each attribute has required properties
        const expectedAttributes = ['physique', 'finesse', 'mind', 'presence', 'soul'];
        expectedAttributes.forEach(attr => {
            if (!data.attributes[attr] || typeof data.attributes[attr] !== 'object') {
                data.attributes[attr] = { value: 1, speciesBonus: 0 };
            }

            if (typeof data.attributes[attr].value !== 'number') {
                data.attributes[attr].value = 1;
            }

            if (typeof data.attributes[attr].speciesBonus !== 'number') {
                data.attributes[attr].speciesBonus = 0;
            }

            if (typeof data.attributes[attr].bonus !== 'number') {
                data.attributes[attr].bonus = 0;
            }

            // override stays null when unset; only coerce explicit numbers
            if (data.attributes[attr].override !== null
                && data.attributes[attr].override !== undefined
                && data.attributes[attr].override !== ""
                && !Number.isFinite(Number(data.attributes[attr].override))) {
                data.attributes[attr].override = null;
            }

            if (typeof data.attributes[attr].total !== 'number') {
                data.attributes[attr].total = data.attributes[attr].value;
            }
        });

        // Ensure defenses exist
        if (!data.defenses || typeof data.defenses !== 'object') {
            data.defenses = {
                resilience: 0,
                avoid: 0,
                grit: 0,
                resilienceBonus: 0,
                avoidBonus: 0,
                gritBonus: 0,
                passiveDodge: 0,
                passiveParry: 0,
                facing: "front",
                avoidPenalty: 0
            };
        }

        // Ensure facing has a default value
        if (!data.defenses.facing) {
            data.defenses.facing = "front";
        }

        // Ensure HP exists
        if (!data.hp || typeof data.hp !== 'object') {
            data.hp = { value: 1, max: 1 };
        }

        // Ensure Sanity exists
        if (!data.sanity || typeof data.sanity !== 'object') {
            data.sanity = { value: 10, max: 10 };
        }

        // Ensure naturalDeflection exists as an object with all body parts
        if (!data.naturalDeflection || typeof data.naturalDeflection !== 'object') {
            data.naturalDeflection = {};
        }

        BODY_PARTS.forEach(part => {
            if (!data.naturalDeflection[part] || typeof data.naturalDeflection[part] !== 'object') {
                data.naturalDeflection[part] = {
                    current: 0,
                    max: 0,
                    stacks: false
                };
            }

            // Ensure all properties exist
            if (typeof data.naturalDeflection[part].current !== 'number') {
                data.naturalDeflection[part].current = 0;
            }
            if (typeof data.naturalDeflection[part].max !== 'number') {
                data.naturalDeflection[part].max = 0;
            }
            if (typeof data.naturalDeflection[part].stacks !== 'boolean') {
                data.naturalDeflection[part].stacks = false;
            }
        });

        // Initialize arrays to prevent iteration errors
        if (!Array.isArray(data.itemsOfPower)) data.itemsOfPower = [];
        if (!data.equippedItemsOfPower || typeof data.equippedItemsOfPower !== 'object') {
            data.equippedItemsOfPower = {};
        }
        if (!Array.isArray(data.unequippedItemsOfPower)) data.unequippedItemsOfPower = [];
        if (!data.equippedArmor || typeof data.equippedArmor !== 'object') {
            data.equippedArmor = {};
        }
        if (!Array.isArray(data.unequippedArmor)) data.unequippedArmor = [];
        if (!Array.isArray(data.potions)) data.potions = [];
        if (!Array.isArray(data.drugs)) data.drugs = [];

        // Ensure species exists
        if (!data.species || typeof data.species !== 'object') {
            data.species = {
                name: "",
                baseHP: 0,
                size: "medium",
                abilities: "",
                flexibleBonus: {
                    value: 0,
                    selectedAttribute: ""
                }
            };
        }

        // Ensure species flexibleBonus exists
        if (!data.species.flexibleBonus || typeof data.species.flexibleBonus !== 'object') {
            data.species.flexibleBonus = {
                value: 0,
                selectedAttribute: ""
            };
        }

        // Ensure status-effect conditions exist so the UI always has something to bind to.
        // Conditions with severity store { active, intensity }; binary ones store { active }.
        const SEVERITY_CONDITIONS = ["bleed", "dazed", "fatigue", "fear", "illness", "pain", "paralysis", "staggered", "stunned"];
        const BINARY_CONDITIONS = ["blindness", "confusion", "deafness", "flatFooted", "sleep"];
        if (!data.conditions || typeof data.conditions !== "object") {
            data.conditions = {};
        }
        for (const key of SEVERITY_CONDITIONS) {
            if (!data.conditions[key] || typeof data.conditions[key] !== "object") {
                data.conditions[key] = { active: false, intensity: "trivial" };
            }
            if (typeof data.conditions[key].active !== "boolean") data.conditions[key].active = false;
            if (!["trivial", "moderate", "severe"].includes(data.conditions[key].intensity)) {
                data.conditions[key].intensity = "trivial";
            }
        }
        for (const key of BINARY_CONDITIONS) {
            if (!data.conditions[key] || typeof data.conditions[key] !== "object") {
                data.conditions[key] = { active: false };
            }
            if (typeof data.conditions[key].active !== "boolean") data.conditions[key].active = false;
        }

        // Single active combat stance (Dodge / Parrying / Brace / Tough / Resolute / none).
        const VALID_STANCES = ["none", "dodgeStance", "parryingStance", "brace", "toughItOut", "resoluteWill"];
        if (!VALID_STANCES.includes(data.activeStance)) {
            data.activeStance = "none";
        }

        if (!Array.isArray(data.species.creatureSubtypes)) data.species.creatureSubtypes = [];
        if (!Array.isArray(data.temporaryBonuses)) data.temporaryBonuses = [];

        this._ensureCombatTraits(data);

        // Injuries — severed limbs. Self-heal to ensure all 6 limb slots exist.
        if (!data.injuries || typeof data.injuries !== "object") data.injuries = {};
        for (const limb of ["head", "body", "leftArm", "rightArm", "leftLeg", "rightLeg"]) {
            if (!data.injuries[limb] || typeof data.injuries[limb] !== "object") {
                data.injuries[limb] = { severed: false };
            }
            if (typeof data.injuries[limb].severed !== "boolean") {
                data.injuries[limb].severed = false;
            }
        }

        // Mental disorders — array of { type, name }. Self-heal to array.
        if (!Array.isArray(data.mentalDisorders)) data.mentalDisorders = [];

        // Optional Bestiary / Heirs to Rangar subsystems. These are normal
        // actor data so enabling the rules never depends on transient flags.
        if (!data.anatomy || typeof data.anatomy !== "object") data.anatomy = {};
        if (typeof data.anatomy.preset !== "string" || !data.anatomy.preset) data.anatomy.preset = "humanoid";
        if (typeof data.anatomy.notes !== "string") data.anatomy.notes = "";

        if (!data.fate || typeof data.fate !== "object") data.fate = {};
        if (!Number.isFinite(Number(data.fate.points))) data.fate.points = 0;
        if (!data.fate.motivations || typeof data.fate.motivations !== "object") data.fate.motivations = {};
        for (const key of ["personalGoal", "drivingForce", "personalRelationship"]) {
            if (typeof data.fate.motivations[key] !== "string") data.fate.motivations[key] = "";
        }

        if (!data.heritage || typeof data.heritage !== "object") data.heritage = {};
        for (const key of ["motherType", "fatherType", "outcome", "outcomeLabel", "standardMutationRolls", "notes"]) {
            if (typeof data.heritage[key] !== "string") data.heritage[key] = "";
        }
        if (!Number.isFinite(Number(data.heritage.characteristicChanges))) data.heritage.characteristicChanges = 0;
        if (!Number.isFinite(Number(data.heritage.xenochildRolls))) data.heritage.xenochildRolls = 0;
        if (typeof data.heritage.isXenochild !== "boolean") data.heritage.isXenochild = false;
        if (!data.heritage.xenochildModifiers || typeof data.heritage.xenochildModifiers !== "object") {
            data.heritage.xenochildModifiers = {};
        }
        for (const key of ["designerSculpting", "extradimensionalParentage", "dragonParent", "faeParent", "undeadDNA"]) {
            data.heritage.xenochildModifiers[key] = data.heritage.xenochildModifiers[key] === true;
        }
        if (!Number.isFinite(Number(data.heritage.xenochildModifiers.additionalParents))) {
            data.heritage.xenochildModifiers.additionalParents = 0;
        } else {
            data.heritage.xenochildModifiers.additionalParents = Math.max(0, Math.floor(Number(data.heritage.xenochildModifiers.additionalParents)));
        }
    }

    _ensureCombatTraits(data) {
        if (!data.combatTraits || typeof data.combatTraits !== "object") {
            data.combatTraits = foundry.utils.deepClone(DEFAULT_COMBAT_TRAITS);
        }

        const traits = data.combatTraits;
        if (!traits.abilities || typeof traits.abilities !== "object") traits.abilities = {};
        if (!traits.abilityValues || typeof traits.abilityValues !== "object") traits.abilityValues = {};
        if (typeof traits.abilityNotes !== "string") traits.abilityNotes = "";
        traits.spellResistancePercent = Math.min(100, Math.max(1, Number(traits.spellResistancePercent) || 50));
        if (!traits.resistances || typeof traits.resistances !== "object") traits.resistances = {};
        if (!traits.immunities || typeof traits.immunities !== "object") traits.immunities = {};
        if (!traits.immunities.damageTypes || typeof traits.immunities.damageTypes !== "object") traits.immunities.damageTypes = {};
        if (!traits.immunities.statuses || typeof traits.immunities.statuses !== "object") traits.immunities.statuses = {};
        if (!traits.immunities.effects || typeof traits.immunities.effects !== "object") traits.immunities.effects = {};
        if (!traits.absorption || typeof traits.absorption !== "object") traits.absorption = {};
        if (!traits.vulnerabilities || typeof traits.vulnerabilities !== "object") traits.vulnerabilities = {};
        if (!traits.vulnerabilitySeverity || typeof traits.vulnerabilitySeverity !== "object") traits.vulnerabilitySeverity = {};
        if (typeof traits.notes !== "string") traits.notes = "";

        if (traits.immunities.effects.statusEffects) {
            traits.immunities.statuses.all = true;
            delete traits.immunities.effects.statusEffects;
        }
        if (traits.immunities.effects.allStatusEffects) {
            traits.immunities.statuses.all = true;
            delete traits.immunities.effects.allStatusEffects;
        }

        const abilityCategoryKeys = new Set(UNIVERSAL_ABILITY_CATEGORIES.map(category => category.key));
        for (const key of Object.keys(traits.abilities)) {
            if (!abilityCategoryKeys.has(key)) delete traits.abilities[key];
        }
        for (const category of UNIVERSAL_ABILITY_CATEGORIES) {
            if (!traits.abilities[category.key] || typeof traits.abilities[category.key] !== "object") {
                traits.abilities[category.key] = {};
            }
            if (!traits.abilityValues[category.key] || typeof traits.abilityValues[category.key] !== "object") {
                traits.abilityValues[category.key] = {};
            }
            const abilityKeys = new Set(category.abilities.map(ability => ability.key));
            for (const key of Object.keys(traits.abilities[category.key])) {
                if (!abilityKeys.has(key)) delete traits.abilities[category.key][key];
            }
            for (const ability of category.abilities) {
                traits.abilities[category.key][ability.key] = traits.abilities[category.key][ability.key] === true;
                if (!ability.amount || ability.key === "spellResistance") continue;
                const raw = Number(traits.abilityValues[category.key][ability.key]);
                let amount = Number.isFinite(raw) ? raw : ability.amount.default;
                if (ability.amount.min !== undefined) amount = Math.max(ability.amount.min, amount);
                if (ability.amount.max !== undefined) amount = Math.min(ability.amount.max, amount);
                traits.abilityValues[category.key][ability.key] = amount;
            }
            for (const key of Object.keys(traits.abilityValues[category.key])) {
                if (!abilityKeys.has(key)) delete traits.abilityValues[category.key][key];
            }
        }

        for (const type of COMBAT_DAMAGE_TYPES) {
            traits.resistances[type.key] = traits.resistances[type.key] === true;
            traits.vulnerabilities[type.key] = traits.vulnerabilities[type.key] === true;
            if (!["minor", "moderate", "severe"].includes(traits.vulnerabilitySeverity[type.key])) {
                traits.vulnerabilitySeverity[type.key] = "minor";
            }
        }

        const immuneDamageKeys = new Set(COMBAT_IMMUNITY_DAMAGE_TYPES.map(type => type.key));
        for (const type of COMBAT_IMMUNITY_DAMAGE_TYPES) {
            traits.immunities.damageTypes[type.key] = traits.immunities.damageTypes[type.key] === true;
            traits.absorption[type.key] = traits.absorption[type.key] === true;
        }

        for (const key of Object.keys(traits.immunities.damageTypes)) {
            if (!immuneDamageKeys.has(key)) delete traits.immunities.damageTypes[key];
        }
        for (const key of Object.keys(traits.absorption)) {
            if (!immuneDamageKeys.has(key)) delete traits.absorption[key];
        }

        const statusKeys = new Set(COMBAT_STATUS_IMMUNITIES.map(status => status.key));
        for (const status of COMBAT_STATUS_IMMUNITIES) {
            traits.immunities.statuses[status.key] = traits.immunities.statuses[status.key] === true;
        }
        for (const key of Object.keys(traits.immunities.statuses)) {
            if (!statusKeys.has(key)) delete traits.immunities.statuses[key];
        }

        const immunityEffectKeys = new Set(COMBAT_IMMUNITY_EFFECTS.map(effect => effect.key));
        for (const effect of COMBAT_IMMUNITY_EFFECTS) {
            traits.immunities.effects[effect.key] = traits.immunities.effects[effect.key] === true;
        }
        for (const key of Object.keys(traits.immunities.effects)) {
            if (!immunityEffectKeys.has(key)) delete traits.immunities.effects[key];
        }

        this._refreshStatusImmunityLocks(data);
    }

    _refreshStatusImmunityLocks(data) {
        const statuses = data.combatTraits?.immunities?.statuses || {};
        const allStatusImmune = statuses.all === true;
        data.statusImmunityLocks = {};
        for (const status of COMBAT_STATUS_IMMUNITIES) {
            if (!status.condition) continue;
            data.statusImmunityLocks[status.condition] = allStatusImmune || statuses[status.key] === true;
        }
    }

    _conditionsWithoutImmunities(conditions, immunityLocks) {
        if (!conditions || typeof conditions !== "object") return conditions;
        if (!immunityLocks || !Object.values(immunityLocks).some(Boolean)) return conditions;
        return Object.fromEntries(
            Object.entries(conditions).filter(([key]) => immunityLocks[key] !== true)
        );
    }

    /**
    * Prepare character-specific data and calculations
    * @param {Object} actorData - The actor's data object
    */
    _prepareCharacterData(actorData) {
        // Enhanced safety checks
        if (!actorData) {
            console.error("actorData is null/undefined in _prepareCharacterData");
            return;
        }

        if (!actorData.system) {
            console.error("Actor system data missing in _prepareCharacterData");
            actorData.system = foundry.utils.deepClone(FALLBACK_ACTOR_DATA);
        }

        const data = actorData.system;

        try {
            // Ensure data integrity before calculations
            this._ensureSystemDataIntegrity(data);

            // Collect bonuses from items (Items of Power, talents, precepts,
            // path/species abilities). Must run BEFORE attribute totals and
            // defenses so attribute, passive dodge/parry, etc. bonuses
            // propagate through the downstream math.
            this._applyEquippedItemBonuses(data, actorData);

            // Compute effective attribute totals (value + speciesBonus +
            // flexibleBonus + manual bonus + item bonus, or manual override).
            // Must run before defenses or anything else reading attribute totals.
            this._computeAttributeTotals(data);

            // Calculate defenses based on attributes and include bonuses
            this._calculateBaseDefenses(data, actorData);

            // Apply facing modifiers
            this._applyFacingModifiers(data);

            // Apply active-condition modifiers (defenses, speed, action economy)
            this._applyConditionState(data);

            // Manual overrides win outright — applied last so they bypass
            // base, bonus, facing, stance, and condition deltas.
            this._applyDefenseOverrides(data);

            // Calculate carrying capacity
            this._calculateCarryingCapacity(data);

            // Calculate max HP and Sanity
            this._calculateMaxValues(data, actorData);

            // Apply passive universal-ability effects (Tough, Flight, etc.)
            // before downstream calcs so HP bumps and movement modes are
            // baked into what the sheet displays.
            applyAbilityEffects(data, actorData);

            // Calculate Sin Threshold for dark magic
            this._calculateSinThreshold(data);

            // Apply addiction-stage passive penalties (Grit/Sanity/Soul).
            applyAddictionPenalties(data);

            this._calculateOverlandMovement(data);

        } catch (error) {
            console.error("Error in _prepareCharacterData calculations:", error);
            console.error("Error stack:", error.stack);

            // Initialize minimal defense data to prevent template errors
            this._initializeMinimalDefenseData(data);
        }
    }

    /**
     * Calculate max HP and Sanity values
     * @param {Object} data - Character system data
     * @param {Object} actorData - Full actor data
     */
    _calculateMaxValues(data, actorData) {
        // Calculate Max HP based on Species, Path, Physique, and misc bonus
        let baseHP = (data.species?.baseHP) || 0;
        let pathHP = 0;
        let highestPathTier = 0;

        // Add HP from Paths - safer item processing
        if (actorData.items && typeof actorData.items.forEach === 'function') {
            try {
                actorData.items.forEach(item => {
                    if (item && (item.type === "path" || item.type === "monsterpath") && item.system) {
                        if (typeof item.system.baseHP === 'number') pathHP += item.system.baseHP;
                        const t = Number(item.system.tier) || 0;
                        if (t > highestPathTier) highestPathTier = t;
                    }
                });
            } catch (error) {
                console.error("Error processing path HP:", error);
            }
        }

        // Optional "More HP" alt rule: scaling HP per level based on highest path tier.
        // Tier 2 paths grant +1 HP per character level from L5 onward; Tier 3 paths grant
        // +2 HP per level from L10 onward (replacing the +1 rate for those levels).
        let levelHP = 0;
        let levelHPNote = "";
        try {
            if (game?.settings?.get?.("thefade", "moreHPScaling")) {
                const level = Math.max(1, Number(data.level) || 1);
                if (highestPathTier >= 2) {
                    const t2End = highestPathTier >= 3 ? Math.min(level, 9) : Math.min(level, 9999);
                    const t2Levels = Math.max(0, t2End - 4); // levels 5..t2End
                    levelHP += t2Levels;
                }
                if (highestPathTier >= 3 && level >= 10) {
                    const t3Levels = level - 9; // levels 10..level
                    levelHP += t3Levels * 2;
                }
                if (levelHP) levelHPNote = ` + ${levelHP} level`;
            }
        } catch (e) {
            // settings not ready yet during early prep; ignore
        }

        // Calculate max HP and update both properties
        const physiqueValue = Number(data.attributes?.physique?.total ?? data.attributes?.physique?.value ?? 1);
        const hpMiscBonus = coerceSheetNumber(data.hpMiscBonus, 0);
        data.hpMiscBonus = hpMiscBonus;
        const calculatedMaxHP = baseHP + pathHP + physiqueValue + hpMiscBonus + levelHP;

        data.hp.max = calculatedMaxHP;
        data.maxHP = calculatedMaxHP; // For backward compatibility with UI
        // Tooltip formula string for the UI
        const miscHPPart = hpMiscBonus ? ` + ${hpMiscBonus} misc` : "";
        data.hp.formula = `Species ${baseHP} + Path ${pathHP} + Physique ${physiqueValue}${miscHPPart}${levelHPNote} = ${calculatedMaxHP}`;

        // Calculate max Sanity and update both properties
        const mindValue = Number(data.attributes?.mind?.total ?? data.attributes?.mind?.value ?? 1);
        if (!data.sanity || typeof data.sanity !== "object") data.sanity = {};
        const sanityMiscBonus = coerceSheetNumber(data.sanity.miscBonus, 0);
        data.sanity.miscBonus = sanityMiscBonus;
        const sanityItemBonus = Number(data.itemBonuses?.sanity || 0);
        const calculatedMaxSanity = 10 + mindValue + sanityMiscBonus + sanityItemBonus;

        data.sanity.max = calculatedMaxSanity;
        data.maxSanity = calculatedMaxSanity; // For backward compatibility with UI
        const miscSanPart = sanityMiscBonus ? ` + ${sanityMiscBonus} misc` : "";
        const itemSanPart = sanityItemBonus ? ` + ${sanityItemBonus} item` : "";
        data.sanity.formula = `10 + Mind ${mindValue}${miscSanPart}${itemSanPart} = ${calculatedMaxSanity}`;

        // Ensure HP and Sanity values don't exceed max
        if (data.hp.value > data.hp.max) data.hp.value = data.hp.max;
        if (data.sanity.value > data.sanity.max) data.sanity.value = data.sanity.max;

        // Derive an HP state label for the UI.
        // Rulebook: unconscious at 0; die at -2 * maxHP. "Dying" is the negative band in between.
        const hp = data.hp.value;
        const max = Math.max(1, data.hp.max);
        let state, label;
        if (hp >= max)          { state = "healthy";     label = "Healthy"; }
        else if (hp > max / 2)  { state = "bloodied";    label = "Bloodied"; }
        else if (hp > 0)        { state = "wounded";     label = "Wounded"; }
        else if (hp === 0)      { state = "unconscious"; label = "Unconscious"; }
        else if (hp > -max * 2) { state = "dying";       label = "Dying"; }
        else                    { state = "dead";        label = "Dead"; }
        data.hp.state = state;
        data.hp.stateLabel = label;
    }

    /**
     * Calculate sin threshold for dark magic
     * @param {Object} data - Character system data
     */
    _calculateSinThreshold(data) {
        // Initialize dark magic data if needed
        if (!data.darkMagic || typeof data.darkMagic !== 'object') {
            data.darkMagic = {
                currentSin: 0,
                sinThresholdBonus: 0,
                addictionLevel: "none"
            };
        }

        // Count dark magic spells the actor actually owns.
        const darkMagicCount = this.items?.filter(i =>
            i.type === "spell" && isDarkMagicSpell(i)
        ).length ?? 0;
        data.darkMagic.spellsLearnedCount = darkMagicCount;

        // Calculate sin threshold: Soul - 1 per dark magic spell + bonus
        const soulValue = Number(data.attributes?.soul?.total ?? data.attributes?.soul?.value ?? 1);
        const sinThresholdBonus = data.darkMagic.sinThresholdBonus || 0;
        const sinThresholdItem  = Number(data.itemBonuses?.sinThreshold || 0);
        data.darkMagic.sinThreshold = Math.max(1,
            soulValue - darkMagicCount + sinThresholdBonus + sinThresholdItem);
    }

    /**
     * Initialize minimal defense data to prevent errors
     * @param {Object} data - Character system data
     */
    _initializeMinimalDefenseData(data) {
        if (!data.defenses) {
            data.defenses = {
                resilience: 1,
                avoid: 1,
                grit: 1,
                resilienceBonus: 0,
                avoidBonus: 0,
                gritBonus: 0,
                passiveDodge: 0,
                passiveParry: 0,
                facing: "front",
                avoidPenalty: 0
            };
        }

        if (!data.carryingCapacity) {
            data.carryingCapacity = {
                light: 50,
                medium: 100,
                heavy: 150,
                overHead: 225,
                offGround: 450,
                pushOrDrag: 750
            };
        }

        // Set safe total values
        data.totalResilience = data.defenses.resilience + (data.defenses.resilienceBonus || 0);
        data.totalAvoid = data.defenses.avoid + (data.defenses.avoidBonus || 0);
        data.totalGrit = data.defenses.grit + (data.defenses.gritBonus || 0);
    }

    /**
    * Generate initiative roll for this actor
    * @returns {Roll} Initiative roll object
    */
    getInitiativeRoll() {
        // Get the attributes used for initiative
        const finesseValue = this.system.attributes.finesse?.value || 0;
        const mindValue = this.system.attributes.mind?.value || 0;

        // Calculate the average
        const averagedFINMND = Math.floor((finesseValue + mindValue) / 2);
        const initBonus = Number(this.system.initiativeBonus || 0)
            + Number(this.system.itemBonuses?.initiative || 0);
        const modifier = averagedFINMND + initBonus;

        // Create the roll with the proper formula
        const formula = `1d12 + ${modifier}`;
        const roll = new Roll(formula);

        return roll;
    }

    /**
     * Collect bonuses from all equipped Items of Power and apply them.
     * Defense/HP bonuses are applied immediately; skill/attack/damage/spell
     * bonuses are stored in data.equippedBonuses for roll handlers to use.
     */
    _applyEquippedItemBonuses(data, actorData) {
        // Initialize the lookup table roll handlers read from
        data.equippedBonuses = { skills: {}, attack: 0, damage: 0, spell: 0 };

        // Structured pot consumed by attribute totals, defenses, max
        // sanity, sin threshold, and initiative. These run AFTER this
        // method, so they must read from this pot rather than from
        // already-computed totals.
        data.itemBonuses = {
            attributes: { physique: 0, finesse: 0, mind: 0, presence: 0, soul: 0 },
            avoid: 0,
            resilience: 0,
            grit: 0,
            passiveDodge: 0,
            passiveParry: 0,
            initiative: 0,
            sanity: 0,
            sinThreshold: 0
        };

        const applyBonus = (bonus, grantBucket = null) => {
            const normalized = normalizeMechanicalBonus(bonus);
            const val = Number(normalized.value) || 0;
            const rawTarget = String(normalized.target || "").trim();
            const target = rawTarget.toLowerCase();

            switch (normalized.type) {
                case "stat":
                    if (Object.hasOwn(data.itemBonuses.attributes, rawTarget)) {
                        data.itemBonuses.attributes[rawTarget] += val;
                    } else if (rawTarget === "hp") {
                        data.hpMiscBonus = coerceSheetNumber(data.hpMiscBonus, 0) + val;
                    } else if (rawTarget === "sanity") {
                        data.itemBonuses.sanity += val;
                    } else if (rawTarget === "initiative") {
                        data.itemBonuses.initiative += val;
                    } else if (rawTarget === "sinThreshold") {
                        data.itemBonuses.sinThreshold += val;
                    }
                    break;
                case "defense":
                    if (["avoid", "resilience", "grit", "passiveDodge", "passiveParry"].includes(rawTarget)) {
                        data.itemBonuses[rawTarget] += val;
                    }
                    break;
                case "skill": {
                    const key = slugifySkill(target) || "all";
                    data.equippedBonuses.skills[key] = (data.equippedBonuses.skills[key] || 0) + val;
                    break;
                }
                case "attack":
                    if (!target || target === "all") {
                        data.equippedBonuses.attack += val;
                    } else {
                        const aKey = `attack_${target}`;
                        data.equippedBonuses[aKey] = (data.equippedBonuses[aKey] || 0) + val;
                    }
                    break;
                case "damage":
                    if (!target || target === "all") {
                        data.equippedBonuses.damage += val;
                    } else {
                        const dKey = `damage_${target}`;
                        data.equippedBonuses[dKey] = (data.equippedBonuses[dKey] || 0) + val;
                    }
                    break;
                case "spell":
                    data.equippedBonuses.spell += val;
                    break;
                case "resistance": {
                    const damageType = COMBAT_DAMAGE_TYPES.find(type =>
                        type.key.toLowerCase() === target || type.label.toLowerCase() === target
                    );
                    if (!damageType) break;
                    data.combatTraits.resistances[damageType.key] = true;
                    if (grantBucket?.resistances) grantBucket.resistances[damageType.key] = true;
                    break;
                }
                case "immunity": {
                    const { group, key } = parseMechanicalBonusImmunity(rawTarget);
                    const traitGroup = group === "damage" ? "damageTypes" : (group === "status" ? "statuses" : "effects");
                    if (!traits.immunities?.[traitGroup] || !key) break;
                    traits.immunities[traitGroup][key] = true;
                    if (grantBucket) {
                        if (!grantBucket.immunities) grantBucket.immunities = { damageTypes: {}, statuses: {}, effects: {} };
                        if (!grantBucket.immunities[traitGroup]) grantBucket.immunities[traitGroup] = {};
                        grantBucket.immunities[traitGroup][key] = true;
                    }
                    break;
                }
                case "absorption": {
                    if (!COMBAT_IMMUNITY_DAMAGE_TYPES.some(type => type.key === rawTarget)) break;
                    traits.absorption[rawTarget] = true;
                    if (grantBucket) {
                        if (!grantBucket.absorption) grantBucket.absorption = {};
                        grantBucket.absorption[rawTarget] = true;
                    }
                    break;
                }
                case "vulnerability": {
                    if (!COMBAT_DAMAGE_TYPES.some(type => type.key === rawTarget)) break;
                    const severityRank = { minor: 1, moderate: 2, severe: 3 };
                    const severity = normalized.severity;
                    const alreadyActive = traits.vulnerabilities[rawTarget] === true;
                    const currentSeverity = traits.vulnerabilitySeverity[rawTarget] || "minor";
                    traits.vulnerabilities[rawTarget] = true;
                    traits.vulnerabilitySeverity[rawTarget] = alreadyActive && severityRank[currentSeverity] > severityRank[severity]
                        ? currentSeverity
                        : severity;
                    if (grantBucket) {
                        if (!grantBucket.vulnerabilities) grantBucket.vulnerabilities = {};
                        grantBucket.vulnerabilities[rawTarget] = true;
                    }
                    break;
                }
                case "universalAbility": {
                    const definition = getUniversalAbilityDefinition(rawTarget);
                    if (!definition) break;
                    const { category, ability } = definition;
                    if (!traits.abilities[category.key]) traits.abilities[category.key] = {};
                    const alreadyActive = traits.abilities[category.key][ability.key] === true;
                    if (ability.amount) {
                        let amount = val || ability.amount.default || 1;
                        if (ability.amount.min !== undefined) amount = Math.max(ability.amount.min, amount);
                        if (ability.amount.max !== undefined) amount = Math.min(ability.amount.max, amount);
                        if (ability.key === "spellResistance") {
                            traits.spellResistancePercent = alreadyActive
                                ? Math.max(Number(traits.spellResistancePercent) || ability.amount.default, amount)
                                : amount;
                        } else {
                            if (!traits.abilityValues[category.key]) traits.abilityValues[category.key] = {};
                            const current = Number(traits.abilityValues[category.key][ability.key]) || ability.amount.default || 1;
                            traits.abilityValues[category.key][ability.key] = alreadyActive ? Math.max(current, amount) : amount;
                        }
                    }
                    traits.abilities[category.key][ability.key] = true;
                    if (grantBucket) {
                        if (!grantBucket.abilities) grantBucket.abilities = {};
                        if (!grantBucket.abilities[category.key]) grantBucket.abilities[category.key] = {};
                        grantBucket.abilities[category.key][ability.key] = true;
                    }
                    break;
                }
            }
        };

        const items = actorData.items ? [...actorData.items] : [];
        const itemPowerAttunementRule = game.settings?.get("thefade", "itemPowerAttunementRule") || "standard";

        actorData.equippedArmor = { head: [], body: [], arms: [], legs: [], shield: [] };

        const traits = data.combatTraits;
        traits.itemGranted = {
            abilities: {},
            resistances: {},
            immunities: { damageTypes: {}, statuses: {}, effects: {} },
            absorption: {},
            vulnerabilities: {}
        };
        traits.temporaryGranted = {
            abilities: {},
            resistances: {},
            immunities: { damageTypes: {}, statuses: {}, effects: {} },
            absorption: {},
            vulnerabilities: {}
        };
        traits.itemGrantedCustomImmunities = [];
        const customImmunityKeys = new Set();

        const creatureBonuses = applyCreatureRuleEffects(data, actorData.type);
        for (const bonus of creatureBonuses) applyBonus(bonus, traits.ruleGranted);

        const applyTraitGrants = (item) => {
            const grants = item.system?.traitGrants;
            if (!grants || typeof grants !== "object") return;

            for (const category of UNIVERSAL_ABILITY_CATEGORIES) {
                const categoryGrants = grants.abilities?.[category.key];
                if (!categoryGrants || typeof categoryGrants !== "object") continue;
                for (const ability of category.abilities) {
                    if (categoryGrants[ability.key] !== true) continue;
                    if (!traits.abilities[category.key]) traits.abilities[category.key] = {};
                    if (!traits.itemGranted.abilities[category.key]) traits.itemGranted.abilities[category.key] = {};

                    if (category.key === "defensive" && ability.key === "spellResistance") {
                        const alreadyActive = traits.abilities.defensive?.spellResistance === true;
                        const grantedPercent = Math.min(100, Math.max(1, Number(grants.spellResistancePercent) || 50));
                        traits.spellResistancePercent = alreadyActive
                            ? Math.max(Number(traits.spellResistancePercent) || 50, grantedPercent)
                            : grantedPercent;
                    }
                    traits.abilities[category.key][ability.key] = true;
                    traits.itemGranted.abilities[category.key][ability.key] = true;
                }
            }

            for (const type of COMBAT_DAMAGE_TYPES) {
                if (grants.resistances?.[type.key] === true) {
                    traits.resistances[type.key] = true;
                    traits.itemGranted.resistances[type.key] = true;
                }
            }
            for (const type of COMBAT_IMMUNITY_DAMAGE_TYPES) {
                if (grants.immunities?.damageTypes?.[type.key] === true) {
                    traits.immunities.damageTypes[type.key] = true;
                    traits.itemGranted.immunities.damageTypes[type.key] = true;
                }
            }
            for (const status of COMBAT_STATUS_IMMUNITIES) {
                if (grants.immunities?.statuses?.[status.key] === true) {
                    traits.immunities.statuses[status.key] = true;
                    traits.itemGranted.immunities.statuses[status.key] = true;
                }
            }
            for (const effect of COMBAT_IMMUNITY_EFFECTS) {
                if (grants.immunities?.effects?.[effect.key] === true) {
                    traits.immunities.effects[effect.key] = true;
                    traits.itemGranted.immunities.effects[effect.key] = true;
                }
            }

            const custom = String(grants.customImmunities || "")
                .split(/[;,\n]+/)
                .map(value => value.trim())
                .filter(Boolean);
            for (const label of custom) {
                const key = label.toLowerCase();
                if (customImmunityKeys.has(key)) continue;
                customImmunityKeys.add(key);
                traits.itemGrantedCustomImmunities.push({ label, source: item.name });
            }
        };

        for (const item of items) {
            const sys = item.system;
            if (!sys) continue;

            const suppliesArmor = item.type === 'armor'
                || (item.type === 'magicitem' && sys.conflictsArmor === true);
            if (suppliesArmor && sys.equipped && sys.location) {
                let location = String(sys.location).toLowerCase();
                if (location.includes('head')) location = 'head';
                else if (location.includes('body') || location.includes('torso')) location = 'body';
                else if (location.includes('arm')) location = 'arms';
                else if (location.includes('leg')) location = 'legs';
                else if (location.includes('shield')) location = 'shield';
                if (Array.isArray(actorData.equippedArmor[location])) {
                    actorData.equippedArmor[location].push(item);
                }
            }

            // Top-level bonuses arrays
            // - magicitem: only when equipped
            // - talent / precept: always active when owned
            let topLevel = null;
            if (isItemPowerActive(item, itemPowerAttunementRule)) topLevel = sys.bonuses;
            else if (item.type === 'talent' || item.type === 'precept') topLevel = sys.bonuses;

            if (Array.isArray(topLevel)) {
                for (const bonus of topLevel) applyBonus(bonus, traits.itemGranted);
            }

            if (isItemPowerActive(item, itemPowerAttunementRule)) applyTraitGrants(item);

            // Per-ability bonuses on paths and species
            const abilityMap = (item.type === 'path' || item.type === 'monsterpath') ? sys.abilities
                : (item.type === 'species' || item.type === 'monsterspecies') ? sys.speciesAbilities
                    : null;
            if (abilityMap && typeof abilityMap === 'object') {
                for (const ability of Object.values(abilityMap)) {
                    if (!ability || ability.activation === "active" || !Array.isArray(ability.bonuses)) continue;
                    for (const bonus of ability.bonuses) applyBonus(bonus, traits.itemGranted);
                }
            }
        }

        for (const entry of getActiveTemporaryBonusEntries(actorData)) {
            for (const bonus of entry.bonuses || []) applyBonus(bonus, traits.temporaryGranted);
        }

        traits.granted = foundry.utils.mergeObject(
            foundry.utils.mergeObject(foundry.utils.deepClone(traits.ruleGranted || {}), traits.itemGranted || {}, { inplace: true }),
            traits.temporaryGranted || {},
            { inplace: true }
        );

        data.regeneration = traits.abilities?.defensive?.regeneration === true
            ? Number(traits.abilityValues?.defensive?.regeneration) || 1
            : 0;

        this._refreshStatusImmunityLocks(data);
    }

    /**
    * Calculate base defenses without facing modifiers
    * @param {Object} data - Character data
    * @param {Actor} actor - The actor instance
    */
    _calculateBaseDefenses(data, actor) {
        // Ensure attributes exist before processing
        if (!data.attributes) {
            data.attributes = {
                physique: { value: 1 },
                finesse: { value: 1 },
                mind: { value: 1 },
                presence: { value: 1 },
                soul: { value: 1 }
            };
        }

        // Ensure defenses exist before processing
        if (!data.defenses) {
            data.defenses = {
                resilience: 0,
                avoid: 0,
                grit: 0,
                resilienceBonus: 0,
                avoidBonus: 0,
                gritBonus: 0,
                passiveDodge: 0,
                passiveParry: 0,
                facing: "front",
                avoidPenalty: 0
            };
        }

        // Initialize bonus values if they don't exist
        if (!data.defenses.resilienceBonus) data.defenses.resilienceBonus = 0;
        if (!data.defenses.avoidBonus) data.defenses.avoidBonus = 0;
        if (!data.defenses.gritBonus) data.defenses.gritBonus = 0;
        if (!data.defenses.avoidPenalty) data.defenses.avoidPenalty = 0;

        // Calculate base defenses based on effective attribute totals
        data.defenses.resilience = Math.floor(data.attributes.physique.total / 2);
        data.defenses.avoid = Math.floor(data.attributes.finesse.total / 2);
        data.defenses.grit = Math.floor(data.attributes.mind.total / 2);

        // Ensure minimum value of 1 for base defenses
        data.defenses.resilience = Math.max(1, data.defenses.resilience);
        data.defenses.avoid = Math.max(1, data.defenses.avoid);
        data.defenses.grit = Math.max(1, data.defenses.grit);

        // Calculate total defenses including bonuses but without facing penalties
        const itemAvoid = Number(data.itemBonuses?.avoid || 0);
        const itemResil = Number(data.itemBonuses?.resilience || 0);
        const itemGrit  = Number(data.itemBonuses?.grit || 0);
        data.totalResilience = Math.max(1, data.defenses.resilience + Number(data.defenses.resilienceBonus || 0) + itemResil);
        data.totalAvoid = Math.max(1, data.defenses.avoid + Number(data.defenses.avoidBonus || 0) + itemAvoid);
        data.totalGrit = Math.max(1, data.defenses.grit + Number(data.defenses.gritBonus || 0) + itemGrit);

        // Tooltip formula strings — show the effective attribute total
        const phy = data.attributes.physique.total, fin = data.attributes.finesse.total, mnd = data.attributes.mind.total;
        const itemResilPart = itemResil ? ` + ${itemResil} item` : "";
        const itemAvoidPart = itemAvoid ? ` + ${itemAvoid} item` : "";
        const itemGritPart  = itemGrit  ? ` + ${itemGrit} item`  : "";
        data.defenses.resilienceFormula = `Physique ${phy} ÷ 2 = ${data.defenses.resilience}` + (data.defenses.resilienceBonus ? ` + ${data.defenses.resilienceBonus} bonus` : "") + itemResilPart;
        data.defenses.avoidFormula     = `Finesse ${fin} ÷ 2 = ${data.defenses.avoid}` + (data.defenses.avoidBonus ? ` + ${data.defenses.avoidBonus} bonus` : "") + itemAvoidPart;
        data.defenses.gritFormula      = `Mind ${mnd} ÷ 2 = ${data.defenses.grit}` + (data.defenses.gritBonus ? ` + ${data.defenses.gritBonus} bonus` : "") + itemGritPart;

        // Stance-level defense overrides (Tough it Out / Resolute Will replace
        // the half-attribute formula with full-attribute for Resilience/Grit).
        applyBaseDefenseStances(data);

        // Calculate Passive Dodge based on Acrobatics skill and Finesse
        let acrobonaticsDodge = 0;
        let finesseDodge = Math.floor(data.attributes.finesse.total / 4);

        // Find Acrobatics skill
        const acrobaticsSkill = getSkill(actor, "Acrobatics");

        if (acrobaticsSkill) {
            const rank = acrobaticsSkill.rank;
            if (rank === 'adept') acrobonaticsDodge = 1;
            else if (rank === 'experienced') acrobonaticsDodge = 1;
            else if (rank === 'expert') acrobonaticsDodge = 2;
            else if (rank === 'mastered') acrobonaticsDodge = 3;
        }

        data.defenses.basePassiveDodge = Math.max(acrobonaticsDodge, finesseDodge);
        const pDodgeBonus = Number(data.defenses.passiveDodgeBonus || 0);
        const pDodgeItem  = Number(data.itemBonuses?.passiveDodge || 0);
        data.defenses.passiveDodge = data.defenses.basePassiveDodge + pDodgeBonus + pDodgeItem;
        data.defenses.passiveDodgeFormula = `Base ${data.defenses.basePassiveDodge}` + (pDodgeBonus ? ` + ${pDodgeBonus} bonus` : "") + (pDodgeItem ? ` + ${pDodgeItem} item` : "");
        // Stash Acrobatics rank dice so stance code can add them to Avoid in Dodge Stance.
        data.defenses.acrobaticsDodgeDice = acrobonaticsDodge;

        // Calculate Passive Parry based on highest weapon skill
        let highestParry = 0;
        const weaponSkillNames = ['Sword', 'Axe', 'Cudgel', 'Polearm', 'Unarmed'];
        for (const name of weaponSkillNames) {
            const skill = getSkill(actor, name);
            if (!skill) continue;
            let parryValue = 0;
            const rank = skill.rank;
            if (rank === 'practiced') parryValue = 1;
            else if (rank === 'adept') parryValue = 2;
            else if (rank === 'experienced') parryValue = 3;
            else if (rank === 'expert') parryValue = 4;
            else if (rank === 'mastered') parryValue = 6;
            if (parryValue > highestParry) highestParry = parryValue;
        }

        data.defenses.basePassiveParry = highestParry;
        const pParryBonus = Number(data.defenses.passiveParryBonus || 0);
        const pParryItem  = Number(data.itemBonuses?.passiveParry || 0);
        data.defenses.passiveParry = data.defenses.basePassiveParry + pParryBonus + pParryItem;
        data.defenses.passiveParryFormula = `Base ${data.defenses.basePassiveParry}` + (pParryBonus ? ` + ${pParryBonus} bonus` : "") + (pParryItem ? ` + ${pParryItem} item` : "");
    }

    /**
    * Apply facing modifiers to defenses
    * @param {Object} data - Character data
    */
    _applyFacingModifiers(data) {
        // Ensure defenses exist
        if (!data.defenses || typeof data.defenses !== 'object') {
            console.error("Defenses data missing in _applyFacingModifiers");
            return;
        }

        // Facing on the actor sheet was removed. Combat-side facing is
        // determined at attack time from token positions in the attack dialog,
        // so this hook only resets avoidPenalty and preserves passive values
        // (base + manual bonus) computed earlier.
        data.defenses.avoidPenalty = 0;
        if (data.defenses.basePassiveDodge === undefined) data.defenses.basePassiveDodge = 0;
        if (data.defenses.basePassiveParry === undefined) data.defenses.basePassiveParry = 0;

        // Ensure totalAvoid exists before modifying
        if (data.totalAvoid === undefined) {
            data.totalAvoid = (data.defenses.avoid || 0) + (data.defenses.avoidBonus || 0);
        }

        // Apply avoid penalty to total avoid
        data.totalAvoid += data.defenses.avoidPenalty;

        // Ensure total avoid doesn't go below 0
        data.totalAvoid = Math.max(0, data.totalAvoid);

        // Apply stance effects that depend on facing-corrected passive values
        // (Dodge Stance bonus to Avoid; Parrying Stance restores Parry on Back Flank).
        applyPassiveStances(data, data.defenses.acrobaticsDodgeDice || 0);

        // Re-clamp in case a stance pushed totalAvoid back up from 0.
        data.totalAvoid = Math.max(0, data.totalAvoid);

        // Stance summary string for the sheet.
        data.stanceSummary = summarizeStance(data);

        // Expose damage-mitigation flags for attack resolution (Brace for Impact).
        data.damageMitigation = getDamageMitigation(data.activeStance);
    }

    /**
     * Apply passive state deltas from active conditions: defenses, speed,
     * action economy flags, and prone/helpless/immobile states. Must run
     * after facing so the facing avoid penalty is already baked in.
     */
    _applyConditionState(data) {
        const effectiveConditions = this._conditionsWithoutImmunities(data.conditions, data.statusImmunityLocks);
        const state = aggregateConditionState(effectiveConditions);
        data.conditionState = state;
        data.conditionSummary = summarizeConditionState(state);

        if (state.avoidDelta) {
            data.totalAvoid = Math.max(0, (data.totalAvoid || 0) + state.avoidDelta);
        }
        if (state.gritDelta) {
            data.totalGrit = Math.max(0, (data.totalGrit || 0) + state.gritDelta);
        }
        if (state.resilienceDelta) {
            data.totalResilience = Math.max(0, (data.totalResilience || 0) + state.resilienceDelta);
        }

        // Compute effective movement from the base movement values, leaving
        // data.movement as the canonical un-penalized source of truth.
        const mult = state.immobile ? 0 : state.speedMultiplier;
        data.effectiveMovement = {
            land: Math.floor((data.movement?.land || 0) * mult),
            fly: Math.floor((data.movement?.fly || 0) * mult),
            swim: Math.floor((data.movement?.swim || 0) * mult),
            climb: Math.floor((data.movement?.climb || 0) * mult),
            burrow: Math.floor((data.movement?.burrow || 0) * mult)
        };
    }

    /**
     * Apply manual user overrides for derived defense values. An override
     * (non-null, finite number) replaces the computed total outright,
     * bypassing base, bonus, facing, stance, and condition deltas. Runs
     * last so it wins against every other source.
     */
    /**
     * Compute effective attribute totals. For each of the five attributes
     * sets `.total = override ?? (value + speciesBonus + flexibleBonus + bonus)`,
     * clamped to a minimum of 1. All downstream consumers (defenses, dodge,
     * damage bonus, soul checks, etc.) should read `.total` rather than
     * `.value` so manual bonuses and overrides propagate through game math.
     */
    _computeAttributeTotals(data) {
        if (!data.attributes) return;
        const keys = ["physique", "finesse", "mind", "presence", "soul"];
        for (const k of keys) {
            const a = data.attributes[k];
            if (!a) continue;
            const value = Number(a.value ?? 1);
            const species = Number(a.speciesBonus ?? 0);
            const flex = Number(a.flexibleBonus ?? 0);
            const bonus = Number(a.bonus ?? 0);
            const itemBonus = Number(data.itemBonuses?.attributes?.[k] ?? 0);
            const o = a.override;
            const overridden = o !== null && o !== undefined && o !== "" && Number.isFinite(Number(o));
            const capRaw = data.species?.statCaps?.[k];
            const speciesCap = capRaw !== null && capRaw !== undefined && capRaw !== "" && Number.isFinite(Number(capRaw))
                ? Number(capRaw)
                : null;
            const ruleCapRaw = data.creatureRuleAttributeCaps?.[k];
            const ruleCap = ruleCapRaw !== null && ruleCapRaw !== undefined && ruleCapRaw !== "" && Number.isFinite(Number(ruleCapRaw))
                ? Number(ruleCapRaw)
                : null;
            const cap = speciesCap === null ? ruleCap : (ruleCap === null ? speciesCap : Math.min(speciesCap, ruleCap));
            const lockRaw = data.creatureRuleAttributeLocks?.[k];
            const locked = lockRaw !== null && lockRaw !== undefined && Number.isFinite(Number(lockRaw));
            const unclamped = overridden ? Number(o) : value + species + flex + bonus + itemBonus;
            a.cap = cap;
            a.lockedByCreatureRule = locked;
            a.total = locked ? Number(lockRaw) : Math.max(1, cap !== null ? Math.min(unclamped, cap) : unclamped);
            a.displayValue = locked ? Number(lockRaw) : value;
        }
    }

    _applyDefenseOverrides(data) {
        if (!data.defenses) return;
        const apply = (overrideKey, totalKey, formulaKey) => {
            const o = data.defenses[overrideKey];
            if (o !== null && o !== undefined && o !== "" && Number.isFinite(Number(o))) {
                data[totalKey] = Number(o);
                data.defenses[formulaKey] = `Manual override: ${data[totalKey]}`;
            }
        };
        const applyOnDefenses = (overrideKey, valueKey, formulaKey) => {
            const o = data.defenses[overrideKey];
            if (o !== null && o !== undefined && o !== "" && Number.isFinite(Number(o))) {
                data.defenses[valueKey] = Number(o);
                data.defenses[formulaKey] = `Manual override: ${data.defenses[valueKey]}`;
            }
        };
        apply("resilienceOverride", "totalResilience", "resilienceFormula");
        apply("avoidOverride",      "totalAvoid",      "avoidFormula");
        apply("gritOverride",       "totalGrit",       "gritFormula");
        applyOnDefenses("passiveDodgeOverride", "passiveDodge", "passiveDodgeFormula");
        applyOnDefenses("passiveParryOverride", "passiveParry", "passiveParryFormula");
    }

    /**
     * Compute per-roll dice modifiers from the actor's active conditions.
     * Roll handlers call this after assembling the base pool and before
     * constructing the Roll formula. Returns { bonusDice, penaltyDice,
     * notes[], autoFail }.
     */
    getConditionRollModifiers(context) {
        const conditions = this._conditionsWithoutImmunities(
            this.system?.conditions,
            this.system?.statusImmunityLocks
        );
        return computeRollModifiers(conditions, context || { kind: "generic" });
    }

    /**
    * Calculate carrying capacity
    * @param {Object} data - Character data
    */
    _calculateCarryingCapacity(data) {
        // Ensure attributes exist
        if (!data.attributes || !data.attributes.physique) {
            console.error("Attributes missing in _calculateCarryingCapacity");
            // Set default carrying capacity
            data.carryingCapacity = {
                light: 50,
                medium: 100,
                heavy: 150,
                overHead: 225,
                offGround: 450,
                pushOrDrag: 750
            };
            return;
        }

        const physique = data.attributes.physique.total || 1;
        const heavy = (5 + physique) * 30;
        data.carryingCapacity = {
            light:      (5 + physique) * 10,
            medium:     (5 + physique) * 20,
            heavy,
            overHead:   Math.floor(heavy * 1.5),
            offGround:  heavy * 3,
            pushOrDrag: heavy * 5
        };

        // Determine current encumbrance tier from tracked load.
        const load = Number(data.currentLoad) || 0;
        const cap = data.carryingCapacity;
        let tier, tierLabel;
        if      (load <= 0)             { tier = "none";       tierLabel = "Unloaded"; }
        else if (load <= cap.light)     { tier = "light";      tierLabel = "Light"; }
        else if (load <= cap.medium)    { tier = "medium";     tierLabel = "Medium"; }
        else if (load <= cap.heavy)     { tier = "heavy";      tierLabel = "Heavy"; }
        else if (load <= cap.overHead)  { tier = "overHead";   tierLabel = "Over Head"; }
        else if (load <= cap.offGround) { tier = "offGround";  tierLabel = "Off Ground"; }
        else                            { tier = "pushOrDrag"; tierLabel = "Push/Drag"; }
        data.carryingCapacity.currentTier = tier;
        data.carryingCapacity.currentTierLabel = tierLabel;
    }


    /**
    * Calculate overland movement values based on species movement
    * @param {Object} data - Character system data
    */
    _calculateOverlandMovement(data) {
        // Initialize overland movement object if it doesn't exist
        if (!data['overland-movement']) {
            data['overland-movement'] = {};
        }

        // Get movement values, defaulting to 0 if not defined
        const land = data.movement?.land || 0;
        const fly = data.movement?.fly || 0;
        const swim = data.movement?.swim || 0;
        const climb = data.movement?.climb || 0;
        const burrow = data.movement?.burrow || 0;

        // Calculate overland movement (movement * 6)
        data['overland-movement'].landOverland = land * 6;
        data['overland-movement'].flyOverland = fly * 6;
        data['overland-movement'].swimOverland = swim * 6;
        data['overland-movement'].climbOverland = climb * 6;
        data['overland-movement'].burrowOverland = burrow * 6;
    }

    /**
     * Prepare NPC-specific data: auto-calculate defenses from attributes,
     * apply stances, facing, and condition state. HP max is stored directly.
     */
    _prepareNPCData(actorData) {
        const data = actorData.system;

        // Ensure attributes exist
        if (!data.attributes) {
            data.attributes = {
                physique: { value: 1 }, finesse: { value: 1 }, mind: { value: 1 },
                presence: { value: 1 }, soul: { value: 1 }
            };
        }

        if (!Array.isArray(data.creatureSubtypes)) data.creatureSubtypes = [];
        if (!Array.isArray(data.temporaryBonuses)) data.temporaryBonuses = [];

        // Apply type/subtype mechanics, item bonuses, and active temporary
        // bonuses before computing attributes and defenses.
        this._applyEquippedItemBonuses(data, actorData);

        // Compute effective attribute totals so downstream code reads
        // `.total` consistently across characters and NPCs.
        this._computeAttributeTotals(data);

        // Ensure defenses exist
        if (!data.defenses) {
            data.defenses = {
                resilience: 0, avoid: 0, grit: 0,
                resilienceBonus: 0, avoidBonus: 0, gritBonus: 0,
                passiveDodge: 0, passiveParry: 0, facing: "front", avoidPenalty: 0
            };
        }
        if (data.defenses.avoidPenalty === undefined) data.defenses.avoidPenalty = 0;

        // Ensure conditions are initialized
        const SEVERITY_CONDITIONS = ["bleed", "dazed", "fatigue", "fear", "illness", "pain", "paralysis", "staggered", "stunned"];
        const BINARY_CONDITIONS = ["blindness", "confusion", "deafness", "flatFooted", "sleep"];
        if (!data.conditions) data.conditions = {};
        for (const key of SEVERITY_CONDITIONS) {
            if (!data.conditions[key]) data.conditions[key] = { active: false, intensity: "trivial" };
        }
        for (const key of BINARY_CONDITIONS) {
            if (!data.conditions[key]) data.conditions[key] = { active: false };
        }

        if (!["none","dodgeStance","parryingStance","brace","toughItOut","resoluteWill"].includes(data.activeStance)) {
            data.activeStance = "none";
        }

        // Calculate defenses from effective attribute totals
        const phy = data.attributes.physique?.total || 1;
        const fin = data.attributes.finesse?.total || 1;
        const mnd = data.attributes.mind?.total || 1;
        data.defenses.resilience = Math.max(1, Math.floor(phy / 2));
        data.defenses.avoid = Math.max(1, Math.floor(fin / 2));
        data.defenses.grit = Math.max(1, Math.floor(mnd / 2));
        data.totalResilience = Math.max(1, data.defenses.resilience + (Number(data.defenses.resilienceBonus) || 0) + Number(data.itemBonuses?.resilience || 0));
        data.totalAvoid = Math.max(1, data.defenses.avoid + (Number(data.defenses.avoidBonus) || 0) + Number(data.itemBonuses?.avoid || 0));
        data.totalGrit = Math.max(1, data.defenses.grit + (Number(data.defenses.gritBonus) || 0) + Number(data.itemBonuses?.grit || 0));

        // No Acrobatics/weapon skill lookup for NPCs
        data.defenses.basePassiveDodge = 0;
        data.defenses.passiveDodge = 0;
        data.defenses.basePassiveParry = 0;
        data.defenses.passiveParry = 0;
        data.defenses.acrobaticsDodgeDice = 0;

        applyBaseDefenseStances(data);
        this._applyFacingModifiers(data);
        this._applyConditionState(data);
        this._applyDefenseOverrides(data);

        // HP state label (max is stored directly, not calculated)
        if (!data.hp) data.hp = { value: 10, max: 10 };
        data.hp.max = Math.max(1, Number(data.hp.max || 10) + coerceSheetNumber(data.hpMiscBonus, 0));
        const hp = data.hp.value ?? 0;
        const max = Math.max(1, data.hp.max ?? 10);
        if (hp >= max)          { data.hp.state = "healthy";     data.hp.stateLabel = "Healthy"; }
        else if (hp > max / 2)  { data.hp.state = "bloodied";    data.hp.stateLabel = "Bloodied"; }
        else if (hp > 0)        { data.hp.state = "wounded";     data.hp.stateLabel = "Wounded"; }
        else if (hp === 0)      { data.hp.state = "unconscious"; data.hp.stateLabel = "Unconscious"; }
        else if (hp > -max * 2) { data.hp.state = "dying";       data.hp.stateLabel = "Dying"; }
        else                    { data.hp.state = "dead";        data.hp.stateLabel = "Dead"; }
    }

    /**
     * Daily rest: scrub transient accumulators (currently Sin).
     * Addiction stages persist — rest does not reverse them.
     */
    async restDaily() {
        await resetDailySin(this);

        // Reset talent uses-per-day
        const talentsWithUses = this.items.filter(i => i.type === 'talent' && (i.system.usesPerDay ?? 0) > 0);
        for (const talent of talentsWithUses) {
            await talent.update({ "system.currentUses": 0 });
        }

        // Reset staff uses
        const staves = this.items.filter(i => i.type === 'staff');
        for (const staff of staves) {
            await staff.update({ "system.uses": 0 });
        }

        ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: this }),
            content: `<p><strong>${this.name}</strong> rests — Sin cleared, daily uses reset.</p>`
        });
    }

    async takeRest() {
        const physique = this.system?.attributes?.physique?.value ?? 1;
        const roll = await new Roll(`1d12 + ${physique}`).evaluate({ async: true });
        const healed = roll.total;
        const maxHP = this.system.hp.max ?? 0;
        const currentHP = this.system.hp.value ?? 0;
        const newHP = Math.min(currentHP + healed, maxHP);
        const actualHealed = newHP - currentHP;

        await this.update({ "system.hp.value": newHP });

        const diceResult = roll.dice[0]?.results?.[0]?.result ?? "?";
        ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: this }),
            content: `<div class="thefade chat-card">
                <h3>${this.name} Takes a Rest</h3>
                <p>Rolled <strong>1d12</strong> [${diceResult}] + Physique ${physique} = <strong>${healed}</strong></p>
                <p>HP restored: ${currentHP} → <strong>${newHP}</strong>${actualHealed < healed ? ` (capped at max)` : ``}</p>
            </div>`
        });
    }

}

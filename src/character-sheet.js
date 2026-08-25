// TheFadeCharacterSheet class (extracted from thefade.js).
import {
    SIZE_OPTIONS, AURA_COLOR_OPTIONS, AURA_SHAPE_OPTIONS,
    FLEXIBLE_BONUS_OPTIONS, FALLBACK_ACTOR_DATA,
    COMBAT_DAMAGE_TYPES, COMBAT_IMMUNITY_DAMAGE_TYPES,
    COMBAT_IMMUNITY_EFFECTS, COMBAT_STATUS_IMMUNITIES,
    UNIVERSAL_ABILITY_CATEGORIES,
    VULNERABILITY_SEVERITY_OPTIONS
} from './constants.js';
import {
    openCompendiumBrowser, initializeDefaultSkills,
    createCustomSkill, showCustomSkillDialog
} from './helpers.js';
import {
    getSkill, getSkillByKey, getAllSkills, getSkillsByCategory,
    calculateSkillDice, deleteCustomSkill, slugifySkill
} from './skills.js';
import { renderModifierHtml } from './conditions.js';
import { applyDarkItemCorruption, handleDarkCast, isDarkMagicSpell, performAddictionAttack, spellSchoolDisplay } from './dark-magic.js';
import { damageTypeFlags } from './damage.js';
import {
    buildSpellDamageProfile,
    buildSpellEffectsProfile,
    formatSpellAttackTargets,
    formatSpellDamageTracks,
    formatSpellSuccessRequirements,
    getSpellAttackTargets,
    getSpellSuccessRequirements
} from './spell-rules.js';
import {
    craftAlchemicalItem,
    getAlchemicalCraftCost,
    getAlchemicalDiscipline
} from './alchemy-rules.js';
import { openOpposedRollDialog, openAidAnotherDialog } from './opposed.js';
import { rollHitLocation, locationLabel } from './hit-location.js';
import { classifyTokenFacing } from './token-facing.js';
import { armorProtectionPools, buildProtectionView } from './protection.js';
import {
    startIgnition, endIgnition, getIgnitionState,
    IGNITION_INTENSITY_LABEL
} from './ignition.js';
import {
    ANATOMY_OPTIONS, calculateXenochildRolls, CROSSBREED_TYPES, getBestCrossbreedOutcome,
    getCrossbreedOutcome,
    MUTATION_SEVERITIES, rollMutation
} from './rules.js';
import { activateAbility, getActiveTemporaryBonusEntries } from './abilities.js';
import {
    CREATURE_TYPE_OPTIONS,
    buildCreatureSubtypeSelector,
    getCreatureRuleSources,
    normalizeCreatureType
} from './creature-rules.js';
import {
    addMechanicalBonusSheetOptions,
    readMechanicalBonusRow,
    updateMechanicalBonusRow
} from './mechanical-bonuses.js';
import {
    WEAPON_DAMAGE_ATTRIBUTE_OPTIONS,
    buildWeaponDamageProfile,
    formatWeaponDamageComponents,
    getWeaponAttackAttributeOverride,
    getWeaponCriticalDamageBonus,
    getWeaponMinimumHpDamage,
    getWeaponQualityRules,
    hasWeaponQuality,
    resolveWeaponDamageAttribute,
    weaponQualityDisplay
} from './weapon-rules.js';
import {
    canEquipItemPower,
    countAttunements,
    getDarkMagicItemCorruptionValue,
    isAttunementRemoved,
    isDarkMagicItem,
    isItemPowerActive,
    organizeItemsOfPower
} from './item-power-rules.js';

/**
* Character Sheet class for The Fade system
* Handles all character sheet rendering, interactions, and calculations
*/
export class TheFadeCharacterSheet extends ActorSheet {
    // --------------------------------------------------------------------
    // SHEET CONFIGURATION
    // --------------------------------------------------------------------
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["thefade", "sheet", "actor"],
            template: "systems/thefade/templates/actor/character-sheet.html",
            width: 840,
            height: 950,
            tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "main" }],
            // Preserve scroll position across re-renders so editing a field
            // doesn't yank the user back to the top of the sheet.
            scrollY: [".sheet-body", ".tab[data-group='primary']"]
        });
    }

    _getSheetSectionOpenState(key, defaultOpen = false) {
        if (!this._sheetSectionOpenStates) this._sheetSectionOpenStates = new Map();
        if (!this._sheetSectionOpenStates.has(key)) {
            this._sheetSectionOpenStates.set(key, defaultOpen);
        }
        return this._sheetSectionOpenStates.get(key);
    }

    /**
    * Get sheet data for rendering
    * @returns {Object} Sheet data object
    */
    getData() {
        let data;

        // Ensure actor exists before proceeding
        if (!this.actor) {
            console.error("Actor is null or undefined in getData()");
            return {
                actor: null,
                system: FALLBACK_ACTOR_DATA,
                items: [],
                dtypes: ["String", "Number", "Boolean"],
                sizeOptions: SIZE_OPTIONS
            };
        }

        try {
            data = super.getData();
        } catch (error) {
            console.error("Error in super.getData():", error);
            // Create minimal data structure with safe fallbacks
            data = {
                actor: this.actor,
                system: this.actor?.system || FALLBACK_ACTOR_DATA,
                items: this.actor?.items?.contents || [],
                dtypes: ["String", "Number", "Boolean"],
                sizeOptions: SIZE_OPTIONS
            };
        }

        data.sizeOptions = SIZE_OPTIONS;
        data.creatureTypeOptions = CREATURE_TYPE_OPTIONS;
        data.selectedCreatureType = normalizeCreatureType(this.actor.system.species?.creatureType);
        data.creatureSubtypeSelector = buildCreatureSubtypeSelector(this.actor.system, "character");
        data.creatureRuleAbilityView = {
            sources: getCreatureRuleSources(this.actor.system, "character"),
            canActivate: true
        };
        data.temporaryAbilityBonuses = getActiveTemporaryBonusEntries(this.actor).map(entry => ({
            ...entry,
            remainingRounds: entry.combatId
                ? Math.max(0, Number(entry.expiresRound) - (Number(game.combat?.round) || 0))
                : Math.max(1, Number(entry.durationRounds) || 1)
        }));

        data.combatDamageTypes = COMBAT_DAMAGE_TYPES;
        data.combatImmunityDamageTypes = COMBAT_IMMUNITY_DAMAGE_TYPES;
        data.combatImmunityEffects = COMBAT_IMMUNITY_EFFECTS;
        data.combatStatusImmunities = COMBAT_STATUS_IMMUNITIES;
        // Native <details> state is DOM-only and would otherwise reset every
        // time an actor update re-renders the sheet. Keep the open categories
        // on this sheet instance so Combat-tab accordions stay where the user
        // left them. Preserve the existing first-render behavior (all open).
        if (!this._combatTraitOpenCategories) {
            this._combatTraitOpenCategories = new Set(
                UNIVERSAL_ABILITY_CATEGORIES.map(category => category.key)
            );
        }
        data.universalAbilityCategories = UNIVERSAL_ABILITY_CATEGORIES.map(category => ({
            ...category,
            isOpen: this._combatTraitOpenCategories.has(category.key)
        }));
        data.vulnerabilitySeverityOptions = VULNERABILITY_SEVERITY_OPTIONS;

        data.flexibleBonusAttributeOptions = FLEXIBLE_BONUS_OPTIONS;

        data.auraColorOptions = AURA_COLOR_OPTIONS;

        data.auraShapeOptions = AURA_SHAPE_OPTIONS;

        data.auraIntensityOptions = {
            "": "None",
            "faint": "Faint",
            "moderate": "Moderate",
            "intense": "Intense"
        };

        data.anatomyOptions = ANATOMY_OPTIONS;
        data.anatomyRulesEnabled = game.settings?.get("thefade", "alternateAnatomyEnabled") ?? false;
        data.crossbreedTypes = CROSSBREED_TYPES;
        data.mutationSeverityOptions = MUTATION_SEVERITIES;
        data.fatePointsEnabled = game.settings?.get("thefade", "fatePointsEnabled") ?? false;
        data.isGM = game.user?.isGM ?? false;

        // Ignition status view-model for the aura card UI
        try {
            const ig = getIgnitionState(this.actor);
            const now = game?.time?.worldTime ?? 0;
            const recoveryRemaining = Math.max(0, (ig?.recoveryUntil || 0) - now);
            data.ignition = {
                active: !!ig?.active,
                intensityLabel: ig?.intensity ? (IGNITION_INTENSITY_LABEL[ig.intensity] || ig.intensity) : "",
                radius: ig?.radius || 0,
                participantCount: ig?.participants?.length || 0,
                recovering: !ig?.active && recoveryRemaining > 0,
                recoveryRemainingMin: Math.ceil(recoveryRemaining / 60)
            };
        } catch (_) {
            data.ignition = { active: false, recovering: false };
        }

        data.addictionLevelOptions = {
            "none": "None",
            "early": "Early Stages (+2D)",
            "middle": "Middle Stage (+4D)",
            "late": "Late Stage (+6D)",
            "terminal": "Terminal (N/A)"
        }

        data.skillRankOptions = {
            "untrained": "Untrained",
            "learned": "Learned",
            "practiced": "Practiced",
            "adept": "Adept",
            "experienced": "Experienced",
            "expert": "Expert",
            "mastered": "Mastered"
        };

        // Build the Skills tab view-model: groups by category with icons.
        data.skillCategoryGroups = this._buildSkillCategoryGroups().map(group => ({
            ...group,
            untrainedOpen: this._getSheetSectionOpenState(`skills-untrained-${group.key}`, false)
        }));
        data.skillCustomSectionOpen = this._getSheetSectionOpenState("skills-custom", false);
        data.magicSectionStates = {
            aura: this._getSheetSectionOpenState("magic-aura", false),
            darkMagic: this._getSheetSectionOpenState("magic-dark", false),
            spells: this._getSheetSectionOpenState("magic-spells", true)
        };
        data.abilitySectionStates = {
            creatureRules: this._getSheetSectionOpenState("abilities-creature-rules", true),
            speciesAbilities: this._getSheetSectionOpenState("abilities-species", true),
            pathAbilities: this._getSheetSectionOpenState("abilities-path-abilities", true),
            paths: this._getSheetSectionOpenState("abilities-paths", false),
            talents: this._getSheetSectionOpenState("abilities-talents", false),
            precepts: this._getSheetSectionOpenState("abilities-precepts", false),
            traits: this._getSheetSectionOpenState("abilities-traits", false)
        };

        // Attribute options shown when a skill is unlocked for editing.
        data.skillAttributeOptions = {
            "physique": "Physique",
            "finesse": "Finesse",
            "mind": "Mind",
            "presence": "Presence",
            "soul": "Soul"
        };

        // Additional safety checks
        if (!data.actor) {
            console.error("Actor missing from getData result");
            data.actor = this.actor;
        }

        if (!data.actor?.system) {
            console.error("Actor system data missing in sheet getData");
            data.system = FALLBACK_ACTOR_DATA;

            // Initialize actor system data if completely missing
            if (data.actor && !data.actor.system) {
                data.actor.system = FALLBACK_ACTOR_DATA;
            }
        } else {
            data.system = data.actor.system;
        }

        // Ensure items array exists
        if (!Array.isArray(data.items)) {
            data.items = data.actor?.items?.contents || [];
        }

        data.dtypes = ["String", "Number", "Boolean"];

        // Add size options to template data
        data.sizeOptions = SIZE_OPTIONS;

        // Only prepare character data if we have a valid actor and system data
        if (data.actor?.type === 'character' && data.system) {
            try {
                this._prepareCharacterItems(data);
                this._prepareCharacterData(data);
                data.linkedAbilitySources = this._buildLinkedAbilitySources(data.actor);
            } catch (error) {
                console.error("Error preparing character data:", error);
                console.error("Error stack:", error.stack);

                // Initialize minimal data to prevent template errors
                this._initializeMinimalCharacterData(data);
            }
        }

        const protectionPreset = data.anatomyRulesEnabled
            ? (data.system?.anatomy?.preset || "humanoid")
            : "humanoid";
        data.protectionRows = buildProtectionView(this.actor, protectionPreset);
        data.protectionControlsEnabled = true;

        // Ensure magic items data is available to template (with fallbacks)
        try {
            data.actor.magicItems = data.actor.system?.magicItems || {};
            data.actor.unequippedMagicItems = data.actor.system?.unequippedMagicItems || [];
            data.actor.currentAttunements = data.actor.system?.currentAttunements || 0;
            data.actor.maxAttunements = data.actor.system?.maxAttunements || 0;
        } catch (error) {
            console.error("Error setting up magic items data:", error);
            data.actor.magicItems = {};
            data.actor.unequippedMagicItems = [];
            data.actor.currentAttunements = 0;
            data.actor.maxAttunements = 0;
        }

        // Defense totals are derived data. Expose any amount below the rules
        // minimum directly to the template instead of persisting display-only
        // flags every time the sheet opens.
        const defenseExcess = total => Math.max(0, 1 - Number(total ?? 1));
        data.defenseExcess = {
            resilience: defenseExcess(data.system?.totalResilience),
            avoid: defenseExcess(data.system?.totalAvoid),
            grit: defenseExcess(data.system?.totalGrit)
        };

        addMechanicalBonusSheetOptions(data);
        return data;
    }

    _buildLinkedAbilitySources(actorData) {
        const buildSource = (item, root) => {
            if (!item) return null;
            // Sheet data contains plain embedded-item objects, which expose
            // Foundry's document identifier as `_id` rather than `id`.
            const itemId = item.id || item._id;
            if (!itemId) return null;
            const abilityObject = item.system?.[root] || {};
            const abilities = Object.entries(abilityObject).map(([id, ability]) => {
                const bonusPath = `system.${root}.${id}.bonuses`;
                return {
                    id,
                    name: ability?.name || "",
                    description: ability?.description || "",
                    activation: ability?.activation === "active" ? "active" : "passive",
                    actionCost: ability?.actionCost || "",
                    durationRounds: Math.max(1, Number(ability?.durationRounds) || 1),
                    bonuses: Array.isArray(ability?.bonuses) ? ability.bonuses : [],
                    bonusPath,
                    bonusSectionKey: `ability-bonuses-${itemId}-${id}`,
                    bonusesOpen: this._getSheetSectionOpenState(`ability-bonuses-${itemId}-${id}`, false),
                    namePath: `system.${root}.${id}.name`,
                    descriptionPath: `system.${root}.${id}.description`,
                    activationPath: `system.${root}.${id}.activation`,
                    actionCostPath: `system.${root}.${id}.actionCost`,
                    durationRoundsPath: `system.${root}.${id}.durationRounds`
                };
            });
            return {
                itemId,
                itemName: item.name,
                itemType: item.type,
                abilityRoot: root,
                abilities,
                abilityCount: abilities.length
            };
        };

        const species = buildSource(actorData.speciesItem, "speciesAbilities");
        const paths = (actorData.paths || []).map(path => {
            const source = buildSource(path, "abilities");
            return source ? {
                ...source,
                tierLabel: path.system?.isMonsterPath ? "Monster" : `Tier ${path.system?.tier || 1}`
            } : null;
        }).filter(Boolean);

        return {
            species,
            paths,
            pathAbilityCount: paths.reduce((total, source) => total + source.abilityCount, 0)
        };
    }

    /**
     * Initialize minimal character data to prevent template errors
     * @param {Object} data - Sheet data object
     */
    _initializeMinimalCharacterData(data) {
        // Ensure actor exists
        if (!data.actor) {
            console.error("Cannot initialize minimal data - no actor");
            return;
        }

        // Initialize all required arrays and objects
        data.actor.gear = [];
        data.actor.weapons = [];
        data.actor.armor = [];
        data.actor.paths = [];
        data.actor.spells = [];
        data.actor.skills = [];
        data.actor.talents = [];
        data.actor.mutations = [];
        data.actor.heritages = [];
        data.actor.downtimeProjects = [];
        data.actor.itemsOfPower = [];
        data.actor.equippedItemsOfPower = {};
        data.actor.unequippedItemsOfPower = [];
        data.actor.equippedArmor = {};
        data.actor.unequippedArmor = [];
        data.actor.armorTotals = {};
        data.actor.potions = [];
        data.actor.alchemical = [];
        data.actor.drugs = [];
        data.actor.currentAttunements = 0;
        data.actor.maxAttunements = 0;

        // Initialize minimal system data if missing
        if (!data.actor.system) {
            data.actor.system = foundry.utils.deepClone(FALLBACK_ACTOR_DATA);
        } else {
            // Ensure critical system properties exist
            if (!data.actor.system.defenses) {
                data.actor.system.defenses = {
                    resilience: 1,
                    avoid: 1,
                    grit: 1,
                    passiveDodge: 0,
                    passiveParry: 0,
                    facing: "front",
                    resilienceBonus: 0,
                    avoidBonus: 0,
                    gritBonus: 0,
                    avoidPenalty: 0
                };
            }

            if (!data.actor.system.carryingCapacity) {
                data.actor.system.carryingCapacity = {
                    light: 50,
                    medium: 100,
                    heavy: 150
                };
            }

            if (!data.actor.system.attributes) {
                data.actor.system.attributes = {
                    physique: { value: 1, speciesBonus: 0 },
                    finesse: { value: 1, speciesBonus: 0 },
                    mind: { value: 1, speciesBonus: 0 },
                    presence: { value: 1, speciesBonus: 0 },
                    soul: { value: 1, speciesBonus: 0 }
                };
            }
        }

        // Set system references for template access
        data.actor.system.currentAttunements = 0;
        data.actor.system.maxAttunements = 0;
    }

    // --------------------------------------------------------------------
    // DATA PREPARATION METHODS
    // --------------------------------------------------------------------

    /**
    * Organize and classify Items for Character sheets
    * @param {Object} sheetData - The sheet data to prepare
    */
    _prepareCharacterItems(sheetData) {
        // Enhanced safety checks
        if (!sheetData) {
            console.error("sheetData is null/undefined in _prepareCharacterItems");
            return;
        }

        const actorData = sheetData.actor;

        if (!actorData) {
            console.error("Actor data missing in _prepareCharacterItems");
            return;
        }

        if (!actorData.system) {
            console.error("Actor system data missing in _prepareCharacterItems");
            actorData.system = foundry.utils.deepClone(FALLBACK_ACTOR_DATA);
        }

        // Ensure items array exists and is iterable
        let items = [];
        if (sheetData.items && Array.isArray(sheetData.items)) {
            items = sheetData.items;
        } else if (actorData.items && Array.isArray(actorData.items)) {
            items = actorData.items;
        } else if (actorData.items && actorData.items.contents && Array.isArray(actorData.items.contents)) {
            items = actorData.items.contents;
        } else {
            console.warn("No valid items array found, initializing empty arrays");
            items = [];
        }

        // Initialize containers
        const gear = [];
        const weapons = [];
        const armor = [];
        const paths = [];
        const spells = [];
        const talents = [];
        const traits = [];
        const precepts = [];
        const itemsOfPower = [];
        const alchemical = [];
        const potions = [];
        const drugs = [];
        const poisons = []; // Templates expect this
        const biological = []; // Templates expect this  
        const medical = []; // Templates expect this
        const travel = []; // Templates expect this
        const musical = []; // Templates expect this
        const clothing = []; // Templates expect this
        const staff = []; // Templates expect this
        const wand = []; // Templates expect this
        const gate = []; // Templates expect this
        const communication = []; // Templates expect this
        const containment = []; // Templates expect this
        const dream = []; // Templates expect this
        const mount = []; // Templates expect this
        const vehicle = []; // Templates expect this
        const fleshcraft = []; // Templates expect this
        const mutations = [];
        const heritages = [];
        const downtimeProjects = [];

        // Safely iterate through items
        for (let i of items) {
            // Ensure item has basic properties
            if (!i || typeof i !== 'object') continue;

            // Set default image
            i.img = i.img || "icons/svg/item-bag.svg";

            // Ensure item has system data
            if (!i.system) {
                i.system = {};
            }

            // Categorize items by specific type - put each type in its own array
            try {
                if (i.type === 'magicitem') {
                    itemsOfPower.push(i);
                }
                else if (i.type === 'alchemical') {
                    i.alchemicalDiscipline = getAlchemicalDiscipline(i.system);
                    i.alchemicalCraftCost = getAlchemicalCraftCost(i.system);
                    alchemical.push(i);
                }
                else if (i.type === 'potion') {
                    potions.push(i);
                }
                else if (i.type === 'drug') {
                    drugs.push(i);
                }
                else if (i.type === 'poison') {
                    poisons.push(i);
                }
                else if (i.type === 'biological') {
                    biological.push(i);
                }
                else if (i.type === 'medical') {
                    medical.push(i);
                }
                else if (i.type === 'travel') {
                    travel.push(i);
                }
                else if (i.type === 'musical') {
                    musical.push(i);
                }
                else if (i.type === 'clothing') {
                    clothing.push(i);
                }
                else if (i.type === 'staff') {
                    staff.push(i);
                }
                else if (i.type === 'wand') {
                    wand.push(i);
                }
                else if (i.type === 'gate') {
                    gate.push(i);
                }
                else if (i.type === 'communication') {
                    communication.push(i);
                }
                else if (i.type === 'containment') {
                    containment.push(i);
                }
                else if (i.type === 'dream') {
                    dream.push(i);
                }
                else if (i.type === 'mount') {
                    mount.push(i);
                }
                else if (i.type === 'vehicle') {
                    vehicle.push(i);
                }
                else if (i.type === 'fleshcraft') {
                    fleshcraft.push(i);
                }
                else if (i.type === 'weapon') {
                    weapons.push(i);
                }
                else if (i.type === 'armor') {
                    armor.push(i);
                }
                else if (i.type === 'path' || i.type === 'monsterpath') {
                    paths.push(i);
                }
                else if (i.type === 'spell') {
                    i.displaySchool = spellSchoolDisplay(i);
                    i.isDarkSchool = isDarkMagicSpell(i);
                    i.damageDisplay = formatSpellDamageTracks(i.system);
                    i.effectsProfile = buildSpellEffectsProfile(i.system);
                    i.attackDisplay = formatSpellAttackTargets(i.system);
                    i.successesDisplay = formatSpellSuccessRequirements(i.system, { compact: true });
                    i.successesTitle = formatSpellSuccessRequirements(i.system);
                    spells.push(i);
                }
                else if (i.type === 'skill') {
                    // Skills are no longer items; legacy skill items are
                    // migrated to actor.system.skills on world ready. Drop.
                }
                else if (i.type === 'talent') {
                    talents.push(i);
                }
                else if (i.type === 'trait') {
                    traits.push(i);
                }
                else if (i.type === 'precept') {
                    precepts.push(i);
                }
                else if (i.type === 'mutation') {
                    mutations.push(i);
                }
                else if (i.type === 'heritage') {
                    heritages.push(i);
                }
                else if (i.type === 'downtime') {
                    downtimeProjects.push(i);
                }
                // Fallback to general gear for any unrecognized types
                else {
                    gear.push(i);
                }
            } catch (error) {
                console.warn(`Error categorizing item ${i.name || 'unknown'}:`, error);
            }
        }

        // Skills now come from actor.system.skills (data, not items).
        const skills = getAllSkills(this.actor);

        // Process Items of Power using the selected world slot/attunement rules.
        const itemPowerSlotRule = game.settings?.get("thefade", "itemPowerSlotRule") || "standard";
        const itemPowerAttunementRule = game.settings?.get("thefade", "itemPowerAttunementRule") || "standard";
        const { equippedItemsOfPower, itemPowerSlots, unequippedItemsOfPower } = this._processItemsOfPower(itemsOfPower, itemPowerSlotRule);
        for (const item of itemsOfPower) {
            item.isDarkMagicItem = isDarkMagicItem(item);
            item.darkMagicCorruptionValue = getDarkMagicItemCorruptionValue(item);
            item.itemPowerActive = isItemPowerActive(item, itemPowerAttunementRule);
            item.darkMagicDawn = item.system?.attunement === true
                || (isAttunementRemoved(itemPowerAttunementRule) && item.system?.equipped === true);
        }

        // An Item of Power marked as conflicting with armor is itself an
        // armor piece: while equipped it occupies its selected location and
        // participates in the ordinary AP/damage pipeline.
        const armoredItemsOfPower = itemsOfPower.filter(item => item.system?.conflictsArmor && item.system?.equipped);
        const { equippedArmor, unequippedArmor, armorTotals } = this._processArmor(
            [...armor, ...armoredItemsOfPower],
            actorData
        );

        // Calculate attunements safely
        const currentAttunements = this._calculateCurrentAttunements([...this.actor.items], itemPowerAttunementRule);
        const maxAttunements = isAttunementRemoved(itemPowerAttunementRule) ? 0 : this._calculateMaxAttunements(actorData);

        // Calculate dice pools for skills safely
        this._calculateSkillDicePools(skills, actorData);

        // Calculate dice pools for weapons safely
        this._calculateWeaponDicePools(weapons, skills, actorData);

        // Mark custom skills
        this._markCustomSkills(skills);

        // Assign data to actor with safe defaults
        actorData.gear = gear;
        actorData.weapons = weapons;
        actorData.armor = armor;
        actorData.paths = paths;
        actorData.spells = spells;
        actorData.skills = skills;
        actorData.talents = talents;
        actorData.speciesItem = items.find(i => i?.type === 'species' || i?.type === 'monsterspecies') || null;
        actorData.traits = traits;
        actorData.precepts = precepts;
        actorData.mutations = mutations;
        actorData.heritages = heritages;
        actorData.downtimeProjects = downtimeProjects;
        actorData.itemsOfPower = itemsOfPower;
        actorData.equippedItemsOfPower = equippedItemsOfPower;
        actorData.itemPowerSlots = itemPowerSlots;
        actorData.unequippedItemsOfPower = unequippedItemsOfPower;
        actorData.itemPowerSlotRule = itemPowerSlotRule;
        actorData.itemPowerAttunementRule = itemPowerAttunementRule;
        actorData.attunementRemoved = isAttunementRemoved(itemPowerAttunementRule);
        actorData.equippedArmor = equippedArmor;
        actorData.unequippedArmor = unequippedArmor;
        actorData.armorTotals = armorTotals;
        actorData.alchemical = alchemical;
        actorData.potion = potions;
        actorData.drugs = drugs;
        actorData.poisons = poisons;
        actorData.biological = biological;
        actorData.medical = medical;
        actorData.travel = travel;
        actorData.musical = musical;
        actorData.clothing = clothing;
        actorData.staff = staff;
        actorData.wand = wand;
        actorData.gate = gate;
        actorData.communication = communication;
        actorData.containment = containment;
        actorData.dream = dream;
        actorData.mount = mount;
        actorData.vehicle = vehicle;
        actorData.fleshcraft = fleshcraft;
        actorData.currentAttunements = currentAttunements;
        actorData.maxAttunements = maxAttunements;

        // Set system references for template access
        actorData.system.currentAttunements = currentAttunements;
        actorData.system.maxAttunements = maxAttunements;
    }

    /**
     * Safely calculate current attunements
     * @param {Array} itemsOfPower - Array of magic items
     * @returns {number} Current attunement count
     */
    _calculateCurrentAttunements(items, attunementRule = "standard") {
        try {
            return countAttunements(Array.isArray(items) ? items : [...(items || [])], attunementRule);
        } catch (error) {
            console.error("Error calculating current attunements:", error);
            return 0;
        }
    }

    /**
     * Safely calculate maximum attunements
     * @param {Object} actorData - Actor data
     * @returns {number} Maximum attunement count
     */
    _calculateMaxAttunements(actorData) {
        try {
            const totalLevel = actorData.system?.level || 1;
            const soulAttribute = Number(actorData.system?.attributes?.soul?.total ?? actorData.system?.attributes?.soul?.value ?? 1);
            return Math.max(0, Math.floor(totalLevel / 4) + soulAttribute);
        } catch (error) {
            console.error("Error calculating max attunements:", error);
            return 1;
        }
    }

    /**
     * Safely calculate dice pools for skills
     * @param {Array} skills - Array of skills
     * @param {Object} actorData - Actor data
     */
    _calculateSkillDicePools(skills, actorData) {
        if (!Array.isArray(skills)) return;
        for (const skill of skills) {
            if (!skill) continue;
            try {
                skill.calculatedDice = calculateSkillDice(this.actor, skill);
            } catch (error) {
                console.warn(`Error calculating dice pool for skill ${skill.name}:`, error);
                skill.calculatedDice = 1;
            }
        }
    }

    /**
     * Safely calculate dice pools for weapons
     * @param {Array} weapons - Array of weapons
     * @param {Array} skills - Array of skills
     * @param {Object} actorData - Actor data
     */
    _calculateWeaponDicePools(weapons, skills, actorData) {
        if (!Array.isArray(weapons)) return;

        weapons.forEach(weapon => {
            if (!weapon || !weapon.system) return;

            try {
                const skillName = weapon.system.skill;
                const skill = Array.isArray(skills) ? skills.find(s => s && s.name === skillName) : null;

                // Add attribute abbreviation
                const attrAbbreviations = {
                    "none": "N/A",
                    "physique": "PHY",
                    "fullPhysique": "PHY",
                    "finesse": "FIN",
                    "fullFinesse": "FIN",
                    "mind": "MND",
                    "fullMind": "MND",
                    "presence": "PRS",
                    "fullPresence": "PRS",
                    "soul": "SOL",
                    "fullSoul": "SOL",
                    "higherPhysiqueFinesse": "PHY/FIN"
                };
                const damageAttribute = resolveWeaponDamageAttribute(weapon.system);
                weapon.attributeAbbr = attrAbbreviations[damageAttribute.key] || "N/A";
                weapon.damageAttributeLabel = WEAPON_DAMAGE_ATTRIBUTE_OPTIONS[damageAttribute.key] || "N/A";
                weapon.damageDisplay = formatWeaponDamageComponents(weapon.system);
                weapon.qualityDisplay = weaponQualityDisplay(weapon.system) || "—";

                const weaponSkillNameLower = (weapon.system.skill || "").toLowerCase();
                const eb2 = actorData?.system?.equippedBonuses;
                const itemAttackBonus = eb2
                    ? (eb2.attack || 0) + (eb2[`attack_${weaponSkillNameLower}`] || 0)
                    : 0;

                if (skill && skill.calculatedDice !== undefined) {
                    const attackOverride = getWeaponAttackAttributeOverride(weapon.system);
                    const skillDice = attackOverride
                        ? calculateSkillDice(this.actor, { ...skill, attribute: attackOverride.key })
                        : skill.calculatedDice;
                    weapon.calculatedDice = skillDice + (weapon.system.miscBonus || 0) + itemAttackBonus;
                } else {
                    // Untrained calculation
                    const attributeName = getWeaponAttackAttributeOverride(weapon.system)?.key || "physique";
                    if (attributeName !== "none" && actorData?.system?.attributes) {
                        let attrValue = actorData.system.attributes[attributeName]?.total
                            ?? actorData.system.attributes[attributeName]?.value
                            ?? 0;
                        let dicePool = Math.floor(attrValue / 2);
                        dicePool += (weapon.system.miscBonus || 0) + itemAttackBonus;
                        weapon.calculatedDice = Math.max(1, dicePool);
                    } else {
                        weapon.calculatedDice = Math.max(1, (weapon.system.miscBonus || 0) + itemAttackBonus);
                    }
                }
            } catch (error) {
                console.warn(`Error calculating dice pool for weapon ${weapon.name}:`, error);
                weapon.calculatedDice = 1;
            }
        });
    }

    /**
    * Calculate derived stats for the character
    * @param {Object} sheetData - The sheet data to prepare
    */
    _prepareCharacterData(sheetData) {
        if (!sheetData || !sheetData.actor || !sheetData.actor.system) {
            console.error("Missing actor or system data in _prepareCharacterData");
            return;
        }

        const data = sheetData.actor.system;

        // Initialize level-up related properties if they don't exist
        if (data.level === undefined) data.level = 1;
        if (data.experience === undefined) data.experience = 0;
        if (data.isMonster === undefined) data.isMonster = false;
        if (data.talentsBonus === undefined) data.talentsBonus = 0;

        const level = data.level || 1;

        // Calculate tier levels
        this.actor.system.tier1tl = level;
        this.actor.system.tier2tl = Math.max(0, level - 4);
        this.actor.system.tier3tl = Math.max(0, level - 9);


        // Calculate paths allowed
        if (data.isMonster) {
            data.pathsAllowed = 0;
        } else {
            data.pathsAllowed = 1 + Math.floor((level - 1) / 5);
        }

        // Calculate max tier
        if (level >= 10) {
            data.maxTier = 3;
        } else if (level >= 5) {
            data.maxTier = 2;
        } else {
            data.maxTier = 1;
        }

        // Calculate talents from level
        data.talentsFromLevel = this._calculateTalentsFromLevel(level);
        data.talentsTotal = data.talentsFromLevel + data.talentsBonus;

        // Calculate current talents (excluding traits)
        const actualTalents = sheetData.actor.talents ? sheetData.actor.talents.length : 0;
        const actualTraits = sheetData.actor.traits ? sheetData.actor.traits.length : 0;
        data.currentTalents = actualTalents;

        // Calculate current traits separately
        const currentTraits = sheetData.actor.traits ? sheetData.actor.traits.length : 0;
        data.currentTraits = currentTraits;

        // Ensure actor exists for the methods that need it
        if (!sheetData.actor) {
            console.error("Actor missing from sheetData in _prepareCharacterData");
            return;
        }

        // Apply flexible bonus to selected attribute
        if (data.species?.flexibleBonus?.value > 0) {
            const selectedAttr = data.species.flexibleBonus.selectedAttribute;
            if (selectedAttr && data.attributes[selectedAttr]) {
                data.attributes[selectedAttr].flexibleBonus = data.species.flexibleBonus.value;
            }
        }

        // Point-buy status: budget is 20 points above baseline 1-in-each
        // (rules: attributes start at 1, max 10, spend 20 to raise).
        const attrNames = ["physique", "finesse", "mind", "presence", "soul"];
        const pointBuyBudget = 20;
        let spent = 0;
        let capExceeded = false;
        for (const a of attrNames) {
            const v = Number(data.attributes?.[a]?.value) || 0;
            spent += Math.max(0, v - 1);
            if (v > 10) capExceeded = true;
        }
        data.pointBuy = {
            spent,
            budget: pointBuyBudget,
            remaining: pointBuyBudget - spent,
            over: spent > pointBuyBudget,
            capExceeded
        };

        data.creationMode = game.settings.get("thefade", "characterCreationMode");

        // Initialize minimal defense data to prevent template errors
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
    }

    // Calculate talents gained from level (odd levels starting at 1)
    _calculateTalentsFromLevel(level) {
        let talents = 0;
        for (let i = 1; i <= level; i++) {
            if (i % 2 === 1) { // Odd levels
                talents++;
            }
        }
        return talents;
    }

    // Experience check - auto level up if experience >= 10
    async _onExperienceCheck(event) {
        event.preventDefault();
        const currentExp = this.actor.system.experience || 0;

        if (currentExp >= 10) {
            ui.notifications.info("Ready to level up! Click Level Up button.");
        } else {
            ui.notifications.info(`Need ${10 - currentExp} more experience to level up.`);
        }
    }

    // Monster checkbox change handler
    async _onMonsterChange(event) {
        event.preventDefault();
        const isMonster = event.target.checked;

        await this.actor.update({
            'system.isMonster': isMonster,
            'system.pathsAllowed': isMonster ? 0 : (1 + Math.floor((this.actor.system.level - 1) / 5))
        });
    }

    // Main level up function
    async _onLevelUp(event) {
        event.preventDefault();

        const currentLevel = this.actor.system.level || 1;
        const currentExp = this.actor.system.experience || 0;

        if (currentExp < 10) {
            ui.notifications.warn(`Need ${10 - currentExp} more experience to level up.`);
            return;
        }

        const newLevel = currentLevel + 1;

        // Update level and reset experience
        await this.actor.update({
            'system.level': newLevel,
            'system.experience': 0
        });

        ui.notifications.info(`Leveled up to ${newLevel}!`);

        // Apply level-based improvements
        await this._applyLevelUpBenefits(newLevel);
    }

    // Apply all level-up benefits based on the advancement table
    async _applyLevelUpBenefits(level) {
        // Stat increases
        if ([3, 6, 9].includes(level)) {
            await this._showStatIncreaseDialog("Choose a stat to increase by 1:", false);
        }

        if ([4, 10].includes(level) || (level > 10 && level % 6 === 4)) {
            await this._increaseLowestStat();
        }

        // Talents (handled automatically in _prepareCharacterData)
        if (level % 2 === 1) {
            ui.notifications.info("You gained a talent! Check your talent count.");
        }

        // Spells learned (handled automatically in _prepareCharacterData)
        if (level % 2 === 0) {
            const spellcasting = getSkill(this.actor, "Spellcasting");
            const trained = ['learned', 'practiced', 'adept', 'experienced', 'expert', 'mastered'];
            if (spellcasting && trained.includes(spellcasting.rank)) {
                ui.notifications.info("You can learn a new spell! Check your spells learned count.");
            }
        }

        // Skill increases
        if ([2, 5, 8].includes(level) || (level > 10 && (level - 2) % 3 === 0)) {
            await this._showSkillIncreaseDialog(2);
        }

        if ([3, 6, 9].includes(level) || (level > 10 && (level - 3) % 3 === 0)) {
            await this._showSkillIncreaseDialog(1);
        }

        // Tier advancement notifications
        if (level === 5) {
            ui.notifications.info("You can now access Tier 2 paths!");
        } else if (level === 10) {
            ui.notifications.info("You can now access Tier 3 paths!");
        }

        // Path advancement
        if (level % 5 === 0) {
            ui.notifications.info("You can select a new path!");
        }
    }

    // Show stat increase dialog
    // UPDATE the _increaseLowestStat method with null checks:
    async _increaseLowestStat() {
        const attributes = this.actor.system.attributes;

        // Add null check
        if (!attributes) {
            ui.notifications.error("Character attributes not found.");
            return;
        }

        const statValues = Object.entries(attributes).map(([key, attr]) => ({
            key,
            value: attr.value || 1  // Default to 1 if undefined
        }));

        const minValue = Math.min(...statValues.map(s => s.value));
        const lowestStats = statValues.filter(s => s.value === minValue);

        if (lowestStats.length === 1) {
            // Only one lowest stat, increase it automatically
            const stat = lowestStats[0];
            await this.actor.update({
                [`system.attributes.${stat.key}.value`]: stat.value + 1
            });
            ui.notifications.info(`${stat.key.charAt(0).toUpperCase() + stat.key.slice(1)} (lowest stat) increased to ${stat.value + 1}!`);
        } else {
            // Multiple tied for lowest, let player choose
            await this._showStatIncreaseDialog("Multiple stats tied for lowest. Choose one to increase:", true);
        }
    }

    // Show skill increase dialog
    async _showSkillIncreaseDialog(points) {
        ui.notifications.info(`You have ${points} skill increase${points > 1 ? 's' : ''} to spend. Use the Skills tab to improve skills.`);
    }

    /**
    * Process Items of Power with the configured slot and overlap rules.
    * @param {Array} itemsOfPower - Array of magic items
    * @returns {Object} Equipped and unequipped items
    */
    _processItemsOfPower(itemsOfPower, slotRule = "standard") {
        const organized = organizeItemsOfPower(itemsOfPower, slotRule);
        const equippedItemsOfPower = {};
        for (const slot of organized.slots) {
            if (slot.items[0]) equippedItemsOfPower[slot.key] = slot.items[0];
        }
        return {
            equippedItemsOfPower,
            itemPowerSlots: organized.slots,
            unequippedItemsOfPower: organized.unequipped
        };
    }

    /**
    * Process Armor with stacking support  
    * @param {Array} armor - Array of armor items
    * @param {Object} actorData - Actor data
    * @returns {Object} Equipped armor, unequipped armor, and totals
    */
    _processArmor(armor, actorData) {
        if (!Array.isArray(armor)) {
            console.warn("Armor data not found or not an array");
            return {
                equippedArmor: { head: [], body: [], arms: [], legs: [], shield: [] },
                unequippedArmor: [],
                armorTotals: {
                    head: { current: 0, max: 0 },
                    body: { current: 0, max: 0 },
                    leftarm: { current: 0, max: 0 },
                    rightarm: { current: 0, max: 0 },
                    leftleg: { current: 0, max: 0 },
                    rightleg: { current: 0, max: 0 },
                    shield: { current: 0, max: 0 }
                }
            };
        }

        const equippedArmor = {
            head: [],
            body: [],
            arms: [],
            legs: [],
            shield: []
        };
        const unequippedArmor = [];

        for (let item of armor) {
            if (!item || !item.system) continue;

            if (item.system.equipped && item.system.location) {
                let location = item.system.location.toLowerCase();

                // Map location variations
                if (location.includes('head')) location = 'head';
                else if (location.includes('body') || location.includes('torso')) location = 'body';
                else if (location.includes('arm')) location = 'arms';
                else if (location.includes('leg')) location = 'legs';
                else if (location.includes('shield')) location = 'shield';

                if (Array.isArray(equippedArmor[location])) {
                    equippedArmor[location].push(item);
                }
            } else {
                unequippedArmor.push(item);
            }
        }

        // Calculate armor totals properly
        // Calculate armor totals properly
        const armorTotals = {};
        const locations = ['head', 'body', 'leftarm', 'rightarm', 'leftleg', 'rightleg', 'shield'];

        locations.forEach(location => {
            armorTotals[location] = { current: 0, max: 0 };

            // Effective max AP includes magical strengthening bonus
            const effectiveMaxAP = (a) => (Number(a.system.ap) || 0) + (Number(a.system.apIncrease) || 0);

            // Add individual armor pieces for this location
            const locationArmor = equippedArmor[location] || [];
            locationArmor.forEach(armor => {
                armorTotals[location].current += armor.system.currentAP || 0;
                armorTotals[location].max += effectiveMaxAP(armor);
            });

            // Add derived AP from arms/legs armor. `|| armor.system.ap` was a
            // bug: derivedLeftAP=0 (drained) is falsy and fell back to max,
            // hiding damage. Use an explicit typeof check instead.
            if (location === 'leftarm' || location === 'rightarm') {
                const armsArmor = equippedArmor.arms || [];
                armsArmor.forEach(armor => {
                    const derivedProp = location === 'leftarm' ? 'derivedLeftAP' : 'derivedRightAP';
                    const derived = armor.system[derivedProp];
                    const pool = (typeof derived === 'number') ? derived : effectiveMaxAP(armor);
                    armorTotals[location].current += pool;
                    armorTotals[location].max += effectiveMaxAP(armor);
                });
            }

            if (location === 'leftleg' || location === 'rightleg') {
                const legsArmor = equippedArmor.legs || [];
                legsArmor.forEach(armor => {
                    const derivedProp = location === 'leftleg' ? 'derivedLeftAP' : 'derivedRightAP';
                    const derived = armor.system[derivedProp];
                    const pool = (typeof derived === 'number') ? derived : effectiveMaxAP(armor);
                    armorTotals[location].current += pool;
                    armorTotals[location].max += effectiveMaxAP(armor);
                });
            }

        });

        return { equippedArmor, unequippedArmor, armorTotals };
    }

    /**
    * Mark custom skills with display flags
    * @param {Array} skills - Array of skills
    */
    _markCustomSkills(skills) {
        if (!Array.isArray(skills)) return;
        for (const skill of skills) {
            if (!skill) continue;
            skill.isCustomSkill = !!skill.isCustom;
            skill.canDelete = !!skill.isCustom;
            if (skill.skillType) {
                skill.skillTypeDisplay = skill.skillType.charAt(0).toUpperCase() + skill.skillType.slice(1);
            }
        }
    }

    /**
     * Build the grouped view-model the Skills tab renders from.
     * Each group has { key, label, icon, skills: [...] } and each skill
     * gets `attributeAbbr` + `calculatedDice` populated for the template.
     */
    _buildSkillCategoryGroups() {
        const ATTR_ABBR = {
            "physique": "PHY", "finesse": "FIN", "mind": "MND",
            "presence": "PRS", "soul": "SOL",
            "physique_finesse": "PHY/FIN", "physique_mind": "PHY/MND",
            "mind_soul": "MND/SOL", "finesse_presence": "FIN/PRS"
        };
        const CATEGORY_META = [
            { key: "Combat",    label: "Combat",    icon: "fa-gavel" },
            { key: "Physical",  label: "Physical",  icon: "fa-person-running" },
            { key: "Craft",     label: "Craft",     icon: "fa-hammer" },
            { key: "Knowledge", label: "Knowledge", icon: "fa-book" },
            { key: "Magical",   label: "Magical",   icon: "fa-wand-sparkles" },
            { key: "Sense",     label: "Sense",     icon: "fa-eye" },
            { key: "Social",    label: "Social",    icon: "fa-comments" }
        ];

        const byCategory = getSkillsByCategory(this.actor);
        for (const list of Object.values(byCategory)) {
            for (const skill of list) {
                skill.calculatedDice = calculateSkillDice(this.actor, skill);
                skill.attributeAbbr = ATTR_ABBR[skill.attribute] || (skill.attribute || "").toUpperCase();
                skill.defaultAttributeAbbr = ATTR_ABBR[skill.defaultAttribute] || (skill.defaultAttribute || "").toUpperCase();
                skill.isCustomSkill = !!skill.isCustom;
                skill.canDelete = !!skill.isCustom;
                skill.canEditAttribute = !!skill.isCustom || !!skill.attributeUnlocked;
            }
        }

        const groups = [];
        for (const meta of CATEGORY_META) {
            const list = byCategory[meta.key];
            if (list && list.length) {
                const trainedSkills = list.filter(skill => skill.rank !== "untrained");
                const untrainedSkills = list.filter(skill => skill.rank === "untrained");
                groups.push({
                    ...meta,
                    skills: list,
                    trainedSkills,
                    untrainedSkills,
                    trainedCount: trainedSkills.length,
                    untrainedCount: untrainedSkills.length
                });
            }
        }

        // Any unknown category (defensive) gets dumped at the end.
        for (const [cat, list] of Object.entries(byCategory)) {
            if (CATEGORY_META.find(m => m.key === cat)) continue;
            const trainedSkills = list.filter(skill => skill.rank !== "untrained");
            const untrainedSkills = list.filter(skill => skill.rank === "untrained");
            groups.push({
                key: cat,
                label: cat,
                icon: "fa-star",
                skills: list,
                trainedSkills,
                untrainedSkills,
                trainedCount: trainedSkills.length,
                untrainedCount: untrainedSkills.length
            });
        }
        return groups;
    }

    // --------------------------------------------------------------------
    // ARMOR POINT (AP) REDUCTION SYSTEM
    // --------------------------------------------------------------------

    /**
    * Show dialog to get AP reduction amount
    * @param {string} title - Dialog title
    * @param {string} content - Dialog content/description
    * @param {number} maxAmount - Maximum allowed reduction
    * @returns {Promise<number|null>} Amount to reduce or null if cancelled
    */
    async _getReductionAmount(title, content, maxAmount) {
        return new Promise((resolve) => {
            const dialog = new Dialog({
                title: title,
                content: `
                <div style="margin-bottom: 10px;">${content}</div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <label for="reduction-amount">Reduce by:</label>
                    <input type="number" id="reduction-amount" name="amount" 
                           value="1" min="1" max="${maxAmount}" 
                           style="width: 80px; text-align: center;" />
                    <span>points</span>
                </div>
            `,
                buttons: {
                    reduce: {
                        icon: '<i class="fas fa-minus"></i>',
                        label: "Reduce",
                        callback: (html) => {
                            const amount = parseInt(html.find('#reduction-amount').val()) || 1;
                            const validAmount = Math.min(Math.max(1, amount), maxAmount);
                            resolve(validAmount);
                        }
                    },
                    cancel: {
                        icon: '<i class="fas fa-times"></i>',
                        label: "Cancel",
                        callback: () => resolve(null)
                    }
                },
                default: "reduce",
                close: () => resolve(null),
                render: (html) => {
                    // Focus and select the input field
                    const input = html.find('#reduction-amount');
                    input.focus().select();

                    // Allow Enter key to submit
                    input.keypress((e) => {
                        if (e.which === 13) { // Enter key
                            html.find('.dialog-button.reduce').click();
                        }
                    });
                }
            });
            dialog.render(true);
        });
    }

    /**
    * Distribute AP reduction across Natural Deflection and armor pieces
    * @param {string} location - Body location
    * @param {number} totalReduction - Total amount to reduce
    */
    async _distributeAPReduction(location, totalReduction) {
        let remaining = Math.max(0, Number(totalReduction) || 0);
        const ndData = this.actor.system.naturalDeflection?.[location];
        const ndCurrent = Math.max(0, Number(ndData?.current) || 0);
        const armorPools = armorProtectionPools(this.actor, location).filter(pool => pool.current > 0);
        const highestArmor = armorPools.reduce(
            (highest, pool) => (!highest || pool.current > highest.current ? pool : highest),
            null
        );

        if (ndData?.stacks === true) {
            const ndReduction = Math.min(ndCurrent, remaining);
            if (ndReduction > 0) {
                await this.actor.update({
                    [`system.naturalDeflection.${location}.current`]: ndCurrent - ndReduction
                });
                remaining -= ndReduction;
            }
            if (remaining > 0) {
                remaining -= await this._reduceArmorProtection(location, remaining);
            }
        } else if (ndCurrent > 0 && (!highestArmor || ndCurrent >= highestArmor.current)) {
            const ndReduction = Math.min(ndCurrent, remaining);
            if (ndReduction > 0) {
                await this.actor.update({
                    [`system.naturalDeflection.${location}.current`]: ndCurrent - ndReduction
                });
                remaining -= ndReduction;
            }
        } else if (highestArmor && remaining > 0) {
            remaining -= await this._reduceArmorProtection(location, remaining);
        }

        this.render(false);
        return Math.max(0, Number(totalReduction) || 0) - remaining;
    }

    /**
    * Setup armor reset functionality
    * @param {HTMLElement} html - Sheet HTML element
    */
    _setupArmorResetListeners(html) {

        // Individual armor reset
        const resetButtons = html.find('.reset-armor-button');

        resetButtons.on('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();

            const button = event.currentTarget;
            const li = button.closest('.item');

            if (!li) {
                console.error("Could not find parent item element");
                return;
            }

            const itemId = li.dataset.itemId || $(li).data("itemId");

            if (!itemId) {
                console.error("No item ID found");
                return;
            }

            const item = this.actor.items.get(itemId);
            if (!item) {
                console.error(`No item found with ID ${itemId}`);
                return;
            }

            const isArmorPiece = item.type === "armor"
                || (item.type === "magicitem" && item.system?.conflictsArmor);
            if (!isArmorPiece) {
                console.error(`Item ${item.name} does not provide armor protection.`);
                return;
            }

            try {
                // Effective max AP includes strengthening bonus
                const maxAP = (Number(item.system.ap) || 0) + (Number(item.system.apIncrease) || 0);

                const updates = { "system.currentAP": maxAP };
                if (["Arms", "Arms+", "Legs", "Legs+"].includes(item.system.location)) {
                    updates["system.derivedLeftAP"] = maxAP;
                    updates["system.derivedRightAP"] = maxAP;
                }
                await item.update(updates);
                ui.notifications.info(`${item.name}'s armor protection has been restored to full.`);
            } catch (error) {
                console.error("Error updating armor:", error);
                ui.notifications.error("Failed to reset armor. See console for details.");
            }
        });

        // Reset all armor
        const resetAllButton = html.find('.reset-all-armor');

        resetAllButton.on('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();

            const armorItems = this.actor.items.filter(i => i.type === "armor"
                || (i.type === "magicitem" && i.system?.conflictsArmor));

            if (armorItems.length === 0) {
                ui.notifications.warn("No armor items found.");
                return;
            }

            try {
                for (const armor of armorItems) {
                    const maxAP = (Number(armor.system.ap) || 0) + (Number(armor.system.apIncrease) || 0);

                    const updates = { "system.currentAP": maxAP };
                    if (["Arms", "Arms+", "Legs", "Legs+"].includes(armor.system.location)) {
                        updates["system.derivedLeftAP"] = maxAP;
                        updates["system.derivedRightAP"] = maxAP;
                    }
                    await armor.update(updates);
                }

                ui.notifications.info(`All armor has been restored to full protection.`);
            } catch (error) {
                console.error("Error updating all armor:", error);
                ui.notifications.error("Failed to reset all armor. See console for details.");
            }
        });
    }

    // --------------------------------------------------------------------
    // DEFENSE SYSTEM MANAGEMENT
    // --------------------------------------------------------------------

    /**
    * Initialize facing dropdown with proper event handling
    * @param {HTMLElement} html - Sheet HTML element
    */
    _initializeFacingDropdown(html) {
        const facingDropdown = html.find('#facing-select');

        // Remove any existing handlers
        facingDropdown.off('change');

        // Add the improved handler
        facingDropdown.on('change', this._handleFacingChange.bind(this));

        // Initialize with current value from flags
        const currentFacing = this.actor.getFlag("thefade", "facing") || "front";
        facingDropdown.val(currentFacing);
    }

    /**
    * Handle facing change with direct DOM updates
    * @param {Event} event - Change event
    */
    async _handleFacingChange(event) {
        event.preventDefault();
        event.stopPropagation();

        const actor = this.actor;
        const sheet = this;
        const newFacing = event.target.value;

        try {
            // Store facing in flags
            await actor.setFlag("thefade", "facing", newFacing);

            // Get current defense values from flags
            const basePassiveDodge = actor.getFlag("thefade", "basePassiveDodge") || 0;
            const basePassiveParry = actor.getFlag("thefade", "basePassiveParry") || 0;

            // Calculate new values
            let newDodge = basePassiveDodge;
            let newParry = basePassiveParry;
            let avoidPenalty = 0;

            // Apply facing modifications
            if (newFacing === "flank") {
                avoidPenalty = -1;
            }
            else if (newFacing === "backflank") {
                newDodge = Math.floor(basePassiveDodge / 2);
                newParry = 0;
                avoidPenalty = -2;
            }
            else if (newFacing === "back") {
                newDodge = Math.floor(basePassiveDodge / 4);
                newParry = 0;
                avoidPenalty = -2;
            }

            // Store the updated values in flags
            await actor.setFlag("thefade", "currentPassiveDodge", newDodge);
            await actor.setFlag("thefade", "currentPassiveParry", newParry);
            await actor.setFlag("thefade", "avoidPenalty", avoidPenalty);

            // Update the system data for display
            const baseAvoid = Math.floor((actor.system.attributes.finesse.total ?? actor.system.attributes.finesse.value) / 2);
            const avoidBonus = actor.system.defenses.avoidBonus || 0;
            const totalAvoid = Math.max(0, baseAvoid + avoidBonus + avoidPenalty);

            // Apply updates to system data
            await actor.update({
                "system.defenses.passiveDodge": newDodge,
                "system.defenses.passiveParry": newParry,
                "system.defenses.avoidPenalty": avoidPenalty,
                "system.totalAvoid": totalAvoid
            });

            // Direct DOM updates for immediate visual feedback
            const domElement = $(event.target).closest('.sheet');

            if (domElement.length) {
                // Update display values
                domElement.find('.passive-dodge-value').val(newDodge);
                domElement.find('.passive-parry-value').val(newParry);
                domElement.find('.avoid-value').val(totalAvoid);
                domElement.find('.avoid-penalty').val(avoidPenalty);
            }

            // Show success notification
            ui.notifications.info(`Facing changed to: ${newFacing}`);

            // No need to re-render the whole sheet - we've updated the values directly
        } catch (error) {
            console.error("Error updating facing:", error);
            ui.notifications.error("Failed to update facing");
        }

        return false;
    }

    /**
    * Update facing with direct approach
    * @param {HTMLElement} html - Sheet HTML element
    */
    async _updateFacingDirectly(html) {
        const actor = this.actor;
        const sheet = this;

        // Find the facing dropdown
        const facingDropdown = html.find('select[name="system.defenses.facing"]');

        // Remove any existing event handlers to prevent duplicates
        facingDropdown.off('change');

        // Add direct change handler with immediate forced update
        facingDropdown.on('change', async function (event) {
            event.preventDefault();
            const newFacing = this.value;

            try {
                // First update the actor with the new facing
                await actor.update({
                    "system.defenses.facing": newFacing
                });

                // Force a full recalculation of defenses
                let fakedEvent = new Event('fakedEvent');
                sheet._onDefenseRecalculation(fakedEvent);

                // Force a complete re-render
                sheet.render(true);
                ui.notifications.info(`Facing changed to: ${newFacing}`);
            } catch (error) {
                console.error("Facing update failed:", error);
                ui.notifications.error("Failed to update facing");
            }
        });
    }

    /**
    * Force defense recalculation
    * @param {Event} event - Triggering event
    */
    async _onDefenseRecalculation(event) {
        const actor = this.actor;
        const data = actor.system;

        if (!data.defenses) return;

        // Get the current facing
        const facing = data.defenses.facing || "front";

        // Store original values for debugging
        const originalDodge = data.defenses.passiveDodge;
        const originalParry = data.defenses.passiveParry;
        const originalAvoid = data.totalAvoid;

        // Re-calculate passive dodge based on facing
        let newDodge = originalDodge;
        let newParry = originalParry;
        let avoidPenalty = 0;

        // Apply modifications based on facing
        if (facing === "flank") {
            // Full passive defenses, but -1 to Avoid
            avoidPenalty = -1;
        }
        else if (facing === "backflank") {
            // Half passive dodge, no parry, -2 Avoid
            newDodge = Math.floor(originalDodge / 2);
            newParry = 0;
            avoidPenalty = -2;
        }
        else if (facing === "back") {
            // Quarter passive dodge, no parry, -2 Avoid
            newDodge = Math.floor(originalDodge / 4);
            newParry = 0;
            avoidPenalty = -2;
        }

        // Update the actor with the new calculated values
        await actor.update({
            "system.defenses.passiveDodge": newDodge,
            "system.defenses.passiveParry": newParry,
            "system.defenses.avoidPenalty": avoidPenalty
        });
    }

    /**
    * Initialize facing system using flags
    * @param {HTMLElement} html - Sheet HTML element
    */
    async _initializeFacingWithFlags(html) {
        const actor = this.actor;
        const sheet = this;

        // Find the facing dropdown (using ID instead of name now)
        const facingDropdown = html.find('#facing-select');

        // Initialize flag if it doesn't exist
        let currentFacing = actor.getFlag("thefade", "facing");
        if (!currentFacing) {
            currentFacing = "front";
            await actor.setFlag("thefade", "facing", currentFacing);
        }

        // Set dropdown to match flag
        facingDropdown.val(currentFacing);

        // Handle dropdown change
        facingDropdown.off('change').on('change', async function (event) {
            // Stop event propagation to prevent other handlers from running
            event.stopPropagation();
            event.preventDefault();

            const newFacing = this.value;

            try {
                // Store facing in flags
                await actor.setFlag("thefade", "facing", newFacing);

                // Update defense calculations based on facing
                await sheet._updateDefensesForFacing(newFacing);

                // Force re-render
                sheet.render(true);

                // Show notification
                ui.notifications.info(`Facing changed to: ${newFacing}`);
            } catch (error) {
                console.error("Error updating facing:", error);
                ui.notifications.error("Failed to update facing");
            }

            return false;
        });
    }

    /**
    * Apply defense modifications based on facing
    * @param {string} facing - Current facing direction
    */
    async _updateDefensesForFacing(facing) {
        const actor = this.actor;

        // Get current defense values
        const basePassiveDodge = actor.getFlag("thefade", "basePassiveDodge") || 0;
        const basePassiveParry = actor.getFlag("thefade", "basePassiveParry") || 0;

        let newDodge = basePassiveDodge;
        let newParry = basePassiveParry;
        let avoidPenalty = 0;

        /*
        CONFIG.debug.thefade && console.debug(`Updating defenses for facing ${facing} with base values:
        Base Dodge: ${basePassiveDodge}
        Base Parry: ${basePassiveParry}`);
        */

        // Calculate new values based on facing
        if (facing === "flank") {
            // Full passive defenses, -1 Avoid
            avoidPenalty = -1;
        }
        else if (facing === "backflank") {
            // Half dodge, no parry, -2 Avoid
            newDodge = Math.floor(basePassiveDodge / 2);
            newParry = 0;
            avoidPenalty = -2;
        }
        else if (facing === "back") {
            // Quarter dodge, no parry, -2 Avoid
            newDodge = Math.floor(basePassiveDodge / 4);
            newParry = 0;
            avoidPenalty = -2;
        }

        /*
        CONFIG.debug.thefade && console.debug(`New defense values after facing ${facing}:
        New Dodge: ${newDodge}
        New Parry: ${newParry}
        Avoid Penalty: ${avoidPenalty}`);
        */

        // Store the final values
        await actor.update({
            "system.defenses.passiveDodge": newDodge,
            "system.defenses.passiveParry": newParry,
            "system.defenses.avoidPenalty": avoidPenalty
        });

        // Also store in flags for reference
        await actor.setFlag("thefade", "currentPassiveDodge", newDodge);
        await actor.setFlag("thefade", "currentPassiveParry", newParry);
        await actor.setFlag("thefade", "avoidPenalty", avoidPenalty);
    }

    /**
    * Calculate and store base defense values
    */
    async _calculateAndStoreBaseDefenses() {
        const actor = this.actor;
        const data = actor.system;

        // Calculate Passive Dodge from Acrobatics or Finesse
        let acrobonaticsDodge = 0;
        let finesseDodge = Math.floor((data.attributes.finesse.total ?? data.attributes.finesse.value) / 4);

        // Find Acrobatics skill
        const acrobaticsSkill = getSkill(actor, "Acrobatics");

        if (acrobaticsSkill) {
            const rank = acrobaticsSkill.rank;
            if (rank === 'adept') acrobonaticsDodge = 1;
            else if (rank === 'experienced') acrobonaticsDodge = 1;
            else if (rank === 'expert') acrobonaticsDodge = 2;
            else if (rank === 'mastered') acrobonaticsDodge = 3;
        }

        // Use higher value
        const basePassiveDodge = Math.max(acrobonaticsDodge, finesseDodge);

        // Calculate Passive Parry from weapon skills
        let highestParry = 0;
        const weaponSkillNames = ['Sword', 'Axe', 'Cudgel', 'Polearm', 'Heavy Weaponry', 'Unarmed'];
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

        const basePassiveParry = highestParry;

        /*
        CONFIG.debug.thefade && console.debug(`Calculated base defenses:
        Base Passive Dodge: ${basePassiveDodge}
        Base Passive Parry: ${basePassiveParry}`);
        */

        // Store base values in flags
        await actor.setFlag("thefade", "basePassiveDodge", basePassiveDodge);
        await actor.setFlag("thefade", "basePassiveParry", basePassiveParry);

        // Apply current facing to these base values
        const currentFacing = actor.getFlag("thefade", "facing") || "front";
        await this._updateDefensesForFacing(currentFacing);
    }

    /**
    * Handle defense expansion with proper event handling
    * @param {HTMLElement} html - Sheet HTML element
    */
    _initializeDefenseExpansion(html) {
        // Remove any existing event handlers to prevent duplicates
        html.find('.defense-checkbox').off('change');

        // Add simple handlers
        html.find('.defense-checkbox').on('change', function () {
            const checkbox = $(this);
            const details = checkbox.closest('.defense').find('.defense-details');

            if (checkbox.is(':checked')) {
                details.css('max-height', '200px');
                details.css('padding-top', '10px');
            } else {
                details.css('max-height', '0');
                details.css('padding-top', '0');
            }

            // Prevent the event from triggering other handlers
            return false;
        });
    }

    /**
    * Update displayed defense values
    */
    async _updateDefenseDisplays() {
        const actor = this.actor;

        // Get current values directly from flags
        const currentDodge = actor.getFlag("thefade", "currentPassiveDodge") || 0;
        const currentParry = actor.getFlag("thefade", "currentPassiveParry") || 0;
        const avoidPenalty = actor.getFlag("thefade", "avoidPenalty") || 0;

        // Get current defense values
        const baseResilience = actor.system.defenses.resilience;
        const baseAvoid = actor.system.defenses.avoid;
        const baseGrit = actor.system.defenses.grit;

        // Get bonuses
        const resilienceBonus = actor.system.defenses.resilienceBonus || 0;
        const avoidBonus = actor.system.defenses.avoidBonus || 0;
        const gritBonus = actor.system.defenses.gritBonus || 0;

        // Get other penalties 
        const resiliencePenalty = actor.getFlag("thefade", "resiliencePenalty") || 0;
        const gritPenalty = actor.getFlag("thefade", "gritPenalty") || 0;

        // Calculate raw totals including all bonuses and penalties
        const rawResilience = baseResilience + resilienceBonus + resiliencePenalty;
        const rawAvoid = baseAvoid + avoidBonus + avoidPenalty;
        const rawGrit = baseGrit + gritBonus + gritPenalty;

        // Apply minimum defense rule (minimum 1) and calculate excess penalties
        const totalResilience = Math.max(1, rawResilience);
        const totalAvoid = Math.max(1, rawAvoid);
        const totalGrit = Math.max(1, rawGrit);

        // Calculate excess penalties for attack bonuses
        const excessResiliencePenalty = rawResilience < 1 ? Math.abs(rawResilience - 1) : 0;
        const excessAvoidPenalty = rawAvoid < 1 ? Math.abs(rawAvoid - 1) : 0;
        const excessGritPenalty = rawGrit < 1 ? Math.abs(rawGrit - 1) : 0;

        // Store excess penalties in flags for easy access
        this.actor.setFlag("thefade", "excessResiliencePenalty", excessResiliencePenalty);
        this.actor.setFlag("thefade", "excessAvoidPenalty", excessAvoidPenalty);
        this.actor.setFlag("thefade", "excessGritPenalty", excessGritPenalty);

        // Update the UI elements directly without actor update
        try {
            const sheet = this.element;
            if (sheet) {
                // Update total defense displays
                sheet.find('.defense').each(function () {
                    const defense = $(this);
                    const totalInput = defense.find('input.total-value');

                    if (defense.find('label').text().includes('Resilience')) {
                        totalInput.val(totalResilience);
                    } else if (defense.find('label').text().includes('Avoid')) {
                        totalInput.val(totalAvoid);
                    } else if (defense.find('label').text().includes('Grit')) {
                        totalInput.val(totalGrit);
                    }
                });

                sheet.find('input.avoid-value').val(totalAvoid);
                sheet.find('input.passive-dodge-value').val(currentDodge);
                sheet.find('input.passive-parry-value').val(currentParry);

                // Update excess penalty displays
                this._updateExcessPenaltyDisplays(sheet);
            }
        } catch (error) {
            console.error("Error updating UI elements:", error);
        }
    }

    _updateExcessPenaltyDisplays(sheet) {
        // Update Resilience excess penalty
        const resilienceExcess = this.actor.getFlag("thefade", "excessResiliencePenalty") || 0;
        const resilienceDisplay = sheet.find('.resilience-excess-penalty');
        if (resilienceExcess > 0) {
            resilienceDisplay.text(`+${resilienceExcess}D`).show();
        } else {
            resilienceDisplay.hide();
        }

        // Update Avoid excess penalty
        const avoidExcess = this.actor.getFlag("thefade", "excessAvoidPenalty") || 0;
        const avoidDisplay = sheet.find('.avoid-excess-penalty');
        if (avoidExcess > 0) {
            avoidDisplay.text(`+${avoidExcess}D`).show();
        } else {
            avoidDisplay.hide();
        }

        // Update Grit excess penalty
        const gritExcess = this.actor.getFlag("thefade", "excessGritPenalty") || 0;
        const gritDisplay = sheet.find('.grit-excess-penalty');
        if (gritExcess > 0) {
            gritDisplay.text(`+${gritExcess}D`).show();
        } else {
            gritDisplay.hide();
        }
    }

    /**
    * Initialize complete defense system - call on sheet load
    * @param {HTMLElement} html - Sheet HTML element
    */
    async _initializeDefenseSystem(html) {
        // Preserve expanded state before any operations
        this._preserveExpandedState(html);

        // First handle expansion behavior
        this._initializeDefenseExpansion(html);

        // Calculate and store base defenses
        await this._calculateAndStoreBaseDefenses();

        // Initialize facing dropdown with flags
        await this._initializeFacingWithFlags(html);

        // Make sure displays are updated
        await this._updateDefenseDisplays();

        // Restore expanded state after operations
        this._restoreExpandedState(html);
    }


    // --------------------------------------------------------------------
    // MAGIC ITEM EQUIPMENT SYSTEM
    // --------------------------------------------------------------------

    /**
    * Handle equipping magic items
    * @param {Event} event - Click event
    */
    _onEquipMagicItem(event) {
        event.preventDefault();
        const element = event.currentTarget;
        const itemId = element.closest('.magic-item').dataset.itemId;
        const targetSlot = element.dataset.slot;

        const item = this.actor.items.get(itemId);
        if (!item) return;

        const slotRule = game.settings?.get("thefade", "itemPowerSlotRule") || "standard";
        const equipCheck = canEquipItemPower(
            this.actor.items.filter(existing => existing.type === "magicitem"),
            item,
            slotRule
        );
        if (!equipCheck.allowed) {
            ui.notifications.warn(equipCheck.reason);
            return;
        }

        // Check attunement limits if item requires attunement
        if (!isAttunementRemoved(game.settings?.get("thefade", "itemPowerAttunementRule")) && !item.system.attunement) {
            const currentAttunements = this.actor.system.currentAttunements || 0;
            const maxAttunements = this.actor.system.maxAttunements || 0;

            if (currentAttunements >= maxAttunements) {
                ui.notifications.warn(`Cannot attune to more items. Limit: ${maxAttunements}`);
                return;
            }
        }

        // Equip the item
        this._equipMagicItem(item, targetSlot);
    }

    /**
    * Handle unequipping magic items
    * @param {Event} event - Click event
    */
    _onUnequipMagicItem(event) {
        event.preventDefault();
        const element = event.currentTarget;
        const itemId = element.closest('.equipped-item').dataset.itemId;

        const item = this.actor.items.get(itemId);
        if (item) {
            this._unequipMagicItem(item);
        }
    }

    /**
    * Toggle attunement for magic items
    * @param {Event} event - Click event
    */
    _onToggleAttunement(event) {
        event.preventDefault();
        if (isAttunementRemoved(game.settings?.get("thefade", "itemPowerAttunementRule"))) return;
        const element = event.currentTarget;
        const itemId = element.dataset.itemId;
        const isAttuned = element.checked;

        const item = this.actor.items.get(itemId);
        if (!item) return;

        if (isAttuned) {
            const currentAttunements = this.actor.system.currentAttunements || 0;
            const maxAttunements = this.actor.system.maxAttunements || 0;

            if (currentAttunements >= maxAttunements) {
                ui.notifications.warn(`Cannot attune to more items. Limit: ${maxAttunements}`);
                element.checked = false;
                return;
            }
        }

        item.update({ "system.attunement": isAttuned });
        ui.notifications.info(`${item.name} ${isAttuned ? 'attuned' : 'no longer attuned'}.`);
    }

    /**
    * Equip magic item to specific slot
    * @param {Item} item - Item to equip
    * @param {string} slot - Equipment slot
    */
    _equipMagicItem(item, slot) {
        const updates = {
            "system.equipped": true,
            "system.slot": slot
        };

        // Auto-attune when equipping
        const currentAttunements = this.actor.system.currentAttunements || 0;
        const maxAttunements = this.actor.system.maxAttunements || 0;

        if (!isAttunementRemoved(game.settings?.get("thefade", "itemPowerAttunementRule")) && currentAttunements < maxAttunements) {
            updates["system.attunement"] = true;
        }

        item.update(updates);
        ui.notifications.info(`${item.name} equipped to ${slot} slot.`);
    }

    /**
    * Unequip magic item
    * @param {Item} item - Item to unequip
    */
    _unequipMagicItem(item) {
        const updates = {
            "system.equipped": false,
            "system.attunement": false
        };

        item.update(updates);
        ui.notifications.info(`${item.name} unequipped.`);
    }

    /**
    * Get available ring slot for equipment
    * @returns {string|null} Available slot or null
    */
    _getAvailableRingSlot() {
        const ring1 = this.actor.system.magicItems?.ring1;
        const ring2 = this.actor.system.magicItems?.ring2;

        if (!ring1) return 'ring1';
        if (!ring2) return 'ring2';
        return null;
    }

    /**
    * Get current attunement count
    * @returns {number} Number of attuned items
    */
    _getCurrentAttunements() {
        const mode = game.settings?.get("thefade", "itemPowerAttunementRule") || "standard";
        return countAttunements([...this.actor.items], mode);
    }

    /**
    * Get maximum attunement limit
    * @returns {number} Maximum attunements allowed
    */
    _getMaxAttunements() {
        if (isAttunementRemoved(game.settings?.get("thefade", "itemPowerAttunementRule"))) return 0;
        const totalLevel = this.actor.system.level || 1;
        const soulAttribute = (this.actor.system.attributes.soul.total ?? this.actor.system.attributes.soul.value) || 1;
        return Math.max(0, Math.floor(totalLevel / 4) + soulAttribute);
    }

    // --------------------------------------------------------------------
    // DICE ROLLING SYSTEM
    // --------------------------------------------------------------------

    /**
    * Handle skill check rolls
    * @param {Event} event - Click event
    */
    async _onSkillRoll(event) {
        event.preventDefault();
        const element = event.currentTarget;
        const row = element.closest("[data-skill-key]");
        const skillKey = row?.dataset.skillKey;
        const skill = getSkillByKey(this.actor, skillKey);

        if (!skill) return;

        // Show DT dialog
        const dt = await this._getDifficultyThreshold("Skill Check Difficulty");
        if (dt === null) return; // User cancelled the dialog

        const attributeName = skill.attribute;
        let dicePool = calculateSkillDice(this.actor, skill);

        // Apply active-condition modifiers before min-1 clamp
        const condMods = this.actor.getConditionRollModifiers({
            kind: "skill",
            skillName: skill.name,
            skillCategory: skill.category,
            attributeName: attributeName
        });

        if (condMods.autoFail) {
            ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor: this.actor }),
                flavor: `${skill.name} Check (${skill.rank})`,
                content: renderModifierHtml(condMods) +
                    `<p><strong>${this.actor.name}</strong> cannot attempt this check due to an active condition.</p>`
            });
            return;
        }

        dicePool += condMods.bonusDice - condMods.penaltyDice;

        // Ensure minimum of 1 die
        dicePool = Math.max(1, dicePool);

        // Roll the dice
        const roll = new Roll(`${dicePool}d12`);
        await roll.evaluate();

        // Create detailed die results with styling classes
        const dieResultsDetails = roll.terms[0].results.map(die => {
            let resultClass = "failure";
            if (die.result >= 12) resultClass = "critical";
            else if (die.result >= 8) resultClass = "success";

            return {
                value: die.result,
                class: resultClass
            };
        });

        // Count successes (8-11 = 1 success, 12 = 2 successes)
        let successes = 0;
        roll.terms[0].results.forEach(die => {
            if (die.result >= 8 && die.result <= 11) successes += 1;
            else if (die.result >= 12) successes += 2;
        });

        // Check against DT
        const rollSucceeds = successes >= dt;

        // Prepare template data
        const templateData = {
            actor: this.actor.name,
            name: skill.name,
            dicePool: dicePool,
            dieResultsDetails: dieResultsDetails,
            successes: successes,
            dt: dt,
            success: rollSucceeds,
            miscBonus: skill.miscBonus || null,
            rank: skill.rank
        };

        // Render the template, prepend condition modifier banner if any
        const content = renderModifierHtml(condMods) +
            await renderTemplate("systems/thefade/templates/chat/skill-roll.html", templateData);

        // Send to chat
        roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor: this.actor }),
            flavor: `${skill.name} Check (${skill.rank})`,
            content: content
        });
    }

    /**
    * Handle attribute check rolls
    * @param {Event} event - Click event
    */
    async _onAttributeRoll(event) {
        event.preventDefault();
        const element = event.currentTarget;
        const attribute = element.dataset.attribute;
        const attrValue = this.actor.system.attributes[attribute]?.value || 0;

        // Roll the dice using async evaluate
        const roll = new Roll(`${attrValue}d12`);
        await roll.evaluate(); // Use async version

        // Format the individual roll results
        const dieResults = roll.terms[0].results.map(die => die.result);
        const formattedResults = dieResults.join(', ');

        // Count successes (8-11 = 1 success, 12 = 2 successes)
        let successes = 0;

        // More robust handling of results
        if (roll.terms[0] && roll.terms[0].results) {
            for (let die of roll.terms[0].results) {
                const result = die.result;
                if (result >= 8 && result <= 11) {
                    successes += 1;
                } else if (result >= 12) {
                    successes += 2;
                }
            }
        }

        // Display the result
        roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor: this.actor }),
            flavor: `${attribute.charAt(0).toUpperCase() + attribute.slice(1)} Check`,
            content: `
        <p>${this.actor.name} rolled ${attrValue}d12, and their roll results were ${formattedResults}.</p>
        <p>${this.actor.name} rolled ${successes} success(es).</p>
      `
        });
    }

    /**
    * Handle weapon attack rolls
    * @param {Event} event - Click event
    */
    async _onAttackRoll(event) {
        event.preventDefault();
        const element = event.currentTarget;
        const weaponId = element.closest(".item").dataset.itemId;
        const weapon = this.actor.items.get(weaponId);

        if (!weapon) return;
        const weaponData = weapon.system;
        const negatesPassiveDodge = hasWeaponQuality(weaponData, "accurate");
        const negatesPassiveParry = hasWeaponQuality(weaponData, "powerful");
        const hasFencing = hasWeaponQuality(weaponData, "fencing");
        const targetHasFencingWeapon = actor => actor?.items?.some?.(item =>
            item.type === "weapon" && hasWeaponQuality(item.system, "fencing")
        ) === true;
        const adjustedParry = (value, actor) => {
            if (negatesPassiveParry) return 0;
            return hasFencing && !targetHasFencingWeapon(actor) ? Math.max(0, value - 1) : value;
        };

        // Show Target Selection dialog
        const targetInfo = await this._getTargetInfo("Select Target", weaponData);
        if (targetInfo === null) return; // User cancelled the dialog

        // Show DT dialog with default based on target Avoid
        let defaultDT = 3; // Default DT if no target selected
        let targetActor = null;
        let isRanged = weapon.system.range !== "Melee";
        let targetName = "the target";

        // If we have a target token selected
        if (targetInfo && targetInfo.targetId) {
            const targetToken = canvas.tokens.get(targetInfo.targetId);
            if (targetToken && targetToken.actor) {
                targetActor = targetToken.actor;
                targetName = targetToken.name || targetToken.actor.name;

                // Calculate base DT from target's Avoid
                defaultDT = targetActor.system.totalAvoid || 3;

                // Apply passive defenses if appropriate
                if (targetActor.system.defenses) {
                    // Passive Dodge applies to all attacks
                    if (!negatesPassiveDodge && targetActor.system.defenses.passiveDodge) {
                        defaultDT += targetActor.system.defenses.passiveDodge;
                    }

                    // Passive Parry only applies to melee attacks
                    if (!isRanged && targetActor.system.defenses.passiveParry) {
                        defaultDT += adjustedParry(targetActor.system.defenses.passiveParry, targetActor);
                    }
                }
            }
        }

        // After getting targetInfo and targetActor
        if (targetActor && targetInfo.facing) {
            const facing = targetInfo.facing;
            const basePassiveDodge = targetActor.getFlag("thefade", "basePassiveDodge") ||
                targetActor.system.defenses.passiveDodge || 0;
            const basePassiveParry = targetActor.getFlag("thefade", "basePassiveParry") ||
                targetActor.system.defenses.passiveParry || 0;

            // Calculate temporary defense values based on selected facing
            let tempDodge = basePassiveDodge;
            let tempParry = basePassiveParry;

            if (facing === "flank") {
                // Full passive defenses (no changes to dodge/parry)
            }
            else if (facing === "backflank") {
                tempDodge = Math.floor(basePassiveDodge / 2);
                tempParry = 0;
            }
            else if (facing === "back") {
                tempDodge = Math.floor(basePassiveDodge / 4);
                tempParry = 0;
            }

            if (negatesPassiveDodge) tempDodge = 0;
            tempParry = adjustedParry(tempParry, targetActor);

            // Now use these temporary values instead of the actor's current values
            defaultDT = targetActor.system.totalAvoid || 3;

            // Add the temporary defense values
            defaultDT += tempDodge;
            if (!isRanged) defaultDT += tempParry;
        }

        // Hit location inputs (from target dialog). Called Shot = −2D to the
        // attack pool, and only called shots apply status effects on hit.
        const hitLocationMode = targetInfo?.hitLocationMode || "random";
        const calledShot = hitLocationMode === "called";
        const calledShotLocation = targetInfo?.calledShotLocation || "body";

        // Get final DT from user
        const dt = await this._getDifficultyThreshold("Attack Difficulty", defaultDT);
        if (dt === null) return; // User cancelled the dialog

        const skillName = weaponData.skill;

        // Find the appropriate skill
        const skill = getSkill(this.actor, skillName);
        const damageProfile = buildWeaponDamageProfile(this.actor, weaponData, {
            targetActor,
            targetMounted: targetInfo?.targetMounted === true,
            dualTrigger: targetInfo?.dualTrigger === true
        });
        const qualitiesDisplay = weaponQualityDisplay(weaponData) || "—";
        const qualityRules = getWeaponQualityRules(weaponData);
        const criticalQualityBonus = getWeaponCriticalDamageBonus(weaponData);
        const minimumHpDamage = getWeaponMinimumHpDamage(weaponData);

        if (!skill) {
            // Default to untrained if skill not found
            const attributeName = getWeaponAttackAttributeOverride(weaponData)?.key || "physique";

            // Get attribute value, handling combined attributes
            let attrValue = 0;

            if (attributeName.includes('_')) {
                // Handle combined attributes like "physique_finesse"
                const attributes = attributeName.split('_');
                const attr1 = this.actor.system.attributes[attributes[0]]?.total ?? this.actor.system.attributes[attributes[0]]?.value ?? 0;
                const attr2 = this.actor.system.attributes[attributes[1]]?.total ?? this.actor.system.attributes[attributes[1]]?.value ?? 0;
                attrValue = Math.floor((attr1 + attr2) / 2); // Calculate average
            } else {
                // Normal single attribute
                attrValue = this.actor.system.attributes[attributeName]?.total ?? this.actor.system.attributes[attributeName]?.value ?? 0;
            }

            let dicePool = Math.floor(attrValue / 2); // Untrained is half attr value

            // Add weapon's misc bonus
            dicePool += (weaponData.miscBonus || 0);

            // Add bonuses from equipped Items of Power
            const untrEb = this.actor.system?.equippedBonuses;
            if (untrEb) {
                dicePool += (untrEb.attack || 0)
                    + (untrEb[`attack_${(skillName || "").toLowerCase()}`] || 0);
            }

            // Apply active-condition modifiers
            const condModsUntrained = this.actor.getConditionRollModifiers({
                kind: "attack",
                skillName: skillName,
                attributeName: attributeName,
                isRanged: isRanged,
                weaponSkill: skillName
            });
            if (condModsUntrained.autoFail) {
                ChatMessage.create({
                    speaker: ChatMessage.getSpeaker({ actor: this.actor }),
                    flavor: `Attack with ${weapon.name} (Untrained) vs ${targetName}`,
                    content: renderModifierHtml(condModsUntrained) +
                        `<p><strong>${this.actor.name}</strong> cannot attack due to an active condition.</p>`
                });
                return;
            }
            dicePool += condModsUntrained.bonusDice - condModsUntrained.penaltyDice;

            // Called Shot: rulebook −2D to the attack roll.
            if (calledShot) dicePool -= 2;

            // Ensure minimum of 1 die
            dicePool = Math.max(1, dicePool);

            const roll = new Roll(`${dicePool}d12`);
            await roll.evaluate();

            // Create detailed die results with styling classes
            const dieResultsDetails = roll.terms[0].results.map(die => {
                let resultClass = "failure";
                if (die.result >= 12) resultClass = "critical";
                else if (die.result >= 8) resultClass = "success";

                return {
                    value: die.result,
                    class: resultClass
                };
            });

            // Count successes
            let successes = 0;
            roll.terms[0].results.forEach(die => {
                if (die.result >= 8 && die.result <= 11) successes += 1;
                else if (die.result >= 12) successes += 2;
            });

            // Check against DT
            const attackSucceeds = successes >= dt;

            // Resolve hit location on a hit: Called = chosen + status effects;
            // Default = body, no status effects; Random = 1d12 on attacker
            // facing column, no status effects.
            let resolvedLocation = null;
            let resolvedLocationLabel = null;
            let locationRollDetail = null;
            if (attackSucceeds) {
                if (calledShot) {
                    resolvedLocation = calledShotLocation;
                    resolvedLocationLabel = locationLabel(resolvedLocation);
                } else if (hitLocationMode === "default") {
                    resolvedLocation = "body";
                    resolvedLocationLabel = locationLabel(resolvedLocation);
                } else {
                    const anatomyPreset = game.settings?.get("thefade", "alternateAnatomyEnabled")
                        ? (targetActor?.system?.anatomy?.preset || "humanoid")
                        : "humanoid";
                    const r = await rollHitLocation(targetInfo?.facing || "front", anatomyPreset);
                    resolvedLocation = r.location;
                    resolvedLocationLabel = r.label || locationLabel(resolvedLocation);
                    locationRollDetail = r.sideRoll
                        ? `1d12=${r.roll} (${r.column}), 1d2=${r.sideRoll}`
                        : `1d12=${r.roll} (${r.column})`;
                }
            }

            const templateData = {
                actor: this.actor.name,
                weaponName: weapon.name,
                dicePool: dicePool,
                dieResultsDetails: dieResultsDetails,
                successes: successes,
                dt: dt,
                success: attackSucceeds,
                damage: damageProfile.total,
                damageType: damageProfile.primaryType,
                damageComponents: damageProfile.components,
                critical: weaponData.critical,
                criticalHits: 0,
                totalDamage: damageProfile.total,
                criticalDamageAmount: damageProfile.total + criticalQualityBonus,
                minimumHpDamage,
                qualities: qualitiesDisplay,
                qualityRules,
                qualityDamageNotes: damageProfile.conditionalNotes,
                rank: "untrained",
                target: targetName,
                targetUuid: targetActor?.uuid || "",
                attackerUuid: this.actor.uuid,
                hitLocation: resolvedLocation,
                hitLocationLabel: resolvedLocationLabel,
                hitLocationRollDetail: locationRollDetail,
                calledShot: calledShot,
                bonusDice: weaponData.miscBonus ? `Includes +${weaponData.miscBonus} bonus dice` : null,
                ...damageTypeFlags(damageProfile.primaryType, damageProfile.components)
            };

            const content = renderModifierHtml(condModsUntrained) +
                await renderTemplate("systems/thefade/templates/chat/attack-roll.html", templateData);

            // Display the result
            roll.toMessage({
                speaker: ChatMessage.getSpeaker({ actor: this.actor }),
                flavor: `Attack with ${weapon.name} (Untrained) vs ${targetName}`,
                content: content
            });

            return;
        }

        const skillData = skill; // skill is already a merged data object
        const attributeName = getWeaponAttackAttributeOverride(weaponData)?.key || skillData.attribute;
        // Get attribute value, handling combined attributes
        let attrValue = 0;

        if (attributeName.includes('_')) {
            // Handle combined attributes like "physique_finesse"
            const attributes = attributeName.split('_');
            const attr1 = this.actor.system.attributes[attributes[0]]?.total ?? this.actor.system.attributes[attributes[0]]?.value ?? 0;
            const attr2 = this.actor.system.attributes[attributes[1]]?.total ?? this.actor.system.attributes[attributes[1]]?.value ?? 0;
            attrValue = Math.floor((attr1 + attr2) / 2); // Calculate average
        } else {
            // Normal single attribute
            attrValue = this.actor.system.attributes[attributeName]?.total ?? this.actor.system.attributes[attributeName]?.value ?? 0;
        }

        let dicePool = attrValue;

        // Add bonus dice based on skill rank
        switch (skillData.rank) {
            case "practiced":
                dicePool += 1;
                break;
            case "adept":
                dicePool += 2;
                break;
            case "experienced":
                dicePool += 3;
                break;
            case "expert":
                dicePool += 4;
                break;
            case "mastered":
                dicePool += 6;
                break;
            case "untrained":
                dicePool = Math.floor(dicePool / 2);
                break;
        }

        // Add skill misc bonus if any
        dicePool += (skillData.miscBonus || 0);

        // Add weapon misc bonus
        dicePool += (weaponData.miscBonus || 0);

        // Add bonuses from equipped Items of Power
        const atkEb = this.actor.system?.equippedBonuses;
        if (atkEb) {
            dicePool += (atkEb.attack || 0)
                + (atkEb[`attack_${(skill.name || "").toLowerCase()}`] || 0)
                + (atkEb.skills?.[skill.name] || 0)
                + (atkEb.skills?.all || 0);
        }

        // Apply active-condition modifiers
        const condMods = this.actor.getConditionRollModifiers({
            kind: "attack",
            skillName: skill.name,
            skillCategory: skillData.category,
            attributeName: attributeName,
            isRanged: isRanged,
            weaponSkill: skill.name
        });
        if (condMods.autoFail) {
            ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor: this.actor }),
                flavor: `Attack with ${weapon.name} (${skillData.rank}) vs ${targetName}`,
                content: renderModifierHtml(condMods) +
                    `<p><strong>${this.actor.name}</strong> cannot attack due to an active condition.</p>`
            });
            return;
        }
        dicePool += condMods.bonusDice - condMods.penaltyDice;

        // Called Shot: rulebook −2D to the attack roll.
        if (calledShot) dicePool -= 2;

        // Ensure minimum of 1 die
        dicePool = Math.max(1, dicePool);

        // Roll the dice
        const roll = new Roll(`${dicePool}d12`);
        await roll.evaluate();

        // Create detailed die results with styling classes
        const dieResultsDetails = roll.terms[0].results.map(die => {
            let resultClass = "failure";
            if (die.result >= 12) resultClass = "critical";
            else if (die.result >= 8) resultClass = "success";

            return {
                value: die.result,
                class: resultClass
            };
        });

        // Count successes
        let successes = 0;
        roll.terms[0].results.forEach(die => {
            if (die.result >= 8 && die.result <= 11) successes += 1;
            else if (die.result >= 12) successes += 2;
        });

        // Check against DT
        const attackSucceeds = successes >= dt;

        // Calculate excess successes for bonus effects
        const excessSuccesses = attackSucceeds ? successes - dt : 0;
        const criticalThreshold = parseInt(weaponData.critical) || 4;
        const halfDamage = Math.max(1, Math.floor(damageProfile.total / 2));

        // Define these values for backwards compatibility with template
        const criticalHits = 0;
        const criticalDamage = 0;
        const totalDamage = damageProfile.total;

        // Resolve hit location on a hit: Called = chosen + status effects;
        // Default = body, no status effects; Random = 1d12 on attacker
        // facing column, no status effects.
        let resolvedLocation = null;
        let resolvedLocationLabel = null;
        let locationRollDetail = null;
        if (attackSucceeds) {
            if (calledShot) {
                resolvedLocation = calledShotLocation;
                resolvedLocationLabel = locationLabel(resolvedLocation);
            } else if (hitLocationMode === "default") {
                resolvedLocation = "body";
                resolvedLocationLabel = locationLabel(resolvedLocation);
            } else {
                const anatomyPreset = game.settings?.get("thefade", "alternateAnatomyEnabled")
                    ? (targetActor?.system?.anatomy?.preset || "humanoid")
                    : "humanoid";
                const r = await rollHitLocation(targetInfo?.facing || "front", anatomyPreset);
                resolvedLocation = r.location;
                resolvedLocationLabel = r.label || locationLabel(resolvedLocation);
                locationRollDetail = r.sideRoll
                    ? `1d12=${r.roll} (${r.column}), 1d2=${r.sideRoll}`
                    : `1d12=${r.roll} (${r.column})`;
            }
        }

        const templateData = {
            actor: this.actor.name,
            weaponName: weapon.name,
            dicePool: dicePool,
            dieResultsDetails: dieResultsDetails,
            successes: successes,
            dt: dt,
            success: attackSucceeds,
            damage: damageProfile.total,
            damageType: damageProfile.primaryType,
            damageComponents: damageProfile.components,
            bonusSuccesses: excessSuccesses,
            criticalThreshold: criticalThreshold,
            canCritical: excessSuccesses >= criticalThreshold,
            halfDamage: halfDamage,
            criticalHits: criticalHits,
            totalDamage: totalDamage,
            criticalDamageAmount: totalDamage + criticalQualityBonus,
            minimumHpDamage,
            qualities: qualitiesDisplay,
            qualityRules,
            qualityDamageNotes: damageProfile.conditionalNotes,
            rank: skillData.rank,
            target: targetName,
            targetUuid: targetActor?.uuid || "",
            attackerUuid: this.actor.uuid,
            hitLocation: resolvedLocation,
            hitLocationLabel: resolvedLocationLabel,
            hitLocationRollDetail: locationRollDetail,
            calledShot: calledShot,
            bonusDice: (skillData.miscBonus || weaponData.miscBonus) ?
                `Includes bonus dice: ${[
                    skillData.miscBonus ? `+${skillData.miscBonus} from skill` : '',
                    weaponData.miscBonus ? `+${weaponData.miscBonus} from weapon` : ''
                ].filter(Boolean).join(', ')}` : null,
            ...damageTypeFlags(damageProfile.primaryType, damageProfile.components)
        };

        const content = renderModifierHtml(condMods) +
            await renderTemplate("systems/thefade/templates/chat/attack-roll.html", templateData);

        // Display the result
        roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor: this.actor }),
            flavor: `Attack with ${weapon.name} (${skillData.rank}) vs ${targetName}`,
            content: content
        });
    }

    /**
    * Handle generic dice rolls
    * @param {Event} event - Click event
    */
    async _onRollDice(event) {
        event.preventDefault();

        // Get dice parameters
        const diceInput = event.currentTarget.closest('.dice-section')?.querySelector('.dice-count');
        const diceCount = parseInt(diceInput?.value, 10) || 1;

        // Validate input
        if (diceCount < 1 || diceCount > 100) {
            ui.notifications.warn("Dice count must be between 1 and 100.");
            return;
        }

        // Roll the dice
        const roll = new Roll(`${diceCount}d12`);
        await roll.evaluate();

        // Format the individual roll results
        const dieResults = roll.terms[0].results.map(die => die.result);
        const formattedResults = dieResults.join(', ');

        // If d12, count successes for The Fade system
        let successesMessage = "";
        if (diceCount > 0) {
            let successes = 0;
            roll.terms[0].results.forEach(die => {
                if (die.result >= 8 && die.result <= 11) successes += 1;
                else if (die.result >= 12) successes += 2;
            });
            successesMessage = `<p>Successes: ${successes}</p>`;
        }

        // Display the result
        roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor: this.actor }),
            flavor: `Generic Dice Roll (${diceCount}d12)`,
            content: `
      <p>Roll results: ${formattedResults}</p>
      <p>Total: ${roll.total}</p>
      ${successesMessage}`
        });
    }

    /**
    * Handle initiative rolls
    * @param {Event} event - Click event
    */
    async _onInitiativeRoll(event) {
        event.preventDefault();

        // Attributes for initiative
        const finesseValue = this.actor.system.attributes.finesse?.value || 0;
        const mindValue = this.actor.system.attributes.mind?.value || 0;

        const averagedFINMND = Math.floor((finesseValue + mindValue) / 2);
        const initBonus = Number(this.actor.system.initiativeBonus || 0)
            + Number(this.actor.system.itemBonuses?.initiative || 0);
        const modifier = averagedFINMND + initBonus;

        // Roll the dice
        const roll = new Roll(`1d12+${modifier}`);
        await roll.evaluate();

        // Get the roll result
        const dieResult = roll.terms[0].results[0].result;
        const totalResult = roll.total;

        // Update the combat tracker if in combat
        if (game.combat) {
            const combatant = game.combat.combatants.find(c => c.actorId === this.actor.id);
            if (combatant) {
                await game.combat.setInitiative(combatant.id, totalResult);
            }
        }

        // Display the result
        roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor: this.actor }),
            flavor: `Initiative Roll`,
            content: `
      <p>${this.actor.name} rolled for initiative: 1d12 (${dieResult}) + ${modifier} = ${totalResult}</p>
    `
        });
    }

    /**
    * Handle rolling for Dark Magic Addiction
    * @param {Event} event   The originating click event
    * @private
    */
    async _onDarkMagicAddictionRoll(event) {
        event.preventDefault();

        // Get spell DT from user
        const spellDT = await this._getSpellDT();
        if (spellDT === null) return; // User cancelled

        const attack = await performAddictionAttack(this.actor, spellDT);
        const poolBreakdown = attack.addictionBonus > 0
            ? `${spellDT}D from spell + ${attack.addictionBonus}D from ${attack.priorStage} Addiction`
            : `${spellDT}D from spell`;
        const hitEffect = attack.attackHits
            ? `<p class="failure">The dark magic hits, dealing <strong>${attack.sanityDamage} Sanity damage</strong> (1d6): ${attack.sanityBefore} → ${attack.sanityAfter}. ${attack.stageAdvanced ? `Addiction advances to <strong>${attack.stageAdvanced}</strong>.` : "Addiction is already terminal."}</p>`
            : `<p class="success">The Dark Magic attack misses; the pull is resisted.</p>`;

        await attack.attackRoll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor: this.actor }),
            flavor: `Dark Magic Addiction Attack (${poolBreakdown})`,
            content: `
            <p>Dark Magic attacks ${this.actor.name}'s Grit ${attack.gritTarget} with ${attack.dicePool}D.</p>
            <p>Successes: ${attack.attackSuccesses} — <strong>${attack.attackHits ? "HIT" : "MISS"}</strong></p>
            ${hitEffect}
        `
        });
    }

    /**
    * Handle a daily rest click: scrubs accumulated Sin. Stages persist.
    * @param {Event} event
    * @private
    */
    async _onRestDaily(event) {
        event.preventDefault();
        await this.actor.restDaily();
    }

    async _onTakeRest(event) {
        event.preventDefault();
        await this.actor.takeRest();
    }

    async _onOpposedRoll(event) {
        event.preventDefault();
        await openOpposedRollDialog(this.actor);
    }

    async _onAidAnother(event) {
        event.preventDefault();
        await openAidAnotherDialog(this.actor);
    }

    /**
    * Roll five exploding d6 and fill the five attributes. Confirms
    * first so the click doesn't wipe an existing character.
    * @param {Event} event
    * @private
    */
    async _onRollAttributes(event) {
        event.preventDefault();
        const confirmed = await Dialog.confirm({
            title: "Roll Attributes",
            content: "<p>Replace the five attribute values with random rolls (1d6 exploding on 6)? This cannot be undone.</p>",
            yes: () => true,
            no: () => false,
            defaultYes: false
        });
        if (!confirmed) return;

        const attrNames = ["physique", "finesse", "mind", "presence", "soul"];
        const results = {};
        const chatRows = [];
        for (const a of attrNames) {
            const roll = await new Roll("1d6x6").evaluate({ async: true });
            // Clamp at the 10 cap.
            const total = Math.min(10, roll.total);
            results[`system.attributes.${a}.value`] = total;
            const dice = roll.dice[0]?.results?.map(r => r.result).join(", ") || roll.total;
            chatRows.push(`<li><strong>${a[0].toUpperCase()}${a.slice(1)}:</strong> ${total} <em>(${dice})</em></li>`);
        }
        await this.actor.update(results);

        ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: this.actor }),
            content: `<div class="thefade-attr-roll"><p><strong>${this.actor.name}</strong> rolls attributes (1d6! × 5):</p><ul>${chatRows.join("")}</ul></div>`
        });
    }

    /**
    * Handle casting a spell
    * @param {Event} event   The originating click event
    * @private
    */
    async _onCastSpell(event) {
        event.preventDefault();
        const element = event.currentTarget;

        // Get the spell ID - with fallback for new HTML structure
        let spellId;
        const item = element.closest(".item");

        if (item && item.dataset && item.dataset.itemId) {
            // Old HTML structure
            spellId = item.dataset.itemId;
        } else {
            // New HTML structure - find the spell-item inside the spell-wrapper
            const wrapper = element.closest(".spell-wrapper");
            if (wrapper) {
                const itemElement = wrapper.querySelector(".spell-item");
                if (itemElement && itemElement.dataset) {
                    spellId = itemElement.dataset.itemId;
                }
            }
        }

        if (!spellId) {
            ui.notifications.error("Could not determine which spell to cast");
            return;
        }

        const spell = this.actor.items.get(spellId);

        if (!spell) return;

        const spellData = spell.system;
        const successRequirements = getSpellSuccessRequirements(spellData);
        const activationRequiredSuccesses = successRequirements.spellcasting;
        const summarizeD12Roll = rolled => {
            let successes = 0;
            const dieResultsDetails = (rolled?.terms?.[0]?.results || []).map(die => {
                let resultClass = "failure";
                if (die.result >= 12) {
                    resultClass = "critical";
                    successes += 2;
                } else if (die.result >= 8) {
                    resultClass = "success";
                    successes += 1;
                }
                return { value: die.result, class: resultClass };
            });
            return { successes, dieResultsDetails };
        };

        // Find the Spellcasting skill
        const spellcasting = getSkill(this.actor, "Spellcasting");

        if (!spellcasting) {
            ui.notifications.warn("Character does not have the Spellcasting skill.");
            return;
        }

        const skillData = spellcasting; // merged data object
        // Get the attribute name from the skill
        const attributeName = skillData.attribute || "soul"; // Default to "soul" if not specified
        let attrValue = 0;

        if (attributeName.includes('_')) {
            // Handle combined attributes like "mind_soul"
            const attributes = attributeName.split('_');
            const attr1 = this.actor.system.attributes[attributes[0]]?.value || 0;
            const attr2 = this.actor.system.attributes[attributes[1]]?.value || 0;
            attrValue = Math.floor((attr1 + attr2) / 2); // Calculate average
        } else {
            // Normal single attribute (typically soul for spellcasting)
            attrValue = this.actor.system.attributes[attributeName]?.value || 0;
        }

        let dicePool = attrValue;

        // Add bonus dice based on skill rank
        switch (skillData.rank) {
            case "practiced":
                dicePool += 1;
                break;
            case "adept":
                dicePool += 2;
                break;
            case "experienced":
                dicePool += 3;
                break;
            case "expert":
                dicePool += 4;
                break;
            case "mastered":
                dicePool += 6;
                break;
            case "untrained":
                dicePool = Math.floor(dicePool / 2);
                break;
        }

        // Apply active-condition modifiers
        const condMods = this.actor.getConditionRollModifiers({
            kind: "spell",
            skillName: "Spellcasting",
            skillCategory: skillData.category,
            attributeName: attributeName
        });
        if (condMods.autoFail) {
            ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor: this.actor }),
                flavor: `Casting ${spell.name}`,
                content: renderModifierHtml(condMods) +
                    `<p><strong>${this.actor.name}</strong> cannot cast due to an active condition.</p>`
            });
            return;
        }
        dicePool += condMods.bonusDice - condMods.penaltyDice;
        dicePool = Math.max(1, dicePool);

        // Rune magic is a two-stage process with independent thresholds.
        // Symbology draws the rune first; Spellcasting activates it. A failed
        // drawing is not itself a magical mishap.
        let runeDrawing = null;
        let runeCondMods = null;
        if (spellData.school === "Runes") {
            const symbology = getSkill(this.actor, "Symbology");
            if (!symbology) {
                ui.notifications.warn("Character does not have the Symbology skill.");
                return;
            }

            let runeDicePool = calculateSkillDice(this.actor, symbology);
            runeCondMods = this.actor.getConditionRollModifiers({
                kind: "skill",
                skillName: "Symbology",
                skillCategory: symbology.category,
                attributeName: symbology.attribute
            });
            runeDicePool = Math.max(1, runeDicePool + runeCondMods.bonusDice - runeCondMods.penaltyDice);

            if (runeCondMods.autoFail) {
                runeDrawing = {
                    dicePool: runeDicePool,
                    dieResultsDetails: [],
                    successes: 0,
                    required: successRequirements.symbology,
                    success: false,
                    autoFail: true,
                    roll: null
                };
            } else {
                const runeRoll = await new Roll(`${runeDicePool}d12`).evaluate({ async: true });
                const runeSummary = summarizeD12Roll(runeRoll);
                runeDrawing = {
                    dicePool: runeDicePool,
                    dieResultsDetails: runeSummary.dieResultsDetails,
                    successes: runeSummary.successes,
                    required: successRequirements.symbology,
                    success: runeSummary.successes >= successRequirements.symbology,
                    autoFail: false,
                    roll: runeRoll
                };
            }
        }

        // Roll the dice for spell casting check
        const roll = new Roll(`${dicePool}d12`);
        await roll.evaluate();

        const activationSummary = summarizeD12Roll(roll);
        const dieResultsDetails = activationSummary.dieResultsDetails;
        const successes = activationSummary.successes;

        // Check if spell succeeds
        const activationSucceeds = successes >= activationRequiredSuccesses;
        const spellSucceeds = activationSucceeds && (!runeDrawing || runeDrawing.success);

        // Calculate bonus successes
        const bonusSuccesses = spellSucceeds ? successes - activationRequiredSuccesses : 0;

        const damageProfile = buildSpellDamageProfile(spellData);
        const effectsProfile = buildSpellEffectsProfile(spellData);

        // Calculate half damage for damage-type effects
        const halfDamage = damageProfile.total ? Math.max(1, Math.floor(damageProfile.total / 2)) : 1;

        // Determine if a mishap occurs on failure
        let mishapSeverity = null;
        let mishapMessage = "";

        if (!activationSucceeds) {
            const successesMissing = activationRequiredSuccesses - successes;

            if (successesMissing === 1) {
                mishapSeverity = "Minor";
            } else if (successesMissing === 2 || successesMissing === 3) {
                mishapSeverity = "Moderate";
            } else if (successesMissing >= 4) {
                mishapSeverity = "Severe";
            }

            // For critical mishaps (0 successes and missing 4+ successes)
            if (successes === 0 && successesMissing >= 4) {
                mishapSeverity = "Critical";
            }

            mishapMessage = `<p class="spell-mishap"><strong>Mishap Severity:</strong> ${mishapSeverity}</p>
            <p>Roll on the ${mishapSeverity} Mishap table!</p>`;
        }

        // Each listed defense receives an independent attack roll. This lets a
        // spell such as Gag of Hell resolve its Resilience and Grit effects
        // separately instead of treating both defenses as a single target.
        const attackRolls = [];
        if (spellSucceeds) {
            for (const targetDefense of getSpellAttackTargets(spellData)) {
                const attackRoll = await new Roll(`${dicePool}d12`).evaluate({ async: true });
                const attackSummary = summarizeD12Roll(attackRoll);
                const attackDT = 3;
                const attackHits = attackSummary.successes >= attackDT;
                attackRolls.push({
                    dicePool,
                    dieResultsDetails: attackSummary.dieResultsDetails,
                    successes: attackSummary.successes,
                    dt: attackDT,
                    hits: attackHits,
                    bonusSuccesses: attackHits ? attackSummary.successes - attackDT : 0,
                    targetDefense,
                    effect: spellData.attackEffects?.[targetDefense] || "",
                    roll: attackRoll
                });
            }
        }

        let isDurationLong = false;
        if (spellData.time) {
            // Check if duration contains any of the long duration keywords
            const longDurations = ['hour', 'day', 'week', 'month', 'year'];
            isDurationLong = longDurations.some(keyword =>
                spellData.time.toLowerCase().includes(keyword)
            );
        }

        const restrictedDamageTypes = new Set(["So", "Ex", "Psi"]);
        const damageIncreaseCost = damageProfile.components.some(component => restrictedDamageTypes.has(component.type)) ? 2 : 1;
        const canCrit = damageProfile.components.length > 0 &&
            damageProfile.components.every(component => !restrictedDamageTypes.has(component.type));

        const templateData = {
            actor: this.actor.name,
            spellName: spell.name,
            dicePool: dicePool,
            dieResultsDetails: dieResultsDetails,
            successes: successes,
            required: activationRequiredSuccesses,
            success: spellSucceeds,
            activationSuccess: activationSucceeds,
            isRune: !!runeDrawing,
            runeDrawing,
            runeDrawingFailed: !!runeDrawing && !runeDrawing.success,
            bonusSuccesses: bonusSuccesses,
            bonusEffect: spellData.bonusEffect,
            durationIncreaseCost: isDurationLong ? 2 : 1,
            damageIncreaseCost: damageIncreaseCost,
            canCrit,
            mishap: !activationSucceeds,
            mishapSeverity: mishapSeverity,
            mishapMessage: mishapMessage.replace(/<\/?p[^>]*>/g, '').replace(/<\/?strong[^>]*>/g, ''),
            damage: spellSucceeds && damageProfile.total ? damageProfile.total : null,
            damageType: damageProfile.primaryType,
            damageComponents: spellSucceeds ? damageProfile.components : [],
            damageDisplay: spellSucceeds && damageProfile.total ? damageProfile.display : "",
            sanityDamage: spellSucceeds ? effectsProfile.sanityDamage : "",
            statusEffects: spellSucceeds ? effectsProfile.statusEffects : [],
            buffEffects: spellSucceeds ? effectsProfile.buffEffects : [],
            halfDamage: halfDamage,
            ...damageTypeFlags(damageProfile.primaryType, damageProfile.components),
            description: spellData.description,
            weapons: spellData.weapons,
            recipeCost: spellData.recipeCost,
            hasAttack: attackRolls.length > 0,
            attackRolls,
            range: spellData.range,
            time: spellData.time
        };

        const content = (runeCondMods ? renderModifierHtml(runeCondMods) : "") + renderModifierHtml(condMods) +
            await renderTemplate("systems/thefade/templates/chat/spell-cast.html", templateData);

        // Send the spell casting result to chat
        await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor: this.actor }),
            flavor: `Casting ${spell.name}`,
            content: content
        });

        // Dark Magic: every cast (success or not) accrues Sin and may
        // trigger Dark Magic's attack against the caster's Grit.
        if (isDarkMagicSpell(spell)) {
            try {
                await handleDarkCast(this.actor, spell);
            } catch (err) {
                console.error("handleDarkCast failed:", err);
            }
        }
    }

    // --------------------------------------------------------------------
    // DIALOG UTILITIES
    // --------------------------------------------------------------------


    /**
    * Show target selection dialog for attacks/spells
    * @param {string} title - Dialog title
    * @returns {Promise<object|null>} Target info or null if cancelled
    */
    async _getTargetInfo(title = "Select Target", weaponSystem = null) {
        return new Promise((resolve) => {
            const attackerToken = this._getPrimaryTokenForActor(this.actor);

            // Generate list of scene tokens that can be targeted.
            // Do not require visibility/actor here so explicit user targets still appear.
            const tokens = canvas.tokens.placeables.filter(t => t.id);

            let selectedTargetId = "";

            // Prefer an explicitly user-targeted token so "Toggle Target" works directly.
            const userTargets = [...game.user.targets]
                .map(t => canvas.tokens.get(t.id) ?? t)
                .filter(t =>
                    t?.id &&
                    t.id !== attackerToken?.id
                );

            if (userTargets.length === 1) {
                // Use the single targeted token to avoid surprising multi-target behavior.
                selectedTargetId = userTargets[0].id;
            }
            // Fallback to a single controlled token (legacy behavior).
            else {
                const controlledTokens = canvas.tokens.controlled.filter(t => t.actor && t.actor.id !== this.actor.id);
                if (controlledTokens.length === 1) selectedTargetId = controlledTokens[0].id;
            }

            // Ensure targeted tokens are present in dropdown even if they were filtered from placeables.
            const tokenMap = new Map(tokens.map(t => [t.id, t]));
            for (const target of userTargets) {
                if (!tokenMap.has(target.id)) tokenMap.set(target.id, target);
            }

            let tokenOptions = '<option value="">No Target / Manual DT</option>';
            const selectableTokens = [...tokenMap.values()]
                .filter(token => token.id !== attackerToken?.id)
                .sort((a, b) => (a.name || a.actor?.name || "").localeCompare(b.name || b.actor?.name || ""));

            if (selectableTokens.length > 0) {
                selectableTokens.forEach(token => {
                    const selectedAttr = token.id === selectedTargetId ? " selected" : "";
                    tokenOptions += `<option value="${token.id}"${selectedAttr}>${token.name || token.actor?.name || token.id}</option>`;
                });
            }

            const dialog = new Dialog({
                title: title,
                content: `
                <form>
                    <div class="form-group">
                        <label>Target:</label>
                        <select id="target-select" name="targetId">${tokenOptions}</select>
                    </div>
                    <div class="form-group">
                        <label>Target Facing:</label>
                        <select id="facing-select" name="facing">
                            <option value="front">Front</option>
                            <option value="flank">Flank</option>
                            <option value="backflank">Back Flank</option>
                            <option value="back">Back</option>
                        </select>
                        <p class="hint" id="facing-hint">Auto-detected from token positions and target rotation when possible.</p>
                    </div>
                    ${hasWeaponQuality(weaponSystem, "antiCavalry") ? `<div class="form-group">
                        <label class="checkbox-label"><input id="target-mounted" type="checkbox" /> Target is mounted or is a mount</label>
                        <p class="hint">Applies Anti-Cavalry's +6 damage.</p>
                    </div>` : ""}
                    ${hasWeaponQuality(weaponSystem, "dualTrigger") ? `
                    <div class="form-group">
                        <label class="checkbox-label"><input id="dual-trigger" type="checkbox" /> Squeeze both triggers</label>
                        <p class="hint">Deals 1.5× damage and expends all ammunition.</p>
                    </div>` : ""}
                    <div class="form-group">
                        <label>Hit Location:</label>
                        <select id="hit-location-mode" name="hitLocationMode">
                            <option value="random" selected>Random (1d12 on hit)</option>
                            <option value="default">Default (Body)</option>
                            <option value="called">Called Shot (&minus;2D)</option>
                        </select>
                    </div>
                    <div class="form-group" id="called-shot-row" style="display:none;">
                        <label>Called Shot Location:</label>
                        <select id="called-shot-location" name="calledShotLocation">
                            <option value="head">Head</option>
                            <option value="body">Body</option>
                            <option value="leftarm">Left Arm</option>
                            <option value="rightarm">Right Arm</option>
                            <option value="leftleg">Left Leg</option>
                            <option value="rightleg">Right Leg</option>
                        </select>
                        <p class="hint">Called shots apply status effects on hit but cost 2 dice from the attack pool.</p>
                    </div>
                </form>
            `,
                buttons: {
                    submit: {
                        icon: '<i class="fas fa-check"></i>',
                        label: "Continue",
                        callback: html => {
                            const targetId = html.find('#target-select').val();
                            const facing = html.find('#facing-select').val();
                            const hitLocationMode = html.find('#hit-location-mode').val() || "random";
                            const calledShotLocation = html.find('#called-shot-location').val() || "body";
                            const targetMounted = html.find('#target-mounted').is(':checked');
                            const dualTrigger = html.find('#dual-trigger').is(':checked');
                            resolve({ targetId, facing, hitLocationMode, calledShotLocation, targetMounted, dualTrigger });
                        }
                    },
                    cancel: {
                        icon: '<i class="fas fa-times"></i>',
                        label: "Cancel",
                        callback: () => resolve(null)
                    }
                },
                default: "submit",
                close: () => resolve(null),
                render: html => {
                    const targetSelect = html.find('#target-select');
                    const facingSelect = html.find('#facing-select');
                    const facingHint = html.find('#facing-hint');

                    const applyAutoFacing = (tokenId) => {
                        if (!tokenId) {
                            facingSelect.val("front");
                            facingHint.text("No target selected; defaulting to Front.");
                            return;
                        }

                        const targetToken = canvas.tokens.get(tokenId);
                        const detectedFacing = this._calculateFacingFromTokens(attackerToken, targetToken);
                        const isAutoDetected = !!(attackerToken && targetToken);

                        facingSelect.val(detectedFacing);
                        facingHint.text(
                            isAutoDetected
                                ? `Auto-detected facing: ${detectedFacing} (you can override manually).`
                                : "Could not auto-detect facing (missing token on scene). Defaulting to Front."
                        );
                    };

                    applyAutoFacing(targetSelect.val() || "");
                    targetSelect.on('change', ev => applyAutoFacing(ev.currentTarget.value));

                    const modeSelect = html.find('#hit-location-mode');
                    const calledRow = html.find('#called-shot-row');
                    const toggleCalledRow = () => {
                        if (modeSelect.val() === "called") calledRow.show();
                        else calledRow.hide();
                    };
                    toggleCalledRow();
                    modeSelect.on('change', toggleCalledRow);
                }
            });
            dialog.render(true);
        });
    }

    /**
    * Get the most relevant on-scene token for an actor.
    * Prefers controlled tokens to match active user context.
    * @param {Actor} actor - Actor to find token for
    * @returns {Token|null}
    */
    _getPrimaryTokenForActor(actor) {
        if (!actor || !canvas?.ready || !canvas.tokens) return null;

        const controlledToken = canvas.tokens.controlled.find(t => t.actor?.id === actor.id);
        if (controlledToken) return controlledToken;

        const activeTokens = actor.getActiveTokens(true, true);
        if (activeTokens.length > 0) return activeTokens[0];

        return null;
    }

    /**
    * Calculate facing from the attacker's snapped hex direction relative to
    * the target token's selected front hex.
    * @param {Token|null} attackerToken - Token performing the attack
    * @param {Token|null} targetToken - Target token receiving the attack
    * @returns {string} one of front|flank|backflank|back
    */
    _calculateFacingFromTokens(attackerToken, targetToken) {
        if (!attackerToken || !targetToken) return "front";

        return classifyTokenFacing(attackerToken, targetToken, canvas?.grid);
    }

    /**
    * Get spell difficulty threshold from user
    * @returns {Promise<number|null>} Spell DT or null if cancelled
    */
    async _getSpellDT() {
        return new Promise((resolve) => {
            const dialog = new Dialog({
                title: "Dark Magic Spell Difficulty",
                content: `
                <form>
                    <div class="form-group">
                        <label>Spell Difficulty Threshold (DT):</label>
                        <input type="number" name="dt" value="3" min="1" max="10"/>
                        <p class="hint">Enter the number of successes required for the spell</p>
                    </div>
                </form>
            `,
                buttons: {
                    submit: {
                        icon: '<i class="fas fa-check"></i>',
                        label: "Roll",
                        callback: html => {
                            const dt = parseInt(html.find('[name="dt"]').val());
                            resolve(dt);
                        }
                    },
                    cancel: {
                        icon: '<i class="fas fa-times"></i>',
                        label: "Cancel",
                        callback: () => resolve(null)
                    }
                },
                default: "submit",
                close: () => resolve(null)
            });
            dialog.render(true);
        });
    }

    /**
    * Get difficulty threshold from user
    * @param {string} title - Dialog title
    * @param {number} defaultDT - Default DT value
    * @returns {Promise<number|null>} Selected DT or null if cancelled
    */
    async _getDifficultyThreshold(title = "Set Difficulty Threshold", defaultDT = 3) {
        return new Promise((resolve) => {
            const dialog = new Dialog({
                title: title,
                content: `
                <form>
                    <div class="form-group">
                        <label>Difficulty Threshold (DT):</label>
                        <input type="number" name="dt" value="${defaultDT}" min="1" max="10"/>
                        <p class="hint">Number of successes needed</p>
                    </div>
                </form>
            `,
                buttons: {
                    submit: {
                        icon: '<i class="fas fa-check"></i>',
                        label: "Roll",
                        callback: html => {
                            const dt = parseInt(html.find('[name="dt"]').val());
                            resolve(dt);
                        }
                    },
                    cancel: {
                        icon: '<i class="fas fa-times"></i>',
                        label: "Cancel",
                        callback: () => resolve(null)
                    }
                },
                default: "submit",
                close: () => resolve(null)
            });
            dialog.render(true);
        });
    }


    // --------------------------------------------------------------------
    // EVENT LISTENERS & ACTIVATION
    // --------------------------------------------------------------------

    /**
     * Stat key -> { basePath, bonusPath, overridePath, totalPath } locator.
     * Adjustable computed values register here so the pencil-icon dialog can
     * read/write the right fields without each call-site repeating itself.
     */
    static ADJUSTABLE_STATS = {
        resilience: {
            basePath: "system.defenses.resilience",
            bonusPath: "system.defenses.resilienceBonus",
            overridePath: "system.defenses.resilienceOverride",
            totalPath: "system.totalResilience"
        },
        avoid: {
            basePath: "system.defenses.avoid",
            bonusPath: "system.defenses.avoidBonus",
            overridePath: "system.defenses.avoidOverride",
            totalPath: "system.totalAvoid"
        },
        grit: {
            basePath: "system.defenses.grit",
            bonusPath: "system.defenses.gritBonus",
            overridePath: "system.defenses.gritOverride",
            totalPath: "system.totalGrit"
        },
        passiveDodge: {
            basePath: "system.defenses.basePassiveDodge",
            bonusPath: "system.defenses.passiveDodgeBonus",
            overridePath: "system.defenses.passiveDodgeOverride",
            totalPath: "system.defenses.passiveDodge",
            baseLabel: "Base",
            baseHint: "Computed from Acrobatics rank or 1/4 Finesse (whichever is higher)."
        },
        passiveParry: {
            basePath: "system.defenses.basePassiveParry",
            bonusPath: "system.defenses.passiveParryBonus",
            overridePath: "system.defenses.passiveParryOverride",
            totalPath: "system.defenses.passiveParry",
            baseLabel: "Base",
            baseHint: "Computed from your highest weapon skill rank."
        },
        physique: {
            basePath: "system.attributes.physique.value",
            bonusPath: "system.attributes.physique.bonus",
            overridePath: "system.attributes.physique.override",
            totalPath: "system.attributes.physique.total",
            baseLabel: "Base Score",
            baseHint: "The score you entered on the sheet. Species and flexible bonuses are added automatically."
        },
        finesse: {
            basePath: "system.attributes.finesse.value",
            bonusPath: "system.attributes.finesse.bonus",
            overridePath: "system.attributes.finesse.override",
            totalPath: "system.attributes.finesse.total",
            baseLabel: "Base Score",
            baseHint: "The score you entered on the sheet. Species and flexible bonuses are added automatically."
        },
        mind: {
            basePath: "system.attributes.mind.value",
            bonusPath: "system.attributes.mind.bonus",
            overridePath: "system.attributes.mind.override",
            totalPath: "system.attributes.mind.total",
            baseLabel: "Base Score",
            baseHint: "The score you entered on the sheet. Species and flexible bonuses are added automatically."
        },
        presence: {
            basePath: "system.attributes.presence.value",
            bonusPath: "system.attributes.presence.bonus",
            overridePath: "system.attributes.presence.override",
            totalPath: "system.attributes.presence.total",
            baseLabel: "Base Score",
            baseHint: "The score you entered on the sheet. Species and flexible bonuses are added automatically."
        },
        soul: {
            basePath: "system.attributes.soul.value",
            bonusPath: "system.attributes.soul.bonus",
            overridePath: "system.attributes.soul.override",
            totalPath: "system.attributes.soul.total",
            baseLabel: "Base Score",
            baseHint: "The score you entered on the sheet. Species and flexible bonuses are added automatically."
        }
    };

    /**
     * Pencil-icon edit dialog for adjustable computed values. Reads/writes
     * the bonus and override fields registered in ADJUSTABLE_STATS. Override
     * (when non-blank) replaces the computed total outright in actor.js.
     */
    async _onEditAdjustable(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        const el = ev.currentTarget;
        const stat = el.dataset.stat;
        const label = el.dataset.label || stat;
        const cfg = TheFadeCharacterSheet.ADJUSTABLE_STATS[stat];
        if (!cfg) return ui.notifications?.warn(`Unknown adjustable stat: ${stat}`);

        const get = (path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), this.actor);
        const base = Number(get(cfg.basePath) ?? 0);
        const bonus = Number(get(cfg.bonusPath) ?? 0);
        const overrideRaw = get(cfg.overridePath);
        const total = Number(get(cfg.totalPath) ?? 0);

        const baseLabel = cfg.baseLabel || "Base";
        const baseHint = cfg.baseHint || "Use Bonus or Override to adjust.";
        const content = `
            <form class="tf-edit-adjustable">
                <p class="tf-muted">Editing <strong>${label}</strong>. Total = Base + Bonus, unless an Override is set (which replaces the total).</p>
                <div class="form-group">
                    <label>${baseLabel}</label>
                    <input type="number" value="${base}" disabled />
                    <p class="hint">${baseHint}</p>
                </div>
                <div class="form-group">
                    <label>Manual Bonus</label>
                    <input type="number" name="bonus" value="${bonus}" />
                    <p class="hint">Adds on top of the base.</p>
                </div>
                <div class="form-group">
                    <label>Override</label>
                    <input type="number" name="override" value="${overrideRaw ?? ""}" placeholder="(blank = use computed total)" />
                    <p class="hint">If set, replaces the computed total entirely — ignores facing, stance, and conditions.</p>
                </div>
                <div class="form-group">
                    <label>Current Total</label>
                    <input type="number" value="${total}" disabled />
                </div>
            </form>`;

        return new Promise((resolve) => {
            new Dialog({
                title: `Edit ${label}`,
                content,
                buttons: {
                    save: {
                        label: "Save",
                        callback: async (html) => {
                            const form = html[0].querySelector("form");
                            const bonusRaw = form.elements.bonus.value;
                            const overrideStr = form.elements.override.value;
                            await this.actor.update({
                                [cfg.bonusPath]: bonusRaw === "" ? 0 : Number(bonusRaw),
                                [cfg.overridePath]: overrideStr === "" ? null : Number(overrideStr)
                            });
                            resolve();
                        }
                    },
                    reset: {
                        label: "Reset",
                        callback: async () => {
                            await this.actor.update({
                                [cfg.bonusPath]: 0,
                                [cfg.overridePath]: null
                            });
                            resolve();
                        }
                    },
                    cancel: { label: "Cancel", callback: () => resolve() }
                },
                default: "save",
                close: () => resolve()
            }, { classes: ["thefade", "dialog", "tf-edit-adjustable"], width: 460 }).render(true);
        });
    }

    _activateLinkedAbilityListeners(html) {
        const linkedAbilities = html.find('.linked-abilities-block');
        if (!linkedAbilities.length) return;

        const getItem = itemId => itemId ? this.actor.items.get(itemId) : null;
        const updateLinkedItem = async (item, update) => {
            await item.update(update);

            // Species abilities are also cached on the actor for derived-stat and
            // bonus calculations. Keep that cache current when editing the linked
            // embedded Species item from this sheet, even when full species sync
            // has been disabled for unrelated Species fields.
            if (["species", "monsterspecies"].includes(item.type)) {
                await this.actor.update({
                    "system.species.speciesAbilities": foundry.utils.deepClone(item.system?.speciesAbilities || {})
                });
            }
        };
        const getEditorContext = element => {
            const editor = element.closest('.linked-ability-editor');
            if (!editor) return {};
            return {
                editor,
                item: getItem(editor.dataset.itemId),
                abilityId: editor.dataset.abilityId,
                abilityRoot: editor.dataset.abilityRoot
            };
        };

        linkedAbilities.find('.linked-source-edit').on('click', ev => {
            ev.preventDefault();
            ev.stopPropagation();
            getItem(ev.currentTarget.dataset.itemId)?.sheet?.render(true);
        });

        linkedAbilities.find('.linked-ability-add').on('click', async ev => {
            ev.preventDefault();
            ev.stopPropagation();
            const item = getItem(ev.currentTarget.dataset.itemId);
            const abilityRoot = ev.currentTarget.dataset.abilityRoot;
            if (!item || !abilityRoot) return;
            const abilities = foundry.utils.deepClone(item.system?.[abilityRoot] || {});
            const id = foundry.utils.randomID(16);
            abilities[id] = { name: "New Ability", description: "", bonuses: [] };
            await updateLinkedItem(item, { [`system.${abilityRoot}`]: abilities });
        });

        linkedAbilities.find('.linked-ability-delete').on('click', async ev => {
            ev.preventDefault();
            const { item, abilityId, abilityRoot } = getEditorContext(ev.currentTarget);
            if (!item || !abilityId || !abilityRoot) return;
            await updateLinkedItem(item, { [`system.${abilityRoot}.-=${abilityId}`]: null });
        });

        linkedAbilities.find('.linked-ability-field').on('change', async ev => {
            ev.preventDefault();
            ev.stopImmediatePropagation();
            const { item } = getEditorContext(ev.currentTarget);
            const path = ev.currentTarget.dataset.itemPath;
            if (!item || !path) return;
            const value = ev.currentTarget.dataset.dtype === "Number"
                ? (Number(ev.currentTarget.value) || 0)
                : (ev.currentTarget.value || "");
            await updateLinkedItem(item, { [path]: value });
        });

        linkedAbilities.find('.linked-ability-use').on('click', async ev => {
            ev.preventDefault();
            const { item, abilityId, abilityRoot } = getEditorContext(ev.currentTarget);
            const ability = item?.system?.[abilityRoot]?.[abilityId];
            if (!item || !ability) return;
            await activateAbility(this.actor, { id: abilityId, ...ability }, { id: item.id, label: item.name, kind: item.type === "species" || item.type === "monsterspecies" ? "Species" : "Path" });
        });

        const bonusContext = element => {
            const section = $(element).closest('.bonus-section');
            const { item } = getEditorContext(element);
            return { section, item, path: section.attr('data-bonus-path') };
        };

        const getBonuses = (item, path) => {
            const bonuses = item && path ? foundry.utils.getProperty(item, path) : [];
            return Array.isArray(bonuses) ? bonuses : [];
        };

        const saveBonusSection = async section => {
            const editor = section.closest('.linked-ability-editor')[0];
            const { item } = getEditorContext(editor);
            const path = section.attr('data-bonus-path');
            if (!item || !path) return;
            const bonuses = [];
            section.find('.bonus-row').each((index, rowElement) => {
                bonuses.push(readMechanicalBonusRow($(rowElement)));
            });
            await updateLinkedItem(item, { [path]: bonuses });
        };

        linkedAbilities.find('.bonus-row').each((index, row) => updateMechanicalBonusRow($(row)));

        linkedAbilities.find('.bonus-add').on('click', async ev => {
            ev.preventDefault();
            const { section, item, path } = bonusContext(ev.currentTarget);
            if (!item || !path) return;
            const bonuses = foundry.utils.deepClone(getBonuses(item, path));
            bonuses.push({ id: foundry.utils.randomID(16), type: "skill", target: "", value: 1 });
            await updateLinkedItem(item, { [path]: bonuses });
        });

        linkedAbilities.find('.bonus-delete').on('click', async ev => {
            ev.preventDefault();
            const { item, path } = bonusContext(ev.currentTarget);
            if (!item || !path) return;
            const id = ev.currentTarget.dataset.bonusId;
            await updateLinkedItem(item, { [path]: getBonuses(item, path).filter(bonus => bonus.id !== id) });
        });

        linkedAbilities.find('.bonus-type').on('change', async ev => {
            const row = $(ev.currentTarget).closest('.bonus-row');
            updateMechanicalBonusRow(row, { resetAmount: true });
            await saveBonusSection(row.closest('.bonus-section'));
        });

        linkedAbilities.find('.bonus-target-control, .bonus-vulnerability-severity, .bonus-value').on('change', async ev => {
            const row = $(ev.currentTarget).closest('.bonus-row');
            if ($(ev.currentTarget).hasClass('bonus-universal-ability-target')) {
                updateMechanicalBonusRow(row, { resetAmount: true });
            }
            await saveBonusSection(row.closest('.bonus-section'));
        });
    }

    /** Reduce only equipped armor at a location, leaving ND untouched. */
    async _reduceArmorProtection(location, totalReduction) {
        let remaining = Math.max(0, Number(totalReduction) || 0);
        const pools = armorProtectionPools(this.actor, location).filter(pool => pool.current > 0);
        const cascades = this.actor.system.naturalDeflection?.[location]?.stacks === true;
        const orderedPools = cascades
            ? pools.sort((a, b) => (a.current - b.current) || a.key.localeCompare(b.key))
            : pools.sort((a, b) => (b.current - a.current) || a.key.localeCompare(b.key)).slice(0, 1);
        const updateMap = new Map();

        for (const pool of orderedPools) {
            if (remaining <= 0) break;
            const take = Math.min(pool.current, remaining);
            const update = updateMap.get(pool.itemId) || { _id: pool.itemId };
            update[pool.property] = pool.current - take;
            updateMap.set(pool.itemId, update);
            remaining -= take;
        }

        const updates = Array.from(updateMap.values());
        if (updates.length) await this.actor.updateEmbeddedDocuments("Item", updates);
        return Math.max(0, Number(totalReduction) || 0) - remaining;
    }

    /** Restore every equipped armor pool protecting a location. */
    async _resetArmorProtection(location) {
        const updateMap = new Map();
        for (const pool of armorProtectionPools(this.actor, location)) {
            const update = updateMap.get(pool.itemId) || { _id: pool.itemId };
            update[pool.property] = pool.max;
            updateMap.set(pool.itemId, update);
        }

        const updates = Array.from(updateMap.values());
        if (updates.length) await this.actor.updateEmbeddedDocuments("Item", updates);
        return updates.length;
    }

    /**
    * Activate sheet event listeners
    * @param {HTMLElement} html - Sheet HTML element
    */
    activateListeners(html) {
        super.activateListeners(html);

        html.find('.creature-subtype-add').on('click', async ev => {
            ev.preventDefault();
            const selector = $(ev.currentTarget).closest('.creature-subtype-selector');
            const id = selector.find('.creature-subtype-choice').val();
            if (!id) return;
            const subtypes = [...new Set([...(this.actor.system.species?.creatureSubtypes || []), id])];
            await this.actor.update({ "system.species.creatureSubtypes": subtypes });
        });

        html.find('.creature-subtype-remove').on('click', async ev => {
            ev.preventDefault();
            const id = ev.currentTarget.dataset.subtypeId;
            const subtypes = (this.actor.system.species?.creatureSubtypes || []).filter(value => value !== id);
            await this.actor.update({ "system.species.creatureSubtypes": subtypes });
        });

        html.find('.creature-rule-ability-use').on('click', async ev => {
            ev.preventDefault();
            const sourceId = ev.currentTarget.closest('[data-creature-rule-source]')?.dataset.creatureRuleSource;
            const abilityId = ev.currentTarget.closest('[data-creature-rule-ability]')?.dataset.creatureRuleAbility;
            const source = getCreatureRuleSources(this.actor.system, "character").find(entry => entry.id === sourceId);
            const ability = source?.abilities.find(entry => entry.id === abilityId);
            if (source && ability) await activateAbility(this.actor, ability, source);
        });

        html.find('.temporary-ability-bonus-remove').on('click', async ev => {
            ev.preventDefault();
            const id = ev.currentTarget.dataset.temporaryBonusId;
            const remaining = (this.actor.system.temporaryBonuses || []).filter(entry => entry.id !== id);
            await this.actor.update({ "system.temporaryBonuses": remaining });
        });

        html.find('.sheet-state-section').on('toggle', ev => {
            if (ev.currentTarget.dataset.filterForced === "true") return;
            const key = ev.currentTarget.dataset.sectionKey;
            if (!key) return;
            if (!this._sheetSectionOpenStates) this._sheetSectionOpenStates = new Map();
            this._sheetSectionOpenStates.set(key, ev.currentTarget.open);
        });

        html.find('.sheet-section-summary a, .sheet-section-summary button').on('click', ev => {
            ev.stopPropagation();
        });

        this._activateSheetFilters(html);

        html.find('.roll-anatomy-location').on('click', async ev => {
            ev.preventDefault();
            const controls = $(ev.currentTarget).closest('.anatomy-controls');
            const facing = controls.find('.anatomy-roll-facing').val() || "front";
            const preset = game.settings?.get("thefade", "alternateAnatomyEnabled")
                ? (this.actor.system?.anatomy?.preset || "humanoid")
                : "humanoid";
            const result = await rollHitLocation(facing, preset);
            const detail = result.sideRoll
                ? `1d12=${result.roll}, 1d2=${result.sideRoll}`
                : `1d12=${result.roll}`;
            await ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor: this.actor }),
                flavor: `${this.actor.name}: Hit Location`,
                content: `<div class="thefade-hit-location-roll"><strong>${result.label || locationLabel(result.location)}</strong><br><span>${detail} — ${result.column}</span></div>`
            });
        });

        // Remember Combat-tab accordion changes before actor updates replace
        // the rendered DOM. This also applies when the sheet is read-only.
        html.find('.combat-traits .universal-ability-category').on('toggle', ev => {
            const details = ev.currentTarget;
            const category = details.dataset.category;
            if (!category) return;
            if (!this._combatTraitOpenCategories) this._combatTraitOpenCategories = new Set();
            if (details.open) this._combatTraitOpenCategories.add(category);
            else this._combatTraitOpenCategories.delete(category);
        });

        // Everything below here is only needed if the sheet is editable
        if (!this.options.editable) return;

        this._initializeExcessPenaltyTooltips(html);

        this._activateInventoryListeners(html);

        this._activateLinkedAbilityListeners(html);

        html.find('.rules-item-create').on('click', event => this._onRulesItemCreate(event));
        html.find('.rules-item-edit').on('click', event => this._onRulesItemEdit(event));
        html.find('.rules-item-delete').on('click', event => this._onRulesItemDelete(event));
        html.find('.mutation-roll').on('click', event => this._onMutationRoll(event));
        html.find('.heritage-calculate').on('click', event => this._onCalculateHeritage(event));
        html.find('.fate-award').on('click', event => this._onAwardFate(event));
        html.find('.fate-spend').on('click', event => this._onSpendFate(event));
        html.find('.downtime-progress').on('click', event => this._onDowntimeProgress(event));

        // Pencil-icon edit dialog for adjustable computed values.
        html.find('.tf-edit-adjustable').on('click', this._onEditAdjustable.bind(this));

        // Aura: Ignite / End Ignition
        html.find('.aura-ignite-btn').on('click', async (ev) => {
            ev.preventDefault();
            await startIgnition(this.actor);
        });
        html.find('.aura-end-ignition-btn').on('click', async (ev) => {
            ev.preventDefault();
            await endIgnition(this.actor);
        });

        // Combat-state: clear all conditions + stance
        html.find('.combat-state-clear').on('click', async (ev) => {
            ev.preventDefault();
            const conditions = this.actor.system?.conditions || {};
            const update = { "system.activeStance": "none" };
            for (const key of Object.keys(conditions)) {
                update[`system.conditions.${key}.active`] = false;
            }
            await this.actor.update(update);
        });

        html.find('.combat-trait-toggle').on('change', async (ev) => {
            ev.preventDefault();
            ev.stopImmediatePropagation();
            const input = ev.currentTarget;
            if (!input?.name) return;
            const update = { [input.name]: input.checked };
            if (input.name.startsWith("system.combatTraits.immunities.statuses.") && input.checked) {
                const conditions = this.actor.system?.conditions || {};
                const statusKey = input.name.split(".").pop();
                if (statusKey === "all") {
                    for (const key of Object.keys(conditions)) {
                        update[`system.conditions.${key}.active`] = false;
                    }
                } else if (conditions[statusKey]) {
                    update[`system.conditions.${statusKey}.active`] = false;
                }
            }
            await this.actor.update(update);
        });

        html.find('.combat-trait-text').on('change', async (ev) => {
            ev.preventDefault();
            ev.stopImmediatePropagation();
            const input = ev.currentTarget;
            if (!input?.name) return;
            await this.actor.update({ [input.name]: input.value || "" });
        });

        // Injuries: add mental disorder
        html.find('.add-disorder-btn').on('click', async (ev) => {
            ev.preventDefault();
            const DISORDER_TYPES = ["anxiety", "psychotic", "mood", "dissociative"];
            const typeOpts = DISORDER_TYPES.map(t =>
                `<option value="${t}">${t.charAt(0).toUpperCase() + t.slice(1)}</option>`
            ).join("");
            const content = `
                <div style="display:grid;gap:8px;padding:4px 0">
                    <div>
                        <label style="display:block;margin-bottom:3px;font-size:0.85em">Type</label>
                        <select id="disorder-type" style="width:100%">${typeOpts}</select>
                    </div>
                    <div>
                        <label style="display:block;margin-bottom:3px;font-size:0.85em">Name</label>
                        <input id="disorder-name" type="text" style="width:100%" placeholder="e.g. Major Depressive" />
                    </div>
                </div>`;
            new Dialog({
                title: "Add Mental Disorder",
                content,
                buttons: {
                    add: {
                        icon: '<i class="fas fa-plus"></i>',
                        label: "Add",
                        callback: async (html) => {
                            const type = html.find('#disorder-type').val();
                            const name = html.find('#disorder-name').val().trim();
                            if (!name) return;
                            const existing = foundry.utils.deepClone(this.actor.system.mentalDisorders ?? []);
                            existing.push({ type, name });
                            await this.actor.update({ "system.mentalDisorders": existing });
                        }
                    },
                    cancel: { label: "Cancel" }
                },
                default: "add"
            }).render(true);
        });

        // Injuries: remove mental disorder
        html.find('.remove-disorder-btn').on('click', async (ev) => {
            ev.preventDefault();
            const idx = parseInt(ev.currentTarget.dataset.index);
            const existing = foundry.utils.deepClone(this.actor.system.mentalDisorders ?? []);
            existing.splice(idx, 1);
            await this.actor.update({ "system.mentalDisorders": existing });
        });

        // Initialize defense details state
        html.find('.defense-checkbox').each(function () {
            const checkbox = $(this);
            const details = checkbox.closest('.defense').find('.defense-details');

            if (checkbox.is(':checked')) {
                details.css('max-height', '200px');
                details.css('padding-top', '10px');
            } else {
                details.css('max-height', '0');
                details.css('padding-top', '0');
            }
        });

        // Toggle defense details on checkbox change
        html.find('.defense-checkbox').change(function () {
            const checkbox = $(this);
            const details = checkbox.closest('.defense').find('.defense-details');

            if (checkbox.is(':checked')) {
                details.css('max-height', '200px');
                details.css('padding-top', '10px');
            } else {
                details.css('max-height', '0');
                details.css('padding-top', '0');
            }
        });

        // Facing selector change - trigger re-render to update calculated passive defenses
        html.find('.facing-select').change(ev => {
            // The update happens automatically via the general handler above
            // The re-render will ensure calculated values reflect the new facing
            this.render(false);
        });

        // Embedded item fields deliberately use data-item-path rather than a
        // form name so Foundry's ActorSheet handler cannot also write them to
        // the actor document.
        html.find('.items-list .item [data-item-path]').change(async ev => {
            const element = ev.currentTarget;
            const itemId = element.closest('.item').dataset.itemId;

            if (!itemId) return;

            const item = this.actor.items.get(itemId);
            if (!item) return;

            const field = element.dataset.itemPath;
            let value = element.type === 'checkbox' ? element.checked : element.value;

            // Handle number inputs
            if (element.dataset.dtype === 'Number') {
                value = Number(value);
                if (isNaN(value)) value = 0;
            }

            await item.update({ [field]: value });
        });

        // Handle collapsible sections
        html.find('.defense-checkbox').change(function () {
            const checkbox = $(this);
            const details = checkbox.closest('.defense').find('.defense-details');

            if (checkbox.is(':checked')) {
                details.css('max-height', '200px');
                details.css('padding-top', '10px');
            } else {
                details.css('max-height', '0');
                details.css('padding-top', '0');
            }
        });

        html.find('.tool-header')
            .click(this._onToggleTool.bind(this))
            .on('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') this._onToggleTool(event);
            });

        html.find('.item-create').click(ev => {
            ev.preventDefault();
            const element = ev.currentTarget;
            let itemType = element.dataset.type;

            // Skip skill creation - they're auto-provided
            if (itemType === 'skill') {
                ui.notifications.info("Skills are automatically provided. Use the custom skill buttons to add Craft, Lore, or Perform skills.");
                return;
            }

            // Handle legacy "item" type by defaulting to medical
            if (itemType === 'item') {
                itemType = 'medical';
                ui.notifications.info("Creating a Medical item. Edit the item to change its type if needed.");
            }

            // Validate that the item type is supported
            if (!CONFIG.Item.types.includes(itemType)) {
                ui.notifications.error(`Invalid item type: ${itemType}`);
                console.error(`Attempted to create item with invalid type: ${itemType}`);
                return;
            }

            // Create the item with proper name formatting
            const itemTypeLabels = {
                monsterpath: "Monster Path",
                monsterspecies: "Monster Species"
            };
            const itemTypeLabel = itemTypeLabels[itemType] || `${itemType.charAt(0).toUpperCase()}${itemType.slice(1)}`;
            const itemData = {
                name: `New ${itemTypeLabel}`,
                type: itemType,
                system: {}
            };

            this.actor.createEmbeddedDocuments("Item", [itemData]);
        });

        html.find('.item-create[data-type="skill"]').click(ev => {
            ev.preventDefault();
            ui.notifications.info("Skills are automatically provided. Use the custom skill buttons to add Craft, Lore, or Perform skills.");
        });

        html.find('.item-edit-btn').click(ev => {
            const li = $(ev.currentTarget).closest("[data-item-id]");
            const itemId = li.data("itemId");
            if (!itemId) return;

            const item = this.actor.items.get(itemId);
            if (!item) return;

            item.sheet.render(true);
        });



        // Inventory Tab Navigation
        html.find('.tab-button').click((event) => {
            const clickedTab = $(event.currentTarget);
            const tabName = clickedTab.data('tab');

            this._activeInventoryTab = tabName;

            html.find('.tab-button').removeClass('active');
            html.find('.tab-content').removeClass('active');

            clickedTab.addClass('active');
            html.find(`#${tabName}-tab`).addClass('active');
        });

        // Inventory Subtab Navigation
        html.find('.subtab-button').click((event) => {
            const clickedSubtab = $(event.currentTarget);
            const subtabName = clickedSubtab.data('subtab');

            const parentTab = clickedSubtab.closest('.tab-content');
            const parentTabId = parentTab.attr('id').replace('-tab', '');

            // Store the new active subtab
            if (!this._activeSubtabs) this._activeSubtabs = {};
            this._activeSubtabs[parentTabId] = subtabName;

            parentTab.find('.subtab-button').removeClass('active');
            parentTab.find('.subtab-content').removeClass('active');

            clickedSubtab.addClass('active');
            parentTab.find(`#${subtabName}-subtab`).addClass('active');
        });

        html.find('.item-delete').off('click').click(ev => {
            const li = $(ev.currentTarget).closest("[data-item-id]");
            const itemId = li.data("itemId");

            if (!itemId) return;

            const item = this.actor.items.get(itemId);
            if (!item) return;

            this.actor.deleteEmbeddedDocuments("Item", [itemId]);
            li.slideUp(200, () => this.render(false));
        });

        // Custom-skill deletion (skills live on system.skills, not as items)
        html.find('.skill-delete').off('click').click(ev => {
            ev.preventDefault();
            const row = ev.currentTarget.closest("[data-skill-key]");
            const key = row?.dataset.skillKey;
            if (!key) return;
            const skill = getSkillByKey(this.actor, key);
            if (!skill) return;
            if (!skill.isCustom) {
                ui.notifications.warn("Core skills cannot be deleted.");
                return;
            }
            new Dialog({
                title: "Delete Custom Skill",
                content: `<p>Are you sure you want to delete the custom skill "${skill.name}"?</p>`,
                buttons: {
                    delete: {
                        icon: '<i class="fas fa-trash"></i>',
                        label: "Delete",
                        callback: async () => {
                            await deleteCustomSkill(this.actor, key);
                            this.render(false);
                        }
                    },
                    cancel: { icon: '<i class="fas fa-times"></i>', label: "Cancel" }
                },
                default: "cancel"
            }).render(true);
        });

        // Toggle the attribute lock on a core skill. Locking is non-destructive:
        // any previously-picked override attribute stays in the data and
        // returns the next time the lock is opened.
        html.find('.skill-attribute-lock').off('click').click(async ev => {
            ev.preventDefault();
            const row = ev.currentTarget.closest("[data-skill-key]");
            const key = row?.dataset.skillKey;
            if (!key) return;
            const current = this.actor.system?.skills?.[key]?.attributeUnlocked ?? false;
            await this.actor.update({
                [`system.skills.${key}.attributeUnlocked`]: !current
            });
        });

        html.find('.species-ability-add').click(async ev => {
            ev.preventDefault();

            // Get current abilities
            const abilities = foundry.utils.deepClone(this.actor.system.species.speciesAbilities || {});
            const id = foundry.utils.randomID(16);

            // Add new ability
            abilities[id] = { name: "New Ability", description: "" };

            // Update actor
            await this.actor.update({ "system.species.speciesAbilities": abilities });

            // Open edit dialog for the new ability
            this._onSpeciesAbilityEdit(id);
        });

        html.find('.species-ability-edit').click(ev => {
            ev.preventDefault();
            const abilityId = ev.currentTarget.closest('.species-ability').dataset.abilityId;
            this._onSpeciesAbilityEdit(abilityId);
        });

        // Inline define edit handler so we don't need a separate method binding
        this._onSpeciesAbilityEdit = async (abilityId) => {
            const abilities = foundry.utils.deepClone(this.actor.system.species?.speciesAbilities || {});
            const ability = abilities[abilityId];
            if (!ability) return;

            const escapeHtml = (s) => String(s ?? "")
                .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

            const content = `
                <form>
                    <div class="form-group">
                        <label>Name</label>
                        <input type="text" name="name" value="${escapeHtml(ability.name)}" />
                    </div>
                    <div class="form-group">
                        <label>Description</label>
                        <textarea name="description" rows="6">${escapeHtml(ability.description)}</textarea>
                    </div>
                </form>
            `;

            new Dialog({
                title: "Edit Species Ability",
                content,
                buttons: {
                    save: {
                        label: "Save",
                        callback: async (html) => {
                            const name = html.find('[name="name"]').val()?.trim() || "Unnamed";
                            const description = html.find('[name="description"]').val() || "";
                            await this.actor.update({
                                [`system.species.speciesAbilities.${abilityId}`]: { name, description }
                            });
                        }
                    },
                    cancel: { label: "Cancel" }
                },
                default: "save"
            }).render(true);
        };

        html.find('.species-ability-delete').click(async (event) => {
            event.preventDefault();

            const abilityItem = event.currentTarget.closest(".species-ability");
            const abilityId = abilityItem?.dataset.abilityId;

            if (!abilityId) return;

            // Use Foundry's special syntax to remove a key from an object
            const updateData = {
                [`system.species.speciesAbilities.-=${abilityId}`]: null
            };

            await this.actor.update(updateData);

            // Optional: force re-render to ensure visual update
            this.render(false);
        });

        html.find('.skill-roll').click(this._onSkillRoll.bind(this));
        html.find('.attribute-roll').click(this._onAttributeRoll.bind(this));
        html.find('.attack-roll').click(this._onAttackRoll.bind(this));

        // Right-click context menu on weapon rows: Edit / Delete
        const ContextMenuClass = foundry.applications?.ux?.ContextMenu?.implementation ?? globalThis.ContextMenu;
        new ContextMenuClass(html[0], '.weapons .weapon-row', [
            {
                name: 'Edit',
                icon: '<i class="fas fa-edit"></i>',
                callback: li => {
                    const itemId = li.dataset.itemId;
                    const item = this.actor.items.get(itemId);
                    if (item) item.sheet.render(true);
                }
            },
            {
                name: 'Delete',
                icon: '<i class="fas fa-trash"></i>',
                callback: li => {
                    const itemId = li.dataset.itemId;
                    if (!itemId) return;
                    this.actor.deleteEmbeddedDocuments('Item', [itemId]);
                    $(li).slideUp(200, () => this.render(false));
                }
            }
        ], { jQuery: false });
        html.find('.cast-spell').click(this._onCastSpell.bind(this));
        html.find('.initiative-roll').click(this._onInitiativeRoll.bind(this));
        html.find('.roll-dice').click(this._onRollDice.bind(this));
        html.find('.opposed-roll').click(this._onOpposedRoll.bind(this));
        html.find('.aid-another').click(this._onAidAnother.bind(this));
        html.find('.roll-addiction').click(this._onDarkMagicAddictionRoll.bind(this));
        html.find('.rest-daily').click(this._onRestDaily.bind(this));
        html.find('.take-rest-btn').click(this._onTakeRest.bind(this));

        // Mirror duplicated HP/Sanity inputs (rendered on Stats + Combat tabs) so
        // form serialization stays consistent regardless of which tab is active.
        html.find('.vitals-strip-inline input[name], .vitals-strip-inline input[data-vital-path]').on('input', function () {
            const path = this.getAttribute('name') || this.dataset.vitalPath;
            if (!path) return;
            html.find(`input[name="${path}"], input[data-vital-path="${path}"]`).not(this).val(this.value);
        });

        html.find('.vitals-strip-inline input[data-vital-path]:not([name])').on('change', async (ev) => {
            ev.preventDefault();
            ev.stopImmediatePropagation();
            const input = ev.currentTarget;
            const path = input.dataset.vitalPath;
            if (!path) return;

            let value = input.value;
            if (input.dataset.dtype === 'Number') {
                value = Number(value);
                if (!Number.isFinite(value)) {
                    const defaultValue = input.dataset.defaultValue !== undefined
                        ? Number(input.dataset.defaultValue)
                        : 0;
                    value = Number.isFinite(defaultValue) ? defaultValue : 0;
                }
            }

            await this.actor.update({ [path]: value });
        });
        html.find('.roll-attributes').click(this._onRollAttributes.bind(this));

        html.find('.level-up-btn').click(this._onLevelUp.bind(this));
        html.find('.experience-check-btn').click(this._onExperienceCheck.bind(this));
        html.find('input[name="system.isMonster"]').change(this._onMonsterChange.bind(this));

        html.find('.skill-browse').click(ev => {
            ev.preventDefault();
            ui.notifications.info("Skills are automatically provided. Use the custom skill buttons to add Craft, Lore, or Perform skills.");
        });

        html.find('.path-browse').click(ev => {
            ev.preventDefault();
            openCompendiumBrowser("path", this.actor);
        });

        html.find('.species-browse').click(ev => {
            ev.preventDefault();
            openCompendiumBrowser("species", this.actor);
        });

        // Right-click the compact species name to open the attached Species item sheet.
        html.find('.species-name-display').on('contextmenu', ev => {
            ev.preventDefault();
            const itemId = ev.currentTarget.closest('.species-card')?.dataset.itemId;
            const item = itemId ? this.actor.items.get(itemId) : this.actor.items.find(i => i.type === 'species' || i.type === 'monsterspecies');
            if (item) item.sheet.render(true);
            else ui.notifications.info("No Species item attached. Drop a Species, browse one, or enable Manual entry.");
        });

        // Right-click a path name in the Stats-tab summary to open its sheet.
        html.find('.path-summary-item').on('contextmenu', ev => {
            ev.preventDefault();
            const itemId = ev.currentTarget.dataset.itemId;
            const item = itemId ? this.actor.items.get(itemId) : null;
            if (item) item.sheet.render(true);
        });

        html.find('.weapon-browse').click(ev => {
            ev.preventDefault();
            openCompendiumBrowser("weapon", this.actor);
        });

        html.find('.armor-browse').click(ev => {
            ev.preventDefault();
            openCompendiumBrowser("armor", this.actor);
        });

        html.find('.spell-browse').click(ev => {
            ev.preventDefault();
            openCompendiumBrowser("spell", this.actor);
        });

        html.find('.talent-browse').click(ev => {
            ev.preventDefault();
            openCompendiumBrowser("talent", this.actor);
        });

        html.find('.trait-browse').click(ev => {
            ev.preventDefault();
            openCompendiumBrowser("talent", this.actor); // Use same browser as talents, will filter by type
        });

        html.find('.precept-browse').click(ev => {
            ev.preventDefault();
            openCompendiumBrowser("precept", this.actor);
        });

        html.find('.item-browse').click(ev => {
            ev.preventDefault();
            const section = $(ev.currentTarget).closest('.tab-content').attr('id');

            if (section === 'items-of-power-tab') {
                openCompendiumBrowser("magicitem", this.actor);
            } else {
                openCompendiumBrowser("medical", this.actor);
            }
            
        });

        /*
        Browse for Consumables
        */

        html.find('.potion-browse').click(ev => {
            ev.preventDefault();
            openCompendiumBrowser("potion", this.actor);
        });

        html.find('.alchemical-browse').click(ev => {
            ev.preventDefault();
            openCompendiumBrowser("alchemical", this.actor);
        });

        html.find('.alchemy-craft').click(async ev => {
            ev.preventDefault();
            const itemId = ev.currentTarget.closest('.item')?.dataset?.itemId;
            const item = itemId ? this.actor.items.get(itemId) : null;
            if (item) await craftAlchemicalItem(this.actor, item);
        });

        html.find('.drug-browse').click(ev => {
            ev.preventDefault();
            openCompendiumBrowser("drug", this.actor);
        });

        html.find('.poison-browse').click(ev => {
            ev.preventDefault();
            openCompendiumBrowser("poison", this.actor);
        });


        /*
            Browse for Magic Gear
        */
        html.find('.staff-browse').click(ev => {
            ev.preventDefault();
            openCompendiumBrowser("staff", this.actor);
        });

        html.find('.wand-browse').click(ev => {
            ev.preventDefault();
            openCompendiumBrowser("wand", this.actor);
        });

        html.find('.comm-browse').click(ev => {
            ev.preventDefault();
            openCompendiumBrowser("communication", this.actor);
        });

        html.find('.container-browse').click(ev => {
            ev.preventDefault();
            openCompendiumBrowser("containment", this.actor);
        });

        html.find('.gate-browse').click(ev => {
            ev.preventDefault();
            openCompendiumBrowser("dimensional gate", this.actor);
        });

        html.find('.dream-browse').click(ev => {
            ev.preventDefault();
            openCompendiumBrowser("dream", this.actor);
        });

        /*
        Browse for Mundane Gear
        */
        html.find('.medical-browse').click(ev => {
            ev.preventDefault();
            openCompendiumBrowser("medical", this.actor);
        });

        html.find('.biological-browse').click(ev => {
            ev.preventDefault();
            openCompendiumBrowser("biological", this.actor);
        });

        html.find('.travel-browse').click(ev => {
            ev.preventDefault();
            openCompendiumBrowser("travel", this.actor);
        });

        html.find('.musical-browse').click(ev => {
            ev.preventDefault();
            openCompendiumBrowser("musical", this.actor);
        });

        /*
        Browse for Companions & Ridden
        */
        html.find('.mount-browse').click(ev => {
            ev.preventDefault();
            openCompendiumBrowser("mount", this.actor);
        });

        html.find('.fleshcraft-browse').click(ev => {
            ev.preventDefault();
            openCompendiumBrowser("fleshcraft", this.actor);
        });

        html.find('.vehicle-browse').click(ev => {
            ev.preventDefault();
            openCompendiumBrowser("vehicle", this.actor);
        });



        // Add custom skill creation buttons
        html.find('.add-custom-craft').click(async ev => {
            ev.preventDefault();
            await showCustomSkillDialog(this.actor);
            this.render(false);
        });

        html.find('.add-custom-lore').click(async ev => {
            ev.preventDefault();
            await createCustomSkill(this.actor, "lore", await getCustomSkillSubtype("Lore", "e.g., Anthropology, History"), "learned");
            this.render(false);
        });

        html.find('.add-custom-perform').click(async ev => {
            ev.preventDefault();
            await createCustomSkill(this.actor, "perform", await getCustomSkillSubtype("Perform", "e.g., Singing, Dancing"), "learned");
            this.render(false);
        });

        // Add universal custom skill button
        html.find('.add-custom-skill').click(async ev => {
            ev.preventDefault();
            await showCustomSkillDialog(this.actor);
            this.render(false);
        });

        // Handle spell filtering
        html.find('.spell-school-filter').change(ev => {
            const school = ev.currentTarget.value;

            if (school === 'all') {
                html.find('.spell-wrapper').show();
            } else {
                html.find('.spell-wrapper').hide();
                html.find(`.spell-wrapper .spell-item[data-school="${school}"]`).parents('.spell-wrapper').show();
            }
        });

        html.find('.spell-search').on('input', ev => {
            const searchTerm = ev.currentTarget.value.toLowerCase();

            if (searchTerm === '') {
                html.find('.spell-wrapper').show();
            } else {
                html.find('.spell-wrapper').each(function () {
                    const spellName = $(this).find('.spell-name').text().toLowerCase();
                    const spellDesc = $(this).find('.spell-description-content').text().toLowerCase();

                    if (spellName.includes(searchTerm) || spellDesc.includes(searchTerm)) {
                        $(this).show();
                    } else {
                        $(this).hide();
                    }
                });
            }
        });

        html.find('.add-family-member').click(this._onAddFamilyMember.bind(this));
        html.find('.remove-family-member').click(this._onRemoveFamilyMember.bind(this));

        this._initializeFacingDropdown(html);
        this._updateFacingDirectly(html);
        this._setupArmorResetListeners(html);

        // Initialize tooltips
        this._initializeDataTooltips(html);

        if (this.actor.isOwner) {
            html.find('.initialize-skills').click(async ev => {
                ev.preventDefault();
                await initializeDefaultSkills(this.actor);
                this.render(false);
            });
        }

        /**
        * Helper function to get subtype for custom skills
        */
        async function getCustomSkillSubtype(skillType, placeholder) {
            return new Promise((resolve) => {
                const dialog = new Dialog({
                    title: `Add ${skillType} Skill`,
                    content: `
                <form>
                    <div class="form-group">
                        <label>${skillType} Type:</label>
                        <input type="text" id="subtype-input" placeholder="${placeholder}" />
                    </div>
                </form>
            `,
                    buttons: {
                        create: {
                            icon: '<i class="fas fa-plus"></i>',
                            label: "Create",
                            callback: html => {
                                const subtype = html.find('#subtype-input').val().trim();
                                resolve(subtype || null);
                            }
                        },
                        cancel: {
                            icon: '<i class="fas fa-times"></i>',
                            label: "Cancel",
                            callback: () => resolve(null)
                        }
                    },
                    default: "create",
                    close: () => resolve(null)
                });
                dialog.render(true);
            });
        }

        // Auto-update overland movement when base movement changes
        html.find('input[name^="system.movement."]').change(async (ev) => {
            const input = ev.currentTarget;
            const fieldName = input.name;
            const value = parseInt(input.value) || 0;

            CONFIG.debug.thefade && console.debug(`Movement field changed: ${fieldName} = ${value}`);

            // Determine which overland field to update - FIXED TO MATCH HTML
            let overlandField = '';
            if (fieldName === 'system.movement.land') {
                overlandField = 'system.overland-movement.landOverland';
            } else if (fieldName === 'system.movement.fly') {
                overlandField = 'system.overland-movement.flyOverland';
            } else if (fieldName === 'system.movement.swim') {
                overlandField = 'system.overland-movement.swimOverland';
            } else if (fieldName === 'system.movement.climb') {
                overlandField = 'system.overland-movement.climbOverland';
            } else if (fieldName === 'system.movement.burrow') {
                overlandField = 'system.overland-movement.burrowOverland';
            }

            if (overlandField) {
                const overlandValue = value * 6;
                CONFIG.debug.thefade && console.debug(`Updating ${overlandField} to ${overlandValue}`);

                // Update both the movement field and corresponding overland field
                const updateData = {};
                updateData[fieldName] = value;
                updateData[overlandField] = overlandValue;

                await this.actor.update(updateData);
                CONFIG.debug.thefade && console.debug(`Updated successfully`);
            }
        });

        this._restoreTabState(html);
    }

    _onAddFamilyMember(event) {
        event.preventDefault();
        const familyType = event.currentTarget.dataset.familyType;
        const current = this.actor.system.family[familyType] || [];
        const updated = [...current, { name: "", sex: "", alive: false }];
        this.actor.update({ [`system.family.${familyType}`]: updated });
    }

    _onRemoveFamilyMember(event) {
        event.preventDefault();
        const familyType = event.currentTarget.dataset.familyType;
        const index = parseInt(event.currentTarget.dataset.index);
        const current = this.actor.system.family[familyType] || [];
        const updated = current.filter((_, i) => i !== index);
        this.actor.update({ [`system.family.${familyType}`]: updated });
    }

    async _onRulesItemCreate(event) {
        event.preventDefault();
        const type = event.currentTarget.dataset.type;
        if (!["mutation", "heritage", "downtime"].includes(type)) return;
        const names = { mutation:"New Mutation", heritage:"New Heritage", downtime:"New Downtime Activity" };
        const [item] = await this.actor.createEmbeddedDocuments("Item", [{ name:names[type], type }]);
        item?.sheet?.render(true);
    }

    _onRulesItemEdit(event) {
        event.preventDefault();
        const itemId = event.currentTarget.closest("[data-item-id]")?.dataset.itemId;
        this.actor.items.get(itemId)?.sheet.render(true);
    }

    async _onRulesItemDelete(event) {
        event.preventDefault();
        const itemId = event.currentTarget.closest("[data-item-id]")?.dataset.itemId;
        const item = this.actor.items.get(itemId);
        if (!item) return;
        const confirmed = await Dialog.confirm({ title:`Delete ${item.name}`, content:`<p>Delete <strong>${item.name}</strong>?</p>` });
        if (confirmed) await item.delete();
    }

    async _onMutationRoll(event) {
        event.preventDefault();
        const tools = event.currentTarget.closest(".mutation-tools");
        const severity = tools?.querySelector('[name="mutation-roll-severity"]')?.value || "minor";
        try {
            const rolled = await rollMutation(severity);
            const [item] = await this.actor.createEmbeddedDocuments("Item", [{
                name: rolled.result.name,
                type: "mutation",
                img: "icons/svg/biohazard.svg",
                system: {
                    severity,
                    rollRange: rolled.result.roll,
                    effect: rolled.result.description,
                    description: rolled.result.description,
                    source: `Heirs to Rangar, p. ${rolled.result.sourcePage}`
                },
                flags: { thefade:{ mutationTableId:rolled.result.id, mutationRoll:rolled.roll } }
            }]);
            await ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor:this.actor }),
                content:`<div class="thefade mutation-chat"><h3>${this.actor.name}: ${rolled.label} Mutation (${rolled.roll})</h3><p><strong>${rolled.result.name}</strong></p><p>${rolled.result.description}</p><p class="muted">Added to the character.</p></div>`
            });
            item?.sheet?.render(false);
        } catch (error) {
            console.error("The Fade | Mutation roll failed", error);
            ui.notifications.error(error.message);
        }
    }

    async _onCalculateHeritage(event) {
        event.preventDefault();
        const builder = event.currentTarget.closest(".heritage-builder");
        const motherType = builder?.querySelector('[name="system.heritage.motherType"]')?.value;
        const fatherType = builder?.querySelector('[name="system.heritage.fatherType"]')?.value;
        if (!motherType || !fatherType) return ui.notifications.warn("Choose both parental creature types.");
        const form = builder?.closest("form");
        const isXenochild = form?.querySelector('[name="system.personalDetails.xenochild"]')?.checked
            ?? !!this.actor.system.personalDetails?.xenochild;
        const outcome = isXenochild
            ? getBestCrossbreedOutcome(motherType, fatherType)
            : getCrossbreedOutcome(motherType, fatherType);
        const checked = name => !!builder?.querySelector(`[name="system.heritage.xenochildModifiers.${name}"]`)?.checked;
        const xenochildModifiers = {
            designerSculpting: checked("designerSculpting"),
            extradimensionalParentage: checked("extradimensionalParentage"),
            dragonParent: checked("dragonParent"),
            faeParent: checked("faeParent"),
            undeadDNA: checked("undeadDNA"),
            additionalParents: Math.max(0, Math.floor(Number(builder?.querySelector('[name="system.heritage.xenochildModifiers.additionalParents"]')?.value) || 0))
        };
        const xenochild = calculateXenochildRolls(outcome.code, xenochildModifiers);
        await this.actor.update({
            "system.heritage.motherType": motherType,
            "system.heritage.fatherType": fatherType,
            "system.heritage.outcome": outcome.key,
            "system.heritage.outcomeLabel": outcome.label,
            "system.heritage.characteristicChanges": outcome.characteristicChanges,
            "system.heritage.standardMutationRolls": outcome.standardMutationRolls,
            "system.heritage.isXenochild": isXenochild,
            "system.heritage.xenochildModifiers": xenochildModifiers,
            "system.heritage.xenochildRolls": isXenochild ? xenochild.total : 0
        });
        const details = isXenochild
            ? `${xenochild.total} Xenochild mutation roll(s) (${xenochild.base} base${xenochild.bonus ? ` + ${xenochild.bonus} situational` : ""}); freely mix parental Characteristics.`
            : `${outcome.characteristicChanges} characteristic change(s); natural mutation rolls: ${outcome.standardMutationRolls}.`;
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor:this.actor }),
            content:`<div class="thefade heritage-chat"><h3>${this.actor.name}: Crossbreed Result</h3><p><strong>${outcome.label}</strong> - ${details}</p></div>`
        });
    }

    async _onAwardFate(event) {
        event.preventDefault();
        if (!game.user?.isGM) return ui.notifications.warn("Only the GM can award Fate Points.");
        const amount = Math.max(1, Number(event.currentTarget.dataset.amount) || 1);
        const current = Math.max(0, Number(this.actor.system.fate?.points) || 0);
        await this.actor.update({ "system.fate.points":current + amount });
        await ChatMessage.create({ speaker:ChatMessage.getSpeaker({ actor:this.actor }), content:`<p><strong>${this.actor.name}</strong> gains ${amount} Fate Point${amount === 1 ? "" : "s"}.</p>` });
    }

    async _onSpendFate(event) {
        event.preventDefault();
        const cost = Math.max(1, Number(event.currentTarget.dataset.cost) || 1);
        const current = Math.max(0, Number(this.actor.system.fate?.points) || 0);
        if (current < cost) return ui.notifications.warn(`This use costs ${cost} Fate Points.`);
        const label = event.currentTarget.dataset.label || "Fate Point benefit";
        const effect = event.currentTarget.dataset.effect || "";
        await this.actor.update({ "system.fate.points":current - cost });
        await ChatMessage.create({
            speaker:ChatMessage.getSpeaker({ actor:this.actor }),
            content:`<div class="thefade fate-chat"><h3>${this.actor.name} spends ${cost} Fate Point${cost === 1 ? "" : "s"}</h3><p><strong>${label}:</strong> ${effect}</p></div>`
        });
    }

    async _onDowntimeProgress(event) {
        event.preventDefault();
        const itemId = event.currentTarget.closest("[data-item-id]")?.dataset.itemId;
        const item = this.actor.items.get(itemId);
        if (!item || item.type !== "downtime") return;
        const amount = Number(event.currentTarget.dataset.amount) || 1;
        const target = Math.max(1, Number(item.system.target) || 1);
        const progress = Math.max(0, Number(item.system.progress) || 0) + amount;
        const completed = progress >= target;
        await item.update({ "system.progress":progress, ...(completed ? { "system.status":"completed" } : { "system.status":"active" }) });
        if (completed) {
            await ChatMessage.create({ speaker:ChatMessage.getSpeaker({ actor:this.actor }), content:`<p><strong>${this.actor.name}</strong> completes downtime activity <strong>${item.name}</strong>. ${item.system.benefit || ""}</p>` });
        }
    }

    _onToggleTool(event) {
        event.preventDefault();
        const toolSection = $(event.currentTarget).closest('.header-tool');
        const isCollapsed = toolSection.attr('data-collapsed') === 'true';
        toolSection.attr('data-collapsed', !isCollapsed);
        $(event.currentTarget).attr('aria-expanded', String(isCollapsed));
    }

    /**
     * Add client-side filters for the two densest character-sheet tabs.
     * Filtering never updates actor data and remains useful on read-only sheets.
     */
    _activateSheetFilters(html) {
        const normalize = value => String(value || "").trim().toLocaleLowerCase();

        const skillsInput = html.find('.skills-filter');
        const applySkillFilter = () => {
            const query = normalize(skillsInput.val());
            let matchCount = 0;

            html.find('.skill-category').each((_, categoryElement) => {
                const category = $(categoryElement);
                let categoryMatches = 0;

                category.find('.skill-entry').each((__, rowElement) => {
                    const row = $(rowElement);
                    const matches = !query || normalize(row.text()).includes(query);
                    row.toggleClass('filter-match', matches).toggle(matches);
                    if (matches) {
                        categoryMatches += 1;
                        matchCount += 1;
                    }
                });

                category.toggle(!query || categoryMatches > 0);
                category.find('.skills-column-header').each((__, headerElement) => {
                    const header = $(headerElement);
                    header.toggle(!query || header.next('.skills-list').find('.skill-entry.filter-match').length > 0);
                });

                category.find('details.untrained-skills').each((__, detailsElement) => {
                    const details = $(detailsElement);
                    if (query && details.find('.skill-entry.filter-match').length > 0) {
                        detailsElement.dataset.filterForced = "true";
                        details.prop('open', true);
                    } else if (!query) {
                        detailsElement.dataset.filterForced = "true";
                        details.prop('open', this._getSheetSectionOpenState(detailsElement.dataset.sectionKey, false));
                        setTimeout(() => delete detailsElement.dataset.filterForced, 0);
                    }
                });
            });

            html.find('.skills-filter-empty').prop('hidden', !query || matchCount > 0);
            html.find('.skills-filter-bar .sheet-filter-count').text(query ? `${matchCount} found` : "");
            html.find('.skills-filter-bar .sheet-filter-clear').toggleClass('is-visible', !!query);
        };

        skillsInput.on('input', applySkillFilter);
        html.find('.skills-filter-bar .sheet-filter-clear').on('click', event => {
            event.preventDefault();
            skillsInput.val('').trigger('input').trigger('focus');
        });

        const inventoryInput = html.find('.inventory-filter');
        const applyInventoryFilter = () => {
            const query = normalize(inventoryInput.val());
            let matchCount = 0;

            html.find('.inventory-tabs .item[data-item-id]').each((_, rowElement) => {
                const row = $(rowElement);
                const matches = !query || normalize(row.text()).includes(query);
                row.toggleClass('filter-match', matches).toggle(matches);
                if (matches) matchCount += 1;
            });

            html.find('.inventory-tabs > .tab-content').each((_, panelElement) => {
                const panel = $(panelElement);
                const hasMatch = panel.find('.item[data-item-id].filter-match').length > 0;
                const tabName = panelElement.id?.replace(/-tab$/, '');
                html.find(`.inventory-tabs > .tab-nav .tab-button[data-tab="${tabName}"]`)
                    .toggleClass('filter-no-match', !!query && !hasMatch);

                panel.find('.subtab-content').each((__, subpanelElement) => {
                    const subpanel = $(subpanelElement);
                    const subHasMatch = subpanel.find('.item[data-item-id].filter-match').length > 0;
                    const subtabName = subpanelElement.id?.replace(/-subtab$/, '');
                    panel.find(`.subtab-button[data-subtab="${subtabName}"]`)
                        .toggleClass('filter-no-match', !!query && !subHasMatch);
                });
            });

            if (query && matchCount > 0) {
                const activePanel = html.find('.inventory-tabs > .tab-content.active');
                if (!activePanel.find('.item[data-item-id].filter-match').length) {
                    html.find('.inventory-tabs > .tab-nav .tab-button').not('.filter-no-match').first().trigger('click');
                }

                const currentPanel = html.find('.inventory-tabs > .tab-content.active');
                const currentSubpanel = currentPanel.find('.subtab-content.active');
                if (currentSubpanel.length && !currentSubpanel.find('.item[data-item-id].filter-match').length) {
                    currentPanel.find('.subtab-button').not('.filter-no-match').first().trigger('click');
                }

                const firstVisibleMatch = html
                    .find('.inventory-tabs > .tab-content.active .item[data-item-id].filter-match')
                    .first()[0];
                firstVisibleMatch?.scrollIntoView({ block: "nearest" });
            }

            html.find('.inventory-filter-empty').prop('hidden', !query || matchCount > 0);
            html.find('.inventory-filter-bar .sheet-filter-count').text(query ? `${matchCount} found` : "");
            html.find('.inventory-filter-bar .sheet-filter-clear').toggleClass('is-visible', !!query);
        };

        inventoryInput.on('input', applyInventoryFilter);
        html.find('.inventory-filter-bar .sheet-filter-clear').on('click', event => {
            event.preventDefault();
            inventoryInput.val('').trigger('input').trigger('focus');
        });
    }

    /**
    * Activate inventory-specific listeners
    * @param {HTMLElement} html - Sheet HTML element
    */
    _activateInventoryListeners(html) {
        // Safety check to ensure html is valid
        if (!html || !html.length) {
            console.error("Invalid HTML element passed to _activateInventoryListeners");
            return;
        }

        // Equip Items - handle both armor and magic items
        html.find('.item-equip').click(async (event) => {
            event.preventDefault();

            const button = $(event.currentTarget);
            const itemElement = button.closest('.item, .magic-item, .armor-item');

            if (!itemElement.length) {
                console.error("Could not find item element");
                ui.notifications.error("Could not find item to equip");
                return;
            }

            const itemId = itemElement.data('item-id') || itemElement.attr('data-item-id');

            if (!itemId) {
                console.error("No item ID found");
                ui.notifications.error("Could not identify item to equip");
                return;
            }

            const item = this.actor.items.get(itemId);
            if (!item) {
                console.error("Item not found:", itemId);
                ui.notifications.error("Item not found in character");
                return;
            }

            // Handle different item types
            if (item.type === 'armor') {
                // Check for armor conflicts based on location
                const location = item.system.location;
                const existingArmor = this.actor.items.filter(i =>
                    i.type === 'armor' &&
                    i.system.equipped === true &&
                    i.system.location === location &&
                    i.id !== item.id
                );

                // Allow stacking if item has "+" or different name
                const canStack = location.includes('+') ||
                    !existingArmor.some(existing => existing.name === item.name);

                if (!canStack && existingArmor.length > 0) {
                    ui.notifications.warn(`${location} slot conflict with existing armor.`);
                    return;
                }

            } else if (item.type === 'magicitem') {
                const slotRule = game.settings?.get("thefade", "itemPowerSlotRule") || "standard";
                const result = canEquipItemPower(
                    this.actor.items.filter(existing => existing.type === "magicitem"),
                    item,
                    slotRule
                );
                if (!result.allowed) {
                    ui.notifications.warn(result.reason);
                    return;
                }
            }

            try {
                await item.update({ 'system.equipped': true });
                ui.notifications.info(`${item.name} equipped.`);
                this.render(false);
            } catch (error) {
                console.error("Error equipping item:", error);
                ui.notifications.error("Failed to equip item");
            }
        });

        // Unequip Items - handle both old and new HTML structures
        html.find('.item-unequip').click(async (event) => {
            event.preventDefault();

            const button = $(event.currentTarget);

            // Try multiple selectors for different HTML structures
            let equippedItem = button.closest('.equipped-item');
            if (!equippedItem.length) {
                equippedItem = button.closest('.equipped-armor-item');
            }
            if (!equippedItem.length) {
                equippedItem = button.closest('[data-item-id]');
            }

            if (!equippedItem.length) {
                console.error("Could not find equipped item element");
                ui.notifications.error("Could not find item to unequip");
                return;
            }

            const itemId = equippedItem.data('item-id') || equippedItem.attr('data-item-id');

            if (!itemId) {
                console.error("No item ID found for unequip");
                ui.notifications.error("Could not identify item to unequip");
                return;
            }

            const item = this.actor.items.get(itemId);
            if (!item) {
                console.error("Item not found for unequip:", itemId);
                ui.notifications.error("Item not found");
                return;
            }

            try {
                await item.update({ 'system.equipped': false });
                ui.notifications.info(`${item.name} unequipped.`);
                this.render(false);
            } catch (error) {
                console.error("Error unequipping item:", error);
                ui.notifications.error("Failed to unequip item");
            }
        });

        // Attunement checkbox
        html.find('.attunement-checkbox').change(async (event) => {
            event.preventDefault();
            const attunementRule = game.settings?.get("thefade", "itemPowerAttunementRule") || "standard";
            if (isAttunementRemoved(attunementRule)) return;
            const checkbox = $(event.currentTarget);
            const itemId = checkbox.data('item-id') || checkbox.attr('data-item-id');
            const isAttuned = event.currentTarget.checked;

            if (!itemId) {
                console.error("No item ID found for attunement");
                return;
            }

            const item = this.actor.items.get(itemId);
            if (!item) {
                console.error("Item not found for attunement:", itemId);
                return;
            }

            // Check attunement limits
            if (isAttuned) {
                const currentlyAttuned = countAttunements([...this.actor.items], attunementRule);

                const actorLevel = this.actor.system.level || 1;
                const soulValue = Number(this.actor.system.attributes?.soul?.total ?? this.actor.system.attributes?.soul?.value ?? 1);
                const maxAllowed = Math.max(0, Math.floor(actorLevel / 4) + soulValue);

                if (currentlyAttuned >= maxAllowed) {
                    ui.notifications.warn(`Cannot attune to more items. Current: ${currentlyAttuned}, Max: ${maxAllowed}`);
                    event.currentTarget.checked = false;
                    return;
                }
            }

            try {
                await item.update({ 'system.attunement': isAttuned });
                ui.notifications.info(`${item.name} ${isAttuned ? 'attuned' : 'no longer attuned'}.`);
            } catch (error) {
                console.error("Error updating attunement:", error);
                ui.notifications.error("Failed to update attunement");
            }
        });

        // Stats protection table: reduce AP using the active protection order.
        html.find('.reduce-protection-ap').click(async (event) => {
            event.preventDefault();
            const location = $(event.currentTarget).data('location');
            const pools = armorProtectionPools(this.actor, location).filter(pool => pool.current > 0);
            if (!pools.length) {
                ui.notifications.warn(`${location} Armored Protection is already at 0`);
                return;
            }

            const cascades = this.actor.system.naturalDeflection?.[location]?.stacks === true;
            const maxReduction = cascades
                ? pools.reduce((total, pool) => total + pool.current, 0)
                : Math.max(...pools.map(pool => pool.current));
            const amount = await this._getReductionAmount(
                `Reduce ${location} Armored Protection`,
                cascades
                    ? `Current AP: ${pools.reduce((total, pool) => total + pool.current, 0)}. Stacking is on, so reduction can cascade between armor pieces.`
                    : `Highest current AP pool: ${maxReduction}. Stacking is off, so reduction stays on that one armor piece.`,
                maxReduction
            );
            if (amount === null) return;

            const reduced = await this._reduceArmorProtection(location, amount);
            ui.notifications.info(`${location} Armored Protection reduced by ${reduced}`);
        });

        // Stats protection table: refresh all AP pools for this location.
        html.find('.reset-protection-ap').click(async (event) => {
            event.preventDefault();
            const location = $(event.currentTarget).data('location');
            const resetCount = await this._resetArmorProtection(location);
            if (resetCount) ui.notifications.info(`${location} Armored Protection refreshed`);
        });

        // Armor AP Reduction with popup
        html.find('.reduce-armor-ap').click(async (event) => {
            event.preventDefault();
            const button = $(event.currentTarget);
            const itemId = button.data('item-id');
            const item = this.actor.items.get(itemId);

            if (!item) {
                ui.notifications.error("Armor item not found");
                return;
            }

            const currentAP = item.system.currentAP || 0;
            if (currentAP <= 0) {
                ui.notifications.warn(`${item.name} already has 0 AP`);
                return;
            }

            // Create reduction dialog (display effective max including strengthening)
            const effMaxAP = (Number(item.system.ap) || 0) + (Number(item.system.apIncrease) || 0);
            const amount = await this._getReductionAmount(
                `Reduce ${item.name} AP`,
                `Current AP: ${currentAP}/${effMaxAP}`,
                currentAP
            );

            if (amount === null) return; // User cancelled

            const newAP = Math.max(0, currentAP - amount);
            await item.update({ 'system.currentAP': newAP });
            ui.notifications.info(`${item.name} AP reduced by ${amount} to ${newAP}`);
            this.render(false);
        });

        // Armor AP Reset
        html.find('.reset-armor-ap').click(async (event) => {
            event.preventDefault();
            const button = $(event.currentTarget);
            const itemId = button.data('item-id');
            const item = this.actor.items.get(itemId);

            if (!item) {
                ui.notifications.error("Armor item not found");
                return;
            }

            const maxAP = (Number(item.system.ap) || 0) + (Number(item.system.apIncrease) || 0);
            await item.update({ 'system.currentAP': maxAP });
            ui.notifications.info(`${item.name} AP reset to ${maxAP}`);
            this.render(false);
        });

        // Reset Derived AP
        html.find('.reset-derived-ap').click(async (event) => {
            event.preventDefault();
            const button = $(event.currentTarget);
            const itemId = button.data('item-id');
            const location = button.data('location');

            if (!itemId || !location) {
                ui.notifications.error("Item ID or location not specified");
                return;
            }

            const item = this.actor.items.get(itemId);
            if (!item) {
                ui.notifications.error("Armor item not found");
                return;
            }

            // Determine which derived AP to reset based on location
            const derivedAPProperty = location.includes('left') ? 'derivedLeftAP' : 'derivedRightAP';
            const maxAP = (Number(item.system.ap) || 0) + (Number(item.system.apIncrease) || 0);

            await item.update({
                [`system.${derivedAPProperty}`]: maxAP
            });
            ui.notifications.info(`${item.name} derived AP reset to ${maxAP}`);
        });

        // Natural Deflection Reduction with popup
        html.find('.reduce-nd').click(async (event) => {
            event.preventDefault();
            const button = $(event.currentTarget);
            const location = button.data('location');

            if (!location) {
                ui.notifications.error("Location not specified");
                return;
            }

            const ndData = this.actor.system.naturalDeflection?.[location];
            if (!ndData) {
                ui.notifications.error("Natural deflection data not found");
                return;
            }

            const currentND = ndData.current || 0;
            if (currentND <= 0) {
                ui.notifications.warn(`${location} Natural Deflection already at 0`);
                return;
            }

            const amount = await this._getReductionAmount(
                `Reduce ${location} Natural Deflection`,
                `Current ND: ${currentND}/${ndData.max}`,
                currentND
            );

            if (amount === null) return; // User cancelled

            const newND = Math.max(0, currentND - amount);
            await this.actor.update({
                [`system.naturalDeflection.${location}.current`]: newND
            });
            ui.notifications.info(`${location} Natural Deflection reduced by ${amount} to ${newND}`);
        });

        // Natural Deflection Reset
        html.find('.reset-nd').click(async (event) => {
            event.preventDefault();
            const button = $(event.currentTarget);
            const location = button.data('location');

            if (!location) {
                ui.notifications.error("Location not specified");
                return;
            }

            const ndData = this.actor.system.naturalDeflection?.[location];
            if (!ndData) {
                ui.notifications.error("Natural deflection data not found");
                return;
            }

            const maxND = ndData.max || 0;
            await this.actor.update({
                [`system.naturalDeflection.${location}.current`]: maxND
            });
            ui.notifications.info(`${location} Natural Deflection reset to ${maxND}`);
        });

        // Derived AP Reduction with popup
        html.find('.reduce-derived-ap').click(async (event) => {
            event.preventDefault();
            const button = $(event.currentTarget);
            const itemId = button.data('item-id');
            const location = button.data('location');

            if (!itemId || !location) {
                ui.notifications.error("Item ID or location not specified");
                return;
            }

            const item = this.actor.items.get(itemId);
            if (!item) {
                ui.notifications.error("Armor item not found");
                return;
            }

            // Determine which derived AP to use based on location
            const derivedAPProperty = location.includes('left') ? 'derivedLeftAP' : 'derivedRightAP';

            // Initialize derived AP if it doesn't exist (include strengthening bonus)
            const effMaxAP = (Number(item.system.ap) || 0) + (Number(item.system.apIncrease) || 0);
            let currentDerived = item.system[derivedAPProperty];
            if (currentDerived === undefined || currentDerived === null) {
                currentDerived = effMaxAP;
                // Initialize the property
                await item.update({
                    [`system.${derivedAPProperty}`]: currentDerived
                });
            }

            if (currentDerived <= 0) {
                ui.notifications.warn(`${item.name} ${location} derived AP already at 0`);
                return;
            }

            const amount = await this._getReductionAmount(
                `Reduce ${item.name} Derived AP (${location})`,
                `Current Derived AP: ${currentDerived}/${effMaxAP}`,
                currentDerived
            );

            if (amount === null) return; // User cancelled

            const newDerived = Math.max(0, currentDerived - amount);
            await item.update({
                [`system.${derivedAPProperty}`]: newDerived
            });
            ui.notifications.info(`${item.name} derived AP reduced by ${amount} to ${newDerived}`);
        });

        // Natural Deflection inputs
        html.find('input[name^="system.naturalDeflection"]').change(async (event) => {
            event.stopImmediatePropagation(); // Prevent Foundry's auto-handler

            const input = event.currentTarget;
            const fieldName = input.name;
            let value = input.value;

            if (input.type === 'checkbox') {
                value = input.checked;
            } else if (input.dataset.dtype === 'Number') {
                value = Number(value) || 0;
            }

            await this.actor.update({ [fieldName]: value }, { render: false });

            // Force recalculation of armor totals by updating the sheet data
            this._recalculateArmorTotals();
        });

        // Total AP Reduction with popup
        html.find('.reduce-total-ap').click(async (event) => {
            event.preventDefault();
            const button = $(event.currentTarget);
            const location = button.data('location');

            if (!location) {
                ui.notifications.error("Location not specified");
                return;
            }

            // Calculate current total AP
            const armorTotal = this.actor.armorTotals?.[location];
            if (!armorTotal) {
                ui.notifications.error("Armor total data not found");
                return;
            }

            const currentTotal = armorTotal.current || 0;
            if (currentTotal <= 0) {
                ui.notifications.warn(`${location} Total AP already at 0`);
                return;
            }

            const amount = await this._getReductionAmount(
                `Reduce ${location} Total AP`,
                `Current Total: ${currentTotal}/${armorTotal.max}`,
                currentTotal
            );

            if (amount === null) return; // User cancelled

            // Distribute reduction across ND and armor pieces
            const reduced = await this._distributeAPReduction(location, amount);
            ui.notifications.info(`${location} protection reduced by ${reduced}`);
        });

        // Unattune button
        html.find('.unattune-btn').click(async (event) => {
            event.preventDefault();
            const button = $(event.currentTarget);
            const itemId = button.data('item-id');
            const item = this.actor.items.get(itemId);

            if (item) {
                await item.update({ 'system.attunement': false });
                ui.notifications.info(`${item.name} unattuned.`);
                this.render(false);
            }
        });

        // Better unequip button
        html.find('.item-unequip-btn').click(async (event) => {
            event.preventDefault();
            const button = $(event.currentTarget);
            const itemId = button.data('item-id');
            const item = this.actor.items.get(itemId);

            if (item) {
                await item.update({ 'system.equipped': false });
                ui.notifications.info(`${item.name} unequipped.`);
                this.render(false);
            }
        });

        html.find('.dark-item-corruption').click(async event => {
            event.preventDefault();
            const button = $(event.currentTarget);
            const item = this.actor.items.get(button.data('item-id'));
            if (!item) return;
            const period = button.data('period') === 'week' ? 'week' : 'dawn';
            await applyDarkItemCorruption(this.actor, item, { period });
            this.render(false);
        });

        // ============================================================================
        // COMPREHENSIVE ITEM ACTION HANDLERS
        // ============================================================================

        // 1. UNIVERSAL EDIT BUTTON HANDLER
        // This should catch all edit buttons regardless of context
        html.find('.item-edit, .item-edit-btn').click(ev => {
            ev.preventDefault();
            CONFIG.debug.thefade && console.debug("Edit button clicked");

            // Try multiple ways to find the item ID
            const element = $(ev.currentTarget);
            let itemId = element.closest('[data-item-id]').attr('data-item-id') ||
                element.closest('[data-item-id]').data('item-id') ||
                element.closest('.item').attr('data-item-id') ||
                element.closest('.item').data('item-id');

            CONFIG.debug.thefade && console.debug("Found item ID:", itemId);

            if (!itemId) {
                console.error("Could not find item ID for edit button");
                ui.notifications.error("Could not find item to edit");
                return;
            }

            const item = this.actor.items.get(itemId);
            if (!item) {
                console.error("Item not found:", itemId);
                ui.notifications.error("Item not found");
                return;
            }

            CONFIG.debug.thefade && console.debug("Opening item sheet for:", item.name);
            item.sheet.render(true);
        });

        // 2. POISON ACTION HANDLERS
        html.find('.poison-apply').click(async ev => {
            ev.preventDefault();
            const itemId = $(ev.currentTarget).closest('[data-item-id]').attr('data-item-id');
            const item = this.actor.items.get(itemId);

            if (!item) return;

            ui.notifications.info(`Applied ${item.name}! Effects: ${item.system.effect || 'See item description'}`);

            // Reduce quantity by 1
            const currentQuantity = item.system.quantity || 1;
            if (currentQuantity > 1) {
                await item.update({ "system.quantity": currentQuantity - 1 });
            } else {
                // Ask if they want to delete the item
                new Dialog({
                    title: "Use Last Dose",
                    content: `<p>This was the last dose of ${item.name}. Delete the item?</p>`,
                    buttons: {
                        delete: {
                            label: "Delete",
                            callback: () => this.actor.deleteEmbeddedDocuments("Item", [itemId])
                        },
                        keep: {
                            label: "Keep Empty",
                            callback: () => item.update({ "system.quantity": 0 })
                        }
                    },
                    default: "delete"
                }).render(true);
            }
        });

        // 3. BIOLOGICAL ITEM HANDLERS
        html.find('.bio-analyze').click(ev => {
            ev.preventDefault();
            const itemId = $(ev.currentTarget).closest('[data-item-id]').attr('data-item-id');
            const item = this.actor.items.get(itemId);

            if (!item) return;

            ui.notifications.info(`Analyzing ${item.name}... Results: ${item.system.effect || 'Requires laboratory equipment'}`);
        });

        html.find('.bio-harvest').click(async ev => {
            ev.preventDefault();
            const itemId = $(ev.currentTarget).closest('[data-item-id]').attr('data-item-id');
            const item = this.actor.items.get(itemId);

            if (!item) return;

            ui.notifications.info(`Harvesting ${item.name}...`);
            // Could add dice rolling logic here for harvest success
        });

        // 4. MEDICAL ITEM HANDLERS
        html.find('.medical-use').click(async ev => {
            ev.preventDefault();
            const itemId = $(ev.currentTarget).closest('[data-item-id]').attr('data-item-id');
            const item = this.actor.items.get(itemId);

            if (!item) return;

            ui.notifications.info(`Using ${item.name}! Effect: ${item.system.effect || 'See item description'}`);

            // Reduce quantity
            const currentQuantity = item.system.quantity || 1;
            if (currentQuantity > 1) {
                await item.update({ "system.quantity": currentQuantity - 1 });
            }
        });

        // 5. TRAVEL GEAR HANDLERS
        html.find('.travel-use').click(ev => {
            ev.preventDefault();
            const itemId = $(ev.currentTarget).closest('[data-item-id]').attr('data-item-id');
            const item = this.actor.items.get(itemId);

            if (!item) return;

            ui.notifications.info(`Using ${item.name} for travel purposes`);
        });

        // 6. MUSICAL INSTRUMENT HANDLERS
        html.find('.musical-play').click(ev => {
            ev.preventDefault();
            const itemId = $(ev.currentTarget).closest('[data-item-id]').attr('data-item-id');
            const item = this.actor.items.get(itemId);

            if (!item) return;

            ui.notifications.info(`Playing ${item.name}... Make a Perform check!`);
        });

        // 7. STAFF HANDLERS
        html.find('.staff-use').click(async ev => {
            ev.preventDefault();
            const itemId = $(ev.currentTarget).closest('[data-item-id]').attr('data-item-id');
            const item = this.actor.items.get(itemId);

            if (!item) return;

            const usesRemaining = (item.system.usesPerDay || 3) - (item.system.usesToday || 0);

            if (usesRemaining > 0) {
                await item.update({ "system.usesToday": (item.system.usesToday || 0) + 1 });
                ui.notifications.info(`${item.name} activated! Spell: ${item.system.spellName || 'Unknown'}`);
            } else {
                ui.notifications.warn(`${item.name} has no uses remaining today`);
            }
        });

        html.find('.staff-reset').click(async ev => {
            ev.preventDefault();
            const itemId = $(ev.currentTarget).closest('[data-item-id]').attr('data-item-id');
            const item = this.actor.items.get(itemId);

            if (!item) return;

            await item.update({ "system.usesToday": 0 });
            ui.notifications.info(`${item.name} uses reset for a new day`);
        });

        // 8. WAND HANDLERS
        html.find('.wand-use').click(async ev => {
            ev.preventDefault();
            const itemId = $(ev.currentTarget).closest('[data-item-id]').attr('data-item-id');
            const item = this.actor.items.get(itemId);

            if (!item) return;

            const charges = item.system.charges || 0;

            if (charges > 0) {
                await item.update({ "system.charges": charges - 1 });
                ui.notifications.info(`${item.name} activated! Charges remaining: ${charges - 1}`);
            } else {
                ui.notifications.warn(`${item.name} has no charges remaining`);
            }
        });

        // 9. GATE HANDLERS
        html.find('.gate-activate').click(async ev => {
            ev.preventDefault();
            const itemId = $(ev.currentTarget).closest('[data-item-id]').attr('data-item-id');
            const item = this.actor.items.get(itemId);

            if (!item) return;

            const usesRemaining = (item.system.usesPerDay || 1) - (item.system.usesToday || 0);

            if (usesRemaining > 0) {
                await item.update({ "system.usesToday": (item.system.usesToday || 0) + 1 });
                ui.notifications.info(`${item.name} portal opened! Range: ${item.system.range || 'Unknown'}`);
            } else {
                ui.notifications.warn(`${item.name} cannot be used again today`);
            }
        });

        // 10. COMMUNICATION DEVICE HANDLERS
        html.find('.communication-use').click(ev => {
            ev.preventDefault();
            const itemId = $(ev.currentTarget).closest('[data-item-id]').attr('data-item-id');
            const item = this.actor.items.get(itemId);

            if (!item) return;

            // Could open a dialog for entering relay codes, etc.
            ui.notifications.info(`Activating ${item.name}... Range: ${item.system.range || 'Unknown'}`);
        });

        // 11. CONTAINMENT ITEM HANDLERS
        html.find('.containment-open').click(ev => {
            ev.preventDefault();
            const itemId = $(ev.currentTarget).closest('[data-item-id]').attr('data-item-id');
            const item = this.actor.items.get(itemId);

            if (!item) return;

            ui.notifications.info(`Opening ${item.name}... Contents: ${item.system.contents || 'Empty'}`);
        });

        // 12. DREAM HARVESTING HANDLERS
        html.find('.dream-harvest').click(ev => {
            ev.preventDefault();
            const itemId = $(ev.currentTarget).closest('[data-item-id]').attr('data-item-id');
            const item = this.actor.items.get(itemId);

            if (!item) return;

            ui.notifications.info(`Using ${item.name} to harvest dreams... EL: ${item.system.el || 1}`);
        });

        // 13. MOUNT HANDLERS
        html.find('.mount-ride').click(ev => {
            ev.preventDefault();
            const itemId = $(ev.currentTarget).closest('[data-item-id]').attr('data-item-id');
            const item = this.actor.items.get(itemId);

            if (!item) return;

            ui.notifications.info(`Mounting ${item.name}! Movement: ${item.system.movement || 'Unknown'}`);
        });

        // 14. VEHICLE HANDLERS
        html.find('.vehicle-drive').click(ev => {
            ev.preventDefault();
            const itemId = $(ev.currentTarget).closest('[data-item-id]').attr('data-item-id');
            const item = this.actor.items.get(itemId);

            if (!item) return;

            ui.notifications.info(`Piloting ${item.name}! Passengers: ${item.system.passengers || 0}`);
        });

        // 15. FLESHCRAFT HANDLERS
        html.find('.fleshcraft-activate').click(async ev => {
            ev.preventDefault();
            const itemId = $(ev.currentTarget).closest('[data-item-id]').attr('data-item-id');
            const item = this.actor.items.get(itemId);

            if (!item) return;

            const isActive = item.system.active || false;
            await item.update({ "system.active": !isActive });

            if (!isActive) {
                ui.notifications.info(`${item.name} activated! Sanity cost: ${item.system.sanityCost || 0}`);
            } else {
                ui.notifications.info(`${item.name} deactivated`);
            }
        });

        // 16. CLOTHING HANDLERS
        html.find('.clothing-wear').click(async ev => {
            ev.preventDefault();
            const itemId = $(ev.currentTarget).closest('[data-item-id]').attr('data-item-id');
            const item = this.actor.items.get(itemId);

            if (!item) return;

            const isWorn = item.system.equipped || false;
            await item.update({ "system.equipped": !isWorn });

            ui.notifications.info(`${item.name} ${isWorn ? 'removed' : 'worn'}`);
        });

        // 17. POTION CONSUMPTION (if not already handled elsewhere)
        html.find('.potion-drink, .potion-consume').click(async ev => {
            ev.preventDefault();
            const itemId = $(ev.currentTarget).closest('[data-item-id]').attr('data-item-id');
            const item = this.actor.items.get(itemId);

            if (!item) return;

            ui.notifications.info(`${item.name} consumed! Effect: ${item.system.effect || 'See description'}`);

            // Reduce quantity or delete
            const currentQuantity = item.system.quantity || 1;
            if (currentQuantity > 1) {
                await item.update({ "system.quantity": currentQuantity - 1 });
            } else {
                await this.actor.deleteEmbeddedDocuments("Item", [itemId]);
            }
        });

        // 18. DRUG USE HANDLERS
        html.find('.drug-use').click(async ev => {
            ev.preventDefault();
            const itemId = $(ev.currentTarget).closest('[data-item-id]').attr('data-item-id');
            const item = this.actor.items.get(itemId);

            if (!item) return;

            ui.notifications.warn(`Using ${item.name}! Addiction rating: ${item.system.addictionRating || 0}`);

            // Reduce quantity
            const currentQuantity = item.system.quantity || 1;
            if (currentQuantity > 1) {
                await item.update({ "system.quantity": currentQuantity - 1 });
            }
        });

        // 19. GENERIC ITEM USE HANDLER (fallback)
        html.find('.item-use, .item-activate').click(ev => {
            ev.preventDefault();
            const itemId = $(ev.currentTarget).closest('[data-item-id]').attr('data-item-id');
            const item = this.actor.items.get(itemId);

            if (!item) return;

            ui.notifications.info(`Using ${item.name}! ${item.system.effect || 'See item description for effects'}`);
        });


    }

    _preserveExpandedState(html) {
        // Store which defense details are currently expanded
        const expandedStates = {};
        html.find('.defense-checkbox').each(function () {
            const checkbox = $(this);
            expandedStates[checkbox.attr('id')] = checkbox.is(':checked');
        });

        // Store in a property for later restoration
        this._expandedDefenseStates = expandedStates;
    }

    _restoreExpandedState(html) {
        // Restore previously expanded defense details
        if (this._expandedDefenseStates) {
            Object.entries(this._expandedDefenseStates).forEach(([id, isExpanded]) => {
                const checkbox = html.find(`#${id}`);
                const details = checkbox.closest('.defense').find('.defense-details');

                checkbox.prop('checked', isExpanded);
                if (isExpanded) {
                    details.css('max-height', '200px');
                    details.css('padding-top', '10px');
                } else {
                    details.css('max-height', '0');
                    details.css('padding-top', '0');
                }
            });
        }
    }

    /*
    * Initialize data path tooltips for development
    * @param {HTMLElement} html - The rendered HTML
    * @private
    */
    _initializeDataTooltips(html) {
        // Clean up any existing tooltips first
        $('.data-tooltip').remove();

        // Store tooltip reference on the sheet instance
        if (this.activeTooltip) {
            this.activeTooltip.remove();
            this.activeTooltip = null;
        }

        // Handle mouseenter on form elements and display elements
        html.on('mouseenter', 'input, select, textarea, .defense-value input, .total-value, .base-value, .avoid-value, .passive-dodge-value, .passive-parry-value', (event) => {
            const element = event.currentTarget;
            let dataPath = element.name;

            // For elements without name attributes, try to infer from class or context
            if (!dataPath) {
                const classList = element.className;

                if (classList.includes('total-value')) {
                    // Try to determine what total this represents
                    const parent = $(element).closest('.defense');
                    if (parent.find('label').text().includes('Resilience')) {
                        dataPath = 'system.totalResilience';
                    } else if (parent.find('label').text().includes('Avoid')) {
                        dataPath = 'system.totalAvoid';
                    } else if (parent.find('label').text().includes('Grit')) {
                        dataPath = 'system.totalGrit';
                    }
                } else if (classList.includes('avoid-value')) {
                    dataPath = 'system.totalAvoid';
                } else if (classList.includes('passive-dodge-value')) {
                    dataPath = 'system.defenses.passiveDodge';
                } else if (classList.includes('passive-parry-value')) {
                    dataPath = 'system.defenses.passiveParry';
                } else if (classList.includes('base-value')) {
                    const parent = $(element).closest('.defense');
                    if (parent.find('label').text().includes('Resilience')) {
                        dataPath = 'system.defenses.resilience';
                    } else if (parent.find('label').text().includes('Avoid')) {
                        dataPath = 'system.defenses.avoid';
                    } else if (parent.find('label').text().includes('Grit')) {
                        dataPath = 'system.defenses.grit';
                    }
                }
            }

            if (!dataPath) return;

            // Remove any existing tooltip
            this._removeTooltip();

            // Create new tooltip
            this.activeTooltip = $(`<div class="data-tooltip">${dataPath}</div>`);
            $('body').append(this.activeTooltip);

            // Position tooltip
            const rect = element.getBoundingClientRect();
            const tooltipWidth = this.activeTooltip.outerWidth();

            let left = rect.left + (rect.width / 2) - (tooltipWidth / 2);
            let top = rect.top - this.activeTooltip.outerHeight() - 8;

            // Keep tooltip on screen
            if (left < 10) left = 10;
            if (left + tooltipWidth > window.innerWidth - 10) {
                left = window.innerWidth - tooltipWidth - 10;
            }
            if (top < 10) {
                top = rect.bottom + 8;
            }

            this.activeTooltip.css({
                left: left + 'px',
                top: top + 'px'
            });

            // Show tooltip
            setTimeout(() => {
                if (this.activeTooltip) {
                    this.activeTooltip.addClass('show');
                }
            }, 10);
        });

        // Handle mouseleave
        html.on('mouseleave', 'input, select, textarea, .defense-value input, .total-value, .base-value, .avoid-value, .passive-dodge-value, .passive-parry-value', () => {
            this._removeTooltip();
        });
    }

    _initializeExcessPenaltyTooltips(html) {
        let excessTooltip = null;

        // Handle mouseenter on excess penalty displays
        html.on('mouseenter', '.excess-penalty', (event) => {
            const element = event.currentTarget;

            // Remove existing tooltip
            if (excessTooltip) {
                excessTooltip.remove();
                excessTooltip = null;
            }

            // Only show tooltip if the element is visible and has content
            if (!$(element).is(':visible') || !$(element).text().trim()) return;

            // Create new tooltip
            excessTooltip = $('<div class="excess-penalty-tooltip">Bonus dice added to attack rolls against this defense</div>');
            $('body').append(excessTooltip);

            // Position tooltip
            const rect = element.getBoundingClientRect();
            const tooltipWidth = excessTooltip.outerWidth();

            let left = rect.left + (rect.width / 2) - (tooltipWidth / 2);
            let top = rect.top - excessTooltip.outerHeight() - 8;

            // Keep tooltip on screen
            if (left < 10) left = 10;
            if (left + tooltipWidth > window.innerWidth - 10) {
                left = window.innerWidth - tooltipWidth - 10;
            }
            if (top < 10) {
                top = rect.bottom + 8;
            }

            excessTooltip.css({
                left: left + 'px',
                top: top + 'px'
            });

            // Show tooltip
            setTimeout(() => {
                if (excessTooltip) {
                    excessTooltip.addClass('show');
                }
            }, 10);
        });

        // Handle mouseleave
        html.on('mouseleave', '.excess-penalty', () => {
            if (excessTooltip) {
                excessTooltip.removeClass('show');
                setTimeout(() => {
                    if (excessTooltip) {
                        excessTooltip.remove();
                        excessTooltip = null;
                    }
                }, 150);
            }
        });
    }

    _recalculateArmorTotals() {
        try {
            const sheetData = this.getData();

            // Recalculate armor data
            const armorData = this._processArmor(sheetData.actor.armor || [], sheetData.actor);

            // Update the displayed totals in the DOM
            const html = this.element;
            Object.entries(armorData.armorTotals).forEach(([location, totals]) => {
                const currentSpan = html.find(`.armor-slot-container[data-slot="${location}"] .current-total-ap`);
                const maxSpan = html.find(`.armor-slot-container[data-slot="${location}"] .max-total-ap`);

                if (currentSpan.length) currentSpan.text(totals.current);
                if (maxSpan.length) maxSpan.text(totals.max);
            });

            for (const part of sheetData.protectionRows || []) {
                const rows = html.find(`.protection-row[data-protection-location="${part.location}"]`);
                rows.find('.armor-protection-value .protection-current').text(part.armor.current);
                rows.find('.armor-protection-value .protection-max').text(part.armor.max);
                rows.find('.natural-protection-value .protection-current').text(part.natural.current);
                rows.find('.natural-protection-value .protection-max').text(part.natural.max);
                rows.find('.total-protection-value .protection-current').text(part.total.current);
                rows.find('.total-protection-value .protection-max').text(part.total.max);
            }
        } catch (error) {
            console.error("Error recalculating armor totals:", error);
        }
    }

    _removeTooltip() {
        if (this.activeTooltip) {
            this.activeTooltip.removeClass('show');
            setTimeout(() => {
                if (this.activeTooltip) {
                    this.activeTooltip.remove();
                    this.activeTooltip = null;
                }
            }, 150);
        }
    }

    _storeTabState(html) {
        if (!html || !html.length) return;

        // Store main inventory tab
        const activeTab = html.find('.tab-button.active');
        if (activeTab.length) {
            this._activeInventoryTab = activeTab.data('tab') || 'weapons';
        }

        // Store active subtabs for each main tab
        this._activeSubtabs = {};
        html.find('.tab-content').each((index, tabContent) => {
            const $tabContent = $(tabContent);
            const activeSubtab = $tabContent.find('.subtab-button.active');
            if (activeSubtab.length) {
                const tabId = tabContent.id.replace('-tab', '');
                this._activeSubtabs[tabId] = activeSubtab.data('subtab');
            }
        });
    }

    _restoreTabState(html) {
        if (!html || !html.length) return;

        // Restore main inventory tab
        if (this._activeInventoryTab) {
            html.find('.tab-button').removeClass('active');
            html.find('.tab-content').removeClass('active');

            const targetTab = html.find(`.tab-button[data-tab="${this._activeInventoryTab}"]`);
            const targetContent = html.find(`#${this._activeInventoryTab}-tab`);

            if (targetTab.length && targetContent.length) {
                targetTab.addClass('active');
                targetContent.addClass('active');
            }
        }

        // Restore subtabs
        if (this._activeSubtabs) {
            Object.entries(this._activeSubtabs).forEach(([tabId, subtabName]) => {
                const tabContent = html.find(`#${tabId}-tab`);
                if (tabContent.length) {
                    tabContent.find('.subtab-button').removeClass('active');
                    tabContent.find('.subtab-content').removeClass('active');

                    const targetSubtab = tabContent.find(`.subtab-button[data-subtab="${subtabName}"]`);
                    const targetSubcontent = tabContent.find(`#${subtabName}-subtab`);

                    if (targetSubtab.length && targetSubcontent.length) {
                        targetSubtab.addClass('active');
                        targetSubcontent.addClass('active');
                    }
                }
            });
        }
    }


    async close(options = {}) {
        // Clean up tooltips when sheet closes
        this._removeTooltip();
        $('.data-tooltip').remove();

        return super.close(options);
    }




}

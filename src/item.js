// TheFadeItem document class (extracted from thefade.js).
import { DEFAULT_WEAPON, DEFAULT_ARMOR, DEFAULT_SKILL } from './constants.js';
import { isNaturalWeapon } from './weapon-rules.js';
import {
    buildSpellDamageProfile,
    getSpellDamageComponents,
    getSpellSuccessRequirements
} from './spell-rules.js';
import { getDarkMagicItemCorruptionValue, isDarkMagicItem } from './item-power-rules.js';
import { getAlchemicalCraftCost, getAlchemicalDiscipline } from './alchemy-rules.js';

/**
* Base Item class for The Fade system
* Handles item data preparation for all item types
*/
export class TheFadeItem extends Item {
    /**
    * Prepare item data - called automatically by Foundry
    */
    prepareData() {
        super.prepareData();

        // Get the Item's data
        const itemData = this;
        const data = itemData.system;
        const flags = itemData.flags;

        const prepMap = {
            weapon: this._prepareWeaponData,
            armor: this._prepareArmorData,
            skill: this._prepareSkillData,
            path: this._preparePathData,
            monsterpath: this._preparePathData,
            spell: this._prepareSpellData,
            alchemical: this._prepareAlchemicalData,
            species: this._prepareSpeciesData,
            monsterspecies: this._prepareSpeciesData,
            drug: this._prepareDrugData,
            poison: this._preparePoisonData,
            disease: this._prepareDiseaseData,
            biological: this._prepareBiologicalData,
            mount: this._prepareMountData,
            vehicle: this._prepareVehicleData,
            staff: this._prepareMagicToolData,
            wand: this._prepareMagicToolData,
            gate: this._prepareGateData,
            magicitem: this._prepareMagicItemData,
            fleshcraft: this._prepareFleshcraftData,
            talent: this._prepareTalentData,
            trait: this._prepareTraitData,
            precept: this._preparePreceptData,
            mutation: this._prepareRulesData,
            heritage: this._prepareRulesData,
            trap: this._prepareRulesData,
            hazard: this._prepareRulesData,
            downtime: this._prepareRulesData
        };
        const fn = prepMap[itemData.type];
        if (fn) fn.call(this, itemData);
    }

    // --------------------------------------------------------------------
    // ITEM TYPE PREPARATION METHODS
    // --------------------------------------------------------------------

    /**
    * Prepare weapon-specific data
    * @param {Object} itemData - Item data object
    */
    _prepareWeaponData(itemData) {
        const data = itemData.system;

        foundry.utils.mergeObject(data, DEFAULT_WEAPON, {
            enforceTypes: false,
            insertKeys: true,
            overwrite: false
        });

        if (!Array.isArray(data.enchantmentPowers)) data.enchantmentPowers = [];
        if (!Array.isArray(data.modifications)) data.modifications = [];
        if (!Array.isArray(data.damageComponents)) data.damageComponents = [];
        if (!Array.isArray(data.qualityIds)) data.qualityIds = [];

        // In-memory hydration from legacy single damage/damageType. The persisted
        // migration (so user edits write components) happens lazily in the item
        // sheet getData; here we just make sure prepareData/templates always see
        // a usable components array.
        if (data.damageComponents.length === 0 && (Number(data.damage) || 0) > 0) {
            data.damageComponents = [{
                id: "_legacy",
                amount: Number(data.damage) || 0,
                type: data.damageType || "Ut"
            }];
        }

        // Sync legacy damage/damageType from components so existing roll, chat,
        // and TAH paths (which read sys.damage / sys.damageType) keep working
        // unchanged. Total = sum of component amounts; primary type = first.
        if (data.damageComponents.length > 0) {
            data.damage = data.damageComponents.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
            data.damageType = data.damageComponents[0].type || "Ut";
        }

        // Derived: total damage including magical strengthening
        data.effectiveDamage = (Number(data.damage) || 0)
            + (isNaturalWeapon(data) ? 0 : (Number(data.damageIncrease) || 0));
    }

    /**
    * Prepare armor-specific data
    * @param {Object} itemData - Item data object
    */
    _prepareArmorData(itemData) {
        const data = itemData.system;

        foundry.utils.mergeObject(data, DEFAULT_ARMOR, {
            enforceTypes: false,
            insertKeys: true,
            overwrite: false
        });

        if (!Array.isArray(data.enchantmentPowers)) data.enchantmentPowers = [];
        if (!Array.isArray(data.modifications)) data.modifications = [];

        // Derived: total AP including magical strengthening
        data.effectiveAP = (Number(data.ap) || 0) + (Number(data.apIncrease) || 0);

        // Initialize only when the field has never been set (null/undefined).
        // Once damage drops currentAP to 0 it MUST stay at 0 until repaired —
        // re-seeding from max here would silently refill broken armor on every
        // prepareData cycle. New armor gets its starting AP via the
        // preCreateItem hook in thefade.js.
        if (data.currentAP === null || data.currentAP === undefined) {
            data.currentAP = data.ap;
        }
        if ((data.location === "Arms" || data.location === "Legs" || data.location == "Arms+" || data.location == "Legs+")
            && (data.otherLimbAP === null || data.otherLimbAP === undefined)) {
            data.otherLimbAP = data.ap;
        }
    }

    /**
    * Prepare skill-specific data
    * @param {Object} itemData - Item data object
    */
    _prepareSkillData(itemData) {
        const data = itemData.system;

        foundry.utils.mergeObject(data, DEFAULT_SKILL, {
            enforceTypes: false,
            insertKeys: true,
            overwrite: false
        });
    }

    _preparePathData(itemData) {
        const data = itemData.system;
        if (data.tier === undefined || data.tier === null) data.tier = 1;
        if (data.baseHP === undefined || data.baseHP === null) data.baseHP = 0;
        if (!data.skills) data.skills = "";
        if (!data.requirements) data.requirements = "";
        if (!data.abilities || typeof data.abilities !== "object") data.abilities = {};
        if (!Array.isArray(data.pathSkills)) data.pathSkills = [];
        if (itemData.type === "monsterpath") data.isMonsterPath = true;
    }

    /**
    * Prepare spell-specific data
    * @param {Object} itemData - Item data object
    */
    _prepareSpellData(itemData) {
        const data = itemData.system;
        const sourceSystem = itemData._source?.system || {};

        // Initialize spell properties if undefined
        if (!data.school) data.school = "General";
        data.damageComponents = getSpellDamageComponents(data);
        const damageProfile = buildSpellDamageProfile(data);
        data.damage = damageProfile.total || "";
        data.damageType = damageProfile.primaryType;
        if (data.sanityDamage === undefined || data.sanityDamage === null) data.sanityDamage = "";
        if (!Array.isArray(data.statusEffects)) data.statusEffects = [];
        if (!Array.isArray(data.buffEffects)) data.buffEffects = [];
        if (data.recipeCost === undefined || data.recipeCost === null) data.recipeCost = "";
        if (!data.time) data.time = "Instantaneous";
        if (!data.successes) data.successes = 3;
        // Existing Rune spells only had one successes field. Until the new
        // values are explicitly saved, use that legacy requirement for both
        // the Symbology drawing check and the Spellcasting activation check.
        if (data.school === "Runes") {
            const hasStoredSymbology = Object.prototype.hasOwnProperty.call(sourceSystem, "symbologySuccesses");
            const hasStoredSpellcasting = Object.prototype.hasOwnProperty.call(sourceSystem, "spellcastingSuccesses");
            if (!hasStoredSymbology) data.symbologySuccesses = data.successes;
            if (!hasStoredSpellcasting) data.spellcastingSuccesses = data.successes;
            const successRequirements = getSpellSuccessRequirements(data);
            data.symbologySuccesses = successRequirements.symbology;
            data.spellcastingSuccesses = successRequirements.spellcasting;
        }
        if (!data.attack) data.attack = "";
        if (!data.attackEffects || typeof data.attackEffects !== "object") {
            data.attackEffects = { Avoid: "", Resilience: "", Grit: "" };
        }
        if (!data.description) data.description = "";
    }

    /** Prepare an Alchemical Item and its derived crafting labels/cost. */
    _prepareAlchemicalData(itemData) {
        const data = itemData.system;
        if (!data.skill) data.skill = "Chemistry";
        data.dt = Math.max(1, parseInt(data.dt, 10) || 1);
        data.darkMagic = data.darkMagic === true;
        data.discipline = getAlchemicalDiscipline(data);
        data.craftCost = getAlchemicalCraftCost(data);
        data.price = Math.max(0, Number(data.price) || 0);
        data.weight = Math.max(0, Number(data.weight) || 0);
        data.quantity = Math.max(0, Number(data.quantity) || 0);
        if (!data.description) data.description = "";
    }

    /**
    * Prepare species-specific data
    * @param {Object} itemData - Item data object
    */
    _prepareSpeciesData(itemData) {
        const data = itemData.system;

        // Initialize species properties if undefined
        if (!data.baseHP) data.baseHP = 0;
        if (!data.size) data.size = "medium";
        if (!data.creatureType) data.creatureType = "sapient";
        if (!data.creatureSubtype) data.creatureSubtype = "";
        if (!Array.isArray(data.creatureSubtypes)) data.creatureSubtypes = [];
        if (!data.languages) data.languages = "";
        if (!data.description) data.description = "";
        if (!data.speciesAbilities) data.speciesAbilities = {};

        // Initialize ability bonuses
        if (!data.abilityBonuses) {
            data.abilityBonuses = {
                physique: 0,
                finesse: 0,
                mind: 0,
                presence: 0,
                soul: 0
            };
        }

        // Ensure all ability bonuses exist
        Object.keys({ physique: 0, finesse: 0, mind: 0, presence: 0, soul: 0 }).forEach(attr => {
            if (data.abilityBonuses[attr] === undefined) data.abilityBonuses[attr] = 0;
        });

        if (!data.flexibleBonus || typeof data.flexibleBonus !== "object") {
            data.flexibleBonus = { value: 0, selectedAttribute: "" };
        }

        if (!data.movement) {
            data.movement = {
                land: 4,
                fly: 0,
                swim: 0,
                climb: 0,
                burrow: 0
            };
        }

        if (data.movement.climb === undefined) data.movement.climb = 0;
        if (data.movement.burrow === undefined) data.movement.burrow = 0;

        if (itemData.type === "monsterspecies") {
            if (!data.attributeSet || typeof data.attributeSet !== "object") {
                data.attributeSet = { physique: 1, finesse: 1, mind: 1, presence: 1, soul: 1 };
            }
            for (const attr of ["physique", "finesse", "mind", "presence", "soul"]) {
                if (data.attributeSet[attr] === undefined || data.attributeSet[attr] === null) data.attributeSet[attr] = 1;
            }
            if (!data.attributeSpread) data.attributeSpread = "10, 5, 3, 1, 1";
            if (!data.naturalDeflectionTypes || typeof data.naturalDeflectionTypes !== "object") data.naturalDeflectionTypes = {};
            const defaults = {
                fragile: { baseMultiplier: 2, parts: { head: "0.25", body: "1", arms: "0.3333333333", legs: "0.3333333333" } },
                average: { baseMultiplier: 5, parts: { head: "0.3333333333", body: "1", arms: "0.5", legs: "0.5" } },
                tough: { baseMultiplier: 10, parts: { head: "0.5", body: "1", arms: "0.6666666667", legs: "0.6666666667" } }
            };
            foundry.utils.mergeObject(data.naturalDeflectionTypes, defaults, {
                enforceTypes: false,
                insertKeys: true,
                overwrite: false
            });
            if (!Array.isArray(data.standardAttacks)) data.standardAttacks = [];
            data.standardAttacks = data.standardAttacks.map(entry => {
                if (Array.isArray(entry.weapons)) return entry;
                const weapons = [];
                for (const option of [entry.optionA, entry.optionB]) {
                    if (!option?.name) continue;
                    weapons.push({
                        id: foundry.utils.randomID(16),
                        name: option.name,
                        img: "icons/svg/sword.svg",
                        type: "weapon",
                        system: {
                            damage: Number(option.damage) || 0,
                            damageType: option.damageType || "B",
                            critical: 4,
                            handedness: option.type === "natural" ? "Natural Weapon" : "One-Handed",
                            range: "Melee",
                            integrity: 10,
                            qualities: option.qualities || "",
                            qualityIds: [],
                            skill: option.skill || (option.type === "natural" ? "Unarmed" : "Cudgel"),
                            attribute: "physique",
                            weight: option.type === "natural" ? 0 : 1,
                            price: 0,
                            quantity: 1,
                            equipped: true
                        }
                    });
                }
                return {
                    id: entry.id || foundry.utils.randomID(16),
                    mode: entry.mode || "grant",
                    weapons
                };
            });
            if (!data.sizeRules || typeof data.sizeRules !== "object") data.sizeRules = {};
            const sizeKeys = ["miniscule", "diminutive", "tiny", "small", "medium", "large", "massive", "immense", "enormous", "titanic"];
            for (const size of sizeKeys) {
                if (!data.sizeRules[size] || typeof data.sizeRules[size] !== "object") data.sizeRules[size] = {};
                const rule = data.sizeRules[size];
                if (rule.averageEL === undefined || rule.averageEL === null) rule.averageEL = 0;
                if (rule.bonusHP === undefined || rule.bonusHP === null) rule.bonusHP = 0;
                if (!rule.movement || typeof rule.movement !== "object") rule.movement = {};
                if (rule.movement.land === undefined || rule.movement.land === null) rule.movement.land = 0;
                if (!rule.bonuses || typeof rule.bonuses !== "object") rule.bonuses = {};
                if (!rule.caps || typeof rule.caps !== "object") rule.caps = {};
                for (const attr of ["physique", "finesse", "mind", "presence", "soul"]) {
                    if (rule.bonuses[attr] === undefined || rule.bonuses[attr] === null) rule.bonuses[attr] = 0;
                    if (rule.caps[attr] === undefined || rule.caps[attr] === null) rule.caps[attr] = "";
                }
                if (!rule.example) rule.example = "";
            }
        }
    }

    /**
    * Prepare drug-specific data
    * @param {Object} itemData - Item data object
    */
    _prepareDrugData(itemData) {
        const data = itemData.system;

        // Initialize drug properties if undefined
        if (!data.duration) data.duration = "";
        if (!data.addiction) data.addiction = "";
        if (!data.overdose) data.overdose = "";
        if (!data.effect) data.effect = "";
        if (!data.weight) data.weight = 0;
    }

    /**
    * Prepare poison-specific data
    * @param {Object} itemData - Item data object
    */
    _preparePoisonData(itemData) {
        const data = itemData.system;

        // Initialize poison properties if undefined
        if (data.toxicity === undefined || data.toxicity === null) data.toxicity = 0;
        if (!data.poisonType) data.poisonType = "injury";
        if (!data.onset) data.onset = "immediate";
        if (!data.category) data.category = "neurotoxin";
        if (!data.effect) data.effect = "";
        if (!data.weight) data.weight = 0;
    }

    /**
    * Prepare disease-specific data
    * @param {Object} itemData - Item data object
    */
    _prepareDiseaseData(itemData) {
        const data = itemData.system;

        const transmissionKeys = ["airborne", "contact", "fluid", "ingested", "injury"];
        if (!data.transmission || typeof data.transmission !== "object" || Array.isArray(data.transmission)) {
            const prev = data.transmission;
            data.transmission = {};
            for (const k of transmissionKeys) data.transmission[k] = false;
            if (typeof prev === "string" && transmissionKeys.includes(prev)) data.transmission[prev] = true;
            else if (Array.isArray(prev)) for (const k of prev) if (transmissionKeys.includes(k)) data.transmission[k] = true;
        } else {
            for (const k of transmissionKeys) if (data.transmission[k] === undefined) data.transmission[k] = false;
        }
        if (!data.incubation) data.incubation = "";
        if (!data.duration) data.duration = "";
        if (!data.durationType) data.durationType = "temporary";
        if (data.virality === undefined || data.virality === null) data.virality = 0;
        if (data.treatmentDT === undefined || data.treatmentDT === null) data.treatmentDT = 0;
        if (data.requiresVector === undefined) data.requiresVector = false;
        if (data.requiresCure === undefined) data.requiresCure = false;
        if (!data.effect) data.effect = "";
        if (!data.weight) data.weight = 0;

        // Derived: Virality band (Low 4-7D, Moderate 8-11D, High 12D+).
        const v = Number(data.virality) || 0;
        if (v >= 12) data.viralityBand = "High";
        else if (v >= 8) data.viralityBand = "Moderate";
        else if (v >= 4) data.viralityBand = "Low";
        else data.viralityBand = null;
    }

    /**
    * Prepare biological item data
    * @param {Object} itemData - Item data object
    */
    _prepareBiologicalData(itemData) {
        const data = itemData.system;

        // Initialize biological item properties if undefined
        if (!data.hp) data.hp = 0;
        if (!data.energy) data.energy = 0;
        if (!data.effect) data.effect = "";
        if (!data.weight) data.weight = 0;
    }

    /**
    * Prepare mount-specific data
    * @param {Object} itemData - Item data object
    */
    _prepareMountData(itemData) {
        const data = itemData.system;

        // Initialize mount properties if undefined
        if (!data.hp) data.hp = 0;
        if (!data.avoid) data.avoid = 0;
        if (!data.size) data.size = "medium";
        if (!data.movement) data.movement = 4;
        if (!data.carryCapacity) data.carryCapacity = 0;
    }

    /**
    * Prepare vehicle-specific data
    * @param {Object} itemData - Item data object
    */
    _prepareVehicleData(itemData) {
        const data = itemData.system;

        // Initialize vehicle properties if undefined
        if (!data.drivers) data.drivers = 1;
        if (!data.passengers) data.passengers = 0;
        if (!data.movement) data.movement = 0;
        if (!data.overland) data.overland = 0;
        if (!data.cargo) data.cargo = "";
        if (!data.vehicleType) data.vehicleType = "land";
    }

    /**
    * Prepare magic tool data (staff/wand)
    * @param {Object} itemData - Item data object
    */
    _prepareMagicToolData(itemData) {
        const data = itemData.system;

        // Initialize staff/wand properties if undefined
        if (!data.strength) data.strength = 1;
        if (!data.spellName) data.spellName = "";
        if (!data.spellDescription) data.spellDescription = "";
        if (!data.school) data.school = "General";

        if (itemData.type === 'staff') {
            if (!data.usesPerDay) data.usesPerDay = 3;
        } else if (itemData.type === 'wand') {
            if (!data.charges) data.charges = 20;
            if (!data.maxCharges) data.maxCharges = 20;
        }
    }

    /**
    * Prepare gate-specific data
    * @param {Object} itemData - Item data object
    */
    _prepareGateData(itemData) {
        const data = itemData.system;

        // Initialize dimensional gate properties if undefined
        if (!data.range) data.range = "";
        if (!data.duration) data.duration = "";
        if (!data.usesPerDay) data.usesPerDay = "";
    }

    /**
     * Prepare magic item specific data
     * @param {Object} itemData - Item data object
     */
    _prepareMagicItemData(itemData) {
        const data = itemData.system;

        // Initialize Items of Power properties if undefined
        if (!data.slot) data.slot = "head";
        if (!data.overlapMode) data.overlapMode = "overlaps";
        if (!data.effect) data.effect = "";
        if (!data.catalyst) data.catalyst = "";
        if (typeof data.attunement === "undefined") data.attunement = false;
        if (typeof data.darkMagic === "undefined") data.darkMagic = false;
        if (data.corruptionValueOverride === undefined || data.corruptionValueOverride === null) data.corruptionValueOverride = 0;
        if (typeof data.equipped === "undefined") data.equipped = false;
        if (typeof data.hasAura === "undefined") data.hasAura = true;
        if (!data.auraColor) data.auraColor = "dull gray";
        if (typeof data.conflictsArmor === "undefined") data.conflictsArmor = false;
        if (!data.radiationEffect) data.radiationEffect = "";
        if (!data.creationRequirements) data.creationRequirements = "";
        if (!Array.isArray(data.bonuses)) data.bonuses = [];
        if (data.ap === undefined || data.ap === null) data.ap = 0;
        if (data.currentAP === undefined || data.currentAP === null) data.currentAP = 0;
        if (data.apIncrease === undefined || data.apIncrease === null) data.apIncrease = 0;
        if (!data.location) data.location = "Body";
        if (typeof data.isHeavy === "undefined") data.isHeavy = false;
        if (!data.material) data.material = "iron";
        if (typeof data.autoBlock !== "string") data.autoBlock = "";
        if (data.derivedLeftAP === undefined) data.derivedLeftAP = null;
        if (data.derivedRightAP === undefined) data.derivedRightAP = null;

        if (!data.traitGrants || typeof data.traitGrants !== "object") data.traitGrants = {};
        const grants = data.traitGrants;
        if (!grants.abilities || typeof grants.abilities !== "object") grants.abilities = {};
        if (grants.spellResistancePercent === undefined || grants.spellResistancePercent === null) grants.spellResistancePercent = 50;
        if (!grants.resistances || typeof grants.resistances !== "object") grants.resistances = {};
        if (!grants.immunities || typeof grants.immunities !== "object") grants.immunities = {};
        if (!grants.immunities.damageTypes || typeof grants.immunities.damageTypes !== "object") grants.immunities.damageTypes = {};
        if (!grants.immunities.statuses || typeof grants.immunities.statuses !== "object") grants.immunities.statuses = {};
        if (!grants.immunities.effects || typeof grants.immunities.effects !== "object") grants.immunities.effects = {};
        if (typeof grants.customImmunities !== "string") grants.customImmunities = "";
        if (typeof grants.notes !== "string") grants.notes = "";

        data.isDarkMagicItem = isDarkMagicItem(itemData);
        data.corruptionValue = getDarkMagicItemCorruptionValue(itemData);
        if (data.isDarkMagicItem) {
            data.hasAura = true;
            if (!data.auraColor || data.auraColor === "dull gray") data.auraColor = "gray-black flame / light-absorbing darkness";
        }
    }
    /**
    * Prepare fleshcraft-specific data
    * @param {Object} itemData - Item data object
    */
    _prepareFleshcraftData(itemData) {
        const data = itemData.system;

        // Initialize fleshcraft properties if undefined
        if (!data.el) data.el = 1;
        if (!data.creatureType) data.creatureType = "";
        if (!data.hp) data.hp = 0;
        if (!data.naturalWeapons) data.naturalWeapons = "";
        if (!data.specialAbilities) data.specialAbilities = "";
    }

    /**
    * Prepare talent-specific data
    * @param {Object} itemData - Item data object
    */
    _prepareTalentData(itemData) {
        const data = itemData.system;

        // Initialize talent properties if undefined
        if (!data.talentType) data.talentType = "general";
        if (!data.description) data.description = "";
        if (!data.effect) data.effect = "";
        if (!data.prerequisites) data.prerequisites = "";
    }


    /**
    * Prepare trait-specific data
    * @param {Object} itemData - Item data object
    */
    _prepareTraitData(itemData) {
        const data = itemData.system;

        // Initialize trait properties if undefined
        if (!data.description) data.description = "";
        if (!data.prerequisites) data.prerequisites = "";
        if (!data.traitType) data.traitType = "general";
        if (!data.source) data.source = "";
    }

    /**
    * Prepare precept-specific data
    * @param {Object} itemData - Item data object
    */
    _preparePreceptData(itemData) {
        const data = itemData.system;

        // Initialize precept properties if undefined
        if (!data.description) data.description = "";
        if (!data.deity) data.deity = "";
        if (!data.domain) data.domain = "";
    }

    _prepareRulesData(itemData) {
        const data = itemData.system;
        if (typeof data.description !== "string") data.description = "";
        if (typeof data.source !== "string") data.source = "";

        if (itemData.type === "mutation") {
            if (!data.severity) data.severity = "minor";
            if (!data.rollRange) data.rollRange = "";
            if (typeof data.effect !== "string") data.effect = "";
        } else if (itemData.type === "heritage") {
            if (!data.heritageType) data.heritageType = "hybrid";
            if (typeof data.motherSpecies !== "string") data.motherSpecies = "";
            if (typeof data.fatherSpecies !== "string") data.fatherSpecies = "";
            if (!Number.isFinite(Number(data.characteristicChanges))) data.characteristicChanges = 0;
            if (typeof data.mutationRolls !== "string") data.mutationRolls = "";
            if (typeof data.effect !== "string") data.effect = "";
        } else if (itemData.type === "trap" || itemData.type === "hazard") {
            if (!Number.isFinite(Number(data.attackDice))) data.attackDice = 0;
            if (!data.defense) data.defense = "none";
            if (data.damage === undefined || data.damage === null || data.damage === "") data.damage = "0";
            if (!data.damageType) data.damageType = "Ut";
            if (!["hp", "sanity"].includes(data.damageTrack)) data.damageTrack = "hp";
            if (typeof data.bypassArmor !== "boolean") data.bypassArmor = false;
            if (typeof data.effect !== "string") data.effect = "";
            if (itemData.type === "trap") {
                if (!Number.isFinite(Number(data.level))) data.level = 1;
                if (!data.category) data.category = "mechanical";
                if (!Number.isFinite(Number(data.detectionDT))) data.detectionDT = 0;
                if (!Number.isFinite(Number(data.disarmDT))) data.disarmDT = 0;
            } else if (!Number.isFinite(Number(data.escalationDice))) data.escalationDice = 0;
        } else if (itemData.type === "downtime") {
            if (!data.activityType) data.activityType = "other";
            if (!data.status) data.status = "planned";
            if (!Number.isFinite(Number(data.progress))) data.progress = 0;
            if (!Number.isFinite(Number(data.target)) || Number(data.target) < 1) data.target = 1;
            data.percentComplete = Math.min(100, Math.max(0, Math.round((Number(data.progress) / Number(data.target)) * 100)));
        }
    }
}

// TheFadeItemSheet class (extracted from thefade.js).
import {
    SIZE_OPTIONS,
    PATH_SKILL_TYPES,
    DEFAULT_SKILLS,
    WEAPON_ENCHANT_BASE_PRICES,
    ARMOR_ENCHANT_BASE_PRICE,
    WEAPON_STRENGTHENING_OPTIONS,
    ARMOR_STRENGTHENING_OPTIONS,
    WEAPON_MOD_SLOTS,
    ARMOR_MOD_SLOTS,
    DAMAGE_TYPE_LABELS,
    COMBAT_DAMAGE_TYPES,
    COMBAT_IMMUNITY_DAMAGE_TYPES,
    COMBAT_IMMUNITY_EFFECTS,
    COMBAT_STATUS_IMMUNITIES,
    UNIVERSAL_ABILITY_CATEGORIES
} from './constants.js';
import { getRankValue, openCompendiumBrowser, applyPathSkillModifications } from './helpers.js';
import { getSkill, calculateSkillDice } from './skills.js';
import { CROSSBREED_OUTCOMES, MUTATION_SEVERITIES } from './rules.js';
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
    buildWeaponQualitySelector,
    getWeaponAttackAttributeOverride,
    isNaturalWeapon,
    resolveWeaponDamageAttribute,
    weaponQualityDisplay
} from './weapon-rules.js';
import {
    buildSpellDamageProfile,
    buildSpellEffectsProfile,
    formatSpellAttackTargets,
    formatSpellSuccessRequirements,
    getSpellAttackTargets,
    getSpellDamageComponents,
    getSpellSuccessRequirements,
    SPELL_STATUS_INTENSITY_OPTIONS,
    SPELL_STATUS_OPTIONS
} from './spell-rules.js';
import {
    ITEM_POWER_OVERLAP_OPTIONS,
    countAttunements,
    getDarkMagicItemCorruptionValue,
    getItemPowerSlotOptions,
    isAttunementRemoved,
    isDarkMagicItem
} from './item-power-rules.js';
import {
    ALCHEMICAL_SKILL_OPTIONS,
    craftAlchemicalItem,
    getAlchemicalCraftCost,
    getAlchemicalDiscipline
} from './alchemy-rules.js';

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

/**
* Item Sheet class for The Fade system
* Handles item sheet rendering and interactions
*/
export class TheFadeItemSheet extends ItemSheet {
    /**
    * Default sheet options
    * @returns {Object} Default options
    */
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["thefade", "sheet", "item", "species"],
            width: 680,
            height: 620,
            tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "description" }],
            scrollY: [".sheet-body", ".tab"]
        });
    }

    /**
    * Get template path based on item type
    * @returns {string} Template path
    */
    get template() {
        const path = "systems/thefade/templates/item";
        if (["mutation", "heritage", "trap", "hazard", "downtime"].includes(this.item.type)) {
            return `${path}/rules-item-sheet.html`;
        }
        // Magic items use the generic item sheet (they already have conditional sections in item-sheet.html)
        if (this.item.type === "magicitem") {
            return `${path}/item-sheet.html`;
        }
        if (this.item.type === "monsterpath") {
            return `${path}/path-sheet.html`;
        }
        if (this.item.type === "monsterspecies") {
            return `${path}/species-sheet.html`;
        }
        return `${path}/${this.item.type}-sheet.html`;
    }

    /**
    * Get template path based on item type
    * @returns {string} Template path
    */
    getData() {

        let data = {};

        // Start with a basic safe structure
        data = {
            item: this.item || {},
            system: this.item?.system || {},
            isEmbeddedSpecies: (this.item?.type === "species" || this.item?.type === "monsterspecies") && this.item?.parent?.documentName === "Actor",
            dtypes: ["String", "Number", "Boolean"],
            itemTypes: {}
        };

        // Try to call super.getData() safely
        try {
            const superData = super.getData();
            if (superData && typeof superData === 'object') {
                data = foundry.utils.mergeObject(data, superData);
            }
        } catch (error) {
            console.error("Error in super.getData():", error);
        }

        // Safely get item types
        try {
            if (CONFIG?.Item?.typeLabels) {
                data.itemTypes = Object.entries(CONFIG.Item.typeLabels).reduce((obj, e) => {
                    obj[e[0]] = game.i18n.localize(e[1]);
                    return obj;
                }, {});
            }
        } catch (error) {
            console.error("Error setting itemTypes:", error);
            data.itemTypes = {};
        }

        // Set all options objects - use basic objects to avoid any complex operations
        try {
            data.itemCategoryOptions = {
                "magicitem": "Item of Power",
                "alchemical": "Alchemical Item",
                "drug": "Drug",
                "poison": "Poison",
                "disease": "Disease",
                "biological": "Biological",
                "medical": "Medical",
                "travel": "Travel & Survival",
                "mount": "Mount",
                "vehicle": "Vehicle",
                "musical": "Musical Instrument",
                "potion": "Potion",
                "staff": "Staff",
                "wand": "Wand",
                "gate": "Dimensional Gate",
                "communication": "Communication Device",
                "containment": "Containment Item",
                "dream": "Dream Harvesting",
                "fleshcraft": "Flesh Craft",
                "clothing": "Clothing"
            };

            data.itemTypeLabel = CONFIG.Item.typeLabels?.[this.item.type]
                ? game.i18n.localize(CONFIG.Item.typeLabels[this.item.type])
                : this.item.type;
            data.itemPowerSlotRule = game.settings?.get("thefade", "itemPowerSlotRule") || "standard";
            data.itemPowerAttunementRule = game.settings?.get("thefade", "itemPowerAttunementRule") || "standard";
            data.attunementRemoved = isAttunementRemoved(data.itemPowerAttunementRule);
            data.techAttunementEnabled = data.itemPowerAttunementRule === "technology";
            data.itemPowerSlotOptions = getItemPowerSlotOptions(data.itemPowerSlotRule, this.item?.system?.slot);
            data.itemPowerOverlapOptions = ITEM_POWER_OVERLAP_OPTIONS;
            data.isDarkMagicItem = isDarkMagicItem(this.item);
            data.darkMagicRetroactive = data.isDarkMagicItem && this.item?.system?.darkMagic !== true;
            data.darkMagicCorruptionValue = getDarkMagicItemCorruptionValue(this.item);
            data.darkMagicCorruptionOptions = {
                0: "Automatic from price",
                1: "1",
                2: "2",
                3: "3",
                4: "4"
            };
            data.mutationSeverityOptions = MUTATION_SEVERITIES;
            data.heritageTypeOptions = Object.fromEntries(
                Object.values(CROSSBREED_OUTCOMES).map(outcome => [outcome.key, outcome.label])
            );
            data.trapCategoryOptions = { mechanical:"Mechanical", magical:"Magical", environmental:"Environmental" };
            data.hazardCategoryOptions = { hazard:"Hazard", atmosphere:"Atmosphere", terrain:"Terrain", weather:"Weather" };
            data.downtimeTypeOptions = { crafting:"Crafting", training:"Training", social:"Social & Political", exploration:"Exploration", commerce:"Commerce", leisure:"Leisure", magic:"Magical Pursuit", other:"Other" };
            data.downtimeStatusOptions = { planned:"Planned", active:"Active", completed:"Completed", abandoned:"Abandoned" };
            data.defenseOptions = { none:"No attack roll", resilience:"Resilience", avoid:"Avoid", grit:"Grit" };
            data.damageTypeOptions = DAMAGE_TYPE_LABELS;
            data.damageTrackOptions = { hp:"Health (HP)", sanity:"Sanity" };
            data.combatDamageTypes = COMBAT_DAMAGE_TYPES;
            data.combatImmunityDamageTypes = COMBAT_IMMUNITY_DAMAGE_TYPES;
            data.combatImmunityEffects = COMBAT_IMMUNITY_EFFECTS;
            data.combatStatusImmunities = COMBAT_STATUS_IMMUNITIES;
            const openGrantCategories = this._itemPowerGrantOpenCategories;
            data.universalAbilityCategories = UNIVERSAL_ABILITY_CATEGORIES.map(category => ({
                ...category,
                isOpen: openGrantCategories?.has(category.key) === true
            }));

            data.spellSchoolOptions = {
                "General": "General",
                "Divine": "Divine",
                "Elementalism": "Elementalism",
                "Malevolent": "Malevolent",
                "Martial": "Martial",
                "Naturalism": "Naturalism",
                "Preternaturalism": "Preternaturalism",
                "Rituals": "Rituals",
                "Runes": "Runes",
                "Spiritualism": "Spiritualism"
            };

            data.magicItemSlotOptions = {
                "head": "Head",
                "neck": "Neck",
                "body": "Body",
                "hands": "Hands",
                "ring": "Ring",
                "belt": "Belt",
                "boots": "Boots"
            };

            data.communicationComplexityOptions = {
                "audio": "Audio Only",
                "audiovisual": "Audio & Visual"
            };

            data.poisonAdminOptions = {
                "injury": "Injury",
                "ingested": "Ingested",
                "inhaled": "Inhaled",
                "contact": "Contact"
            };

            data.poisonOnsetOptions = {
                "immediate": "Immediate (on hit)",
                "fast": "Fast (1 round)",
                "moderate": "Moderate (10 minutes)",
                "slow": "Slow (3 hours)",
                "insidious": "Insidious (5 days)"
            };

            data.poisonCategoryOptions = {
                "neurotoxin": "Neurotoxin",
                "hemotoxin": "Hemotoxin",
                "cytotoxin": "Cytotoxin",
                "psychotoxin": "Psychotoxin",
                "thaumatoxin": "Thaumatoxin",
                "aetherotoxin": "Aetherotoxin",
                "pathotoxin": "Pathotoxin",
                "aisthetoxin": "Aisthetoxin"
            };

            data.diseaseTransmissionOptions = {
                "airborne": "Airborne",
                "contact": "Contact",
                "fluid": "Fluid",
                "ingested": "Ingested",
                "injury": "Injury"
            };

            data.diseaseDurationTypeOptions = {
                "temporary": "Temporary (T)",
                "chronic": "Chronic",
                "permanent": "Permanent"
            };

            data.materialOptions = {
                "iron": "Iron (Standard)",
                "bone": "Bone",
                "obsidian": "Obsidian",
                "wood": "Wood",
                "leather": "Leather",
                "copper": "Copper",
                "bronze": "Bronze",
                "coldIron": "Cold Iron",
                "steel": "Steel",
                "coldSteel": "Cold Steel",
                "gold": "Gold",
                "orichalcum": "Orichalcum",
                "silver": "Silver",
                "mithral": "Mithral",
                "platinum": "Platinum",
                "adamantine": "Adamantine",
                "ritewood": "Ritewood",
                "blacksteel": "Blacksteel"
            };

            data.armorLocationOptions = {
                "Head": "Head",
                "Head+": "Head+ (Coif, Gorget)",
                "Body": "Body",
                "Body+": "Body+ (Leather Coat, Chain Shirt)",
                "Arms": "Arms",
                "Arms+": "Arms+ (Ailette, Couter)",
                "Legs": "Legs",
                "Legs+": "Legs+ (Poleyn, Tasset)",
                "Shield": "Shield"
            };

            data.weaponDamageTypeOptions = {
                "B": "Bludgeoning (B)",
                "S": "Slashing (S)",
                "P": "Piercing (P)",
                "BoP": "Bludgeoning or Piercing (B or P)",
                "BP": "Bludgeoning & Piercing (B&P)",
                "SP": "Slashing & Piercing (S&P)",
                "SoP": "Slashing or Piercing (S or P)",
                "SoB": "Slashing or Bludgeoning (S or B)",
                "F": "Fire (F)",
                "C": "Cold (C)",
                "A": "Acid (A)",
                "E": "Electricity (E)",
                "So": "Sonic (So)",
                "Sm": "Smiting (Sm)",
                "Ex": "Expel (Ex)",
                "Psi": "Psychokinetic (Psi)",
                "Co": "Corruption (Co)",
                "Ut": "Untyped (Ut)"
            };

            data.weaponHandednessOptions = {
                "Light": "Light",
                "One-Handed": "One-Handed",
                "Two-Handed": "Two-Handed",
                "Natural Weapon": "Natural Weapon"
            };

            data.weaponSkillOptions = {
                "Axe": "Axe",
                "Bow": "Bow",
                "Cudgel": "Cudgel",
                "Firearm": "Firearm",
                "Heavy Weaponry": "Heavy Weaponry",
                "Polearm": "Polearm",
                "Sword": "Sword",
                "Thrown": "Thrown",
                "Unarmed": "Unarmed",
                "Spellcasting": "Spellcasting"
            };

            data.weaponAttributeOptions = WEAPON_DAMAGE_ATTRIBUTE_OPTIONS;
            data.weaponDamageAttributeOptions = WEAPON_DAMAGE_ATTRIBUTE_OPTIONS;

            data.skillRankOptions = {
                "untrained": "Untrained",
                "learned": "Learned",
                "practiced": "Practiced",
                "adept": "Adept",
                "experienced": "Experienced",
                "expert": "Expert",
                "mastered": "Mastered"
            };

            data.skillCategoryOptions = {
                "Combat": "Combat",
                "Craft": "Craft",
                "Knowledge": "Knowledge",
                "Magical": "Magical",
                "Physical": "Physical",
                "Sense": "Sense",
                "Social": "Social"
            };

            data.skillAttributeOptions = {
                "physique": "Physique",
                "finesse": "Finesse",
                "mind": "Mind",
                "presence": "Presence",
                "soul": "Soul",
                "physique_finesse": "Physique & Finesse (Average)",
                "mind_soul": "Mind & Soul (Average)",
                "finesse_presence": "Finesse & Presence (Average)",
                "physique_mind": "Physique & Mind (Average)"
            };

            data.creatureTypeOptions = CREATURE_TYPE_OPTIONS;

            data.spellAttackOptions = {
                "": "None",
                "Avoid": "vs. Avoid",
                "Resilience": "vs. Resilience",
                "Grit": "vs. Grit",
                "Resilience|Grit": "vs. Resilience and vs. Grit (two rolls)"
            };

            data.spellDamageTypeOptions = {
                "": "None",
                "B": "Bludgeoning (B)",
                "S": "Slashing (S)",
                "P": "Piercing (P)",
                "F": "Fire (F)",
                "C": "Cold (C)",
                "A": "Acid (A)",
                "E": "Electricity (E)",
                "So": "Sonic (So)",
                "Sm": "Smiting (Sm)",
                "Ex": "Expel (Ex)",
                "Psi": "Psychokinetic (Psi)",
                "Co": "Corruption (Co)",
                "Ut": "Untyped (Ut)"
            };
            data.spellDamageComponentTypeOptions = Object.fromEntries(
                Object.entries(data.spellDamageTypeOptions).filter(([key]) => key !== "")
            );

            data.mishapModifierOptions = {
                "none": "None",
                "corruption": "Corruption Damage (Failure = One Stage Worse)"
            };

            data.pathTierOptions = {
                "1": "Tier 1",
                "2": "Tier 2",
                "3": "Tier 3"
            };

            data.naturalDeflectionRatingOptions = {
                "fragile": "Fragile",
                "average": "Average",
                "tough": "Tough"
            };

            data.naturalDeflectionMultiplierOptions = {
                "0.25": "1/4",
                "0.3333333333": "1/3",
                "0.5": "1/2",
                "0.6666666667": "2/3",
                "1": "Unmodified",
                "2": "Double"
            };

            data.standardAttackGrantModeOptions = {
                "grant": "Grant",
                "choice": "Choice"
            };

            data.standardAttackTypeOptions = {
                "natural": "Natural Attack",
                "weapon": "Weapon"
            };

            data.sizeOptions = SIZE_OPTIONS;
        } catch (error) {
            console.error("Error setting options:", error);
        }

        // Handle special item types
        try {
            if (this.item?.type === 'path' || this.item?.type === 'monsterpath') {
                if (this._preparePathSkills) {
                    this._preparePathSkills(data);
                }
            }

            if (this.item?.type === 'monsterspecies') {
                data.isMonsterSpecies = true;
                data.standardAttacks = Array.isArray(this.item.system.standardAttacks)
                    ? this.item.system.standardAttacks
                    : [];
                data.sizeRuleRows = Object.entries(SIZE_OPTIONS).map(([key, label]) => ({
                    key,
                    label,
                    rule: this.item.system.sizeRules?.[key] || {}
                }));
            }

            if (this.item?.type === 'talent') {
                data.talentTypes = {
                    "general": "General Talents",
                    "combat": "Combat Talents",
                    "magic": "Magic Talents",
                    "species": "Species Talents",
                    "monster": "Monster Talents",
                    "trait": "Traits",
                    "precept": "Precepts"
                };
            }

            // Calculated dice pool for weapons owned by an actor. Mirrors the
            // attack-roll math in character-sheet.js so the sheet preview matches
            // what an actual attack roll would use.
            if (this.item?.type === 'weapon' && this.item.parent) {
                const actor = this.item.parent;
                const sys = this.item.system;
                const skill = getSkill(actor, sys.skill);
                const attackOverride = getWeaponAttackAttributeOverride(sys);
                const effectiveSkill = skill && attackOverride ? { ...skill, attribute: attackOverride.key } : skill;
                const skillDice = effectiveSkill ? calculateSkillDice(actor, effectiveSkill) : 0;
                const weaponMisc = Number(sys.miscBonus) || 0;
                const eb = actor.system?.equippedBonuses;
                const skillKey = (sys.skill || "").toLowerCase();
                const attackBonus = eb
                    ? (eb.attack || 0) + (eb[`attack_${skillKey}`] || 0)
                    : 0;
                const total = skillDice + weaponMisc + attackBonus;
                if (total > 0) data.calculatedDice = total;
            }

            // Magic + modification data for weapons
            if (this.item?.type === 'weapon') {
                const sys = this.item.system;
                data.isNaturalWeapon = isNaturalWeapon(sys);
                data.weaponHandednessSelection = data.isNaturalWeapon ? "Natural Weapon" : sys.handedness;
                data.weaponQualitySelector = buildWeaponQualitySelector(sys);
                data.weaponQualitiesDisplay = weaponQualityDisplay(sys);
                const resolvedDamageAttribute = resolveWeaponDamageAttribute(sys);
                data.weaponDamageAttributeSelection = resolvedDamageAttribute.key;
                data.weaponDamageAttributeSource = resolvedDamageAttribute.source;
                data.weaponDamageAttributeLockedByQuality = !!resolvedDamageAttribute.source;

                // Lazy persistent migration: if a legacy weapon has damage/damageType
                // but no damageComponents, persist a single component on first sheet
                // open. prepareData has already hydrated the in-memory array, so we
                // just check whether the persisted source still lacks it.
                const sourceComponents = this.item._source?.system?.damageComponents;
                const sourceDamage = Number(this.item._source?.system?.damage) || 0;
                if (
                    !this._migratedDamageComponents &&
                    Array.isArray(sourceComponents) &&
                    sourceComponents.length === 0 &&
                    sourceDamage > 0
                ) {
                    this._migratedDamageComponents = true;
                    const migrated = [{
                        id: foundry.utils.randomID(16),
                        amount: sourceDamage,
                        type: this.item._source.system.damageType || "Ut"
                    }];
                    this.item.update({ "system.damageComponents": migrated });
                }

                const components = Array.isArray(sys.damageComponents) ? sys.damageComponents : [];
                data.weaponDamageComponents = components.map(c => ({
                    id: c.id,
                    amount: c.amount,
                    type: c.type
                }));

                const damageProfile = buildWeaponDamageProfile(this.item.parent, sys);
                data.effectiveDamage = damageProfile.total;
                data.effectiveDamageBreakdown = damageProfile.display;
                data.weaponAttrBonus = damageProfile.attributeBonus;
                data.weaponAttrLabel = WEAPON_DAMAGE_ATTRIBUTE_OPTIONS[damageProfile.attributeKey] || "";

                data.weaponEnchantBasePrice = WEAPON_ENCHANT_BASE_PRICES[sys.skill] ?? WEAPON_ENCHANT_BASE_PRICES.default;
                data.weaponImmuneToRadiation = sys.skill === "Bow" || sys.skill === "Firearm" || sys.skill === "Heavy Weaponry";
                data.weaponStrengtheningOptions = WEAPON_STRENGTHENING_OPTIONS;
                data.totalMagicCost = data.isNaturalWeapon
                    ? 0
                    : (Number(sys.enchantmentPrice) || 0) + (Number(sys.strengtheningPrice) || 0);

                const slotsMax = data.isNaturalWeapon ? 0 : (WEAPON_MOD_SLOTS[sys.handedness] ?? 0);
                const slotsUsed = Array.isArray(sys.modifications) ? sys.modifications.length : 0;
                data.modSlotsMax = slotsMax;
                data.modSlotsUsed = slotsUsed;
                data.modSlotsOverCapacity = slotsUsed > slotsMax;
            }

            if (this.item?.type === 'spell') {
                const sys = this.item.system;
                const sourceComponents = this.item._source?.system?.damageComponents;
                const sourceDamage = Math.max(
                    0,
                    Number(this.item._source?.system?.damage) || parseInt(this.item._source?.system?.damage, 10) || 0
                );

                // Persist the component form when a legacy spell sheet is first
                // opened. The old fields remain synchronized for integrations
                // that still read damage/damageType.
                if (
                    !this._migratedSpellDamageComponents &&
                    this.options.editable &&
                    !this.item.pack &&
                    (!Array.isArray(sourceComponents) || sourceComponents.length === 0) &&
                    sourceDamage > 0
                ) {
                    this._migratedSpellDamageComponents = true;
                    this.item.update({
                        "system.damageComponents": [{
                            id: foundry.utils.randomID(16),
                            amount: sourceDamage,
                            type: this.item._source.system.damageType || "Ut"
                        }]
                    });
                }

                data.spellDamageComponents = getSpellDamageComponents(sys);
                const damageProfile = buildSpellDamageProfile(sys);
                data.spellDamageTotal = damageProfile.total;
                data.spellDamageDisplay = damageProfile.display;
                const effectsProfile = buildSpellEffectsProfile(sys);
                data.spellSanityDamage = effectsProfile.sanityDamage;
                data.spellStatusEffects = effectsProfile.statusEffects;
                data.spellBuffEffects = effectsProfile.buffEffects;
                data.spellStatusOptions = SPELL_STATUS_OPTIONS;
                data.spellStatusIntensityOptions = SPELL_STATUS_INTENSITY_OPTIONS;
                const attackTargets = getSpellAttackTargets(sys);
                data.spellAttackSelection = attackTargets.join("|");
                data.spellAttackDisplay = formatSpellAttackTargets(sys);
                data.spellAttacksAvoid = attackTargets.includes("Avoid");
                data.spellAttacksResilience = attackTargets.includes("Resilience");
                data.spellAttacksGrit = attackTargets.includes("Grit");
            }

            if (this.item?.type === 'alchemical') {
                const sys = this.item.system;
                data.alchemicalSkillOptions = ALCHEMICAL_SKILL_OPTIONS;
                data.alchemicalDiscipline = getAlchemicalDiscipline(sys);
                data.alchemicalCraftCost = getAlchemicalCraftCost(sys);
                data.canCraftAlchemical = !!this.item.parent;
                data.canAffordAlchemical = (Number(this.item.parent?.system?.currency?.serpents) || 0) >= data.alchemicalCraftCost;
            }

            // AP data for armor and armor-like Items of Power.
            if (this.item?.type === 'armor' || (this.item?.type === 'magicitem' && this.item.system?.conflictsArmor)) {
                const sys = this.item.system;
                const baseAP = Number(sys.ap) || 0;
                const apInc = Number(sys.apIncrease) || 0;
                data.effectiveAP = baseAP + apInc;
            }

            // Magic + modification data exclusive to ordinary armor.
            if (this.item?.type === 'armor') {
                const sys = this.item.system;
                data.armorEnchantBasePrice = ARMOR_ENCHANT_BASE_PRICE;
                data.armorStrengtheningOptions = ARMOR_STRENGTHENING_OPTIONS;
                data.totalMagicCost = (Number(sys.enchantmentPrice) || 0) + (Number(sys.strengtheningPrice) || 0);

                const slotsMax = ARMOR_MOD_SLOTS[sys.location] ?? 0;
                const slotsUsed = Array.isArray(sys.modifications) ? sys.modifications.length : 0;
                data.modSlotsMax = slotsMax;
                data.modSlotsUsed = slotsUsed;
                data.modSlotsOverCapacity = slotsUsed > slotsMax;
            }

            // Consume label per consumable type
            const consumeLabels = {
                potion: "Consume Potion",
                drug: "Take Drug",
                medical: "Use Medicine",
                poison: "Apply Poison"
            };
            if (consumeLabels[this.item?.type]) {
                data.consumeLabel = consumeLabels[this.item.type];
            }
        } catch (error) {
            console.error("Error in special item type handling:", error);
        }
        if (this.item?.type === "species" || this.item?.type === "monsterspecies") {
            data.creatureSubtypeSelector = buildCreatureSubtypeSelector(this.item.system, "species");
            data.selectedCreatureType = normalizeCreatureType(this.item.system.creatureType);
            data.creatureRuleAbilityView = {
                sources: getCreatureRuleSources(this.item.system, "species"),
                canActivate: false
            };
        }
        addMechanicalBonusSheetOptions(data);
        return data;
    }

    /**
    * Activate item sheet listeners
    * @param {HTMLElement} html - Sheet HTML element
    */
    activateListeners(html) {
        super.activateListeners(html);

        // Item updates re-render the sheet. Remember the native <details>
        // state so editing a grant does not collapse the category the user is
        // currently working in.
        html.find('.item-power-grants .universal-ability-category').on('toggle', ev => {
            const details = ev.currentTarget;
            const category = details.dataset.category;
            if (!category) return;
            if (!this._itemPowerGrantOpenCategories) this._itemPowerGrantOpenCategories = new Set();
            if (details.open) this._itemPowerGrantOpenCategories.add(category);
            else this._itemPowerGrantOpenCategories.delete(category);
        });

        // Everything below here is only needed if the sheet is editable
        if (!this.options.editable) return;

        html.find('.roll-hazard').click(event => this._onRollHazard(event));

        if (this.item.type === 'alchemical') {
            html.find('.craft-alchemical').click(async event => {
                event.preventDefault();
                await craftAlchemicalItem(this.item.parent, this.item);
            });
        }

        // Add drag-and-drop highlighting when dragging over the skills tab
        if (this.item.type === 'path' || this.item.type === 'monsterpath') {
            // Get the skills tab and skills list
            const skillsTab = html.find('.tab[data-tab="skills"]');
            const skillsList = html.find('.skills-list');

            // Add dragover event to highlight drop targets
            skillsTab.on('dragover', event => {
                event.preventDefault();
                skillsTab.addClass('drop-target');
            });

            // Add dragleave event to remove highlighting
            skillsTab.on('dragleave', event => {
                event.preventDefault();
                skillsTab.removeClass('drop-target');
            });

            // Add drop event to handle the drop and remove highlighting
            skillsTab.on('drop', event => {
                event.preventDefault();
                skillsTab.removeClass('drop-target');

                // Make sure we use the original browser event
                const dragEvent = event.originalEvent || event;
                this._onDrop(dragEvent);
            });

            // Same events for the skills list if it exists
            if (skillsList.length) {
                skillsList.on('drop', event => {
                    event.preventDefault();
                    skillsList.removeClass('drop-target');

                    // Make sure we use the original browser event
                    const dragEvent = event.originalEvent || event;
                    this._onDrop(dragEvent);
                });
            }
        }

        // Dynamic name length calculation for font sizing
        html.find('.item-name-dynamic input').on('input', function () {
            const nameLength = this.value.length;
            this.style.setProperty('--name-length', nameLength);
        });

        // Initialize name length on sheet open
        html.find('.item-name-dynamic input').each(function () {
            const nameLength = this.value.length;
            this.style.setProperty('--name-length', nameLength);
        });

        // Handle item type change
        html.find('select[name="type"]').change(ev => {
            const newType = ev.currentTarget.value;

            // Only respond if the type has actually changed
            if (newType !== this.item.type) {
                ui.notifications.warn("Changing item types directly is not supported. Please create a new item of the desired type.");

                // Reset the dropdown to the current type
                ev.currentTarget.value = this.item.type;
            }
        });

        // For all other fields, use this approach:
        html.find('input[name], select[name]:not([name="type"]), textarea[name]').change(ev => {
            const input = ev.currentTarget;
            if ((this.item.type === 'species' || this.item.type === 'monsterspecies') && !input.closest('.bonus-section')) {
                return;
            }
            const fieldName = input.name;

            let value = input.type === 'checkbox' ? input.checked : input.value;

            // Convert to number for numeric inputs
            if (input.dataset.dtype === 'Number') {
                value = Number(value);
                if (isNaN(value)) value = 0;
            }

            // Handle system data updates
            if (fieldName.startsWith('system.')) {
                this.item.update({ [fieldName]: value });
            } else if (fieldName !== 'type') { // Skip type field
                // For other updates
                this.item.update({
                    [fieldName]: value
                });
            }
        });

        // Add skill to path
        html.find('.path-skill-create').click(async ev => {
            ev.preventDefault();

            if (this.item.type !== 'path' && this.item.type !== 'monsterpath') return;

            await this._showPathSkillCreationDialog();
        });

        // Edit path skill
        html.find('.path-skill-edit').each((index, element) => {
            const li = $(element).closest('li');
            const skillId = li.data('item-id');

            if (skillId) {
                const pathSkills = this.item.system.pathSkills || [];
                const skillData = pathSkills.find(s => s._id === skillId);

                if (skillData && skillData.system.entryType) {
                    const entryType = skillData.system.entryType;

                    // Disable edit for choice entries
                    if (entryType === PATH_SKILL_TYPES.CHOOSE_CATEGORY ||
                        entryType === PATH_SKILL_TYPES.CHOOSE_ANY ||
                        entryType === PATH_SKILL_TYPES.CHOOSE_LORE ||
                        entryType === PATH_SKILL_TYPES.CHOOSE_PERFORM ||
                        entryType === PATH_SKILL_TYPES.CHOOSE_CRAFT) {

                        $(element).addClass('disabled-button')
                            .attr('title', 'Choice Entry - Cannot Edit Directly')
                            .off('click')
                            .on('click', function (e) {
                                e.preventDefault();
                                ui.notifications.info('Choice entries cannot be edited directly. Delete and recreate if needed.');
                            });
                    }
                }
            }
        });

        // Delete path skill
        html.find('.path-skill-delete').click(async ev => {
            ev.preventDefault();
            const li = ev.currentTarget.closest("li");
            const skillId = li.dataset.itemId;

            // Confirm deletion
            new Dialog({
                title: "Confirm Deletion",
                content: "<p>Are you sure you want to remove this skill from the path?</p>",
                buttons: {
                    delete: {
                        icon: '<i class="fas fa-trash"></i>',
                        label: "Delete",
                        callback: async () => {
                            // Get the current path skills
                            const pathSkills = foundry.utils.deepClone(this.item.system.pathSkills || []);

                            // Remove the skill from the array
                            const index = pathSkills.findIndex(s => s._id === skillId);
                            if (index !== -1) {
                                pathSkills.splice(index, 1);

                                // Save changes to the path
                                await this.item.update({ "system.pathSkills": pathSkills });
                                this.render(true);
                            }
                        }
                    },
                    cancel: {
                        icon: '<i class="fas fa-times"></i>',
                        label: "Cancel"
                    }
                },
                default: "cancel"
            }).render(true);
        });

        // Handle path skill rank changes
        html.find('.path-skill-rank').change(async ev => {
            ev.preventDefault();
            const select = ev.currentTarget;
            const skillId = select.dataset.skillId;
            const newRank = select.value;

            // Get the current path skills
            const pathSkills = foundry.utils.deepClone(this.item.system.pathSkills || []);
            const skillIndex = pathSkills.findIndex(s => s._id === skillId);

            if (skillIndex !== -1) {
                // Update the skill rank
                pathSkills[skillIndex].system.rank = newRank;

                // Save changes to the path
                await this.item.update({ "system.pathSkills": pathSkills });
                this.render(true);

                ui.notifications.info(`Updated ${pathSkills[skillIndex].name} to ${newRank} rank.`);
            }
        });

        // Handle skill browsing
        html.find('.skill-browse').off('click').click(ev => {
            ev.preventDefault();

            if (this.item.type !== 'path' && this.item.type !== 'monsterpath') return;

            this._showPathSkillBrowserDialog();
        });

        // Path: header mirror fields (Tier + Base HP also appear in Attributes tab).
        // Removed name= attributes on mirrors to avoid duplicate form-field collision; wire change handlers manually.
        if (this.item.type === 'path' || this.item.type === 'monsterpath') {
            html.find('.path-tier-mirror').change(async ev => {
                ev.preventDefault();
                await this.item.update({ "system.tier": ev.currentTarget.value });
            });
            html.find('.path-basehp-mirror').change(async ev => {
                ev.preventDefault();
                const val = Number(ev.currentTarget.value);
                if (Number.isFinite(val)) await this.item.update({ "system.baseHP": val });
            });
        }

        // Add a button to handle adding path skills to a character
        if (this.item.type === 'path' || this.item.type === 'monsterpath') {
            // Add apply to character button if it doesn't exist
            if (html.find('.skill-apply-to-character').length === 0) {
                html.find('.skill-browse').parent().append('<a class="skill-apply-to-character" title="Add Skills to Character"><i class="fas fa-user-plus"></i></a>');
            }

            // Add event listener for applying skills to a character
            html.find('.skill-apply-to-character').click(async ev => {
                ev.preventDefault();

                // Get all characters
                const characters = game.actors.filter(a => a.type === 'character');

                if (characters.length === 0) {
                    ui.notifications.warn("No characters found in this game.");
                    return;
                }

                // Create character options for the dialog
                const characterOptions = characters.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

                // Create a dialog for selecting a character
                const dialog = new Dialog({
                    title: "Add Path Skills to Character",
                    content: `<form>
                    <p>Select a character to add the skills from ${this.item.name}:</p>
                    <div class="form-group">
                    <select id="character-select" name="characterId">
                        ${characterOptions}
                    </select>
                    </div>
                </form>`,
                    buttons: {
                        add: {
                            icon: '<i class="fas fa-plus"></i>',
                            label: "Add Skills",
                            callback: async html => {
                                const characterId = html.find('#character-select').val();
                                const actor = game.actors.get(characterId);

                                if (!actor) return;

                                // Delegate to the central path-skill application
                                // helper so behavior matches dragging a path onto
                                // an actor (covers SPECIFIC/CHOOSE/CUSTOM entries).
                                if (this.item.system.pathSkills && this.item.system.pathSkills.length > 0) {
                                    await applyPathSkillModifications(actor, this.item);
                                } else {
                                    ui.notifications.warn(`${this.item.name} has no associated skills to add.`);
                                }
                            }
                        },
                        cancel: {
                            icon: '<i class="fas fa-times"></i>',
                            label: "Cancel"
                        }
                    },
                    default: "add"
                });

                dialog.render(true);
            });
        }

        // Handle input changes for species sheets
        if (this.item.type === 'species' || this.item.type === 'monsterspecies') {
            html.find('input, select, textarea').change(async (ev) => {
                const element = ev.currentTarget;
                // Skip bonus-row controls — they're persisted by the dedicated
                // bonus handlers below and don't carry a `name` attribute.
                if (element.closest('.bonus-section')) return;
                if (!element.name) return;

                ev.preventDefault();
                ev.stopImmediatePropagation();

                const field = element.name;
                let value = element.value;

                if (element.type === 'checkbox') {
                    value = element.checked;
                }
                if (element.dataset.dtype === 'Number') {
                    value = Number(value);
                }
                if (element.dataset.dtype === 'NumberOrEmpty') {
                    value = value === "" ? "" : Number(value);
                    if (Number.isNaN(value)) value = "";
                }

                await this.item.update({ [field]: value });
            });

            html.find('.creature-subtype-add').click(async ev => {
                ev.preventDefault();
                const selector = $(ev.currentTarget).closest('.creature-subtype-selector');
                const id = selector.find('.creature-subtype-choice').val();
                if (!id) return;
                const subtypes = [...new Set([...(this.item.system.creatureSubtypes || []), id])];
                await this.item.update({ "system.creatureSubtypes": subtypes });
            });

            html.find('.creature-subtype-remove').click(async ev => {
                ev.preventDefault();
                const id = ev.currentTarget.dataset.subtypeId;
                const subtypes = (this.item.system.creatureSubtypes || []).filter(value => value !== id);
                await this.item.update({ "system.creatureSubtypes": subtypes });
            });
        }

        // This handles both path and species abilities
        html.find('.ability-add').click(event => {
            event.preventDefault();

            if (this.item.type === 'path' || this.item.type === 'monsterpath') {
                const abilities = foundry.utils.deepClone(this.item.system.abilities || {});
                const id = foundry.utils.randomID(16);
                abilities[id] = { name: "New Ability", description: "", activation: "passive", actionCost: "", durationRounds: 1, bonuses: [] };
                this.item.update({ "system.abilities": abilities });
            }
            else if (this.item.type === 'species' || this.item.type === 'monsterspecies') {
                const abilities = foundry.utils.deepClone(this.item.system.speciesAbilities || {});
                const id = foundry.utils.randomID(16);
                abilities[id] = { name: "New Ability", description: "", activation: "passive", actionCost: "", durationRounds: 1, bonuses: [] };
                this.item.update({ "system.speciesAbilities": abilities });
            }
        });

        html.find('.ability-delete').click(async (event) => {
            event.preventDefault();

            // Get the parent ability item and its ID
            const abilityItem = event.currentTarget.closest(".ability-item");
            const abilityId = abilityItem.dataset.abilityId;

            if (!abilityId) return;

            // Create a deletion update using Foundry's special -=null syntax
            let updateData = {};

            if (this.item.type === 'path' || this.item.type === 'monsterpath') {
                updateData = { [`system.abilities.-=${abilityId}`]: null };
            }
            else if (this.item.type === 'species' || this.item.type === 'monsterspecies') {
                updateData = { [`system.speciesAbilities.-=${abilityId}`]: null };
            }

            // Apply the update
            await this.item.update(updateData);

            // Force a data reset and re-render
            this.item.reset();

            // Use a small timeout to ensure data is processed
            setTimeout(() => {
                this.render(false);
            }, 50);
        });

        html.find('select[name="system.species.flexibleBonus.selectedAttribute"]').change(async ev => {
            const selectedAttr = ev.target.value;

            // Update the character sheet
            await this.actor.update({
                "system.species.flexibleBonus.selectedAttribute": selectedAttr
            });

            // Refresh the sheet to show the updated bonus
            this.render(true);
        });

        // Handle autogrow textareas
        html.find("textarea.autogrow").each(function () {
            const ta = this;

            const resize = () => {
                ta.style.height = "auto";
                ta.style.height = ta.scrollHeight + "px";
            };

            ta.style.overflowY = "hidden";
            ta.style.resize = "none";

            ta.addEventListener("input", resize);

            // Resize after a short delay in case of tab switch render delay
            setTimeout(resize, 0);
        });

        html.find('.defense-checkbox').change(function () {
            const checkbox = $(this);
            const details = checkbox.closest('.defense').find('.defense-details');

            if (checkbox.is(':checked')) {
                details.css('max-height', details.prop('scrollHeight') + 'px');
            } else {
                details.css('max-height', '0');
            }
        });

        // Initialize defense details state
        html.find('.defense-details').each(function () {
            const details = $(this);
            const checkbox = details.siblings('.defense-toggle-container').find('.defense-checkbox');

            if (checkbox.is(':checked')) {
                details.css('max-height', details.prop('scrollHeight') + 'px');
            } else {
                details.css('max-height', '0');
            }
        });

        // Armor: AP reduce/reset buttons (including armor-like Items of Power)
        if (this.item.type === 'armor' || (this.item.type === 'magicitem' && this.item.system?.conflictsArmor)) {
            html.find('.ap-current').change(async ev => {
                ev.preventDefault();
                const val = Number(ev.currentTarget.value);
                if (Number.isFinite(val)) await this.item.update({ "system.currentAP": val });
            });
            html.find('.reduce-ap').click(async ev => {
                ev.preventDefault();
                const cur = this.item.system.currentAP ?? this.item.system.ap ?? 0;
                if (cur <= 0) return ui.notifications.warn("AP is already depleted.");
                await this.item.update({ "system.currentAP": cur - 1 });
            });
            html.find('.reset-ap').click(async ev => {
                ev.preventDefault();
                const baseAP = Number(this.item.system.ap) || 0;
                const apInc = Number(this.item.system.apIncrease) || 0;
                const maxAP = baseAP + apInc;
                const updates = { "system.currentAP": maxAP };
                if (["Arms", "Arms+", "Legs", "Legs+"].includes(this.item.system.location)) {
                    updates["system.derivedLeftAP"] = maxAP;
                    updates["system.derivedRightAP"] = maxAP;
                }
                await this.item.update(updates);
            });
        }

        // Handle wand charges — with chat card
        if (this.item.type === 'wand') {
            html.find('.charge-use').click(async ev => {
                ev.preventDefault();
                const charges = this.item.system.charges || 0;
                if (charges <= 0) return ui.notifications.warn("This wand has no charges remaining.");
                const newCharges = charges - 1;
                await this.item.update({ "system.charges": newCharges });
                const actor = this.item.parent;
                ChatMessage.create({
                    speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
                    content: `<div class="thefade chat-card">
                        <h3>${this.item.name}</h3>
                        <p class="item-type-label">Wand</p>
                        ${this.item.system.spellName ? `<p><strong>Spell:</strong> ${this.item.system.spellName}</p>` : ""}
                        ${this.item.system.spellDescription || this.item.system.spellEffect ? `<p>${this.item.system.spellDescription || this.item.system.spellEffect}</p>` : ""}
                        <p class="qty-remaining">Charges remaining: ${newCharges}${this.item.system.maxCharges ? ` / ${this.item.system.maxCharges}` : ""}</p>
                    </div>`
                });
            });
        }

        // Handle staff uses — with chat card
        if (this.item.type === 'staff') {
            html.find('.use-per-day').click(async ev => {
                ev.preventDefault();
                const uses = this.item.system.uses || 0;
                const maxUses = this.item.system.usesPerDay || 3;
                if (uses >= maxUses) return ui.notifications.warn("This staff has been used the maximum number of times today.");
                const newUses = uses + 1;
                await this.item.update({ "system.uses": newUses });
                const actor = this.item.parent;
                ChatMessage.create({
                    speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
                    content: `<div class="thefade chat-card">
                        <h3>${this.item.name}</h3>
                        <p class="item-type-label">Staff</p>
                        ${this.item.system.spellName ? `<p><strong>Spell:</strong> ${this.item.system.spellName}</p>` : ""}
                        ${this.item.system.spellDescription || this.item.system.spellEffect ? `<p>${this.item.system.spellDescription || this.item.system.spellEffect}</p>` : ""}
                        <p class="qty-remaining">Uses today: ${newUses} / ${maxUses}</p>
                    </div>`
                });
            });

            html.find('.reset-uses').click(async ev => {
                ev.preventDefault();
                await this.item.update({ "system.uses": 0 });
                ui.notifications.info("Staff uses have been reset for a new day.");
            });
        }

        // Handle biological item energy consumption
        if (this.item.type === 'biological') {
            html.find('.use-energy').click(ev => {
                ev.preventDefault();
                const energy = this.item.system.energy || 0;
                if (energy > 0) {
                    this.item.update({ "system.energy": energy - 1 });
                } else {
                    ui.notifications.warn("This biological item has no energy remaining.");
                }
            });
        }

        // Handle dimensional gate activation
        if (this.item.type === 'gate') {
            html.find('.activate-gate').click(ev => {
                ev.preventDefault();
                const usesPerDay = this.item.system.usesPerDay || 0;
                const usesRemaining = this.item.system.usesRemaining || usesPerDay;

                if (usesRemaining > 0) {
                    ui.notifications.info(`Gate activated! Duration: ${this.item.system.duration}`);
                    this.item.update({ "system.usesRemaining": usesRemaining - 1 });
                } else {
                    ui.notifications.warn("This gate cannot be used again today.");
                }
            });

            html.find('.reset-gate').click(ev => {
                ev.preventDefault();
                const usesPerDay = this.item.system.usesPerDay || 0;
                this.item.update({ "system.usesRemaining": usesPerDay });
                ui.notifications.info("Gate uses have been reset for a new day.");
            });
        }

        // Handle communication device usage
        if (this.item.type === 'communication') {
            html.find('.activate-relay').click(ev => {
                ev.preventDefault();
                const targetCode = html.find('.target-relay-code').val();

                if (targetCode) {
                    ui.notifications.info(`Attempting to establish connection with relay code: ${targetCode}`);
                } else {
                    ui.notifications.warn("Please enter a target relay code.");
                }
            });
        }

        // Poison: Roll Toxicity (NdT vs target Resilience).
        if (this.item.type === 'poison') {
            html.find('.roll-toxicity').click(async ev => {
                ev.preventDefault();
                const sys = this.item.system;
                const dice = Number(sys.toxicity) || 0;
                if (dice <= 0) return ui.notifications.warn("Set a Toxicity dice value first.");
                const roll = await new Roll(`${dice}d12`).evaluate();
                let successes = 0;
                roll.terms[0].results.forEach(d => {
                    if (d.result >= 12) successes += 2;
                    else if (d.result >= 8) successes += 1;
                });
                const adminLabel = html.find(`select[name="system.poisonType"] option[value="${sys.poisonType}"]`).text() || sys.poisonType;
                const onsetLabel = html.find(`select[name="system.onset"] option[value="${sys.onset}"]`).text() || sys.onset;
                const categoryLabel = html.find(`select[name="system.category"] option[value="${sys.category}"]`).text() || sys.category;
                ChatMessage.create({
                    speaker: this.item.parent ? ChatMessage.getSpeaker({ actor: this.item.parent }) : undefined,
                    flavor: `${this.item.name} — Toxicity vs Resilience`,
                    content: `<div class="thefade chat-card">
                        <h3>${this.item.name}</h3>
                        <p class="item-type-label">Poison · ${categoryLabel}</p>
                        <p><strong>Administering:</strong> ${adminLabel}</p>
                        <p><strong>Onset:</strong> ${onsetLabel}</p>
                        <p><strong>Successes:</strong> ${successes}</p>
                        ${sys.effect ? `<p><strong>Effect:</strong> ${sys.effect}</p>` : ""}
                        ${await roll.render()}
                    </div>`
                });
            });
        }

        // Disease: Roll Virality (NdT exposure check).
        if (this.item.type === 'disease') {
            html.find('.roll-virality').click(async ev => {
                ev.preventDefault();
                const sys = this.item.system;
                const dice = Number(sys.virality) || 0;
                if (dice <= 0) return ui.notifications.warn("Set a Virality dice value first.");
                const roll = await new Roll(`${dice}d12`).evaluate();
                let successes = 0;
                roll.terms[0].results.forEach(d => {
                    if (d.result >= 12) successes += 2;
                    else if (d.result >= 8) successes += 1;
                });
                const transmissionOptionMap = { airborne: "Airborne", contact: "Contact", fluid: "Fluid", ingested: "Ingested", injury: "Injury" };
                const transmissionLabel = (sys.transmission && typeof sys.transmission === "object")
                    ? Object.entries(sys.transmission).filter(([, v]) => v).map(([k]) => transmissionOptionMap[k] || k).join(" or ") || "—"
                    : (transmissionOptionMap[sys.transmission] || sys.transmission || "—");
                const durationTypeLabel = html.find(`select[name="system.durationType"] option[value="${sys.durationType}"]`).text() || sys.durationType;
                ChatMessage.create({
                    speaker: this.item.parent ? ChatMessage.getSpeaker({ actor: this.item.parent }) : undefined,
                    flavor: `${this.item.name} — Virality (${sys.viralityBand || ""})`,
                    content: `<div class="thefade chat-card">
                        <h3>${this.item.name}</h3>
                        <p class="item-type-label">Disease · ${transmissionLabel}</p>
                        <p><strong>Successes:</strong> ${successes}</p>
                        ${sys.incubation ? `<p><strong>Incubation:</strong> ${sys.incubation}</p>` : ""}
                        ${sys.duration ? `<p><strong>Duration:</strong> ${sys.duration} (${durationTypeLabel})</p>` : ""}
                        ${sys.treatmentDT ? `<p><strong>Treatment DT:</strong> ${sys.treatmentDT}</p>` : ""}
                        ${sys.effect ? `<p><strong>Effect:</strong> ${sys.effect}</p>` : ""}
                        ${await roll.render()}
                    </div>`
                });
            });
        }

        // Generic consume/use handler for potions, drugs, medical supplies, poisons
        if (['potion', 'drug', 'medical', 'poison'].includes(this.item.type)) {
            html.find('.consume-item').click(async ev => {
                ev.preventDefault();
                const item = this.item;
                const actor = item.parent;
                const qty = item.system.quantity ?? 1;
                if (qty <= 0) return ui.notifications.warn(`No ${item.name} remaining.`);
                await item.update({ "system.quantity": qty - 1 });
                const effect = item.system.effect || item.system.healingAmount || "";
                const duration = item.system.duration || "";
                ChatMessage.create({
                    speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
                    content: `<div class="thefade chat-card">
                        <h3>${item.name}</h3>
                        <p class="item-type-label">${item.type.charAt(0).toUpperCase() + item.type.slice(1)}</p>
                        ${effect ? `<p><strong>Effect:</strong> ${effect}</p>` : ""}
                        ${duration ? `<p><strong>Duration:</strong> ${duration}</p>` : ""}
                        <p class="qty-remaining">Remaining: ${qty - 1}</p>
                    </div>`
                });
            });
        }

        // Talent: Use button with uses-per-day tracking
        if (this.item.type === 'talent') {
            html.find('.use-talent').click(async ev => {
                ev.preventDefault();
                const item = this.item;
                const cur = item.system.currentUses ?? 0;
                const max = item.system.usesPerDay ?? 0;
                if (max > 0 && cur >= max) return ui.notifications.warn(`${item.name}: No uses remaining today.`);
                if (max > 0) await item.update({ "system.currentUses": cur + 1 });
                ChatMessage.create({
                    speaker: item.parent ? ChatMessage.getSpeaker({ actor: item.parent }) : undefined,
                    content: `<div class="thefade chat-card">
                        <h3>${item.name}</h3>
                        <p class="item-type-label">Talent</p>
                        ${item.system.description ? `<p>${item.system.description}</p>` : ""}
                        ${max > 0 ? `<p class="qty-remaining">Uses: ${cur + 1} / ${max}</p>` : ""}
                    </div>`
                });
            });
        }

        // Spell: Cast button — posts a chat card with spell details
        if (this.item.type === 'spell') {
            html.find('.cast-spell').click(async ev => {
                ev.preventDefault();
                const sys = this.item.system;
                const damageProfile = buildSpellDamageProfile(sys);
                const effectsProfile = buildSpellEffectsProfile(sys);
                const successRequirements = getSpellSuccessRequirements(sys);
                ChatMessage.create({
                    speaker: this.item.parent ? ChatMessage.getSpeaker({ actor: this.item.parent }) : undefined,
                    content: `<div class="thefade chat-card">
                        <h3>${this.item.name}</h3>
                        <p class="item-type-label">${sys.school || "Spell"}${sys.isDarkMagic ? " — Dark Magic" : ""}</p>
                        ${successRequirements.isRune ? `<p><strong>Checks:</strong> Symbology ${successRequirements.symbology} to draw, then Spellcasting ${successRequirements.spellcasting} to activate</p>` : ""}
                        ${sys.weapons ? `<p><strong>Weapons:</strong> ${sys.weapons}</p>` : ""}
                        ${sys.recipeCost ? `<p><strong>Recipe Cost:</strong> ${sys.recipeCost}</p>` : ""}
                        ${damageProfile.total ? `<p><strong>HP Damage:</strong> ${damageProfile.display}</p>` : ""}
                        ${effectsProfile.sanityDamage ? `<p><strong>Sanity Damage:</strong> ${effectsProfile.sanityDamage}</p>` : ""}
                        ${effectsProfile.statusEffects.length ? `<p><strong>Inflicts:</strong></p><ul>${effectsProfile.statusEffects.map(effect => `<li>${effect.display}</li>`).join("")}</ul>` : ""}
                        ${effectsProfile.buffEffects.length ? `<p><strong>Grants:</strong></p><ul>${effectsProfile.buffEffects.map(buff => `<li>${buff.display}</li>`).join("")}</ul>` : ""}
                        ${getSpellAttackTargets(sys).length ? `<p><strong>Attack:</strong> ${formatSpellAttackTargets(sys)}</p>` : ""}
                        ${getSpellAttackTargets(sys).map(defense => sys.attackEffects?.[defense]
                            ? `<p><strong>${defense} Effect:</strong> ${sys.attackEffects[defense]}</p>`
                            : "").join("")}
                        ${sys.range ? `<p><strong>Range:</strong> ${sys.range}</p>` : ""}
                        ${sys.time ? `<p><strong>Casting Time:</strong> ${sys.time}</p>` : ""}
                        ${!successRequirements.isRune ? `<p><strong>Successes Needed:</strong> ${formatSpellSuccessRequirements(sys)}</p>` : ""}
                        ${sys.bonusEffect ? `<p><strong>Bonus Effect:</strong> ${sys.bonusEffect}</p>` : ""}
                        ${this.item.system.description ? `<p>${this.item.system.description}</p>` : ""}
                    </div>`
                });
            });
        }

        // Checkbox for attuned items of power
        if (this.item.type === 'magicitem' && !isAttunementRemoved(game.settings?.get("thefade", "itemPowerAttunementRule"))) {
            html.find('input[name="system.attunement"]').change(async ev => {
                const isAttuned = ev.currentTarget.checked;
                if (isAttuned && this.item.parent?.documentName === "Actor") {
                    const current = countAttunements([...this.item.parent.items], game.settings.get("thefade", "itemPowerAttunementRule"));
                    const level = Number(this.item.parent.system.level) || 1;
                    const soul = Number(this.item.parent.system.attributes?.soul?.total ?? this.item.parent.system.attributes?.soul?.value ?? 1);
                    const maximum = Math.max(0, Math.floor(level / 4) + soul);
                    if (current >= maximum) {
                        ev.currentTarget.checked = false;
                        ui.notifications.warn(`Cannot attune to more items. Limit: ${maximum}.`);
                        return;
                    }
                }
                await this.item.update({ "system.attunement": isAttuned });

                if (isAttuned) {
                    ui.notifications.info(`${this.item.name} is now attuned to its owner.`);
                } else {
                    ui.notifications.info(`${this.item.name} is no longer attuned to anyone.`);
                }
            });
        }

        if (game.settings?.get("thefade", "itemPowerAttunementRule") === "technology") {
            html.find('input[name="system.technologyAttunement"]').change(async ev => {
                if (!ev.currentTarget.checked || this.item.parent?.documentName !== "Actor") return;
                const current = countAttunements([...this.item.parent.items], "technology");
                const level = Number(this.item.parent.system.level) || 1;
                const soul = Number(this.item.parent.system.attributes?.soul?.total ?? this.item.parent.system.attributes?.soul?.value ?? 1);
                const maximum = Math.max(0, Math.floor(level / 4) + soul);
                if (current >= maximum) {
                    ev.currentTarget.checked = false;
                    await this.item.update({ "system.technologyAttunement": false });
                    ui.notifications.warn(`Cannot attune to more items. Limit: ${maximum}.`);
                }
            });
        }

        // Bonuses UI — supports magicitem, talent, precept (top-level)
        // and path/species (per-ability). Each .bonus-section carries
        // its own data-bonus-path identifying where to persist the array.
        if (['magicitem', 'talent', 'precept', 'path', 'monsterpath', 'species', 'monsterspecies'].includes(this.item.type)) {
            // Read the array currently stored at a dotted path on the item.
            const getBonusesAt = (path) => {
                const parts = path.split('.');
                let cur = this.item;
                for (const p of parts) {
                    if (cur == null) return [];
                    cur = cur[p];
                }
                return Array.isArray(cur) ? cur : [];
            };

            // Collect bonus rows belonging to a single section and persist.
            const saveBonusesForSection = ($section) => {
                const path = $section.attr('data-bonus-path');
                if (!path) return;
                const bonuses = [];
                $section.find('.bonus-row').each((i, el) => {
                    bonuses.push(readMechanicalBonusRow($(el)));
                });
                this.item.update({ [path]: bonuses });
            };

            html.find('.bonus-row').each((i, el) => updateMechanicalBonusRow($(el)));

            html.find('.bonus-add').click(ev => {
                ev.preventDefault();
                const $section = $(ev.currentTarget).closest('.bonus-section');
                const path = $section.attr('data-bonus-path');
                if (!path) return;
                const bonuses = foundry.utils.deepClone(getBonusesAt(path));
                bonuses.push({ id: foundry.utils.randomID(16), type: "skill", target: "", value: 1 });
                this.item.update({ [path]: bonuses }).then(() => this.render(false));
            });

            html.find('.bonus-delete').click(ev => {
                ev.preventDefault();
                const $section = $(ev.currentTarget).closest('.bonus-section');
                const path = $section.attr('data-bonus-path');
                if (!path) return;
                const id = ev.currentTarget.dataset.bonusId;
                const bonuses = getBonusesAt(path).filter(b => b.id !== id);
                this.item.update({ [path]: bonuses }).then(() => this.render(false));
            });

            html.find('.bonus-type').change(ev => {
                const $row = $(ev.currentTarget).closest('.bonus-row');
                updateMechanicalBonusRow($row, { resetAmount: true });
                saveBonusesForSection($row.closest('.bonus-section'));
            });

            html.find('.bonus-target-control, .bonus-vulnerability-severity, .bonus-value').change(ev => {
                const $row = $(ev.currentTarget).closest('.bonus-row');
                if ($(ev.currentTarget).hasClass('bonus-universal-ability-target')) {
                    updateMechanicalBonusRow($row, { resetAmount: true });
                }
                saveBonusesForSection($row.closest('.bonus-section'));
            });
        }

        // Weapon quality controls
        if (this.item.type === 'weapon') {
            html.find('.weapon-quality-add').on('click', async ev => {
                ev.preventDefault();
                const id = $(ev.currentTarget).closest('.weapon-quality-selector').find('.weapon-quality-choice').val();
                if (!id) return;
                const qualityIds = [...new Set([...(this.item.system.qualityIds || []), id])];
                await this.item.update({ "system.qualityIds": qualityIds });
            });

            html.find('.weapon-quality-remove').on('click', async ev => {
                ev.preventDefault();
                const id = ev.currentTarget.dataset.qualityId;
                const qualityIds = (this.item.system.qualityIds || []).filter(value => value !== id);
                await this.item.update({ "system.qualityIds": qualityIds });
            });

        }

        // Typed damage components shared by weapon and spell sheets.
        if (this.item.type === 'weapon' || this.item.type === 'spell') {
            const updateDamageComponents = comps => {
                if (this.item.type === 'spell') {
                    const active = comps.filter(component => component.amount > 0);
                    return this.item.update({
                        "system.damageComponents": comps,
                        "system.damage": active.reduce((sum, component) => sum + component.amount, 0) || "",
                        "system.damageType": active[0]?.type || ""
                    });
                }
                return this.item.update({ "system.damageComponents": comps });
            };

            const saveDamageComponents = () => {
                const comps = [];
                html.find('.dmg-comp-row').each((i, el) => {
                    const $row = $(el);
                    comps.push({
                        id: $row.data('dmg-id'),
                        amount: Number($row.find('.dmg-comp-amount').val()) || 0,
                        type: $row.find('.dmg-comp-type').val() || "Ut"
                    });
                });
                updateDamageComponents(comps);
            };

            html.find('.dmg-comp-add').on('click', ev => {
                ev.preventDefault();
                const comps = foundry.utils.deepClone(this.item.system.damageComponents || []);
                comps.push({
                    id: foundry.utils.randomID(16),
                    amount: 0,
                    type: this.item.type === 'weapon' ? "B" : "Ut"
                });
                updateDamageComponents(comps);
            });

            html.find('.dmg-comp-delete').on('click', ev => {
                ev.preventDefault();
                const id = ev.currentTarget.dataset.dmgId;
                const comps = (this.item.system.damageComponents || []).filter(c => c.id !== id);
                updateDamageComponents(comps);
            });

            html.find('.dmg-comp-amount, .dmg-comp-type').on('change', () => saveDamageComponents());
        }

        // Structured spell outcomes: status conditions and descriptive buffs.
        if (this.item.type === 'spell') {
            const updateStatusEffects = effects => this.item.update({ "system.statusEffects": effects });
            const saveStatusEffects = () => {
                const effects = [];
                html.find('.spell-status-row:not(.spell-effect-row-header)').each((i, element) => {
                    const row = $(element);
                    effects.push({
                        id: row.data('effect-id') || foundry.utils.randomID(16),
                        status: row.find('.spell-status-type').val() || "pain",
                        intensity: row.find('.spell-status-intensity').val() || "",
                        duration: String(row.find('.spell-status-duration').val() || "").trim(),
                        notes: String(row.find('.spell-status-notes').val() || "").trim()
                    });
                });
                return updateStatusEffects(effects);
            };

            html.find('.spell-status-add').on('click', event => {
                event.preventDefault();
                const effects = foundry.utils.deepClone(this.item.system.statusEffects || []);
                effects.push({
                    id: foundry.utils.randomID(16),
                    status: "pain",
                    intensity: "trivial",
                    duration: "",
                    notes: ""
                });
                updateStatusEffects(effects);
            });

            html.find('.spell-status-delete').on('click', event => {
                event.preventDefault();
                const id = event.currentTarget.dataset.effectId;
                updateStatusEffects((this.item.system.statusEffects || []).filter((effect, index) =>
                    (effect.id || `status-${index}`) !== id
                ));
            });

            html.find('.spell-status-type, .spell-status-intensity, .spell-status-duration, .spell-status-notes')
                .on('change', () => saveStatusEffects());

            const updateBuffEffects = buffs => this.item.update({ "system.buffEffects": buffs });
            const saveBuffEffects = () => {
                const buffs = [];
                html.find('.spell-buff-row:not(.spell-effect-row-header)').each((i, element) => {
                    const row = $(element);
                    buffs.push({
                        id: row.data('buff-id') || foundry.utils.randomID(16),
                        name: String(row.find('.spell-buff-name').val() || "").trim(),
                        target: String(row.find('.spell-buff-target').val() || "").trim(),
                        duration: String(row.find('.spell-buff-duration').val() || "").trim(),
                        description: String(row.find('.spell-buff-description').val() || "").trim()
                    });
                });
                return updateBuffEffects(buffs);
            };

            html.find('.spell-buff-add').on('click', event => {
                event.preventDefault();
                const buffs = foundry.utils.deepClone(this.item.system.buffEffects || []);
                buffs.push({
                    id: foundry.utils.randomID(16),
                    name: "",
                    target: "",
                    duration: "",
                    description: ""
                });
                updateBuffEffects(buffs);
            });

            html.find('.spell-buff-delete').on('click', event => {
                event.preventDefault();
                const id = event.currentTarget.dataset.buffId;
                updateBuffEffects((this.item.system.buffEffects || []).filter((buff, index) =>
                    (buff.id || `buff-${index}`) !== id
                ));
            });

            html.find('.spell-buff-name, .spell-buff-target, .spell-buff-duration, .spell-buff-description')
                .on('change', () => saveBuffEffects());
        }

        // Enchantment powers + modifications (weapons and armor)
        if (this.item.type === 'weapon' || this.item.type === 'armor') {
            // Auto-fill enchantment price when toggling enchanted on (in addition to the
            // standard form update that sets isEnchanted itself).
            html.find('input[name="system.isEnchanted"]').on('change', ev => {
                const isEnchanted = ev.currentTarget.checked;
                if (!isEnchanted) return;
                if (this.item.system.enchantmentPrice) return;
                let suggested = 0;
                if (this.item.type === 'weapon') {
                    const skill = this.item.system.skill;
                    suggested = WEAPON_ENCHANT_BASE_PRICES[skill] ?? WEAPON_ENCHANT_BASE_PRICES.default;
                } else {
                    suggested = ARMOR_ENCHANT_BASE_PRICE;
                }
                this.item.update({ "system.enchantmentPrice": suggested });
            });

            // Auto-fill strengthening price when damage/AP increase changes
            if (this.item.type === 'weapon') {
                html.find('select[name="system.damageIncrease"]').on('change', ev => {
                    const inc = Number(ev.currentTarget.value) || 0;
                    this.item.update({ "system.strengtheningPrice": inc * inc * 1000 });
                });
            } else {
                html.find('select[name="system.apIncrease"]').on('change', ev => {
                    const inc = Number(ev.currentTarget.value) || 0;
                    const baseAP = Number(this.item.system.ap) || 0;
                    this.item.update({
                        "system.strengtheningPrice": inc * 500,
                        "system.currentAP": baseAP + inc
                    });
                });
            }

            // Save enchantment powers from DOM
            const saveEnchantmentPowers = () => {
                const powers = [];
                html.find('.ench-power-row').each((i, el) => {
                    const $row = $(el);
                    powers.push({
                        id: $row.data('ench-id'),
                        name: $row.find('.ench-power-name').val() || "",
                        description: $row.find('.ench-power-description').val() || "",
                        isDarkMagic: $row.find('.ench-power-dark-toggle').is(':checked')
                    });
                });
                this.item.update({ "system.enchantmentPowers": powers });
            };

            // Add enchantment power
            html.find('.ench-power-add').on('click', ev => {
                ev.preventDefault();
                const powers = foundry.utils.deepClone(this.item.system.enchantmentPowers || []);
                powers.push({ id: foundry.utils.randomID(16), name: "", description: "", isDarkMagic: false });
                this.item.update({ "system.enchantmentPowers": powers }).then(() => this.render(false));
            });

            // Delete enchantment power
            html.find('.ench-power-delete').on('click', ev => {
                ev.preventDefault();
                const id = ev.currentTarget.dataset.enchId;
                const powers = (this.item.system.enchantmentPowers || []).filter(p => p.id !== id);
                this.item.update({ "system.enchantmentPowers": powers }).then(() => this.render(false));
            });

            // Save enchantment power fields on change (inputs have no name attr, so
            // Foundry's form auto-submit will not catch them)
            html.find('.ench-power-name, .ench-power-description, .ench-power-dark-toggle').on('change', () => {
                saveEnchantmentPowers();
            });

            // Save modifications from DOM
            const saveModifications = () => {
                const mods = [];
                html.find('.mod-row').each((i, el) => {
                    const $row = $(el);
                    mods.push({
                        id: $row.data('mod-id'),
                        name: $row.find('.mod-name').val() || "",
                        description: $row.find('.mod-description').val() || "",
                        price: Number($row.find('.mod-price').val()) || 0
                    });
                });
                this.item.update({ "system.modifications": mods });
            };

            // Add modification
            html.find('.mod-add').on('click', ev => {
                ev.preventDefault();
                const mods = foundry.utils.deepClone(this.item.system.modifications || []);
                mods.push({ id: foundry.utils.randomID(16), name: "", description: "", price: 0 });
                this.item.update({ "system.modifications": mods }).then(() => this.render(false));
            });

            // Delete modification
            html.find('.mod-delete').on('click', ev => {
                ev.preventDefault();
                const id = ev.currentTarget.dataset.modId;
                const mods = (this.item.system.modifications || []).filter(m => m.id !== id);
                this.item.update({ "system.modifications": mods }).then(() => this.render(false));
            });

            // Save modification fields on change
            html.find('.mod-name, .mod-description, .mod-price').on('change', () => {
                saveModifications();
            });
        }

        // Species fields bypass the shared handler above because those sheets
        // manage their main form separately. Preserve their direct-save path
        // without binding every other item sheet twice.
        if (this.item.type === 'species' || this.item.type === 'monsterspecies') {
            html.find('input[name], select[name]:not([name="type"]), textarea[name]').change(ev => {
                const input = ev.currentTarget;
                if (input.closest('.bonus-section')) return;
                const fieldName = input.name;
                let value = input.type === 'checkbox' ? input.checked : input.value;

                if (input.dataset.dtype === 'Number') {
                    value = Number(value);
                    if (isNaN(value)) value = 0;
                }

                this.item.update({ [fieldName]: value });
            });
        }

        // Reset armor AP
        html.find('.reset-armor-ap').click(async ev => {
            ev.preventDefault();
            const li = $(ev.currentTarget).closest("[data-item-id]");
            const itemId = li.data("itemId");

            if (!itemId) return;

            const item = this.actor.items.get(itemId);
            if (!item || item.type !== "armor") return;

            // Convert to number to ensure consistent types; include strengthening bonus
            const maxAP = (Number(item.system.ap) || 0) + (Number(item.system.apIncrease) || 0);

            try {
                // Reset current AP to max AP
                await item.update({
                    "system.currentAP": maxAP
                });
                ui.notifications.info(`${item.name}'s armor protection has been restored to full.`);
            } catch (error) {
                console.error("Error resetting armor AP:", error);
                ui.notifications.error("Error resetting armor. Check console for details.");
            }
        });

        html.find('.reset-all-armor').click(async ev => {
            ev.preventDefault();

            const armorItems = this.actor.items.filter(i => i.type === "armor");
            if (armorItems.length === 0) {
                ui.notifications.warn("No armor items found.");
                return;
            }

            try {
                for (const armor of armorItems) {
                    const maxAP = (Number(armor.system.ap) || 0) + (Number(armor.system.apIncrease) || 0);
                    await armor.update({
                        "system.currentAP": maxAP
                    });
                }

                ui.notifications.info(`All armor has been restored to full protection.`);
            } catch (error) {
                console.error("Error resetting all armor:", error);
                ui.notifications.error("Error resetting all armor. Check console for details.");
            }
        });

        // Quick-add buttons for common path skill entries (bound on the sheet
        // so they work after every re-render, unlike DOMContentLoaded).
        html.find('.quick-add-btn').on('click', async (ev) => {
            ev.preventDefault();
            if (this.item.type !== 'path' && this.item.type !== 'monsterpath') return;

            const type = ev.currentTarget.dataset.type;
            let skillEntry;

            switch (type) {
                case 'choose-combat-1':
                    skillEntry = {
                        _id: foundry.utils.randomID(16),
                        name: "Choose 1 Combat Skill",
                        type: "skill",
                        system: {
                            rank: "learned",
                            category: "Combat",
                            attribute: "varies",
                            entryType: PATH_SKILL_TYPES.CHOOSE_CATEGORY,
                            chooseCount: 1,
                            chooseCategory: "Combat"
                        }
                    };
                    break;

                case 'choose-social-1':
                    skillEntry = {
                        _id: foundry.utils.randomID(16),
                        name: "Choose 1 Social Skill",
                        type: "skill",
                        system: {
                            rank: "learned",
                            category: "Social",
                            attribute: "presence",
                            entryType: PATH_SKILL_TYPES.CHOOSE_CATEGORY,
                            chooseCount: 1,
                            chooseCategory: "Social"
                        }
                    };
                    break;

                case 'choose-lore-1':
                    skillEntry = {
                        _id: foundry.utils.randomID(16),
                        name: "Choose 1 Lore Skill",
                        type: "skill",
                        system: {
                            rank: "learned",
                            category: "Knowledge",
                            attribute: "mind",
                            entryType: PATH_SKILL_TYPES.CHOOSE_LORE,
                            chooseCount: 1
                        }
                    };
                    break;

                case 'choose-craft-1':
                    skillEntry = {
                        _id: foundry.utils.randomID(16),
                        name: "Choose 1 Custom Craft Skill",
                        type: "skill",
                        system: {
                            rank: "learned",
                            category: "Craft",
                            attribute: "varies",
                            entryType: PATH_SKILL_TYPES.CHOOSE_CRAFT,
                            chooseCount: 1
                        }
                    };
                    break;

                case 'choose-any-1':
                    skillEntry = {
                        _id: foundry.utils.randomID(16),
                        name: "Choose 1 Any Skill",
                        type: "skill",
                        system: {
                            rank: "learned",
                            category: "Any",
                            attribute: "varies",
                            entryType: PATH_SKILL_TYPES.CHOOSE_ANY,
                            chooseCount: 1,
                            chooseCategory: "Any"
                        }
                    };
                    break;
            }

            if (skillEntry) {
                const pathSkills = foundry.utils.deepClone(this.item.system.pathSkills || []);
                pathSkills.push(skillEntry);

                await this.item.update({ "system.pathSkills": pathSkills });
                this.render(true);
                ui.notifications.info(`Added "${skillEntry.name}" to path skills`);
            }
        });

        const sections = ['path', 'talent', 'trait', 'precept'];

        sections.forEach(section => {
            // Checkbox toggle handler
            html.find(`.${section}-checkbox`).change(function () {
                const checkbox = $(this);
                const description = checkbox.siblings(`.${section}-description`);
                const icon = checkbox.siblings(`.${section}-header`).find(`.${section}-toggle-icon`);

                if (checkbox.is(':checked')) {
                    description.css('max-height', '500px');
                    description.css('padding', '10px');
                    icon.css('transform', 'rotate(180deg)');
                } else {
                    description.css('max-height', '0');
                    description.css('padding', '0');
                    icon.css('transform', 'rotate(0deg)');
                }
            });

            // Header click handler (to trigger checkbox)
            html.find(`.${section}-header`).click(function (e) {
                if ($(e.target).closest(`.${section}-controls`).length) return; // Don't trigger on control buttons
                const checkbox = $(this).siblings(`.${section}-checkbox`);
                checkbox.prop('checked', !checkbox.prop('checked')).trigger('change');
            });
        });

        if (this.item.type === 'monsterspecies') {
            html.find('.standard-attack-add').click(async ev => {
                ev.preventDefault();
                const standardAttacks = foundry.utils.deepClone(this.item.system.standardAttacks || []);
                standardAttacks.push({
                    id: foundry.utils.randomID(16),
                    mode: "grant",
                    weapons: []
                });
                await this.item.update({ "system.standardAttacks": standardAttacks });
                this.render(true);
            });

            html.find('.standard-attack-delete').click(async ev => {
                ev.preventDefault();
                const attackId = ev.currentTarget.closest('.standard-attack-entry')?.dataset.attackId;
                if (!attackId) return;
                const standardAttacks = (this.item.system.standardAttacks || []).filter(a => a.id !== attackId);
                await this.item.update({ "system.standardAttacks": standardAttacks });
                this.render(true);
            });

            html.find('.standard-attack-weapon-delete').click(async ev => {
                ev.preventDefault();
                const attackId = ev.currentTarget.closest('.standard-attack-entry')?.dataset.attackId;
                const weaponId = ev.currentTarget.closest('.standard-attack-weapon')?.dataset.weaponId;
                if (!attackId || !weaponId) return;
                const standardAttacks = foundry.utils.deepClone(this.item.system.standardAttacks || []);
                const attack = standardAttacks.find(a => a.id === attackId);
                if (!attack) return;
                attack.weapons = (attack.weapons || []).filter(w => w.id !== weaponId);
                await this.item.update({ "system.standardAttacks": standardAttacks });
                this.render(true);
            });

            html.find('.standard-attack-field').change(async ev => {
                ev.preventDefault();
                const entry = ev.currentTarget.closest('.standard-attack-entry');
                const attackId = entry?.dataset.attackId;
                const field = ev.currentTarget.dataset.field;
                if (!attackId || !field) return;

                const standardAttacks = foundry.utils.deepClone(this.item.system.standardAttacks || []);
                const attack = standardAttacks.find(a => a.id === attackId);
                if (!attack) return;

                let value = ev.currentTarget.value;
                if (ev.currentTarget.dataset.dtype === 'Number') {
                    value = Number(value);
                    if (!Number.isFinite(value)) value = 0;
                }

                foundry.utils.setProperty(attack, field, value);
                await this.item.update({ "system.standardAttacks": standardAttacks });
                this.render(false);
            });

            html.find('.standard-attack-drop-zone').on('dragover', ev => {
                ev.preventDefault();
                $(ev.currentTarget).addClass('drop-target');
            });

            html.find('.standard-attack-drop-zone').on('dragleave', ev => {
                ev.preventDefault();
                $(ev.currentTarget).removeClass('drop-target');
            });

            html.find('.standard-attack-drop-zone').on('drop', ev => {
                ev.preventDefault();
                $(ev.currentTarget).removeClass('drop-target');
                const dragEvent = ev.originalEvent || ev;
                this._onDrop(dragEvent);
            });
        }

        if (this.item.type === 'species' || this.item.type === 'monsterspecies') {
            html.find('input[name="system.biologicallyImmortal"]').change((ev) => {
                const isChecked = ev.currentTarget.checked;
                const ageInputs = html.find('input[name="system.youngAge"], input[name="system.adultAge"], input[name="system.oldAge"], input[name="system.maximumAge"]');

                if (isChecked) {
                    ageInputs.prop('disabled', true).addClass('disabled');
                } else {
                    ageInputs.prop('disabled', false).removeClass('disabled');
                }
            });

            // Set initial state on render
            const immortalCheckbox = html.find('input[name="system.biologicallyImmortal"]');
            if (immortalCheckbox.is(':checked')) {
                const ageInputs = html.find('input[name="system.youngAge"], input[name="system.adultAge"], input[name="system.oldAge"], input[name="system.maximumAge"]');
                ageInputs.prop('disabled', true).addClass('disabled');
            }
        }
    }

    /**
    * Prepare path skills for display
    * @param {Object} sheetData - Sheet data object
    */
    _preparePathSkills(sheetData) {
        if (this.item.type !== 'path' && this.item.type !== 'monsterpath') return;

        const pathSkills = [];

        if (this.item.system.pathSkills && Array.isArray(this.item.system.pathSkills)) {
            for (const skillData of this.item.system.pathSkills) {
                const processedSkill = {
                    _id: skillData._id || foundry.utils.randomID(16),
                    name: skillData.name,
                    system: skillData.system || {},
                    img: skillData.img || "icons/svg/item-bag.svg",
                    rank: skillData.system?.rank || skillData.rank || 'learned'  // ADD THIS LINE
                };

                // Determine entry type and set display properties
                const entryType = skillData.system?.entryType || PATH_SKILL_TYPES.SPECIFIC_SKILL;

                switch (entryType) {
                    case PATH_SKILL_TYPES.SPECIFIC_SKILL:
                        processedSkill.entryTypeDisplay = "Core Skill";
                        processedSkill.entryTypeClass = "specific";
                        processedSkill.isChoiceEntry = false;
                        processedSkill.isCustomEntry = false;
                        break;

                    case PATH_SKILL_TYPES.SPECIFIC_CUSTOM:
                        processedSkill.entryTypeDisplay = "Custom Skill";
                        processedSkill.entryTypeClass = "custom";
                        processedSkill.isChoiceEntry = false;
                        processedSkill.isCustomEntry = true;
                        break;

                    case PATH_SKILL_TYPES.CHOOSE_CATEGORY:
                        processedSkill.entryTypeDisplay = "Choose Category";
                        processedSkill.entryTypeClass = "choice";
                        processedSkill.isChoiceEntry = true;
                        processedSkill.isCustomEntry = false;
                        break;

                    case PATH_SKILL_TYPES.CHOOSE_ANY:
                        processedSkill.entryTypeDisplay = "Choose Any";
                        processedSkill.entryTypeClass = "choice";
                        processedSkill.isChoiceEntry = true;
                        processedSkill.isCustomEntry = false;
                        break;

                    case PATH_SKILL_TYPES.CHOOSE_LORE:
                        processedSkill.entryTypeDisplay = "Choose Lore";
                        processedSkill.entryTypeClass = "choice";
                        processedSkill.isChoiceEntry = true;
                        processedSkill.isCustomEntry = true;
                        break;

                    case PATH_SKILL_TYPES.CHOOSE_PERFORM:
                        processedSkill.entryTypeDisplay = "Choose Perform";
                        processedSkill.entryTypeClass = "choice";
                        processedSkill.isChoiceEntry = true;
                        processedSkill.isCustomEntry = true;
                        break;

                    case PATH_SKILL_TYPES.CHOOSE_CRAFT:
                        processedSkill.entryTypeDisplay = "Choose Craft";
                        processedSkill.entryTypeClass = "choice";
                        processedSkill.isChoiceEntry = true;
                        processedSkill.isCustomEntry = true;
                        break;

                    default:
                        processedSkill.entryTypeDisplay = "Unknown";
                        processedSkill.entryTypeClass = "unknown";
                        processedSkill.isChoiceEntry = false;
                        processedSkill.isCustomEntry = false;
                }

                pathSkills.push(processedSkill);
            }
        }

        sheetData.pathSkills = pathSkills;
    }

    /**
    * Generate options for core skills dropdown
    */
    _generateCoreSkillOptions() {
        const options = DEFAULT_SKILLS.map(skill =>
            `<option value="${skill.name}">${skill.name} (${skill.category})</option>`
        ).join('');
        return options;
    }

    /**
    * Show dialog for browsing and adding existing skills to paths
    * This is for adding core skills to paths via browsing
    */
    _showPathSkillBrowserDialog() {
        // Open skill compendium for browsing
        openCompendiumBrowser("skill");

        // Listen for skill selection
        const self = this;
        const handler = function (e) {
            const skill = e.detail.item;

            if (skill && skill.type === "skill") {
                // Add as specific skill entry
                const pathSkills = foundry.utils.deepClone(self.item.system.pathSkills || []);

                // Check if already exists
                const exists = pathSkills.some(s => s.name === skill.name);

                if (!exists) {
                    const skillEntry = {
                        _id: foundry.utils.randomID(16),
                        name: skill.name,
                        type: "skill",
                        system: {
                            rank: "learned",
                            category: skill.system.category,
                            attribute: skill.system.attribute,
                            entryType: PATH_SKILL_TYPES.SPECIFIC_SKILL
                        }
                    };

                    pathSkills.push(skillEntry);
                    self.item.update({ "system.pathSkills": pathSkills });
                    ui.notifications.info(`Added ${skill.name} to path skills`);
                    self.render(true);
                } else {
                    ui.notifications.warn(`${skill.name} is already in this path`);
                }
            }

            document.removeEventListener("compendiumSelection", handler);
        };

        document.addEventListener("compendiumSelection", handler);
    }

    /**
    * Process the path skill entry creation
    */
    async _processPathSkillEntry(html) {
        const entryType = html.find('#entry-type').val();
        const targetRank = html.find('#target-rank').val();

        let skillEntry;

        switch (entryType) {
            case 'specific-skill':
                const skillName = html.find('#specific-skill').val();
                const coreSkill = DEFAULT_SKILLS.find(s => s.name === skillName);
                if (!coreSkill) {
                    ui.notifications.error("Core skill not found");
                    return;
                }

                skillEntry = {
                    _id: foundry.utils.randomID(16),
                    name: skillName,
                    type: "skill",
                    system: {
                        rank: targetRank,
                        category: coreSkill.category,
                        attribute: coreSkill.attribute,
                        entryType: PATH_SKILL_TYPES.SPECIFIC_SKILL
                    }
                };
                break;

            case 'custom-craft':
                const craftName = html.find('#custom-name').val().trim();
                if (!craftName) {
                    ui.notifications.error("Craft skill name is required");
                    return;
                }

                skillEntry = {
                    _id: foundry.utils.randomID(16),
                    name: `Craft (${craftName})`,
                    type: "skill",
                    system: {
                        rank: targetRank,
                        category: "Craft",
                        attribute: "mind",
                        entryType: PATH_SKILL_TYPES.SPECIFIC_CUSTOM,
                        skillType: "craft",
                        subtype: craftName
                    }
                };
                break;

            case 'custom-lore':
                const loreSubject = html.find('#custom-name').val().trim();
                if (!loreSubject) {
                    ui.notifications.error("Lore subject is required");
                    return;
                }

                skillEntry = {
                    _id: foundry.utils.randomID(16),
                    name: `Lore (${loreSubject})`,
                    type: "skill",
                    system: {
                        rank: targetRank,
                        category: "Knowledge",
                        attribute: "mind",
                        entryType: PATH_SKILL_TYPES.SPECIFIC_CUSTOM,
                        skillType: "lore",
                        subtype: loreSubject
                    }
                };
                break;

            case 'custom-perform':
                const performType = html.find('#custom-name').val().trim();
                if (!performType) {
                    ui.notifications.error("Performance type is required");
                    return;
                }

                skillEntry = {
                    _id: foundry.utils.randomID(16),
                    name: `Perform (${performType})`,
                    type: "skill",
                    system: {
                        rank: targetRank,
                        category: "Physical",
                        attribute: "finesse_presence",
                        entryType: PATH_SKILL_TYPES.SPECIFIC_CUSTOM,
                        skillType: "perform",
                        subtype: performType
                    }
                };
                break;

            case 'choose-category':
                const category = html.find('#choose-category').val();
                const count = parseInt(html.find('#choose-count').val());

                skillEntry = {
                    _id: foundry.utils.randomID(16),
                    name: `Choose ${count} ${category} Skill${count > 1 ? 's' : ''}`,
                    type: "skill",
                    system: {
                        rank: targetRank,
                        category: category,
                        attribute: "varies",
                        entryType: PATH_SKILL_TYPES.CHOOSE_CATEGORY,
                        chooseCount: count,
                        chooseCategory: category
                    }
                };
                break;

            case 'choose-any':
                const anyCount = parseInt(html.find('#choose-count').val());

                skillEntry = {
                    _id: foundry.utils.randomID(16),
                    name: `Choose ${anyCount} Any Skill${anyCount > 1 ? 's' : ''}`,
                    type: "skill",
                    system: {
                        rank: targetRank,
                        category: "Any",
                        attribute: "varies",
                        entryType: PATH_SKILL_TYPES.CHOOSE_ANY,
                        chooseCount: anyCount,
                        chooseCategory: "Any"
                    }
                };
                break;

            case 'choose-lore':
                const loreCount = parseInt(html.find('#choose-count').val());

                skillEntry = {
                    _id: foundry.utils.randomID(16),
                    name: `Choose ${loreCount} Lore Skill${loreCount > 1 ? 's' : ''}`,
                    type: "skill",
                    system: {
                        rank: targetRank,
                        category: "Knowledge",
                        attribute: "mind",
                        entryType: PATH_SKILL_TYPES.CHOOSE_LORE,
                        chooseCount: loreCount
                    }
                };
                break;

            case 'choose-perform':
                const performCount = parseInt(html.find('#choose-count').val());

                skillEntry = {
                    _id: foundry.utils.randomID(16),
                    name: `Choose ${performCount} Perform Skill${performCount > 1 ? 's' : ''}`,
                    type: "skill",
                    system: {
                        rank: targetRank,
                        category: "Physical",
                        attribute: "finesse_presence",
                        entryType: PATH_SKILL_TYPES.CHOOSE_PERFORM,
                        chooseCount: performCount
                    }
                };
                break;

            case 'choose-craft':
                const craftCount = parseInt(html.find('#choose-count').val());

                skillEntry = {
                    _id: foundry.utils.randomID(16),
                    name: `Choose ${craftCount} Custom Craft Skill${craftCount > 1 ? 's' : ''}`,
                    type: "skill",
                    system: {
                        rank: targetRank,
                        category: "Craft",
                        attribute: "varies",
                        entryType: PATH_SKILL_TYPES.CHOOSE_CRAFT,
                        chooseCount: craftCount
                    }
                };
                break;

            default:
                ui.notifications.error("Invalid entry type");
                return;
        }

        // Add to path skills
        const pathSkills = foundry.utils.deepClone(this.item.system.pathSkills || []);
        pathSkills.push(skillEntry);

        await this.item.update({ "system.pathSkills": pathSkills });
        this.render(true);
        ui.notifications.info(`Added "${skillEntry.name}" to path skills`);
    }

    async _showPathSkillCreationDialog() {
        return new Promise((resolve) => {
            const dialog = new Dialog({
                title: "Add Path Skill Entry",
                content: `
            <form>
                <div class="form-group">
                    <label>Entry Type:</label>
                    <select id="entry-type" name="entryType">
                        <option value="specific-skill">Specific Core Skill</option>
                        <option value="custom-craft">Custom Craft Skill</option>
                        <option value="custom-lore">Lore Skill</option>
                        <option value="custom-perform">Perform Skill</option>
                        <option value="choose-category">Choose from Category</option>
                        <option value="choose-any">Choose Any Skills</option>
                        <option value="choose-lore">Choose Lore Skills</option>
                        <option value="choose-perform">Choose Perform Skills</option>
                        <option value="choose-craft">Choose Custom Craft Skills</option>
                    </select>
                </div>
                
                <!-- Target Rank -->
                <div class="form-group">
                    <label>Target Rank:</label>
                    <select id="target-rank" name="targetRank">
                        <option value="learned" selected>Learned</option>
                        <option value="practiced">Practiced</option>
                        <option value="adept">Adept</option>
                        <option value="experienced">Experienced</option>
                        <option value="expert">Expert</option>
                        <option value="mastered">Mastered</option>
                    </select>
                </div>

                <!-- Category Selection (for choose-category) -->
                <div class="form-group" id="category-group" style="display: none;">
                    <label>Category:</label>
                    <select id="choose-category">
                        <option value="Combat">Combat</option>
                        <option value="Social">Social</option>
                        <option value="Physical">Physical</option>
                        <option value="Knowledge">Knowledge</option>
                        <option value="Magical">Magical</option>
                        <option value="Sense">Sense</option>
                        <option value="Craft">Craft</option>
                    </select>
                </div>

                <!-- Count Selection (for choose types) -->
                <div class="form-group" id="count-group" style="display: none;">
                    <label>Number to Choose:</label>
                    <select id="choose-count">
                        <option value="1" selected>1</option>
                        <option value="2">2</option>
                        <option value="3">3</option>
                        <option value="4">4</option>
                        <option value="5">5</option>
                        <option value="6">6</option>
                        <option value="7">7</option>
                        <option value="8">8</option>
                        <option value="9">9</option>
                        <option value="10">10</option>
                    </select>
                </div>

                <!-- Custom Name (for custom skills) -->
                <div class="form-group" id="custom-name-group" style="display: none;">
                    <label id="custom-name-label">Custom Name:</label>
                    <input type="text" id="custom-name" placeholder="Enter name">
                </div>

                <!-- Specific Skill Selection -->
                <div class="form-group" id="specific-skill-group" style="display: none;">
                    <label>Core Skill:</label>
                    <select id="specific-skill">
                        ${this._generateCoreSkillOptions()}
                    </select>
                </div>
            </form>
            
            <script>
                // Handle form visibility based on entry type
                document.getElementById('entry-type').addEventListener('change', function() {
                    const entryType = this.value;
                    const categoryGroup = document.getElementById('category-group');
                    const countGroup = document.getElementById('count-group');
                    const customNameGroup = document.getElementById('custom-name-group');
                    const specificSkillGroup = document.getElementById('specific-skill-group');
                    const customNameLabel = document.getElementById('custom-name-label');
                    
                    // Hide all groups first
                    categoryGroup.style.display = 'none';
                    countGroup.style.display = 'none';
                    customNameGroup.style.display = 'none';
                    specificSkillGroup.style.display = 'none';
                    
                    // Show relevant groups based on type
                    if (entryType === 'choose-category') {
                        categoryGroup.style.display = 'block';
                        countGroup.style.display = 'block';
                    } else if (entryType.startsWith('choose-')) {
                        countGroup.style.display = 'block';
                    } else if (entryType.startsWith('custom-')) {
                        customNameGroup.style.display = 'block';
                        if (entryType === 'custom-craft') {
                            customNameLabel.textContent = 'Craft Type:';
                        } else if (entryType === 'custom-lore') {
                            customNameLabel.textContent = 'Lore Subject:';
                        } else if (entryType === 'custom-perform') {
                            customNameLabel.textContent = 'Performance Type:';
                        }
                    } else if (entryType === 'specific-skill') {
                        specificSkillGroup.style.display = 'block';
                    }
                });
            </script>
            `,
                buttons: {
                    add: {
                        icon: '<i class="fas fa-plus"></i>',
                        label: "Add Entry",
                        callback: async html => {
                            await this._processPathSkillEntry(html);
                            resolve(true);
                        }
                    },
                    cancel: {
                        icon: '<i class="fas fa-times"></i>',
                        label: "Cancel",
                        callback: () => resolve(false)
                    }
                },
                default: "add",
                close: () => resolve(false)
            });
            dialog.render(true);
        });
    }

    /**
    * Handle ability deletion (both path and species abilities)
    * @param {Event} event - Delete event
    */
    async _onAbilityDelete(event) {
        event.preventDefault();

        const abilityItem = event.currentTarget.closest(".ability-item");
        if (!abilityItem) return;

        const abilityId = abilityItem.dataset.abilityId;
        if (!abilityId) return;

        // Determine whether we're dealing with path or species
        let updateData = {};

        if (this.item.type === 'path' || this.item.type === 'monsterpath') {
            const abilities = foundry.utils.deepClone(this.item.system.abilities || {});
            if (abilities[abilityId]) {
                delete abilities[abilityId];
                updateData = {
                    "system.abilities": abilities
                };
            }
        }
        else if (this.item.type === 'species' || this.item.type === 'monsterspecies') {
            const abilities = foundry.utils.deepClone(this.item.system.speciesAbilities || {});
            if (abilities[abilityId]) {
                delete abilities[abilityId];
                updateData = {
                    "system.speciesAbilities": abilities
                };
            }
        }

        // Only update if we found something to delete
        if (Object.keys(updateData).length > 0) {
            await this.item.update(updateData);
            this.render(true);
        }
    }

    async _resolveDroppedItem(dragData) {
        let itemDoc;

        try {
            if (dragData.uuid) {
                itemDoc = await fromUuid(dragData.uuid);
            } else if (dragData.pack && dragData.id) {
                const pack = game.packs.get(dragData.pack);
                if (pack) itemDoc = await pack.getDocument(dragData.id);
            } else if (dragData.data) {
                itemDoc = dragData.data;
            }
        } catch (err) {
            console.error("Error loading dropped item:", err);
        }

        return itemDoc || null;
    }

    _weaponDropToStandardAttackWeapon(itemDoc) {
        const itemData = itemDoc?.toObject
            ? itemDoc.toObject()
            : foundry.utils.deepClone(itemDoc);

        if (!itemData || itemData.type !== "weapon") return null;

        return {
            id: foundry.utils.randomID(16),
            name: itemData.name,
            img: itemData.img || "icons/svg/sword.svg",
            type: "weapon",
            system: foundry.utils.deepClone(itemData.system || {})
        };
    }

    async _addWeaponToStandardAttackGroup(attackId, weaponData) {
        let standardAttacks = foundry.utils.deepClone(this.item.system.standardAttacks || []);
        if (!Array.isArray(standardAttacks)) standardAttacks = [];

        let attack = attackId ? standardAttacks.find(a => a.id === attackId) : null;
        if (!attack) {
            attack = {
                id: foundry.utils.randomID(16),
                mode: "grant",
                weapons: []
            };
            standardAttacks.push(attack);
        }

        if (!Array.isArray(attack.weapons)) attack.weapons = [];
        const exists = attack.weapons.some(w => w.name === weaponData.name);
        if (exists) {
            ui.notifications.warn(`${weaponData.name} is already in this standard attack group.`);
            return;
        }

        attack.weapons.push(weaponData);
        await this.item.update({ "system.standardAttacks": standardAttacks });
        this.render(true);
        ui.notifications.info(`Added ${weaponData.name} to ${this.item.name} standard attacks.`);
    }

    async _onRollHazard(event) {
        event.preventDefault();
        const targetToken = Array.from(game.user?.targets || [])[0] || canvas.tokens?.controlled?.[0];
        const targetActor = targetToken?.actor;
        if (!targetActor) {
            ui.notifications.warn("Target one token (or control one token) before triggering this trap or hazard.");
            return;
        }

        const system = this.item.system;
        const attackDice = Math.max(0, Number(system.attackDice) || 0);
        const defenseKey = system.defense || "none";
        const defense = defenseKey === "none"
            ? 0
            : Number(targetActor.system?.[`total${defenseKey.charAt(0).toUpperCase()}${defenseKey.slice(1)}`]
                ?? targetActor.system?.defenses?.[defenseKey]
                ?? 0);

        let attackRoll = null;
        let successes = 0;
        let hit = attackDice <= 0 || defenseKey === "none";
        if (attackDice > 0 && defenseKey !== "none") {
            attackRoll = await new Roll(`${attackDice}d12`).evaluate();
            for (const die of attackRoll.dice[0]?.results || []) {
                if (die.result === 12) successes += 2;
                else if (die.result >= 8) successes += 1;
            }
            hit = successes >= defense;
        }

        let damage = 0;
        let damageRoll = null;
        if (hit && String(system.damage ?? "0").trim() !== "0") {
            try {
                damageRoll = await new Roll(String(system.damage)).evaluate();
                damage = Math.max(0, Number(damageRoll.total) || 0);
            } catch (error) {
                console.error("The Fade | Invalid trap/hazard damage formula", error);
                ui.notifications.error(`Invalid damage formula: ${system.damage}`);
                return;
            }
        }

        const targetUuid = targetToken.document?.uuid || targetActor.uuid;
        const rollHTML = attackRoll ? await attackRoll.render() : "";
        const damageHTML = damageRoll && String(system.damage) !== String(damage) ? `<p>Damage roll: ${await damageRoll.render()}</p>` : "";
        const resultLabel = hit ? "Hit" : "Miss";
        const itemName = escapeHTML(this.item.name);
        const targetName = escapeHTML(targetActor.name);
        const damageType = escapeHTML(system.damageType || "Ut");
        const damageTrack = system.damageTrack === "sanity" ? "sanity" : "hp";
        const effect = escapeHTML(system.effect || "");
        const applyButton = hit && damage > 0
            ? `<button type="button" class="apply-damage-btn"><i class="fas fa-heart-broken"></i> Apply ${damage} Damage</button>`
            : "";
        const content = `
            <div class="thefade attack-card hazard-card"
                data-target-uuid="${escapeHTML(targetUuid)}"
                data-hit-location="body"
                data-called-shot="0"
                data-base-damage="${damage}"
                data-damage-type="${damageType}"
                data-damage-track="${damageTrack}"
                data-bypass-armor="${system.bypassArmor ? "1" : "0"}"
                data-weapon-name="${itemName}">
                <h3>${itemName}</h3>
                <p><strong>${targetName}</strong> - ${resultLabel}${attackRoll ? ` (${successes} successes vs. ${escapeHTML(defenseKey)} ${defense})` : " (automatic)"}</p>
                ${rollHTML}${damageHTML}
                ${hit ? `<p>Damage: <strong class="base-damage-value">${damage}</strong> ${damageType} to ${damageTrack === "sanity" ? "Sanity" : "HP"}</p>` : ""}
                ${effect ? `<p><strong>Effect:</strong> ${effect}</p>` : ""}
                ${applyButton}
            </div>`;
        await ChatMessage.create({ speaker:ChatMessage.getSpeaker({ actor:targetActor }), content });
    }

    /**
    * Handle dropping data on the item sheet
    * @param {Event} event - Drop event
    */
    async _onDrop(event) {
        event.preventDefault();

        // Get dropped data
        let dragData;
        try {
            // Use originalEvent as a fallback if available
            const dataTransfer = event.dataTransfer || (event.originalEvent && event.originalEvent.dataTransfer);

            if (!dataTransfer) {
                console.error("No dataTransfer found in the event");
                return false;
            }

            const data = dataTransfer.getData('text/plain');
            if (!data) {
                console.error("No data found in dataTransfer");
                return false;
            }

            dragData = JSON.parse(data);
        } catch (err) {
            console.error("Error parsing drop data:", err);
            return false;
        }

        if (this.item.type === "monsterspecies") {
            if (dragData.type !== "Item") return super._onDrop(event);

            const itemDoc = await this._resolveDroppedItem(dragData);
            const weaponData = this._weaponDropToStandardAttackWeapon(itemDoc);
            if (!weaponData) {
                ui.notifications.warn("Only weapons can be dropped into Standard Attacks.");
                return false;
            }

            const attackId = event.target?.closest?.('.standard-attack-entry')?.dataset?.attackId || null;
            await this._addWeaponToStandardAttackGroup(attackId, weaponData);
            return true;
        }

        // Only process if this is a path sheet
        if (this.item.type !== 'path' && this.item.type !== 'monsterpath') {
            return super._onDrop(event);
        }

        // Handle dropping a skill
        if (dragData.type === "Item") {
            let skillDoc = await this._resolveDroppedItem(dragData);

            // Check if we got a skill
            if (!skillDoc) {
                return false;
            }

            // Check if it's a skill type
            const isSkill = skillDoc.type === "skill" ||
                (skillDoc.data && skillDoc.data.type === "skill") ||
                (skillDoc.system && skillDoc.system.rank);

            if (!isSkill) {
                ui.notifications.warn("Only skills can be added to paths.");
                return false;
            }

            // Get skill data
            let skillData;
            if (skillDoc.toObject) {
                skillData = skillDoc.toObject();
            } else {
                skillData = foundry.utils.deepClone(skillDoc);
            }

            // Initialize path skills array if needed
            let pathSkills = foundry.utils.deepClone(this.item.system.pathSkills || []);
            if (!Array.isArray(pathSkills)) {
                pathSkills = [];
            }

            // Check for duplicate
            const isDuplicate = pathSkills.some(s => s.name === skillData.name);
            if (isDuplicate) {
                ui.notifications.warn(`${skillData.name} is already added to this path.`);
                return false;
            }

            // Add unique ID if needed
            if (!skillData._id) {
                skillData._id = foundry.utils.randomID(16);
            }

            // Normalize into a path-skill entry so applyPathSkillModifications
            // can act on it. Skills are no longer Items on the actor; the entry
            // here is plain data describing which core skill to bump.
            const skillSys = skillData.system || {};
            const pathEntry = {
                _id: skillData._id,
                name: skillData.name,
                img: skillData.img,
                system: {
                    rank: skillSys.rank || "learned",
                    category: skillSys.category,
                    attribute: skillSys.attribute,
                    entryType: PATH_SKILL_TYPES.SPECIFIC_SKILL
                }
            };

            // Add to path skills and update
            pathSkills.push(pathEntry);
            await this.item.update({
                "system.pathSkills": pathSkills
            });

            // Show success and refresh
            ui.notifications.info(`Added ${pathEntry.name} to ${this.item.name}`);
            this.render(true);
            return true;
        }

        // Pass to parent for other drop types
        return super._onDrop(event);
    }


}

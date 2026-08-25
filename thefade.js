// Entry point for The Fade system; registers documents, sheets, and hooks.
import { PATH_SKILL_TYPES } from './src/constants.js';
import { applyBonusHandlers } from './src/chat.js';
import {
    getRankValue, initializeDefaultSkills, createCustomSkill,
    showChooseRegularSkillsDialog, showChooseLoreSkillsDialog,
    showChoosePerformSkillsDialog, showChooseCraftSkillsDialog,
    applyPathSkillModifications
} from './src/helpers.js';
import { TheFadeActor } from './src/actor.js';
import { TheFadeItem } from './src/item.js';
import { TheFadeItemSheet } from './src/item-sheet.js';
import { TheFadeCharacterSheet } from './src/character-sheet.js';
import { TheFadeNPCSheet } from './src/npc-sheet.js';
import { TheFadePartySheet } from './src/party-sheet.js';
import { TheFadeShopSheet } from './src/shop-sheet.js';
import { computePerRoundDamage, registerTheFadeStatusEffects } from './src/conditions.js';
import { getActiveTemporaryBonusEntries } from './src/abilities.js';
import { normalizeMechanicalBonus } from './src/mechanical-bonuses.js';
import './src/token-facing.js';
import { registerTokenActionHud } from './src/integrations/token-action-hud/index.js';
import { migrateAllActorSkills } from './src/skills.js';
import { registerIgnitionHooks } from './src/ignition.js';
import {
    getDefaultEncounterState, getDefaultSkillChallengeState, openGMToolkit
} from './src/gm-tools.js';

registerTokenActionHud();
registerIgnitionHooks();

async function refreshTemporaryAbilityBonuses(actors) {
    const unique = [...new Map((actors || []).filter(Boolean).map(actor => [actor.id, actor])).values()];
    for (const actor of unique) {
        const stored = Array.isArray(actor.system?.temporaryBonuses) ? actor.system.temporaryBonuses : [];
        if (!stored.length) continue;
        const active = getActiveTemporaryBonusEntries(actor);
        if (game.user?.isGM && active.length !== stored.length) {
            await actor.update({ "system.temporaryBonuses": foundry.utils.deepClone(active) });
        } else {
            actor.reset();
            if (actor.sheet?.rendered) actor.sheet.render(false);
        }
    }
}

Hooks.on("updateCombat", (combat, changes) => {
    if (!("round" in (changes || {})) && !("turn" in (changes || {}))) return;
    refreshTemporaryAbilityBonuses(combat.combatants.map(combatant => combatant.actor));
});
Hooks.on("deleteCombat", () => refreshTemporaryAbilityBonuses(game.actors?.contents || []));
Hooks.on("updateWorldTime", () => refreshTemporaryAbilityBonuses(game.actors?.contents || []));

// Keep the toolkit in one consistent GM-only location: directly below the
// core Unconstrained Movement tool in the left Token Controls toolbar.
Hooks.on("getSceneControlButtons", controls => {
    const tools = controls?.tokens?.tools;
    if (!tools) return;
    tools.thefadeGMToolkit = {
        name: "thefadeGMToolkit",
        order: 5,
        title: "THEFADE.GMToolkitLabel",
        icon: "fa-solid fa-toolbox",
        button: true,
        visible: game.user?.isGM === true,
        onChange: () => openGMToolkit()
    };
});

const PATH_ITEM_TYPES = ["path", "monsterpath"];
const SPECIES_ITEM_TYPES = ["species", "monsterspecies"];


/**
 * Register all item sheet types for the system
 */
function registerItemSheets() {
    Items.registerSheet("thefade", TheFadeItemSheet, {
        types: [
            "weapon", "armor", "skill", "path", "monsterpath", "spell", "alchemical", "talent", "trait", "precept",
            "species", "monsterspecies", "drug", "poison", "disease", "biological", "medical", "travel",
            "mount", "vehicle", "musical", "potion", "staff", "wand", "gate",
            "communication", "containment", "dream", "fleshcraft", "magicitem", "clothing",
            "mutation", "heritage", "trap", "hazard", "downtime"
        ],
        makeDefault: true
    });
}

// --------------------------------------------------------------------
// CHAT MESSAGE HANDLERS
// --------------------------------------------------------------------

/**
* Handle bonus options in chat messages
* @param {HTMLElement} html - Chat message HTML
*/
/**
* Chat message rendering hook - add interactive elements to chat
*/
Hooks.on("renderChatMessage", (message, html, data) => {
    applyBonusHandlers(html);
});

/**
* Apply system theme class to dialog apps rendered from this system so that
* CSS in styles/thefade.css can style them. Keeps each new Dialog() call clean.
*/
Hooks.on("renderDialog", (app, html, data) => {
    const el = html?.[0] ?? html;
    if (el && el.classList && !el.classList.contains("thefade")) {
        el.classList.add("thefade");
    }
});

/**
 * Turn-start periodic damage hook: applies Bleed (and any future
 * damage-per-round condition) to the combatant whose turn just started.
 * Only the active GM executes the update to avoid duplicate damage.
 */
Hooks.on("combatTurn", async (combat, updateData, updateOptions) => {
    if (!game.user?.isGM) return;
    try {
        const nextTurnIndex = updateData?.turn ?? combat?.turn;
        const combatant = combat?.turns?.[nextTurnIndex];
        const actor = combatant?.actor;
        if (!actor || !["character","npc"].includes(actor.type)) return;

        const ticks = computePerRoundDamage(actor.system?.conditions);
        if (!ticks.length) return;

        const total = ticks.reduce((sum, t) => sum + t.damage, 0);
        const currentHP = Number(actor.system?.hp?.value ?? 0);
        const newHP = currentHP - total;

        await actor.update({ "system.hp.value": newHP });

        const lines = ticks.map(t => `<li>${t.label} (${t.intensity}): ${t.damage} damage</li>`).join("");
        ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<p><strong>${actor.name}</strong> suffers periodic damage at turn start:</p><ul>${lines}</ul><p>HP ${currentHP} → ${newHP}</p>`
        });
    } catch (err) {
        console.error("The Fade: error applying turn-start condition damage", err);
    }
});




// ====================================================================
// 5. SYSTEM HOOKS & INITIALIZATION
// ====================================================================

/**
* System initialization - register sheets and configure system
*/
Hooks.once('init', async function () {
    // --------------------------------------------------------------------
    // CORE SYSTEM CONFIGURATION
    // --------------------------------------------------------------------

    // Define custom document classes
    CONFIG.Actor.documentClass = TheFadeActor;
    CONFIG.Item.documentClass = TheFadeItem;
    registerTheFadeStatusEffects();

    // Define all available item types (must match template.json)
    CONFIG.Item.types = [
        "weapon", "armor", "skill", "path", "monsterpath", "spell", "alchemical", "talent", "species", "monsterspecies",
        "drug", "poison", "disease", "biological", "medical", "travel", "mount", "vehicle",
        "musical", "potion", "staff", "wand", "gate", "communication",
        "containment", "dream", "fleshcraft", "magicitem", "clothing", "trait", "precept",
        "mutation", "heritage", "trap", "hazard", "downtime", "item"
    ];

    // Define item type labels for display
    CONFIG.Item.typeLabels = {
        weapon: "TYPES.Item.weapon",
        armor: "TYPES.Item.armor",
        skill: "TYPES.Item.skill",
        path: "TYPES.Item.path",
        monsterpath: "TYPES.Item.monsterpath",
        spell: "TYPES.Item.spell",
        alchemical: "TYPES.Item.alchemical",
        talent: "TYPES.Item.talent",
        trait: "TYPES.Item.trait",
        precept: "TYPES.Item.precept",
        species: "TYPES.Item.species",
        monsterspecies: "TYPES.Item.monsterspecies",
        drug: "TYPES.Item.drug",
        poison: "TYPES.Item.poison",
        disease: "TYPES.Item.disease",
        biological: "TYPES.Item.biological",
        medical: "TYPES.Item.medical",
        travel: "TYPES.Item.travel",
        mount: "TYPES.Item.mount",
        vehicle: "TYPES.Item.vehicle",
        musical: "TYPES.Item.musical",
        potion: "TYPES.Item.potion",
        staff: "TYPES.Item.staff",
        wand: "TYPES.Item.wand",
        gate: "TYPES.Item.gate",
        communication: "TYPES.Item.communication",
        containment: "TYPES.Item.containment",
        dream: "TYPES.Item.dream",
        fleshcraft: "TYPES.Item.fleshcraft",
        magicitem: "TYPES.Item.magicitem",
        clothing: "TYPES.Item.clothing",
        mutation: "TYPES.Item.mutation",
        heritage: "TYPES.Item.heritage",
        trap: "TYPES.Item.trap",
        hazard: "TYPES.Item.hazard",
        downtime: "TYPES.Item.downtime",
        item: "TYPES.Item.item"
    };

    // --------------------------------------------------------------------
    // WORLD SETTINGS
    // --------------------------------------------------------------------

    game.settings.register("thefade", "moreHPScaling", {
        name: "THEFADE.SettingMoreHP",
        hint: "THEFADE.SettingMoreHPHint",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
        onChange: () => {
            for (const actor of game.actors ?? []) {
                if (actor?.type === "character") actor.prepareData();
            }
            for (const app of Object.values(ui.windows)) {
                if (app?.actor?.type === "character" && typeof app.render === "function") {
                    app.render(false);
                }
            }
        }
    });

    game.settings.register("thefade", "characterCreationMode", {
        name: "THEFADE.SettingCreationMode",
        hint: "THEFADE.SettingCreationModeHint",
        scope: "world",
        config: true,
        type: String,
        choices: {
            pointbuy: "THEFADE.SettingCreationModePointBuy",
            random: "THEFADE.SettingCreationModeRandom"
        },
        default: "pointbuy",
        onChange: () => {
            for (const app of Object.values(ui.windows)) {
                if (app?.actor?.type === "character" && typeof app.render === "function") {
                    app.render(false);
                }
            }
        }
    });

    game.settings.register("thefade", "alternateAnatomyEnabled", {
        name: "THEFADE.SettingAlternateAnatomy",
        hint: "THEFADE.SettingAlternateAnatomyHint",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
        onChange: () => {
            for (const app of Object.values(ui.windows)) {
                if (["character", "npc"].includes(app?.actor?.type) && typeof app.render === "function") {
                    app.render(false);
                }
            }
        }
    });

    game.settings.register("thefade", "fatePointsEnabled", {
        name: "THEFADE.SettingFatePoints",
        hint: "THEFADE.SettingFatePointsHint",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
        onChange: () => {
            for (const app of Object.values(ui.windows)) {
                if (app?.actor?.type === "character" && typeof app.render === "function") app.render(false);
            }
        }
    });

    game.settings.register("thefade", "itemPowerSlotRule", {
        name: "THEFADE.SettingItemPowerSlots",
        hint: "THEFADE.SettingItemPowerSlotsHint",
        scope: "world",
        config: true,
        type: String,
        choices: {
            standard: "THEFADE.SettingItemPowerSlotsStandard",
            alternate: "THEFADE.SettingItemPowerSlotsAlternate"
        },
        default: "standard",
        onChange: () => {
            for (const app of Object.values(ui.windows)) {
                if ((app?.actor || app?.item?.type === "magicitem") && typeof app.render === "function") app.render(false);
            }
        }
    });

    game.settings.register("thefade", "itemPowerAttunementRule", {
        name: "THEFADE.SettingItemPowerAttunement",
        hint: "THEFADE.SettingItemPowerAttunementHint",
        scope: "world",
        config: true,
        type: String,
        choices: {
            standard: "THEFADE.SettingItemPowerAttunementStandard",
            removed: "THEFADE.SettingItemPowerAttunementRemoved",
            technology: "THEFADE.SettingItemPowerAttunementTechnology"
        },
        default: "standard",
        onChange: () => {
            for (const actor of game.actors ?? []) actor?.reset?.();
            for (const app of Object.values(ui.windows)) {
                if ((app?.actor || app?.item) && typeof app.render === "function") app.render(false);
            }
        }
    });

    game.settings.register("thefade", "skillChallengeState", {
        scope: "world",
        config: false,
        type: Object,
        default: getDefaultSkillChallengeState()
    });

    game.settings.register("thefade", "encounterState", {
        scope: "world",
        config: false,
        type: Object,
        default: getDefaultEncounterState()
    });

    // --------------------------------------------------------------------
    // SHEET REGISTRATION
    // --------------------------------------------------------------------

    // Unregister default sheets
    Actors.unregisterSheet("core", ActorSheet);
    Items.unregisterSheet("core", ItemSheet);

    // Register The Fade character sheet
    Actors.registerSheet("thefade", TheFadeCharacterSheet, {
        types: ["character"],
        makeDefault: true
    });

    // Register NPC sheet
    Actors.registerSheet("thefade", TheFadeNPCSheet, {
        types: ["npc"],
        makeDefault: true
    });

    // Register Party sheet
    Actors.registerSheet("thefade", TheFadePartySheet, {
        types: ["party"],
        makeDefault: true
    });

    // Register Shop sheet
    Actors.registerSheet("thefade", TheFadeShopSheet, {
        types: ["shop"],
        makeDefault: true
    });

    // Register The Fade item sheet
    Items.registerSheet("thefade", TheFadeItemSheet, {
        types: [
            "weapon", "armor", "skill", "path", "monsterpath", "spell", "alchemical", "talent", "trait", "precept",
            "species", "monsterspecies", "drug", "poison", "disease", "biological", "medical", "travel", "item",
            "mount", "vehicle", "musical", "potion", "staff", "wand", "gate",
            "communication", "containment", "dream", "fleshcraft", "magicitem", "clothing",
            "mutation", "heritage", "trap", "hazard", "downtime"
        ],
        makeDefault: true
    });

    // --------------------------------------------------------------------
    // TEMPLATE PRELOADING
    // --------------------------------------------------------------------

    await loadTemplates([
        "systems/thefade/templates/actor/character-sheet.html",
        "systems/thefade/templates/actor/npc-sheet.html",
        "systems/thefade/templates/actor/party-sheet.html",
        "systems/thefade/templates/actor/shop-sheet.html",
        "systems/thefade/templates/actor/parts/attributes.html",
        "systems/thefade/templates/actor/parts/skills.html",
        "systems/thefade/templates/actor/parts/skill-row.html",
        "systems/thefade/templates/actor/parts/inventory.html",
        "systems/thefade/templates/actor/parts/paths.html",
        "systems/thefade/templates/actor/parts/spells.html",
        "systems/thefade/templates/actor/parts/combat-state.html",
        "systems/thefade/templates/actor/parts/combat-traits.html",
        "systems/thefade/templates/actor/parts/linked-ability-source.html",
        "systems/thefade/templates/actor/parts/creature-subtypes.html",
        "systems/thefade/templates/actor/parts/creature-rule-abilities.html",
        "systems/thefade/templates/item/parts/weapon-qualities.html",
        "systems/thefade/templates/actor/parts/protection.html",
        "systems/thefade/templates/actor/parts/injuries.html",
        "systems/thefade/templates/actor/parts/vitals-hp-sanity.html",
        "systems/thefade/templates/actor/parts/heritage-downtime.html",
        "systems/thefade/templates/chat/attack-roll.html",
        "systems/thefade/templates/chat/skill-roll.html",
        "systems/thefade/templates/chat/spell-cast.html",
        "systems/thefade/templates/chat/ignition.html",
        "systems/thefade/templates/dialogs/ability-edit.html",
        "systems/thefade/templates/dialogs/character-select.html",
        "systems/thefade/templates/apps/gm-toolkit.html",

        "systems/thefade/templates/item/communication-sheet.html",
        "systems/thefade/templates/item/alchemical-sheet.html",
        "systems/thefade/templates/item/containment-sheet.html",
        "systems/thefade/templates/item/dream-sheet.html",
        "systems/thefade/templates/item/drug-sheet.html",
        "systems/thefade/templates/item/fleshcraft-sheet.html",
        "systems/thefade/templates/item/gate-sheet.html",
        "systems/thefade/templates/item/medical-sheet.html",
        "systems/thefade/templates/item/mount-sheet.html",
        "systems/thefade/templates/item/musical-sheet.html",
        "systems/thefade/templates/item/poison-sheet.html",
        "systems/thefade/templates/item/disease-sheet.html",
        "systems/thefade/templates/item/path-sheet.html",
        "systems/thefade/templates/item/potion-sheet.html",
        "systems/thefade/templates/item/species-sheet.html",
        "systems/thefade/templates/item/staff-sheet.html",
        "systems/thefade/templates/item/travel-sheet.html",
        "systems/thefade/templates/item/vehicle-sheet.html",
        "systems/thefade/templates/item/wand-sheet.html",
        "systems/thefade/templates/item/clothing-sheet.html",
        "systems/thefade/templates/item/trait-sheet.html",
        "systems/thefade/templates/item/precept-sheet.html",
        "systems/thefade/templates/item/rules-item-sheet.html",
        "systems/thefade/templates/item/parts/bonuses.html",
        "systems/thefade/templates/item/parts/item-power-grants.html",
        "systems/thefade/templates/item/parts/tech-attunement.html",
        "systems/thefade/templates/item/parts/rules-attack-fields.html"

    ]);

    // --------------------------------------------------------------------
    // INITIATIVE SYSTEM CONFIGURATION
    // --------------------------------------------------------------------

    CONFIG.Combat.initiative = {
        formula: "1d12 + @system.attributes.finesse.total",
        decimals: 0
    };

    // Override initiative formula calculation
    Combat.prototype.getInitiativeFormula = function (combatant) {
        const actor = combatant.actor;
        if (!actor) return "1d12";

        if (["character", "npc"].includes(actor.type)) {
            const finesse = actor.system.attributes?.finesse?.value || 0;
            const mind = actor.system.attributes?.mind?.value || 0;
            const bonus = (actor.system.initiativeBonus || 0)
                + Number(actor.system.itemBonuses?.initiative || 0);
            const modifier = Math.floor((finesse + mind) / 2) + bonus;
            return `1d12 + ${modifier}`;
        }

        return "1d12";
    };

    // Override initiative rolling
    const originalRollInitiative = Combat.prototype.rollInitiative;
    Combat.prototype.rollInitiative = async function (ids, { formula = null, updateTurn = true, messageOptions = {} } = {}) {
        ids = typeof ids === "string" ? [ids] : ids;

        for (let id of ids) {
            const combatant = this.combatants.get(id);
            if (!combatant?.isOwner) continue;

            const actorFormula = this.getInitiativeFormula(combatant);
            const roll = new Roll(actorFormula);
            await roll.evaluate();

            await this.updateEmbeddedDocuments("Combatant", [{
                _id: id,
                initiative: roll.total
            }]);

            await roll.toMessage({
                speaker: ChatMessage.getSpeaker({
                    actor: combatant.actor,
                    token: combatant.token,
                    alias: combatant.name
                }),
                flavor: `${combatant.name} rolls for Initiative!`,
                flags: { initiativeRoll: true }
            });
        }

        if (updateTurn && this.turns) {
            await this.update({ turn: 0 });
        }

        return this;
    };

    // --------------------------------------------------------------------
    // HANDLEBARS HELPERS
    // --------------------------------------------------------------------

    Handlebars.registerHelper('titleCase', function (str) {
        if (!str) return '';
        return str.replace(/\w\S*/g, function (txt) {
            return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
        });
    });

    Handlebars.registerHelper('eq', function (a, b) {
        return a === b;
    });

    Handlebars.registerHelper('ifEquals', function (a, b, options) {
        return (a === b) ? options.fn(this) : options.inverse(this);
    });

    Handlebars.registerHelper('mechanicalBonusType', bonus => normalizeMechanicalBonus(bonus).type);
    Handlebars.registerHelper('mechanicalBonusTarget', bonus => normalizeMechanicalBonus(bonus).target);
    Handlebars.registerHelper('mechanicalBonusSeverity', bonus => normalizeMechanicalBonus(bonus).severity);

    Handlebars.registerHelper('lowercase', function (str) {
        return (str || '').toLowerCase();
    });

    Handlebars.registerHelper('times', function (n, block) {
        let accum = '';
        for (let i = 1; i <= n; ++i)
            accum += block.fn(i);
        return accum;
    });

    Handlebars.registerHelper('concat', function () {
        let outStr = '';
        for (let arg in arguments) {
            if (typeof arguments[arg] != 'object') {
                outStr += arguments[arg];
            }
        }
        return outStr;
    });

    // Return `value` if it's a number (including 0), otherwise `fallback`.
    // Used for armor/ND pools where 0 means "drained" but {{#if}} would
    // wrongly treat it as unset and show max instead of 0.
    Handlebars.registerHelper('numberOr', function (value, fallback) {
        return (typeof value === 'number') ? value : fallback;
    });
});

/**
 * Seed new armor (including preconfigured armor-like Items of Power) with
 * its starting AP on creation. prepareData no longer
 * refills currentAP when it hits 0 (that was the "broken armor refills
 * itself" bug), so freshly created armor needs currentAP populated once
 * here to avoid starting at 0.
 */
Hooks.on("preCreateItem", (item, data, options, userId) => {
    const system = data.system || {};
    const isArmorPiece = item.type === "armor"
        || (item.type === "magicitem" && system.conflictsArmor === true);
    if (!isArmorPiece) return;
    const ap = Number(system.ap) || 0;
    const apInc = Number(system.apIncrease) || 0;
    const effectiveMax = ap + apInc;
    const updates = {};
    if (system.currentAP === undefined || system.currentAP === null || system.currentAP === 0) {
        updates["system.currentAP"] = effectiveMax;
    }
    const isLimb = ["Arms", "Legs", "Arms+", "Legs+"].includes(system.location);
    if (isLimb && (system.otherLimbAP === undefined || system.otherLimbAP === null || system.otherLimbAP === 0)) {
        updates["system.otherLimbAP"] = effectiveMax;
    }
    if (Object.keys(updates).length) item.updateSource(updates);
});

function chooseMonsterNaturalDeflectionRating(species) {
    const options = species.system?.naturalDeflectionTypes || {};
    const available = ["fragile", "average", "tough"].filter(key => options[key]);
    if (!available.length) return Promise.resolve(null);

    return new Promise(resolve => {
        let resolved = false;
        const optionHtml = available.map(key => {
            const label = key.charAt(0).toUpperCase() + key.slice(1);
            const selected = key === "average" ? "selected" : "";
            return `<option value="${key}" ${selected}>${label}</option>`;
        }).join("");

        new Dialog({
            title: `${species.name}: Natural Deflection`,
            content: `<form>
                <div class="form-group">
                    <label>Natural Deflection Type</label>
                    <select id="monster-nd-rating">${optionHtml}</select>
                </div>
            </form>`,
            buttons: {
                apply: {
                    icon: '<i class="fas fa-check"></i>',
                    label: "Apply",
                    callback: html => {
                        resolved = true;
                        resolve(html.find("#monster-nd-rating").val() || "average");
                    }
                }
            },
            default: "apply",
            close: () => {
                if (!resolved) resolve(available.includes("average") ? "average" : available[0]);
            }
        }).render(true);
    });
}

function getMonsterSizeRule(species) {
    if (species.type !== "monsterspecies") return null;
    const size = species.system?.size || "medium";
    return species.system?.sizeRules?.[size] || null;
}

function getAttributeMapValues(map) {
    const out = {};
    for (const attr of ["physique", "finesse", "mind", "presence", "soul"]) {
        const raw = map?.[attr];
        out[attr] = raw !== null && raw !== undefined && raw !== "" && Number.isFinite(Number(raw))
            ? Number(raw)
            : null;
    }
    return out;
}

function getEffectiveMonsterAttribute(attributes, attr, caps = {}) {
    const a = attributes?.[attr] || {};
    const value = Number(a.value ?? 1) || 1;
    const species = Number(a.speciesBonus ?? 0) || 0;
    const flex = Number(a.flexibleBonus ?? 0) || 0;
    const bonus = Number(a.bonus ?? 0) || 0;
    const total = value + species + flex + bonus;
    const cap = caps[attr];
    return cap !== null && cap !== undefined && Number.isFinite(Number(cap))
        ? Math.min(total, Number(cap))
        : total;
}

function buildMonsterNaturalDeflectionUpdates(species, attributes, rating, statCaps = {}) {
    const ndConfig = species.system?.naturalDeflectionTypes?.[rating];
    if (!ndConfig) return {};

    const physique = getEffectiveMonsterAttribute(attributes, "physique", statCaps) || 1;
    const base = physique * (Number(ndConfig.baseMultiplier) || 0);
    const parts = ndConfig.parts || {};
    const partValue = (part) => Math.max(0, Math.floor(base * (Number(parts[part]) || 0)));
    const values = {
        head: partValue("head"),
        body: partValue("body"),
        leftarm: partValue("arms"),
        rightarm: partValue("arms"),
        leftleg: partValue("legs"),
        rightleg: partValue("legs")
    };

    const updates = {
        "system.species.naturalDeflectionRating": rating
    };
    for (const [part, value] of Object.entries(values)) {
        updates[`system.naturalDeflection.${part}`] = {
            current: value,
            max: value,
            stacks: false
        };
    }
    return updates;
}

function legacyStandardAttackOptionToWeaponData(attack) {
    if (!attack?.name) return null;
    const isNatural = attack.type === "natural";
    const qualities = attack.qualities || (isNatural ? "Natural" : "");
    return {
        name: attack.name,
        type: "weapon",
        system: {
            damage: Number(attack.damage) || 0,
            damageType: attack.damageType || "B",
            critical: 4,
            handedness: isNatural ? "Light" : "One-Handed",
            range: "Melee",
            integrity: 10,
            qualities,
            skill: attack.skill || (isNatural ? "Unarmed" : "Cudgel"),
            attribute: "physique",
            weight: isNatural ? 0 : 1,
            price: 0,
            quantity: 1,
            equipped: true
        }
    };
}

function cloneStandardAttackWeapon(weapon) {
    if (!weapon?.name) return null;
    const system = foundry.utils.deepClone(weapon.system || {});
    if (system.equipped === undefined) system.equipped = true;
    return {
        name: weapon.name,
        type: "weapon",
        img: weapon.img || "icons/svg/sword.svg",
        system
    };
}

function getStandardAttackWeapons(entry) {
    if (Array.isArray(entry.weapons)) return entry.weapons;
    return [legacyStandardAttackOptionToWeaponData(entry.optionA), legacyStandardAttackOptionToWeaponData(entry.optionB)].filter(Boolean);
}

function chooseStandardAttackWeapon(species, entry, weapons) {
    if (weapons.length <= 1) return Promise.resolve(weapons[0] || null);
    return new Promise(resolve => {
        const options = weapons.map((weapon, index) =>
            `<label><input type="radio" name="standard-attack-choice" value="${index}" ${index === 0 ? "checked" : ""}> ${weapon.name}</label>`
        ).join("");

        new Dialog({
            title: `${species.name}: Standard Attack`,
            content: `<p>Choose one standard attack.</p>
                <div class="form-group">${options}</div>`,
            buttons: {
                choose: {
                    icon: '<i class="fas fa-check"></i>',
                    label: "Choose",
                    callback: html => {
                        const selected = Number(html.find('input[name="standard-attack-choice"]:checked').val()) || 0;
                        resolve(weapons[selected] || weapons[0] || null);
                    }
                }
            },
            default: "choose",
            close: () => resolve(weapons[0] || null)
        }).render(true);
    });
}

async function applyMonsterStandardAttacks(actor, species) {
    const entries = Array.isArray(species.system?.standardAttacks) ? species.system.standardAttacks : [];
    if (!entries.length) return;

    const weapons = [];
    for (const entry of entries) {
        const entryWeapons = getStandardAttackWeapons(entry);
        const selectedWeapons = entry.mode === "choice"
            ? [await chooseStandardAttackWeapon(species, entry, entryWeapons)].filter(Boolean)
            : entryWeapons;

        for (const selected of selectedWeapons) {
            const weaponData = cloneStandardAttackWeapon(selected);
            if (!weaponData) continue;
            const exists = actor.items.some(i => i.type === "weapon" && i.name === weaponData.name);
            if (!exists) weapons.push(weaponData);
        }
    }

    if (weapons.length) {
        await actor.createEmbeddedDocuments("Item", weapons);
    }
}

function getMonsterSpeciesSizing(species) {
    const isMonsterSpecies = species.type === "monsterspecies";
    const sizeRule = isMonsterSpecies ? getMonsterSizeRule(species) : null;
    const sizeBonusHP = Number(sizeRule?.bonusHP) || 0;
    const sizeLandMove = Number(sizeRule?.movement?.land) || 0;
    const sizeStatBonuses = getAttributeMapValues(sizeRule?.bonuses);
    const sizeStatCaps = getAttributeMapValues(sizeRule?.caps);
    const statCaps = Object.fromEntries(
        Object.entries(sizeStatCaps).filter(([, value]) => value !== null)
    );

    return { isMonsterSpecies, sizeRule, sizeBonusHP, sizeLandMove, sizeStatBonuses, statCaps };
}

function buildSpeciesActorUpdates(actor, species, sizing) {
    const { isMonsterSpecies, sizeRule, sizeBonusHP, sizeLandMove, statCaps } = sizing;
    return {
        ...(isMonsterSpecies ? { "system.isMonster": true, "system.pathsAllowed": 0 } : {}),
        "system.species": {
            ...foundry.utils.deepClone(actor.system.species || {}),
            name: species.name,
            baseHP: (Number(species.system.baseHP) || 0) + sizeBonusHP,
            size: species.system.size,
            creatureType: species.system.creatureType || "sapient",
            creatureSubtype: species.system.creatureSubtype || "",
            creatureSubtypes: foundry.utils.deepClone(species.system.creatureSubtypes || []),
            languages: species.system.languages || "",
            attributeSpread: species.system.attributeSpread || "",
            averageEL: sizeRule?.averageEL ?? "",
            sizeRuleExample: sizeRule?.example || "",
            statCaps,
            speciesAbilities: species.system.speciesAbilities || {},
            isMonsterSpecies,
            naturalDeflectionRating: actor.system.species?.naturalDeflectionRating || "",
            flexibleBonus: {
                value: species.system.flexibleBonus?.value || 0,
                selectedAttribute: actor.system.species?.flexibleBonus?.selectedAttribute || ""
            }
        },
        "system.movement": {
            land: (species.system.movement?.land || 4) + sizeLandMove,
            fly: species.system.movement?.fly || 0,
            swim: species.system.movement?.swim || 0,
            climb: species.system.movement?.climb || 0,
            burrow: species.system.movement?.burrow || 0
        },
        "system.overland-movement": {
            landOverland: ((species.system.movement?.land || 4) + sizeLandMove) * 6,
            flyOverland: species.system.movement?.fly * 6 || 0,
            swimOverland: species.system.movement?.swim * 6 || 0,
            climbOverland: species.system.movement?.climb * 6 || 0,
            burrowOverland: species.system.movement?.burrow * 6 || 0
        }
    };
}

function buildSpeciesAttributeUpdates(actor, species, sizing) {
    const { isMonsterSpecies, sizeStatBonuses, statCaps } = sizing;
    const updatedAttributes = foundry.utils.deepClone(actor.system.attributes || {});

    for (const attr of ["physique", "finesse", "mind", "presence", "soul"]) {
        if (!updatedAttributes[attr]) updatedAttributes[attr] = { value: 1, speciesBonus: 0 };

        if (isMonsterSpecies && species.system.attributeSet) {
            const setValue = Number(species.system.attributeSet[attr]);
            if (Number.isFinite(setValue) && setValue > 0) {
                updatedAttributes[attr].value = setValue;
            }
        }

        const abilityBonus = Number(species.system.abilityBonuses?.[attr]) || 0;
        const sizeBonus = Number(sizeStatBonuses?.[attr]) || 0;
        updatedAttributes[attr].speciesBonus = abilityBonus + sizeBonus;

        const cap = statCaps[attr];
        if (Number.isFinite(Number(cap))) {
            updatedAttributes[attr].value = Math.min(Number(updatedAttributes[attr].value) || 1, Number(cap));
        }
    }

    return updatedAttributes;
}

function buildMonsterNaturalDeflectionSyncUpdates(actor, species, attributes, rating, statCaps = {}) {
    const updates = buildMonsterNaturalDeflectionUpdates(species, attributes, rating, statCaps);
    for (const [path, value] of Object.entries(updates)) {
        if (!path.startsWith("system.naturalDeflection.") || !value || typeof value !== "object") continue;
        const part = path.split(".").pop();
        const previous = actor.system.naturalDeflection?.[part];
        const previousCurrent = Number(previous?.current);
        const previousMax = Number(previous?.max);
        const wasFull = !Number.isFinite(previousCurrent) || !Number.isFinite(previousMax) || previousCurrent >= previousMax;
        value.current = wasFull ? value.max : Math.min(Math.max(0, previousCurrent), value.max);
    }
    return updates;
}

async function syncEmbeddedSpeciesToActor(actor, species, { syncStandardAttacks = false } = {}) {
    if (!actor || actor.type !== "character" || !SPECIES_ITEM_TYPES.includes(species?.type)) return;

    const sizing = getMonsterSpeciesSizing(species);
    const updates = buildSpeciesActorUpdates(actor, species, sizing);
    const updatedAttributes = buildSpeciesAttributeUpdates(actor, species, sizing);
    updates["system.attributes"] = updatedAttributes;

    const rating = sizing.isMonsterSpecies
        ? (actor.system.species?.naturalDeflectionRating || "average")
        : "";
    if (sizing.isMonsterSpecies && rating) {
        Object.assign(
            updates,
            buildMonsterNaturalDeflectionSyncUpdates(actor, species, updatedAttributes, rating, sizing.statCaps)
        );
    }

    await actor.update(updates);

    if (syncStandardAttacks && sizing.isMonsterSpecies) {
        await applyMonsterStandardAttacks(actor, species);
    }
}

/**
* Item creation hook - handle path and species application
*/
Hooks.on("createItem", async (item, options, userId) => {
    // Handle Path addition to characters - use new skill modification system
    if (PATH_ITEM_TYPES.includes(item.type) && item.parent && item.parent.type === 'character' && game.user.id === userId) {
        const actor = item.parent;
        const path = item;

        if (item.type === "monsterpath" && !actor.system?.isMonster) {
            await actor.update({ "system.isMonster": true, "system.pathsAllowed": 0 });
        }

        if (actor.getFlag("thefade", "addingSkills")) return;
        await actor.setFlag("thefade", "addingSkills", true);

        try {
            await applyPathSkillModifications(actor, path);
        } finally {
            await actor.unsetFlag("thefade", "addingSkills");
        }
    }

    // Handle Species addition to characters
    if (SPECIES_ITEM_TYPES.includes(item.type) && item.parent && item.parent.type === 'character' && game.user.id === userId) {
        const actor = item.parent;
        const species = item;
        const isMonsterSpecies = item.type === "monsterspecies";
        const selectedNDRating = isMonsterSpecies
            ? await chooseMonsterNaturalDeflectionRating(species)
            : null;
        const sizeRule = isMonsterSpecies ? getMonsterSizeRule(species) : null;
        const sizeBonusHP = Number(sizeRule?.bonusHP) || 0;
        const sizeLandMove = Number(sizeRule?.movement?.land) || 0;
        const sizeStatBonuses = getAttributeMapValues(sizeRule?.bonuses);
        const sizeStatCaps = getAttributeMapValues(sizeRule?.caps);
        const statCaps = Object.fromEntries(
            Object.entries(sizeStatCaps).filter(([, value]) => value !== null)
        );

        // Clear existing species bonuses
        const deletions = {};
        for (const attr of Object.keys(actor.system.attributes)) {
            deletions[`system.attributes.${attr}.speciesBonus`] = null;
            deletions[`system.attributes.${attr}.flexibleBonus`] = null;
        }


        deletions["system.species.flexibleBonus"] = {
            value: 0,
            selectedAttribute: ""
        };

        await actor.update(deletions);

        await initializeDefaultSkills(actor);

        // Apply new species data
        await actor.update({
            ...(isMonsterSpecies ? { "system.isMonster": true, "system.pathsAllowed": 0 } : {}),
            "system.species": {
                name: species.name,
                baseHP: (Number(species.system.baseHP) || 0) + sizeBonusHP,
                size: species.system.size,
                creatureType: species.system.creatureType || "sapient",
                creatureSubtype: species.system.creatureSubtype || "",
                creatureSubtypes: foundry.utils.deepClone(species.system.creatureSubtypes || []),
                languages: species.system.languages || "",
                attributeSpread: species.system.attributeSpread || "",
                averageEL: sizeRule?.averageEL ?? "",
                sizeRuleExample: sizeRule?.example || "",
                statCaps,
                speciesAbilities: species.system.speciesAbilities || {},
                isMonsterSpecies,
                naturalDeflectionRating: selectedNDRating || "",
                flexibleBonus: {
                    value: species.system.flexibleBonus?.value || 0,
                    selectedAttribute: ""
                }
            },
            "system.movement": {
                land: (species.system.movement?.land || 4) + sizeLandMove,
                fly: species.system.movement?.fly || 0,
                swim: species.system.movement?.swim || 0,
                climb: species.system.movement?.climb || 0,
                burrow: species.system.movement?.burrow || 0
            },
            "system.overland-movement": {
                landOverland: ((species.system.movement?.land || 4) + sizeLandMove) * 6,
                flyOverland: species.system.movement?.fly * 6 || 0,
                swimOverland: species.system.movement?.swim * 6 || 0,
                climbOverland: species.system.movement?.climb * 6 || 0,
                burrowOverland: species.system.movement?.burrow * 6 || 0
            }
        });

        // Apply ability bonuses
        const updatedAttributes = foundry.utils.deepClone(actor.system.attributes);
        if (isMonsterSpecies && species.system.attributeSet) {
            for (const attr of Object.keys(updatedAttributes)) {
                const setValue = Number(species.system.attributeSet[attr]);
                if (Number.isFinite(setValue) && setValue > 0) {
                    updatedAttributes[attr].value = setValue;
                    updatedAttributes[attr].speciesBonus = 0;
                }
            }
        }

        for (const [attr, bonus] of Object.entries(species.system.abilityBonuses)) {
            if (updatedAttributes[attr] && bonus !== 0) {
                updatedAttributes[attr].speciesBonus = bonus;
            }
        }

        for (const [attr, bonus] of Object.entries(sizeStatBonuses)) {
            if (updatedAttributes[attr] && bonus !== null && bonus !== 0) {
                updatedAttributes[attr].speciesBonus = (Number(updatedAttributes[attr].speciesBonus) || 0) + bonus;
            }
        }

        for (const [attr, cap] of Object.entries(statCaps)) {
            if (updatedAttributes[attr] && Number.isFinite(Number(cap))) {
                updatedAttributes[attr].value = Math.min(Number(updatedAttributes[attr].value) || 1, Number(cap));
            }
        }

        await actor.update({
            "system.attributes": updatedAttributes
        });

        if (isMonsterSpecies && selectedNDRating) {
            const ndUpdates = buildMonsterNaturalDeflectionUpdates(species, updatedAttributes, selectedNDRating, statCaps);
            if (Object.keys(ndUpdates).length) await actor.update(ndUpdates);
        }

        if (isMonsterSpecies) {
            await applyMonsterStandardAttacks(actor, species);
        }

        // Update abilities text
        let abilitiesText = "";
        if (species.system.speciesAbilities) {
            for (const [id, ability] of Object.entries(species.system.speciesAbilities)) {
                if (ability.name && ability.description) {
                    abilitiesText += `• ${ability.name}: ${ability.description}\n`;
                }
            }
        }

        await actor.update({
            "system.species.abilities": abilitiesText
        });

        ui.notifications.info(`Applied ${species.name} species to ${actor.name}.`);
    }

    // Talent prereq acknowledgement: we can't parse free-text, but we
    // can surface the prerequisites and require the player/GM to
    // confirm eligibility. Declining deletes the just-added talent.
    if (item.type === 'talent' && item.parent && item.parent.type === 'character' && game.user.id === userId) {
        const prereqs = (item.system.prerequisites || "").trim();
        if (!prereqs) return;
        const keep = await Dialog.confirm({
            title: `Talent Prerequisites: ${item.name}`,
            content: `<p><strong>${item.name}</strong> lists prerequisites:</p><blockquote>${prereqs}</blockquote><p>Does <strong>${item.parent.name}</strong> meet them?</p>`,
            yes: () => true,
            no: () => false,
            defaultYes: true
        });
        if (!keep) {
            await item.delete();
            ui.notifications.warn(`${item.name} removed: prerequisites not met.`);
        }
    }
});

Hooks.on("updateItem", async (item, changes, options, userId) => {
    if (game.user.id !== userId) return;
    if (!SPECIES_ITEM_TYPES.includes(item.type)) return;

    const actor = item.parent;
    if (!actor || actor.type !== "character") return;
    const changeKeys = Object.keys(changes || {});
    const hasSpeciesChange = Object.prototype.hasOwnProperty.call(changes || {}, "name")
        || changeKeys.some(key => key === "system" || key.startsWith("system."));
    const syncToggleChanged = foundry.utils.hasProperty(changes, "system.syncToActor")
        || changeKeys.includes("system.syncToActor")
        || (changes?.system && Object.prototype.hasOwnProperty.call(changes.system, "syncToActor"));
    const shouldSync = syncToggleChanged || item.system?.syncToActor === true;
    if (!hasSpeciesChange) return;
    if (!shouldSync) return;

    await syncEmbeddedSpeciesToActor(actor, item);
});

Hooks.on("createActor", async (actor, options, userId) => {
    // New actors no longer need skill items created up-front; core skills
    // live in DEFAULT_SKILLS and are surfaced via getSkill helpers.
});

/**
 * One-shot cleanup: clear the legacy "converted from talent" source string
 * left on trait items by an older conversion routine.
 */
async function clearLegacyTraitSource() {
    const LEGACY = "converted from talent";
    let cleared = 0;

    for (const item of game.items ?? []) {
        if (item.type === "trait" && item.system?.source === LEGACY) {
            await item.update({ "system.source": "" });
            cleared++;
        }
    }

    for (const actor of game.actors ?? []) {
        const updates = [];
        for (const item of actor.items) {
            if (item.type === "trait" && item.system?.source === LEGACY) {
                updates.push({ _id: item.id, "system.source": "" });
            }
        }
        if (updates.length) {
            await actor.updateEmbeddedDocuments("Item", updates);
            cleared += updates.length;
        }
    }

    if (cleared > 0) console.log(`thefade | cleared legacy trait source on ${cleared} item(s).`);
}

/**
 * System ready hook - final setup after all systems loaded
 */
Hooks.once('ready', async function () {
    // Some modules append generic statuses during init/setup. The Fade owns
    // this palette, so restore the system list after all packages are ready.
    registerTheFadeStatusEffects();
    game.thefade = foundry.utils.mergeObject(game.thefade || {}, { openGMToolkit }, { inplace: false });

    // One-shot migration: convert legacy skill items into actor.system.skills.
    if (game.user.isGM) {
        try { await migrateAllActorSkills(); }
        catch (err) { console.warn("thefade | skill migration error:", err); }

        try { await clearLegacyTraitSource(); }
        catch (err) { console.warn("thefade | trait source cleanup error:", err); }
    }

    if (game.user.isGM) {
        let initButton = $(`<button id="fade-init-skills">Initialize All Character Skills</button>`);
        initButton.click(async function () {
            ui.notifications.info("Initializing skills for all characters...");

            const characters = game.actors.filter(a => a.type === "character");
            let count = 0;

            for (let character of characters) {
                await initializeDefaultSkills(character);
                count++;
            }

            ui.notifications.info(`Initialized skills for ${count} characters.`);
        });

        $('#controls').append(initButton);
        initButton.css({
            "position": "fixed",
            "bottom": "60px", // Above the existing fix button
            "left": "10px",
            "z-index": "1000"
        });
    }
});

// --------------------------------------------------------------------

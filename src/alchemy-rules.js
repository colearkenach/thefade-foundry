import { renderModifierHtml } from './conditions.js';
import { calculateSkillDice, getSkill } from './skills.js';

export const ALCHEMICAL_SKILL_OPTIONS = {
    Chemistry: "Chemistry",
    Herbalism: "Herbalism",
    Toxicology: "Toxicology"
};

export function getAlchemicalDiscipline(system = {}) {
    return system.darkMagic === true ? "Blightcraft" : "Alchemy";
}

export function getAlchemicalCraftCost(system = {}) {
    const baseCost = Math.max(0, Number(system.price) || 0);
    return baseCost / 2;
}

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function getDieDetails(roll) {
    return (roll?.dice?.[0]?.results || roll?.terms?.[0]?.results || []).map(die => ({
        value: Number(die.result) || 0,
        class: die.result >= 12 ? "critical" : (die.result >= 8 ? "success" : "failure")
    }));
}

function countSuccesses(details) {
    return details.reduce((total, die) => total + (die.value >= 12 ? 2 : (die.value >= 8 ? 1 : 0)), 0);
}

/**
 * Attempt to craft one owned Alchemical Item. An attempt always consumes half
 * of its Base Cost; success adds one item to the owned stack and failure wastes
 * those materials without invoking spell mishaps.
 */
export async function craftAlchemicalItem(actor, item) {
    if (!actor || !item || item.type !== "alchemical" || item.parent !== actor) {
        ui.notifications?.warn("Alchemical crafting requires an item owned by a character.");
        return null;
    }

    const system = item.system || {};
    const skillName = ALCHEMICAL_SKILL_OPTIONS[system.skill] ? system.skill : "Chemistry";
    const skill = getSkill(actor, skillName);
    if (!skill) {
        ui.notifications?.warn(`${actor.name} does not have the ${skillName} skill.`);
        return null;
    }

    const craftCost = getAlchemicalCraftCost(system);
    const currency = Math.max(0, Number(actor.system?.currency?.serpents) || 0);
    if (currency < craftCost) {
        ui.notifications?.warn(`${actor.name} needs ${craftCost} sp. of materials to craft ${item.name}.`);
        return null;
    }

    const dt = Math.max(1, parseInt(system.dt, 10) || 1);
    let dicePool = calculateSkillDice(actor, skill);
    const modifiers = actor.getConditionRollModifiers?.({
        kind: "skill",
        skillName,
        skillCategory: skill.category,
        attributeName: skill.attribute
    }) || { autoFail: false, bonusDice: 0, penaltyDice: 0, notes: [] };
    dicePool = Math.max(1, dicePool + (Number(modifiers.bonusDice) || 0) - (Number(modifiers.penaltyDice) || 0));

    let roll = null;
    let dieResultsDetails = [];
    let successes = 0;
    if (!modifiers.autoFail) {
        roll = await new Roll(`${dicePool}d12`).evaluate({ async: true });
        dieResultsDetails = getDieDetails(roll);
        successes = countSuccesses(dieResultsDetails);
    }

    const succeeded = !modifiers.autoFail && successes >= dt;
    const priorQuantity = Math.max(0, Number(system.quantity) || 0);
    await actor.update({ "system.currency.serpents": currency - craftCost });
    if (succeeded) await item.update({ "system.quantity": priorQuantity + 1 });

    const discipline = getAlchemicalDiscipline(system);
    const diceHTML = dieResultsDetails.length
        ? dieResultsDetails.map(die => `<span class="die-result ${die.class}">${die.value}</span>`).join(", ")
        : "No dice rolled";
    const resultText = succeeded
        ? `<strong>Success:</strong> one ${escapeHTML(item.name)} was crafted (quantity ${priorQuantity + 1}).`
        : `<strong>Failure:</strong> no item was produced; the materials were wasted.`;
    const content = `${renderModifierHtml(modifiers)}
        <div class="thefade chat-card alchemical-craft-card">
            <header class="card-header"><h3>${escapeHTML(discipline)}: ${escapeHTML(item.name)}</h3></header>
            <div class="card-content">
                <p><strong>${escapeHTML(skillName)} check:</strong> ${dicePool}d12 — ${diceHTML}</p>
                <p><strong>Successes:</strong> ${successes} (DT ${dt})</p>
                <p class="craft-result ${succeeded ? "success" : "failure"}">${resultText}</p>
                <p><strong>Materials spent:</strong> ${craftCost} sp. (half the ${Number(system.price) || 0} sp. Base Cost)</p>
                ${system.darkMagic === true ? `<p class="dark-magic-note"><strong>Dark Magic:</strong> this Alchemy is Blightcraft.</p>` : ""}
            </div>
        </div>`;

    const messageData = {
        speaker: ChatMessage.getSpeaker({ actor }),
        flavor: `Crafting ${item.name}`,
        content
    };
    if (roll) await roll.toMessage(messageData);
    else await ChatMessage.create(messageData);

    return { succeeded, successes, dt, dicePool, craftCost, discipline, roll };
}

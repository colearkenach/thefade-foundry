// Sin / Dark Magic enforcement for The Fade - Abyss.
//
// Casting a dark spell pushes current Sin up by the spell's required
// successes (its "DT"). If that pushes current Sin above the actor's
// Sin Threshold (Soul - dark spells learned + bonus), Dark Magic makes
// an attack against the caster's Grit. Its pool is the casting DT plus
// 2D per existing Addiction stage. A hit deals 1d6 Sanity damage and
// advances Addiction by one stage.
//
// Addiction stages carry passive penalties applied during actor data
// prep: Early = -1 Grit, Middle = -2 Grit, Late = -1 Grit and reduced
// Sanity max, Terminal = Soul halved for sin-threshold purposes.
//
// Daily reset (TheFadeActor.restDaily) zeroes currentSin so overnight
// rest scrubs the day's accumulation — stages persist.
//
// Rules source: Core Rulebook Dark Magic chapter (Sin Threshold,
// Addiction progression); AUDIT.md P0 #3.

import { getDarkMagicItemCorruptionValue, isDarkMagicItem } from "./item-power-rules.js";
import { getSpellSuccessRequirements } from "./spell-rules.js";

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

/**
 * Ordered addiction stage progression.
 */
export const ADDICTION_STAGES = ["none", "early", "middle", "late", "terminal"];

/**
 * Build the Dark Magic attack pool: casting DT + 2D per Addiction stage.
 */
export function getAddictionAttackDice(castingDT, stage = "none") {
    const numericDT = Number(castingDT);
    const baseDice = Number.isFinite(numericDT) ? Math.max(1, Math.trunc(numericDT)) : 1;
    const stageCount = Math.max(0, ADDICTION_STAGES.indexOf(stage));
    return baseDice + (stageCount * 2);
}

function countD12Successes(roll) {
    return (roll?.terms?.[0]?.results || []).reduce((total, die) =>
        total + (die.result >= 12 ? 2 : die.result >= 8 ? 1 : 0), 0);
}

/**
 * Roll Dark Magic's attack against an actor's Grit and apply the effects
 * of a hit. Optional updates let callers commit Sin and hit effects in one
 * actor update.
 */
export async function performAddictionAttack(actor, castingDT, updates = {}) {
    const numericDT = Number(castingDT);
    const baseDice = Number.isFinite(numericDT) ? Math.max(1, Math.trunc(numericDT)) : 1;
    const priorStage = actor.system.darkMagic?.addictionLevel || "none";
    const stageCount = Math.max(0, ADDICTION_STAGES.indexOf(priorStage));
    const addictionBonus = stageCount * 2;
    const dicePool = getAddictionAttackDice(baseDice, priorStage);
    const rawGrit = Number(actor.system.totalGrit ?? actor.system.defenses?.grit ?? 1);
    const gritTarget = Number.isFinite(rawGrit) ? Math.max(0, rawGrit) : 1;

    const attackRoll = await new Roll(`${dicePool}d12`).evaluate({ async: true });
    const attackSuccesses = countD12Successes(attackRoll);
    const attackHits = attackSuccesses >= gritTarget;
    let sanityRoll = null;
    let sanityDamage = 0;
    let sanityBefore = null;
    let sanityAfter = null;
    let stageAdvanced = null;

    if (attackHits) {
        sanityRoll = await new Roll("1d6").evaluate({ async: true });
        sanityDamage = Number(sanityRoll.total || 0);
        sanityBefore = Number(actor.system.sanity?.value ?? 0);
        sanityAfter = sanityBefore - sanityDamage;
        updates["system.sanity.value"] = sanityAfter;

        if (stageCount < ADDICTION_STAGES.length - 1) {
            stageAdvanced = ADDICTION_STAGES[stageCount + 1];
            updates["system.darkMagic.addictionLevel"] = stageAdvanced;
        }
    }

    if (Object.keys(updates).length) await actor.update(updates);

    return {
        castingDT: baseDice, priorStage, stageCount, addictionBonus,
        dicePool, gritTarget, attackRoll, attackSuccesses, attackHits,
        sanityRoll, sanityDamage, sanityBefore, sanityAfter, stageAdvanced
    };
}

/** Dark-school titles shown on the character sheet. */
export const DARK_SCHOOL_NAMES = Object.freeze({
    General: "Dark",
    Divine: "Malediction",
    Elementalism: "Eclipse",
    Malevolent: "Malevolent",
    Martial: "Havoc",
    Naturalism: "Rot",
    Preternaturalism: "Madness",
    Rituals: "Desecration",
    Runes: "Voidglyph",
    Spiritualism: "Damnation"
});

/** Malevolent spells are intrinsically dark even on older items lacking the flag. */
export function isDarkMagicSpell(spell) {
    return spell?.system?.isDarkMagic === true || spell?.system?.school === "Malevolent";
}

export function spellSchoolDisplay(spell) {
    const school = spell?.system?.school || "General";
    return isDarkMagicSpell(spell) ? (DARK_SCHOOL_NAMES[school] || school) : school;
}

/**
 * Passive effects applied to actor data for each stage.
 * gritDelta / sanityDelta are added to totalGrit / sanity max.
 * soulDivisor halves effective Soul for sin-threshold purposes only
 * (we do not mutate attributes.soul.value).
 */
export const ADDICTION_STAGE_EFFECTS = {
    none:     { gritDelta:  0, sanityDelta: 0, soulDivisor: 1 },
    early:    { gritDelta: -1, sanityDelta: 0, soulDivisor: 1 },
    middle:   { gritDelta: -2, sanityDelta: 0, soulDivisor: 1 },
    late:     { gritDelta: -2, sanityDelta: -2, soulDivisor: 1 },
    terminal: { gritDelta: -2, sanityDelta: -4, soulDivisor: 2 }
};

/**
 * Extract the effective Sin threshold the way _calculateSinThreshold does,
 * but apply the terminal soul-halving. This runs during prep so the sheet
 * shows the penalized value.
 *
 * @param {Object} data - system data (mutates data.darkMagic.sinThreshold)
 */
export function applyAddictionPenalties(data) {
    if (!data.darkMagic || typeof data.darkMagic !== "object") return;
    const stage = data.darkMagic.addictionLevel || "none";
    const effects = ADDICTION_STAGE_EFFECTS[stage] || ADDICTION_STAGE_EFFECTS.none;

    // Grit penalty stacks on whatever's already there (condition + stance).
    if (effects.gritDelta) {
        data.totalGrit = Math.max(0, (data.totalGrit || 0) + effects.gritDelta);
    }
    // Sanity cap shrinks under late/terminal pressure.
    if (effects.sanityDelta && data.sanity) {
        data.sanity.max = Math.max(1, (data.sanity.max || 1) + effects.sanityDelta);
        if (data.sanity.value > data.sanity.max) data.sanity.value = data.sanity.max;
        data.maxSanity = data.sanity.max;
    }
    // Terminal halves the Soul input to sin-threshold recomputation.
    if (effects.soulDivisor > 1) {
        const soul = data.attributes?.soul?.value || 1;
        const spells = Number(data.darkMagic.spellsLearnedCount) || 0;
        const bonus = Number(data.darkMagic.sinThresholdBonus) || 0;
        data.darkMagic.sinThreshold = Math.max(1,
            Math.floor(soul / effects.soulDivisor) - spells + bonus);
    }

    // Expose a UI-friendly summary so the sheet can render it without
    // duplicating the table.
    data.darkMagic.stageSummary = summarizeStage(stage);
}

/**
 * Short human-readable blurb for the current addiction stage.
 */
function summarizeStage(stage) {
    switch (stage) {
        case "early":    return "Early: -1 Grit";
        case "middle":   return "Middle: -2 Grit";
        case "late":     return "Late: -2 Grit, -2 Sanity max; risk of Meltdowns";
        case "terminal": return "Terminal: Soul halved, -2 Grit, -4 Sanity max";
        default:         return "None";
    }
}

/**
 * Advance an actor's addiction stage by one step (clamped at terminal).
 * Returns the new stage.
 */
export async function advanceAddictionStage(actor) {
    const current = actor.system.darkMagic?.addictionLevel || "none";
    const idx = ADDICTION_STAGES.indexOf(current);
    if (idx < 0) return current;
    if (idx >= ADDICTION_STAGES.length - 1) return current;
    const next = ADDICTION_STAGES[idx + 1];
    await actor.update({ "system.darkMagic.addictionLevel": next });
    return next;
}

/**
 * Reset currentSin to 0 (daily). Stage progression is persistent.
 */
export async function resetDailySin(actor) {
    await actor.update({ "system.darkMagic.currentSin": 0 });
}

/**
 * Handle a dark-spell cast. Increments Sin by the spell DT; if the new
 * total is over threshold, Dark Magic attacks the caster's Grit with the
 * spell DT + 2D per Addiction stage. A hit deals 1d6 Sanity damage and
 * advances Addiction. Posts a summary card.
 *
 * @param {Actor} actor - the caster
 * @param {Item} spell - the spell item
 * @returns {Promise<Object>}
 */
export async function handleDarkCast(actor, spell) {
    if (!isDarkMagicSpell(spell)) return null;

    // Rune spells have two thresholds; Sin follows the Spellcasting
    // activation requirement rather than the separate drawing requirement.
    const dt = getSpellSuccessRequirements(spell.system).spellcasting;
    const sinBefore = Number(actor.system.darkMagic?.currentSin || 0);
    const threshold = Number(actor.system.darkMagic?.sinThreshold || 0);
    const sinAfter = sinBefore + dt;

    const updates = { "system.darkMagic.currentSin": sinAfter };
    let overflow = sinAfter - threshold;
    let attack = null;

    if (overflow > 0) {
        attack = await performAddictionAttack(actor, dt, updates);
    } else {
        await actor.update(updates);
    }

    const summary = buildSummary({
        actor: actor.name,
        spell: spell.name,
        dt, sinBefore, sinAfter, threshold, overflow, attack
    });

    const messageData = {
        speaker: ChatMessage.getSpeaker({ actor }),
        flavor: attack ? "Dark Magic Addiction Attack" : "Dark Magic Sin",
        content: summary
    };
    if (attack) await attack.attackRoll.toMessage(messageData);
    else await ChatMessage.create(messageData);

    return { sinBefore, sinAfter, threshold, overflow, ...attack };
}

/**
 * Apply the recurring corruption from a Dark Magic Item of Power.
 * Dawn corruption adds the item's Corruption Value while active; weekly
 * corruption adds 1 Sin while it is merely carried.
 */
export async function applyDarkItemCorruption(actor, item, { period = "dawn" } = {}) {
    if (!actor || !isDarkMagicItem(item)) return null;

    const corruptionValue = getDarkMagicItemCorruptionValue(item);
    const sinGain = period === "week" ? 1 : corruptionValue;
    const sinBefore = Number(actor.system.darkMagic?.currentSin || 0);
    const sinAfter = sinBefore + sinGain;
    const threshold = Number(actor.system.darkMagic?.sinThreshold || 0);
    const overflow = sinAfter - threshold;
    const updates = { "system.darkMagic.currentSin": sinAfter };
    let attack = null;

    if (overflow > 0) {
        attack = await performAddictionAttack(actor, corruptionValue, updates);
    } else {
        await actor.update(updates);
    }
    const cadence = period === "week" ? "weekly passive corruption" : "dawn attunement corruption";
    const check = overflow > 0
        ? buildAttackResult(attack)
        : `<p>Sin remains within the threshold; no Dark Magic attack is made.</p>`;
    const messageData = {
        speaker: ChatMessage.getSpeaker({ actor }),
        flavor: attack ? "Dark Magic Addiction Attack" : "Dark Magic Item Corruption",
        content: `<div class="thefade-sin-summary"><h3>${escapeHTML(item.name)}</h3><p><strong>${escapeHTML(actor.name)}</strong> suffers ${cadence} (Corruption Value ${corruptionValue}).</p><p>Sin: ${sinBefore} → <strong>${sinAfter}</strong> (threshold ${threshold}).</p>${check}</div>`
    };
    if (attack) await attack.attackRoll.toMessage(messageData);
    else await ChatMessage.create(messageData);

    return { corruptionValue, sinGain, sinBefore, sinAfter, threshold, overflow, ...attack };
}

function buildAttackResult(attack) {
    const poolBreakdown = attack.addictionBonus
        ? `${attack.castingDT}D base + ${attack.addictionBonus}D Addiction`
        : `${attack.castingDT}D base`;
    const result = [`<p>Dark Magic attack: ${attack.dicePool}D (${poolBreakdown}) against Grit ${attack.gritTarget} — <strong>${attack.attackSuccesses}</strong> successes: <strong>${attack.attackHits ? "HIT" : "MISS"}</strong>.</p>`];
    if (attack.attackHits) {
        result.push(`<p>The hit deals <strong>${attack.sanityDamage} Sanity damage</strong> (1d6): ${attack.sanityBefore} → ${attack.sanityAfter}. `);
        result.push(attack.stageAdvanced
            ? `Addiction advances to <strong>${attack.stageAdvanced}</strong>.</p>`
            : `Addiction is already at the terminal stage.</p>`);
    } else {
        result.push(`<p class="success">The pull is resisted.</p>`);
    }
    return result.join("");
}

function buildSummary(o) {
    const parts = [];
    parts.push(`<p><strong>${escapeHTML(o.actor)}</strong> casts <em>${escapeHTML(o.spell)}</em> (Dark Magic, DT ${o.dt}).</p>`);
    parts.push(`<p>Sin: ${o.sinBefore} → <strong>${o.sinAfter}</strong> (threshold ${o.threshold}).</p>`);
    if (o.overflow > 0) {
        parts.push(`<p>Sin exceeds its threshold.</p>`);
        parts.push(buildAttackResult(o.attack));
    } else {
        parts.push(`<p>Within threshold — no Dark Magic attack is made.</p>`);
    }
    return `<div class="thefade-sin-summary">${parts.join("")}</div>`;
}

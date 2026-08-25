// Conditions engine for The Fade - Abyss.
// Drives: passive actor-state deltas (Avoid/Grit/Resilience/speed/action economy)
// and per-roll dice modifiers (attack, skill, spell, addiction).
//
// Rules source: Core Rulebook Conditions chapter. Default duration is 3 rounds
// unless otherwise noted; conditions don't stack (higher severity wins; duration
// resets). See AUDIT.md for traceability.

export const CONDITION_INTENSITIES = ["trivial", "moderate", "severe"];

// Reuse Foundry's bundled monochrome SVGs so status icons remain readable at
// token scale and do not add a second asset pipeline to the system.
export const CONDITION_STATUS_ICONS = Object.freeze({
    bleed: "icons/svg/blood.svg",
    blindness: "icons/svg/blind.svg",
    confusion: "icons/svg/mystery-man.svg",
    dazed: "icons/svg/daze.svg",
    deafness: "icons/svg/deaf.svg",
    fatigue: "icons/svg/downgrade.svg",
    fear: "icons/svg/terror.svg",
    flatFooted: "icons/svg/falling.svg",
    illness: "icons/svg/biohazard.svg",
    pain: "icons/svg/degen.svg",
    paralysis: "icons/svg/paralysis.svg",
    sleep: "icons/svg/sleep.svg",
    staggered: "icons/svg/walk.svg",
    stunned: "icons/svg/lightning.svg"
});

export const CONDITION_STATUS_PREFIX = "thefade.";

export function getConditionStatusId(conditionKey) {
    return CONDITION_EFFECTS[conditionKey] ? `${CONDITION_STATUS_PREFIX}${conditionKey}` : null;
}

export function getConditionKeyFromStatusId(statusId) {
    if (typeof statusId !== "string" || !statusId.startsWith(CONDITION_STATUS_PREFIX)) return null;
    const conditionKey = statusId.slice(CONDITION_STATUS_PREFIX.length);
    return CONDITION_EFFECTS[conditionKey] ? conditionKey : null;
}

/**
 * Make Foundry's Assign Status Effects palette system-owned. The Fade does not
 * use Foundry's generic conditions or module-added status definitions.
 */
export function registerTheFadeStatusEffects() {
    CONFIG.statusEffects = Object.entries(CONDITION_EFFECTS).map(([key, definition]) => ({
        id: getConditionStatusId(key),
        name: definition.label,
        img: CONDITION_STATUS_ICONS[key],
        hud: { actorTypes: ["character", "npc"] },
        flags: {
            thefade: {
                condition: key,
                tiered: definition.tiered === true
            }
        }
    }));
    return CONFIG.statusEffects;
}

// Effect primitives returned by state()/roll():
//   state() → { avoidDelta, gritDelta, resilienceDelta, speedMultiplier,
//               minorLoss, majorLoss, reactionLoss, reactionLimit,
//               prone, helpless, immobile, unableToAct, noReactions, behavior }
//   roll(ctx) → { bonusDice, penaltyDice, notes[], autoFail }
//
// Roll context shape:
//   { kind: "skill"|"attack"|"spell"|"addiction"|"attribute"|"initiative",
//     skillName?, skillCategory?, attributeName?, isRanged?, weaponSkill? }
export const CONDITION_EFFECTS = {
    bleed: {
        label: "Bleed",
        tiered: true,
        intensities: {
            trivial: { damagePerRound: 1 },
            moderate: { damagePerRound: 3 },
            severe: { damagePerRound: 5 }
        }
    },
    blindness: {
        label: "Blinded",
        tiered: false,
        state: () => ({ avoidDelta: -5 }),
        roll: (ctx) => {
            if (ctx?.kind === "attack") {
                return { penaltyDice: 4, notes: ["Blindness: -4D to attack"] };
            }
            if (ctx?.skillName === "Sight") {
                return { autoFail: true, notes: ["Blindness: cannot make Sight checks"] };
            }
            return {};
        }
    },
    confusion: {
        label: "Confused",
        tiered: false,
        roll: (ctx) => {
            if (ctx?.kind === "attack") {
                return { notes: ["Confusion: on failed attack, hit self or ally in reach/range"] };
            }
            return {};
        }
    },
    dazed: {
        label: "Dazed",
        tiered: true,
        intensities: {
            trivial: { state: () => ({ avoidDelta: -1 }) },
            moderate: { state: () => ({ minorLoss: 1 }) },
            severe: { state: () => ({ majorLoss: 1 }) }
        }
    },
    deafness: {
        label: "Deafened",
        tiered: false,
        state: () => ({ avoidDelta: -2 }),
        roll: (ctx) => {
            if (ctx?.skillName === "Hearing") {
                return { autoFail: true, notes: ["Deafness: cannot make Hearing checks"] };
            }
            return {};
        }
    },
    fatigue: {
        label: "Fatigued",
        tiered: true,
        intensities: {
            trivial: { state: () => ({ speedMultiplier: 0.75 }) },
            moderate: { state: () => ({ speedMultiplier: 0.5 }) },
            severe: {
                state: () => ({ speedMultiplier: 0.5 }),
                roll: (ctx) => {
                    if (ctx?.skillCategory === "Physical") {
                        return { penaltyDice: 3, notes: ["Severe Fatigue: -3D to Physical skills"] };
                    }
                    return {};
                }
            }
        }
    },
    fear: {
        label: "Fear",
        tiered: true,
        intensities: {
            trivial: {
                state: () => ({ avoidDelta: -1 }),
                roll: (ctx) => {
                    if (ctx?.kind === "attack") {
                        return { bonusDice: 1, notes: ["Fear (trivial): +1D to attack"] };
                    }
                    return {};
                }
            },
            moderate: { state: () => ({ behavior: "run" }) },
            severe: { state: () => ({ behavior: "cower" }) }
        }
    },
    flatFooted: {
        label: "Flat-Footed",
        tiered: false,
        state: () => ({ avoidDelta: -2, unableToAct: true, noReactions: true })
    },
    illness: {
        label: "Ill",
        tiered: true,
        intensities: {
            trivial: { state: () => ({ resilienceDelta: -1 }) },
            moderate: { state: () => ({ resilienceDelta: -3 }) },
            severe: { state: () => ({ resilienceDelta: -6, minorLoss: "all" }) }
        }
    },
    pain: {
        label: "In Pain",
        tiered: true,
        intensities: {
            trivial: { state: () => ({ avoidDelta: -1, gritDelta: -1 }) },
            moderate: { state: () => ({ avoidDelta: -3, gritDelta: -3 }) },
            severe: { state: () => ({ avoidDelta: -6, gritDelta: -6, prone: true }) }
        }
    },
    paralysis: {
        label: "Paralyzed",
        tiered: true,
        intensities: {
            trivial: { state: () => ({ avoidDelta: -2 }) },
            moderate: { state: () => ({ avoidDelta: -4, speedMultiplier: 0.5 }) },
            severe: { state: () => ({ helpless: true, immobile: true, unableToAct: true }) }
        }
    },
    sleep: {
        label: "Asleep",
        tiered: false,
        state: () => ({ prone: true, helpless: true, unableToAct: true, immobile: true })
    },
    staggered: {
        label: "Staggered",
        tiered: true,
        intensities: {
            trivial: { state: () => ({ reactionLimit: 1 }) },
            moderate: { state: () => ({ reactionLoss: "all" }) },
            severe: { state: () => ({ reactionLoss: "all", minorLoss: "all" }) }
        }
    },
    stunned: {
        label: "Stunned",
        tiered: true,
        intensities: {
            trivial: { state: () => ({ avoidDelta: -1 }) },
            moderate: { state: () => ({ avoidDelta: -3, speedMultiplier: 0.5 }) },
            severe: { state: () => ({ immobile: true, unableToAct: true }) }
        }
    }
};

/**
 * Walk active conditions and return the matching `state`/`roll` hook and
 * effect record (tiered vs binary). Internal helper.
 */
function _forEachActive(conditions, cb) {
    if (!conditions) return;
    for (const [key, data] of Object.entries(conditions)) {
        if (!data || !data.active) continue;
        const def = CONDITION_EFFECTS[key];
        if (!def) continue;
        const intensity = def.tiered ? (data.intensity || "trivial") : null;
        const source = def.tiered ? def.intensities?.[intensity] : def;
        if (!source) continue;
        cb(key, def, source, intensity);
    }
}

/**
 * Aggregate passive state modifiers from every active condition.
 * Applied once per actor prepareData pass.
 */
export function aggregateConditionState(conditions) {
    const out = {
        avoidDelta: 0, gritDelta: 0, resilienceDelta: 0,
        speedMultiplier: 1,
        minorLoss: 0, majorLoss: 0, reactionLoss: 0, reactionLimit: null,
        prone: false, helpless: false, immobile: false,
        unableToAct: false, noReactions: false, behavior: null,
        sources: []
    };

    _forEachActive(conditions, (key, def, source, intensity) => {
        const effect = typeof source.state === "function" ? source.state() : null;
        if (!effect) return;

        out.sources.push({ key, label: def.label, intensity });

        if (typeof effect.avoidDelta === "number") out.avoidDelta += effect.avoidDelta;
        if (typeof effect.gritDelta === "number") out.gritDelta += effect.gritDelta;
        if (typeof effect.resilienceDelta === "number") out.resilienceDelta += effect.resilienceDelta;
        if (typeof effect.speedMultiplier === "number") {
            out.speedMultiplier = Math.min(out.speedMultiplier, effect.speedMultiplier);
        }

        if (effect.minorLoss === "all") out.minorLoss = "all";
        else if (typeof effect.minorLoss === "number" && out.minorLoss !== "all") out.minorLoss += effect.minorLoss;

        if (effect.majorLoss === "all") out.majorLoss = "all";
        else if (typeof effect.majorLoss === "number" && out.majorLoss !== "all") out.majorLoss += effect.majorLoss;

        if (effect.reactionLoss === "all") out.reactionLoss = "all";
        else if (typeof effect.reactionLoss === "number" && out.reactionLoss !== "all") out.reactionLoss += effect.reactionLoss;

        if (typeof effect.reactionLimit === "number") {
            out.reactionLimit = out.reactionLimit === null
                ? effect.reactionLimit
                : Math.min(out.reactionLimit, effect.reactionLimit);
        }

        if (effect.prone) out.prone = true;
        if (effect.helpless) out.helpless = true;
        if (effect.immobile) out.immobile = true;
        if (effect.unableToAct) out.unableToAct = true;
        if (effect.noReactions) out.noReactions = true;
        if (effect.behavior) out.behavior = effect.behavior;
    });

    return out;
}

/**
 * Per-roll dice modifiers from active conditions.
 * `context.kind` is required; other fields are optional.
 */
export function computeRollModifiers(conditions, context) {
    const out = { bonusDice: 0, penaltyDice: 0, notes: [], autoFail: false };

    _forEachActive(conditions, (key, def, source) => {
        if (typeof source.roll !== "function") return;
        const r = source.roll(context) || {};
        if (typeof r.bonusDice === "number") out.bonusDice += r.bonusDice;
        if (typeof r.penaltyDice === "number") out.penaltyDice += r.penaltyDice;
        if (r.autoFail) out.autoFail = true;
        if (Array.isArray(r.notes) && r.notes.length) out.notes.push(...r.notes);
    });

    return out;
}

/**
 * Collect per-round damage contributions (e.g. Bleed) for a turn-start hook.
 * Returns [{ condition, intensity, damage, type }].
 */
export function computePerRoundDamage(conditions) {
    const out = [];
    _forEachActive(conditions, (key, def, source, intensity) => {
        if (typeof source.damagePerRound === "number" && source.damagePerRound > 0) {
            out.push({ condition: key, label: def.label, intensity, damage: source.damagePerRound });
        }
    });
    return out;
}

/**
 * HTML snippet summarizing the condition modifiers that applied to a roll.
 * Injected at the top of chat card content. Returns "" if nothing applied.
 */
export function renderModifierHtml(mods) {
    if (!mods) return "";
    const hasDice = mods.bonusDice || mods.penaltyDice;
    if (!hasDice && !mods.autoFail && (!mods.notes || !mods.notes.length)) return "";

    const chips = [];
    if (mods.autoFail) chips.push(`<strong>Auto-fail</strong>`);
    if (mods.bonusDice) chips.push(`+${mods.bonusDice}D`);
    if (mods.penaltyDice) chips.push(`-${mods.penaltyDice}D`);

    const head = chips.length ? `<p class="thefade-cond-mods"><em>Condition effects:</em> ${chips.join(" · ")}</p>` : "";
    const noteLines = (mods.notes || []).map(n => `<li>${n}</li>`).join("");
    const notes = noteLines ? `<ul class="thefade-cond-notes">${noteLines}</ul>` : "";
    return head + notes;
}

/**
 * Debug summary of the passive state aggregate (shown on the character sheet).
 */
export function summarizeConditionState(state) {
    if (!state) return null;
    const parts = [];
    if (state.avoidDelta) parts.push(`Avoid ${state.avoidDelta > 0 ? "+" : ""}${state.avoidDelta}`);
    if (state.gritDelta) parts.push(`Grit ${state.gritDelta > 0 ? "+" : ""}${state.gritDelta}`);
    if (state.resilienceDelta) parts.push(`Resilience ${state.resilienceDelta > 0 ? "+" : ""}${state.resilienceDelta}`);
    if (state.speedMultiplier !== 1) parts.push(`Speed ×${state.speedMultiplier}`);
    if (state.minorLoss) parts.push(`Lose ${state.minorLoss === "all" ? "all" : state.minorLoss} Minor`);
    if (state.majorLoss) parts.push(`Lose ${state.majorLoss === "all" ? "all" : state.majorLoss} Major`);
    if (state.reactionLoss === "all") parts.push("No Reactions");
    else if (state.reactionLimit !== null) parts.push(`Reactions ≤ ${state.reactionLimit}`);
    if (state.prone) parts.push("Prone");
    if (state.helpless) parts.push("Helpless");
    if (state.immobile) parts.push("Immobile");
    if (state.unableToAct) parts.push("Cannot act");
    if (state.behavior === "run") parts.push("Runs from fear (fights if cornered)");
    if (state.behavior === "cower") parts.push("Drops items and cowers");
    return parts.join(" · ");
}

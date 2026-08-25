import { COMBAT_STATUS_IMMUNITIES, DAMAGE_TYPE_LABELS } from './constants.js';
import { CONDITION_EFFECTS, CONDITION_INTENSITIES } from './conditions.js';

const SPELL_DEFENSES = ["Avoid", "Resilience", "Grit"];
const DEFAULT_STATUS = "pain";
const DEFAULT_SPELL_SUCCESSES = 3;
const STATUS_LABELS = Object.fromEntries(
    COMBAT_STATUS_IMMUNITIES
        .filter(entry => entry.key !== "all")
        .map(entry => [entry.key, entry.label])
);

export const SPELL_STATUS_OPTIONS = Object.fromEntries(
    Object.entries(CONDITION_EFFECTS).map(([key, definition]) => [key, STATUS_LABELS[key] || definition.label])
);

export const SPELL_STATUS_INTENSITY_OPTIONS = Object.fromEntries(
    CONDITION_INTENSITIES.map(intensity => [
        intensity,
        intensity.charAt(0).toUpperCase() + intensity.slice(1)
    ])
);

function normalizeSuccessRequirement(value, fallback = DEFAULT_SPELL_SUCCESSES) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Rune spells have separate thresholds for drawing and activation. Legacy
 * Rune items fall back to their original single successes value for both.
 */
export function getSpellSuccessRequirements(system) {
    const successes = normalizeSuccessRequirement(system?.successes);
    const isRune = system?.school === "Runes";
    return {
        isRune,
        successes,
        symbology: isRune
            ? normalizeSuccessRequirement(system?.symbologySuccesses, successes)
            : null,
        spellcasting: isRune
            ? normalizeSuccessRequirement(system?.spellcastingSuccesses, successes)
            : successes
    };
}

export function formatSpellSuccessRequirements(system, { compact = false } = {}) {
    const requirements = getSpellSuccessRequirements(system);
    if (!requirements.isRune) return String(requirements.spellcasting);
    return compact
        ? `S ${requirements.symbology} / C ${requirements.spellcasting}`
        : `Symbology ${requirements.symbology} / Spellcasting ${requirements.spellcasting}`;
}

/**
 * Return normalized, typed damage entries for a spell. Legacy spells that
 * only store damage/damageType are represented as a single component.
 */
export function getSpellDamageComponents(system) {
    const stored = Array.isArray(system?.damageComponents) ? system.damageComponents : [];
    const components = stored.map((entry, index) => ({
        id: entry.id || `component-${index}`,
        amount: Math.max(0, Number(entry.amount) || 0),
        type: entry.type || "Ut"
    }));

    const legacyAmount = Math.max(0, Number(system?.damage) || parseInt(system?.damage, 10) || 0);
    if (!components.length && legacyAmount > 0) {
        components.push({
            id: "legacy",
            amount: legacyAmount,
            type: system.damageType || "Ut"
        });
    }

    return components;
}

/**
 * Build the damage data used by actor lists and spell-cast chat cards.
 */
export function buildSpellDamageProfile(system) {
    const components = getSpellDamageComponents(system)
        .filter(entry => entry.amount > 0)
        .map(entry => ({
            ...entry,
            label: DAMAGE_TYPE_LABELS[entry.type] || entry.type || "Untyped"
        }));

    return {
        components,
        total: components.reduce((sum, entry) => sum + entry.amount, 0),
        primaryType: components[0]?.type || "",
        display: components.length
            ? components.map(entry => `${entry.amount} ${entry.label}`).join(" + ")
            : "—"
    };
}

/** Sanity damage is a separate track and may be a number or dice expression. */
export function getSpellSanityDamage(system) {
    const value = String(system?.sanityDamage ?? "").trim();
    if (!value || value === "0") return "";
    return value;
}

/** Return normalized status outcomes with display metadata for the sheet/chat. */
export function getSpellStatusEffects(system) {
    const stored = Array.isArray(system?.statusEffects) ? system.statusEffects : [];
    return stored.map((entry, index) => {
        const status = CONDITION_EFFECTS[entry.status] ? entry.status : DEFAULT_STATUS;
        const definition = CONDITION_EFFECTS[status];
        const tiered = definition.tiered === true;
        const intensity = tiered && CONDITION_INTENSITIES.includes(entry.intensity)
            ? entry.intensity
            : (tiered ? "trivial" : "");
        return {
            id: entry.id || `status-${index}`,
            status,
            label: STATUS_LABELS[status] || definition.label,
            tiered,
            intensity,
            intensityLabel: intensity
                ? SPELL_STATUS_INTENSITY_OPTIONS[intensity]
                : "",
            duration: String(entry.duration || "").trim(),
            notes: String(entry.notes || "").trim()
        };
    });
}

/** Return normalized authored buffs. Buffs are descriptive, not item bonuses. */
export function getSpellBuffEffects(system) {
    const stored = Array.isArray(system?.buffEffects) ? system.buffEffects : [];
    return stored.map((entry, index) => ({
        id: entry.id || `buff-${index}`,
        name: String(entry.name || "").trim(),
        target: String(entry.target || "").trim(),
        duration: String(entry.duration || "").trim(),
        description: String(entry.description || "").trim()
    }));
}

export function formatSpellStatusEffect(effect) {
    if (!effect) return "";
    const name = effect.tiered
        ? `${effect.intensityLabel} ${effect.label}`
        : effect.label;
    const duration = effect.duration ? ` for ${effect.duration}` : "";
    const notes = effect.notes ? ` — ${effect.notes}` : "";
    return `${name}${duration}${notes}`;
}

export function formatSpellBuffEffect(buff) {
    if (!buff) return "";
    const name = buff.name || "Unnamed Buff";
    const target = buff.target ? ` (${buff.target})` : "";
    const duration = buff.duration ? ` for ${buff.duration}` : "";
    const description = buff.description ? ` — ${buff.description}` : "";
    return `${name}${target}${duration}${description}`;
}

/** Build every non-attack outcome without mixing Sanity into HP damage. */
export function buildSpellEffectsProfile(system) {
    const sanityDamage = getSpellSanityDamage(system);
    const statusEffects = getSpellStatusEffects(system).map(effect => ({
        ...effect,
        display: formatSpellStatusEffect(effect)
    }));
    const buffEffects = getSpellBuffEffects(system).map(buff => ({
        ...buff,
        display: formatSpellBuffEffect(buff)
    }));
    return {
        sanityDamage,
        sanityDisplay: sanityDamage ? `${sanityDamage} Sanity` : "",
        statusEffects,
        buffEffects,
        hasEffects: !!sanityDamage || statusEffects.length > 0 || buffEffects.length > 0
    };
}

/** Compact damage-column summary which keeps the two tracks explicit. */
export function formatSpellDamageTracks(system) {
    const hp = buildSpellDamageProfile(system);
    const sanity = getSpellSanityDamage(system);
    const parts = [];
    if (hp.total) parts.push(`${hp.display} HP`);
    if (sanity) parts.push(`${sanity} Sanity`);
    return parts.join(" + ") || "—";
}

/**
 * Return every defense checked by a spell. Besides the current pipe-delimited
 * storage, this recognizes legacy prose such as "vs. Resilience and vs. Grit".
 */
export function getSpellAttackTargets(system) {
    const stored = Array.isArray(system?.attackTargets)
        ? system.attackTargets
        : [];
    const candidates = [...stored];
    const legacy = String(system?.attack || "");
    for (const defense of SPELL_DEFENSES) {
        if (new RegExp(`\\b${defense}\\b`, "i").test(legacy)) candidates.push(defense);
    }

    const normalized = candidates
        .map(value => SPELL_DEFENSES.find(defense => defense.toLowerCase() === String(value).toLowerCase()))
        .filter(Boolean);
    return [...new Set(normalized)];
}

export function formatSpellAttackTargets(system) {
    const targets = getSpellAttackTargets(system);
    if (!targets.length) return "—";
    return targets.map(target => `vs. ${target}`).join(" and ");
}

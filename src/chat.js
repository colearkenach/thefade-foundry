// Utility helpers for chat message bonus option handling

import { DEBUG } from './constants.js';
import { applyDamage } from './damage.js';

/**
 * Bind bonus option buttons in chat messages
 * @param {JQuery} html - chat message HTML
 * @param {Object} config
 * @param {string} config.buttonSelector - selector for clickable options
 * @param {string} config.remainingSelector - selector for remaining successes element
 * @param {string} config.appliedSelector - selector for applied effects container
 * @param {Object<string,Function>} config.handlers - mapping of option -> async handler
 * @param {string} [config.scopeSelector] - independently tracks successes within each matching section
 */
export function bindBonusHandlers(html, { buttonSelector, remainingSelector, appliedSelector, handlers, scopeSelector }) {
    const scopes = scopeSelector
        ? html.filter(scopeSelector).add(html.find(scopeSelector)).toArray()
        : [html];

    for (const scopeElement of scopes) {
        const scope = scopeSelector ? $(scopeElement) : html;
        const bonusOptions = scope.find(buttonSelector);
        if (!bonusOptions.length) continue;

        const appliedEffects = scope.find(appliedSelector);
        let remaining = parseInt(scope.find(remainingSelector).first().text(), 10) || 0;
        const usedEffects = new Set();
        const counters = {};

        bonusOptions.on('click', async (event) => {
            const button = event.currentTarget;
            const option = button.dataset.option;
            const cost = parseInt(button.dataset.cost, 10) || 0;

            if (usedEffects.has(option) && option !== 'critical') {
                ui.notifications?.warn(`This effect has already been applied.`);
                return;
            }

            if (remaining < cost) {
                ui.notifications?.warn(`Not enough bonus successes remaining.`);
                return;
            }

            remaining -= cost;
            scope.find(remainingSelector).text(remaining);

            const handler = handlers[option];
            let effectHTML = "";
            if (handler) {
                effectHTML = await handler(button, { cost, counters });
            } else if (DEBUG) {
                console.debug(`No handler for option ${option}`);
            }

            if (effectHTML) {
                appliedEffects.append(effectHTML);
                usedEffects.add(option);
            }

            bonusOptions.each((i, btn) => {
                if ((parseInt(btn.dataset.cost, 10) || 0) > remaining) {
                    $(btn).prop('disabled', true).addClass('disabled');
                }
            });
        });
    }
}

// Handlers for general bonus options
export const bonusOptionHandlers = {
    critical: async (button) => {
        // Roll an additional damage die per point of base damage (Core Rulebook:
        // "spend the critical threshold in successes to roll another full damage
        // roll"). We treat "+{damage} damage" as a flat additional chunk equal
        // to a fresh d12-pool of the base damage, rolled here so the card can
        // show the actual number (not a flat maximum).
        const baseDamage = parseInt(button.dataset.damage) || 0;
        if (baseDamage <= 0) {
            return `<p><strong>Critical Hit:</strong> no additional damage (base 0)</p>`;
        }
        // Flat additional damage equal to base damage (most common interpretation).
        const critDamage = baseDamage;

        // Push the crit damage into the card's running total so Apply Damage
        // includes it. The card stores it in a dataset slot we can update.
        const card = button.closest('.attack-card');
        if (card) {
            const prior = parseInt(card.dataset.critDamage || "0") || 0;
            card.dataset.critDamage = String(prior + critDamage);
            const totalEl = card.querySelector('.base-damage-value');
            if (totalEl) {
                const base = parseInt(card.dataset.baseDamage) || 0;
                totalEl.textContent = String(base + prior + critDamage);
            }
            const primaryComponent = card.querySelector('.damage-component .damage-component-value');
            if (primaryComponent) {
                const current = parseInt(primaryComponent.textContent || "0") || 0;
                primaryComponent.textContent = String(current + critDamage);
            }
        }
        return `<p><strong>Critical Hit:</strong> +${critDamage} damage rolled into total</p>`;
    },
    fire: async (button, { cost }) => {
        const fireDuration = await new Roll("1d6").evaluate({ async: true });
        const fireRounds = fireDuration.total + (cost - 2);
        return `<p><strong>Fire:</strong> Target catches fire for ${fireRounds} rounds - 1d6 fire damage per round until extinguished</p>`;
    },
    cold: async (button, { cost }) => {
        return `<p><strong>Cold:</strong> Fatigue (Low Intensity) for ${cost - 1} rounds - Target suffers penalties to physical actions</p>`;
    },
    acid: async (button, { cost }) => {
        return `<p><strong>Acid:</strong> Pain (Low Intensity) for ${cost - 1} rounds - Target suffers penalties to concentration</p>`;
    },
    electricity: async () => {
        return `<p><strong>Electricity:</strong> Chain lightning - Attack chains to adjacent target for half damage</p>`;
    },
    sonic: async (button) => {
        const halfDamage = parseInt(button.dataset.damage || 1);
        return `<p><strong>Sonic:</strong> Deafness for ${halfDamage} rounds - Target cannot hear and has disadvantage on awareness checks</p>`;
    },
    smiting: async () => {
        const fearDuration = await new Roll("1d6").evaluate({ async: true });
        return `<p><strong>Smiting:</strong> Fear (Moderate) for ${fearDuration.total} rounds - Target must make a Grit check to take aggressive actions</p>`;
    },
    expel: async () => {
        const stunDuration = await new Roll("1d6").evaluate({ async: true });
        return `<p><strong>Expel:</strong> Stunned (Moderate) for ${stunDuration.total} rounds - Target can take only one action per turn</p>`;
    },
    "psychokinetic-damage": async () => {
        return `<p><strong>Psychokinetic (Sanity):</strong> Deal half damage to target's sanity as well as HP</p>`;
    },
    "psychokinetic-confusion": async () => {
        const confusionDuration = await new Roll("1d6").evaluate({ async: true });
        return `<p><strong>Psychokinetic (Confusion):</strong> Confusion for ${confusionDuration.total} rounds - Target has trouble determining friend from foe</p>`;
    },
    corruption: async () => {
        return `<p><strong>Corruption:</strong> Half damage unhealable for 24 hours - Wounds resist magical and natural healing</p>`;
    }
};

// Handlers for spell bonus options
export const spellBonusHandlers = {
    critical: async (button) => {
        const critDamage = parseInt(button.dataset.damage);
        return `<p><strong>Critical Hit:</strong> +${critDamage} damage - Additional damage from a powerful magical strike</p>`;
    },
    increasedamage: async (button, { counters }) => {
        counters.damageIncrease = (counters.damageIncrease || 0) + 1;
        return `<p><strong>Increased Damage:</strong> +${counters.damageIncrease} to base damage</p>`;
    },
    increaserange: async (button, { counters }) => {
        counters.rangeIncrease = (counters.rangeIncrease || 0) + 1;
        return `<p><strong>Increased Range:</strong> +${counters.rangeIncrease} hex to spell range</p>`;
    },
    increaseduration: async (button, { counters }) => {
        counters.durationIncrease = (counters.durationIncrease || 0) + 1;
        return `<p><strong>Increased Duration:</strong> +${counters.durationIncrease} time increment</p>`;
    },
    spellbonus: async () => {
        return `<p><strong>Enhanced Effect:</strong> Spell potency increased</p>`;
    },
    custombonus: async (button) => {
        return `<p><strong>Bonus Effect:</strong> ${button.textContent.trim()}</p>`;
    }
};

export const attackBonusHandlers = { ...bonusOptionHandlers };

/**
 * Wire the "Apply Damage" button on an attack chat card. Reads the target
 * UUID, current base damage, hit location, and damage type from the card's
 * data-* attributes, then routes through the damage cascade in damage.js.
 * GM-only to avoid every player double-applying the same hit.
 */
function bindApplyDamage(html) {
    const button = html.find('.apply-damage-btn');
    if (!button.length) return;

    button.on('click', async (event) => {
        event.preventDefault();
        if (!game.user?.isGM) {
            ui.notifications?.warn("Only the GM can apply damage.");
            return;
        }

        const card = button.closest('.attack-card')[0];
        if (!card) return;

        const targetUuid = card.dataset.targetUuid;
        if (!targetUuid) {
            ui.notifications?.warn("No target associated with this attack.");
            return;
        }

        const target = await fromUuid(targetUuid);
        const targetActor = target?.actor || target; // token doc -> actor
        if (!targetActor?.update) {
            ui.notifications?.error("Target actor not found.");
            return;
        }

        // Location is resolved at attack-roll time (random/default/called shot)
        // and baked into the card. Fallback to body only if the card predates
        // this change.
        const location = card.dataset.hitLocation || "body";
        const calledShot = card.dataset.calledShot === "1";
        // Read current damage including any critical bonus. Modern cards keep
        // every typed component in the DOM so resistances/immunities and armor
        // resolve against the correct type instead of the primary type only.
        const displayed = parseInt(card.querySelector('.base-damage-value')?.textContent || "0") || 0;
        const damageType = card.dataset.damageType || "Ut";
        const typedComponents = [...card.querySelectorAll('.damage-component')]
            .map(element => ({
                amount: parseInt(element.querySelector('.damage-component-value')?.textContent || "0") || 0,
                type: element.dataset.damageType || "Ut"
            }))
            .filter(component => component.amount > 0);
        const damageComponents = typedComponents.length
            ? typedComponents
            : [{ amount: displayed, type: damageType }];
        const minimumHpDamage = Math.max(0, parseInt(card.dataset.minimumHpDamage || "0") || 0);
        const damageTrack = card.dataset.damageTrack || "hp";
        const bypassArmor = card.dataset.bypassArmor === "1";
        const weaponName = card.dataset.weaponName || "an attack";
        const attackerUuid = card.dataset.attackerUuid;
        const attacker = attackerUuid ? await fromUuid(attackerUuid) : null;
        const sourceName = attacker?.name || weaponName;

        let result;
        if (damageTrack === "sanity") {
            const before = Number(targetActor.system.sanity?.value ?? 0);
            const after = before - displayed;
            await targetActor.update({ "system.sanity.value":after });
            result = {
                summary:`<div class="thefade-damage-summary"><strong>${targetActor.name}</strong> takes <strong>${displayed}</strong> ${damageType} damage to Sanity from ${sourceName}. Sanity ${before} → ${after}.</div>`
            };
        } else {
            const firstNonImmune = damageComponents.findIndex(component =>
                targetActor.system.combatTraits?.immunities?.damageTypes?.[component.type] !== true
            );
            const results = [];
            for (let index = 0; index < damageComponents.length; index++) {
                const component = damageComponents[index];
                results.push(await applyDamage(targetActor, {
                    amount: component.amount,
                    type: component.type,
                    location,
                    calledShot,
                    bypassArmor,
                    minimumHpDamage: index === firstNonImmune ? minimumHpDamage : 0,
                    sourceName: `${sourceName} (${weaponName})`
                }));
            }
            result = {
                summary: `<div class="thefade-damage-components">${results.map(entry => entry.summary).join("")}</div>`
            };
        }

        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: targetActor }),
            content: result.summary
        });

        // Grey out the button so a single card can't double-apply.
        button.prop('disabled', true).addClass('disabled').text('Applied');
    });
}

/**
 * Apply all chat bonus handlers to a rendered chat message
 * @param {JQuery} html
 */
export function applyBonusHandlers(html) {
    bindBonusHandlers(html, {
        scopeSelector: '.attack-card',
        buttonSelector: '.bonus-option',
        remainingSelector: '.remaining-successes',
        appliedSelector: '.applied-effects',
        handlers: bonusOptionHandlers
    });

    bindBonusHandlers(html, {
        scopeSelector: '.spell-casting-section',
        buttonSelector: '.spell-bonus, .spell-custom-bonus',
        remainingSelector: '.remaining-successes',
        appliedSelector: '.applied-effects',
        handlers: spellBonusHandlers
    });

    bindBonusHandlers(html, {
        scopeSelector: '.spell-attack-section',
        buttonSelector: '.attack-bonus',
        remainingSelector: '.attack-remaining-successes',
        appliedSelector: '.attack-applied-effects',
        handlers: attackBonusHandlers
    });

    bindApplyDamage(html);
}


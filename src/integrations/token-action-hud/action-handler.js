// Builds Token Action HUD actions from a selected The Fade actor.
import { ACTION_TYPE, ATTRIBUTES, GROUP } from "./constants.js";
import { getAllSkills } from "../../skills.js";
import { formatSpellSuccessRequirements } from "../../spell-rules.js";

export function makeActionHandler(coreApi) {
    return class TheFadeActionHandler extends coreApi.ActionHandler {
        async buildSystemActions(_groupIds) {
            const actor = this.actor;
            if (!actor) return;
            const type = actor.type;
            if (!["character", "npc"].includes(type)) return;

            this._buildAttributes(actor);
            this._buildWeapons(actor);
            this._buildUtility(actor);

            if (type === "character") {
                this._buildSkills(actor);
                this._buildSpells(actor);
                this._buildTalents(actor);
            }

            this._buildInventory(actor);
        }

        _enc(actionType, id) {
            return [actionType, id].join(this.delimiter ?? "|");
        }

        _push(groupId, actions) {
            if (!actions.length) return;
            this.addActions(actions, { id: groupId, type: "system" });
        }

        _buildAttributes(actor) {
            const attrs = actor.system?.attributes ?? {};
            const actions = ATTRIBUTES
                .filter(a => attrs[a])
                .map(a => {
                    const v = attrs[a]?.value ?? 0;
                    return {
                        id: `attribute-${a}`,
                        name: `${a[0].toUpperCase()}${a.slice(1)}`,
                        encodedValue: this._enc(ACTION_TYPE.attribute, a),
                        info1: { text: `${v}d12` }
                    };
                });
            this._push(GROUP.attributes.id, actions);
        }

        _buildSkills(actor) {
            const buckets = {
                "Combat":   GROUP.skillsCombat.id,
                "Physical": GROUP.skillsPhys.id,
                "Mental":   GROUP.skillsMental.id,
                "Social":   GROUP.skillsSocial.id,
                "Magical":  GROUP.skillsMagic.id
            };
            const grouped = {};
            for (const skill of getAllSkills(actor)) {
                const bucket = buckets[skill.category] || GROUP.skillsOther.id;
                (grouped[bucket] ??= []).push({
                    id: `skill-${skill.key}`,
                    name: skill.name,
                    encodedValue: this._enc(ACTION_TYPE.skill, skill.key),
                    info1: { text: this._rankAbbr(skill.rank) }
                });
            }
            for (const [groupId, actions] of Object.entries(grouped)) {
                actions.sort((a, b) => a.name.localeCompare(b.name));
                this._push(groupId, actions);
            }
        }

        _rankAbbr(rank) {
            const map = {
                untrained: "U", practiced: "P", adept: "A",
                experienced: "E", expert: "Ex", mastered: "M"
            };
            return map[rank] ?? "";
        }

        _buildWeapons(actor) {
            const weapons = actor.items.filter(i => i.type === "weapon");
            const actions = weapons.map(w => ({
                id: `weapon-${w.id}`,
                name: w.name,
                encodedValue: this._enc(ACTION_TYPE.weapon, w.id),
                img: w.img,
                info1: { text: w.system?.range || "" },
                info2: { text: w.system?.damage ? `${w.system.damage} ${w.system.damageType || ""}`.trim() : "" }
            }));
            this._push(GROUP.weapons.id, actions);
        }

        _buildSpells(actor) {
            const spells = actor.items.filter(i => i.type === "spell");
            const actions = spells.map(s => ({
                id: `spell-${s.id}`,
                name: s.name,
                encodedValue: this._enc(ACTION_TYPE.spell, s.id),
                img: s.img,
                info1: { text: s.system?.school || "" },
                info2: {
                    text: s.system?.school === "Runes"
                        ? formatSpellSuccessRequirements(s.system, { compact: true })
                        : `DT ${formatSpellSuccessRequirements(s.system)}`
                }
            }));
            actions.sort((a, b) => a.name.localeCompare(b.name));
            this._push(GROUP.spells.id, actions);
        }

        _buildTalents(actor) {
            const talents = actor.items.filter(i => i.type === "talent");
            const actions = talents.map(t => {
                const used = Number(t.system?.currentUses ?? 0);
                const max = Number(t.system?.usesPerDay ?? 0);
                const uses = max > 0 ? `${Math.max(0, max - used)}/${max}` : "";
                return {
                    id: `talent-${t.id}`,
                    name: t.name,
                    encodedValue: this._enc(ACTION_TYPE.talent, t.id),
                    img: t.img,
                    info1: { text: uses }
                };
            });
            actions.sort((a, b) => a.name.localeCompare(b.name));
            this._push(GROUP.talents.id, actions);
        }

        _buildInventory(actor) {
            const skip = new Set([
                "weapon", "armor", "skill", "path", "spell", "talent",
                "trait", "precept", "species"
            ]);
            const items = actor.items.filter(i => !skip.has(i.type));
            const actions = items.map(i => {
                const qty = Number(i.system?.quantity ?? 0);
                return {
                    id: `item-${i.id}`,
                    name: i.name,
                    encodedValue: this._enc(ACTION_TYPE.item, i.id),
                    img: i.img,
                    info1: { text: qty > 1 ? `×${qty}` : "" }
                };
            });
            actions.sort((a, b) => a.name.localeCompare(b.name));
            this._push(GROUP.inventory.id, actions);
        }

        _buildUtility(actor) {
            const actions = [
                {
                    id: "utility-initiative",
                    name: "Initiative",
                    encodedValue: this._enc(ACTION_TYPE.utility, "initiative")
                },
                {
                    id: "utility-sheet",
                    name: "Open Sheet",
                    encodedValue: this._enc(ACTION_TYPE.utility, "sheet")
                }
            ];
            if (actor.type === "character") {
                actions.push(
                    {
                        id: "utility-opposed",
                        name: "Opposed Roll",
                        encodedValue: this._enc(ACTION_TYPE.utility, "opposed")
                    },
                    {
                        id: "utility-aid",
                        name: "Aid Another",
                        encodedValue: this._enc(ACTION_TYPE.utility, "aid")
                    },
                    {
                        id: "utility-rest",
                        name: "Take Rest",
                        encodedValue: this._enc(ACTION_TYPE.utility, "rest")
                    }
                );
            }
            this._push(GROUP.utility.id, actions);
        }
    };
}

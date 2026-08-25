// Token-facing, stance, and native status-effect integration.
//
// Facing is a discrete neighboring hex, stored as an index from 0–5. There is
// no free rotation: selecting or aiming always snaps to one of the six faces.

import {
    CONDITION_EFFECTS,
    CONDITION_INTENSITIES,
    CONDITION_STATUS_ICONS,
    getConditionKeyFromStatusId,
    getConditionStatusId,
    registerTheFadeStatusEffects
} from "./conditions.js";
import { STANCES } from "./stances.js";

const FLAG_SCOPE = "thefade";
const FLAG_KEY = "facingHex";
const LEGACY_FLAG_KEY = "facing";

// Moving clockwise from the selected front hex produces exactly the six
// defense zones shown in the rules diagram.
const ZONE_BY_STEP = Object.freeze([
    "front",
    "flank",
    "backflank",
    "back",
    "backflank",
    "flank"
]);

const SIDE_COLORS = Object.freeze({
    front: 0x69A84F,
    flank: 0xF4D93F,
    backflank: 0xEE9838,
    back: 0xE33838
});

const ZONE_LABEL_KEYS = Object.freeze({
    front: "THEFADE.FacingFront",
    flank: "THEFADE.FacingFlank",
    backflank: "THEFADE.FacingBackFlank",
    back: "THEFADE.FacingBack"
});

const STANCE_BADGES = Object.freeze({
    dodgeStance: { text: "D", color: 0x4EA5D9 },
    parryingStance: { text: "P", color: 0xF5C542 },
    brace: { text: "B", color: 0xC85D5D },
    toughItOut: { text: "T", color: 0x6FAF72 },
    resoluteWill: { text: "R", color: 0x9B75C7 }
});

function normalizeHexDirection(value) {
    const number = Number(value);
    return Number.isFinite(number) ? ((Math.round(number) % 6) + 6) % 6 : 0;
}

function isFlatToppedGrid(grid = canvas?.grid) {
    return grid?.columns === true;
}

function directionVectors(grid = canvas?.grid) {
    // Indices are clockwise. Pointy-topped grids begin at NE; flat-topped
    // grids begin at N. Each entry points to the center of one adjacent hex.
    if (isFlatToppedGrid(grid)) {
        return [
            { x: 0, y: -1 },
            { x: 0.8660254, y: -0.5 },
            { x: 0.8660254, y: 0.5 },
            { x: 0, y: 1 },
            { x: -0.8660254, y: 0.5 },
            { x: -0.8660254, y: -0.5 }
        ];
    }
    return [
        { x: 0.5, y: -0.8660254 },
        { x: 1, y: 0 },
        { x: 0.5, y: 0.8660254 },
        { x: -0.5, y: 0.8660254 },
        { x: -1, y: 0 },
        { x: -0.5, y: -0.8660254 }
    ];
}

function directionLabels(grid = canvas?.grid) {
    return isFlatToppedGrid(grid)
        ? ["N", "NE", "SE", "S", "SW", "NW"]
        : ["NE", "E", "SE", "SW", "W", "NW"];
}

function legacyDegreesToHexDirection(value, grid = canvas?.grid) {
    const degrees = Number(value);
    if (!Number.isFinite(degrees)) return 0;
    const radians = ((((degrees % 360) + 360) % 360) * Math.PI) / 180;
    const legacyVector = { x: Math.sin(radians), y: -Math.cos(radians) };
    return closestHexDirection(legacyVector, grid);
}

function isTokenEligible(token) {
    return !!token?.actor && ["character", "npc"].includes(token.actor.type);
}

export function getTokenFacing(token) {
    const document = token?.document ?? token;
    const stored = document?.flags?.[FLAG_SCOPE]?.[FLAG_KEY];
    if (Number.isFinite(Number(stored))) return normalizeHexDirection(stored);
    return legacyDegreesToHexDirection(document?.flags?.[FLAG_SCOPE]?.[LEGACY_FLAG_KEY]);
}

export function closestHexDirection(vector, grid = canvas?.grid) {
    const dx = Number(vector?.x) || 0;
    const dy = Number(vector?.y) || 0;
    if (dx === 0 && dy === 0) return 0;

    let bestIndex = 0;
    let bestDot = -Infinity;
    directionVectors(grid).forEach((candidate, index) => {
        const dot = (dx * candidate.x) + (dy * candidate.y);
        if (dot > bestDot) {
            bestDot = dot;
            bestIndex = index;
        }
    });
    return bestIndex;
}

export function getHexDirectionFromPoints(origin, destination, grid = canvas?.grid) {
    if (!origin || !destination) return 0;
    return closestHexDirection({
        x: destination.x - origin.x,
        y: destination.y - origin.y
    }, grid);
}

export function classifyRelativeFacing(directionIndex, tokenFacingIndex = 0) {
    const step = (normalizeHexDirection(directionIndex) - normalizeHexDirection(tokenFacingIndex) + 6) % 6;
    return ZONE_BY_STEP[step];
}

export function classifyTokenFacing(attackerToken, targetToken, grid = canvas?.grid) {
    if (!attackerToken?.center || !targetToken?.center) return "front";
    const attackerDirection = getHexDirectionFromPoints(targetToken.center, attackerToken.center, grid);
    return classifyRelativeFacing(attackerDirection, getTokenFacing(targetToken));
}

export async function setTokenFacing(token, directionIndex) {
    if (!isTokenEligible(token)) return;
    await token.document.setFlag(FLAG_SCOPE, FLAG_KEY, normalizeHexDirection(directionIndex));
}

export async function setTokenFacingToward(token, point) {
    if (!isTokenEligible(token) || !point || !token.center) return;
    await setTokenFacing(token, getHexDirectionFromPoints(token.center, point));
}

function createText(text, style) {
    const TextClass = foundry?.canvas?.containers?.PreciseText ?? PIXI.Text;
    return new TextClass(text, style);
}

function tokenHexVertices(width, height, flatTopped) {
    const inset = Math.max(2, Math.min(width, height) * 0.025);
    const left = inset;
    const right = width - inset;
    const top = inset;
    const bottom = height - inset;
    const centerX = width / 2;
    const centerY = height / 2;

    if (flatTopped) {
        const quarterX = width * 0.25;
        return [
            { x: quarterX, y: top },
            { x: width - quarterX, y: top },
            { x: right, y: centerY },
            { x: width - quarterX, y: bottom },
            { x: quarterX, y: bottom },
            { x: left, y: centerY }
        ];
    }

    const quarterY = height * 0.25;
    return [
        { x: centerX, y: top },
        { x: right, y: quarterY },
        { x: right, y: height - quarterY },
        { x: centerX, y: bottom },
        { x: left, y: height - quarterY },
        { x: left, y: quarterY }
    ];
}

function drawFacingSides(container, token) {
    const width = token.w ?? token.width ?? 100;
    const height = token.h ?? token.height ?? 100;
    const vertices = tokenHexVertices(width, height, isFlatToppedGrid());
    const facing = getTokenFacing(token);
    const graphic = new PIXI.Graphics();

    for (let side = 0; side < 6; side++) {
        const start = vertices[side];
        const end = vertices[(side + 1) % 6];
        const zone = classifyRelativeFacing(side, facing);

        // A dark under-stroke keeps each face readable over bright token art.
        graphic.lineStyle(10, 0x161719, 0.78);
        graphic.moveTo(start.x, start.y);
        graphic.lineTo(end.x, end.y);
        graphic.lineStyle(6, SIDE_COLORS[zone], 1);
        graphic.moveTo(start.x, start.y);
        graphic.lineTo(end.x, end.y);
    }
    container.addChild(graphic);
}

function addStanceBadge(container, token, stanceKey) {
    const badge = STANCE_BADGES[stanceKey];
    if (!badge) return;
    const width = token.w ?? token.width ?? 100;
    const height = token.h ?? token.height ?? 100;
    const radius = Math.max(9, Math.min(14, Math.min(width, height) * 0.13));
    const x = width - radius - 3;
    const y = height - radius - 3;

    const background = new PIXI.Graphics();
    background.beginFill(0x17191C, 0.94);
    background.lineStyle(2, badge.color, 1);
    background.drawCircle(x, y, radius);
    background.endFill();
    container.addChild(background);

    const text = createText(badge.text, {
        fill: 0xFFFFFF,
        fontFamily: "Signika",
        fontSize: radius * 1.1,
        fontWeight: "700"
    });
    text.anchor?.set?.(0.5);
    text.position.set(x, y);
    container.addChild(text);
}

function overlaySignature(token) {
    return JSON.stringify({
        width: token.w ?? token.width,
        height: token.h ?? token.height,
        flat: isFlatToppedGrid(),
        facing: getTokenFacing(token),
        stance: token.actor?.system?.activeStance || "none"
    });
}

function removeTokenOverlay(token) {
    if (!token?.thefadeCombatStateGraphic) return;
    try { token.thefadeCombatStateGraphic.destroy({ children: true }); } catch (_) { /* already destroyed */ }
    token.thefadeCombatStateGraphic = null;
    token.thefadeCombatStateSignature = null;
}

export function drawTokenCombatState(token) {
    if (!token) return;
    if (!isTokenEligible(token)) {
        removeTokenOverlay(token);
        return;
    }

    const signature = overlaySignature(token);
    if (token.thefadeCombatStateGraphic && token.thefadeCombatStateSignature === signature) return;
    removeTokenOverlay(token);

    const root = new PIXI.Container();
    root.eventMode = "none";
    drawFacingSides(root, token);
    addStanceBadge(root, token, token.actor.system?.activeStance || "none");

    token.addChild(root);
    token.thefadeCombatStateGraphic = root;
    token.thefadeCombatStateSignature = signature;
}

function rootElement(html) {
    return (typeof HTMLElement !== "undefined" && html instanceof HTMLElement) ? html : (html?.[0] ?? html);
}

function actorHasStatus(actor, statusId) {
    return Array.from(actor?.effects || []).some(effect => effect.statuses?.has?.(statusId));
}

export async function synchronizeConditionStatusEffects(actor) {
    if (!actor || !["character", "npc"].includes(actor.type) || actor._thefadeConditionReconcile) return;
    actor._thefadeConditionReconcile = true;
    try {
        for (const key of Object.keys(CONDITION_EFFECTS)) {
            const statusId = getConditionStatusId(key);
            const shouldBeActive = actor.system?.conditions?.[key]?.active === true;
            if (actorHasStatus(actor, statusId) === shouldBeActive) continue;
            await actor.toggleStatusEffect(statusId, { active: shouldBeActive });
        }
    } finally {
        actor._thefadeConditionReconcile = false;
    }
}

async function synchronizeConditionFromActiveEffect(effect, active) {
    const actor = effect?.parent;
    if (!actor || actor._thefadeStatusEffectSync || !["character", "npc"].includes(actor.type)) return;

    const update = {};
    for (const statusId of effect.statuses || []) {
        const key = getConditionKeyFromStatusId(statusId);
        if (!key) continue;
        const nextActive = active || actorHasStatus(actor, statusId);
        if (actor.system?.conditions?.[key]?.active !== nextActive) {
            update[`system.conditions.${key}.active`] = nextActive;
        }
    }
    if (Object.keys(update).length) await actor.update(update);
}

function findStatusControl(target) {
    if (!(target instanceof Element)) return null;
    return target.closest("[data-status-id]")
        ?? target.closest(".effect-container")?.querySelector("[data-status-id]")
        ?? null;
}

function bindStatusPaletteInteractions(hud, root) {
    if (!root || root.dataset.thefadeStatusInteractions === "true") return;
    root.dataset.thefadeStatusInteractions = "true";

    const handleStatusInput = async event => {
        const control = findStatusControl(event.target);
        const conditionKey = getConditionKeyFromStatusId(control?.dataset?.statusId);
        if (!conditionKey) return;

        // Capture at the HUD root so generic counter/status modules cannot
        // reinterpret The Fade's T/M/S cycle before the system receives it.
        event.preventDefault();
        event.stopImmediatePropagation();

        const actor = hud?.actor ?? hud?.object?.actor;
        if (!actor) return;
        const state = actor.system?.conditions?.[conditionKey] || {};
        const definition = CONDITION_EFFECTS[conditionKey];
        const cycleIntensity = event.type === "contextmenu" && definition.tiered;
        await actor.toggleStatusEffect(control.dataset.statusId, {
            active: state.active !== true,
            overlay: cycleIntensity
        });
        decorateStatusPalette(hud, root);
    };

    root.addEventListener("click", handleStatusInput, { capture: true });
    root.addEventListener("contextmenu", handleStatusInput, { capture: true });
}

function decorateStatusPalette(hud, html) {
    registerTheFadeStatusEffects();
    const root = rootElement(html);
    const actor = hud?.actor ?? hud?.object?.actor;
    if (!root?.querySelectorAll || !actor) return;
    bindStatusPaletteInteractions(hud, root);

    for (const control of root.querySelectorAll(".status-effects .effect-control[data-status-id]")) {
        const key = getConditionKeyFromStatusId(control.dataset.statusId);
        if (!key) {
            const enhancedContainer = control.closest(".effect-container");
            if (enhancedContainer) enhancedContainer.remove();
            else control.remove();
            continue;
        }

        const definition = CONDITION_EFFECTS[key];
        const state = actor.system?.conditions?.[key] || {};
        const intensity = definition.tiered && CONDITION_INTENSITIES.includes(state.intensity)
            ? state.intensity
            : "trivial";
        const immune = actor.system?.statusImmunityLocks?.[key] === true;
        control.classList.toggle("active", state.active === true);
        control.classList.toggle("thefade-tiered-status", definition.tiered === true);
        control.classList.toggle("thefade-status-immune", immune);
        for (const level of CONDITION_INTENSITIES) {
            control.classList.toggle(`thefade-status-${level}`, definition.tiered && state.active === true && intensity === level);
        }
        control.src = CONDITION_STATUS_ICONS[key];
        control.dataset.tooltipText = definition.tiered
            ? `${definition.label} — ${intensity.charAt(0).toUpperCase() + intensity.slice(1)}. Right-click to cycle intensity.`
            : definition.label;
    }
}

function updateCombatPalette(panel, token) {
    if (!panel || !token?.actor) return;
    const facing = getTokenFacing(token);
    const labels = directionLabels();
    for (const button of panel.querySelectorAll("[data-facing-index]")) {
        const direction = normalizeHexDirection(button.dataset.facingIndex);
        const zone = classifyRelativeFacing(direction, facing);
        button.classList.toggle("is-active", direction === facing);
        for (const name of Object.keys(SIDE_COLORS)) button.classList.toggle(`zone-${name}`, name === zone);
        const directionLabel = button.querySelector("[data-direction-label]");
        const zoneLabel = button.querySelector("[data-zone-label]");
        if (directionLabel) directionLabel.textContent = labels[direction];
        if (zoneLabel) zoneLabel.textContent = game.i18n.localize(ZONE_LABEL_KEYS[zone]);
        button.title = `${labels[direction]}: ${game.i18n.localize(ZONE_LABEL_KEYS[zone])}`;
    }

    const readout = panel.querySelector("[data-facing-readout]");
    if (readout) readout.textContent = game.i18n.format("THEFADE.TokenFacingHexReadout", { direction: labels[facing] });

    for (const button of panel.querySelectorAll("[data-stance]")) {
        button.classList.toggle("is-active", button.dataset.stance === (token.actor.system?.activeStance || "none"));
    }
}

async function beginFacingPicker(token, panel) {
    const target = game.user.targets?.first();
    if (target && target !== token) {
        await setTokenFacingToward(token, target.center);
        ui.notifications.info(game.i18n.format("THEFADE.SetFacingTargeted", {
            token: token.name,
            target: target.name
        }));
        updateCombatPalette(panel, token);
        return;
    }

    panel.hidden = true;
    ui.notifications.info(game.i18n.localize("THEFADE.SetFacingClickPrompt"));
    const onCanvasClick = async event => {
        try {
            const point = event.getLocalPosition?.(canvas.stage)
                ?? event.data?.getLocalPosition?.(canvas.stage)
                ?? event.interactionData?.origin
                ?? event.global;
            if (point) await setTokenFacingToward(token, point);
        } finally {
            canvas.stage.off("pointerdown", onCanvasClick);
        }
    };
    canvas.stage.once("pointerdown", onCanvasClick);
}

function createCombatStatePalette(token) {
    const panel = document.createElement("div");
    panel.className = "thefade-token-state-palette";
    panel.hidden = true;
    panel.addEventListener("pointerdown", event => event.stopPropagation());
    panel.addEventListener("click", event => event.stopPropagation());

    const flat = isFlatToppedGrid();
    const labels = directionLabels();
    const directionButtons = labels.map((label, index) => `
        <button type="button" class="thefade-hex-direction dir-${index}" data-facing-index="${index}">
            <strong data-direction-label>${label}</strong>
            <small data-zone-label></small>
        </button>`).join("");
    const stances = Object.values(STANCES).map(stance =>
        `<button type="button" data-stance="${stance.key}" title="${stance.description}">${stance.label}</button>`
    ).join("");

    panel.innerHTML = `
        <header>
            <strong><i class="fa-solid fa-shield-halved"></i> ${game.i18n.localize("THEFADE.TokenCombatState")}</strong>
            <button type="button" class="thefade-palette-close" aria-label="${game.i18n.localize("Close")}"><i class="fa-solid fa-xmark"></i></button>
        </header>
        <section>
            <div class="thefade-token-section-title">
                <span>${game.i18n.localize("THEFADE.TokenFacing")}</span>
                <output data-facing-readout></output>
            </div>
            <div class="thefade-hex-facing-pad ${flat ? "is-flat" : "is-pointy"}">
                ${directionButtons}
                <button type="button" class="thefade-facing-aim" title="${game.i18n.localize("THEFADE.SetFacing")}">
                    <i class="fa-solid fa-crosshairs"></i><small>${game.i18n.localize("THEFADE.TokenFaceTarget")}</small>
                </button>
            </div>
            <p class="thefade-facing-help">${game.i18n.localize("THEFADE.TokenFacingHexHint")}</p>
        </section>
        <section>
            <div class="thefade-token-section-title"><span>${game.i18n.localize("THEFADE.TokenStance")}</span></div>
            <div class="thefade-token-stance-grid">${stances}</div>
        </section>`;

    panel.querySelector(".thefade-palette-close").addEventListener("click", () => { panel.hidden = true; });
    panel.querySelector(".thefade-facing-aim").addEventListener("click", () => beginFacingPicker(token, panel));
    for (const button of panel.querySelectorAll("[data-facing-index]")) {
        button.addEventListener("click", async () => {
            await setTokenFacing(token, button.dataset.facingIndex);
            updateCombatPalette(panel, token);
        });
    }
    for (const button of panel.querySelectorAll("[data-stance]")) {
        button.addEventListener("click", async () => {
            await token.actor.update({ "system.activeStance": button.dataset.stance });
            updateCombatPalette(panel, token);
        });
    }
    updateCombatPalette(panel, token);
    return panel;
}

function injectTokenControls(hud, html) {
    const token = hud?.object;
    const root = rootElement(html);
    decorateStatusPalette(hud, root);
    if (!isTokenEligible(token) || !root?.querySelector || root.querySelector(".thefade-token-state-control")) return;

    const column = root.querySelector(".col.left") ?? root.querySelector("[data-column='left']") ?? root;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "control-icon thefade-token-state-control";
    button.title = game.i18n.localize("THEFADE.TokenCombatState");
    button.setAttribute("data-tooltip-text", game.i18n.localize("THEFADE.TokenCombatState"));
    button.innerHTML = '<i class="fa-solid fa-shield-halved" inert></i>';
    const panel = createCombatStatePalette(token);
    button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        panel.hidden = !panel.hidden;
        if (!panel.hidden) updateCombatPalette(panel, token);
    });
    column.appendChild(button);
    root.appendChild(panel);
}

function changesIncludeConditions(changes) {
    const flat = foundry.utils.flattenObject(changes || {});
    return Object.keys(flat).some(key => key.startsWith("system.conditions."));
}

function refreshActorTokens(actor, changes = {}) {
    for (const token of canvas?.tokens?.placeables || []) {
        if (token.actor?.id === actor.id) drawTokenCombatState(token);
    }
    const hud = canvas?.tokens?.hud;
    const root = document.querySelector("#token-hud");
    if (hud?.object?.actor?.id === actor.id && root) {
        updateCombatPalette(root.querySelector(".thefade-token-state-palette"), hud.object);
        decorateStatusPalette(hud, root);
    }
    if (changesIncludeConditions(changes) && !actor._thefadeConditionReconcile) {
        synchronizeConditionStatusEffects(actor).catch(error => {
            console.error("The Fade | Failed to synchronize condition status effects", error);
        });
    }
}

Hooks.on("drawToken", drawTokenCombatState);
Hooks.on("refreshToken", drawTokenCombatState);
Hooks.on("controlToken", drawTokenCombatState);
Hooks.on("hoverToken", drawTokenCombatState);
Hooks.on("destroyToken", removeTokenOverlay);
Hooks.on("updateToken", tokenDocument => {
    if (tokenDocument.object) drawTokenCombatState(tokenDocument.object);
});
Hooks.on("updateActor", refreshActorTokens);
Hooks.on("createActiveEffect", effect => synchronizeConditionFromActiveEffect(effect, true));
Hooks.on("deleteActiveEffect", effect => synchronizeConditionFromActiveEffect(effect, false));
Hooks.on("renderTokenHUD", injectTokenControls);

Hooks.once("ready", async () => {
    registerTheFadeStatusEffects();
    if (!game.user?.isGM) return;
    for (const actor of game.actors?.contents || []) {
        await synchronizeConditionStatusEffects(actor);
    }
});

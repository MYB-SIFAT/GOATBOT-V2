"use strict";

const fs   = require("fs-extra");
const path = require("path");

const THEME_FILE = path.join(process.cwd(), "core/data/uiTheme.json");

const STYLES = [
    "box",
    "panel",
    "card",
    "neon",
    "slim",
    "table",
    "banner",
    "list",
    "cyber",
    "ribbon",
    "holo",
    "glass",
    "retro",
    "chain",
    "wave",
    "pixel",
    "zen",
    "galaxy",
    "sharp",
    "floral",
    "aurora",
    "shadow",
    "bubble",
    "matrix",
    "royal",
    "sakura",
    "thunder",
    "ancient",
    "minimal",
    "cloud",
    "plain",
];

const STYLE_EMOJIS = [
    "📦", "🔳", "🃏", "⚡", "📏",
    "📋", "🚩", "📝", "🤖", "🎀",
    "✨", "🪟", "📟", "⛓", "🌊",
    "🎮", "☯️", "🌌", "🔷", "🌸",
    "🌌", "🌑", "💬", "🖥️", "👑",
    "🌸", "⚡", "⚜️", "🔹", "☁️",
    "📄",
];

const STYLE_DESCRIPTIONS = [
    "Rail open-right (default)",
    "Classic heavy border",
    "Soft modern card",
    "Sci-fi neon glow",
    "Minimal compact",
    "Key-value table",
    "Bold announcement",
    "Numbered / bulleted list",
    "Cyberpunk blocks",
    "Ribbon badge",
    "Hologram space",
    "Frosted glass stacked",
    "Retro BBS terminal",
    "Chain-linked",
    "Wavy decorative",
    "Retro pixel / game",
    "Zen minimalist",
    "Galaxy cosmic",
    "Sharp angular",
    "Floral elegant",
    "Northern lights glow",
    "Dark shadow",
    "Chat bubble",
    "Digital matrix",
    "Crown royal ornament",
    "Cherry blossom",
    "Lightning electric",
    "Ancient rune symbols",
    "Ultra minimal indent",
    "Soft floating cloud",
    "No borders — pure text",
];

function load() {
    try {
        const d = fs.readJsonSync(THEME_FILE);
        return {
            global:   d.global   ?? null,
            commands: d.commands  || {},
        };
    } catch {
        return { global: null, commands: {} };
    }
}

function save(data) {
    try {
        fs.outputJsonSync(THEME_FILE, data, { spaces: 2 });
        return true;
    } catch {
        return false;
    }
}

function resolveStyle(cmdKey, defaultStyle) {
    const data = load();
    if (cmdKey && data.commands?.[cmdKey] !== undefined) {
        const s = STYLES[data.commands[cmdKey]];
        if (s) return s;
    }
    if (data.global !== null && data.global !== undefined) {
        const s = STYLES[data.global];
        if (s) return s;
    }
    return defaultStyle || "box";
}

function setGlobal(index) {
    const data = load();
    data.global = index;
    return save(data);
}

function setCommand(cmdKey, index) {
    const data = load();
    if (!data.commands) data.commands = {};
    data.commands[cmdKey] = index;
    return save(data);
}

function clearCommand(cmdKey) {
    const data = load();
    if (data.commands) delete data.commands[cmdKey];
    return save(data);
}

function resetAll() {
    return save({ global: null, commands: {} });
}

function getAll() {
    return load();
}

function getGlobalName() {
    const data = load();
    if (data.global === null || data.global === undefined) return null;
    return STYLES[data.global] || null;
}

module.exports = {
    STYLES,
    STYLE_EMOJIS,
    STYLE_DESCRIPTIONS,
    resolveStyle,
    setGlobal,
    setCommand,
    clearCommand,
    resetAll,
    getAll,
    getGlobalName,
    THEME_FILE,
};

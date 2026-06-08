"use strict";

/**
 * MARIN BOT — Advanced UI Box System v6.0  (Smart Thread-Style Edition)
 * ════════════════════════════════════════════════════════════════════════
 * DESIGN RULES (Messenger / Mobile):
 *   ✦ NO right-side closing borders  — lines wrap on narrow screens
 *   ✦ Separators max 16 chars        — won't wrap even on 4" phones
 *   ✦ NO space-padding alignment     — proportional font kills it
 *   ✦ Every line stands alone        — left-rail only
 *
 * 20 STYLES:
 *  01. box()     Rail open-right  (DEFAULT — auto-delegates per thread)
 *  02. panel()   Classic heavy border
 *  03. card()    Soft modern card
 *  04. neon()    Sci-fi neon
 *  05. slim()    Minimal compact
 *  06. table()   Key-value grid
 *  07. banner()  Bold announcement
 *  08. list()    Numbered / bulleted
 *  09. cyber()   Cyberpunk blocks
 *  10. ribbon()  Ribbon badge
 *  11. holo()    Hologram space
 *  12. glass()   Frosted glass stacked
 *  13. retro()   Terminal BBS
 *  14. chain()   Chain linked
 *  15. wave()    Wavy decorative
 *  16. pixel()   Pixel / retro game
 *  17. zen()     Zen minimalist
 *  18. galaxy()  Galaxy cosmic
 *  19. sharp()   Sharp angular
 *  20. floral()  Floral elegant
 *
 * SMART SYSTEM:
 *   setCurrentThread(threadID)  — dispatcher calls this before EVERY command
 *   setStyle(threadID, style)   — save per-thread style preference
 *   setGlobalStyle(style)       — set fallback global style (admin)
 *   getStyle(threadID?)         — get active style for thread
 *   resetStyle(threadID)        — reset thread to global default
 *   resetAllStyles()            — clear all per-thread preferences
 *   render(title, lines, opts, threadID?) — explicit thread-aware render
 *   box()                       — auto-delegates to current thread's style
 *
 * @author  SIFAT — MARIN BOT v1.0.0
 */

const fs   = require("fs-extra");
const path = require("path");

// ── Style store (JSON persistence) ────────────────────────────────────────────
const STORE_FILE = path.join(process.cwd(), "core/database/store/uiStyles.json");

let _styleStore = { global: "box", threads: {} };
let _currentThread = null;
let _storeDirty = false;

function _loadStore() {
    try {
        if (fs.existsSync(STORE_FILE)) {
            const raw = fs.readJsonSync(STORE_FILE);
            if (raw && typeof raw === "object") {
                _styleStore = { global: raw.global || "box", threads: raw.threads || {} };
            }
        }
    } catch (_) {}
}
_loadStore();

function _saveStore() {
    try {
        fs.ensureDirSync(path.dirname(STORE_FILE));
        fs.writeJsonSync(STORE_FILE, _styleStore, { spaces: 2 });
        _storeDirty = false;
    } catch (_) {}
}

// Debounced save — don't hammer disk on every message
let _saveTimer = null;
function _scheduleSave() {
    _storeDirty = true;
    if (_saveTimer) return;
    _saveTimer = setTimeout(() => { _saveTimer = null; if (_storeDirty) _saveStore(); }, 2000);
}

// ── Unicode font maps ──────────────────────────────────────────────────────────
const SC={a:'ᴀ',b:'ʙ',c:'ᴄ',d:'ᴅ',e:'ᴇ',f:'ꜰ',g:'ɢ',h:'ʜ',i:'ɪ',j:'ᴊ',k:'ᴋ',l:'ʟ',m:'ᴍ',n:'ɴ',o:'ᴏ',p:'ᴘ',q:'ǫ',r:'ʀ',s:'ꜱ',t:'ᴛ',u:'ᴜ',v:'ᴠ',w:'ᴡ',x:'x',y:'ʏ',z:'ᴢ'};
const BU=[..."𝐀𝐁𝐂𝐃𝐄𝐅𝐆𝐇𝐈𝐉𝐊𝐋𝐌𝐍𝐎𝐏𝐐𝐑𝐒𝐓𝐔𝐕𝐖𝐗𝐘𝐙"];
const BL=[..."𝐚𝐛𝐜𝐝𝐞𝐟𝐠𝐡𝐢𝐣𝐤𝐥𝐦𝐧𝐨𝐩𝐪𝐫𝐬𝐭𝐮𝐯𝐰𝐱𝐲𝐳"];
const IU=[..."𝘈𝘉𝘊𝘋𝘌𝘍𝘎𝘏𝘐𝘑𝘒𝘓𝘔𝘕𝘖𝘗𝘘𝘙𝘚𝘛𝘜𝘝𝘞𝘟𝘠𝘡"];
const IL=[..."𝘢𝘣𝘤𝘥𝘦𝘧𝘨𝘩𝘪𝘫𝘬𝘭𝘮𝘯𝘰𝘱𝘲𝘳𝘴𝘵𝘶𝘷𝘸𝘹𝘺𝘻"];
const MU=[..."𝙰𝙱𝙲𝙳𝙴𝙵𝙶𝙷𝙸𝙹𝙺𝙻𝙼𝙽𝙾𝙿𝚀𝚁𝚂𝚃𝚄𝚅𝚆𝚇𝚈𝚉"];
const ML=[..."𝚊𝚋𝚌𝚍𝚎𝚏𝚐𝚑𝚒𝚓𝚔𝚕𝚖𝚗𝚘𝚙𝚚𝚛𝚜𝚝𝚞𝚟𝚠𝚡𝚢𝚣"];

function smallCaps(t){if(t==null)return"";return String(t).toLowerCase().split("").map(c=>SC[c]||c).join("");}
function bold(t){if(t==null)return"";return[...String(t)].map(ch=>{const c=ch.codePointAt(0);if(c>=65&&c<=90)return BU[c-65];if(c>=97&&c<=122)return BL[c-97];return ch;}).join("");}
function italic(t){if(t==null)return"";return[...String(t)].map(ch=>{const c=ch.codePointAt(0);if(c>=65&&c<=90)return IU[c-65];if(c>=97&&c<=122)return IL[c-97];return ch;}).join("");}
function mono(t){if(t==null)return"";return[...String(t)].map(ch=>{const c=ch.codePointAt(0);if(c>=65&&c<=90)return MU[c-65];if(c>=97&&c<=122)return ML[c-97];if(c>=48&&c<=57)return String.fromCodePoint(0x1D7F6+(c-48));return ch;}).join("");}

// ── Constants ──────────────────────────────────────────────────────────────────
const RULE  = "__RULE__";
const RULE2 = "__RULE2__";
const BULLET= "✦";
const ARROW = "›";
const LEAF  = "🌸";
const DOT   = "•";

function _sig(opts) { return opts || {}; }

// ── Safe short separators (won't wrap on any phone) ────────────────────────────
const SEP   = "─".repeat(16);
const SEP2  = "┄".repeat(14);
const SEP_H = "━".repeat(16);
const SEP_D = "═".repeat(16);
const SEP_W = "∿".repeat(14);
const SEP_C = "░".repeat(14);

// ── Shared helpers ─────────────────────────────────────────────────────────────
function kv(key, value, icon = BULLET) { return `${icon} ${bold(key)} ${ARROW} ${value}`; }
function bullet(text, icon = BULLET)   { return `${icon} ${text}`; }
function divider(char = "─", len = 16) { return char.repeat(len); }
function loading(label = "processing") { return `⏳ ${smallCaps(label)}...`; }
function tag(text, b = "〔〕")        { const [o,c]=[...b]; return `${o} ${text} ${c}`; }

// ── Normalize lines ────────────────────────────────────────────────────────────
function L(lines) {
    if (!Array.isArray(lines)) return String(lines == null ? "" : lines).split("\n");
    return lines.flatMap(l => typeof l === "string" ? l.split("\n") : [String(l == null ? "" : l)]);
}

// ════════════════════════════════════════════════════════════════════════════════
// 01 — _box()  Raw rail open-right (INTERNAL — does NOT delegate)
// ════════════════════════════════════════════════════════════════════════════════
function _box(title, lines, opts = {}) {
    const lns  = L(lines);
    const ind  = opts.indent != null ? opts.indent : " ";
    const icon = (opts.icon !== undefined && opts.icon !== null) ? opts.icon : "";
    const top  = icon ? `╭─❪ ${icon} ${smallCaps(title)} ${icon} ❫` : `╭─❪ ${smallCaps(title)} ❫`;
    const body = lns.map(l => {
        if (l === RULE)  return `│ ${SEP}`;
        if (l === RULE2) return `│ ${SEP2}`;
        return `│${ind}${l}`;
    }).join("\n");
    const foot = opts.footer
        ? `╰─❪ ${BULLET} ${smallCaps(opts.footer)} ${BULLET} ❫`
        : `╰─`;
    return `${top}\n${body}\n${foot}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// 02 — panel()  Classic heavy border, open-right
// ════════════════════════════════════════════════════════════════════════════════
function panel(title, lines, opts = {}) {
    const lns  = L(lines);
    const icon = opts.icon ? `${opts.icon} ` : "";
    const top  = `╔══〔 ${icon}${title} 〕`;
    const body = lns.map(l => {
        if (l === RULE)  return `┣${SEP_H}`;
        if (l === RULE2) return `┣${SEP}`;
        return `┣ ${l}`;
    }).join("\n");
    const foot = opts.footer
        ? `┣${SEP_H}\n┣ ${smallCaps(opts.footer)}\n┗${SEP_H}`
        : `┗${SEP_H}`;
    return `${top}\n${body}\n${foot}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// 03 — card()  Soft modern card, open-right
// ════════════════════════════════════════════════════════════════════════════════
function card(title, lines, opts = {}) {
    const lns  = L(lines);
    const icon = opts.icon ? `${opts.icon} ` : "";
    const top  = `┌── ${tag(`${icon}${title}`, "〔〕")}`;
    const body = lns.map(l => {
        if (l === RULE)  return `├─${SEP2}`;
        if (l === RULE2) return `├${SEP2}`;
        return `│  ${l}`;
    }).join("\n");
    const foot = opts.footer
        ? `└${SEP}\n   ${italic(opts.footer)}`
        : `└${SEP}`;
    return `${top}\n${body}\n${foot}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// 04 — neon()  Sci-fi neon, open-right
// ════════════════════════════════════════════════════════════════════════════════
function neon(title, lines, opts = {}) {
    const lns  = L(lines);
    const icon = opts.icon || "⚡";
    const top  = `◤━━〔 ${icon} ${title.toUpperCase()} ${icon} 〕`;
    const body = lns.map(l => {
        if (l === RULE)  return `┃ ${SEP}`;
        if (l === RULE2) return `┃ ${SEP2}`;
        return `┃ ${l}`;
    }).join("\n");
    const foot = opts.footer
        ? `◣━[ ${smallCaps(opts.footer)} ]━━━━━━━━━━`
        : `◣${SEP_H}`;
    return `${top}\n${body}\n${foot}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// 05 — slim()  Minimal compact
// ════════════════════════════════════════════════════════════════════════════════
function slim(title, lines, opts = {}) {
    const lns  = L(lines);
    const icon = opts.icon || "▸";
    const head = `${icon} ${bold(title.toUpperCase())}`;
    const body = lns.map(l => {
        if (l === RULE)  return SEP;
        if (l === RULE2) return SEP2;
        return `  ${l}`;
    }).join("\n");
    const foot = opts.footer ? `${SEP}\n  ${italic(opts.footer)}` : SEP;
    return `${head}\n${SEP}\n${body}\n${foot}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// 06 — table()  Key-value grid
// ════════════════════════════════════════════════════════════════════════════════
function table(title, rows, opts = {}) {
    const icon = opts.icon ? `${opts.icon} ` : "";
    const top  = `╭─ ${bold(icon + title)}`;
    const body = rows.map(r => {
        if (r === RULE || r === RULE2) return `│ ${SEP}`;
        if (typeof r === "string")     return `│ ${r}`;
        if (Array.isArray(r))          return `│ ${bold(r[0])} ${ARROW} ${r[1]}`;
        if (r && (r.k != null || r.key != null)) {
            const k = r.k ?? r.key ?? "";
            const v = r.v ?? r.value ?? "";
            return `│ ${bold(k)} ${ARROW} ${v}`;
        }
        return `│ ${JSON.stringify(r)}`;
    }).join("\n");
    const foot = opts.footer
        ? `╰${SEP}\n   ${smallCaps(opts.footer)}`
        : `╰${SEP}`;
    return `${top}\n│ ${SEP}\n${body}\n${foot}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// 07 — banner()  Bold announcement, open-right
// ════════════════════════════════════════════════════════════════════════════════
function banner(title, lines, opts = {}) {
    const lns  = L(lines);
    const icon = opts.icon || BULLET;
    const head = [
        `╔${SEP_D}`,
        `║  ${icon}  ${bold(title.toUpperCase())}`,
        ...(opts.subtitle ? [`║  ${smallCaps(opts.subtitle)}`] : []),
        `╠${SEP_D}`,
    ].join("\n");
    const body = lns.map(l => {
        if (l === RULE)  return `╠${SEP_D}`;
        if (l === RULE2) return `╠${SEP}`;
        return `║  ${l}`;
    }).join("\n");
    const foot = opts.footer
        ? `╠${SEP_D}\n║  ${smallCaps(opts.footer)}\n╚${SEP_D}`
        : `╚${SEP_D}`;
    return `${head}\n${body}\n${foot}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// 08 — list()  Numbered / bulleted
// ════════════════════════════════════════════════════════════════════════════════
function list(title, items, opts = {}) {
    const icon     = opts.icon || LEAF;
    const numbered = opts.numbered !== false;
    const iIcon    = opts.itemIcon || BULLET;
    const head     = `〔 ${icon} ${bold(title)} 〕\n${SEP}`;
    let n = 0;
    const body = items.map(item => {
        if (item === RULE || item === RULE2) return SEP;
        if (typeof item === "object" && item.section) return `  ${smallCaps(item.section)}`;
        n++;
        const pre = numbered ? ` ${n}. ${iIcon}` : `  ${iIcon}`;
        return `${pre} ${item}`;
    }).join("\n");
    const foot = opts.footer ? `${SEP}\n  ${italic(opts.footer)}` : SEP;
    return `${head}\n${body}\n${foot}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// 09 — cyber()  Cyberpunk blocks
// ════════════════════════════════════════════════════════════════════════════════
function cyber(title, lines, opts = {}) {
    const lns  = L(lines);
    const icon = opts.icon || "⚠";
    const top  = `▓▓▓[ ${icon} ${title.toUpperCase()} ]▓▓▓`;
    const body = lns.map(l => {
        if (l === RULE)  return SEP_C;
        if (l === RULE2) return "▒".repeat(12);
        return `▌ ${l}`;
    }).join("\n");
    const foot = opts.footer
        ? `${"▓".repeat(14)}\n▌ ${mono(opts.footer)}\n${"▓".repeat(14)}`
        : "▓".repeat(14);
    return `${top}\n${body}\n${foot}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// 10 — ribbon()  Ribbon badge
// ════════════════════════════════════════════════════════════════════════════════
function ribbon(title, lines, opts = {}) {
    const lns  = L(lines);
    const icon = opts.icon ? `${opts.icon} ` : "";
    const lbl  = `【 ${icon}${title} 】`;
    const head = `┏${SEP_H}\n┃  ${lbl}\n┗━┯${SEP_H.slice(2)}`;
    const body = lns.map(l => {
        if (l === RULE)  return `  ├${SEP}`;
        if (l === RULE2) return `  ├${SEP2}`;
        return `  │ ▸ ${l}`;
    }).join("\n");
    const foot = opts.footer
        ? `  └${SEP}\n    ${italic(opts.footer)}`
        : `  └${SEP}`;
    return `${head}\n${body}\n${foot}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// 11 — holo()  Hologram space
// ════════════════════════════════════════════════════════════════════════════════
function holo(title, lines, opts = {}) {
    const lns  = L(lines);
    const icon = opts.icon || "✧";
    const dots = "∙".repeat(14);
    const top  = `「${icon} ${bold(title)} ${icon}」`;
    const body = lns.map(l => {
        if (l === RULE)  return dots;
        if (l === RULE2) return "·".repeat(12);
        return `⟩ ${l}`;
    }).join("\n");
    const foot = opts.footer
        ? `${dots}\n˖˖ ${smallCaps(opts.footer)} ˖˖`
        : dots;
    return `${top}\n${dots}\n${body}\n${foot}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// 12 — glass()  Frosted glass stacked
// ════════════════════════════════════════════════════════════════════════════════
function glass(title, lines, opts = {}) {
    const lns  = L(lines);
    const icon = opts.icon ? `${opts.icon}  ` : "";
    const head = `┏${SEP_H}\n┃  ${bold(icon + title)}\n┗━┳${SEP_H.slice(2)}`;
    const body = lns.map(l => {
        if (l === RULE)  return `   ┃ ${SEP}`;
        if (l === RULE2) return `   ┃ ${SEP2}`;
        return `   ┃ ${l}`;
    }).join("\n");
    const foot = opts.footer
        ? `   ┣${SEP}\n   ┃ ${italic(opts.footer)}\n   ┗${SEP}`
        : `   ┗${SEP}`;
    return `${head}\n${body}\n${foot}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// 13 — retro()  Terminal BBS
// ════════════════════════════════════════════════════════════════════════════════
function retro(title, lines, opts = {}) {
    const lns  = L(lines);
    const icon = opts.icon || "#";
    const top  = `+-=[ ${icon} ${title.toUpperCase()} ]=-+`;
    const sep  = `|${"=".repeat(14)}`;
    const sep2 = `|${"─".repeat(14)}`;
    const body = lns.map(l => {
        if (l === RULE)  return sep;
        if (l === RULE2) return sep2;
        return `|  ${l}`;
    }).join("\n");
    const foot = opts.footer
        ? `+-${"-".repeat(14)}\n  >> ${mono(opts.footer)}`
        : `+-${"-".repeat(14)}`;
    return `${top}\n${body}\n${foot}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// 14 — chain()  Chain linked
// ════════════════════════════════════════════════════════════════════════════════
function chain(title, lines, opts = {}) {
    const lns  = L(lines);
    const icon = opts.icon || BULLET;
    const bar  = `◈${SEP_H}`;
    const bar2 = `◈${"╌".repeat(14)}`;
    const head = `${bar}\n    ${icon}  ${bold(title.toUpperCase())}  ${icon}\n${bar}`;
    const body = lns.map(l => {
        if (l === RULE)  return bar;
        if (l === RULE2) return bar2;
        return `  ◆ ${l}`;
    }).join("\n");
    const foot = opts.footer
        ? `${bar}\n  ◇ ${italic(opts.footer)}`
        : bar;
    return `${head}\n${body}\n${foot}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// 15 — wave()  Wavy decorative
// ════════════════════════════════════════════════════════════════════════════════
function wave(title, lines, opts = {}) {
    const lns  = L(lines);
    const icon = opts.icon || BULLET;
    const top  = `≋≋≋ ${icon} ${bold(title)} ${icon} ≋≋≋`;
    const body = lns.map(l => {
        if (l === RULE)  return SEP_W;
        if (l === RULE2) return "~".repeat(12);
        return `≀ ${l}`;
    }).join("\n");
    const foot = opts.footer
        ? `${"≋".repeat(14)}\n≀ ${smallCaps(opts.footer)}`
        : "≋".repeat(14);
    return `${top}\n${body}\n${foot}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// 16 — pixel()  Retro pixel / game style
// ════════════════════════════════════════════════════════════════════════════════
// ■■■■ [ 🎮 TITLE ] ■■■■
// ▶ line 1
// ▪▪▪▪▪▪▪▪▪▪▪▪▪▪
// ▶ line 2
// ■■■■■■■■■■■■■■
//   footer
function pixel(title, lines, opts = {}) {
    const lns  = L(lines);
    const icon = opts.icon || "🎮";
    const bar  = "■".repeat(14);
    const top  = `${bar}\n[ ${icon} ${bold(title.toUpperCase())} ]`;
    const body = lns.map(l => {
        if (l === RULE)  return "▪".repeat(14);
        if (l === RULE2) return "·".repeat(14);
        return `▶ ${l}`;
    }).join("\n");
    const foot = opts.footer
        ? `${bar}\n  ${mono(opts.footer)}`
        : bar;
    return `${top}\n${body}\n${foot}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// 17 — zen()  Zen minimalist (japanese-inspired)
// ════════════════════════════════════════════════════════════════════════════════
// ˳˳˳˳˳˳˳˳˳˳˳˳˳˳
//   ☯ title
// ˳˳˳˳˳˳˳˳˳˳˳˳˳˳
//    line 1
// ˳˳˳˳˳˳˳˳˳˳˳˳˳˳
//   ∞ footer
function zen(title, lines, opts = {}) {
    const lns  = L(lines);
    const icon = opts.icon || "☯";
    const bar  = "˳".repeat(14);
    const top  = `${bar}\n  ${icon} ${italic(title)}`;
    const body = lns.map(l => {
        if (l === RULE)  return bar;
        if (l === RULE2) return "·".repeat(10);
        return `   ${l}`;
    }).join("\n");
    const foot = opts.footer
        ? `${bar}\n  ∞ ${smallCaps(opts.footer)}`
        : bar;
    return `${top}\n${bar}\n${body}\n${foot}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// 18 — galaxy()  Cosmic / space style
// ════════════════════════════════════════════════════════════════════════════════
// ✵ ══════════════
//   ✦ TITLE ✦
// ══════════════ ✵
// ✷ line 1
// · · · · · · · ·
// ✷ line 2
// ══════════════ ✵  footer
function galaxy(title, lines, opts = {}) {
    const lns  = L(lines);
    const icon = opts.icon || "🌌";
    const bar  = `✵ ${SEP_D}`;
    const bar2 = "· ".repeat(7);
    const top  = `${bar}\n  ${icon} ${bold(title)} ${icon}\n${"═".repeat(14)} ✵`;
    const body = lns.map(l => {
        if (l === RULE)  return bar2;
        if (l === RULE2) return "∙".repeat(12);
        return `✷ ${l}`;
    }).join("\n");
    const foot = opts.footer
        ? `${"═".repeat(14)} ✵\n  ˖ ${smallCaps(opts.footer)} ˖`
        : `${"═".repeat(14)} ✵`;
    return `${top}\n${body}\n${foot}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// 19 — sharp()  Sharp angular style
// ════════════════════════════════════════════════════════════════════════════════
// ◆━━━━━━━━━━━━━━━━
// ▷ ❮ TITLE ❯
// ◆━━━━━━━━━━━━━━━━
//   ➤ line 1
//   ➤ line 2
// ◆━━━━━━━━━━━━━━━━
//   footer
function sharp(title, lines, opts = {}) {
    const lns  = L(lines);
    const icon = opts.icon || "◆";
    const bar  = `◆${SEP_H}`;
    const bar2 = `◇${"─".repeat(14)}`;
    const top  = `${bar}\n▷ ❮ ${bold(title.toUpperCase())} ❯`;
    const body = lns.map(l => {
        if (l === RULE)  return bar;
        if (l === RULE2) return bar2;
        return `  ➤ ${l}`;
    }).join("\n");
    const foot = opts.footer
        ? `${bar}\n  ${italic(opts.footer)}`
        : bar;
    return `${top}\n${bar}\n${body}\n${foot}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// 20 — floral()  Floral / elegant style
// ════════════════════════════════════════════════════════════════════════════════
// 🌸·:·:·:·:·:·:🌸
//   ❀  title  ❀
// 🌸·:·:·:·:·:·:🌸
//  ✿ line 1
//  ✿ line 2
// 🌸·:·:·:·:·:·:🌸
//   footer
function floral(title, lines, opts = {}) {
    const lns  = L(lines);
    const icon = opts.icon || "🌺";
    const bar  = `${icon}·:·:·:·:·:·:${icon}`;
    const bar2 = "·:·:·:·:·:·:";
    const top  = `${bar}\n  ❀ ${italic(title)} ❀`;
    const body = lns.map(l => {
        if (l === RULE)  return bar;
        if (l === RULE2) return bar2;
        return ` ✿ ${l}`;
    }).join("\n");
    const foot = opts.footer
        ? `${bar}\n  ${smallCaps(opts.footer)}`
        : bar;
    return `${top}\n${bar}\n${body}\n${foot}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// 21 — aurora()  Northern lights / cosmic glow
// ════════════════════════════════════════════════════════════════════════════════
function aurora(title, lines, opts = {}) {
    const lns  = L(lines);
    const icon = opts.icon || "🌌";
    const top  = `✦ ─── ${icon} ${italic(title)} ───`;
    const body = lns.map(l => {
        if (l === RULE)  return `  ${"∿".repeat(14)}`;
        if (l === RULE2) return `  ${"˜".repeat(12)}`;
        return `  ✧ ${l}`;
    }).join("\n");
    const foot = opts.footer
        ? `  ${"∿".repeat(14)}\n  ⋆ ${italic(opts.footer)}`
        : `✦ ${"─".repeat(16)}`;
    return `${top}\n${body}\n${foot}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// 22 — shadow()  Dark shadow ░▒▓
// ════════════════════════════════════════════════════════════════════════════════
function shadow(title, lines, opts = {}) {
    const lns  = L(lines);
    const icon = opts.icon || "◈";
    const top  = `▓▒░ ${icon} ${bold(title)} ░▒▓`;
    const body = lns.map(l => {
        if (l === RULE)  return `░${"─".repeat(14)}░`;
        if (l === RULE2) return `░${"┄".repeat(12)}░`;
        return `▌▌ ${l}`;
    }).join("\n");
    const foot = opts.footer
        ? `▓▒░${"─".repeat(10)}░▒▓\n▌ ${smallCaps(opts.footer)}`
        : `▓▒░${"─".repeat(10)}░▒▓`;
    return `${top}\n${body}\n${foot}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// 23 — bubble()  Chat bubble ○
// ════════════════════════════════════════════════════════════════════════════════
function bubble(title, lines, opts = {}) {
    const lns  = L(lines);
    const icon = opts.icon || "💬";
    const top  = `╭── ${icon} ${bold(title)}`;
    const body = lns.map(l => {
        if (l === RULE)  return `○${"─".repeat(14)}`;
        if (l === RULE2) return `○${"┄".repeat(12)}`;
        return `○ ${l}`;
    }).join("\n");
    const foot = opts.footer
        ? `╰──◌ ${italic(opts.footer)}`
        : `╰──◌`;
    return `${top}\n${body}\n${foot}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// 24 — matrix()  Digital matrix [ ]
// ════════════════════════════════════════════════════════════════════════════════
function matrix(title, lines, opts = {}) {
    const lns  = L(lines);
    const icon = opts.icon || "⌖";
    const top  = `[${icon}] ${mono(title.toUpperCase())}`;
    const body = lns.map(l => {
        if (l === RULE)  return `[${"─".repeat(14)}]`;
        if (l === RULE2) return `[${"┄".repeat(12)}]`;
        return `[→] ${l}`;
    }).join("\n");
    const foot = opts.footer
        ? `[${"■".repeat(14)}]\n    ${mono(opts.footer)}`
        : `[${"■".repeat(14)}]`;
    return `${top}\n${body}\n${foot}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// 25 — royal()  Crown / royal ornament
// ════════════════════════════════════════════════════════════════════════════════
function royal(title, lines, opts = {}) {
    const lns  = L(lines);
    const icon = opts.icon || "♛";
    const top  = `${icon}══╡ ${bold(title)} ╞══${icon}`;
    const body = lns.map(l => {
        if (l === RULE)  return `  ✦${"─".repeat(12)}✦`;
        if (l === RULE2) return `  ◆${"─".repeat(10)}◆`;
        return `  ◈ ${l}`;
    }).join("\n");
    const foot = opts.footer
        ? `  ✦${"─".repeat(12)}✦\n  ♔ ${smallCaps(opts.footer)}`
        : `${icon}${"═".repeat(14)}${icon}`;
    return `${top}\n${body}\n${foot}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// 26 — sakura()  Japanese cherry blossom
// ════════════════════════════════════════════════════════════════════════════════
function sakura(title, lines, opts = {}) {
    const lns  = L(lines);
    const icon = opts.icon || "🌸";
    const bar  = `${icon}·:·:·:·:·:·:·:${icon}`;
    const top  = `${bar}\n  ❀ ${italic(title)} ❀`;
    const body = lns.map(l => {
        if (l === RULE)  return bar;
        if (l === RULE2) return `  ✿${"·".repeat(12)}✿`;
        return `  ✿ ${l}`;
    }).join("\n");
    const foot = opts.footer
        ? `${bar}\n  ${smallCaps(opts.footer)}`
        : bar;
    return `${top}\n${body}\n${foot}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// 27 — thunder()  Lightning / electric ⚡
// ════════════════════════════════════════════════════════════════════════════════
function thunder(title, lines, opts = {}) {
    const lns  = L(lines);
    const icon = opts.icon || "⚡";
    const bar  = `${icon}${"━".repeat(14)}${icon}`;
    const top  = `${icon}━━━━〔 ${bold(title.toUpperCase())} 〕━━━━${icon}`;
    const body = lns.map(l => {
        if (l === RULE)  return bar;
        if (l === RULE2) return `${icon}${"─".repeat(14)}${icon}`;
        return `${icon} ${l}`;
    }).join("\n");
    const foot = opts.footer
        ? `${bar}\n  ${smallCaps(opts.footer)}`
        : bar;
    return `${top}\n${body}\n${foot}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// 28 — ancient()  Ancient runes ⟦⚜⟧
// ════════════════════════════════════════════════════════════════════════════════
function ancient(title, lines, opts = {}) {
    const lns  = L(lines);
    const icon = opts.icon || "⚜";
    const bar  = `⟦${"─".repeat(14)}⟧`;
    const top  = `⟦ ${icon} ${smallCaps(title)} ${icon} ⟧`;
    const body = lns.map(l => {
        if (l === RULE)  return bar;
        if (l === RULE2) return `⟦${"┄".repeat(12)}⟧`;
        return `⟩ ${l}`;
    }).join("\n");
    const foot = opts.footer
        ? `${bar}\n⟩ ${smallCaps(opts.footer)}`
        : bar;
    return `${top}\n${body}\n${foot}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// 29 — minimal()  Ultra minimal · indent only
// ════════════════════════════════════════════════════════════════════════════════
function minimal(title, lines, opts = {}) {
    const lns  = L(lines);
    const icon = opts.icon || "·";
    const sep  = `  ${"─".repeat(14)}`;
    const top  = `${icon} ${title}`;
    const body = lns.map(l => {
        if (l === RULE || l === RULE2) return sep;
        return `    ${l}`;
    }).join("\n");
    const foot = opts.footer
        ? `${sep}\n    ${opts.footer}`
        : sep;
    return `${top}\n${body}\n${foot}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// 30 — cloud()  Soft cloud / floating ☁️
// ════════════════════════════════════════════════════════════════════════════════
function cloud(title, lines, opts = {}) {
    const lns  = L(lines);
    const icon = opts.icon || "☁";
    const bar  = `  ${"·".repeat(16)}`;
    const top  = `${icon} ${italic(title)} ${icon}`;
    const body = lns.map(l => {
        if (l === RULE)  return bar;
        if (l === RULE2) return `  ${"·".repeat(12)}`;
        return `  ∘ ${l}`;
    }).join("\n");
    const foot = opts.footer
        ? `${bar}\n  ⊹ ${italic(opts.footer)}`
        : bar;
    return `${top}\n${body}\n${foot}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// 31 — plain()  No borders, no decoration — pure text only
// ════════════════════════════════════════════════════════════════════════════════
function plain(title, lines, opts = {}) {
    const lns  = L(lines).filter(l => l !== RULE && l !== RULE2);
    const icon = opts.icon ? `${opts.icon} ` : "";
    const head = `${icon}${title}`;
    const body = lns.join("\n");
    const foot = opts.footer ? `\n${opts.footer}` : "";
    return `${head}\n${body}${foot}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// Style Registry — all 31 styles with metadata
// ════════════════════════════════════════════════════════════════════════════════
const RENDERERS = {
    box:     _box,    panel,   card,    neon,    slim,
    table,   banner,  list,    cyber,   ribbon,
    holo,    glass,   retro,   chain,   wave,
    pixel,   zen,     galaxy,  sharp,   floral,
    aurora,  shadow,  bubble,  matrix,  royal,
    sakura,  thunder, ancient, minimal, cloud,
    plain,
};

const STYLE_META = {
    box:     { icon: "╭",  label: "Rail Box",    emoji: "📦", desc: "Classic open-right rail (default)" },
    panel:   { icon: "╔",  label: "Panel",       emoji: "🔳", desc: "Heavy border panel" },
    card:    { icon: "┌",  label: "Card",        emoji: "🃏", desc: "Soft modern card" },
    neon:    { icon: "◤",  label: "Neon",        emoji: "⚡", desc: "Sci-fi neon glow" },
    slim:    { icon: "▸",  label: "Slim",        emoji: "📏", desc: "Minimal compact" },
    table:   { icon: "╭",  label: "Table",       emoji: "📋", desc: "Key-value grid" },
    banner:  { icon: "╔",  label: "Banner",      emoji: "🚩", desc: "Bold announcement" },
    list:    { icon: "〔", label: "List",        emoji: "📝", desc: "Numbered / bulleted" },
    cyber:   { icon: "▓",  label: "Cyber",       emoji: "🤖", desc: "Cyberpunk blocks" },
    ribbon:  { icon: "┏",  label: "Ribbon",      emoji: "🎀", desc: "Ribbon badge style" },
    holo:    { icon: "「", label: "Holo",        emoji: "✨", desc: "Hologram space" },
    glass:   { icon: "┏",  label: "Glass",       emoji: "🪟", desc: "Frosted glass stacked" },
    retro:   { icon: "+",  label: "Retro",       emoji: "📟", desc: "Terminal BBS style" },
    chain:   { icon: "◈",  label: "Chain",       emoji: "⛓", desc: "Chain linked blocks" },
    wave:    { icon: "≋",  label: "Wave",        emoji: "🌊", desc: "Wavy decorative" },
    pixel:   { icon: "■",  label: "Pixel",       emoji: "🎮", desc: "Retro pixel / game" },
    zen:     { icon: "☯",  label: "Zen",         emoji: "☯️",  desc: "Minimalist zen style" },
    galaxy:  { icon: "✵",  label: "Galaxy",      emoji: "🌌", desc: "Cosmic space style" },
    sharp:   { icon: "◆",  label: "Sharp",       emoji: "🔷", desc: "Angular sharp style" },
    floral:  { icon: "🌸", label: "Floral",      emoji: "🌸", desc: "Elegant floral style" },
    aurora:  { icon: "✦",  label: "Aurora",      emoji: "🌌", desc: "Northern lights glow" },
    shadow:  { icon: "▓",  label: "Shadow",      emoji: "🌑", desc: "Dark shadow ░▒▓ style" },
    bubble:  { icon: "○",  label: "Bubble",      emoji: "💬", desc: "Chat bubble style" },
    matrix:  { icon: "⌖",  label: "Matrix",      emoji: "🖥️",  desc: "Digital matrix [ ]" },
    royal:   { icon: "♛",  label: "Royal",       emoji: "👑", desc: "Crown royal ornament" },
    sakura:  { icon: "🌸", label: "Sakura",      emoji: "🌸", desc: "Cherry blossom style" },
    thunder: { icon: "⚡", label: "Thunder",     emoji: "⚡", desc: "Lightning electric style" },
    ancient: { icon: "⚜",  label: "Ancient",     emoji: "⚜️",  desc: "Ancient rune symbols" },
    minimal: { icon: "·",  label: "Minimal",     emoji: "🔹", desc: "Ultra minimal indent" },
    cloud:   { icon: "☁",  label: "Cloud",       emoji: "☁️",  desc: "Soft floating cloud" },
    plain:   { icon: "·",  label: "Plain",       emoji: "📄",  desc: "No borders — pure text only" },
};

const STYLES = Object.keys(RENDERERS);

// ════════════════════════════════════════════════════════════════════════════════
// Smart Style Store API
// ════════════════════════════════════════════════════════════════════════════════

/** Called by commandEventProcessor BEFORE every command runs */
function setCurrentThread(threadID) {
    _currentThread = threadID ? String(threadID) : null;
}

/** Get the active style for a thread (falls back to global, then "box") */
function getStyle(threadID) {
    const tid = threadID ? String(threadID) : _currentThread;
    if (tid && _styleStore.threads[tid] && RENDERERS[_styleStore.threads[tid]]) {
        return _styleStore.threads[tid];
    }
    const g = _styleStore.global || "box";
    return RENDERERS[g] ? g : "box";
}

/** Set a per-thread UI style */
function setStyle(threadID, styleName) {
    if (!threadID) return false;
    const s = String(styleName).toLowerCase();
    if (!RENDERERS[s]) return false;
    _styleStore.threads[String(threadID)] = s;
    _scheduleSave();
    return true;
}

/** Set the global fallback style (for all threads without a preference) */
function setGlobalStyle(styleName) {
    const s = String(styleName).toLowerCase();
    if (!RENDERERS[s]) return false;
    _styleStore.global = s;
    _scheduleSave();
    return true;
}

/** Reset a thread's style to the global default */
function resetStyle(threadID) {
    if (!threadID) return;
    delete _styleStore.threads[String(threadID)];
    _scheduleSave();
}

/** Reset ALL thread preferences (admin nuclear option) */
function resetAllStyles() {
    _styleStore.threads = {};
    _scheduleSave();
}

/** Get current global style name */
function getGlobalStyle() {
    return _styleStore.global || "box";
}

/** Get ALL thread style assignments */
function getAllStyles() {
    return { global: getGlobalStyle(), threads: { ..._styleStore.threads } };
}

/** Explicitly render with a specific threadID (useful in commands that know their threadID) */
function render(title, lines, opts = {}, threadID = null) {
    const styleName = getStyle(threadID || _currentThread);
    const fn = RENDERERS[styleName] || _box;
    const meta = STYLE_META[styleName] || {};
    return fn(title, lines, _sig({ icon: opts.icon || meta.emoji, ...opts }));
}

// ════════════════════════════════════════════════════════════════════════════════
// box() — SMART DELEGATOR (replaces the old plain box)
// All commands call ui.box(); this auto-picks the thread's style + injects signature.
// ════════════════════════════════════════════════════════════════════════════════
function box(title, lines, opts = {}) {
    const styleName = getStyle(_currentThread);
    const fn = RENDERERS[styleName] || _box;
    const meta = STYLE_META[styleName] || {};
    return fn(title, lines, _sig({ icon: opts.icon || meta.emoji, ...opts }));
}

// ════════════════════════════════════════════════════════════════════════════════
// Status shortcuts — respect current thread style
// ════════════════════════════════════════════════════════════════════════════════
function _status(emoji, label, title, msg, footer, opts = {}) {
    const styleName = getStyle(_currentThread);
    const fn = RENDERERS[styleName] || _box;
    const lns = [];
    if (title) lns.push(bold(title));
    if (msg) {
        if (title) lns.push(RULE);
        String(msg).split("\n").forEach(m => lns.push(m));
    }
    const o = { icon: null, ...opts, footer: footer || "" };
    return fn(label, lns, o);
}

function success(title, msg, footer) {
    return _status("✅", "success", title, msg, footer);
}
function error(title, msg, footer) {
    return _status("❌", "error", title, msg, footer);
}
function warn(title, msg, footer) {
    return _status("⚠️", "warning", title, msg, footer);
}
function info(title, msg, footer) {
    return _status("ℹ️", "info", title, msg, footer);
}
function head(title, sub, icon) {
    return box(title, sub ? [`${icon || LEAF} ${bold(sub)}`] : []);
}

// ════════════════════════════════════════════════════════════════════════════════
// Exports
// ════════════════════════════════════════════════════════════════════════════════
// ── Wrap named styles (pass-through) ──────────────────────────────────────────
const _w = fn => (t, l, o = {}) => fn(t, l, _sig(o));

module.exports = {
    // ── Smart delegators (thread-aware + signature) ───────────────────────────
    box,        // smart delegator — calls thread's active style + injects sig
    _box,       // raw internal (used by box() itself, no double-wrap needed)

    // ── 29 named styles ───────────────────────────────────────────────────────
    panel:   _w(panel),   card:    _w(card),    neon:    _w(neon),
    slim:    _w(slim),    table:   _w(table),   banner:  _w(banner),
    list:    _w(list),    cyber:   _w(cyber),   ribbon:  _w(ribbon),
    holo:    _w(holo),    glass:   _w(glass),   retro:   _w(retro),
    chain:   _w(chain),   wave:    _w(wave),    pixel:   _w(pixel),
    zen:     _w(zen),     galaxy:  _w(galaxy),  sharp:   _w(sharp),
    floral:  _w(floral),  aurora:  _w(aurora),  shadow:  _w(shadow),
    bubble:  _w(bubble),  matrix:  _w(matrix),  royal:   _w(royal),
    sakura:  _w(sakura),  thunder: _w(thunder), ancient: _w(ancient),
    minimal: _w(minimal), cloud:   _w(cloud),

    // ── Smart render (explicit threadID override) ─────────────────────────────
    render,

    // ── Status helpers (respect current thread style) ─────────────────────────
    success, error, warn, info, head,

    // ── Style store API ───────────────────────────────────────────────────────
    setCurrentThread,
    setStyle,
    setGlobalStyle,
    getStyle,
    getGlobalStyle,
    resetStyle,
    resetAllStyles,
    getAllStyles,

    // ── Text transforms ───────────────────────────────────────────────────────
    smallCaps, bold, italic, mono, tag,

    // ── Line helpers ──────────────────────────────────────────────────────────
    kv, bullet, divider, loading,

    // ── Constants ─────────────────────────────────────────────────────────────
    RULE, RULE2, BULLET, ARROW, LEAF, DOT,

    // ── Registry ──────────────────────────────────────────────────────────────
    STYLES,
    STYLE_META,
    RENDERERS,
};

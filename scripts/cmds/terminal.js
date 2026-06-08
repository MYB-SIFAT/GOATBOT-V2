"use strict";

const fs      = require("fs-extra");
const path    = require("path");
const os      = require("os");
const { exec }        = require("child_process");
const { performance } = require("perf_hooks");

const ACCOUNTS_DIR = path.join(process.cwd(), "accounts");
const SETTING_FILE = path.join(process.cwd(), "config", "config.json");
const BLOCK_FILE   = path.join(process.cwd(), "core/data", "blockedUsers.json");
const CRASH_FILE   = path.join(process.cwd(), "core/data", "lastCrash.json");
const DATA_DIR     = path.join(process.cwd(), "core/data");

const SHELL_BLOCK = ["rm -rf /", "mkfs", "dd if=", ":(){:|:&};:", "chmod -R 777 /", ">/dev/sda"];
const SECRET_RE   = /(KEY|TOKEN|SECRET|PASS|PWD|MONGO|URI|CONN|AUTH|CRED)/i;

// ─── UI HELPERS ────────────────────────────────────────────────
const LINE  = "━━━━━━━━━━━━━━━━━━━━━";
const LINE2 = "─────────────────────";

function box(title, lines, footer) {
    const body = (lines || []).filter(l => l != null).join("\n");
    const head = `『 ${title} 』`;
    const foot = footer ? `\n${LINE2}\n${footer}` : "";
    return `${head}\n${LINE}\n${body}${foot}`;
}
function kv(icon, key, val) {
    return `${icon} ${key}: ${val}`;
}
function ok(msg)   { return `✅ ${msg}`; }
function err(msg)  { return `❌ ${msg}`; }
function warn(msg) { return `⚠️ ${msg}`; }
function tip(msg)  { return `💡 ${msg}`; }
function bar(pct, len = 12) {
    const f = Math.round(Math.max(0, Math.min(100, pct)) / 100 * len);
    return "█".repeat(f) + "░".repeat(len - f);
}
function hpIcon(score) { return score >= 75 ? "🟢" : score >= 40 ? "🟡" : "🔴"; }
function fmtBytes(b) {
    const u = ["B","KB","MB","GB"]; let i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return `${b.toFixed(b < 10 ? 2 : 1)} ${u[i]}`;
}
function fmtDur(s) {
    s = Math.max(0, Math.floor(s));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60), sec = s % 60;
    const p = [];
    if (d) p.push(d + "d");
    if (h) p.push(h + "h");
    if (m) p.push(m + "m");
    p.push(sec + "s");
    return p.join(" ");
}
function ageOf(t) {
    const s = Math.floor((Date.now() - t) / 1000);
    if (s < 60)    return s + "s ago";
    if (s < 3600)  return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return Math.floor(s / 86400) + "d ago";
}
function maskSecret(v) {
    if (!v) return "(empty)";
    const s = String(v);
    return s.length <= 6 ? "***" : s.slice(0, 3) + "***" + s.slice(-3);
}

// ─── HELPERS ───────────────────────────────────────────────────
const jread  = p => { try { return fs.readJsonSync(p); } catch { return null; } };
const jwrite = (p, d) => { try { fs.outputJsonSync(p, d, { spaces: 2 }); return true; } catch { return false; } };

function listCookieFiles() {
    if (!fs.existsSync(ACCOUNTS_DIR)) return [];
    const out = [];
    for (let i = 1; i <= 10; i++) {
        const fname = i === 1 ? "account.txt" : `account${i}.txt`;
        const p = path.join(ACCOUNTS_DIR, fname);
        if (!fs.existsSync(p)) continue;
        const raw = fs.readFileSync(p, "utf8").trim();
        let cuid = null;
        try {
            const arr = JSON.parse(raw);
            const c = Array.isArray(arr) && arr.find(c => (c.key || c.name) === "c_user");
            cuid = c ? c.value : null;
        } catch {}
        out.push({ slot: i, file: fname, hasContent: raw.length > 2, cuid, size: raw.length });
    }
    return out;
}

function getMgr()    { try { return require("../../bot/login/multiAccountManager.js"); } catch { return null; } }
function getPref()   { try { return require("../../core/auth/accountPreference.js").getPreferred(); } catch { return null; } }
function setPref(f)  { try { require("../../core/auth/accountPreference.js").setPreferredCookie(f); } catch {} }
function clearPref() { try { return require("../../core/auth/accountPreference.js").clearPreferred(); } catch { return false; } }
function blockedList()   { return jread(BLOCK_FILE) || []; }
function saveBlocked(a)  { return jwrite(BLOCK_FILE, [...new Set(a.map(String))]); }

function doRestart(reply, msg) {
    return Promise.resolve(reply(ok(`Restarting… ${msg}`))).then(() => {
        setTimeout(() => process.exit(2), 3000);
    });
}
function findCookieFileByUid(uid) {
    return listCookieFiles().find(c => c.cuid === String(uid).trim()) || null;
}
async function findLatestLog() {
    return new Promise(resolve => {
        const cmds = [
            "ls -1t /tmp/logs/Start_application_*.log 2>/dev/null | head -1",
            "ls -1t /tmp/logs/*.log 2>/dev/null | head -1",
        ];
        let i = 0;
        function next() {
            if (i >= cmds.length) return resolve(null);
            exec(cmds[i++], (_, f) => { const file = (f || "").trim(); file ? resolve(file) : next(); });
        }
        next();
    });
}

// ─── COMMAND ──────────────────────────────────────────────────
module.exports = {
    config: {
        name             : "terminal",
        aliases          : ["term", "tm"],
        version          : "6.0.0",
        author           : "SIFAT",
        countDown        : 2,
        role             : 2,
        shortDescription : { en: "Bot control terminal" },
        longDescription  : { en: "Manage accounts, cookies, system, messaging, and more" },
        category         : "developer",
        guide            : { en: "{pn} help" },
    },

    onStart: async function ({ api, event, args, message, prefix }) {
        const reply = t => message.reply(t);
        const ctx   = { reply, api, prefix: prefix || global.GoatBot?.config?.prefix || "!", event };
        try {
            return await _run({ args, ctx, event });
        } catch (e) {
            try { return await reply(err("Terminal error: " + e.message)); } catch {}
        }
    },

    onReply: async function ({ api, event, message, Reply }) {
        const reply = t => message.reply(t);
        if (event.senderID !== Reply.author) return;
        const raw = (event.body || "").trim();
        if (!raw.startsWith("[") && !raw.startsWith("{"))
            return reply(err("Invalid format. Send a JSON cookie array starting with ["));
        try {
            let parsed = JSON.parse(raw);
            if (!Array.isArray(parsed) && parsed.appState) parsed = parsed.appState;
            if (!Array.isArray(parsed)) throw new Error("Must be a JSON array");
            if (!parsed.length)         throw new Error("Array is empty");

            const get  = k => parsed.find(c => (c.key || c.name) === k)?.value;
            const cuid = get("c_user"), xs = get("xs"), datr = get("datr");
            const valid = !!(cuid && xs);

            fs.ensureDirSync(ACCOUNTS_DIR);
            fs.writeFileSync(Reply.accountFile, JSON.stringify(parsed, null, 2));

            if (valid) {
                try {
                    const mgr = getMgr();
                    if (mgr?.lockedAccounts?.has(Reply.accountFile)) mgr.unlockAccount(Reply.accountFile);
                    mgr?.boostAccount?.(Reply.accountFile, 100);
                    if (mgr?.accountCooldown) mgr.accountCooldown[Reply.accountFile] = 0;
                } catch {}
            }

            const lines = [
                kv("📄", "File",    Reply.accountName),
                kv("#",  "Entries", parsed.length),
                kv(cuid  ? "✅" : "❌", "c_user", cuid  || "MISSING"),
                kv(xs    ? "✅" : "❌", "xs",     xs    ? "present" : "MISSING"),
                kv(datr  ? "✅" : "⚠️", "datr",   datr  ? "present" : "missing"),
            ];
            if (valid) lines.push(LINE2, "🔄 Restarting in 3s…");

            await reply(box(
                valid ? "✅ COOKIE UPDATED" : "⚠️ COOKIE SAVED",
                lines,
                valid ? "🟢 Valid — account unlocked" : "⚠️ Saved but some keys are missing"
            ));
            if (valid) setTimeout(() => process.exit(2), 3000);
        } catch (e) {
            return reply(err("Cookie parse failed: " + e.message));
        }
    },
};

// ─── CORE ROUTER ──────────────────────────────────────────────
async function _run({ args, ctx, event }) {
    event = event || ctx?.event || {};
    const { reply, api, prefix: P } = ctx;
    const sub  = (args[0] || "help").toLowerCase();
    const rest = args.slice(1);

    // ── HELP ──────────────────────────────────────────────────
    if (sub === "help" || sub === "?") {
        return reply(box("🖥️ GOATBOT TERMINAL v6", [
            "🔐 ACCOUNT & COOKIE",
            `  account status          — health & lock status`,
            `  account unlock <N>      — unlock account`,
            `  account boost <N> [hp]  — restore health`,
            `  account reset <N>       — full reset`,
            `  cookie check            — validate all cookies`,
            `  cookie update <N>       — paste new cookie (reply)`,
            `  cookie save [N] [json]  — save cookie`,
            `  cookie test <N>         — test cookie fields`,
            `  cookie info             — list all cookie files`,
            `  cookie delete <N>       — delete cookie file`,
            LINE2,
            "⚙️ SYSTEM & RUNTIME",
            `  status    — bot status & resource usage`,
            `  botinfo   — detailed bot info`,
            `  ping      — latency to Facebook`,
            `  net       — network interfaces & latency`,
            `  db        — database files`,
            `  disk      — disk & memory usage`,
            `  crash     — last crash report`,
            `  logs [N]  — tail bot log`,
            `  env <KEY> — read env variable`,
            LINE2,
            "🔧 CONTROLS",
            `  restart   — hot restart bot`,
            `  reset     — clear pin + restart`,
            `  kill      — stop bot (no respawn)`,
            `  run <N>   — switch to accountN`,
            `  clear     — clear account pin`,
            LINE2,
            "✉️ MESSAGING",
            `  broadcast <msg>   — send to all groups`,
            `  dm <uid> <msg>    — DM a user`,
            `  threads [N]       — list threads`,
            `  who <uid>         — user info`,
            `  tid               — current thread/sender ID`,
            LINE2,
            "🛡️ MODERATION",
            `  block <uid>    — block user`,
            `  unblock <uid>  — unblock user`,
            `  blocked        — list blocked users`,
            LINE2,
            "🔬 DEVELOPER",
            `  eval <js>           — run JavaScript`,
            `  exec [t=N] <cmd>    — run shell command`,
            `  config [key] [val]  — view/edit config.json`,
            `  scan                — count command/event files`,
            `  history [N]         — command invocation history`,
            `  fingerprint         — bot identity info`,
            LINE2,
            "💾 BACKUP",
            `  backup         — create cookie backup`,
            `  backup list    — list backups`,
            `  restore <name> — restore from backup`,
            LINE2,
            `  me   — current bot identity`,
            `  list — list all account files`,
        ], `${P}terminal <subcommand>`));
    }

    // ── STATUS ────────────────────────────────────────────────
    if (sub === "status" || sub === "stat") {
        const mgr  = getMgr();
        const s    = mgr?.getStats?.() || {};
        const mem  = process.memoryUsage();
        const ramPct = Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100);
        return reply(box("📊 BOT STATUS", [
            kv("🤖", "Account",  s.currentAccount || "?"),
            kv("🔢", "Slot",     `${s.currentIndex ?? "?"}/${s.totalAccounts ?? "?"}`),
            kv("⏱️", "Uptime",   fmtDur(Math.floor(process.uptime()))),
            kv("#",  "PID",      String(process.pid)),
            kv("⌬",  "Node",     process.version),
            LINE2,
            kv("🧠", "RAM",      `${fmtBytes(mem.rss)}  [sys: ${ramPct}%  ${bar(ramPct)}]`),
            kv("♨️", "Heap",     `${fmtBytes(mem.heapUsed)} / ${fmtBytes(mem.heapTotal)}`),
            kv("⚡", "CPU 1m",   os.loadavg()[0].toFixed(2)),
            LINE2,
            kv("📜", "Commands", String(global.GoatBot?.commands?.size ?? global.client?.commands?.size ?? "?")),
            kv("🖥️", "Host",     os.hostname()),
        ], "live"));
    }

    // ── BOTINFO ───────────────────────────────────────────────
    if (sub === "botinfo" || sub === "bi") {
        const mem  = process.memoryUsage();
        const cookies = listCookieFiles();
        let uid = "?", name = "?";
        try { uid = api.getCurrentUserID(); } catch {}
        try {
            const r = await new Promise((rs, rj) => api.getUserInfo(uid, (e, x) => e ? rj(e) : rs(x)));
            name = r?.[uid]?.name || "?";
        } catch {}
        return reply(box("🤖 BOT INFO", [
            kv("🤖", "Name",     "GoatBot v2"),
            kv("🔑", "FB UID",   uid),
            kv("👤", "FB Name",  name),
            LINE2,
            kv("⏱️", "Uptime",   fmtDur(Math.floor(process.uptime()))),
            kv("#",  "PID",      String(process.pid)),
            kv("⌬",  "Node",     process.version),
            kv("💻", "Platform", `${os.platform()} ${os.arch()}`),
            LINE2,
            kv("🧠", "RAM",      `${fmtBytes(mem.rss)} / ${fmtBytes(os.totalmem())}`),
            kv("♨️", "Heap",     `${fmtBytes(mem.heapUsed)} / ${fmtBytes(mem.heapTotal)}`),
            kv("⚡", "CPU 1m",   os.loadavg()[0].toFixed(3)),
            LINE2,
            kv("📜", "Commands", String(global.GoatBot?.commands?.size ?? global.client?.commands?.size ?? "?")),
            kv("🍪", "Accounts", `${cookies.filter(c => c.hasContent).length}/${cookies.length} filled`),
        ]));
    }

    // ── LIST ──────────────────────────────────────────────────
    if (sub === "list" || sub === "ls") {
        const cookies = listCookieFiles();
        const pref    = getPref();
        const lines   = cookies.length ? cookies.map(c => {
            const pin  = (pref?.kind === "cookie" && pref.value === c.file) ? " ★" : "";
            const icon = c.hasContent ? "🟢" : "⭕";
            return `${icon} ${c.file}${pin}  ${c.cuid ? "uid: " + c.cuid : "(empty)"}`;
        }) : ["(no account files found)"];
        return reply(box("🍪 ACCOUNT FILES", lines, "🟢 filled  ⭕ empty  ★ pinned"));
    }

    // ── ME ────────────────────────────────────────────────────
    if (sub === "me") {
        let uid = "?", name = "?";
        try { uid = api.getCurrentUserID(); } catch {}
        try {
            const r = await new Promise((rs, rj) => api.getUserInfo(uid, (e, x) => e ? rj(e) : rs(x)));
            name = r?.[uid]?.name || "?";
        } catch {}
        return reply(box("👤 MY IDENTITY", [
            kv("🔑", "UID",  uid),
            kv("👤", "Name", name),
            kv("🍪", "File", global.client?.dirAccount ? path.basename(global.client.dirAccount) : "?"),
        ]));
    }

    // ── COOKIE ────────────────────────────────────────────────
    if (sub === "cookie") {
        const op = (rest[0] || "").toLowerCase();

        if (op === "update" || op === "paste" || op === "new") {
            const target = (rest[1] || "account1").trim();
            const m = target.match(/^account(\d+)(?:\.txt)?$/i);
            if (!m) return reply(warn(`Usage: cookie update account1\n         cookie update account2`));
            const n    = parseInt(m[1]);
            const file = path.join(ACCOUNTS_DIR, n === 1 ? "account.txt" : `account${n}.txt`);
            const fname = n === 1 ? "account.txt" : `account${n}.txt`;
            const prompt = box("🍪 COOKIE UPDATE — " + fname, [
                "📋 Reply to this message with your",
                "   new cookie JSON array.",
                LINE2,
                'Format: [{"key":"c_user","value":"..."},...]',
                LINE2,
                "⏳ Waiting for your reply…",
            ], "Reply now to paste cookie");
            const sent = await new Promise((rs, rj) =>
                api.sendMessage(prompt, event.threadID, (e, i) => e ? rj(e) : rs(i)));
            global.GoatBot.onReply.set(sent.messageID, {
                commandName: "terminal",
                author: event.senderID,
                accountFile: file,
                accountName: fname,
            });
            return;
        }

        if (op === "save") {
            try {
                const rawBody  = (event.body || "").trim();
                const si       = rawBody.search(/\bcookie\s+save\b/i);
                const afterSave = si >= 0
                    ? rawBody.slice(si).replace(/^cookie\s+save\s*/i, "").trim()
                    : rest.slice(1).join(" ").trim();
                let file;
                const acctMatch = afterSave.match(/^(account(\d+)(?:\.txt)?)\s*/i);
                if (acctMatch) {
                    const n = parseInt(acctMatch[2]);
                    file = path.join(ACCOUNTS_DIR, n === 1 ? "account.txt" : `account${n}.txt`);
                } else {
                    file = global.client?.dirAccount;
                    if (!file) return reply(warn("No active account. Specify: cookie save account2"));
                }
                const jsonStr = acctMatch ? afterSave.slice(acctMatch[0].length).trim() : afterSave;
                let appState;
                if (jsonStr.startsWith("[") || jsonStr.startsWith("{")) {
                    let parsed = JSON.parse(jsonStr);
                    if (!Array.isArray(parsed) && parsed.appState) parsed = parsed.appState;
                    if (!Array.isArray(parsed)) throw new Error("Must be a JSON array");
                    appState = parsed;
                } else {
                    appState = api.getAppState();
                }
                fs.ensureDirSync(ACCOUNTS_DIR);
                fs.writeFileSync(file, JSON.stringify(appState, null, 2));
                const get  = k => appState.find(c => (c.key || c.name) === k)?.value;
                const cuid = get("c_user"), xs = get("xs"), datr = get("datr");
                const valid = !!(cuid && xs);
                if (valid) {
                    try {
                        const mgr = getMgr();
                        if (mgr?.lockedAccounts?.has(file)) mgr.unlockAccount(file);
                        mgr?.boostAccount?.(file, 100);
                        if (mgr?.accountCooldown) mgr.accountCooldown[file] = 0;
                    } catch {}
                }
                return reply(box(valid ? "✅ COOKIE SAVED" : "⚠️ COOKIE SAVED", [
                    kv("📄", "File",    path.basename(file)),
                    kv("#",  "Entries", appState.length),
                    kv(cuid ? "✅" : "❌", "c_user", cuid || "MISSING"),
                    kv(xs   ? "✅" : "❌", "xs",     xs   ? "present" : "MISSING"),
                    kv(datr ? "✅" : "⚠️", "datr",   datr ? "present" : "missing"),
                ], valid ? "🟢 Valid cookie" : "⚠️ Some keys missing"));
            } catch (e) { return reply(err("Save failed: " + e.message)); }
        }

        if (op === "test") {
            const target = (rest[1] || "").trim();
            const m = target.match(/^account(\d+)(?:\.txt)?$/i);
            if (!m) return reply(warn("Usage: cookie test account1"));
            const n = parseInt(m[1]);
            const file = path.join(ACCOUNTS_DIR, n === 1 ? "account.txt" : `account${n}.txt`);
            if (!fs.existsSync(file)) return reply(err("File not found: " + path.basename(file)));
            try {
                const arr  = JSON.parse(fs.readFileSync(file, "utf8"));
                const get  = k => arr.find(c => (c.key || c.name) === k)?.value;
                const cuid = get("c_user"), xs = get("xs"), datr = get("datr");
                return reply(box("🔍 COOKIE TEST — " + path.basename(file), [
                    kv("#",  "Count",  arr.length),
                    kv("📦", "Size",   fmtBytes(fs.statSync(file).size)),
                    kv(cuid ? "✅" : "❌", "c_user", cuid || "MISSING"),
                    kv(xs   ? "✅" : "❌", "xs",     xs   ? "present" : "MISSING"),
                    kv(datr ? "✅" : "⚠️", "datr",   datr ? "present" : "missing"),
                ], (cuid && xs) ? "🟢 Cookie looks valid" : "🔴 Cookie is incomplete"));
            } catch (e) { return reply(err("Parse failed: " + e.message)); }
        }

        if (op === "info") {
            const cookies = listCookieFiles();
            if (!cookies.length) return reply(warn("No account files found in accounts/"));
            const lines = cookies.map(c => {
                const age = (() => { try { return ageOf(fs.statSync(path.join(ACCOUNTS_DIR, c.file)).mtimeMs); } catch { return "?"; } })();
                return kv(c.hasContent ? "🟢" : "⭕", c.file, `uid: ${c.cuid || "?"} | ${fmtBytes(c.size)} | ${age}`);
            });
            return reply(box("🍪 COOKIE INFO", lines, `${cookies.length} file(s) found`));
        }

        if (op === "check" || op === "scan" || op === "validate") {
            const cookies = listCookieFiles();
            if (!cookies.length) return reply(warn("No account files found in accounts/"));
            const mgr    = getMgr();
            const mStats = mgr?.getStats?.() || {};
            const mMap   = new Map((mStats.accounts || []).map(a => [a.name, a]));
            const results = [];
            for (const c of cookies) {
                const fp = path.join(ACCOUNTS_DIR, c.file);
                let icon = "❓", detail = "empty", valid = false;
                try {
                    const raw = fs.readFileSync(fp, "utf8").trim();
                    if (!raw || raw.length < 10) { icon = "⭕"; detail = "empty file"; }
                    else {
                        const arr  = JSON.parse(raw);
                        const get  = k => arr.find(x => (x.key || x.name) === k)?.value;
                        const cuid = get("c_user"), xs = get("xs"), datr = get("datr");
                        const age  = (() => { try { return ageOf(fs.statSync(fp).mtimeMs); } catch { return "?"; } })();
                        if (!cuid && !xs) { icon = "❌"; detail = "missing c_user + xs"; }
                        else if (!cuid)   { icon = "⚠️"; detail = "no c_user  xs=✓"; }
                        else if (!xs)     { icon = "⚠️"; detail = `uid=${cuid}  no xs`; }
                        else              { icon = "✅"; detail = `uid=${cuid}  ${arr.length} keys  ${age}`; valid = true; }
                    }
                } catch (e) { icon = "❌"; detail = "parse error: " + e.message.slice(0, 40); }

                const m     = mMap.get(c.file);
                const hp    = m ? `  hp=${m.health}` : "";
                const lock  = m?.isLocked   ? "  🔒 LOCKED"
                            : m?.onCooldown ? `  ⏳ cd:${fmtDur(m.cooldownSecsLeft)}`
                            : "";
                results.push({ file: c.file, icon, detail, valid, hp, lock });
            }
            const goodCount = results.filter(r => r.valid).length;
            const lines = results.flatMap(r => [
                `${r.icon} ${r.file}${r.hp}${r.lock}`,
                `   ↳ ${r.detail}`,
            ]);
            const hints = [];
            if (results.some(r => !r.valid)) hints.push(tip(`Fix: ${P}terminal cookie update accountN`));
            const locked = (mStats.accounts || []).filter(a => a.isLocked);
            if (locked.length) hints.push(tip(`Unlock: ${P}terminal account unlock accountN`));
            return reply(box("🍪 COOKIE CHECK", [
                kv("#",  "Total",   results.length),
                kv("✅", "Valid",   goodCount),
                kv("❌", "Invalid", results.length - goodCount),
                LINE2,
                ...lines,
                ...(hints.length ? [LINE2, ...hints] : []),
            ], goodCount ? `${goodCount}/${results.length} ready` : "No valid cookies"));
        }

        if (op === "delete" || op === "del") {
            const mm = (rest[1] || "").match(/^account(\d+)(?:\.txt)?$/i);
            if (!mm) return reply(warn("Usage: cookie delete accountN"));
            const n = parseInt(mm[1]);
            const target = path.join(ACCOUNTS_DIR, n === 1 ? "account.txt" : `account${n}.txt`);
            if (!fs.existsSync(target)) return reply(err(`account${n}.txt not found`));
            try { fs.removeSync(target); return reply(ok(`account${n}.txt deleted`)); }
            catch (e) { return reply(err(e.message)); }
        }

        return reply(warn("Cookie ops: update · save · check · test · info · delete"));
    }

    // ── ACCOUNT ───────────────────────────────────────────────
    if (sub === "account" || sub === "acct" || sub === "acc") {
        const op  = (rest[0] || "status").toLowerCase();
        const mgr = getMgr();

        const parseAcc = arg => {
            const mm = (arg || "").match(/^account(\d+)(?:\.txt)?$/i);
            if (!mm) return null;
            const n = parseInt(mm[1]);
            return { n, fname: n === 1 ? "account.txt" : `account${n}.txt`, file: path.join(ACCOUNTS_DIR, n === 1 ? "account.txt" : `account${n}.txt`) };
        };

        if (op === "unlock" || op === "fix") {
            const a = parseAcc(rest[1]);
            if (!a) return reply(warn(`Usage: account unlock accountN`));
            if (!fs.existsSync(a.file)) return reply(err(`${a.fname} not found`));
            mgr?.unlockAccount?.(a.file);
            mgr?.boostAccount?.(a.file, 30);
            if (mgr?.accountCooldown) mgr.accountCooldown[a.file] = 0;
            return reply(ok(`${a.fname} unlocked\n• Cooldown cleared\n• Health +30\nNo restart needed.`));
        }
        if (op === "boost" || op === "heal") {
            const a   = parseAcc(rest[1]);
            const amt = Math.max(1, Math.min(100, parseInt(rest[2], 10) || 50));
            if (!a) return reply(warn(`Usage: account boost accountN [amount]`));
            mgr?.boostAccount?.(a.file, amt);
            const newHp = Math.min(100, mgr?.health?.[a.file] ?? 0);
            return reply(ok(`${a.fname} health +${amt} → ${newHp}/100`));
        }
        if (op === "reset") {
            const a = parseAcc(rest[1]);
            if (!a) return reply(warn(`Usage: account reset accountN`));
            if (!fs.existsSync(a.file)) return reply(err(`${a.fname} not found`));
            mgr?.unlockAccount?.(a.file);
            mgr?.boostAccount?.(a.file, 100);
            if (mgr?.accountCooldown) mgr.accountCooldown[a.file] = 0;
            if (mgr?.failCount)  mgr.failCount[a.file]  = 0;
            if (mgr?.failType)   delete mgr.failType[a.file];
            if (mgr?.failReason) delete mgr.failReason[a.file];
            return reply(ok(`${a.fname} fully reset\n• Unlocked  • Cooldown cleared\n• Health → 100  • Fail counter cleared`));
        }

        // status (default)
        const s = mgr?.getStats?.();
        if (!s?.accounts?.length) return reply(warn("No accounts loaded yet."));
        const lines = [];
        for (const a of s.accounts) {
            const cur  = a.isCurrent ? " ◀ ACTIVE" : "";
            const lock = a.isLocked  ? "🔒 LOCKED"
                       : a.onCooldown ? `⏳ cooldown ${fmtDur(a.cooldownSecsLeft)}`
                       : "🟢 ready";
            lines.push(`${hpIcon(a.health)} ${a.name}${cur}`);
            lines.push(`   ${bar(a.health)}  ${a.health}%  ${lock}`);
            if (a.failType) lines.push(`   ↳ fail: ${a.failType} ×${a.failCount}`);
            lines.push(`   ↳ sent: ${a.msgSent}  ok: ${a.successRate}%  sessions: ${a.sessionCount}`);
            lines.push(LINE2);
        }
        lines.push(
            tip(`unlock:  ${P}terminal account unlock accountN`),
            tip(`boost:   ${P}terminal account boost accountN`),
            tip(`reset:   ${P}terminal account reset accountN`),
            tip(`cookie:  ${P}terminal cookie update accountN`),
        );
        return reply(box("📊 ACCOUNT STATUS", lines, `${s.accounts.length} account(s)  ·  switches: ${s.switchCount}`));
    }

    // ── CONTROLS ──────────────────────────────────────────────
    if (sub === "restart" || sub === "reboot") return doRestart(reply, "");
    if (sub === "reset") {
        clearPref();
        try { require("../../core/auth/accountRegistry.js").resetFailedAccounts(); } catch {}
        return doRestart(reply, "Pin cleared + circuit reset");
    }
    if (sub === "clear" || sub === "unpin") {
        clearPref();
        return reply(ok("Account pin cleared."));
    }
    if (sub === "kill") {
        await reply(warn("⚠️ Killing bot — no auto-respawn!"));
        setTimeout(() => process.exit(0), 1500);
        return;
    }
    if (sub === "run" || sub === "use") {
        const target = (rest[0] || "").trim();
        if (!target) return reply(warn("Usage: run accountN\nExample: run account2"));
        const m = target.match(/^account(\d+)(?:\.txt)?$/i);
        if (m) {
            const n = parseInt(m[1]);
            const file = n === 1 ? "account.txt" : `account${n}.txt`;
            if (!fs.existsSync(path.join(ACCOUNTS_DIR, file))) return reply(err(`${file} not found`));
            setPref(file); return doRestart(reply, `Switched to ${file}`);
        }
        if (/^\d{6,}$/.test(target)) {
            const cf = findCookieFileByUid(target);
            if (cf) { setPref(cf.file); return doRestart(reply, `Pinned ${cf.file} (uid ${target})`); }
            return reply(err(`No account found for UID ${target}`));
        }
        return reply(warn(`Unknown target "${target}". Use accountN format.`));
    }

    // ── PING ──────────────────────────────────────────────────
    if (sub === "ping") {
        const t0 = Date.now();
        const lagT = performance.now();
        await new Promise(r => setImmediate(r));
        const lagMs = (performance.now() - lagT).toFixed(2);
        const res = await new Promise(resolve => {
            try {
                const https = require("https");
                const req = https.request("https://www.facebook.com/", { method: "HEAD" }, () =>
                    resolve({ ok: true, ms: Date.now() - t0 }));
                req.setTimeout(8000, () => { req.destroy(); resolve({ ok: false, err: "timeout" }); });
                req.on("error", e => resolve({ ok: false, err: e.message }));
                req.end();
            } catch (e) { resolve({ ok: false, err: e.message }); }
        });
        if (!res.ok) return reply(err("Ping failed: " + res.err));
        const icon = res.ms < 400 ? "🟢" : res.ms < 1200 ? "🟡" : "🔴";
        return reply(box("🏓 PING", [
            kv(icon, "Facebook",  `${res.ms} ms`),
            kv("⏱️", "Event lag", `${lagMs} ms`),
            kv("#",  "PID",       String(process.pid)),
        ]));
    }

    // ── NET ───────────────────────────────────────────────────
    if (sub === "net") {
        const pingHost = url => new Promise(resolve => {
            const t = Date.now();
            try {
                const mod = require(url.startsWith("https") ? "https" : "http");
                const req = mod.request(url, { method: "HEAD" }, () => resolve({ ok: true, ms: Date.now() - t }));
                req.setTimeout(6000, () => { req.destroy(); resolve({ ok: false, ms: -1 }); });
                req.on("error", () => resolve({ ok: false, ms: -1 }));
                req.end();
            } catch { resolve({ ok: false, ms: -1 }); }
        });
        const targets = [
            { label: "Facebook",   url: "https://www.facebook.com/" },
            { label: "Google",     url: "https://www.google.com/" },
            { label: "Cloudflare", url: "https://1.1.1.1/" },
        ];
        const results = await Promise.all(targets.map(async t => ({ label: t.label, ...await pingHost(t.url) })));
        const ifaces = os.networkInterfaces();
        const ips = [];
        for (const [name, list] of Object.entries(ifaces || {}))
            for (const iface of list || [])
                if (!iface.internal) ips.push(`  ${name}: ${iface.address} (${iface.family})`);
        return reply(box("🌐 NETWORK", [
            "📡 Latency",
            ...results.map(r => kv(r.ok ? (r.ms < 400 ? "🟢" : "🟡") : "🔴", r.label, r.ok ? `${r.ms} ms` : "timeout")),
            LINE2,
            "🌐 Interfaces",
            ...(ips.length ? ips : ["  (none detected)"]),
            LINE2,
            kv("▸", "Hostname", os.hostname()),
            kv("▸", "Platform", os.platform()),
        ], "live"));
    }

    // ── DB ────────────────────────────────────────────────────
    if (sub === "db" || sub === "database") {
        const lines = [kv("🗄️", "Type", "SQLite / JSON")];
        try {
            const dbDir = path.join(process.cwd(), "sifu_database");
            if (fs.existsSync(dbDir)) {
                const files = fs.readdirSync(dbDir).filter(f => f.endsWith(".db") || f.endsWith(".json"));
                lines.push(kv("📁", "Dir",   "sifu_database/"), kv("#", "Files", files.length));
                for (const f of files.slice(0, 8))
                    lines.push(`   • ${f}  (${fmtBytes(fs.statSync(path.join(dbDir, f)).size)})`);
            } else {
                lines.push(kv("⚠️", "Status", "sifu_database not found"));
            }
        } catch (e) { lines.push(kv("🔴", "Error", e.message)); }
        return reply(box("🗄️ DATABASE", lines));
    }

    // ── DISK ──────────────────────────────────────────────────
    if (sub === "disk" || sub === "df") {
        return new Promise(rs => exec("df -h 2>/dev/null | head -10", { timeout: 8000 }, (e, dfOut) => {
            const mem = process.memoryUsage();
            rs(reply(box("💽 DISK & MEMORY", [
                "💿 Disk",
                ...(dfOut || "").trim().split("\n").slice(0, 8),
                LINE2,
                "🧠 Memory",
                kv("▰", "RSS",        fmtBytes(mem.rss)),
                kv("♨️", "Heap used",  fmtBytes(mem.heapUsed)),
                kv("▱", "Heap total", fmtBytes(mem.heapTotal)),
            ], "df -h")));
        }));
    }

    // ── CRASH ─────────────────────────────────────────────────
    if (sub === "crash") {
        const c = jread(CRASH_FILE);
        if (!c) return reply(ok("No crash recorded since last reset."));
        return reply(box("💥 LAST CRASH", [
            kv("⏱️", "When",  c.time  || "?"),
            kv("▸",  "Where", c.where || "?"),
            LINE2,
            ...(c.stack || c.message || "(empty)").toString().slice(0, 1200).split("\n"),
        ]));
    }

    // ── LOGS ──────────────────────────────────────────────────
    if (sub === "logs" || sub === "log") {
        const n = Math.max(1, Math.min(80, parseInt(rest[0], 10) || 20));
        const f = await findLatestLog();
        if (!f) return reply(warn("No log file found."));
        return new Promise(rs => exec(`tail -n ${n} "${f}"`, (_, out) => {
            const txt = (out || "(empty)").slice(-1800);
            rs(reply(box(`📜 LOGS (last ${n})`, [kv("▸", "File", path.basename(f)), LINE2, ...txt.split("\n")])));
        }));
    }

    // ── ENV ───────────────────────────────────────────────────
    if (sub === "env") {
        const key = rest[0];
        if (!key) return reply(warn("Usage: env <KEY>"));
        const v = process.env[key];
        if (v === undefined) return reply(err(`${key} is not set`));
        return reply(box("🔐 ENV", [kv("▸", key, SECRET_RE.test(key) ? maskSecret(v) : v.slice(0, 200))]));
    }

    // ── FINGERPRINT ───────────────────────────────────────────
    if (sub === "fingerprint" || sub === "fp") {
        const mem = process.memoryUsage();
        let uid = "?";
        try { uid = api.getCurrentUserID(); } catch {}
        return reply(box("🪪 FINGERPRINT", [
            kv("🤖", "Bot",      "GoatBot v2"),
            kv("👤", "Author",   "SIFAT"),
            LINE2,
            kv("⌬",  "Node",     process.version),
            kv("💻", "Platform", `${os.platform()} ${os.arch()}`),
            kv("▣",  "Host",     os.hostname()),
            kv("#",  "PID",      String(process.pid)),
            kv("🔑", "UID",      uid),
            LINE2,
            kv("▰",  "RAM",      fmtBytes(mem.rss)),
            kv("⏱️", "Uptime",   fmtDur(Math.floor(process.uptime()))),
        ]));
    }

    // ── TOKEN / SESSION ───────────────────────────────────────
    if (sub === "token" || sub === "session") {
        let uid = "?", name = "?", cookieFile = "?";
        try { uid = api.getCurrentUserID(); } catch {}
        try {
            const r = await new Promise((rs, rj) => api.getUserInfo(uid, (e, x) => e ? rj(e) : rs(x)));
            name = r?.[uid]?.name || "?";
        } catch {}
        try { cookieFile = global.client?.dirAccount ? path.basename(global.client.dirAccount) : "?"; } catch {}
        const cookies = listCookieFiles();
        const current = cookies.find(c => c.cuid === uid);
        let xs = "?", datr = "?", count = "?";
        if (current) {
            try {
                const arr = JSON.parse(fs.readFileSync(path.join(ACCOUNTS_DIR, current.file), "utf8"));
                const get = k => arr.find(x => (x.key || x.name) === k)?.value;
                xs = get("xs") ? "✅ present" : "❌ missing";
                datr = get("datr") ? "✅ present" : "⚠️ missing";
                count = String(arr.length);
            } catch {}
        }
        const age = current ? (() => { try { return ageOf(fs.statSync(path.join(ACCOUNTS_DIR, current.file)).mtimeMs); } catch { return "?"; } })() : "?";
        return reply(box("🔑 SESSION TOKEN", [
            kv("🔑", "UID",          uid),
            kv("👤", "Name",         name),
            kv("🍪", "Cookie file",  cookieFile),
            LINE2,
            kv("🔐", "xs token",     xs),
            kv("🔐", "datr",         datr),
            kv("#",  "Total fields", count),
            kv("⏱️", "Last saved",   age),
        ]));
    }

    // ── SCAN ──────────────────────────────────────────────────
    if (sub === "scan") {
        const cmdsDir = path.join(process.cwd(), "scripts/cmds");
        const evtsDir = path.join(process.cwd(), "scripts/events");
        const cmdFiles = fs.existsSync(cmdsDir) ? fs.readdirSync(cmdsDir).filter(f => f.endsWith(".js")) : [];
        const evtFiles = fs.existsSync(evtsDir) ? fs.readdirSync(evtsDir).filter(f => f.endsWith(".js")) : [];
        return reply(box("🔍 MODULE SCAN", [
            kv("📜", "Commands", `${cmdFiles.length} files`),
            kv("⚡", "Events",   `${evtFiles.length} files`),
        ], "scripts/cmds & scripts/events"));
    }

    // ── HISTORY ───────────────────────────────────────────────
    if (sub === "history" || sub === "hist") {
        const tState = (() => { try { return require("../../core/lib/terminalState.js"); } catch { return null; } })();
        if (!tState) return reply(warn("History not available."));
        const n = Math.max(3, Math.min(30, parseInt(rest[0], 10) || 10));
        const h = tState.getHistory(n);
        const lines = h.length ? h.map(x => {
            const tag  = x.ok ? "🟢" : "🔴";
            const time = new Date(x.t).toLocaleTimeString();
            const a    = (x.args || []).slice(0, 2).join(" ");
            return `${tag} ${time}  ${x.sub} ${a}  (${Math.round(x.ms || 0)}ms)`;
        }) : ["(no history yet)"];
        return reply(box(`📜 HISTORY (${n})`, lines));
    }

    // ── MESSAGING ─────────────────────────────────────────────
    if (sub === "broadcast" || sub === "bc") {
        const msg = rest.join(" ").trim();
        if (!msg) return reply(warn("Usage: broadcast <message>"));
        try {
            const list   = await new Promise((rs, rj) => api.getThreadList(50, null, ["INBOX"], (e, x) => e ? rj(e) : rs(x)));
            const groups = list.filter(t => t.isGroup);
            let sent = 0, failed = 0;
            for (const t of groups) {
                try {
                    await new Promise((rs, rj) => api.sendMessage(`📢 ${msg}`, t.threadID, e => e ? rj(e) : rs()));
                    sent++;
                } catch { failed++; }
                await new Promise(r => setTimeout(r, 600));
            }
            return reply(ok(`Broadcast sent\n• Groups: ${groups.length}\n• Success: ${sent}\n• Failed: ${failed}`));
        } catch (e) { return reply(err("Broadcast error: " + e.message)); }
    }

    if (sub === "dm" || sub === "msg") {
        const uid = rest[0], msg = rest.slice(1).join(" ");
        if (!uid || !msg) return reply(warn("Usage: dm <uid> <message>"));
        return new Promise(rs => api.sendMessage(msg, uid, e =>
            rs(e ? reply(err("Send failed: " + e.message)) : reply(ok(`Message sent → ${uid}`)))
        ));
    }

    if (sub === "tid") {
        return reply(box("🆔 THREAD INFO", [
            kv("#",  "Thread ID", event.threadID),
            kv("👤", "Sender ID", event.senderID),
            kv("👥", "Is group",  event.isGroup ? "Yes" : "No"),
        ]));
    }

    if (sub === "threads") {
        const n = Math.max(5, Math.min(50, parseInt(rest[0], 10) || 15));
        try {
            const list = await new Promise((rs, rj) => api.getThreadList(n, null, ["INBOX"], (e, x) => e ? rj(e) : rs(x)));
            const lines = list.slice(0, n).map(t =>
                `${t.isGroup ? "👥" : "👤"} ${(t.name || "(no name)").slice(0, 28).padEnd(28)} ${t.threadID}`
            );
            return reply(box(`💬 THREADS (${n})`, lines, `${list.length} loaded`));
        } catch (e) { return reply(err("Failed: " + e.message)); }
    }

    if (sub === "who") {
        const target = (event.mentions && Object.keys(event.mentions)[0]) || rest[0];
        if (!target) return reply(warn("Usage: who <uid>  or mention someone"));
        try {
            const r = await new Promise((rs, rj) => api.getUserInfo(target, (e, x) => e ? rj(e) : rs(x)));
            const u = r?.[target] || {};
            return reply(box("👤 USER INFO", [
                kv("#",  "UID",     target),
                kv("👤", "Name",    u.name       || "?"),
                kv("🔗", "Profile", u.profileUrl || "?"),
            ]));
        } catch (e) { return reply(err(e.message)); }
    }

    // ── MODERATION ────────────────────────────────────────────
    if (sub === "block") {
        const uid = (event.mentions && Object.keys(event.mentions)[0]) || rest[0];
        if (!uid) return reply(warn("Usage: block <uid>  or mention someone"));
        const list = blockedList();
        if (list.includes(uid)) return reply(warn(`${uid} is already blocked.`));
        list.push(uid); saveBlocked(list);
        return reply(ok(`${uid} blocked  (${list.length} total)`));
    }
    if (sub === "unblock") {
        const uid = (event.mentions && Object.keys(event.mentions)[0]) || rest[0];
        if (!uid) return reply(warn("Usage: unblock <uid>  or mention someone"));
        const list = blockedList().filter(x => x !== uid);
        saveBlocked(list);
        return reply(ok(`${uid} unblocked  (${list.length} remaining)`));
    }
    if (sub === "blocked") {
        const list = blockedList();
        const lines = list.length ? list.map(x => `  • ${x}`) : ["(none)"];
        return reply(box("🚫 BLOCKED USERS", lines, `${list.length} user(s)`));
    }

    // ── BACKUP / RESTORE ──────────────────────────────────────
    if (sub === "backup") {
        const op = (rest[0] || "").toLowerCase();
        if (op === "list" || op === "ls") {
            const tState = (() => { try { return require("../../core/lib/terminalState.js"); } catch { return null; } })();
            const list   = tState?.listBackups?.() || [];
            const lines  = list.length ? list.slice(0, 12).map(b =>
                `  ${b.name.slice(0, 35).padEnd(35)}  ${fmtBytes(b.size)}  ${ageOf(b.mtime)}`
            ) : ["(no backups yet)"];
            return reply(box("💾 BACKUPS", lines, `${list.length} backup(s)`));
        }
        const tState  = (() => { try { return require("../../core/lib/terminalState.js"); } catch { return null; } })();
        if (!tState) return reply(err("Backup system not available."));
        tState.ensureBackupDir?.();
        const stamp  = new Date().toISOString().replace(/[:.]/g, "-");
        const name   = `backup-${stamp}.json`;
        const target = path.join(tState.BACKUP_DIR, name);
        const snap   = {
            createdAt : new Date().toISOString(),
            botVersion: "GoatBot v2",
            cookies   : listCookieFiles().map(c => {
                let raw = null;
                try { raw = fs.readFileSync(path.join(ACCOUNTS_DIR, c.file), "utf8"); } catch {}
                return { file: c.file, raw };
            }),
        };
        try {
            fs.outputJsonSync(target, snap, { spaces: 2 });
            const size = fs.statSync(target).size;
            return reply(ok(`Backup saved\n• File: ${name}\n• Size: ${fmtBytes(size)}`));
        } catch (e) { return reply(err("Backup failed: " + e.message)); }
    }

    if (sub === "restore") {
        const name = rest[0];
        if (!name) return reply(warn(`Usage: restore <name>\nSee: ${P}terminal backup list`));
        const tState = (() => { try { return require("../../core/lib/terminalState.js"); } catch { return null; } })();
        const file   = path.join(tState?.BACKUP_DIR || path.join(process.cwd(), "core/data/backups"), name.endsWith(".json") ? name : name + ".json");
        if (!fs.existsSync(file)) return reply(err(`Not found: ${name}`));
        try {
            const snap = fs.readJsonSync(file);
            if (Array.isArray(snap.cookies))
                for (const c of snap.cookies)
                    if (c.raw) try { fs.writeFileSync(path.join(ACCOUNTS_DIR, c.file), c.raw); } catch {}
            return reply(ok(`Restored from ${path.basename(file)}\nRun: ${P}terminal restart`));
        } catch (e) { return reply(err("Restore failed: " + e.message)); }
    }

    // ── DEVELOPER ─────────────────────────────────────────────
    if (sub === "eval") {
        const code = rest.join(" ");
        if (!code) return reply(warn("Usage: eval <js code>"));
        try {
            let out;
            try      { out = await eval(`(async()=>{ return (${code}); })()`); }
            catch    { out = await eval(`(async()=>{ ${code} })()`); }
            if (typeof out !== "string") out = require("util").inspect(out, { depth: 2 }).slice(0, 1500);
            return reply(box("✦ EVAL", [out]));
        } catch (e) { return reply(err("Eval error: " + e.message)); }
    }

    if (sub === "exec" || sub === "sh") {
        let rawArgs = [...rest];
        let timeoutMs = 30000;
        if (rawArgs[0] && /^t=\d+$/i.test(rawArgs[0]))
            timeoutMs = Math.max(3000, Math.min(120000, parseInt(rawArgs.shift().split("=")[1], 10) * 1000));
        const cmd = rawArgs.join(" ").trim();
        if (!cmd) return reply(warn("Usage: exec [t=<sec>] <shell command>"));
        for (const bad of SHELL_BLOCK) if (cmd.includes(bad)) return reply(err("Blocked: dangerous command pattern"));
        const t0 = Date.now();
        return new Promise(rs => exec(cmd, { cwd: process.cwd(), timeout: timeoutMs, maxBuffer: 1024 * 1024 * 4 }, (e, out, errOut) => {
            const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
            const txt = ((out || "") + (errOut ? "\n[stderr]\n" + errOut : "")).trim();
            rs(reply(box(e ? "✗ EXEC" : "✓ EXEC", [
                kv("$",  "Cmd",  cmd.slice(0, 80)),
                kv(e ? "🔴" : "🟢", "Exit", e ? String(e.code || "err") : "0"),
                kv("⏱️", "Time", `${elapsed}s`),
                LINE2,
                ...(txt || "(no output)").slice(0, 1800).split("\n"),
            ])));
        }));
    }

    if (sub === "config" || sub === "cfg") {
        const cfg = jread(SETTING_FILE) || jread(path.join(process.cwd(), "setting.json")) || {};
        const key = rest[0], val = rest.slice(1).join(" ");
        if (!key) {
            const lines = Object.entries(cfg).filter(([k]) => !SECRET_RE.test(k))
                .map(([k, v]) => kv("▸", k.slice(0, 20), String(v).slice(0, 40)));
            return reply(box("🔧 CONFIG", lines, `${P}terminal config <key> [val] to edit`));
        }
        if (SECRET_RE.test(key)) return reply(err(`Cannot access secret key "${key}"`));
        if (!val) {
            const cur = cfg[key];
            if (cur === undefined) return reply(warn(`Key "${key}" not found`));
            return reply(box(`🔧 CONFIG.${key}`, [kv("▸", key, String(cur))]));
        }
        let parsed = val;
        if (val === "true") parsed = true;
        else if (val === "false") parsed = false;
        else if (!isNaN(Number(val))) parsed = Number(val);
        cfg[key] = parsed;
        const cfgPath = fs.existsSync(SETTING_FILE) ? SETTING_FILE : path.join(process.cwd(), "setting.json");
        if (!jwrite(cfgPath, cfg)) return reply(err("Config write failed"));
        return reply(ok(`Config updated\n${key} = ${JSON.stringify(parsed)}`));
    }

    if (sub === "cookies" || sub === "url") {
        const url = process.env.REPLIT_DEV_DOMAIN
            ? `https://${process.env.REPLIT_DEV_DOMAIN}`
            : `http://localhost:${process.env.PORT || 5000}`;
        return reply(box("🌐 DASHBOARD URL", [
            "Open this link in your browser:",
            "",
            url,
        ]));
    }

    // ── UNKNOWN ───────────────────────────────────────────────
    return reply(warn(`Unknown command: "${sub}"\nType: ${P}terminal help`));
}

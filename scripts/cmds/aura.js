"use strict";

const axios      = require("axios");
const fs         = require("fs-extra");
const path       = require("path");
const { Canvas, loadImage, registerFont } = require("canvas");
const GIFEncoder = require("gifencoder");

const FONT_DIR = path.resolve(__dirname, "cache", "fonts");
const FNT      = "NotoSans, NotoSansBengali, NotoEmoji, sans-serif";
const UA       = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36";

// ─── TIERS ────────────────────────────────────────────────────
const TIERS = [
    { min: 0,    max: 499,  name: "BASIC",     color: "#7a8498", rgb: "122,132,152",  symbol: "◇", desc: "Just awakening..."        },
    { min: 500,  max: 999,  name: "IRON",      color: "#cd7f32", rgb: "205,127,50",   symbol: "◆", desc: "Forging strength..."       },
    { min: 1000, max: 1999, name: "SILVER",    color: "#b8c4d4", rgb: "184,196,212",  symbol: "◈", desc: "Power rising..."           },
    { min: 2000, max: 3499, name: "GOLD",      color: "#ffd700", rgb: "255,215,0",    symbol: "✦", desc: "Energy surging!"           },
    { min: 3500, max: 4999, name: "ELITE",     color: "#00cfff", rgb: "0,207,255",    symbol: "⬡", desc: "Beyond ordinary!"         },
    { min: 5000, max: 6499, name: "SUPREME",   color: "#00ff88", rgb: "0,255,136",    symbol: "❋", desc: "Extraordinary force!"     },
    { min: 6500, max: 7999, name: "MYTHIC",    color: "#ff4ecd", rgb: "255,78,205",   symbol: "✸", desc: "Transcendent being!"      },
    { min: 8000, max: 8999, name: "LEGENDARY", color: "#ff6b35", rgb: "255,107,53",   symbol: "⚡", desc: "Unstoppable!!"            },
    { min: 9000, max: 9799, name: "DIVINE",    color: "#e8f0ff", rgb: "232,240,255",  symbol: "☯", desc: "Beyond all limits..."     },
    { min: 9800, max: 9999, name: "G · O · D", color: "#ffd700", rgb: "255,215,0",   symbol: "⚔", desc: "OMNIPOTENT!!"             },
];

function getTier(p) { return TIERS.find(t => p >= t.min && p <= t.max) || TIERS[0]; }
function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

// ─── AVATAR (3-method, with api support) ──────────────────────
async function getAvatar(uid, name, api) {
    if (!uid) return makeFallback(uid, name);

    // Method 1: fca-sifu api.getUserInfo (best — sees private photos)
    if (api) {
        try {
            const info = await new Promise((res, rej) =>
                api.getUserInfo([uid], (e, r) => e ? rej(e) : res(r)));
            const src = info?.[uid]?.thumbSrc || info?.[uid]?.profilePicture;
            if (src) {
                const r = await axios.get(src, {
                    responseType: "arraybuffer", timeout: 10000, maxRedirects: 10,
                    headers: { "User-Agent": UA },
                });
                if ((r.headers["content-type"] || "").includes("image") && r.data?.byteLength > 500)
                    return await loadImage(Buffer.from(r.data));
            }
        } catch {}
    }

    // Method 2: Graph API redirect=false → CDN URL
    try {
        const meta = await axios.get(
            `https://graph.facebook.com/${uid}/picture?width=512&height=512&type=square&redirect=false`,
            { timeout: 8000, headers: { "User-Agent": UA } }
        );
        const cdnUrl = meta?.data?.data?.url;
        if (cdnUrl) {
            const r = await axios.get(cdnUrl, {
                responseType: "arraybuffer", timeout: 10000, maxRedirects: 10,
                headers: { "User-Agent": UA },
            });
            if ((r.headers["content-type"] || "").includes("image") && r.data?.byteLength > 500)
                return await loadImage(Buffer.from(r.data));
        }
    } catch {}

    // Method 3: Direct redirect follow
    try {
        const r = await axios.get(
            `https://graph.facebook.com/${uid}/picture?width=256&height=256&type=large`,
            { responseType: "arraybuffer", timeout: 8000, maxRedirects: 10, headers: { "User-Agent": UA } }
        );
        if ((r.headers["content-type"] || "").includes("image") && r.data?.byteLength > 1000)
            return await loadImage(Buffer.from(r.data));
    } catch {}

    return makeFallback(uid, name);
}

function makeFallback(uid, name) {
    const c  = new Canvas(256, 256);
    const cx = c.getContext("2d");
    const COLS = ["#e74c3c","#3498db","#2ecc71","#f39c12","#9b59b6","#1abc9c","#e67e22","#e91e63"];
    const i  = String(uid || "0").split("").reduce((s, ch) => s + ch.charCodeAt(0), 0) % COLS.length;
    const g  = cx.createLinearGradient(0, 0, 256, 256);
    g.addColorStop(0, COLS[i]); g.addColorStop(1, COLS[(i + 3) % COLS.length]);
    cx.fillStyle = g; cx.fillRect(0, 0, 256, 256);
    cx.fillStyle = "rgba(0,0,0,0.25)"; cx.fillRect(0, 0, 256, 256);
    cx.fillStyle = "#ffffff";
    cx.font = "bold 108px NotoSans, sans-serif";
    cx.textAlign = "center"; cx.textBaseline = "middle";
    cx.fillText((name || "?")[0].toUpperCase(), 128, 138);
    return loadImage(c.toBuffer());
}

function drawCircle(ctx, img, x, y, r) {
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
    ctx.restore();
}

function drawHexGrid(ctx, W, H, rgb, alpha) {
    const sz = 28;
    ctx.strokeStyle = `rgba(${rgb},${alpha})`; ctx.lineWidth = 0.5;
    for (let row = -1; row < H / (sz * 1.5) + 2; row++) {
        for (let col = -1; col < W / (sz * 1.73) + 2; col++) {
            const ox = row % 2 === 0 ? 0 : sz * 0.866;
            const hx = col * sz * 1.73 + ox, hy = row * sz * 1.5;
            ctx.beginPath();
            for (let k = 0; k < 6; k++) {
                const a = (Math.PI / 3) * k + Math.PI / 6;
                k === 0 ? ctx.moveTo(hx + sz * Math.cos(a), hy + sz * Math.sin(a))
                        : ctx.lineTo(hx + sz * Math.cos(a), hy + sz * Math.sin(a));
            }
            ctx.closePath(); ctx.stroke();
        }
    }
}

function drawCornerBrackets(ctx, W, H, color, sz = 36) {
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.lineCap = "square";
    ctx.shadowColor = color; ctx.shadowBlur = 16;
    const M = 10;
    for (const [ox, oy, dx, dy] of [[M,M,1,1],[W-M,M,-1,1],[M,H-M,1,-1],[W-M,H-M,-1,-1]]) {
        ctx.beginPath();
        ctx.moveTo(ox, oy + sz * dy); ctx.lineTo(ox, oy); ctx.lineTo(ox + sz * dx, oy);
        ctx.stroke();
    }
    ctx.shadowBlur = 0; ctx.restore();
}

// ─── MAIN GIF BUILDER ─────────────────────────────────────────
async function buildAuraGIF(avatarImg, name, power, uid, outPath) {
    const W = 900, H = 500;
    const tier = getTier(power);
    const { color, rgb, symbol } = tier;

    // Avatar zone (left)
    const CX = 220, CY = 250, AVR = 96;
    const R1 = 126, R2 = 150, R3 = 175;

    // Info zone (right)
    const IX = 510; // info center-x

    const encoder = new GIFEncoder(W, H);
    const gifOut  = fs.createWriteStream(outPath);
    encoder.createReadStream().pipe(gifOut);
    encoder.start(); encoder.setRepeat(0); encoder.setDelay(50); encoder.setQuality(6);

    const FRAMES = 60;
    const canvas = new Canvas(W, H);
    const ctx    = canvas.getContext("2d");

    // Pre-compute particles
    const PARTS = Array.from({ length: 20 }, () => ({
        angle: Math.random() * Math.PI * 2,
        dist:  R2 + 12 + Math.random() * 24,
        r:     1.2 + Math.random() * 2.4,
        speed: (Math.random() < 0.5 ? 1 : -1) * (0.04 + Math.random() * 0.06),
        phase: Math.random() * Math.PI * 2,
    }));
    const STARS = Array.from({ length: 40 }, () => ({
        x: Math.random() * W, y: Math.random() * H,
        r: 0.3 + Math.random() * 1.2,
        phase: Math.random() * Math.PI * 2,
        speed: 0.04 + Math.random() * 0.07,
    }));

    for (let f = 0; f < FRAMES; f++) {
        const t     = f / FRAMES;
        const rot   = t * Math.PI * 2;
        const pulse = Math.sin(f * 0.32);
        const scanT = easeOut(Math.min(f / (FRAMES * 0.55), 1));
        const introT = easeOut(Math.min(f / (FRAMES * 0.4), 1));

        ctx.clearRect(0, 0, W, H);

        // ── Background
        const bg = ctx.createLinearGradient(0, 0, W, H);
        bg.addColorStop(0,   "#030710");
        bg.addColorStop(0.5, "#050c18");
        bg.addColorStop(1,   "#030710");
        ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

        // Radial glow behind avatar
        const glow = ctx.createRadialGradient(CX, CY, 0, CX, CY, R3 + 60);
        glow.addColorStop(0,   `rgba(${rgb},${0.18 * scanT})`);
        glow.addColorStop(0.6, `rgba(${rgb},${0.05 * scanT})`);
        glow.addColorStop(1,   "transparent");
        ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

        // Hex grid
        drawHexGrid(ctx, W, H, rgb, 0.035 * scanT);

        // ── Stars (background twinkle)
        for (const s of STARS) {
            const alpha = (0.06 + 0.14 * Math.abs(Math.sin(s.phase + f * s.speed))) * scanT;
            ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${rgb},${alpha})`; ctx.fill();
        }

        // ── Outer ring segments (rotating)
        for (let s = 0; s < 12; s++) {
            const a1  = rot + s * (Math.PI / 6);
            const a2  = a1 + Math.PI / 6 * 0.55;
            const alp = scanT * (0.15 + 0.25 * (s % 2 === 0 ? Math.abs(pulse) : 1 - Math.abs(pulse)));
            ctx.strokeStyle = `rgba(${rgb},${alp})`; ctx.lineWidth = 2;
            ctx.shadowColor = color; ctx.shadowBlur = 6 * scanT;
            ctx.beginPath(); ctx.arc(CX, CY, R3, a1, a2); ctx.stroke();
            ctx.shadowBlur = 0;
        }

        // ── Mid ring segments (counter-rotating)
        for (let s = 0; s < 8; s++) {
            const a1  = -rot * 0.7 + s * (Math.PI / 4);
            const a2  = a1 + Math.PI / 4 * 0.5;
            const alp = scanT * (0.2 + 0.2 * Math.abs(pulse));
            ctx.strokeStyle = `rgba(${rgb},${alp})`; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(CX, CY, R2, a1, a2); ctx.stroke();
        }

        // ── Inner pulsing ring
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5 + 2 * Math.abs(pulse);
        ctx.shadowColor = color; ctx.shadowBlur = (18 + 12 * Math.abs(pulse)) * scanT;
        ctx.beginPath(); ctx.arc(CX, CY, R1, 0, Math.PI * 2); ctx.stroke();
        ctx.shadowBlur = 0;

        // ── Aura progress arc (bottom)
        const arcStart = Math.PI * 0.65, arcEnd = Math.PI * 2.35;
        ctx.strokeStyle = "rgba(255,255,255,0.06)"; ctx.lineWidth = 10;
        ctx.lineCap = "round";
        ctx.beginPath(); ctx.arc(CX, CY, R1 + 20, arcStart, arcEnd); ctx.stroke();
        const arcFill = arcStart + (arcEnd - arcStart) * (power / 9999) * scanT;
        if (arcFill > arcStart) {
            const arcGrad = ctx.createLinearGradient(
                CX + Math.cos(arcStart) * (R1 + 20), CY + Math.sin(arcStart) * (R1 + 20),
                CX + Math.cos(arcFill)  * (R1 + 20), CY + Math.sin(arcFill)  * (R1 + 20)
            );
            arcGrad.addColorStop(0, `rgba(${rgb},0.3)`); arcGrad.addColorStop(1, color);
            ctx.strokeStyle = arcGrad;
            ctx.shadowColor = color; ctx.shadowBlur = 14;
            ctx.beginPath(); ctx.arc(CX, CY, R1 + 20, arcStart, arcFill); ctx.stroke();
            ctx.shadowBlur = 0;
        }
        ctx.lineCap = "butt";

        // ── Orbiting particles
        for (const p of PARTS) {
            const angle = p.angle + f * p.speed;
            const px    = CX + Math.cos(angle) * p.dist;
            const py    = CY + Math.sin(angle) * p.dist;
            const palp  = scanT * (0.3 + 0.5 * Math.abs(Math.sin(p.phase + f * 0.18)));
            ctx.beginPath(); ctx.arc(px, py, p.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${rgb},${palp})`;
            ctx.shadowColor = color; ctx.shadowBlur = 5;
            ctx.fill(); ctx.shadowBlur = 0;
        }

        // ── Avatar (with scan reveal)
        drawCircle(ctx, avatarImg, CX, CY, AVR);

        // Scan reveal overlay (sweeps down on first frames)
        if (scanT < 1) {
            const scanY = CY - AVR + AVR * 2 * scanT;
            const sg = ctx.createLinearGradient(0, scanY - 14, 0, scanY + 14);
            sg.addColorStop(0, "rgba(255,255,255,0)");
            sg.addColorStop(0.5, `rgba(${rgb},0.6)`);
            sg.addColorStop(1, "rgba(255,255,255,0)");
            ctx.save(); ctx.beginPath(); ctx.arc(CX, CY, AVR, 0, Math.PI * 2); ctx.clip();
            ctx.fillStyle = sg; ctx.fillRect(CX - AVR, scanY - 16, AVR * 2, 32);
            ctx.restore();
        }

        // ── DIVIDER line (left panel → right panel)
        ctx.strokeStyle = `rgba(${rgb},${0.18 * scanT})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(370, 30); ctx.lineTo(370, H - 30); ctx.stroke();

        // ── RIGHT PANEL ──────────────────────────────────────────────

        // Header label
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.font = `bold 10px ${FNT}`;
        ctx.fillStyle = `rgba(${rgb},${0.8 * introT})`;
        ctx.shadowColor = color; ctx.shadowBlur = 8 * introT;
        ctx.fillText("◈  A U R A   S C A N N E R  ◈", IX, 50);
        ctx.shadowBlur = 0;

        ctx.strokeStyle = `rgba(${rgb},${0.2 * introT})`; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(390, 64); ctx.lineTo(W - 20, 64); ctx.stroke();

        // ── Tier badge
        const bW = 240, bH = 58;
        const bX  = IX - bW / 2, bY = 78;
        // Badge background
        ctx.fillStyle = `rgba(${rgb},0.07)`;
        ctx.beginPath(); ctx.roundRect(bX, bY, bW, bH, 10); ctx.fill();
        ctx.strokeStyle = color; ctx.lineWidth = 1.5;
        ctx.shadowColor = color; ctx.shadowBlur = (12 + 8 * Math.abs(pulse)) * introT;
        ctx.stroke(); ctx.shadowBlur = 0;
        // Symbol left
        ctx.font = `bold 28px ${FNT}`; ctx.fillStyle = color;
        ctx.shadowColor = color; ctx.shadowBlur = 10 * introT;
        ctx.fillText(symbol, bX + 28, bY + bH / 2);
        ctx.shadowBlur = 0;
        // Tier name
        ctx.font = `bold 26px ${FNT}`; ctx.fillStyle = color;
        ctx.shadowColor = color; ctx.shadowBlur = (14 + 10 * Math.abs(pulse)) * introT;
        ctx.fillText(tier.name, IX + 16, bY + bH / 2);
        ctx.shadowBlur = 0;

        // Tier desc
        ctx.font = `10px ${FNT}`; ctx.fillStyle = `rgba(255,255,255,${0.4 * introT})`;
        ctx.fillText(tier.desc, IX, bY + bH + 16);

        // ── Name
        ctx.font = `bold 22px ${FNT}`; ctx.fillStyle = `rgba(255,255,255,${0.95 * introT})`;
        ctx.shadowColor = color; ctx.shadowBlur = 8 * introT;
        const dispName = name.length > 24 ? name.slice(0, 24) + "…" : name;
        ctx.fillText(dispName, IX, bY + bH + 40);
        ctx.shadowBlur = 0;

        ctx.strokeStyle = `rgba(${rgb},${0.15 * introT})`; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(390, bY + bH + 58); ctx.lineTo(W - 20, bY + bH + 58); ctx.stroke();

        // ── POWER LEVEL label
        ctx.font = `9px ${FNT}`; ctx.fillStyle = `rgba(255,255,255,${0.3 * introT})`;
        ctx.fillText("P O W E R   L E V E L", IX, bY + bH + 75);

        // ── Power number (animated count-up)
        const dispPow = Math.round(power * scanT);
        ctx.font = `bold 72px ${FNT}`; ctx.fillStyle = color;
        ctx.shadowColor = color; ctx.shadowBlur = (24 + 16 * Math.abs(pulse)) * scanT;
        ctx.fillText(dispPow.toLocaleString(), IX, bY + bH + 148);
        ctx.shadowBlur = 0;

        ctx.font = `10px ${FNT}`; ctx.fillStyle = `rgba(255,255,255,${0.2 * introT})`;
        ctx.fillText("/ 9,999", IX, bY + bH + 188);

        // ── Progress bar
        const pbX = 395, pbW = 460 - 395 + (W - 460), pbH = 10, pbY = bY + bH + 210;
        // Actually let's center it properly
        const pbXc = 390, pbWc = W - 390 - 20;
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        ctx.beginPath(); ctx.roundRect(pbXc, pbY, pbWc, pbH, pbH / 2); ctx.fill();
        const pbFill = (power / 9999) * pbWc * scanT;
        if (pbFill > 0) {
            const pg = ctx.createLinearGradient(pbXc, 0, pbXc + pbFill, 0);
            pg.addColorStop(0, `rgba(${rgb},0.5)`); pg.addColorStop(1, color);
            ctx.fillStyle = pg; ctx.shadowColor = color; ctx.shadowBlur = 10;
            ctx.beginPath(); ctx.roundRect(pbXc, pbY, pbFill, pbH, pbH / 2); ctx.fill();
            ctx.shadowBlur = 0;

            // Tip glow dot
            ctx.fillStyle = "#ffffff";
            ctx.shadowColor = color; ctx.shadowBlur = 16;
            ctx.beginPath(); ctx.arc(pbXc + pbFill, pbY + pbH / 2, pbH / 2 + 2, 0, Math.PI * 2); ctx.fill();
            ctx.shadowBlur = 0;
        }

        // ── UID small text
        ctx.font = `9px ${FNT}`; ctx.fillStyle = `rgba(255,255,255,${0.12 * introT})`;
        ctx.fillText(`uid: ${uid || "?"}`, IX, H - 36);

        // ── Scan line sweep
        const scanLineY = ((f / FRAMES) * H * 1.8) % H;
        const slg = ctx.createLinearGradient(0, scanLineY - 30, 0, scanLineY + 30);
        slg.addColorStop(0, "rgba(255,255,255,0)");
        slg.addColorStop(0.5, `rgba(${rgb},0.04)`);
        slg.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = slg; ctx.fillRect(0, scanLineY - 30, W, 60);

        // ── Border
        const borderAlpha = (0.28 + 0.22 * Math.abs(pulse)) * scanT;
        ctx.strokeStyle = `rgba(${rgb},${borderAlpha})`; ctx.lineWidth = 2;
        ctx.shadowColor = color; ctx.shadowBlur = 10 + 8 * Math.abs(pulse);
        ctx.beginPath(); ctx.roundRect(5, 5, W - 10, H - 10, 14); ctx.stroke();
        ctx.shadowBlur = 0;

        // Corner brackets
        drawCornerBrackets(ctx, W, H, color);

        // ── LIVE dot (top-right)
        ctx.fillStyle = f % 4 < 3 ? color : "rgba(0,0,0,0)";
        ctx.shadowColor = color; ctx.shadowBlur = f % 4 < 3 ? 10 : 0;
        ctx.beginPath(); ctx.arc(W - 30, 24, 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.font = `9px ${FNT}`; ctx.fillStyle = `rgba(255,255,255,0.3)`;
        ctx.textAlign = "right"; ctx.fillText("LIVE", W - 14, 24);
        ctx.textAlign = "center";

        encoder.addFrame(ctx);
    }

    encoder.finish();
    return new Promise((res, rej) => {
        gifOut.on("finish", res);
        gifOut.on("error", rej);
    });
}

// ─── MODULE ────────────────────────────────────────────────────
module.exports = {
    config: {
        name:        "aura",
        aliases:     ["laura"],
        version:     "2.0.0",
        author:      "SIFAT",
        countDown:   15,
        role:        0,
        description: { en: "Scan your aura power level — animated GIF card" },
        category:    "fun",
        guide:       { en: "   {pn}        → scan your aura\n   {pn} @tag   → scan tagged user's aura" },
    },

    onLoad: async function () {
        const https = require("https");
        fs.mkdirSync(FONT_DIR, { recursive: true });
        const fonts = [
            { file: path.join(FONT_DIR, "NotoSans-Bold.ttf"),         url: "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Bold.ttf",              family: "NotoSans",        weight: "bold"   },
            { file: path.join(FONT_DIR, "NotoSans-Regular.ttf"),       url: "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf",            family: "NotoSans",        weight: "normal" },
            { file: path.join(FONT_DIR, "NotoSansBengali-Bold.ttf"),   url: "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSansBengali/NotoSansBengali-Bold.ttf",    family: "NotoSansBengali", weight: "bold"   },
            { file: path.join(FONT_DIR, "NotoSansBengali-Regular.ttf"),url: "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSansBengali/NotoSansBengali-Regular.ttf", family: "NotoSansBengali", weight: "normal" },
            { file: path.join(FONT_DIR, "NotoEmoji-Regular.ttf"),      url: "https://raw.githubusercontent.com/googlefonts/noto-emoji/main/fonts/Noto-COLRv1-noflags.ttf",                         family: "NotoEmoji",       weight: "normal" },
        ];
        const dl = (url, dest) => new Promise((res, rej) => {
            const file = require("fs").createWriteStream(dest);
            const req  = u => https.get(u, r => {
                if (r.statusCode === 301 || r.statusCode === 302) return req(r.headers.location);
                r.pipe(file);
                file.on("finish", () => { file.close(); res(); });
            }).on("error", e => { try { require("fs").unlinkSync(dest); } catch {} rej(e); });
            req(url);
        });
        for (const f of fonts) {
            try {
                if (!require("fs").existsSync(f.file)) await dl(f.url, f.file);
                registerFont(f.file, { family: f.family, weight: f.weight });
            } catch (e) { console.error("[aura] font:", e.message); }
        }
    },

    onStart: async function ({ args, message, event, threadsData, api }) {
        const { threadID, senderID, mentions, type, messageReply } = event;

        let targetUID  = senderID;
        let targetName = "Unknown";

        if (type === "message_reply" && messageReply?.senderID) targetUID = messageReply.senderID;
        else if (Object.keys(mentions || {}).length > 0) targetUID = Object.keys(mentions)[0];

        try {
            const members = (await threadsData.get(threadID, "members")) || [];
            const m       = members.find(u => u.userID == targetUID);
            targetName    = m?.name || "Facebook User";

            const msgCount = m?.count || 0;
            const base     = Math.min(msgCount * 4, 4500);
            const rand     = Math.floor(Math.random() * 5500);
            const power    = Math.min(9999, base + rand);

            const wait      = await message.reply("⚡ Scanning aura...");
            const avatarImg = await getAvatar(targetUID, targetName, api);
            const outPath   = path.resolve(__dirname, "cache", `aura_${targetUID}_${Date.now()}.gif`);

            fs.ensureDirSync(path.dirname(outPath));
            await buildAuraGIF(avatarImg, targetName, power, targetUID, outPath);

            try { if (wait?.messageID) await message.unsend(wait.messageID); } catch {}
            await message.reply({ body: "", attachment: require("fs").createReadStream(outPath) });
            setTimeout(() => fs.unlink(outPath).catch(() => {}), 30_000);
        } catch (err) {
            console.error("[aura]", err);
            return message.reply("❌ Error: " + err.message);
        }
    },
};

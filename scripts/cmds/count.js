"use strict";

const axios      = require("axios");
const fs         = require("fs");
const fsExtra    = require("fs-extra");
const path       = require("path");
const { Canvas, loadImage, registerFont } = require("canvas");
const moment     = require("moment-timezone");
const GIFEncoder = require("gifencoder");

const TIMEZONE    = global.GoatBot?.config?.timeZone || "Asia/Dhaka";
const FONT_DIR    = path.resolve(__dirname, "cache", "fonts");
const ACTIVITY_PATH = path.resolve(__dirname, "cache", "count_activity.json");
const ACCESS_TOKEN  = "6628568379%7Cc1e620fa708a1d5696fb991c1bde5662";

function readActivity() {
    try { fsExtra.ensureFileSync(ACTIVITY_PATH); return fsExtra.readJsonSync(ACTIVITY_PATH); }
    catch { return {}; }
}
function writeActivity(data) {
    try { fsExtra.writeJsonSync(ACTIVITY_PATH, data, { spaces: 2 }); } catch {}
}
function easeOut(t)  { return 1 - Math.pow(1 - t, 3); }
function easeIn(t)   { return t * t * t; }

function fmtNum(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return n.toLocaleString();
}
function fitText(ctx, text, maxWidth) {
    let t = String(text);
    if (ctx.measureText(t).width <= maxWidth) return t;
    while (t.length > 0 && ctx.measureText(t + "…").width > maxWidth) t = t.slice(0, -1);
    return t + "…";
}

function makeFallbackAvatar(uid, name) {
    const c = new Canvas(256, 256);
    const cx = c.getContext("2d");
    const COLORS = ["#e74c3c","#3498db","#2ecc71","#f39c12","#9b59b6","#1abc9c","#e67e22","#e91e63"];
    const idx = String(uid || "0").split("").reduce((s, ch) => s + ch.charCodeAt(0), 0) % COLORS.length;
    const grad = cx.createLinearGradient(0, 0, 256, 256);
    grad.addColorStop(0, COLORS[idx]);
    grad.addColorStop(1, COLORS[(idx + 3) % COLORS.length]);
    cx.fillStyle = grad; cx.fillRect(0, 0, 256, 256);
    cx.fillStyle = "rgba(0,0,0,0.18)"; cx.fillRect(0, 0, 256, 256);
    cx.fillStyle = "#ffffff";
    cx.font = "bold 100px NotoSans, NotoSansBengali, NotoEmoji, sans-serif";
    cx.textAlign = "center"; cx.textBaseline = "middle";
    cx.fillText((name || "?").charAt(0).toUpperCase(), 128, 135);
    return loadImage(c.toBuffer());
}

async function getAvatar(uid, name, api) {
    if (!uid) return makeFallbackAvatar(uid, name);
    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36";

    // Method 1: fca-sifu api.getUserInfo (logged-in bot sees private photos)
    if (api) {
        try {
            const info = await new Promise((res, rej) =>
                api.getUserInfo([uid], (e, r) => e ? rej(e) : res(r)));
            const src = info?.[uid]?.thumbSrc || info?.[uid]?.profilePicture;
            if (src) {
                const r = await axios.get(src, {
                    responseType: "arraybuffer", timeout: 10000, maxRedirects: 10,
                    headers: { "User-Agent": UA }
                });
                const ct = r.headers["content-type"] || "";
                if (ct.includes("image") && r.data?.byteLength > 500)
                    return await loadImage(Buffer.from(r.data));
            }
        } catch {}
    }

    // Method 2: Graph API redirect=false → get actual CDN URL
    try {
        const meta = await axios.get(
            `https://graph.facebook.com/${uid}/picture?width=512&height=512&type=square&redirect=false`,
            { timeout: 8000, headers: { "User-Agent": UA } }
        );
        const cdnUrl = meta?.data?.data?.url;
        if (cdnUrl) {
            const r = await axios.get(cdnUrl, {
                responseType: "arraybuffer", timeout: 10000, maxRedirects: 10,
                headers: { "User-Agent": UA }
            });
            const ct = r.headers["content-type"] || "";
            if (ct.includes("image") && r.data?.byteLength > 500)
                return await loadImage(Buffer.from(r.data));
        }
    } catch {}

    // Method 3: Direct follow redirects
    try {
        const res = await axios.get(
            `https://graph.facebook.com/${uid}/picture?width=256&height=256&type=large`,
            { responseType: "arraybuffer", timeout: 8000, maxRedirects: 10, headers: { "User-Agent": UA } }
        );
        const ct = res.headers["content-type"] || "";
        if (ct.includes("image") && res.data?.byteLength > 1000)
            return await loadImage(Buffer.from(res.data));
    } catch {}

    return makeFallbackAvatar(uid, name);
}

async function preloadAvatars(users, concurrency = 5, api) {
    const map = new Map();
    for (let i = 0; i < users.length; i += concurrency) {
        const batch   = users.slice(i, i + concurrency);
        const results = await Promise.allSettled(batch.map(u => getAvatar(u.uid, u.name, api)));
        results.forEach((r, j) => map.set(batch[j].uid, r.status === "fulfilled" ? r.value : null));
    }
    return map;
}

function drawCircle(ctx, img, x, y, r) {
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
    ctx.restore();
}

function drawHexGrid(ctx, W, H, rgb, alpha) {
    const sz = 24;
    ctx.strokeStyle = `rgba(${rgb},${alpha})`;
    ctx.lineWidth   = 0.45;
    for (let row = -1; row < H / (sz * 1.5) + 2; row++) {
        for (let col = -1; col < W / (sz * 1.73) + 2; col++) {
            const ox = row % 2 === 0 ? 0 : sz * 0.866;
            const hx = col * sz * 1.73 + ox;
            const hy = row * sz * 1.5;
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
                const a = (Math.PI / 3) * i + Math.PI / 6;
                i === 0 ? ctx.moveTo(hx + sz * Math.cos(a), hy + sz * Math.sin(a))
                        : ctx.lineTo(hx + sz * Math.cos(a), hy + sz * Math.sin(a));
            }
            ctx.closePath(); ctx.stroke();
        }
    }
}

function drawCorners(ctx, W, H, color, sz = 24) {
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = 2.5;
    ctx.shadowColor = color; ctx.shadowBlur = 14;
    [[10,10,1,1],[W-10-sz,10,-1,1],[10,H-10-sz,1,-1],[W-10-sz,H-10-sz,-1,-1]].forEach(([bx,by,dx,dy]) => {
        ctx.beginPath();
        ctx.moveTo(bx, by + sz * dy); ctx.lineTo(bx, by); ctx.lineTo(bx + sz * dx, by);
        ctx.stroke();
    });
    ctx.shadowBlur = 0; ctx.restore();
}

function spawnParticles(count, W, H) {
    return Array.from({ length: count }, () => ({
        x: Math.random() * W, y: Math.random() * H,
        r: 0.4 + Math.random() * 1.4,
        phase: Math.random() * Math.PI * 2,
        speed: 0.05 + Math.random() * 0.09,
    }));
}

const POD_COLORS = ["#FFD700","#C0C0C0","#CD7F32"];
const POD_RGB    = ["255,215,0","192,192,192","205,127,50"];
const MEDALS     = ["🥇","🥈","🥉"];

// ══════════════════════════════════════════════════
//  LEADERBOARD
// ══════════════════════════════════════════════════
async function buildLeaderboardBase(combinedData, page, totalPages, theme, avatarMap) {
    const PER_PAGE = 10;
    const top3     = combinedData.slice(0, 3);
    const rest     = combinedData.slice(3);
    const startIdx = (page - 1) * PER_PAGE;
    const pageRows = rest.slice(startIdx, startIdx + PER_PAGE);
    const topCount = top3[0]?.count || 1;

    const W      = 900;
    const POD_H  = 370;
    const ROW_H  = 70;
    const FOOT_H = 50;
    const H      = POD_H + pageRows.length * ROW_H + FOOT_H;

    const canvas = new Canvas(W, H);
    const ctx    = canvas.getContext("2d");
    const { primary, rgb } = theme;
    const FNT = "NotoSans, NotoSansBengali, NotoEmoji, sans-serif";

    // Background
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#040910"); bg.addColorStop(0.5, "#07101e"); bg.addColorStop(1, "#040910");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const rg = ctx.createRadialGradient(W/2, 80, 0, W/2, 80, W * 0.6);
    rg.addColorStop(0, `rgba(${rgb},0.1)`); rg.addColorStop(1, "transparent");
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    drawHexGrid(ctx, W, H, rgb, 0.038);

    // Header
    ctx.textAlign = "center";
    ctx.font = `bold 38px ${FNT}`;
    ctx.fillStyle = primary; ctx.shadowColor = primary; ctx.shadowBlur = 20;
    ctx.fillText("LEADERBOARD", W / 2, 48); ctx.shadowBlur = 0;
    ctx.font = `12px ${FNT}`; ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.fillText(`TOP MESSAGE COUNT  •  PAGE ${page} / ${totalPages}`, W / 2, 70);
    ctx.strokeStyle = `rgba(${rgb},0.2)`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(40, 84); ctx.lineTo(W - 40, 84); ctx.stroke();

    // Podium positions: 1st center (bigger), 2nd left, 3rd right
    const podPos = [
        { x: 450, y: 225, r: 72, i: 0, podY: 290 },
        { x: 170, y: 248, r: 58, i: 1, podY: 312 },
        { x: 730, y: 248, r: 58, i: 2, podY: 312 },
    ];

    // Podium platforms
    for (const { x, podY, r, i } of podPos) {
        const pw = (r + 20) * 2;
        const ph = [52, 38, 38][i];
        ctx.fillStyle = `rgba(${POD_RGB[i]},0.1)`;
        ctx.beginPath(); ctx.roundRect(x - pw/2, podY, pw, ph, [4,4,0,0]);
        ctx.fill();
        ctx.strokeStyle = POD_COLORS[i]; ctx.lineWidth = 1.2;
        ctx.shadowColor = POD_COLORS[i]; ctx.shadowBlur = 6;
        ctx.stroke(); ctx.shadowBlur = 0;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.font = `bold ${i === 0 ? 20 : 17}px ${FNT}`;
        ctx.fillStyle = POD_COLORS[i]; ctx.shadowColor = POD_COLORS[i]; ctx.shadowBlur = 4;
        ctx.fillText(["1ST","2ND","3RD"][i], x, podY + ph / 2); ctx.shadowBlur = 0;
    }

    for (const { x, y, r, i } of podPos) {
        const u  = top3[i];
        if (!u) continue;
        const pc = POD_COLORS[i];

        // Avatar ring
        ctx.strokeStyle = pc; ctx.lineWidth = 3;
        ctx.shadowColor = pc; ctx.shadowBlur = 14;
        ctx.beginPath(); ctx.arc(x, y, r + 5, 0, Math.PI * 2);
        ctx.stroke(); ctx.shadowBlur = 0;

        const av = avatarMap.get(u.uid);
        if (av) drawCircle(ctx, av, x, y, r);

        // Name
        ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "top";
        ctx.font = `bold ${r >= 72 ? 17 : 14}px ${FNT}`;
        ctx.fillText(fitText(ctx, u.name, r * 2.5), x, y + r + 10);

        // Count
        ctx.font = `bold ${r >= 72 ? 20 : 16}px ${FNT}`;
        ctx.fillStyle = pc; ctx.shadowColor = pc; ctx.shadowBlur = 8;
        ctx.fillText(fmtNum(u.count), x, y + r + 32); ctx.shadowBlur = 0;
        ctx.font = `9px ${FNT}`; ctx.fillStyle = "rgba(255,255,255,0.3)";
        ctx.fillText("msgs", x, y + r + 52);
    }

    // Separator
    ctx.strokeStyle = `rgba(${rgb},0.16)`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(30, POD_H - 4); ctx.lineTo(W - 30, POD_H - 4); ctx.stroke();

    // Rows 4+
    let ry = POD_H;
    for (let i = 0; i < pageRows.length; i++) {
        const u    = pageRows[i];
        const rank = startIdx + i + 4;

        // Row bg
        ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.15)";
        ctx.beginPath(); ctx.roundRect(16, ry + 3, W - 32, ROW_H - 6, 6); ctx.fill();

        // Rank
        ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.font = `bold 18px ${FNT}`;
        ctx.textAlign = "right"; ctx.textBaseline = "middle";
        ctx.fillText(`#${rank}`, 62, ry + ROW_H / 2);

        // Avatar
        const av = avatarMap.get(u.uid);
        if (av) {
            ctx.save();
            ctx.beginPath(); ctx.arc(95, ry + ROW_H / 2, 24, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(${rgb},0.45)`; ctx.lineWidth = 1.5; ctx.stroke();
            ctx.clip(); ctx.drawImage(av, 71, ry + ROW_H / 2 - 24, 48, 48); ctx.restore();
        }

        // Name
        ctx.fillStyle = "#ffffff"; ctx.font = `bold 18px ${FNT}`;
        ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillText(fitText(ctx, u.name, 260), 132, ry + ROW_H / 2);

        // Progress bar
        const barX = 420, barW = 290, barH = 8;
        const barY = ry + ROW_H / 2 - barH / 2;
        const prog = Math.max(0, (u.count / topCount) * barW);
        ctx.fillStyle = "rgba(255,255,255,0.05)";
        ctx.beginPath(); ctx.roundRect(barX, barY, barW, barH, barH / 2); ctx.fill();
        if (prog > 0) {
            const bGrad = ctx.createLinearGradient(barX, 0, barX + prog, 0);
            bGrad.addColorStop(0, primary); bGrad.addColorStop(1, `rgba(${rgb},0.35)`);
            ctx.fillStyle = bGrad; ctx.shadowColor = primary; ctx.shadowBlur = 5;
            ctx.beginPath(); ctx.roundRect(barX, barY, prog, barH, barH / 2); ctx.fill();
            ctx.shadowBlur = 0;
        }

        // Count
        ctx.fillStyle = primary; ctx.shadowColor = primary; ctx.shadowBlur = 5;
        ctx.font = `bold 17px ${FNT}`; ctx.textAlign = "right"; ctx.textBaseline = "middle";
        ctx.fillText(fmtNum(u.count), W - 22, ry + ROW_H / 2);
        ctx.shadowBlur = 0;

        ry += ROW_H;
    }

    // Footer
    ctx.font = `10px ${FNT}`; ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(
        totalPages > 1
            ? `PAGE ${page} / ${totalPages}  •  REPLY WITH A NUMBER TO NAVIGATE`
            : "GOATBOT  ◈  MESSAGE LEADERBOARD",
        W / 2, H - 20
    );

    return canvas;
}

function buildLeaderboardGIF(baseCanvas, theme, outPath, combinedData, page, avatarMap) {
    return new Promise((resolve, reject) => {
        const W = baseCanvas.width, H = baseCanvas.height;
        const PER_PAGE = 10;
        const top3     = combinedData.slice(0, 3);
        const rest     = combinedData.slice(3);
        const startIdx = (page - 1) * PER_PAGE;
        const pageRows = rest.slice(startIdx, startIdx + PER_PAGE);
        const topCount = top3[0]?.count || 1;
        const { primary, rgb } = theme;

        const encoder = new GIFEncoder(W, H);
        const gifOut  = fs.createWriteStream(outPath);
        encoder.createReadStream().pipe(gifOut);
        encoder.start(); encoder.setRepeat(0); encoder.setDelay(65); encoder.setQuality(7);

        const POD_H  = 370;
        const ROW_H  = 70;
        const FRAMES = 36;
        const animC  = new Canvas(W, H);
        const actx   = animC.getContext("2d");
        const parts  = spawnParticles(50, W, H);
        const FNT    = "NotoSans, NotoSansBengali, NotoEmoji, sans-serif";

        const podPos = [
            { x: 450, y: 225, r: 72 },
            { x: 170, y: 248, r: 58 },
            { x: 730, y: 248, r: 58 },
        ];

        for (let f = 0; f < FRAMES; f++) {
            const t     = easeOut(Math.min(f / (FRAMES * 0.72), 1));
            const pulse = Math.sin(f * 0.32);

            actx.clearRect(0, 0, W, H);
            actx.drawImage(baseCanvas, 0, 0);

            // Particles
            for (const p of parts) {
                const a = 0.06 + 0.15 * Math.abs(Math.sin(p.phase + f * p.speed));
                actx.beginPath(); actx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                actx.fillStyle = `rgba(${rgb},${a})`; actx.fill();
            }

            // Pulsing avatar rings
            for (let i = 0; i < Math.min(3, top3.length); i++) {
                const { x, y, r } = podPos[i];
                const pc = POD_COLORS[i];
                actx.strokeStyle = pc;
                actx.lineWidth = 2.5 + 1.5 * Math.abs(pulse);
                actx.shadowColor = pc; actx.shadowBlur = 16 + 10 * Math.abs(pulse);
                actx.beginPath(); actx.arc(x, y, r + 6 + 2 * Math.abs(pulse), 0, Math.PI * 2);
                actx.stroke(); actx.shadowBlur = 0;

                // Animated count
                const animVal = Math.round(top3[i].count * t);
                actx.fillStyle = "rgba(0,0,0,0.78)";
                actx.beginPath(); actx.roundRect(x - r - 8, y + r + 24, (r + 8) * 2, 26, 5); actx.fill();
                actx.fillStyle = pc; actx.shadowColor = pc; actx.shadowBlur = 8 + 4 * Math.abs(pulse);
                actx.font = `bold ${r >= 72 ? 20 : 16}px ${FNT}`;
                actx.textAlign = "center"; actx.textBaseline = "middle";
                actx.fillText(fmtNum(animVal), x, y + r + 37); actx.shadowBlur = 0;
            }

            // Animated row bars + counts
            let ry = POD_H;
            for (let i = 0; i < pageRows.length; i++) {
                const u    = pageRows[i];
                const rowT = easeOut(Math.max(0, Math.min(1, t - i * 0.025)));
                const barX = 420, barW = 290, barH = 8;
                const barY = ry + ROW_H / 2 - barH / 2;
                const prog = Math.max(0, (u.count / topCount) * barW * rowT);

                if (prog > 0) {
                    const bGrad = actx.createLinearGradient(barX, 0, barX + prog, 0);
                    bGrad.addColorStop(0, primary); bGrad.addColorStop(1, `rgba(${rgb},0.35)`);
                    actx.fillStyle = bGrad; actx.shadowColor = primary;
                    actx.shadowBlur = 6 + 3 * Math.abs(pulse);
                    actx.beginPath(); actx.roundRect(barX, barY, prog, barH, barH / 2);
                    actx.fill(); actx.shadowBlur = 0;
                }

                const animCount = Math.round(u.count * rowT);
                actx.fillStyle = "rgba(0,0,0,0.75)";
                actx.beginPath(); actx.roundRect(W - 118, ry + 16, 100, 28, 5); actx.fill();
                actx.fillStyle = primary; actx.shadowColor = primary; actx.shadowBlur = 5;
                actx.font = `bold 17px ${FNT}`;
                actx.textAlign = "right"; actx.textBaseline = "middle";
                actx.fillText(fmtNum(animCount), W - 22, ry + ROW_H / 2); actx.shadowBlur = 0;
                ry += ROW_H;
            }

            // Scan line
            const scanY = ((f / FRAMES) * H * 1.8) % H;
            const sg = actx.createLinearGradient(0, scanY - 28, 0, scanY + 28);
            sg.addColorStop(0, "rgba(255,255,255,0)");
            sg.addColorStop(0.5, `rgba(${rgb},0.05)`);
            sg.addColorStop(1, "rgba(255,255,255,0)");
            actx.fillStyle = sg; actx.fillRect(0, scanY - 28, W, 56);

            // Border pulse
            const borderA = 0.32 + 0.24 * Math.abs(pulse);
            actx.strokeStyle = `rgba(${rgb},${borderA})`;
            actx.lineWidth = 2; actx.shadowColor = primary;
            actx.shadowBlur = 10 + 8 * Math.abs(pulse);
            actx.beginPath(); actx.roundRect(5, 5, W - 10, H - 10, 10);
            actx.stroke(); actx.shadowBlur = 0;

            drawCorners(actx, W, H, primary, 22);

            // Live dot
            actx.fillStyle = f % 3 < 2 ? primary : "rgba(0,0,0,0)";
            actx.shadowColor = primary; actx.shadowBlur = f % 3 < 2 ? 10 : 0;
            actx.beginPath(); actx.arc(W - 38, 22, 5, 0, Math.PI * 2); actx.fill();
            actx.shadowBlur = 0;
            actx.fillStyle = "rgba(255,255,255,0.35)"; actx.font = `9px ${FNT}`;
            actx.textAlign = "right"; actx.textBaseline = "middle";
            actx.fillText("LIVE", W - 18, 22);

            encoder.addFrame(actx);
        }

        encoder.finish();
        gifOut.on("finish", resolve);
        gifOut.on("error", reject);
    });
}

// ══════════════════════════════════════════════════
//  USER CARD
// ══════════════════════════════════════════════════
async function buildUserCardBase(user, theme, avatarImg) {
    const W = 900, H = 540;
    const canvas = new Canvas(W, H);
    const ctx    = canvas.getContext("2d");
    const { primary, rgb } = theme;
    const FNT = "NotoSans, NotoSansBengali, NotoEmoji, sans-serif";

    // Background
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#040a15"); bg.addColorStop(0.5, "#060f1e"); bg.addColorStop(1, "#040a15");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // Avatar-side radial glow
    const rg = ctx.createRadialGradient(148, 175, 0, 148, 175, 300);
    rg.addColorStop(0, `rgba(${rgb},0.14)`); rg.addColorStop(1, "transparent");
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);

    drawHexGrid(ctx, W, H, rgb, 0.04);

    // ── Header bar ─────────────────────────────────────────────────────
    const hdrG = ctx.createLinearGradient(0, 0, W, 0);
    hdrG.addColorStop(0, "rgba(0,0,0,0)");
    hdrG.addColorStop(0.1, `rgba(${rgb},0.08)`);
    hdrG.addColorStop(0.9, `rgba(${rgb},0.08)`);
    hdrG.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = hdrG; ctx.fillRect(0, 0, W, 36);
    ctx.strokeStyle = `rgba(${rgb},0.22)`; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(0, 36); ctx.lineTo(W, 36); ctx.stroke();

    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillStyle = `rgba(${rgb},0.9)`; ctx.font = `bold 11px ${FNT}`;
    ctx.shadowColor = primary; ctx.shadowBlur = 8;
    ctx.fillText("◈  GOATBOT  —  ACTIVITY CARD", 18, 18); ctx.shadowBlur = 0;

    const now = new Date();
    const ts  = `${String(now.getDate()).padStart(2,"0")}/${String(now.getMonth()+1).padStart(2,"0")}/${now.getFullYear()}`;
    ctx.textAlign = "right"; ctx.fillStyle = "rgba(255,255,255,0.22)"; ctx.font = `9px ${FNT}`;
    ctx.fillText(ts, W - 16, 18);

    // ── Avatar (left) ──────────────────────────────────────────────────
    const AVX = 148, AVY = 178, AVR = 90;

    // Outer decorative ring
    ctx.strokeStyle = `rgba(${rgb},0.16)`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(AVX, AVY, AVR + 22, 0, Math.PI * 2); ctx.stroke();

    // Glow ring
    ctx.strokeStyle = primary; ctx.lineWidth = 3;
    ctx.shadowColor = primary; ctx.shadowBlur = 24;
    ctx.beginPath(); ctx.arc(AVX, AVY, AVR + 5, 0, Math.PI * 2);
    ctx.stroke(); ctx.shadowBlur = 0;

    if (avatarImg) drawCircle(ctx, avatarImg, AVX, AVY, AVR);

    // Rank badge
    const rankStr    = `# ${user.rank}`;
    const badgeColor = user.rank === 1 ? "#FFD700" : user.rank === 2 ? "#C0C0C0" : user.rank === 3 ? "#CD7F32" : primary;
    const bY = AVY + AVR + 14;
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.beginPath(); ctx.roundRect(AVX - 52, bY, 104, 28, 14); ctx.fill();
    ctx.strokeStyle = badgeColor; ctx.lineWidth = 1.5;
    ctx.shadowColor = badgeColor; ctx.shadowBlur = 12;
    ctx.stroke(); ctx.shadowBlur = 0;
    ctx.fillStyle = badgeColor; ctx.font = `bold 13px ${FNT}`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(rankStr, AVX, bY + 14);

    // ── Right section ──────────────────────────────────────────────────
    const TX = 268;
    ctx.textAlign = "left"; ctx.textBaseline = "top";

    // Name
    ctx.font = `bold 30px ${FNT}`; ctx.fillStyle = "#ffffff";
    ctx.shadowColor = primary; ctx.shadowBlur = 10;
    ctx.fillText(fitText(ctx, user.name, 580), TX, 46); ctx.shadowBlur = 0;

    // UID
    ctx.font = `11px ${FNT}`; ctx.fillStyle = "rgba(255,255,255,0.26)";
    ctx.fillText(`UID: ${user.uid}`, TX, 84);

    // Total messages — big number
    ctx.font = `bold 56px ${FNT}`; ctx.fillStyle = primary;
    ctx.shadowColor = primary; ctx.shadowBlur = 22;
    ctx.fillText(fmtNum(user.count), TX, 102); ctx.shadowBlur = 0;
    ctx.font = `10px ${FNT}`; ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillText("MESSAGES", TX, 165);

    // Secondary stats (daily avg, active days) — to the right of the big number
    const dailyData  = user.activity?.daily || {};
    const activeDays = Object.values(dailyData).filter(v => v > 0).length;
    const dayTotal   = Object.values(dailyData).reduce((a, b) => a + b, 0);
    const avgPerDay  = activeDays > 0 ? Math.round(dayTotal / activeDays) : 0;
    const bigNumW    = ctx.measureText(fmtNum(user.count)).width;

    // Temporarily set font to measure big number width
    ctx.font = `bold 56px ${FNT}`;
    const bnW = ctx.measureText(fmtNum(user.count)).width;

    const secStats = [
        { label: "DAILY AVG",   value: fmtNum(avgPerDay) },
        { label: "ACTIVE DAYS", value: `${activeDays}d`  },
    ];
    let ssx = TX + bnW + 18;
    for (const ss of secStats) {
        if (ssx + 114 > W - 16) break;
        ctx.fillStyle = "rgba(255,255,255,0.04)";
        ctx.beginPath(); ctx.roundRect(ssx, 102, 114, 68, 8); ctx.fill();
        ctx.strokeStyle = `rgba(${rgb},0.22)`; ctx.lineWidth = 1; ctx.stroke();
        ctx.font = `8px ${FNT}`; ctx.fillStyle = "rgba(255,255,255,0.3)"; ctx.textBaseline = "top";
        ctx.fillText(ss.label, ssx + 10, 112);
        ctx.font = `bold 24px ${FNT}`; ctx.fillStyle = primary;
        ctx.shadowColor = primary; ctx.shadowBlur = 7;
        ctx.fillText(ss.value, ssx + 10, 134); ctx.shadowBlur = 0;
        ssx += 126;
    }

    // ── Divider ────────────────────────────────────────────────────────
    ctx.strokeStyle = `rgba(${rgb},0.18)`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(30, 302); ctx.lineTo(W - 30, 302); ctx.stroke();

    // ── 7-Day Activity Chart ───────────────────────────────────────────
    const tz  = global.GoatBot?.config?.timeZone || TIMEZONE;
    const days = [];
    for (let i = 6; i >= 0; i--) {
        const d   = moment().tz(tz).subtract(i, "days");
        const key = d.format("YYYY-MM-DD");
        days.push({ label: d.format("ddd").toUpperCase(), count: dailyData[key] || 0, isToday: i === 0 });
    }
    const maxDay = Math.max(...days.map(d => d.count), 1);

    ctx.font = `9px ${FNT}`; ctx.fillStyle = "rgba(255,255,255,0.26)";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("LAST  7  DAYS  ACTIVITY", W / 2, 318);

    const chartPad = 36;
    const chartW2  = W - chartPad * 2;
    const barSlotW = Math.floor(chartW2 / 7);
    const barBase  = 415;
    const barMaxH  = 88;

    for (let i = 0; i < 7; i++) {
        const d    = days[i];
        const bx   = chartPad + i * barSlotW;
        const bCx  = bx + barSlotW / 2;
        const fill = d.count > 0 ? Math.max(7, (d.count / maxDay) * barMaxH) : 0;
        const by   = barBase - fill;

        // Empty slot
        ctx.fillStyle = "rgba(255,255,255,0.032)";
        ctx.beginPath(); ctx.roundRect(bx + 7, barBase - barMaxH, barSlotW - 14, barMaxH, 4); ctx.fill();

        if (fill > 0) {
            // Filled bar
            const bGrad = ctx.createLinearGradient(0, by, 0, barBase);
            bGrad.addColorStop(0, primary); bGrad.addColorStop(1, `rgba(${rgb},0.2)`);
            ctx.fillStyle = bGrad; ctx.shadowColor = primary; ctx.shadowBlur = 9;
            ctx.beginPath(); ctx.roundRect(bx + 7, by, barSlotW - 14, fill, 4);
            ctx.fill(); ctx.shadowBlur = 0;

            // Top cap
            ctx.fillStyle = "rgba(255,255,255,0.55)";
            ctx.fillRect(bx + 7, by, barSlotW - 14, 2);

            // Count above bar
            ctx.font = `bold 9px ${FNT}`; ctx.fillStyle = primary;
            ctx.textAlign = "center"; ctx.textBaseline = "bottom";
            ctx.fillText(fmtNum(d.count), bCx, by - 2);
        }

        // Day label
        ctx.font = d.isToday ? `bold 10px ${FNT}` : `10px ${FNT}`;
        ctx.fillStyle = d.isToday ? primary : "rgba(255,255,255,0.38)";
        ctx.textAlign = "center"; ctx.textBaseline = "top";
        ctx.fillText(d.label, bCx, barBase + 6);
    }

    // ── Type Breakdown ─────────────────────────────────────────────────
    ctx.strokeStyle = `rgba(${rgb},0.14)`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(30, 438); ctx.lineTo(W - 30, 438); ctx.stroke();

    const types     = user.activity?.types || { text: 0, sticker: 0, media: 0 };
    const typeTotal = (types.text || 0) + (types.sticker || 0) + (types.media || 0);
    const typeData  = [
        { label: "TEXT",    icon: "»", value: types.text    || 0, color: primary },
        { label: "STICKER", icon: "◈", value: types.sticker || 0, color: "#00CFFF" },
        { label: "MEDIA",   icon: "▣", value: types.media   || 0, color: "#FF4ECD" },
    ];

    const trackX  = 176, trackW = 380, trackH = 9;
    const typeY0  = 448;
    const typeRowH = 28;

    for (let i = 0; i < typeData.length; i++) {
        const td  = typeData[i];
        const ty  = typeY0 + i * typeRowH;
        const pct = typeTotal > 0 ? td.value / typeTotal : 0;

        // Icon + label
        ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.font = `bold 9px ${FNT}`; ctx.fillStyle = td.color;
        ctx.fillText(`${td.icon} ${td.label}`, 36, ty + typeRowH / 2);

        // Track bg
        ctx.fillStyle = "rgba(255,255,255,0.045)";
        ctx.beginPath(); ctx.roundRect(trackX, ty + (typeRowH - trackH) / 2, trackW, trackH, trackH / 2); ctx.fill();

        // Fill
        const fillW = Math.max(pct > 0 ? 8 : 0, pct * trackW);
        if (fillW > 0) {
            const tGrad = ctx.createLinearGradient(trackX, 0, trackX + fillW, 0);
            tGrad.addColorStop(0, td.color); tGrad.addColorStop(1, `${td.color}44`);
            ctx.fillStyle = tGrad; ctx.shadowColor = td.color; ctx.shadowBlur = 7;
            ctx.beginPath(); ctx.roundRect(trackX, ty + (typeRowH - trackH) / 2, fillW, trackH, trackH / 2);
            ctx.fill(); ctx.shadowBlur = 0;
        }

        // % and count
        const pctStr = `${(pct * 100).toFixed(0)}%`;
        ctx.font = `bold 11px ${FNT}`;
        ctx.fillStyle = pct > 0 ? td.color : "rgba(255,255,255,0.2)";
        ctx.textAlign = "left";
        ctx.fillText(pctStr, trackX + trackW + 14, ty + typeRowH / 2);
        ctx.font = `8px ${FNT}`; ctx.fillStyle = "rgba(255,255,255,0.3)";
        ctx.fillText(`(${fmtNum(td.value)})`, trackX + trackW + 50, ty + typeRowH / 2);
    }

    // Footer
    ctx.font = `9px ${FNT}`; ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("GOATBOT  ◈  ACTIVITY CARD", W / 2, H - 10);

    drawCorners(ctx, W, H, primary, 22);
    return canvas;
}

function buildUserCardGIF(baseCanvas, theme, outPath, days, barSlotW, barMaxH, barBase, chartPad) {
    return new Promise((resolve, reject) => {
        const W = baseCanvas.width, H = baseCanvas.height;
        const { primary, rgb } = theme;
        const encoder = new GIFEncoder(W, H);
        const gifOut  = fs.createWriteStream(outPath);
        encoder.createReadStream().pipe(gifOut);
        encoder.start(); encoder.setRepeat(0); encoder.setDelay(60); encoder.setQuality(7);

        const FRAMES = 36;
        const animC  = new Canvas(W, H);
        const actx   = animC.getContext("2d");
        const parts  = spawnParticles(35, W, H);
        const FNT    = "NotoSans, NotoSansBengali, NotoEmoji, sans-serif";
        const maxDay = Math.max(...(days || []).map(d => d.count), 1);

        for (let f = 0; f < FRAMES; f++) {
            const pulse  = Math.sin(f * 0.32);
            const barT   = easeOut(Math.min(f / (FRAMES * 0.65), 1));

            actx.clearRect(0, 0, W, H);
            actx.drawImage(baseCanvas, 0, 0);

            // Particles
            for (const p of parts) {
                const a = 0.05 + 0.14 * Math.abs(Math.sin(p.phase + f * p.speed));
                actx.beginPath(); actx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                actx.fillStyle = `rgba(${rgb},${a})`; actx.fill();
            }

            // Avatar ring pulse
            actx.strokeStyle = primary;
            actx.lineWidth = 2.5 + 1.5 * Math.abs(pulse);
            actx.shadowColor = primary; actx.shadowBlur = 18 + 12 * Math.abs(pulse);
            actx.beginPath(); actx.arc(148, 178, 95 + 3 * Math.abs(pulse), 0, Math.PI * 2);
            actx.stroke(); actx.shadowBlur = 0;

            // Animated bar chart (bars grow from bottom)
            if (days && days.length > 0) {
                for (let i = 0; i < 7; i++) {
                    const d    = days[i];
                    const bx   = chartPad + i * barSlotW;
                    const bCx  = bx + barSlotW / 2;
                    const fullH = d.count > 0 ? Math.max(7, (d.count / maxDay) * barMaxH) : 0;
                    const fill  = fullH * barT;
                    const by   = barBase - fill;

                    if (fill > 0) {
                        const bGrad = actx.createLinearGradient(0, by, 0, barBase);
                        bGrad.addColorStop(0, primary); bGrad.addColorStop(1, `rgba(${rgb},0.2)`);
                        actx.fillStyle = bGrad; actx.shadowColor = primary;
                        actx.shadowBlur = 10 + 4 * Math.abs(pulse);
                        actx.beginPath(); actx.roundRect(bx + 7, by, barSlotW - 14, fill, 4);
                        actx.fill(); actx.shadowBlur = 0;

                        // Top cap
                        actx.fillStyle = "rgba(255,255,255,0.55)";
                        actx.fillRect(bx + 7, by, barSlotW - 14, 2);

                        // Animated count label
                        if (barT > 0.5) {
                            const animCount = Math.round(d.count * ((barT - 0.5) * 2));
                            actx.font = `bold 9px ${FNT}`; actx.fillStyle = primary;
                            actx.textAlign = "center"; actx.textBaseline = "bottom";
                            actx.fillText(fmtNum(animCount), bCx, by - 2);
                        }
                    }
                }
            }

            // Scan line
            const scanY = ((f / FRAMES) * H * 1.6) % H;
            const sg = actx.createLinearGradient(0, scanY - 22, 0, scanY + 22);
            sg.addColorStop(0, "rgba(255,255,255,0)");
            sg.addColorStop(0.5, `rgba(${rgb},0.05)`);
            sg.addColorStop(1, "rgba(255,255,255,0)");
            actx.fillStyle = sg; actx.fillRect(0, scanY - 22, W, 44);

            // Border pulse
            actx.strokeStyle = `rgba(${rgb},${0.32 + 0.24 * Math.abs(pulse)})`;
            actx.lineWidth = 2; actx.shadowColor = primary;
            actx.shadowBlur = 10 + 8 * Math.abs(pulse);
            actx.beginPath(); actx.roundRect(5, 5, W - 10, H - 10, 10);
            actx.stroke(); actx.shadowBlur = 0;

            drawCorners(actx, W, H, primary, 22);
            encoder.addFrame(actx);
        }

        encoder.finish();
        gifOut.on("finish", resolve);
        gifOut.on("error", reject);
    });
}

// ══════════════════════════════════════════════════
//  MODULE EXPORT
// ══════════════════════════════════════════════════
module.exports = {
    config: {
        name:        "count",
        version:     "4.0.0",
        author:      "SIFAT",
        countDown:   10,
        role:        0,
        description: { en: "ᴍᴇꜱꜱᴀɢᴇ ᴄᴏᴜɴᴛ ʟᴇᴀᴅᴇʀʙᴏᴀʀᴅ ᴡɪᴛʜ ᴀɴɪᴍᴀᴛᴇᴅ ᴄᴀʀᴅꜱ" },
        category:    "box chat",
        guide: {
            en:
                "   {pn}             → ʏᴏᴜʀ ᴀᴄᴛɪᴠɪᴛʏ ᴄᴀʀᴅ\n" +
                "   {pn} @ᴛᴀɢ       → ᴛᴀɢɢᴇᴅ ᴜꜱᴇʀ'ꜱ ᴄᴀʀᴅ\n" +
                "   {pn} all        → ꜰᴜʟʟ ʟᴇᴀᴅᴇʀʙᴏᴀʀᴅ\n" +
                "   {pn} all 2      → ᴘᴀɢᴇ 2 ᴏꜰ ʟᴇᴀᴅᴇʀʙᴏᴀʀᴅ\n" +
                "   {pn} top        → ᴛᴇxᴛ ʟɪꜱᴛ ᴛᴏᴘ 5\n" +
                "   {pn} reset      → ʀᴇꜱᴇᴛ (ᴀᴅᴍɪɴ)",
        },
        envConfig: { ACCESS_TOKEN },
    },

    onLoad: async function () {
        const https = require("https");
        fsExtra.mkdirSync(FONT_DIR, { recursive: true });
        fsExtra.mkdirSync(path.resolve(__dirname, "cache"), { recursive: true });
        const fonts = [
            { file: path.join(FONT_DIR, "NotoSans-Bold.ttf"),          url: "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Bold.ttf",              family: "NotoSans",        weight: "bold"   },
            { file: path.join(FONT_DIR, "NotoSans-Regular.ttf"),        url: "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf",            family: "NotoSans",        weight: "normal" },
            { file: path.join(FONT_DIR, "NotoSansBengali-Bold.ttf"),    url: "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSansBengali/NotoSansBengali-Bold.ttf",    family: "NotoSansBengali", weight: "bold"   },
            { file: path.join(FONT_DIR, "NotoSansBengali-Regular.ttf"), url: "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSansBengali/NotoSansBengali-Regular.ttf", family: "NotoSansBengali", weight: "normal" },
            { file: path.join(FONT_DIR, "NotoEmoji-Regular.ttf"),       url: "https://raw.githubusercontent.com/googlefonts/noto-emoji/main/fonts/Noto-COLRv1-noflags.ttf",                          family: "NotoEmoji",       weight: "normal" },
        ];
        const dl = (url, dest) => new Promise((res, rej) => {
            const file = fs.createWriteStream(dest);
            const req  = (u) => {
                https.get(u, (r) => {
                    if (r.statusCode === 301 || r.statusCode === 302) return req(r.headers.location);
                    r.pipe(file);
                    file.on("finish", () => { file.close(); res(); });
                }).on("error", (e) => { try { fs.unlinkSync(dest); } catch {} rej(e); });
            };
            req(url);
        });
        for (const f of fonts) {
            try {
                if (!fs.existsSync(f.file)) await dl(f.url, f.file);
                registerFont(f.file, { family: f.family, weight: f.weight });
            } catch (err) { console.error("[count] font:", err.message); }
        }
    },

    onChat: async function ({ event, threadsData, usersData }) {
        const { threadID, senderID } = event;
        if (!threadID || !senderID) return;

        try {
            const members = await threadsData.get(threadID, "members");
            if (!Array.isArray(members)) return;
            const member = members.find(u => u.userID == senderID);
            if (!member) {
                members.push({ userID: senderID, name: (await usersData.getName(senderID)) || "Facebook User", nickname: null, inGroup: true, count: 1 });
            } else {
                member.count = (member.count || 0) + 1;
            }
            await threadsData.set(threadID, members, "members");
        } catch {}

        try {
            const allData = readActivity();
            if (!allData[threadID]) allData[threadID] = {};
            if (!allData[threadID][senderID])
                allData[threadID][senderID] = { total: 0, types: { text: 0, sticker: 0, media: 0 }, daily: {} };
            const tz    = global.GoatBot?.config?.timeZone || TIMEZONE;
            const u     = allData[threadID][senderID];
            const today = moment().tz(tz).format("YYYY-MM-DD");
            u.total = (u.total || 0) + 1;
            u.daily[today] = (u.daily[today] || 0) + 1;
            const atts = event.attachments || [];
            if (atts.some(a => a.type === "sticker")) u.types.sticker = (u.types.sticker || 0) + 1;
            else if (atts.length > 0) u.types.media = (u.types.media || 0) + 1;
            else u.types.text = (u.types.text || 0) + 1;
            const sorted = Object.keys(u.daily).sort((a, b) => new Date(b) - new Date(a));
            sorted.slice(7).forEach(k => delete u.daily[k]);
            writeActivity(allData);
        } catch {}
    },

    onStart: async function ({ args, threadsData, message, event, api, role }) {
        const { threadID, senderID, mentions, type, messageReply } = event;

        fsExtra.ensureDirSync(path.resolve(__dirname, "cache"));

        const threadData   = await threadsData.get(threadID);
        const allActivity  = readActivity()[threadID] || {};
        let participantIDs;
        try {
            participantIDs = (await api.getThreadInfo(threadID)).participantIDs;
        } catch {
            participantIDs = (threadData.members || []).map(m => m.userID);
        }

        const members      = threadData.members || [];
        const combinedData = members
            .filter(m => participantIDs.includes(m.userID))
            .map(m => ({
                uid:      m.userID,
                name:     m.name || "Facebook User",
                count:    m.count || 0,
                activity: allActivity[m.userID] || { total: m.count || 0, types: { text: 0, sticker: 0, media: 0 }, daily: {} },
            }))
            .sort((a, b) => b.count - a.count)
            .map((u, i) => ({ ...u, rank: i + 1 }));

        if (combinedData.length === 0) return message.reply("📊 ᴀʙʜᴏ ᴋᴏɴᴏ ᴍᴇꜱꜱᴀɢᴇ ᴅᴀᴛᴀ ɴᴇɪ। ᴄʜᴀᴛ ᴋᴏʀᴜɴ!");

        const subCmd = (args[0] || "").toLowerCase();
        const THEMES = [
            { primary: "#FFD700", rgb: "255,215,0"   },
            { primary: "#00CFFF", rgb: "0,207,255"   },
            { primary: "#FF4ECD", rgb: "255,78,205"  },
            { primary: "#00FF88", rgb: "0,255,136"   },
            { primary: "#FF6B35", rgb: "255,107,53"  },
        ];
        const theme = THEMES[Math.floor(Math.random() * THEMES.length)];

        if (subCmd === "reset") {
            if (role < 1) return message.reply("⚠️ ᴀᴅᴍɪɴ ꜱᴀʀᴅᴜ ʀᴇꜱᴇᴛ ᴋᴏʀᴛᴇ ᴘᴀʀʙᴇ।");
            try {
                await threadsData.set(threadID, members.map(m => ({ ...m, count: 0 })), "members");
                const allData = readActivity(); delete allData[threadID]; writeActivity(allData);
                return message.reply("✅ ᴇɪ ɢ্ʀᴜᴘᴇʀ ꜱᴀʙᴀʀ ᴄᴏᴜɴᴛ ʀᴇꜱᴇᴛ ʜᴏʏᴇᴄʜᴇ!");
            } catch (err) { return message.reply("❌ ʀᴇꜱᴇᴛ ꜰᴀɪʟ: " + err.message); }
        }

        if (subCmd === "top") {
            const top5   = combinedData.slice(0, 5);
            const medals = ["🥇","🥈","🥉","4️⃣","5️⃣"];
            const lines  = top5.map((u, i) => `${medals[i]} ${u.name} — ${u.count.toLocaleString()} msgs`);
            return message.reply(`📊 ᴛᴏᴘ ${top5.length} ɪɴ ᴛʜɪꜱ ɢʀᴏᴜᴘ:\n\n${lines.join("\n")}`);
        }

        const wait = await message.reply("⏳ ɢᴇɴᴇʀᴀᴛɪɴɢ...");

        if (subCmd === "all") {
            const PER_PAGE   = 10;
            const rest       = combinedData.slice(3);
            const totalPages = Math.max(1, Math.ceil(rest.length / PER_PAGE));
            const page       = Math.max(1, Math.min(parseInt(args[1]) || 1, totalPages));

            try {
                const usersToLoad = combinedData.slice(0, 3 + PER_PAGE);
                const avatarMap   = await preloadAvatars(usersToLoad, 5, api);
                const baseCanvas  = await buildLeaderboardBase(combinedData, page, totalPages, theme, avatarMap);
                const outPath     = path.resolve(__dirname, "cache", `lb_${threadID}_${Date.now()}.gif`);
                await buildLeaderboardGIF(baseCanvas, theme, outPath, combinedData, page, avatarMap);

                try { if (wait?.messageID) message.unsend(wait.messageID); } catch {}
                message.reply({ body: "", attachment: fs.createReadStream(outPath) }, (err, info) => {
                    try { fs.unlinkSync(outPath); } catch {}
                    if (err) return;
                    if (info?.messageID && totalPages > 1) {
                        global.GoatBot.onReply.set(info.messageID, {
                            commandName: "count", messageID: info.messageID,
                            author: senderID, threadID, type: "leaderboard",
                            page, totalPages,
                        });
                    }
                });
            } catch (err) {
                try { if (wait?.messageID) message.unsend(wait.messageID); } catch {}
                console.error("[count] all:", err);
                return message.reply("❌ ᴇʀʀᴏʀ: " + err.message);
            }
            return;
        }

        let targetUIDs = [];
        if (type === "message_reply" && messageReply?.senderID) targetUIDs = [messageReply.senderID];
        else if (Object.keys(mentions || {}).length > 0) targetUIDs = Object.keys(mentions);
        else targetUIDs = [senderID];

        for (const uid of targetUIDs) {
            const user = combinedData.find(u => u.uid == uid);
            if (!user) { message.reply("❌ ᴇɪ ɢ্ʀᴜᴘᴇ ᴜꜱᴇʀᴇʀ ᴅᴀᴛᴀ ɴᴇɪ।"); continue; }
            try {
                const avatarImg = await getAvatar(uid, user.name, api);
                const baseCanvas = await buildUserCardBase(user, theme, avatarImg);

                // Prepare chart data for GIF animation
                const tz = global.GoatBot?.config?.timeZone || TIMEZONE;
                const dailyData = user.activity?.daily || {};
                const chartDays = [];
                for (let i = 6; i >= 0; i--) {
                    const d   = moment().tz(tz).subtract(i, "days");
                    const key = d.format("YYYY-MM-DD");
                    chartDays.push({ label: d.format("ddd").toUpperCase(), count: dailyData[key] || 0, isToday: i === 0 });
                }
                const chartPad  = 36;
                const chartW2   = 900 - chartPad * 2;
                const barSlotW  = Math.floor(chartW2 / 7);
                const barBase   = 415;
                const barMaxH   = 88;

                const gifPath = path.resolve(__dirname, "cache", `uc_${uid}_${Date.now()}.gif`);
                await buildUserCardGIF(baseCanvas, theme, gifPath, chartDays, barSlotW, barMaxH, barBase, chartPad);

                try { if (wait?.messageID) message.unsend(wait.messageID); } catch {}
                await message.reply({ body: "", attachment: fs.createReadStream(gifPath) });
                setTimeout(() => fs.unlink(gifPath).catch(() => {}), 30_000);
            } catch (err) {
                try { if (wait?.messageID) message.unsend(wait.messageID); } catch {}
                console.error("[count] usercard:", err);
                message.reply("❌ ᴇʀʀᴏʀ: " + err.message);
            }
        }
    },

    onReply: async function ({ event, Reply, message, threadsData, api, role }) {
        if (event.senderID !== Reply.author) return;
        if (Reply.type !== "leaderboard") return;
        const page = parseInt(event.body);
        if (isNaN(page) || page < 1) return message.reply("❌ ᴘᴀɢᴇ ɴᴀᴍʙᴀʀ ᴛʜɪᴋ ɴᴇɪ।");
        if (page > Reply.totalPages) return message.reply(`❌ ᴍᴀᴛ্ʀ ${Reply.totalPages}ᴛɪ ᴘᴀɢᴇ ᴀᴄʜᴇ।`);
        try {
            try { api.unsendMessage(Reply.messageID); } catch {}
            await module.exports.onStart({
                args: [String(page)].concat(["all"]).reverse(),
                threadsData, message,
                event: { ...event, threadID: Reply.threadID, senderID: Reply.author },
                api, role: 0,
            });
        } catch (err) { return message.reply("❌ " + err.message); }
    },
};

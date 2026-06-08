"use strict";

const fs      = require("fs-extra");
const path    = require("path");
const axios   = require("axios");
const { Canvas, loadImage, registerFont } = require("canvas");
const GIFEncoder = require("gifencoder");
const moment  = require("moment-timezone");

const CACHE_DIR = path.resolve(__dirname, "cache");
const FONT_DIR  = path.resolve(__dirname, "cache", "fonts");
const CMD_DATA  = path.resolve(__dirname, "cache", "top_cmd_usage.json");
const TZ        = "Asia/Dhaka";
const UA        = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36";
const FNT       = "NotoSans, NotoSansBengali, NotoEmoji, sans-serif";

fs.ensureDirSync(CACHE_DIR);
fs.ensureDirSync(FONT_DIR);

function readCmdData()  { try { return fs.readJsonSync(CMD_DATA); }  catch { return {}; } }
function writeCmdData(d){ try { fs.writeJsonSync(CMD_DATA, d, { spaces: 2 }); } catch {} }

function fmtShort(n) {
    n = Number(n || 0);
    if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return n.toLocaleString();
}
function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

function spawnStars(count, W, H) {
    return Array.from({ length: count }, () => ({
        x: Math.random() * W, y: Math.random() * H,
        r: 0.3 + Math.random() * 1.4,
        phase: Math.random() * Math.PI * 2,
        speed: 0.04 + Math.random() * 0.08,
    }));
}
function spawnComets(W) {
    return Array.from({ length: 3 }, (_, i) => ({
        x: Math.random() * W, y: 20 + Math.random() * 100,
        len: 70 + Math.random() * 80, speed: 3 + Math.random() * 3.5, offset: i * 14,
    }));
}

// ─── AVATAR ───────────────────────────────────────────────────
async function makeFallback(uid) {
    const c = new Canvas(200, 200);
    const cx = c.getContext("2d");
    const COLS = ["#e74c3c","#3498db","#2ecc71","#f39c12","#9b59b6","#1abc9c","#e67e22","#e91e63"];
    const i = String(uid || "0").split("").reduce((s, ch) => s + ch.charCodeAt(0), 0) % COLS.length;
    const g = cx.createLinearGradient(0, 0, 200, 200);
    g.addColorStop(0, COLS[i]); g.addColorStop(1, COLS[(i + 3) % COLS.length]);
    cx.fillStyle = g; cx.fillRect(0, 0, 200, 200);
    cx.fillStyle = "rgba(0,0,0,0.22)"; cx.fillRect(0, 0, 200, 200);
    cx.fillStyle = "#fff"; cx.font = "bold 90px NotoSans, sans-serif";
    cx.textAlign = "center"; cx.textBaseline = "middle";
    cx.fillText("?", 100, 108);
    return loadImage(c.toBuffer());
}

async function getAvatar(uid, api) {
    if (!uid) return makeFallback(uid);

    
    if (api) {
        try {
            const info = await new Promise((rs, rj) => api.getUserInfo([uid], (e, r) => e ? rj(e) : rs(r)));
            const src  = info?.[uid]?.thumbSrc || info?.[uid]?.profilePicture;
            if (src) {
                const r = await axios.get(src, { responseType: "arraybuffer", timeout: 10000, maxRedirects: 10, headers: { "User-Agent": UA } });
                if ((r.headers["content-type"] || "").includes("image") && r.data?.byteLength > 500)
                    return await loadImage(Buffer.from(r.data));
            }
        } catch {}
    }

    try {
        const meta = await axios.get(`https://graph.facebook.com/${uid}/picture?width=512&height=512&type=square&redirect=false`, { timeout: 8000, headers: { "User-Agent": UA } });
        const cdnUrl = meta?.data?.data?.url;
        if (cdnUrl) {
            const r = await axios.get(cdnUrl, { responseType: "arraybuffer", timeout: 10000, maxRedirects: 10, headers: { "User-Agent": UA } });
            if ((r.headers["content-type"] || "").includes("image") && r.data?.byteLength > 500)
                return await loadImage(Buffer.from(r.data));
        }
    } catch {}
    
    try {
        const r = await axios.get(`https://graph.facebook.com/${uid}/picture?width=200&height=200&type=large`, { responseType: "arraybuffer", timeout: 8000, maxRedirects: 10, headers: { "User-Agent": UA } });
        if ((r.headers["content-type"] || "").includes("image") && r.data?.byteLength > 1000)
            return await loadImage(Buffer.from(r.data));
    } catch {}
    return makeFallback(uid);
}

function drawCircleAvatar(ctx, img, x, y, r) {
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(img, x - r, y - r, r * 2, r * 2); ctx.restore();
}

function drawHexGrid(ctx, W, H, rgb, alpha) {
    const sz = 26;
    ctx.strokeStyle = `rgba(${rgb},${alpha})`; ctx.lineWidth = 0.45;
    for (let row = -1; row < H / (sz * 1.5) + 2; row++) {
        for (let col = -1; col < W / (sz * 1.73) + 2; col++) {
            const ox = row % 2 === 0 ? 0 : sz * 0.866;
            const hx = col * sz * 1.73 + ox, hy = row * sz * 1.5;
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

function drawCorners(ctx, W, H, color, sz = 40) {
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = 3.5; ctx.lineCap = "square";
    ctx.shadowColor = color; ctx.shadowBlur = 18;
    const M = 10;
    for (const [ox, oy, dx, dy] of [[M,M,1,1],[W-M,M,-1,1],[M,H-M,1,-1],[W-M,H-M,-1,-1]]) {
        ctx.beginPath();
        ctx.moveTo(ox, oy + sz * dy); ctx.lineTo(ox, oy); ctx.lineTo(ox + sz * dx, oy);
        ctx.stroke();
    }
    ctx.shadowBlur = 0; ctx.restore();
}

const THEMES = {
    money: { primary: "#FFD700", rgb: "255,215,0",   label: "TOP MONEY",    accent: "#ff9d00", icon: "💰" },
    exp:   { primary: "#00CFFF", rgb: "0,207,255",   label: "TOP EXP",      accent: "#0060ff", icon: "⭐" },
    cmd:   { primary: "#FF4ECD", rgb: "255,78,205",  label: "TOP COMMANDS", accent: "#ff1493", icon: "🔥" },
};

const MEDAL_COLORS = ["#FFD700", "#C0C0C0", "#CD7F32"];
const MEDAL_RGB    = ["255,215,0", "192,192,192", "205,127,50"];
const MEDAL_ICONS  = ["🥇", "🥈", "🥉"];
const RANK_LABELS  = ["1ST", "2ND", "3RD"];


async function buildBaseCanvas(users, theme, topN, api) {
    const W       = 1000;
    const TOP3_H  = 540;
    const ROW_H   = 86;
    const REST    = users.slice(3, topN);
    const H       = TOP3_H + REST.length * ROW_H + 60;

    const canvas = new Canvas(W, H);
    const ctx    = canvas.getContext("2d");
    const { primary, rgb, accent } = theme;

    
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0,   "#030710");
    bg.addColorStop(0.5, "#050c18");
    bg.addColorStop(1,   "#020609");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    
    const rg = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, W * 0.75);
    rg.addColorStop(0, `rgba(${rgb},0.1)`);
    rg.addColorStop(1, "transparent");
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);

    drawHexGrid(ctx, W, H, rgb, 0.036);

    
    const hdrG = ctx.createLinearGradient(0, 0, W, 0);
    hdrG.addColorStop(0, "rgba(0,0,0,0)");
    hdrG.addColorStop(0.15, `rgba(${rgb},0.1)`);
    hdrG.addColorStop(0.85, `rgba(${rgb},0.1)`);
    hdrG.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = hdrG; ctx.fillRect(0, 0, W, 44);
    ctx.strokeStyle = `rgba(${rgb},0.25)`; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(0, 44); ctx.lineTo(W, 44); ctx.stroke();

    
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.font = `18px ${FNT}`; ctx.fillStyle = primary;
    ctx.fillText(theme.icon, 16, 22);


    ctx.textAlign = "center";
    ctx.font = `bold 20px ${FNT}`; ctx.fillStyle = primary;
    ctx.shadowColor = primary; ctx.shadowBlur = 14;
    ctx.fillText(theme.label, W / 2, 22); ctx.shadowBlur = 0;

    
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    ctx.font = `10px ${FNT}`; ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillText(moment().tz(TZ).format("DD MMM YYYY  •  HH:mm"), W - 16, 22);

    
    const podCfg = [
        { idx: 0, x: 500, y: 310, r: 82, podH: 56 },  
        { idx: 1, x: 200, y: 340, r: 66, podH: 38 },  
        { idx: 2, x: 800, y: 340, r: 66, podH: 28 },  
    ];

    for (const { idx, x, y, r, podH } of podCfg) {
        const u  = users[idx];
        if (!u) continue;
        const mc = MEDAL_COLORS[idx];
        const mr = MEDAL_RGB[idx];

        
        const pw = (r + 28) * 2;
        ctx.fillStyle = `rgba(${mr},0.08)`;
        ctx.beginPath(); ctx.roundRect(x - pw / 2, y + r + 14, pw, podH, [4, 4, 0, 0]); ctx.fill();
        ctx.strokeStyle = mc; ctx.lineWidth = 1.2;
        ctx.shadowColor = mc; ctx.shadowBlur = 8;
        ctx.stroke(); ctx.shadowBlur = 0;
        
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.font = `bold ${idx === 0 ? 17 : 14}px ${FNT}`;
        ctx.fillStyle = mc; ctx.shadowColor = mc; ctx.shadowBlur = 6;
        ctx.fillText(RANK_LABELS[idx], x, y + r + 14 + podH / 2); ctx.shadowBlur = 0;

        
        const gPanel = ctx.createRadialGradient(x, y, 0, x, y, r + 40);
        gPanel.addColorStop(0, `rgba(${mr},0.12)`);
        gPanel.addColorStop(1, "transparent");
        ctx.fillStyle = gPanel; ctx.fillRect(x - r - 50, y - r - 50, (r + 50) * 2, (r + 50) * 2);

        
        ctx.strokeStyle = mc; ctx.lineWidth = idx === 0 ? 4 : 3;
        ctx.shadowColor = mc; ctx.shadowBlur = 18;
        ctx.beginPath(); ctx.arc(x, y, r + 5, 0, Math.PI * 2);
        ctx.stroke(); ctx.shadowBlur = 0;

        const av = await getAvatar(u.uid, api);
        drawCircleAvatar(ctx, av, x, y, r);

        
        ctx.fillStyle = mc; ctx.shadowColor = mc; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(x, y - r - 3, 20, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#000";
        ctx.font = `bold 14px ${FNT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(MEDAL_ICONS[idx], x, y - r - 2);

        
        ctx.fillStyle = "#ffffff"; ctx.textBaseline = "top";
        ctx.font = `bold ${idx === 0 ? 22 : 18}px ${FNT}`;
        const maxW  = r * 2.8;
        let name = u.name || "User";
        while (ctx.measureText(name).width > maxW && name.length > 2) name = name.slice(0, -1);
        if (name !== (u.name || "User")) name += "…";
        ctx.shadowColor = "rgba(0,0,0,0.8)"; ctx.shadowBlur = 4;
        ctx.fillText(name, x, y + r + podH + 20); ctx.shadowBlur = 0;

    
        ctx.fillStyle = mc; ctx.shadowColor = mc; ctx.shadowBlur = 10;
        ctx.font = `bold ${idx === 0 ? 26 : 22}px ${FNT}`;
        ctx.fillText(fmtShort(u.value), x, y + r + podH + 48);
        ctx.shadowBlur = 0;

        if (u.valueLabel) {
            ctx.font = `12px ${FNT}`; ctx.fillStyle = "rgba(255,255,255,0.4)";
            ctx.fillText(u.valueLabel, x, y + r + podH + 76);
        }
    }

    
    ctx.strokeStyle = `rgba(${rgb},0.18)`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(30, TOP3_H - 8); ctx.lineTo(W - 30, TOP3_H - 8); ctx.stroke();

    
    const maxVal = users[0]?.value || 1;
    let rowY     = TOP3_H;

    for (let i = 0; i < REST.length; i++) {
        const u    = REST[i];
        const rank = i + 4;

        
        ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.034)" : "rgba(0,0,0,0.2)";
        ctx.beginPath(); ctx.roundRect(20, rowY + 4, W - 40, ROW_H - 8, 8); ctx.fill();

        
        ctx.fillStyle = "rgba(255,255,255,0.28)"; ctx.font = `bold 20px ${FNT}`;
        ctx.textAlign = "right"; ctx.textBaseline = "middle";
        ctx.fillText(`#${rank}`, 68, rowY + ROW_H / 2);

        
        if (!u.noAvatar) {
            const av = await getAvatar(u.uid, api);
            ctx.save();
            ctx.beginPath(); ctx.arc(105, rowY + ROW_H / 2, 28, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(${rgb},0.5)`; ctx.lineWidth = 1.5; ctx.stroke();
            ctx.clip(); ctx.drawImage(av, 77, rowY + ROW_H / 2 - 28, 56, 56); ctx.restore();
        }

    
        ctx.fillStyle = "#ffffff"; ctx.font = `bold 21px ${FNT}`;
        ctx.textAlign = "left"; ctx.textBaseline = "middle";
        const nameX = u.noAvatar ? 80 : 148;
        let rowName = u.name || "User";
        ctx.save();
        while (ctx.measureText(rowName).width > 270 && rowName.length > 2) rowName = rowName.slice(0, -1);
        if (rowName !== (u.name || "User")) rowName += "…";
        ctx.fillText(rowName, nameX, rowY + ROW_H / 2); ctx.restore();

        
        const barX = 450, barW = 360, barH = 10, barY = rowY + ROW_H / 2 - barH / 2;
        const prog = Math.max(0, (u.value / maxVal) * barW);
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        ctx.beginPath(); ctx.roundRect(barX, barY, barW, barH, barH / 2); ctx.fill();
        if (prog > 0) {
            const bGrad = ctx.createLinearGradient(barX, 0, barX + prog, 0);
            bGrad.addColorStop(0, `rgba(${rgb},0.6)`); bGrad.addColorStop(1, primary);
            ctx.fillStyle = bGrad; ctx.shadowColor = primary; ctx.shadowBlur = 7;
            ctx.beginPath(); ctx.roundRect(barX, barY, prog, barH, barH / 2); ctx.fill();
            ctx.shadowBlur = 0;
        }

        
        ctx.fillStyle = primary; ctx.shadowColor = primary; ctx.shadowBlur = 6;
        ctx.font = `bold 20px ${FNT}`; ctx.textAlign = "right"; ctx.textBaseline = "middle";
        ctx.fillText(fmtShort(u.value), W - 28, rowY + ROW_H / 2);
        ctx.shadowBlur = 0;

        rowY += ROW_H;
    }


    ctx.font = `11px ${FNT}`; ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(`GoatBot  ◈  ${moment().tz(TZ).format("DD/MM/YYYY HH:mm")}`, W / 2, H - 20);

    return canvas;
}


function buildAnimatedGIF(baseCanvas, theme, outPath, users, topN) {
    return new Promise((resolve, reject) => {
        const W = baseCanvas.width, H = baseCanvas.height;
        const encoder = new GIFEncoder(W, H);
        const gifOut  = fs.createWriteStream(outPath);
        encoder.createReadStream().pipe(gifOut);
        encoder.start(); encoder.setRepeat(0); encoder.setDelay(55); encoder.setQuality(5);

        const { primary, rgb } = theme;
        const FRAMES  = 48;
        const TOP3_H  = 540;
        const ROW_H   = 86;
        const REST    = users.slice(3, topN);
        const maxVal  = users[0]?.value || 1;

        const podPos  = [
            { x: 500, y: 310, r: 82 },
            { x: 200, y: 340, r: 66 },
            { x: 800, y: 340, r: 66 },
        ];

        const stars   = spawnStars(60, W, H);
        const comets  = spawnComets(W);
        const sparkles = Array.from({ length: 16 }, (_, i) => ({
            angle: (i / 16) * Math.PI * 2,
            dist:  96 + Math.random() * 28,
            r:     1.2 + Math.random() * 2.2,
            speed: 0.06 + Math.random() * 0.07,
            phase: Math.random() * Math.PI * 2,
        }));

        const animC = new Canvas(W, H);
        const actx  = animC.getContext("2d");

        for (let f = 0; f < FRAMES; f++) {
            const t     = easeOut(Math.min(f / (FRAMES * 0.72), 1));
            const pulse = Math.sin(f * 0.30);

            actx.clearRect(0, 0, W, H);
            actx.drawImage(baseCanvas, 0, 0);
            
            for (const s of stars) {
                const a = (0.06 + 0.18 * Math.abs(Math.sin(s.phase + f * s.speed)));
                actx.beginPath(); actx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
                actx.fillStyle = `rgba(${rgb},${a})`; actx.fill();
            }

            
            for (const c of comets) {
                const cx = ((c.x + (f + c.offset) * c.speed) % (W + c.len)) - c.len;
                const grad = actx.createLinearGradient(cx, c.y, cx + c.len, c.y);
                grad.addColorStop(0, "rgba(255,255,255,0)");
                grad.addColorStop(1, `rgba(${rgb},0.5)`);
                actx.fillStyle = grad; actx.fillRect(cx, c.y - 1, c.len, 2);
            }

        
            for (let i = 0; i < Math.min(3, users.length); i++) {
                const { x, y, r } = podPos[i];
                const mc = MEDAL_COLORS[i];
                const ringPulse = 0.45 + 0.45 * Math.abs(Math.sin(f * 0.36 + i * 1.1));
                actx.strokeStyle = `rgba(${MEDAL_RGB[i]},${ringPulse})`;
                actx.lineWidth = i === 0 ? 3.5 + 2 * Math.abs(pulse) : 2.5 + 1.5 * Math.abs(pulse);
                actx.shadowColor = mc; actx.shadowBlur = 18 + 12 * Math.abs(pulse);
                actx.beginPath(); actx.arc(x, y, r + 6 + 4 * Math.abs(pulse), 0, Math.PI * 2);
                actx.stroke(); actx.shadowBlur = 0;

                
                if (i === 0) {
                    for (const sp of sparkles) {
                        const curA = sp.angle + f * sp.speed;
                        const sx   = x + sp.dist * Math.cos(curA);
                        const sy   = y + sp.dist * Math.sin(curA);
                        const sa   = 0.4 + 0.5 * Math.abs(Math.sin(sp.phase + f * 0.18));
                        actx.beginPath(); actx.arc(sx, sy, sp.r, 0, Math.PI * 2);
                        actx.fillStyle = `rgba(${rgb},${sa})`;
                        actx.shadowColor = primary; actx.shadowBlur = 6;
                        actx.fill(); actx.shadowBlur = 0;
                    }
                }

                
                const animVal = Math.round(users[i].value * t);
                actx.fillStyle = "rgba(0,0,0,0.82)";
                const podH = i === 0 ? 56 : i === 1 ? 38 : 28;
                actx.beginPath(); actx.roundRect(x - r - 12, y + r + podH + 36, (r + 12) * 2, 30, 6); actx.fill();
                actx.fillStyle   = mc; actx.shadowColor = mc;
                actx.shadowBlur  = 10 + 6 * Math.abs(pulse);
                actx.font = `bold ${i === 0 ? 26 : 22}px ${FNT}`;
                actx.textAlign = "center"; actx.textBaseline = "middle";
                actx.fillText(fmtShort(animVal), x, y + r + podH + 52); actx.shadowBlur = 0;
            }

            
            let rowY = TOP3_H;
            for (let i = 0; i < REST.length; i++) {
                const u     = REST[i];
                const rowT  = easeOut(Math.max(0, Math.min(1, t - i * 0.035)));
                const barX  = 450, barW = 360, barH = 10, barY = rowY + ROW_H / 2 - barH / 2;
                const prog  = Math.max(0, (u.value / maxVal) * barW * rowT);

                if (prog > 0) {
                    const bGrad = actx.createLinearGradient(barX, 0, barX + prog, 0);
                    bGrad.addColorStop(0, `rgba(${rgb},0.6)`); bGrad.addColorStop(1, primary);
                    actx.fillStyle = bGrad; actx.shadowColor = primary;
                    actx.shadowBlur = 8 + 4 * Math.abs(pulse);
                    actx.beginPath(); actx.roundRect(barX, barY, prog, barH, barH / 2);
                    actx.fill(); actx.shadowBlur = 0;

                    
                    actx.fillStyle = `rgba(${rgb},0.5)`;
                    actx.beginPath(); actx.ellipse(barX + prog, barY + barH / 2, 5, barH / 2, 0, 0, Math.PI * 2);
                    actx.fill();
                }

                
                actx.fillStyle = "rgba(0,0,0,0.82)";
                actx.beginPath(); actx.roundRect(W - 178, rowY + 26, 152, 28, 6); actx.fill();
                actx.fillStyle = primary; actx.shadowColor = primary; actx.shadowBlur = 6;
                actx.font = `bold 20px ${FNT}`; actx.textAlign = "right"; actx.textBaseline = "middle";
                actx.fillText(fmtShort(Math.round(u.value * rowT)), W - 28, rowY + ROW_H / 2);
                actx.shadowBlur = 0;
                rowY += ROW_H;
            }

    
            const scanY = ((f / FRAMES) * H * 2) % H;
            const sg = actx.createLinearGradient(0, scanY - 36, 0, scanY + 36);
            sg.addColorStop(0, "rgba(255,255,255,0)");
            sg.addColorStop(0.5, `rgba(${rgb},0.055)`);
            sg.addColorStop(1, "rgba(255,255,255,0)");
            actx.fillStyle = sg; actx.fillRect(0, scanY - 36, W, 72);

        
            const bA = 0.38 + 0.28 * Math.abs(pulse);
            actx.strokeStyle = `rgba(${rgb},${bA})`; actx.lineWidth = 2.5;
            actx.shadowColor = primary; actx.shadowBlur = 14 + 10 * Math.abs(pulse);
            actx.beginPath(); actx.roundRect(6, 6, W - 12, H - 12, 14); actx.stroke();
            actx.shadowBlur = 0;

            drawCorners(actx, W, H, primary);

            encoder.addFrame(actx);
        }

        encoder.finish();
        gifOut.on("finish", resolve);
        gifOut.on("error", reject);
    });
}


module.exports = {
    config: {
        name:        "top",
        version:     "2.0.0",
        author:      "SIFAT",
        countDown:   10,
        role:        0,
        description: { en: "Animated top leaderboard for money, exp, and commands." },
        category:    "info",
        guide: {
            en:
                "   {pn}         → top 10 money holders\n" +
                "   {pn} exp     → top 15 exp holders\n" +
                "   {pn} cmd     → top 20 most used commands",
        },
    },

    onLoad: async function () {
        const https = require("https");
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
                r.pipe(file); file.on("finish", () => { file.close(); res(); });
            }).on("error", e => { try { require("fs").unlinkSync(dest); } catch {} rej(e); });
            req(url);
        });
        for (const f of fonts) {
            try {
                if (!fs.existsSync(f.file)) await dl(f.url, f.file);
                registerFont(f.file, { family: f.family, weight: f.weight });
            } catch (e) { console.error("[top] font:", e.message); }
        }
    },

    onChat: async function ({ event }) {
        const { body, senderID } = event;
        if (!body || !senderID) return;
        const prefix  = global.GoatBot?.config?.prefix || ".";
        if (!body.startsWith(prefix)) return;
        const cmdName = body.slice(prefix.length).trim().split(/\s+/)[0]?.toLowerCase();
        if (!cmdName || cmdName === "top") return;
        const data = readCmdData();
        data[cmdName] = (data[cmdName] || 0) + 1;
        writeCmdData(data);
    },

    onStart: async function ({ args, message, usersData, api }) {
        const sub  = (args[0] || "").toLowerCase();
        const wait = await message.reply("⏳ Building leaderboard...");

        try {
            let users = [], topN = 10, theme;

            if (sub === "exp") {
                topN = 15; theme = THEMES.exp;
                const all = await usersData.getAll();
                users = all.filter(u => (u.exp || 0) > 0)
                    .sort((a, b) => (b.exp || 0) - (a.exp || 0))
                    .slice(0, topN)
                    .map(u => ({
                        uid: u.userID, name: u.name || "User",
                        value: u.exp || 0,
                        valueLabel: `Level ${Math.floor(Math.sqrt(u.exp || 0) / 5) + 1}`,
                    }));

            } else if (sub === "cmd") {
                topN = 20; theme = THEMES.cmd;
                const data = readCmdData();
                users = Object.entries(data)
                    .map(([cmd, count]) => ({ uid: null, name: `.${cmd}`, value: count, valueLabel: `${count} uses`, noAvatar: true }))
                    .sort((a, b) => b.value - a.value).slice(0, topN);
                if (!users.length) {
                    try { if (wait?.messageID) message.unsend(wait.messageID); } catch {}
                    return message.reply("❌ No command data yet.");
                }

            } else {
                topN = 10; theme = THEMES.money;
                const all = await usersData.getAll();
                users = all.filter(u => (u.money || 0) > 0)
                    .sort((a, b) => (b.money || 0) - (a.money || 0))
                    .slice(0, topN)
                    .map(u => ({
                        uid: u.userID, name: u.name || "User",
                        value: u.money || 0,
                        valueLabel: `$${(u.money || 0).toLocaleString()}`,
                    }));
            }

            if (!users.length) {
                try { if (wait?.messageID) message.unsend(wait.messageID); } catch {}
                return message.reply("❌ No data found.");
            }

            const baseCanvas = await buildBaseCanvas(users, theme, topN, api);
            const gifPath    = path.join(CACHE_DIR, `top_${sub || "money"}_${Date.now()}.gif`);
            await buildAnimatedGIF(baseCanvas, theme, gifPath, users, topN);

            try { if (wait?.messageID) message.unsend(wait.messageID); } catch {}
            const label = sub === "exp" ? "EXP" : sub === "cmd" ? "COMMANDS" : "MONEY";
            await message.reply({ body: `🏆 TOP ${topN} — ${label}`, attachment: fs.createReadStream(gifPath) });
            setTimeout(() => fs.unlink(gifPath).catch(() => {}), 30_000);

        } catch (err) {
            try { if (wait?.messageID) message.unsend(wait.messageID); } catch {}
            console.error("[top] error:", err);
            return message.reply("❌ Error: " + err.message);
        }
    },
};

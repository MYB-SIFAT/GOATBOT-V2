const { createCanvas, loadImage } = require("canvas");
const fs = require("fs-extra");
const path = require("path");
const moment = require("moment-timezone");

const P = {
	RED:    "#ff0040",
	CYAN:   "#00e5ff",
	GREEN:  "#00ff88",
	GOLD:   "#ffd700",
	ORANGE: "#ff8c00",
	PURPLE: "#aa44ff",
	WHITE:  "#e8f8ff",
	DIM:    "#5a8fa8",
	DIMGR:  "#2a4a5a",
	BG:     "#010810",
	CARD:   "#040d1a",
	BORDER: "#0a1e30"
};

const SPY_TIERS = [
	{ label: "BRONZE",   minDep: 0,        color: "#cd7f32" },
	{ label: "SILVER",   minDep: 50000,    color: "#c0c0c0" },
	{ label: "GOLD",     minDep: 500000,   color: "#ffd700" },
	{ label: "PLATINUM", minDep: 2000000,  color: "#e5e4e2" },
	{ label: "DIAMOND",  minDep: 10000000, color: "#b9f2ff" },
	{ label: "ELITE",    minDep: 50000000, color: "#ff00ff" }
];

function getBankTier(totalDep) {
	let t = SPY_TIERS[0];
	for (const tier of SPY_TIERS) { if ((totalDep || 0) >= tier.minDep) t = tier; }
	return t;
}

function sg(ctx, c, b) { ctx.shadowColor = c; ctx.shadowBlur = b; }
function cg(ctx)        { ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; }

function rr(ctx, x, y, w, h, r) {
	ctx.beginPath();
	ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
	ctx.arcTo(x + w, y, x + w, y + r, r); ctx.lineTo(x + w, y + h - r);
	ctx.arcTo(x + w, y + h, x + w - r, y + h, r); ctx.lineTo(x + r, y + h);
	ctx.arcTo(x, y + h, x, y + h - r, r); ctx.lineTo(x, y + r);
	ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
}

function dt(ctx, txt, x, y, opts = {}) {
	const { font = "13px monospace", color = P.WHITE, align = "left", glow = null, glowBlur = 10, alpha = 1, maxW = null } = opts;
	ctx.save(); ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.globalAlpha = alpha;
	if (glow) sg(ctx, glow, glowBlur);
	maxW ? ctx.fillText(String(txt), x, y, maxW) : ctx.fillText(String(txt), x, y);
	if (glow) cg(ctx);
	ctx.restore();
}

function drawGrid(ctx, W, H) {
	ctx.save(); ctx.strokeStyle = "rgba(0,229,255,0.022)"; ctx.lineWidth = 1;
	for (let x = 0; x <= W; x += 38) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
	for (let y = 0; y <= H; y += 38) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
	ctx.restore();
}

function drawScanlines(ctx, W, H) {
	ctx.save(); ctx.fillStyle = "rgba(0,229,255,0.013)";
	for (let y = 0; y < H; y += 5) ctx.fillRect(0, y, W, 1);
	ctx.restore();
}

function drawCorners(ctx, W, H, s, color) {
	ctx.save(); sg(ctx, color, 14); ctx.strokeStyle = color; ctx.lineWidth = 2;
	for (const [cx, cy, dx, dy] of [[0, 0, 1, 1], [W, 0, -1, 1], [0, H, 1, -1], [W, H, -1, -1]]) {
		ctx.beginPath();
		ctx.moveTo(cx + dx * s, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy * s);
		ctx.stroke();
	}
	cg(ctx); ctx.restore();
}

function drawReticle(ctx, cx, cy, r, color) {
	ctx.save();
	sg(ctx, color, 3); ctx.strokeStyle = color + "22"; ctx.lineWidth = 1;
	ctx.beginPath(); ctx.arc(cx, cy, r + 20, 0, Math.PI * 2); ctx.stroke();
	sg(ctx, color, 22); ctx.strokeStyle = color; ctx.lineWidth = 2;
	ctx.beginPath(); ctx.arc(cx, cy, r + 5, 0, Math.PI * 2); ctx.stroke();
	for (let i = 0; i < 8; i++) {
		const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
		const isMain = i % 2 === 0;
		const innerR = r + 5;
		ctx.lineWidth = isMain ? 2 : 1;
		ctx.strokeStyle = isMain ? color : color + "70";
		ctx.beginPath();
		ctx.moveTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
		ctx.lineTo(cx + Math.cos(angle) * (innerR + (isMain ? 14 : 7)), cy + Math.sin(angle) * (innerR + (isMain ? 14 : 7)));
		ctx.stroke();
	}
	const crossLen = 30, crossGap = r + 26;
	ctx.strokeStyle = color + "cc"; ctx.lineWidth = 1.5;
	for (const a of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
		ctx.beginPath();
		ctx.moveTo(cx + Math.cos(a) * crossGap, cy + Math.sin(a) * crossGap);
		ctx.lineTo(cx + Math.cos(a) * (crossGap + crossLen), cy + Math.sin(a) * (crossGap + crossLen));
		ctx.stroke();
	}
	ctx.strokeStyle = color + "88"; ctx.lineWidth = 1;
	ctx.beginPath(); ctx.arc(cx, cy, 11, 0, Math.PI * 2); ctx.stroke();
	sg(ctx, color, 10);
	ctx.fillStyle = color; ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, Math.PI * 2); ctx.fill();
	cg(ctx);
	const bS = 18, bG = r + 28;
	ctx.strokeStyle = color; ctx.lineWidth = 2;
	for (const [dx, dy, ex, ey] of [[-1, -1, bS, bS], [1, -1, -bS, bS], [-1, 1, bS, -bS], [1, 1, -bS, -bS]]) {
		const bx = cx + dx * bG, by = cy + dy * bG;
		ctx.beginPath();
		ctx.moveTo(bx + ex, by); ctx.lineTo(bx, by); ctx.lineTo(bx, by + ey);
		ctx.stroke();
	}
	const dotAs = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
	ctx.fillStyle = color + "66";
	for (const a of dotAs) {
		ctx.beginPath();
		ctx.arc(cx + Math.cos(a) * (r + 15), cy + Math.sin(a) * (r + 15), 2.5, 0, Math.PI * 2);
		ctx.fill();
	}
	cg(ctx); ctx.restore();
}

function getIntelLevel(info) {
	const total = (info.bankBal || 0) + (info.wallet || 0) + (info.netWorth || 0);
	if (total >= 5000000) return { label: "ELITE",   color: "#ff00ff", bar: 5 };
	if (total >= 500000)  return { label: "HIGH",    color: "#ff4400", bar: 4 };
	if (total >= 50000)   return { label: "MEDIUM",  color: "#ff8c00", bar: 3 };
	if (total >= 5000)    return { label: "LOW",     color: "#00e5ff", bar: 2 };
	return                       { label: "MINIMAL", color: "#5a8fa8", bar: 1 };
}

function drawIntelBar(ctx, cx, y, intel) {
	const bW = 130, bH = 9, bX = cx - bW / 2;
	ctx.save();
	rr(ctx, bX, y, bW, bH, bH / 2);
	ctx.fillStyle = "#0a1a24"; ctx.fill();
	rr(ctx, bX, y, Math.floor(bW * (intel.bar / 5)), bH, bH / 2);
	const barG = ctx.createLinearGradient(bX, 0, bX + bW, 0);
	barG.addColorStop(0, intel.color + "aa"); barG.addColorStop(1, intel.color);
	ctx.fillStyle = barG; sg(ctx, intel.color, 8); ctx.fill(); cg(ctx);
	ctx.restore();
	for (let k = 1; k <= 5; k++) {
		const dotX = bX + (k - 0.5) * (bW / 5);
		ctx.save(); ctx.globalAlpha = k <= intel.bar ? 1 : 0.18;
		sg(ctx, intel.color, 8); ctx.fillStyle = intel.color;
		ctx.beginPath(); ctx.arc(dotX, y + bH + 11, 4.5, 0, Math.PI * 2); ctx.fill();
		cg(ctx); ctx.restore();
	}
}

async function drawSpyCard(info, pfpImage) {
	const W = 920, H = 590;
	const canvas = createCanvas(W, H);
	const ctx = canvas.getContext("2d");

	const bgG = ctx.createLinearGradient(0, 0, W, H);
	bgG.addColorStop(0, "#010810"); bgG.addColorStop(0.5, "#020d18"); bgG.addColorStop(1, "#010810");
	ctx.fillStyle = bgG; ctx.fillRect(0, 0, W, H);

	const rgL = ctx.createRadialGradient(60, H / 2, 0, 60, H / 2, 380);
	rgL.addColorStop(0, "rgba(255,0,64,0.08)"); rgL.addColorStop(1, "transparent");
	ctx.fillStyle = rgL; ctx.fillRect(0, 0, W, H);

	const rgR = ctx.createRadialGradient(W - 60, H / 2, 0, W - 60, H / 2, 380);
	rgR.addColorStop(0, "rgba(0,229,255,0.06)"); rgR.addColorStop(1, "transparent");
	ctx.fillStyle = rgR; ctx.fillRect(0, 0, W, H);

	const rgT = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, H * 0.55);
	rgT.addColorStop(0, "rgba(255,0,64,0.04)"); rgT.addColorStop(1, "transparent");
	ctx.fillStyle = rgT; ctx.fillRect(0, 0, W, H);

	drawGrid(ctx, W, H);
	drawScanlines(ctx, W, H);

	ctx.save(); sg(ctx, P.RED, 24); ctx.strokeStyle = P.RED + "66"; ctx.lineWidth = 1.5;
	rr(ctx, 5, 5, W - 10, H - 10, 12); ctx.stroke(); cg(ctx);
	ctx.strokeStyle = "rgba(255,0,64,0.16)"; ctx.lineWidth = 1;
	rr(ctx, 10, 10, W - 20, H - 20, 10); ctx.stroke(); ctx.restore();

	drawCorners(ctx, W, H, 26, P.RED);

	const headH = 60;
	const hg = ctx.createLinearGradient(0, 0, W, headH);
	hg.addColorStop(0, "rgba(255,0,64,0.20)"); hg.addColorStop(0.6, "rgba(255,0,64,0.07)"); hg.addColorStop(1, "transparent");
	ctx.fillStyle = hg; ctx.fillRect(0, 0, W, headH);

	const sepG = ctx.createLinearGradient(0, headH, W, headH);
	sepG.addColorStop(0, P.RED); sepG.addColorStop(0.45, P.CYAN + "88"); sepG.addColorStop(1, "transparent");
	ctx.save(); sg(ctx, P.RED, 10); ctx.strokeStyle = sepG; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.9;
	ctx.beginPath(); ctx.moveTo(14, headH); ctx.lineTo(W - 14, headH); ctx.stroke();
	ctx.globalAlpha = 1; cg(ctx); ctx.restore();

	ctx.save(); sg(ctx, P.RED, 14); ctx.fillStyle = P.RED; ctx.font = "bold 22px monospace"; ctx.textAlign = "left";
	ctx.fillText("◉", 24, 40); cg(ctx); ctx.restore();
	dt(ctx, "PROFILE  SPY", 54, 40, { font: "bold 24px monospace", color: P.WHITE });
	dt(ctx, "M·A·R·I·N  AI  INTEL  v2.0", W - 20, 30, { font: "bold 12px monospace", color: P.CYAN, align: "right", glow: P.CYAN, glowBlur: 8 });
	dt(ctx, moment().tz("Asia/Dhaka").format("DD/MM/YYYY  HH:mm:ss"), W - 20, 50, { font: "10px monospace", color: P.DIM, align: "right" });

	const intel = getIntelLevel(info);
	const PFP_CX = 188, PFP_CY = 310, PFP_R = 108;
	const PFP_X = PFP_CX - PFP_R, PFP_Y = PFP_CY - PFP_R;

	dt(ctx, "TARGET  ACQUIRED", PFP_CX, 82, { font: "bold 10px monospace", color: P.RED, align: "center", glow: P.RED, glowBlur: 8 });

	ctx.save(); sg(ctx, intel.color, 10); ctx.strokeStyle = intel.color + "33"; ctx.lineWidth = 1;
	ctx.beginPath(); ctx.arc(PFP_CX, PFP_CY, PFP_R + 42, 0, Math.PI * 2); ctx.stroke();
	ctx.strokeStyle = intel.color + "18"; ctx.lineWidth = 1;
	ctx.beginPath(); ctx.arc(PFP_CX, PFP_CY, PFP_R + 60, 0, Math.PI * 2); ctx.stroke();
	cg(ctx); ctx.restore();

	drawReticle(ctx, PFP_CX, PFP_CY, PFP_R, P.RED);

	if (pfpImage) {
		ctx.save();
		ctx.beginPath(); ctx.arc(PFP_CX, PFP_CY, PFP_R - 2, 0, Math.PI * 2); ctx.clip();
		ctx.drawImage(pfpImage, PFP_X, PFP_Y, PFP_R * 2, PFP_R * 2);
		ctx.restore();
		ctx.save();
		ctx.beginPath(); ctx.arc(PFP_CX, PFP_CY, PFP_R - 2, 0, Math.PI * 2); ctx.clip();
		ctx.fillStyle = "rgba(255,0,64,0.10)"; ctx.fill();
		ctx.restore();
	} else {
		ctx.save();
		ctx.beginPath(); ctx.arc(PFP_CX, PFP_CY, PFP_R - 2, 0, Math.PI * 2);
		const plG = ctx.createRadialGradient(PFP_CX, PFP_CY, 0, PFP_CX, PFP_CY, PFP_R);
		plG.addColorStop(0, "#1c0508"); plG.addColorStop(1, "#08020a");
		ctx.fillStyle = plG; ctx.fill(); ctx.restore();
		dt(ctx, (info.name || "?")[0].toUpperCase(), PFP_CX, PFP_CY + 32, { font: "bold 94px Arial", color: P.RED + "cc", align: "center", glow: P.RED, glowBlur: 24 });
	}

	const BADGE_Y = PFP_CY + PFP_R + 14;
	ctx.save(); sg(ctx, P.RED, 16); ctx.strokeStyle = P.RED; ctx.lineWidth = 1.5;
	ctx.fillStyle = "rgba(255,0,64,0.14)";
	rr(ctx, PFP_CX - 62, BADGE_Y, 124, 28, 6); ctx.fill();
	rr(ctx, PFP_CX - 62, BADGE_Y, 124, 28, 6); ctx.stroke(); cg(ctx); ctx.restore();
	dt(ctx, "●  LOCKED  ON", PFP_CX, BADGE_Y + 19, { font: "bold 12px monospace", color: P.RED, align: "center", glow: P.RED, glowBlur: 10 });
	dt(ctx, `UID: ${info.uid || "—"}`, PFP_CX, BADGE_Y + 44, { font: "10px monospace", color: P.DIM, align: "center" });

	const iY = BADGE_Y + 62;
	dt(ctx, "INTEL  LEVEL", PFP_CX, iY, { font: "9px monospace", color: P.DIM, align: "center" });
	dt(ctx, intel.label, PFP_CX, iY + 20, { font: "bold 17px monospace", color: intel.color, align: "center", glow: intel.color, glowBlur: 12 });
	drawIntelBar(ctx, PFP_CX, iY + 28, intel);

	const SEP_X = 336;
	ctx.save();
	const sepVG = ctx.createLinearGradient(SEP_X, 68, SEP_X, H - 48);
	sepVG.addColorStop(0, "transparent");
	sepVG.addColorStop(0.12, P.RED + "44");
	sepVG.addColorStop(0.88, P.CYAN + "33");
	sepVG.addColorStop(1, "transparent");
	ctx.strokeStyle = sepVG; ctx.lineWidth = 1;
	ctx.beginPath(); ctx.moveTo(SEP_X, 68); ctx.lineTo(SEP_X, H - 46); ctx.stroke();
	ctx.restore();

	const INFO_X = SEP_X + 22;
	const VAL_X = W - 22;
	const ROW_H = 42;
	const INFO_Y = 72;

	const genderLabel = info.gender === 1 ? "FEMALE" : info.gender === 2 ? "MALE" : "UNKNOWN";
	const genderColor = info.gender === 1 ? "#ff69b4" : info.gender === 2 ? P.CYAN : P.DIM;
	const bankT = info.bankTierObj || null;

	const rows = [
		{ label: "NAME",       value: (info.name || "Unknown").slice(0, 36),                                          lc: P.RED,  vc: P.WHITE,  bold: true  },
		{ label: "USER ID",    value: String(info.uid || "—"),                                                         lc: P.CYAN, vc: P.CYAN,   bold: false },
		{ label: "GENDER",     value: genderLabel,                                                                     lc: P.RED,  vc: genderColor, bold: false },
		{ label: "IS FRIEND",  value: info.isFriend ? "YES" : "NO",                                                    lc: P.CYAN, vc: info.isFriend ? P.GREEN : P.RED, bold: false },
		{ label: "VANITY",     value: info.vanity ? `/${info.vanity}` : "—",                                           lc: P.RED,  vc: P.DIM,    bold: false },
		{ label: "WALLET",     value: info.wallet !== null ? `$${Number(info.wallet || 0).toLocaleString()}` : "—",    lc: P.CYAN, vc: P.GOLD,   bold: false },
		{ label: "BANK BAL",   value: info.bankBal !== null ? `$${Number(info.bankBal || 0).toLocaleString()}` : "—",  lc: P.RED,  vc: P.GOLD,   bold: false },
		{ label: "BANK ACC",   value: info.accountNumber || "NOT REGISTERED",                                          lc: P.CYAN, vc: info.accountNumber ? P.GREEN : P.DIM, bold: false },
		{ label: "BANK TIER",  value: bankT ? bankT.label : (info.accountNumber ? "BRONZE" : "—"),                    lc: P.RED,  vc: bankT ? bankT.color : P.DIM, bold: false },
		{ label: "NET WORTH",  value: info.netWorth !== null ? `$${Number(info.netWorth || 0).toLocaleString()}` : "—", lc: P.CYAN, vc: P.GOLD,   bold: false },
		{ label: "SCANNED",    value: moment().tz("Asia/Dhaka").format("DD/MM/YYYY HH:mm:ss"),                         lc: P.RED,  vc: P.DIM,    bold: false }
	];

	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		const ry = INFO_Y + i * ROW_H;
		const midY = ry + ROW_H / 2;
		if (i % 2 === 0) {
			ctx.save(); ctx.fillStyle = "rgba(255,0,64,0.03)";
			ctx.fillRect(SEP_X + 10, ry + 2, W - SEP_X - 18, ROW_H - 4); ctx.restore();
		}
		ctx.save(); sg(ctx, row.lc, 7); ctx.strokeStyle = row.lc; ctx.lineWidth = 1.5;
		ctx.beginPath(); ctx.arc(INFO_X + 6, midY, 4.5, 0, Math.PI * 2); ctx.stroke(); cg(ctx); ctx.restore();
		dt(ctx, row.label, INFO_X + 18, midY + 5, { font: "bold 12px monospace", color: row.lc, glow: row.lc, glowBlur: 5 });
		dt(ctx, "▶", INFO_X + 110, midY + 4, { font: "11px monospace", color: "rgba(80,140,160,0.5)" });
		dt(ctx, String(row.value), INFO_X + 130, midY + 5, { font: row.bold ? "bold 14px monospace" : "12px monospace", color: row.vc, maxW: VAL_X - INFO_X - 130 });
		if (i < rows.length - 1) {
			ctx.save(); ctx.strokeStyle = "rgba(255,0,64,0.10)"; ctx.lineWidth = 1;
			ctx.beginPath(); ctx.moveTo(INFO_X, ry + ROW_H); ctx.lineTo(W - 16, ry + ROW_H); ctx.stroke(); ctx.restore();
		}
	}

	const BOT_Y = H - 46;
	const botG = ctx.createLinearGradient(14, BOT_Y, W - 14, BOT_Y);
	botG.addColorStop(0, P.RED); botG.addColorStop(0.45, P.CYAN + "66"); botG.addColorStop(1, "transparent");
	ctx.save(); sg(ctx, P.RED, 10); ctx.strokeStyle = botG; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.85;
	ctx.beginPath(); ctx.moveTo(14, BOT_Y); ctx.lineTo(W - 14, BOT_Y); ctx.stroke(); ctx.globalAlpha = 1; cg(ctx); ctx.restore();
	dt(ctx, "SCAN  COMPLETE  —  DATA  EXTRACTED  —  M·A·R·I·N  AI  INTELLIGENCE  SYSTEM", W / 2, H - 18, { font: "bold 11px monospace", color: P.RED + "cc", align: "center", glow: P.RED, glowBlur: 10 });

	return canvas;
}

async function sendCanvas(message, canvas) {
	const tmpDir = path.join(__dirname, "tmp");
	await fs.ensureDir(tmpDir);
	const tmpPath = path.join(tmpDir, `spy_${Date.now()}.png`);
	await fs.writeFile(tmpPath, canvas.toBuffer("image/png"));
	try {
		await message.reply({ attachment: fs.createReadStream(tmpPath) });
	} finally {
		setTimeout(() => fs.remove(tmpPath).catch(() => {}), 60000);
	}
}

module.exports = {
	config: {
		name: "spy",
		aliases: ["userinfo", "info", "whois"],
		version: "2.0.0",
		author: "SIFAT",
		countDown: 8,
		role: 0,
		description: { en: "ꜱᴘʏ ᴏɴ ᴜꜱᴇʀ ᴘʀᴏꜰɪʟᴇ ᴡɪᴛʜ ɪɴᴛᴇʟ ᴄᴀʀᴅ" },
		category: "info",
		guide: { en: "{pn} @ᴜꜱᴇʀ | ʀᴇᴘʟʏ | {pn} <ᴜɪᴅ>" }
	},

	onStart: async function ({ args, message, event, api, usersData }) {
		let targetID;
		const mentions = Object.keys(event.mentions || {});
		if (mentions.length > 0)                                          targetID = mentions[0];
		else if (event.type === "message_reply" && event.messageReply?.senderID) targetID = event.messageReply.senderID;
		else if (args[0] && /^\d{10,}$/.test(args[0]))                    targetID = args[0];
		else                                                               targetID = event.senderID;

		let fbInfo = {};
		try { const res = await api.getUserInfo(targetID); fbInfo = res[targetID] || {}; } catch {}

		let ud = null;
		try { ud = await usersData.get(targetID); } catch {}

		const bank = ud?.data?.bank;
		const netWorth = bank?.isRegistered
			? (bank.balance || 0) + (bank.savings || 0) + (bank.investment && !bank.investment.collected ? bank.investment.amount || 0 : 0)
			: null;
		const bankTierObj = bank?.isRegistered ? getBankTier(bank.totalDeposited || 0) : null;

		const info = {
			name:          fbInfo.name || ud?.name || "Unknown",
			uid:           targetID,
			gender:        fbInfo.gender,
			isFriend:      fbInfo.isFriend || false,
			vanity:        fbInfo.vanity || null,
			wallet:        ud?.money ?? null,
			bankBal:       bank?.isRegistered ? (bank.balance || 0) : null,
			accountNumber: bank?.isRegistered ? bank.accountNumber : null,
			bankTierObj,
			netWorth
		};

		let pfpImage = null;
		for (const url of [`https://graph.facebook.com/${targetID}/picture?width=512&height=512&type=large`, fbInfo.thumbSrc].filter(Boolean)) {
			try { pfpImage = await loadImage(url); break; } catch {}
		}

		const canvas = await drawSpyCard(info, pfpImage);
		await sendCanvas(message, canvas);
	}
};

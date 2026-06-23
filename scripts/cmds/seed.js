"use strict";

const axios = require("axios");
const fs    = require("fs-extra");
const path  = require("path");

const HOKKER_SIFAT_CUDTESE  = "https://raw.githubusercontent.com/MYB-SIFAT/SIFATChudtese/refs/heads/main/sifatapichudtese.json";
const HOKKER_SIFAT_CACHE    = path.join(__dirname, "..", "..", "cache");
const HOKKER_SIFAT_UA       = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36";
const HOKKER_SIFAT_TIMEOUT  = 300000;
const HOKKER_SIFAT_DL_TOUT  = 120000;

let HOKKER_SIFAT_API = null;

async function hokkerSifatLoadApi() {
    if (HOKKER_SIFAT_API) return HOKKER_SIFAT_API;
    const res = await axios.get(HOKKER_SIFAT_CUDTESE, {
        timeout: 10000,
        headers: { "User-Agent": HOKKER_SIFAT_UA },
    });
    const raw = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    HOKKER_SIFAT_API = JSON.parse(raw.replace(/,\s*([}\]])/g, "$1"));
    return HOKKER_SIFAT_API;
}

async function hokkerSifatBase(key) {
    const api  = await hokkerSifatLoadApi();
    const base = (api[key] || "").replace(/\/+$/, "");
    if (!base) throw new Error(`HOKKER_SIFAT key "${key}" not found`);
    return base;
}

function hokkerSifatReact(ctx, emoji) {
    try { ctx?.api?.setMessageReaction?.(emoji, ctx?.event?.messageID, () => {}, true); } catch {}
}

async function hokkerSifatDownload(url, savePath) {
    const r = await axios.get(url, {
        responseType: "stream",
        timeout: HOKKER_SIFAT_DL_TOUT,
        headers: { "User-Agent": HOKKER_SIFAT_UA },
        validateStatus: s => s >= 200 && s < 300,
    });
    const tmp = savePath + ".part";
    await new Promise((res, rej) => {
        const w = fs.createWriteStream(tmp);
        r.data.pipe(w);
        w.on("finish", res);
        w.on("error", e => { try { w.destroy(); } catch {} rej(e); });
        r.data.on("error", rej);
    });
    await fs.move(tmp, savePath, { overwrite: true });
    return { path: savePath, size: fs.statSync(savePath).size };
}

fs.ensureDirSync(HOKKER_SIFAT_CACHE);

module.exports = {
    config: {
        name:             "seedance",
        aliases:          ["seed","texttovideo"],
        version:          "1.0.0",
        author:           "SIFAT",
        countDown:        30,
        role:             0,
        shortDescription: { en: "Seedance 2.0 — AI text-to-video generation" },
        longDescription:  { en: "Generate short AI videos from text prompts using Seedance 2.0 via HOKKER_SIFAT API. Generation takes 60–180 seconds." },
        category:         "AI",
        guide:            { en: "   {pn} <prompt>\n   Example: {pn} a butterfly flying over flowers in slow motion" },
    },

    onStart: async function ({ api, event, args, message }) {
        const ctx    = { api, event };
        const prompt = args.join(" ").trim();

        if (!prompt) {
            hokkerSifatReact(ctx, "❌");
            return message.reply("❌ Prompt must be provided.\nExample: seedance a cat walking on moon");
        }

        hokkerSifatReact(ctx, "⏳");

        try {
            const base = await hokkerSifatBase("veocdi");

            const res = await axios.post(
                `${base}/api/seedance`,
                { prompt },
                {
                    timeout: HOKKER_SIFAT_TIMEOUT,
                    headers: {
                        "User-Agent":   HOKKER_SIFAT_UA,
                        "Content-Type": "application/json",
                    },
                }
            );

            const videos = res.data?.data?.videos;
            if (!videos?.length) throw new Error("No video generated");

            hokkerSifatReact(ctx, "📥");

            for (let i = 0; i < videos.length; i++) {
                const fname = `hokker_sifat_seed_${Date.now()}_${i}.mp4`;
                const fpath = path.join(HOKKER_SIFAT_CACHE, fname);

                await hokkerSifatDownload(videos[i], fpath);

                hokkerSifatReact(ctx, "✅");
                await message.reply({ body: "", attachment: fs.createReadStream(fpath) });
                setTimeout(() => fs.unlink(fpath).catch(() => {}), 60_000);
            }

        } catch (err) {
            hokkerSifatReact(ctx, "❌");
            const msg = err?.response?.data?.error || err?.message || "Unknown error";

            if (msg.includes("Limit Reached") || msg.includes("maximum allowance")) {
                return message.reply("⚠️ Rate limit reached. Free quota used. Please try again later.");
            }

            return message.reply(`❌ ${msg}`);
        }
    },
};

"use strict";

const path = require("path");
const fs   = require("fs-extra");
const api  = require("./lib/sifu-api");

const VALID_QUALITIES = ["240", "360", "480", "720", "1080"];
const DEFAULT_QUALITY = "480";
const FALLBACK_LADDER = ["480", "360", "240"];

module.exports = {
    config: {
        name:        "ytb",
        aliases:     ["yt", "youtube", "ytvideo", "ytsearch"],
        version:     "1.0.0",
        author:      "SIFAT",
        category:    "media",
        role:        0,
        countDown:   8,
        description: { en: "Search & download any YouTube video. Supports search, URL, quality picker, auto-fallback." },
        guide:       { en: "{pn} [query | URL] [-q 240|360|480|720|1080] [-list]\n{pn} pick <n>" },
    },

    onStart: async function ({ args, event, message, api: botApi }) {
        return module.exports._run({
            args: args || [],
            ctx:  {
                reply: message.reply.bind(message),
                event,
                api:   botApi,
            },
        });
    }, 

    _run: async function ({ args, ctx }) {
        const event = ctx.event || {};

        let mode = "search", quality = DEFAULT_QUALITY, query = "", pickNum = null;
        const rest = [];
        for (let i = 0; i < args.length; i++) {
            const a = args[i].toLowerCase();
            if (a === "-h" || a === "--help" || a === "help") { mode = "help"; break; }
            if (a === "-list" || a === "--list" || a === "list") { mode = "list"; continue; }
            if ((a === "pick" || a === "-pick") && args[i + 1]) {
                const n = parseInt(args[i + 1], 10);
                if (!isNaN(n)) { mode = "pick"; pickNum = n; i++; continue; }
            }
            if ((a === "-q" || a === "--quality") && VALID_QUALITIES.includes(args[i + 1])) {
                quality = args[i + 1]; i++; continue;
            }
            rest.push(args[i]);
        }
        query = rest.join(" ").trim();

        if (mode === "help") {
            return api.safeReply(ctx, [
                "📺 ʏᴛʙ — ʜᴇʟᴘ",
                "━━━━━━━━━━━━━━━━━━━━",
                "ytb <query>             → ꜱᴇᴀʀᴄʜ ᴀɴᴅ ᴅᴏᴡɴʟᴏᴀᴅ",
                "ytb <YouTube URL>       → ᴅɪʀᴇᴄᴛ ᴅᴏᴡɴʟᴏᴀᴅ",
                "ytb <query> -list       → ᴛᴏᴘ 6 ʀᴇꜱᴜʟᴛꜱ",
                "ytb pick <n>            → ᴅᴏᴡɴʟᴏᴀᴅ #ɴ ꜰʀᴏᴍ ʟɪꜱᴛ",
                "ytb -q 240|360|480|720|1080",
                "",
                "ᴡᴏʀᴋꜱ ꜰᴏʀ: ᴀɴɪᴍᴇ · ᴄᴀʀᴛᴏᴏɴ · ꜱᴏɴɢ · ꜱʜᴏʀᴛꜱ · ᴀɴʏᴛʜɪɴɢ",
                "ᴀᴜᴛᴏ-ꜰᴀʟʟʙᴀᴄᴋ ɪꜰ ꜰɪʟᴇ ɪꜱ ᴛᴏᴏ ʟᴀʀɢᴇ ꜰᴏʀ Messenger.",
            ].join("\n"));
        }

        if (!query && mode === "search") {
            return api.safeReply(ctx, [
                "⚠️ ᴀ ꜱᴇᴀʀᴄʜ ǫᴜᴇʀʏ ᴏʀ YouTube ʟɪɴᴋ ɪꜱ ʀᴇQᴜɪʀᴇᴅ.",
                "",
                "ᴇxᴀᴍᴘʟᴇꜱ:",
                "  ytb funny cats",
                "  ytb naruto vs sasuke -q 720",
                "  ytb https://youtu.be/xxxxx",
                "  ytb tom and jerry -list",
                "  ytb -h",
            ].join("\n"));
        }

        let progressId = null;
        const sendProgress = async (text) => {
            try {
                const m = await api.safeReply(ctx, text);
                if (m?.messageID) progressId = m.messageID;
            } catch (_) {}
        };
        const delProgress = () => { api.safeUnsend(ctx, progressId); progressId = null; };

        try {
            await api.pruneCache();
            let videoUrl, videoTitle, videoUploader, videoDuration;

            if (mode === "pick") {
                const recalled = api.recallSearch("ytb", ctx);
                if (!recalled) {
                    return api.safeReply(ctx, "❌ ɴᴏ ᴀᴄᴛɪᴠᴇ ʟɪꜱᴛ ꜰᴏᴜɴᴅ.\nRun:  ytb <query> -list  first.");
                }
                const idx = pickNum - 1;
                if (idx < 0 || idx >= recalled.results.length) {
                    return api.safeReply(ctx, `❌ ɪɴᴠᴀʟɪᴅ ɴᴜᴍʙᴇʀ. ᴄʜᴏᴏꜱᴇ 1–${recalled.results.length}.`);
                }
                const pick = recalled.results[idx];
                videoUrl      = api.normalizeYouTubeUrl(pick.url);
                videoTitle    = pick.title;
                videoUploader = pick.uploader;
                videoDuration = pick.duration;
                api.clearPicker("ytb", ctx);
                api.safeReact(ctx, "📥");
                await sendProgress(
                    `📥 ᴅᴏᴡɴʟᴏᴀᴅɪɴɢ ᴠɪᴅᴇᴏ...\n\n📺 ${videoTitle}\n📊 ǫᴜᴀʟɪᴛʏ: ${quality}ᴘ\n⏳ ᴘʟᴇᴀꜱᴇ ᴡᴀɪᴛ...`,
                );

            } else if (mode === "list") {
                api.safeReact(ctx, "🔍");
                await sendProgress(`🔍 ꜱᴇᴀʀᴄʜɪɴɢ YouTube...\n"${query}"\n⏳ ᴘʟᴇᴀꜱᴇ ᴡᴀɪᴛ...`);

                const imgPath   = path.join(api.config.CACHE_DIR, `ytb_list_${Date.now()}.png`);
                const imgResult = await api.downloadSearchImage(
                    "/api/video/search-image",
                    { q: query, limit: 6, cmd: "ytb pick <1-6>" },
                    imgPath,
                );
                delProgress();
                if (!imgResult.results?.length) {
                    api.safeReact(ctx, "❌");
                    return api.safeReply(ctx, `❌ ɴᴏ ʀᴇꜱᴜʟᴛꜱ ꜰᴏᴜɴᴅ ꜰᴏʀ "${query}".`);
                }
                api.rememberSearch("ytb", ctx, imgResult.results, "video");
                api.safeReact(ctx, "✅");
                await api.safeReply(ctx, { attachment: fs.createReadStream(imgResult.path) });
                setTimeout(() => fs.unlink(imgResult.path).catch(() => {}), 12_000);
                return;

            } else {
                if (api.isYouTubeUrl(query)) {
                    videoUrl = api.normalizeYouTubeUrl(query);
                    api.safeReact(ctx, "📥");
                    await sendProgress(
                        `📥 ꜰᴇᴛᴄʜɪɴɢ ᴠɪᴅᴇᴏ ꜰʀᴏᴍ ʟɪɴᴋ...\n📊 ǫᴜᴀʟɪᴛʏ: ${quality}ᴘ\n⏳ ᴘʟᴇᴀꜱᴇ ᴡᴀɪᴛ...`,
                    );
                } else {
                    api.safeReact(ctx, "🔍");
                    await sendProgress(`🔍 ꜱᴇᴀʀᴄʜɪɴɢ YouTube...\n"${query}"\n⏳ ᴘʟᴇᴀꜱᴇ ᴡᴀɪᴛ...`);

                    const data    = await api.httpGetJson("/api/video/search", { q: query, limit: 1 });
                    const results = data?.results || [];
                    if (!results.length || !results[0].url) {
                        delProgress();
                        api.safeReact(ctx, "❌");
                        return api.safeReply(ctx, `❌ ɴᴏ ʀᴇꜱᴜʟᴛ ꜰᴏᴜɴᴅ ꜰᴏʀ "${query}". ᴛʀʏ ᴀ ᴅɪꜰꜰᴇʀᴇɴᴛ ǫᴜᴇʀʏ.`);
                    }
                    const top     = results[0];
                    videoUrl      = api.normalizeYouTubeUrl(top.url);
                    videoTitle    = top.title;
                    videoUploader = top.uploader;
                    videoDuration = top.duration;
                    delProgress();
                    api.safeReact(ctx, "📥");
                    await sendProgress(
                        `📥 ᴅᴏᴡɴʟᴏᴀᴅɪɴɢ ᴠɪᴅᴇᴏ...\n\n📺 ${videoTitle}\n` +
                        `👤 ${videoUploader || "?"}\n📊 ǫᴜᴀʟɪᴛʏ: ${quality}ᴘ\n⏳ ᴘʟᴇᴀꜱᴇ ᴡᴀɪᴛ...`,
                    );
                }
            }

            if (!videoTitle && videoUrl) {
                try {
                    const info = await api.getInfo(videoUrl);
                    videoTitle    = info.title;
                    videoUploader = info.uploader;
                    videoDuration = info.duration;
                } catch (_) {}
            }

            const reqIdx = VALID_QUALITIES.indexOf(quality);
            const ladder = [
                quality,
                ...FALLBACK_LADDER.filter(q => {
                    const i = VALID_QUALITIES.indexOf(q);
                    return i !== -1 && i < reqIdx;
                }),
            ];
            const videoId = api.extractVideoId(videoUrl);

            let finalResult = null, finalQuality = quality, wasCached = false, finalElapsed = 0;

            for (let i = 0; i < ladder.length; i++) {
                const tryQ   = ladder[i];
                let   result = videoId ? await api.cacheLookup(videoId, `ytb_${tryQ}`, "mp4") : null;
                const cached = !!result;

                if (!result) {
                    const targetPath = videoId
                        ? api.cacheFilenameFor(videoId, `ytb_${tryQ}`, "mp4")
                        : path.join(api.config.CACHE_DIR, `tmp_ytb_${Date.now()}.mp4`);
                    try {
                        const dl = await api.downloadToDisk(
                            "/api/video/download",
                            { url: videoUrl, quality: tryQ },
                            targetPath,
                        );
                        result       = { path: dl.path, size: dl.size };
                        finalElapsed = dl.elapsedMs;
                    } catch (err) {
                        if (i === ladder.length - 1) throw err;
                        continue;
                    }
                }

                if (result.size < 1024) {
                    await fs.unlink(result.path).catch(() => {});
                    if (i === ladder.length - 1) {
                        delProgress();
                        api.safeReact(ctx, "❌");
                        return api.safeReply(ctx, "❌ ᴅᴏᴡɴʟᴏᴀᴅ ꜰᴀɪʟᴇᴅ — ᴇᴍᴘᴛʏ ꜰɪʟᴇ.");
                    }
                    continue;
                }

                const sizeMB = result.size / (1024 * 1024);
                if (sizeMB <= api.config.MAX_FILE_MB) {
                    finalResult = result; finalQuality = tryQ; wasCached = cached; break;
                }
                if (i < ladder.length - 1) {
                    delProgress();
                    await sendProgress(
                        `⚠️ ${tryQ}ᴘ = ${sizeMB.toFixed(1)} ᴍʙ — ᴇxᴄᴇᴇᴅꜱ Messenger ʟɪᴍɪᴛ.\n` +
                        `↘ ᴛʀʏɪɴɢ ${ladder[i + 1]}ᴘ...`,
                    );
                }
            }

            delProgress();

            if (!finalResult) {
                api.safeReact(ctx, "❌");
                return api.safeReply(ctx,
                    `❌ ᴀʟʟ ǫᴜᴀʟɪᴛɪᴇꜱ ᴇxᴄᴇᴇᴅ Messenger ʟɪᴍɪᴛ (${api.config.MAX_FILE_MB} ᴍʙ).\n` +
                    `ᴛʀʏ ᴀ ꜱʜᴏʀᴛᴇʀ ᴠɪᴅᴇᴏ ᴏʀ ᴜꜱᴇ -q 360`,
                );
            }

            const fellBack = finalQuality !== quality;
            api.safeReact(ctx, "✅");
            await api.safeReply(ctx, {
                body: [
                    "📺 ᴠɪᴅᴇᴏ ᴅᴏᴡɴʟᴏᴀᴅᴇᴅ",
                    "━━━━━━━━━━━━━━━━━━━━",
                    `📺 ᴛɪᴛʟᴇ    : ${videoTitle || "?"}`,
                    videoUploader ? `👤 ᴄʜᴀɴɴᴇʟ   : ${videoUploader}` : null,
                    videoDuration ? `⏱ ᴅᴜʀᴀᴛɪᴏɴ  : ${api.formatDuration(videoDuration)}` : null,
                    `📊 ǫᴜᴀʟɪᴛʏ  : ${finalQuality}ᴘ${fellBack ? ` (ꜰᴀʟʟʙᴀᴄᴋ ꜰʀᴏᴍ ${quality}ᴘ)` : ""}`,
                    `🔊 ᴀᴜᴅɪᴏ    : ✅ ɪɴᴄʟᴜᴅᴇᴅ`,
                    `📦 ꜱɪᴢᴇ     : ${api.formatBytes(finalResult.size)}`,
                    wasCached
                        ? `⚡ ꜱᴏᴜʀᴄᴇ   : ᴄᴀᴄʜᴇ ʜɪᴛ ⚡`
                        : `⚡ ᴛɪᴍᴇ     : ${api.formatElapsed(finalElapsed)}`,
                ].filter(Boolean).join("\n"),
                attachment: fs.createReadStream(finalResult.path),
            });

        } catch (err) {
            delProgress();
            api.safeReact(ctx, "❌");
            console.error("[ytb] error:", err.message);
            return api.safeReply(ctx, api.formatError(err));
        }
    },
};

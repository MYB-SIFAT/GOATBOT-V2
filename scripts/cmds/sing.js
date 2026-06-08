"use strict";

const path = require("path");
const fs   = require("fs-extra");
const api  = require("./lib/sifu-api");

const VALID_QUALITIES = ["128", "192", "320"];
const DEFAULT_QUALITY = "320";
const FAST_MODE       = process.env.SIFU_MP3_FAST !== "0";

module.exports = {
    config: {
        name:        "sing",
        aliases:     ["mp3", "song", "music", "audio"],
        version:     "1.1.0",
        author:      "SIFAT",
        category:    "media",
        role:        0,
        countDown:   4,
        description: { en: "Search & download MP3 from YouTube. Supports search, direct URL, pick list, quality." },
        guide:       { en: "{pn} [song name | URL] [-q 128|192|320] [-list]\n{pn} pick <n>" },
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

    onReply: async function ({ event, Reply, message, api: botApi }) {
        if (event.senderID !== Reply.author) return;

        const num = parseInt(event.body?.trim());
        if (isNaN(num) || num < 1 || num > Reply.results.length) {
            return message.reply(`❌ ꜱʜᴜᴅʜᴜ 1 ᴛʜᴇᴋᴇ ${Reply.results.length} ᴇʀ ᴍᴀᴅʜʏᴇ ꜱᴏɴᴋʜʏᴀ ᴅᴀᴏ।`);
        }

        try { botApi.unsendMessage(Reply.messageID); } catch {}
        global.GoatBot.onReply.delete(Reply.messageID);

        const pick    = Reply.results[num - 1];
        const quality = Reply.quality || "320";
        const ctx     = { reply: message.reply.bind(message), event, api: botApi };

        return module.exports._run({
            args: ["pick", String(num), "-q", quality],
            ctx,
            _directPick: { pick, quality },
        });
    },

    _run: async function ({ args, ctx, _directPick }) {
        const event  = ctx.event || {};
        const userId = event.senderID || event.userID || null;
        const parsed = api.parseArgs(args, VALID_QUALITIES, DEFAULT_QUALITY);

        if (parsed.mode === "help") {
            return api.safeReply(ctx, [
                "🎵 sɪɴɢ — ʜᴇʟᴘ",
                "━━━━━━━━━━━━━━━━━━━━",
                "sing <song name>",
                "sing <YouTube URL>",
                "sing <query> -q 128|192|320",
                "sing <query> -list",
                "sing pick <n>",
                "sing -h  →  this help",
                "",
                "ǫᴜᴀʟɪᴛɪᴇꜱ: 128 | 192 | 320 ᴋʙᴘꜱ (ᴅᴇꜰ: 320)",
                `ꜰᴀꜱᴛ ᴍᴏᴅᴇ: ${FAST_MODE ? "ON (AAC stream)" : "OFF (true MP3)"}`,
                "ᴄᴀᴄʜᴇ: ʀᴇᴘᴇᴀᴛ ʀᴇQᴜᴇꜱᴛꜱ ꜱᴇʀᴠᴇᴅ ɪɴꜱᴛᴀɴᴛʟʏ.",
            ].join("\n"));
        }

        if (parsed.mode === "list") {
            if (!parsed.query) {
                return api.safeReply(ctx, "⚠️ ᴘʀᴏᴠɪᴅᴇ ᴀ ꜱᴇᴀʀᴄʜ ǫᴜᴇʀʏ.\nExample: sing Zara zara -list");
            }

            api.safeReact(ctx, "🔍");
            let progressId = null;
            try {
                const m = await api.safeReply(ctx, `🔍 ꜱᴇᴀʀᴄʜɪɴɢ...\n"${parsed.query}"\n⏳ ᴘʟᴇᴀꜱᴇ ᴡᴀɪᴛ...`);
                if (m?.messageID) progressId = m.messageID;

                const imgPath   = path.join(api.config.CACHE_DIR, `sing_list_${Date.now()}.png`);
                const imgResult = await api.downloadSearchImage(
                    "/api/video/search-image",
                    { q: parsed.query, limit: 6, cmd: "Reply 1-6" },
                    imgPath,
                );

                api.safeUnsend(ctx, progressId);

                if (!imgResult.results?.length) {
                    api.safeReact(ctx, "❌");
                    return api.safeReply(ctx, `❌ ɴᴏ ʀᴇꜱᴜʟᴛꜱ ꜰᴏʀ "${parsed.query}".`);
                }

                api.rememberSearch("sing", ctx, imgResult.results, "audio");
                api.safeReact(ctx, "✅");

                const sent = await api.safeReply(ctx, {
                    body: "Reply with a number (1-6) to download 🎵",
                    attachment: fs.createReadStream(imgResult.path),
                });
                setTimeout(() => fs.unlink(imgResult.path).catch(() => {}), 15_000);

                if (sent?.messageID) {
                    global.GoatBot.onReply.set(sent.messageID, {
                        commandName: "sing",
                        messageID: sent.messageID,
                        author: userId,
                        results: imgResult.results,
                        quality: parsed.quality,
                    });
                }
            } catch (err) {
                api.safeUnsend(ctx, progressId);
                api.safeReact(ctx, "❌");
                console.error("[sing] list error:", err.message);
                return api.safeReply(ctx, api.formatError(err));
            }
            return;
        }

        if (!api.tryAcquireLock(userId, 120_000)) {
            return api.safeReply(ctx, "⏳ ʏᴏᴜ ᴀʟʀᴇᴀᴅʏ ʜᴀᴠᴇ ᴀ ᴅᴏᴡɴʟᴏᴀᴅ ɪɴ ᴘʀᴏɢʀᴇꜱꜱ. ᴘʟᴇᴀꜱᴇ ᴡᴀɪᴛ.");
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
            let trackUrl, trackTitle, trackUploader, trackDuration;

            if (parsed.mode === "pick") {
                let pick;
                if (_directPick) {
                    pick = _directPick.pick;
                } else {
                    const recalled = api.recallSearch("sing", ctx);
                    if (!recalled || recalled.kind !== "audio") {
                        return api.safeReply(ctx, "❌ ɴᴏ ᴀᴄᴛɪᴠᴇ ʟɪꜱᴛ ꜰᴏᴜɴᴅ.\nRun:  sing <query> -list  first.");
                    }
                    const idx = parsed.pickIndex - 1;
                    if (idx < 0 || idx >= recalled.results.length) {
                        return api.safeReply(ctx, `❌ ɪɴᴠᴀʟɪᴅ ɴᴜᴍʙᴇʀ. ᴄʜᴏᴏꜱᴇ 1–${recalled.results.length}.`);
                    }
                    pick = recalled.results[idx];
                    api.clearPicker("sing", ctx);
                }
                trackUrl      = api.normalizeYouTubeUrl(pick.url);
                trackTitle    = pick.title;
                trackUploader = pick.uploader;
                trackDuration = pick.duration;
                api.safeReact(ctx, "📥");
                await sendProgress(
                    `📥 ᴘʀᴇᴘᴀʀɪɴɢ...\n\n🎵 ${trackTitle}\n` +
                    (trackUploader ? `👤 ${trackUploader}\n` : "") +
                    `🎚 ǫᴜᴀʟɪᴛʏ: ${parsed.quality} ᴋʙᴘꜱ\n⏳ ᴘʟᴇᴀꜱᴇ ᴡᴀɪᴛ...`,
                );

            } else {
                if (!parsed.query) {
                    return api.safeReply(ctx, [
                        "⚠️ ᴘʀᴏᴠɪᴅᴇ ᴀ ꜱᴏɴɢ ɴᴀᴍᴇ ᴏʀ YouTube URL.",
                        "",
                        "ᴇxᴀᴍᴘʟᴇꜱ:",
                        "  sing shape of you",
                        "  sing https://youtu.be/XXXXX",
                        "  sing adele hello -q 192",
                        "  sing lofi -list",
                        "  sing -h",
                    ].join("\n"));
                }

                if (api.isYouTubeUrl(parsed.query)) {
                    trackUrl = api.normalizeYouTubeUrl(parsed.query);
                    api.safeReact(ctx, "📥");
                    await sendProgress(
                        `📥 ꜰᴇᴛᴄʜɪɴɢ ꜰʀᴏᴍ ʟɪɴᴋ...\n🎚 ǫᴜᴀʟɪᴛʏ: ${parsed.quality} ᴋʙᴘꜱ\n⏳ ᴘʟᴇᴀꜱᴇ ᴡᴀɪᴛ...`,
                    );
                } else {
                    api.safeReact(ctx, "🔍");
                    await sendProgress(`🔍 ꜱᴇᴀʀᴄʜɪɴɢ...\n"${parsed.query}"\n⏳ ᴘʟᴇᴀꜱᴇ ᴡᴀɪᴛ...`);
                    const results = await api.searchVideos(parsed.query, 1);
                    if (!results.length) {
                        delProgress();
                        api.safeReact(ctx, "❌");
                        return api.safeReply(ctx, `❌ ɴᴏ ʀᴇꜱᴜʟᴛꜱ ꜰᴏʀ "${parsed.query}".`);
                    }
                    const top     = results[0];
                    trackUrl      = api.normalizeYouTubeUrl(top.url);
                    trackTitle    = top.title;
                    trackUploader = top.uploader;
                    trackDuration = top.duration;
                    delProgress();
                    api.safeReact(ctx, "📥");
                    await sendProgress(
                        `📥 ᴅᴏᴡɴʟᴏᴀᴅɪɴɢ...\n\n🎵 ${trackTitle}\n` +
                        (trackUploader ? `👤 ${trackUploader}\n` : "") +
                        (trackDuration ? `⏱ ${api.formatDuration(trackDuration)}\n` : "") +
                        `🎚 ǫᴜᴀʟɪᴛʏ: ${parsed.quality} ᴋʙᴘꜱ\n⏳ ᴘʟᴇᴀꜱᴇ ᴡᴀɪᴛ...`,
                    );
                }
            }

            const videoId  = api.extractVideoId(trackUrl);
            const cacheTag = `${parsed.quality}${FAST_MODE ? "f" : ""}`;
            let cached     = videoId ? await api.cacheLookup(videoId, cacheTag, "mp3") : null;
            let filePath, sizeBytes, headers = {}, elapsedMs = 0;

            if (cached) {
                filePath  = cached.path;
                sizeBytes = cached.size;
            } else {
                const targetPath = videoId
                    ? api.cacheFilenameFor(videoId, cacheTag, "mp3")
                    : path.join(api.config.CACHE_DIR, `tmp_${Date.now()}.mp3`);
                const params = { url: trackUrl, quality: parsed.quality };
                if (FAST_MODE) params.fast = "1";
                const result = await api.downloadToDisk("/api/music/download", params, targetPath);
                filePath  = result.path;
                sizeBytes = result.size;
                headers   = result.headers || {};
                elapsedMs = result.elapsedMs;
                if (headers["x-track-title"])    trackTitle    = decodeURIComponent(headers["x-track-title"]);
                if (headers["x-track-artist"])   trackUploader = decodeURIComponent(headers["x-track-artist"]);
                if (!trackDuration && headers["x-track-duration"]) trackDuration = Number(headers["x-track-duration"]) || null;
            }

            delProgress();

            if (sizeBytes < 1024) {
                await fs.unlink(filePath).catch(() => {});
                api.safeReact(ctx, "❌");
                return api.safeReply(ctx, "❌ ᴅᴏᴡɴʟᴏᴀᴅ ꜰᴀɪʟᴇᴅ — ᴇᴍᴘᴛʏ ꜰɪʟᴇ ʀᴇᴄᴇɪᴠᴇᴅ. ᴘʟᴇᴀꜱᴇ ʀᴇᴛʀʏ.");
            }
            const sizeMB = sizeBytes / (1024 * 1024);
            if (sizeMB > api.config.MAX_FILE_MB) {
                api.safeReact(ctx, "❌");
                return api.safeReply(ctx,
                    `❌ ꜰɪʟᴇ ᴛᴏᴏ ʟᴀʀɢᴇ (${sizeMB.toFixed(1)} ᴍʙ > ${api.config.MAX_FILE_MB} ᴍʙ).\n` +
                    `ᴛʀʏ ᴀ ʟᴏᴡᴇʀ ǫᴜᴀʟɪᴛʏ: sing ${parsed.query || trackTitle || "..."} -q 128`,
                );
            }

            const container  = (headers["x-audio-container"] || (FAST_MODE ? "m4a" : "mp3")).toUpperCase();
            const cacheHit   = !!cached;
            const sourceInfo = cacheHit
                ? "ᴄᴀᴄʜᴇ ʜɪᴛ — ɪɴꜱᴛᴀɴᴛ ⚡"
                : `${FAST_MODE ? "ꜰᴀꜱᴛ ꜱᴛʀᴇᴀᴍ" : "ᴛʀᴀɴꜱᴄᴏᴅᴇᴅ"} ɪɴ ${api.formatElapsed(elapsedMs)}`;

            api.safeReact(ctx, "✅");
            await api.safeReply(ctx, {
                body: [
                    ".  🎵 ᴀᴜᴅɪᴏ ᴅᴏᴡɴʟᴏᴀᴅᴇᴅ",
                    "━━━━━━━━━━━━━━━━━━━━",
                    `🎵 ᴛɪᴛʟᴇ    : ${trackTitle || "?"}`,
                    trackUploader ? `👤 ᴀʀᴛɪꜱᴛ   : ${trackUploader}` : null,
                    trackDuration ? `⏱ ᴅᴜʀᴀᴛɪᴏɴ : ${api.formatDuration(trackDuration)}` : null,
                    `🎚 ǫᴜᴀʟɪᴛʏ  : ${parsed.quality} ᴋʙᴘꜱ [${container}]`,
                    `📦 ꜱɪᴢᴇ     : ${api.formatBytes(sizeBytes)}`,
                    `⚡ ꜱᴏᴜʀᴄᴇ   : ${sourceInfo}`,
                ].filter(Boolean).join("\n"),
                attachment: fs.createReadStream(filePath),
            });

        } catch (err) {
            delProgress();
            api.safeReact(ctx, "❌");
            console.error("[sing] error:", err.message);
            return api.safeReply(ctx, api.formatError(err));
        } finally {
            api.releaseLock(userId);
        }
    },
};

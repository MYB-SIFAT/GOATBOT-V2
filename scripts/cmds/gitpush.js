const fs   = require("fs-extra");
const path = require("path");
const https = require("https");

// ─── GitHub API helper ────────────────────────────────────────────────────────

function ghRequest(method, urlPath, token, body = null) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const opts = {
            hostname: "api.github.com",
            path: urlPath,
            method,
            headers: {
                "Authorization": `token ${token}`,
                "User-Agent":    "GoatBot-GitPush/1.0",
                "Accept":        "application/vnd.github.v3+json",
                "Content-Type":  "application/json",
                ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {})
            }
        };
        const req = https.request(opts, res => {
            let raw = "";
            res.on("data", c => raw += c);
            res.on("end", () => {
                try {
                    const data = JSON.parse(raw);
                    resolve({ status: res.statusCode, data });
                } catch {
                    resolve({ status: res.statusCode, data: raw });
                }
            });
        });
        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
    });
}

// ─── parse owner/repo from URL ────────────────────────────────────────────────

function parseRepo(repoUrl) {
    const cleaned = repoUrl
        .replace(/^https?:\/\/github\.com\//, "")
        .replace(/\.git$/, "")
        .trim();
    const [owner, repo] = cleaned.split("/");
    return { owner, repo };
}

// ─── Command ─────────────────────────────────────────────────────────────────

module.exports = {
    config: {
        name:        "gitpush",
        aliases:     ["gpush", "gp"],
        version:     "1.0.0",
        author:      "SIFAT",
        countDown:   5,
        role:        4,
        description: { en: "ᴘᴜꜱʜ ᴀɴʏ ꜰɪʟᴇ ᴛᴏ ɢɪᴛʜᴜʙ ʀᴇᴘᴏꜱɪᴛᴏʀʏ" },
        category:    "owner",
        guide:       { en: "{pn} <ꜰɪʟᴇ-ᴘᴀᴛʜ> [ᴄᴏᴍᴍɪᴛ ᴍᴇꜱꜱᴀɢᴇ]\n\n"
                         + "ᴇxᴀᴍᴘʟᴇꜱ:\n"
                         + "  {pn} config.json\n"
                         + "  {pn} scripts/cmds/bank.js updated bank\n"
                         + "  {pn} sifu_database/bank_settings.json\n"
                         + "  {pn} fca-config.json fix fca config\n\n"
                         + "• ꜰɪʟᴇ ᴘᴀᴛʜ ɪꜱ ʀᴇʟᴀᴛɪᴠᴇ ᴛᴏ ʙᴏᴛ ʀᴏᴏᴛ\n"
                         + "• ɢɪᴛʜᴜʙ ᴄᴏɴꜰɪɢ ɪꜱ ʀᴇᴀᴅ ꜰʀᴏᴍ ᴄᴏɴꜰɪɢ.ᴊꜱᴏɴ" }
    },

    langs: {
        en: {
            noArgs:     "⌀ ꜰɪʟᴇ ᴘᴀᴛʜ ᴅɪᴇ!\nᴜꜱᴀɢᴇ: {pn} <ᴘᴀᴛʜ> [ᴄᴏᴍᴍɪᴛ ᴍꜱɢ]",
            noToken:    "⌀ GITHUB_TOKEN ᴇɴᴠ ᴠᴀʀɪᴀʙʟᴇ ꜱᴇᴛ ᴋᴏʀᴀ ɴᴀɪ!\nᴊᴀ: Secrets → GITHUB_TOKEN",
            noRepo:     "⌀ config.json ᴇ github.repo ꜱᴇᴛ ᴋᴏʀᴀ ɴᴀɪ!",
            noFile:     "⌀ ꜰɪʟᴇ ᴘᴀᴏᴡᴀ ɢᴇʟᴏ ɴᴀ: %1",
            pushing:    "⏳ ᴘᴜꜱʜ ᴋᴏʀᴄʜɪ...\n📁 %1\n🌿 %2",
            success:    "✅ ɢɪᴛʜᴜʙ ᴇ ᴘᴜꜱʜ ʜᴏʏᴇ ɢᴇᴄʜᴇ!\n\n📁 ꜰɪʟᴇ  : %1\n🌿 ʙʀᴀɴᴄʜ: %2\n💬 ᴄᴏᴍᴍɪᴛ: %3\n🔗 ʟɪɴᴋ  : %4",
            authErr:    "⌀ ᴛᴏᴋᴇɴ ɪɴᴠᴀʟɪᴅ ᴏʀ ᴘᴇʀᴍɪꜱꜱɪᴏɴ ɴᴀɪ! GitHub Token ᴄʜᴇᴄᴋ ᴋᴏʀᴏ.",
            apiErr:     "⌀ ɢɪᴛʜᴜʙ ᴀᴘɪ ᴇʀʀᴏʀ [%1]: %2"
        }
    },

    onStart: async function ({ api, args, message, event, role, getLang }) {
        if (!args[0]) return message.reply(getLang("noArgs"));

        // ── Separate filepath from commit message ──
        // Format: <path> [optional commit message words...]
        const filePath   = args[0];
        const commitMsg  = args.slice(1).join(" ").trim() || `update ${filePath}`;

        // ── Read config.json ──
        const CFG_FILE = path.join(process.cwd(), "config.json");
        const cfg      = fs.readJsonSync(CFG_FILE);
        const ghCfg    = cfg.github || {};

        // ── Token from config.json (primary) or env fallback ──
        const token = ghCfg.token || process.env.GITHUB_TOKEN || "";
        if (!token) return message.reply(getLang("noToken"));

        // ── Repo from config ──
        const repoUrl = ghCfg.repo || "";
        if (!repoUrl) return message.reply(getLang("noRepo"));

        const { owner, repo } = parseRepo(repoUrl);
        const branch          = ghCfg.branch      || "main";
        const authorName      = ghCfg.authorName  || "GoatBot";
        const authorEmail     = ghCfg.authorEmail || "bot@goatbot.local";

        // ── Read local file ──
        const localPath = path.join(process.cwd(), filePath);
        if (!fs.existsSync(localPath)) return message.reply(getLang("noFile", filePath));

        const fileContent    = fs.readFileSync(localPath);
        const contentBase64  = fileContent.toString("base64");

        // ── Notify user ──
        message.reply(getLang("pushing", filePath, branch));

        // ── Get existing file SHA (needed if file already exists) ──
        const apiPath = `/repos/${owner}/${repo}/contents/${filePath}`;
        let existingSha = null;

        const getRes = await ghRequest("GET", `${apiPath}?ref=${branch}`, token);
        if (getRes.status === 200 && getRes.data?.sha) {
            existingSha = getRes.data.sha;
        } else if (getRes.status === 401) {
            return message.reply(getLang("authErr"));
        }

        // ── Push file ──
        const body = {
            message: commitMsg,
            content: contentBase64,
            branch,
            author: { name: authorName, email: authorEmail },
            committer: { name: authorName, email: authorEmail }
        };
        if (existingSha) body.sha = existingSha;

        const putRes = await ghRequest("PUT", apiPath, token, body);

        if (putRes.status === 200 || putRes.status === 201) {
            const fileUrl = `https://github.com/${owner}/${repo}/blob/${branch}/${filePath}`;
            return message.reply(getLang("success", filePath, branch, commitMsg, fileUrl));
        } else if (putRes.status === 401 || putRes.status === 403) {
            return message.reply(getLang("authErr"));
        } else {
            const errMsg = putRes.data?.message || JSON.stringify(putRes.data);
            return message.reply(getLang("apiErr", putRes.status, errMsg));
        }
    }
};

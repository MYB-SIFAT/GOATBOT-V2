const fs = require("fs-extra");
const path = require("path");
const https = require("https");
const { utils } = global;

module.exports = {
  config: {
    name: "prefix",
    version: "1.1", 
    author: "S1F4T",
    countDown: 5,
    role: 0,
    description: "Change the bot's prefix or show current prefix with rotating video/gif/image.",
    category: "config",
    guide: {
      en: "{pn} <new prefix> : change prefix in this chat\n" +
          "{pn} <new prefix> -g : change global prefix (admin only)\n" +
          "{pn} reset : reset to default\n" +
          "Just type \"prefix\" → shows info + media"
    }
  },

  langs: {
    en: {
      reset: "✨ ʏᴏᴜʀ ᴘʀᴇғɪx ʀᴇsᴇᴛ ᴛᴏ ᴅᴇғᴀᴜʟᴛ: %1",
      onlyAdmin: "❌ ᴏɴʟʏ ᴀᴅᴍɪɴ ᴄᴀɴ ᴄʜᴀɴɢᴇ ᴛʜᴇ sʏsᴛᴇᴍ ᴘʀᴇғɪx",
      confirmGlobal: "⚠️ ᴘʟᴇᴀsᴇ ʀᴇᴀᴄᴛ ᴛᴏ ᴛʜɪs ᴍᴇssᴀɢᴇ ᴛᴏ ᴄᴏɴғɪʀᴍ sʏsᴛᴇᴍ ᴘʀᴇғɪx ᴄʜᴀɴɢᴇ",
      confirmThisThread: "⚠️ ᴘʟᴇᴀsᴇ ʀᴇᴀᴄᴛ ᴛᴏ ᴛʜɪs ᴍᴇssᴀɢᴇ ᴛᴏ ᴄᴏɴғɪʀᴍ ᴄʜᴀɴɢᴇ ɪɴ ᴛʜɪs ᴄʜᴀᴛ",
      successGlobal: "✅ ᴄʜᴀɴɢᴇᴅ sʏsᴛᴇᴍ ᴘʀᴇғɪx ᴛᴏ: %1",
      successThisThread: "✅ ᴄʜᴀɴɢᴇᴅ ᴘʀᴇғɪx ɪɴ ᴛʜɪs ᴄʜᴀᴛ ᴛᴏ: %1",
      myPrefix: "〔 ʜᴇʏ %1 ᴅɪᴅ ʏᴏᴜ ᴀsᴋ ᴍʏ ᴘʀᴇғɪx ‽ 〕 \n\n" +
                "┣ ɢʟᴏʙᴀʟ ᴘʀᴇꜰɪx: %2\n" +
                "┣ ʏᴏᴜʀ ʙᴏx: %3\n" +
                "┣ ᴄᴍᴅ ᴍᴇɴᴜ: ʜᴇʟᴘ\n" +
                "┣ ᴅᴇᴠ: sɪғᴜ ☠️\n\n" +
                "〔 ɪ'ᴍ %4 ᴀᴛ ʏᴏᴜʀ sᴇʀᴠɪᴄᴇ 🌊 〕"
    }
  },

  onStart: async function({ message, role, args, commandName, event, threadsData, getLang, api }) {
    if (!args[0]) return message.SyntaxError();

    if (args[0] === 'reset') {
      const botID = global.botID || api.getCurrentUserID();
      await threadsData.set(event.threadID, null, `data.prefix_${botID}`);
      await threadsData.set(event.threadID, null, "data.prefix");
      return message.reply(getLang("reset", global.GoatBot.config.prefix));
    }

    const newPrefix = args[0];
    const formSet = {
      commandName,
      author: event.senderID,
      newPrefix
    };

    if (args[1] === "-g") {
      if (role < 2) return message.reply(getLang("onlyAdmin"));
      formSet.setGlobal = true;
    } else {
      formSet.setGlobal = false;
    }

    return message.reply(
      args[1] === "-g" ? getLang("confirmGlobal") : getLang("confirmThisThread"),
      (err, info) => {
        if (err) return;
        formSet.messageID = info.messageID;
        global.GoatBot.onReaction.set(info.messageID, formSet);
      }
    );
  },

  onReaction: async function({ message, threadsData, event, Reaction, getLang, api }) {
    const { author, newPrefix, setGlobal } = Reaction;
    if (event.userID !== author) return;

    if (setGlobal) {
      global.GoatBot.config.prefix = newPrefix;
      fs.writeFileSync(global.client.dirConfig, JSON.stringify(global.GoatBot.config, null, 2));
      return message.reply(getLang("successGlobal", newPrefix));
    } else {
      const botID = global.botID || api.getCurrentUserID();
      await threadsData.set(event.threadID, newPrefix, `data.prefix_${botID}`);
      return message.reply(getLang("successThisThread", newPrefix));
    }
  },

  onChat: async function({ event, message, getLang, usersData }) {
    if (!event.body || event.body.toLowerCase() !== "prefix") return;

    const userName = await usersData.getName(event.senderID);
    const botName = global.GoatBot.config.nickNameBot || "Bot";
    const globalPrefix = global.GoatBot.config.prefix;
    const threadPrefix = utils.getPrefix(event.threadID) || globalPrefix;

    // == Video,GIF,Image - ja icca den 🦭
    const mediaURLs = [
      "https://i.imgur.com/5a9DjQ6.gif",
      "https://i.imgur.com/LC948jn.gif", 
    ];

    const cacheDir = path.join(__dirname, "cache");
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

    const indexFile = path.join(cacheDir, "prefix_media_index.json");
    let index = 0;

    if (fs.existsSync(indexFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(indexFile, "utf8"));
        index = (data.index + 1) % mediaURLs.length;
      } catch (e) {}
    }

    fs.writeFileSync(indexFile, JSON.stringify({ index }));

    const mediaPath = path.join(cacheDir, `prefix_media_${index}${path.extname(mediaURLs[index])}`);

    if (!fs.existsSync(mediaPath)) {
      try {
        await downloadFile(mediaURLs[index], mediaPath);
      } catch (err) {
        console.error("Failed to download prefix media:", err);
      }
    }

    let attachment = [];
    if (fs.existsSync(mediaPath)) {
      attachment = [fs.createReadStream(mediaPath)];
    }

    return message.reply({
      body: getLang("myPrefix", userName, globalPrefix, threadPrefix, botName),
      attachment
    });
  }
};

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        fs.unlink(dest, () => {});
        return reject(new Error(`Failed to download: ${res.statusCode}`));
      }
      res.pipe(file);
      file.on("finish", () => {
        file.close(resolve);
      });
    }).on("error", (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

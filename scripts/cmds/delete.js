const fs = require("fs-extra");
const path = require("path");

module.exports = {
	config: {
		name: "delete",
		aliases: ["delcmd"],
		version: "2.0.0",
		author: "SIFAT",
		countDown: 5,
		role: 2,
		description: { en: "ᴅᴇʟᴇᴛᴇ ᴄᴏᴍᴍᴀɴᴅ ꜰɪʟᴇ(ꜱ)" },
		category: "owner",
		guide: { en: "{pn} <ɴᴀᴍᴇ> [ɴᴀᴍᴇ2 ...]" }
	},

	langs: {
		en: {
			noArgs:   "⌀ ᴘʀᴏᴠɪᴅᴇ ᴀᴛ ʟᴇᴀꜱᴛ ᴏɴᴇ ᴄᴏᴍᴍᴀɴᴅ ɴᴀᴍᴇ",
			notFound: "⌀ ɴᴏᴛ ꜰᴏᴜɴᴅ: %1",
			deleted:  "✦ ᴅᴇʟᴇᴛᴇᴅ: %1",
			error:    "⌀ ᴇʀʀᴏʀ [%1]: %2",
			summary:  "%1"
		}
	},

	onStart: async function ({ args, message, getLang }) {
		if (!args.length) return message.reply(getLang("noArgs"));
		const results = [];
		for (const name of args) {
			const cmdName = name.toLowerCase().replace(/\.js$/, "");
			const cmdPath = path.join(__dirname, `${cmdName}.js`);
			try {
				if (!fs.existsSync(cmdPath)) { results.push(getLang("notFound", cmdName)); continue; }
				const GoatBot = global.GoatBot;
				const cmd = GoatBot.commands.get(cmdName);
				if (cmd) {
					for (const alias of (cmd.config?.aliases || [])) GoatBot.aliases.delete(alias);
					GoatBot.onChat = (GoatBot.onChat || []).filter(n => n !== cmdName);
					GoatBot.onEvent = (GoatBot.onEvent || []).filter(n => n !== cmdName);
					GoatBot.commands.delete(cmdName);
					GoatBot.commandFilesPath = (GoatBot.commandFilesPath || []).filter(i => !i.commandName.includes(cmdName));
					try { delete require.cache[require.resolve(cmdPath)]; } catch {}
				}
				fs.unlinkSync(cmdPath);
				results.push(getLang("deleted", cmdName));
			} catch (err) {
				results.push(getLang("error", cmdName, err.message));
			}
		}
		return message.reply(getLang("summary", results.join("\n")));
	}
};

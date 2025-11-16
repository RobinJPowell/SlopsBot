const Discord = require("discord.js");
const Winston = require('winston');
const MongoDB = require('mongodb').MongoClient;
const Auth = require('./auth.json');

// Configure Logger settings
const { combine, timestamp, printf, colorize, align } = Winston.format;

const Logger = Winston.createLogger({
	level:  'debug',
	format: combine(
		colorize({ all: true }),
		timestamp({
			format: 'YYYY-MM-DD HH:mm:ss.SSS',
		}),
		align(),
		printf((info) => `[${info.timestamp}] ${info.level}: ${info.message}`)
	),
	transports: [new Winston.transports.Console()],
});

// Connect to database
const MongoClient = new MongoDB('mongodb://127.0.0.1:27017', { family: 4 });
const Database = MongoClient.db('slops');
const CardsCollection = Database.collection('cards');
const MiscCollection = Database.collection('misc');
const PinsCollection = Database.collection('pins');
const RolesCollection = Database.collection('roles');

// Role names
const RedRole = 'Recently made a really bad pun, jape, hijink or caper.';
const GreenRole = 'Recently actually made a good pun, jape, hijink or caper.';
const YellowRole = 'Recently actually made an average pun, jape, hijink or caper.';

// Hardcoded general channel id (name changes)
const GeneralChannelID = '433227076657610753';
const GeneralChannelNightName = '💀┃night-gang';

const bot = new Discord.Client({intents: 37377});

setInterval(removeRoles, 15 * 60 * 1000);
setInterval(lateNightCheck, 1 * 60 * 1000);

bot.on('ready', function (evt) {
    Logger.info('Connected');
});
bot.on('messageCreate', function(message) {
	checkReactions(message);

	if (message.content.startsWith('!lb')) {
		colour = message.content.substring(message.content.indexOf(' ') + 1);
		countCards(message, colour.toLowerCase());
	}
});

bot.login(Auth.token);

function checkReactions(message) {
	const channel = message.channel;	

	channel.messages.fetch({ limit: 100 }).then(messages => {			
		messages.forEach((msg) => {
			const reactions = msg.reactions.cache;

			if (reactions.size > 0) {
				let reactionCount = 0;
				let redCount = 0;
				let greenCount = 0;
				let yellowCount = 0;
				let pinCount = 0;

				reactions.forEach((reaction, reactionString) => {
					setTimeout(() => {
						reactionCount++;
						if (reactionString == '🟥') {
							redCount = reaction.count;
						} else if (reactionString == '🟩') {
							greenCount = reaction.count;
						} else if (reactionString == '🟨') {
							yellowCount = reaction.count;
						} else if (reactionString == '📌') {
							pinCount = reaction.count;
						}
						
						if (reactionCount == reactions.size) {						
							if (redCount >= 5) {
								addRole(RedRole, msg, reaction);
							}
							if (greenCount >= 5) {
								addRole(GreenRole, msg, reaction);
							}
							if (yellowCount >= 5) {
								addRole(YellowRole, msg, reaction);
							}
							if (pinCount >= 5) {
								pinMessage(msg);
							}
						}
					}, reactionCount * 50);
				});				
			}		
		});
	});
}

async function addRole(roleName, message, reaction) {	
	const findMessage = { role: roleName, messageId: message.id };
	const cardedMessage = await CardsCollection.findOne(findMessage);
    
    if (!cardedMessage) {
		let selfGreen = false;
		if (roleName == GreenRole) {
			const reactionUsers = await reaction.users.fetch();

			reactionUsers.forEach(async (user) => {
				if (message.author.id == user.id) {
					selfGreen = true;
					message.reply({ files: [{ attachment: "selfGreen.jpg" }] });
					addRole(RedRole, message, reaction);
					await CardsCollection.insertOne({ ...findMessage, user: message.author.id, server: message.guildId });
				}
			});
		}

		if (!selfGreen) {
			const findRoleUser = { user: message.author.id, server: message.guildId };
			const roleUser = await RolesCollection.findOne(findRoleUser);

			if (!roleUser) {
				const role = message.guild.roles.cache.find(role => role.name == roleName);
				
				message.member.roles.add(role).then(async () => {
					Logger.info(`${roleName} given to ${message.author.id} (${message.author.displayName})`);
					Logger.debug(`${message.content}`);
					await RolesCollection.insertOne({ ...findRoleUser, role: roleName, displayName: message.author.displayName, timestamp: new Date(Date.now()) });	
				}).catch((reject) => {
					Logger.error(`Error when adding role ${roleName} to ${message.author.id} (${message.author.displayName}): ${reject}`);
				});
			} else {
				if (roleUser.role == roleName) {
					Logger.info(`${roleName} extended for ${message.author.id} (${message.author.displayName})`);
					Logger.debug(`${message.content}`);
					await RolesCollection.updateOne(findRoleUser, { $set: { timestamp: new Date(Date.now()) } });
				} else {
					const newRole = message.guild.roles.cache.find(role => role.name == roleName);
					const oldRole = message.guild.roles.cache.find(role => role.name == roleUser.role);

					message.member.roles.remove(oldRole).then(async () => {
						message.member.roles.add(newRole).then(async () => {
							Logger.info(`${oldRole.name} changed to ${newRole.name} for ${message.author.id} (${message.author.displayName})`);
							Logger.debug(`${message.content}`);
							await RolesCollection.updateOne(findRoleUser, { $set: { role: roleName, timestamp: new Date(Date.now()) } });
						}).catch((reject) => {
							Logger.error(`Error when switching roles from ${roleName} for ${message.author.id} (${message.author.displayName}): ${reject}`);
						});
					}).catch((reject) => {
						Logger.error(`Error when switching roles from ${roleName} for ${message.author.id} (${message.author.displayName}): ${reject}`);
					});
				}			
			}

			await CardsCollection.insertOne({ ...findMessage, user: message.author.id, server: message.guildId });
		}
    }
}

async function removeRoles() {
	const cursor = await RolesCollection.find();
	const rolesArray = await cursor.toArray();
	
	rolesArray.forEach(async (roleUser) => {
		const oneDayAgo = new Date().getTime() - (24 * 60 * 60 * 1000);
		if (oneDayAgo > roleUser.timestamp) {
			const guild = await bot.guilds.fetch(roleUser.server);
			const member = await guild.members.fetch(roleUser.user);
			const role = guild.roles.cache.find(role => role.name == roleUser.role);

			member.roles.remove(role).then(async () => {
				Logger.info(`${roleUser.role} removed from ${roleUser.user} (${roleUser.displayName})`);
				await RolesCollection.deleteOne({ role: roleUser.role, user: roleUser.user, server: roleUser.server });
			}).catch((reject) => {
				Logger.error(`Error when removing role ${roleName} from ${message.author.id} (${message.author.displayName}): ${reject}`);
			});		
		}
	});
}

async function pinMessage(message) {
	const findMessage = { messageId: message.id };
	const pinnedMessage = await PinsCollection.findOne(findMessage);
	
	if (!pinnedMessage) {
		message.pin().then(async () => {
			Logger.info(`Pin for ${message.author.id} from ${message.id} (${message.author.displayName})`);
			Logger.debug(`${message.content}`);

			if (message.content.toLowerCase().includes(' no pin')) {
				message.reply('SLOPSBOT DOES NOT CARE FOR YOUR INSTRUCTIONS');
			}

			await PinsCollection.insertOne({ ...findMessage, user: message.author.id, server: message.guildId });
		}).catch(async (reject) => {
			Logger.error(`Error when pinning message ${message.id}: ${reject}`);
			Logger.debug(`${message.content}`);

			if (reject.toString().includes('Maximum number of pins reached')) {
				await PinsCollection.insertOne({ ...findMessage, user: message.author.id, server: message.guildId );
			}
		});		
	}
}

async function lateNightCheck() {
	const generalChannel = bot.channels.cache.get(GeneralChannelID);
	const generalChannelName = generalChannel.name;
	const now = new Date(Date.now());	
	let lastLateNightCheck = -1;
	let lastDaytimeCheck = -1;
	
	const generalChannelNameRecord = await MiscCollection.findOne({ name: 'generalChannelName' });
	const lastLateNightCheckRecord = await MiscCollection.findOne({ name: 'lastLateNightCheck' });
	const lastDaytimeCheckRecord = await MiscCollection.findOne({ name: 'lastDaytimeCheck' });
        
    if (!generalChannelNameRecord) {		
		await MiscCollection.insertOne({ name: 'generalChannelName', channelName: generalChannelName })
	}
	
	if (lastLateNightCheckRecord) {
        lastLateNightCheck = lastLateNightCheckRecord.day;
    } else {
        await MiscCollection.insertOne({ name: 'lastLateNightCheck',  day: lastLateNightCheck });
    }

	if (lastDaytimeCheckRecord) {
		lastDaytimeCheck = lastDaytimeCheckRecord.day;
	} else {
		await MiscCollection.insertOne( { name: 'lastDaytimeCheck', day: lastDaytimeCheck } )
	}

	if (generalChannelName != GeneralChannelNightName && lastLateNightCheck != now.getDate() && now.getHours() == 2) {
		generalChannel.setName(GeneralChannelNightName);
		await MiscCollection.updateOne({ name: 'generalChannelName' }, { $set: { channelName: generalChannelName } });
		await MiscCollection.updateOne({ name: 'lastLateNightCheck' }, { $set: { day: now.getDate() } });
		Logger.info(`It's late, ${generalChannelName} changed to ${GeneralChannelNightName}`);
	} else if (generalChannelName == GeneralChannelNightName && lastDaytimeCheck != now.getDate() && now.getHours() == 6) {
		generalChannel.setName(generalChannelNameRecord.channelName);
		await MiscCollection.updateOne({ name: 'lastDaytimeCheck' }, { $set: { day: now.getDate() } });
		Logger.info(`It's daytime, ${GeneralChannelNightName} changed back to ${generalChannelNameRecord.channelName}`);
	};
}

async function countCards(message, colour) {
	let role = "";
	const count = new Map();

	switch (colour) {
		case "red":
			role = RedRole;
			break;
		case "yellow":
			role = YellowRole;
			break;
		case "green":
			role = GreenRole;
			break;
		case "pins":
			role = "pins"
			break;
	}

	if (role == "pins") {
		const cursor = await PinsCollection.find({ server: message.guildId });
		const pinsArray = await cursor.toArray();

		pinsArray.forEach(async (pin) => {
			if (pin.user != null) {
				count.set(pin.user, (count.get(pin.user) || 0) + 1);
			}
		});
	} else if (role != "") {
		const cursor = await CardsCollection.find({ role: role, server: message.guildId });
		const cardsArray = await cursor.toArray();

		cardsArray.forEach(async (card) => {
			if (card.user != null) {
				count.set(card.user, (count.get(card.user) || 0) + 1);
			}
		});
	}

	if (role != "") {
		const sortedCountArray = Array.from(count).sort((a, b) => a[1] - b[1]);
		const sortedCountMap = new Map(sortedCountArray.toReversed());

		let leaderboard = "";

		for (let [key, value] of sortedCountMap) {			
			const guild = await bot.guilds.fetch(message.guildId);
			const member = await guild.members.fetch(key);
			leaderboard += `${member.displayName} - ${value}\n`;
		}

		if (leaderboard > "") {
			message.reply(leaderboard.trim());
		} else if (role == "pins") {
			message.reply(`No pins counted yet`);
		} else {
			message.reply(`No ${colour} cards counted yet`);
		}
	}
}
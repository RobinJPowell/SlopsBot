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
			format: 'YYYY-MM-DD hh:mm:ss.SSS',
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
const PinsCollection = Database.collection('pins');
const RolesCollection = Database.collection('roles');

// Role names
RedRole = 'Recently made a really bad pun, jape, hijink or caper.';
GreenRole = 'Recently actually made a good pun, jape, hijink or caper.';
YellowRole = 'Recently actually made an average pun, jape, hijink or caper.';

const bot = new Discord.Client({intents: 37377});

setInterval(removeRoles, 15 * 60 * 1000);

bot.on('ready', function (evt) {
    Logger.info('Connected');
});
bot.on('messageCreate', function(message) {
	checkReactions(message);
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
								addRole(RedRole, msg);
							}
							if (greenCount >= 5) {
								addRole(GreenRole, msg);
							}
							if (yellowCount >= 5) {
								addRole(YellowRole, msg);
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

async function addRole(roleName, message) {	
	const findMessage = { role: roleName, messageId: message.id };
	const cardedMessage = await CardsCollection.findOne(findMessage);
    
    if (!cardedMessage) {
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

		await CardsCollection.insertOne(findMessage);
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

			await PinsCollection.insertOne(findMessage);
		}).catch((reject) => {
			Logger.error(`Error when pinning message ${message.id}: ${reject}`);

			if (reject.includes('Maximum number of pins reached')) {
				message.reply('Unable to pin, maxiumum number of pins reached');
			}
		});		
	}
}
const Discord = require("discord.js");
const Logger = require('winston');
const MongoDB = require('mongodb').MongoClient;
const Auth = require('./auth.json');

// Configure Logger settings
Logger.remove(Logger.transports.Console);
Logger.add(new Logger.transports.Console, {
    colorize: true
});
Logger.level = 'debug';

// Connect to database
const MongoClient = new MongoDB('mongodb://127.0.0.1:27017', { family: 4 });
const Database = MongoClient.db('slops');
const CardsCollection = Database.collection('cards');
const PinsCollection = Database.collection('pins');
const RolesCollection = Database.collection('roles');

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
								addRole('Recently made a really bad pun, jape, hijink or caper.', msg);
							}
							if (greenCount >= 5) {
								addRole('Recently actually made a good pun, jape, hijink or caper.', msg);
							}
							if (yellowCount >= 5) {
								addRole('Recently actually made an average pun, jape, hijink or caper.', msg);								
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
		const findRoleUser = { role: roleName, user: message.author.id, server: message.guildId };
		const roleUser = await RolesCollection.findOne(findRoleUser);

		if (!roleUser) {
			const role = message.guild.roles.cache.find(role => role.name == roleName);

			message.member.roles.add(role);
			Logger.info(`${roleName} given to ${message.author.id}`);
			await RolesCollection.insertOne({ ...findRoleUser, timestamp: new Date(Date.now()) });						
		} else {
			await RolesCollection.updateOne(findRoleUser, { $set: { timestamp: new Date(Date.now()) } })
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

			member.roles.remove(role);
			Logger.info(`${roleUser.role} removed from ${roleUser.user}`)
			await RolesCollection.deleteOne({ role: roleUser.role, user: roleUser.user, server: roleUser.server });			
		}
	});
}

async function pinMessage(message) {
	const findMessage = { messageId: message.id };
	const pinnedMessage = await PinsCollection.findOne(findMessage);
	
	if (!pinnedMessage) {
		message.pin();
		Logger.info(`Pin for ${message.author.id} from ${message.id}`);

		if (message.content.toLowerCase().includes(' no pin')) {
			message.reply('SLOPSBOT DOES NOT CARE FOR YOUR INSTRUCTIONS');
		}

		await PinsCollection.insertOne(findMessage);		
	}
}
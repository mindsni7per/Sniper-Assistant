const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const names = [
 ['help','Show categorized help'],
 ['ban','Ban a member'],['hardban','Ban a user; anti-nuke admins only'],['kick','Kick a member'],
 ['mute','Timeout a member'],['unmute','Remove a timeout'],['warn','Warn a member'],
 ['unban','Unban by user ID'],['banlist','Paginated server ban list'],['modlogs','View moderation cases'],
 ['modstats','View moderator statistics'],['void','Void a moderation case'],['antinuke','Manage anti-nuke admins'],
 ['nick','Change a nickname'],['clearnick','Clear a nickname'],['strip','Remove manageable roles'],
 ['autoskull','Toggle skull reactions'],['clean','Clean bot command messages'],['purge','Delete recent messages'],
 ['lock','Lock this channel'],['unlock','Unlock this channel'],['serverinfo','Show server information'],
 ['8ball','Ask the magic 8-ball'],['coinflip','Flip a coin'],['afk','Set AFK status'],['dih','Random fun response'],
 ['puh','Random fun response'],['compliment','Get a compliment'],['highfive','High-five a member'],
 ['snipe','Show last deleted message'],['editedsnipe','Show last edited message'],['clearsnipes','Clear snipe cache'],
 ['say','Make the bot say something'],['ping','Show bot latency'],['avatar','Show a user avatar'],
 ['application','Post the application panel'],['support','Post the support panel']
];
const commands = names.map(([name, description]) => {
 const b = new SlashCommandBuilder().setName(name).setDescription(description);
 if (['ban','hardban','kick','mute','unmute','warn','nick','clearnick','strip','highfive','dih','puh'].includes(name))
   b.addUserOption(o=>o.setName('user').setDescription('Target user').setRequired(!['dih','puh','highfive'].includes(name)));
 if (['ban','hardban','kick','warn'].includes(name)) b.addStringOption(o=>o.setName('reason').setDescription('Reason').setMaxLength(500));
 if (name==='mute') b.addIntegerOption(o=>o.setName('minutes').setDescription('Timeout duration in minutes').setMinValue(1).setMaxValue(40320).setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason'));
 if (name==='unban') b.addStringOption(o=>o.setName('user_id').setDescription('Discord user ID').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason'));
 if (['modlogs','modstats','avatar'].includes(name)) b.addStringOption(o=>o.setName('user_id').setDescription('Optional user ID'));
 if (name==='void') b.addIntegerOption(o=>o.setName('case_id').setDescription('Case number').setRequired(true));
 if (name==='antinuke') b.addStringOption(o=>o.setName('action').setDescription('add or remove').setRequired(true).addChoices({name:'add',value:'add'},{name:'remove',value:'remove'})).addUserOption(o=>o.setName('user').setDescription('Administrator to manage').setRequired(true));
 if (['nick'].includes(name)) b.addStringOption(o=>o.setName('nickname').setDescription('New nickname').setRequired(true));
 if (name==='purge') b.addIntegerOption(o=>o.setName('amount').setDescription('1 to 100').setMinValue(1).setMaxValue(100));
 if (name==='say') b.addStringOption(o=>o.setName('message').setDescription('Text to send').setRequired(true)).addBooleanOption(o=>o.setName('embed').setDescription('Send as an embed'));
 if (name==='afk') b.addStringOption(o=>o.setName('reason').setDescription('Reason'));
 if (['8ball'].includes(name)) b.addStringOption(o=>o.setName('question').setDescription('Your question').setRequired(true));
 if (['application','support','help','helpstaff','serverinfo','ping','coinflip','compliment','autoskull','clean','lock','unlock','snipe','editedsnipe','clearsnipes','banlist'].includes(name)) {}
 if (['application','support'].includes(name)) b.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
 return b.toJSON();
});
module.exports = { commands };
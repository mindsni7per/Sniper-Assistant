require('dotenv').config();
const {
 Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
 ButtonBuilder, ButtonStyle, PermissionsBitField, ChannelType, Events, Collection
} = require('discord.js');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

if (!process.env.DISCORD_TOKEN) throw new Error('Missing DISCORD_TOKEN. Copy .env.example to .env and set it.');
const PREFIX = process.env.PREFIX || 's!';
const COLOR = Number(process.env.EMBED_COLOR || 3498db);
const STAFF_ROLES = (process.env.STAFF_ROLE_IDS || '').split(',').map(s=>s.trim()).filter(Boolean);
const REVIEW_CHANNEL = process.env.REVIEW_CHANNEL_ID || '';
const dbDir = path.join(__dirname, 'data'); fs.mkdirSync(dbDir,{recursive:true});
const db = new Database(path.join(dbDir,'snipers.sqlite'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS applications(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT,guild_id TEXT,type TEXT,answers TEXT,status TEXT,created_at TEXT,reviewer_id TEXT,decision_note TEXT);
CREATE TABLE IF NOT EXISTS cases(id INTEGER PRIMARY KEY AUTOINCREMENT,guild_id TEXT,target_id TEXT,moderator_id TEXT,action TEXT,reason TEXT,created_at TEXT,duration INTEGER,voided INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS tickets(channel_id TEXT PRIMARY KEY,guild_id TEXT,owner_id TEXT,type TEXT,status TEXT,claimed_by TEXT,created_at TEXT);
CREATE TABLE IF NOT EXISTS antinuke(guild_id TEXT,user_id TEXT,PRIMARY KEY(guild_id,user_id));
CREATE TABLE IF NOT EXISTS settings(guild_id TEXT,key TEXT,value TEXT,PRIMARY KEY(guild_id,key));
`);
const client = new Client({intents:[
 GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildModeration,
 GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages,
 GatewayIntentBits.GuildMessageReactions
],partials:[Partials.Channel,Partials.Message,Partials.User]});
const deleted = new Map(), edited = new Map(), afk = new Map(), skullChannels = new Set(), sessions = new Map();
const appQuestions = {
 'Staff Application':['What is your Discord ID?','How old are you?','How active are you on Discord?','Do you have any moderation experience in other servers? List them.','What are your qualities?','Do you understand you must remain mature and professional at all times?','Would you like to add anything at the end?'],
 'Middleman Application':['What is your Discord ID?','How old are you?','How active are you on Discord?','Do you have any middleman experience in other servers? List them.','Do you have vouches? How many vouches do you have?','Do you understand you will need to give collateral in case you scam?','How would you handle a middleman trade?','Do you have a private server?','Would you like to add anything at the end?'],
 'Indexer Application':['What is your Discord ID?','How old are you?','How active are you on Discord?','Do you have indexer experience in other servers? List them.','Which base do you have for index?','Would you like to add anything at the end?'],
 'Giveaway Hoster Application':['What is your Discord ID?','How old are you?','How active are you on Discord?','How many rewards can you host weekly?','Do you understand you need to host at least one reward per week?','Would you like to add anything else?']
};
const appChoices = Object.keys(appQuestions);
function embed(title,description,extra={}) { return new EmbedBuilder().setColor(COLOR).setTitle(title).setDescription(description).setTimestamp().setFooter({text:"Sniper's Empire",iconURL:client.user?.displayAvatarURL()}).addFields(extra.fields||[]); }
function isStaff(member) { return !!member && (member.permissions?.has(PermissionsBitField.Flags.Administrator) || STAFF_ROLES.some(id=>member.roles?.cache?.has(id))); }
function requirePerm(msg,perm) { if (!msg.member.permissions.has(perm)) { msg.reply({embeds:[embed('Permission denied',`You need **${perm}** permission to use this command.`)]}); return false; } return true; }
function addCase(guild,target,mod,action,reason,duration=null) {
 const r=db.prepare('INSERT INTO cases(guild_id,target_id,moderator_id,action,reason,created_at,duration) VALUES(?,?,?,?,?,?,?)').run(guild.id,target,mod,action,reason||'No reason provided',new Date().toISOString(),duration);
 return r.lastInsertRowid;
}
async function log(guild,title,description) {
 const id=process.env.LOG_CHANNEL_ID; if(!id) return;
 const ch=await guild.channels.fetch(id).catch(()=>null); if(ch?.isTextBased()) ch.send({embeds:[embed(title,description)]}).catch(()=>{});
}
async function safeReply(msg,text) { try { return await msg.reply(text); } catch { return null; } }
function helpEmbed(category='Moderation Commands') {
 const groups={
 'Moderation Commands':[['ban','s!ban @user [reason]','Ban a member'],['hardban','s!hardban @user [reason]','Ban a user; anti-nuke admins only'],['kick','s!kick @user [reason]','Kick a member'],['mute','s!mute @user minutes [reason]','Timeout a member'],['unmute','s!unmute @user','Remove timeout'],['warn','s!warn @user reason','Create warning case'],['unban','s!unban userID [reason]','Unban user'],['banlist','s!banlist [page]','Paginated ban list'],['modlogs','s!modlogs @user|ID','View cases'],['modstats','s!modstats @user|ID','Moderator statistics'],['void','s!void @user|ID case','Void case'],['antinuke','s!antinuke admin/remove @user','Manage anti-nuke admins']],
 'Fun & Utilities':[['help','s!help','Show this menu'],['ping','s!ping','Gateway latency'],['avatar','s!avatar [@user|ID]','Show avatar'],['serverinfo','s!serverinfo / s!si','Server information'],['nick','s!nick @user nickname','Change nickname'],['clearnick','s!clearnick @user','Clear nickname'],['strip','s!strip @user','Remove manageable roles'],['autoskull','s!autoskull','Toggle skull reactions'],['clean','s!clean','Clean bot command messages'],['purge','s!purge 1-100','Delete recent messages'],['lock','s!lock','Lock channel'],['unlock','s!unlock','Unlock channel'],['8ball','s!8ball question','Magic 8-ball'],['coinflip','s!cf / s!coinflip','Flip a coin'],['afk','s!afk [reason]','Set AFK'],['dih','s!dih [@user]','Random fun response'],['puh','s!puh [@user]','Random fun response'],['compliment','s!compliment','Random compliment'],['highfive','s!highfive @user','High-five a member'],['snipe','s!snipe / s!s','Last deleted message'],['editedsnipe','s!editedsnipe / s!es','Last edited message'],['clearsnipes','s!cs','Clear snipe cache'],['say','s!say [embed] message','Send bot message']],
 'Server & Channel Tools':[['say','s!say message / s!say embed message','Send text/embed'],['snipe','s!snipe','Deleted-message cache'],['editedsnipe','s!editedsnipe','Edited-message cache'],['clearsnipes','s!clearsnipes','Clear cache']],
 'Ticket':[['support','s!support','Post application/support panel'],['ticket add','s!ticket add @user','Grant ticket access'],['ticket remove','s!ticket remove @user','Remove ticket access'],['ticket close','s!ticket close','Close ticket'],['ticket claim','s!ticket claim','Claim ticket'],['ticket transcript','s!ticket transcript','Create text transcript']],
 'Applications':[['application','s!application','Post application panel'],['applications','s!applications','List recent applications'],['apply','s!apply [category]','Start application'],['application close','s!application close','Close applications'],['application open','s!application open','Open applications']]
 };
 const rows=groups[category]||groups['Moderation Commands'];
 return embed(`Help — ${category}`,rows.map(([n,u,d])=>`**${u}** — ${d}`).join('\n').slice(0,4000));
}
function helpRow() { return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('help:category').setPlaceholder('Choose a command category').addOptions(...['Moderation Commands','Fun & Utilities','Server & Channel Tools','Ticket','Applications'].map(x=>({label:x,value:x})))); }
function panelEmbed() { return embed('# Support',"> Before creating a ticket, please read through our https://discord.com/channels/1509295298365886474/1509295299401613541 and Discord's Terms of Service. This ensures you know what is allowed and what isn't.\n\n📍 **Always make sure to pick the right option.**\n\n-# Please select the option below that matches your request. You may be asked a few questions before your ticket is created."); }
function appPanelRow() { return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('app:choose').setPlaceholder('Choose an application').addOptions(...appChoices.map((x,i)=>({label:x, value:x, emoji:['🛡️','🤝','📇','🎁'][i]})))); }
function ticketPanelRow() { return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('ticket:choose').setPlaceholder('Choose a category').addOptions(...['General Support','Report a User','Claim a Reward','Donate stuff','Host a Reward'].map((x,i)=>({label:x,value:x,emoji:['💬','🚩','🎁','📦','🏆'][i]})))); }
async function startApplication(user,guild,type,interactionOrMessage) {
 if (!appQuestions[type]) return;
 const active=sessions.get(user.id);
 if(active) { sessions.delete(user.id); try { await user.send('Your previous in-progress application was cancelled because you started another.'); } catch {} }
 const dm=await user.createDM().catch(()=>null);
 if(!dm) { const t='I could not DM you. Enable **Allow direct messages from server members**, then try again.'; if(interactionOrMessage.reply) return interactionOrMessage.reply({content:t,ephemeral:true}); return safeReply(interactionOrMessage,t); }
 const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`appconfirm:${type}`).setLabel('Confirm').setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId('appcancel').setLabel('Cancel').setStyle(ButtonStyle.Danger));
 const msg=embed('Application Confirmation',`Are you sure you want to begin your application for **${type}**?\n\nYou will be asked **${appQuestions[type].length} questions** through DMs.\n\nStarting this application will cancel any application you currently have in progress.`);
 if(interactionOrMessage.reply) await interactionOrMessage.reply({embeds:[msg],components:[row],ephemeral:true});
 else await interactionOrMessage.reply({embeds:[msg],components:[row]});
}
async function askQuestion(user,session) {
 const q=appQuestions[session.type][session.index];
 await user.send({embeds:[embed(`${session.type}`,`Question **${session.index+1}** of **${appQuestions[session.type].length}**\n\n__${q}__\n\n**Application**\n\n-# Please answer honestly.`)]});
}
async function submitApplication(user,s) {
 const r=db.prepare('INSERT INTO applications(user_id,guild_id,type,answers,status,created_at) VALUES(?,?,?,?,?,?)').run(user.id,s.guildId,s.type,JSON.stringify(s.answers),'submitted',new Date().toISOString());
 const id=Number(r.lastInsertRowid);
 const review=REVIEW_CHANNEL ? await client.channels.fetch(REVIEW_CHANNEL).catch(()=>null) : null;
 if(review?.isTextBased()) {
  const fields=s.answers.map((a,i)=>({name:`${i+1}. ${appQuestions[s.type][i]}`.slice(0,256),value:String(a||'—').slice(0,1024)}));
  const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`review:approve:${id}`).setLabel('Approve').setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId(`review:reject:${id}`).setLabel('Reject').setStyle(ButtonStyle.Danger),new ButtonBuilder().setCustomId(`review:more:${id}`).setLabel('Request more info').setStyle(ButtonStyle.Secondary));
  await review.send({embeds:[embed(`Application #${id} — ${s.type}`,`Applicant: <@${user.id}> (\`${user.id}\`)\nStatus: submitted\nSubmitted: <t:${Math.floor(Date.now()/1000)}:F>`,{fields})],components:[row]});
 }
 sessions.delete(user.id);
 await user.send({embeds:[embed('Application Submitted',`Your application was submitted.\nApplication ID: **${id}**`)]});
}
client.once(Events.ClientReady,c=>console.log(`Ready as ${c.user.tag}`));
client.on(Events.MessageDelete,m=>{if(m.partial||!m.guild||!m.author||m.author.bot)return;deleted.set(m.channelId,{content:m.content||'[no text]',author:m.author.id,at:Date.now(),attachments:[...m.attachments.values()].map(a=>a.url)});});
client.on(Events.MessageUpdate,(oldM,newM)=>{if(oldM.partial||newM.partial||!newM.guild||!oldM.author||oldM.author.bot)return;edited.set(newM.channelId,{before:oldM.content||'',after:newM.content||'',author:oldM.author.id,at:Date.now()});});
client.on(Events.MessageCreate,async m=>{
 if(m.author.bot) return;
 if(m.channel.isDMBased()) {
  const s=sessions.get(m.author.id); if(!s||s.phase!=='questions') return;
  s.answers.push(m.content.slice(0,2000)); s.index++;
  if(s.index>=appQuestions[s.type].length) {
   s.phase='submit';
   const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('app:submit').setLabel('Submit').setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId('app:cancel-submit').setLabel('Cancel').setStyle(ButtonStyle.Danger));
   await m.author.send({embeds:[embed('Confirm Submission',`Are you sure you want to submit?\n\nYou have answered all the questions.\n\nOnce submitted, staff will be able to review your application.\n\nApplication ID: **Pending assignment on submit**`)],components:[row]});
  } else await askQuestion(m.author,s);
  return;
 }
 if(!m.guild) return;
 if(afk.has(m.author.id)) { afk.delete(m.author.id); m.reply('Welcome back! Your AFK status has been removed.').catch(()=>{}); }
 for(const [id,reason] of afk) if(m.mentions.users.has(id)) m.reply(`<@${id}> is AFK: ${reason}`).catch(()=>{});
 if(skullChannels.has(m.channelId)) m.react('💀').catch(()=>{});
 if(!m.content.startsWith(PREFIX)) return;
 const raw=m.content.slice(PREFIX.length).trim(), parts=raw.split(/\s+/), cmd=(parts.shift()||'').toLowerCase(), args=parts;
 const target=m.mentions.members.first(), reason=args.slice(target?1:0).join(' ')||'No reason provided';
 const staffOnly=['application','support','applications','ticket'];
 try {
 switch(cmd) {
 case 'help': { const sent=await m.reply({embeds:[helpEmbed()],components:[helpRow()]}); break; }
 case 'application': case 'support':
  if(!isStaff(m.member)) return safeReply(m,'You need an authorized staff role to post panels.');
  if(cmd==='application') await m.reply({embeds:[panelEmbed()],components:[appPanelRow()]});
  else await m.reply({embeds:[panelEmbed()],components:[ticketPanelRow()]}); break;
 case 'apply': { const type=appChoices.find(x=>x.toLowerCase().startsWith(args.join(' ').toLowerCase())); if(!type) return safeReply(m,`Choose: ${appChoices.join(', ')}`); await startApplication(m.author,m.guild,type,m); break; }
 case 'applications': { if(!isStaff(m.member)) return safeReply(m,'Staff only.'); const rows=db.prepare('SELECT id,user_id,type,status,created_at FROM applications WHERE guild_id=? ORDER BY id DESC LIMIT 15').all(m.guildId); await m.reply({embeds:[embed('Recent Applications',rows.map(x=>`#${x.id} — <@${x.user_id}> — ${x.type} — ${x.status} — ${x.created_at}`).join('\n')||'No applications yet.')]}); break; }
 case 'ban': case 'hardban': case 'kick': case 'warn': {
  const perm=cmd==='kick'?PermissionsBitField.Flags.KickMembers:cmd==='warn'?PermissionsBitField.Flags.ModerateMembers:PermissionsBitField.Flags.BanMembers;
  if(!requirePerm(m,perm)) return;
  const id=target?.id||args[0]?.replace(/[<@!>]/g,''); if(!id) return safeReply(m,'Mention a user or provide a user ID.');
  const why=target?args.slice(1).join(' ')||'No reason provided':args.slice(1).join(' ')||'No reason provided';
  if(cmd==='warn') { addCase(m.guild,id,m.author.id,'WARN',why); const u=await client.users.fetch(id).catch(()=>null); if(u) u.send(`You were warned in ${m.guild.name}: ${why}`).catch(()=>{}); await m.reply(`Warning recorded for <@${id}>.`); }
  else if(cmd==='kick') { if(!target) return safeReply(m,'Kick requires a member currently in the server.'); await target.kick(why); const c=addCase(m.guild,id,m.author.id,'KICK',why); await m.reply(`Kicked <@${id}>. Case #${c}.`); }
  else { await m.guild.members.ban(id,{reason:why}); const c=addCase(m.guild,id,m.author.id,cmd.toUpperCase(),why); await m.reply(`Banned <@${id}>. Case #${c}.`); }
  await log(m.guild,`Moderation: ${cmd}`,`Target: <@${id}>\nModerator: ${m.author}\nReason: ${why}`); break;
 }
 case 'unban': { if(!requirePerm(m,PermissionsBitField.Flags.BanMembers)) return; const id=args[0]?.replace(/[<@!>]/g,''); if(!id)return safeReply(m,'Usage: s!unban userID [reason]'); await m.guild.members.unban(id,args.slice(1).join(' ')||'Unban command'); addCase(m.guild,id,m.author.id,'UNBAN',args.slice(1).join(' ')||'No reason provided'); await m.reply(`Unbanned \`${id}\`.`); break; }
 case 'mute': { if(!requirePerm(m,PermissionsBitField.Flags.ModerateMembers))return; if(!target)return safeReply(m,'Mention a member. Usage: s!mute @user minutes [reason]'); const mins=Number(args[1]); if(!Number.isInteger(mins)||mins<1||mins>40320)return safeReply(m,'Duration must be 1–40320 minutes.'); const why=args.slice(2).join(' ')||'No reason provided'; await target.timeout(mins*60000,why); const c=addCase(m.guild,target.id,m.author.id,'TIMEOUT',why,mins); await m.reply(`Timed out ${target} for ${mins} minutes. Case #${c}.`); break; }
 case 'unmute': { if(!requirePerm(m,PermissionsBitField.Flags.ModerateMembers))return; if(!target)return safeReply(m,'Mention a member.'); await target.timeout(null,'Timeout removed'); addCase(m.guild,target.id,m.author.id,'UNTIMEOUT','Timeout removed'); await m.reply(`Removed timeout from ${target}.`); break; }
 case 'banlist': { if(!requirePerm(m,PermissionsBitField.Flags.BanMembers))return; const page=Math.max(1,Number(args[0])||1), bans=await m.guild.bans.fetch(), list=[...bans.values()].slice((page-1)*10,page*10); await m.reply({embeds:[embed(`Ban list — page ${page}`,list.map(b=>`${b.user.tag} (\`${b.user.id}\`) — ${b.reason||'No reason'}`).join('\n')||'No bans on this page.')]}); break; }
 case 'modlogs': { if(!isStaff(m.member))return safeReply(m,'Staff only.'); const id=target?.id||args[0]?.replace(/[<@!>]/g,''); if(!id)return safeReply(m,'Usage: s!modlogs @user|ID'); const rows=db.prepare('SELECT * FROM cases WHERE guild_id=? AND target_id=? ORDER BY id DESC LIMIT 15').all(m.guildId,id); await m.reply({embeds:[embed(`Modlogs: ${id}`,rows.map(x=>`#${x.id} ${x.action} by <@${x.moderator_id}> — ${x.reason}${x.voided?' (VOIDED)':''}`).join('\n')||'No cases found.')]}); break; }
 case 'modstats': { if(!isStaff(m.member))return safeReply(m,'Staff only.'); const id=target?.id||args[0]?.replace(/[<@!>]/g,'')||m.author.id; const rows=db.prepare('SELECT action,COUNT(*) n FROM cases WHERE guild_id=? AND moderator_id=? AND voided=0 GROUP BY action').all(m.guildId,id); await m.reply({embeds:[embed(`Moderator stats: ${id}`,rows.map(x=>`${x.action}: **${x.n}**`).join('\n')||'No cases recorded.')]}); break; }
 case 'void': { if(!requirePerm(m,PermissionsBitField.Flags.ManageGuild))return; const id=args.find(x=>/^\d+$/.test(x)); if(!id)return safeReply(m,'Usage: s!void @user caseNumber'); const r=db.prepare('UPDATE cases SET voided=1 WHERE id=? AND guild_id=?').run(id,m.guildId); await m.reply(r.changes?`Case #${id} voided and retained for audit.`:'Case not found.'); break; }
 case 'antinuke': { if(!m.member.permissions.has(PermissionsBitField.Flags.Administrator))return safeReply(m,'Administrator permission required.'); const u=target||await client.users.fetch(args[1]?.replace(/[<@!>]/g,'')||'').catch(()=>null); if(!u)return safeReply(m,'Usage: s!antinuke admin @user OR s!antinuke remove @user'); if(args[0]==='admin')db.prepare('INSERT OR IGNORE INTO antinuke VALUES(?,?)').run(m.guildId,u.id); else if(args[0]==='remove')db.prepare('DELETE FROM antinuke WHERE guild_id=? AND user_id=?').run(m.guildId,u.id); else return safeReply(m,'Use admin or remove.'); await m.reply(`Anti-nuke admin ${args[0]}: ${u.tag||u.user?.tag||u.id}`); break; }
 case 'nick': { if(!requirePerm(m,PermissionsBitField.Flags.ManageNicknames))return; if(!target||!args.slice(1).join(' '))return safeReply(m,'Usage: s!nick @user nickname'); await target.setNickname(args.slice(1).join(' ').slice(0,32)); await m.reply('Nickname updated.'); break; }
 case 'clearnick': { if(!requirePerm(m,PermissionsBitField.Flags.ManageNicknames))return; if(!target)return safeReply(m,'Mention a member.'); await target.setNickname(null); await m.reply('Nickname cleared.'); break; }
 case 'strip': { if(!requirePerm(m,PermissionsBitField.Flags.ManageRoles))return; if(!target)return safeReply(m,'Mention a member.'); const roles=target.roles.cache.filter(r=>r.id!==m.guild.id&&r.editable); await target.roles.remove(roles); await m.reply(`Removed ${roles.size} manageable roles.`); break; }
 case 'autoskull': { if(!requirePerm(m,PermissionsBitField.Flags.ManageMessages))return; skullChannels.has(m.channelId)?skullChannels.delete(m.channelId):skullChannels.add(m.channelId); await m.reply(`Auto-skull ${skullChannels.has(m.channelId)?'enabled':'disabled'} in this channel.`); break; }
 case 'botclean': { if(!requirePerm(m,PermissionsBitField.Flags.ManageMessages))return; const msgs=await m.channel.messages.fetch({limit:100}); const del=msgs.filter(x=>x.author.id===client.user.id||x.id===m.id); await m.channel.bulkDelete(del,true); break; }
 case 'purge': case 'p': { if(!requirePerm(m,PermissionsBitField.Flags.ManageMessages))return; const n=Number(args[0]); if(!Number.isInteger(n)||n<1||n>100)return safeReply(m,'Amount must be between 1 and 100 (Discord bulk-delete limit).'); const gone=await m.channel.bulkDelete(n,true); const r=await m.channel.send(`Deleted ${gone.size} messages.`); setTimeout(()=>r.delete().catch(()=>{}),4000); break; }
 case 'lock': case 'unlock': { if(!requirePerm(m,PermissionsBitField.Flags.ManageChannels))return; const locked=cmd==='lock'; await m.channel.permissionOverwrites.edit(m.guild.roles.everyone,{SendMessages:!locked}); await m.reply(locked?'Channel locked.':'Channel unlocked.'); break; }
 case 'serverinfo': case 'si': { const g=m.guild; await m.reply({embeds:[embed(g.name,`Owner: <@${g.ownerId}>\nMembers: ${g.memberCount}\nChannels: ${g.channels.cache.size}\nRoles: ${g.roles.cache.size}\nCreated: <t:${Math.floor(g.createdTimestamp/1000)}:F>`,{fields:[]}).setThumbnail(g.iconURL())]}); break; }
 case 'ping': await m.reply(`Pong! Gateway latency: **${client.ws.ping}ms**`); break;
 case 'coinflip': case 'cf': await m.reply(Math.random()<.5?'🪙 Heads!':'🪙 Tails!'); break;
 case '8ball': await m.reply(['Yes.','No.','Definitely.','Ask again later.','It is uncertain.','Absolutely not.'][Math.floor(Math.random()*6)]); break;
 case 'afk': afk.set(m.author.id,args.join(' ')||'AFK'); await m.reply(`AFK set: ${args.join(' ')||'AFK'}`); break;
 case 'dih': await m.reply(`${target||m.author}: Your dih is **${Math.floor(Math.random()*16)-3} inches**.`); break;
 case 'puh': await m.reply(`${target||m.author}: Your puh is **${['tight','big','large','perfect','small','cave'][Math.floor(Math.random()*6)]}**.`); break;
 case 'compliment': case 'compliement': await m.reply({embeds:[embed('A compliment',`${m.author}, you're doing better than you think. 💙`)]}); break;
 case 'highfive': if(!target)return safeReply(m,'Usage: s!highfive @user'); await m.reply({embeds:[embed('High five!',`${m.author} high-fived ${target} for the first time! 🙌`)]}); break;
 case 'avatar': case 'av': { const u=target?.user||await client.users.fetch(args[0]?.replace(/[<@!>]/g,'')||m.author.id).catch(()=>m.author); await m.reply({embeds:[embed(`${u.username}'s avatar`, `[Open avatar](${u.displayAvatarURL({size:1024})})`).setImage(u.displayAvatarURL({size:1024}))]}); break; }
 case 'snipe': case 's': { const x=deleted.get(m.channelId); await m.reply({embeds:[embed('Last deleted message',x?`**Author:** <@${x.author}>\n**Message:** ${x.content}`:'Nothing cached.') ]}); break; }
 case 'editedsnipe': case 'es': { const x=edited.get(m.channelId); await m.reply({embeds:[embed('Last edited message',x?`**Author:** <@${x.author}>\n**Before:** ${x.before}\n**After:** ${x.after}`:'Nothing cached.') ]}); break; }
 case 'clearsnipes': case 'cs': deleted.delete(m.channelId); edited.delete(m.channelId); await m.reply('Snipe cache cleared for this channel.'); break;
 case 'say': { if(!requirePerm(m,PermissionsBitField.Flags.ManageMessages))return; const content=args.join(' ').replace(/^embed\s+/i,''); if(!content)return safeReply(m,'Usage: s!say [embed] message'); if(/^embed\s/i.test(raw.slice(cmd.length).trim())) await m.channel.send({embeds:[embed(' ',content)]}); else await m.channel.send({content}); await m.delete().catch(()=>{}); break; }
 case 'ticket': { if(!isStaff(m.member))return safeReply(m,'Staff only.'); const sub=args[0]; const row=db.prepare('SELECT * FROM tickets WHERE channel_id=?').get(m.channelId); if(!row)return safeReply(m,'This channel is not a registered ticket.'); if(sub==='claim'){db.prepare('UPDATE tickets SET claimed_by=? WHERE channel_id=?').run(m.author.id,m.channelId); await m.reply('Ticket claimed.');} else if(sub==='close'){db.prepare('UPDATE tickets SET status=? WHERE channel_id=?').run('closed',m.channelId); await m.reply('Ticket closed. Channel will be deleted in 5 seconds.'); setTimeout(()=>m.channel.delete().catch(()=>{}),5000);} else if(sub==='add'||sub==='remove'){if(!target)return safeReply(m,`Usage: s!ticket ${sub} @user`); await m.channel.permissionOverwrites.edit(target.id,{ViewChannel:sub==='add',SendMessages:sub==='add'}); await m.reply(`${target} ${sub==='add'?'added to':'removed from'} ticket.`);} else if(sub==='transcript'){const msgs=await m.channel.messages.fetch({limit:100}); const body=[...msgs.values()].reverse().map(x=>`[${new Date(x.createdTimestamp).toISOString()}] ${x.author.tag}: ${x.content}`).join('\n'); await m.author.send({content:'Ticket transcript (last 100 messages):',files:[{attachment:Buffer.from(body||'No messages'),name:`transcript-${m.channel.id}.txt`}]}); await m.reply('Transcript sent in your DMs.');} else await safeReply(m,'Usage: s!ticket add/remove/close/claim/transcript'); break; }
 case 'uptime': await m.reply(`Uptime: ${Math.floor(client.uptime/1000)} seconds.`); break;
 default: break;
 }
 } catch(e) { console.error(`[${cmd}]`,e); await safeReply(m,`Command failed: ${String(e.message||e).slice(0,180)}`); }
});
client.on(Events.InteractionCreate,async i=>{
 try {
 if(i.isStringSelectMenu()&&i.customId==='help:category') return i.update({embeds:[helpEmbed(i.values[0])],components:[helpRow()]});
 if(i.isStringSelectMenu()&&i.customId==='app:choose') { const type=i.values[0]; return startApplication(i.user,i.guild,type,i); }
 if(i.isStringSelectMenu()&&i.customId==='ticket:choose') {
  if(!i.guild) return i.reply({content:'Use this in a server.',ephemeral:true});
  const active=db.prepare("SELECT channel_id FROM tickets WHERE guild_id=? AND owner_id=? AND status='open'").get(i.guildId,i.user.id);
  if(active) return i.reply({content:`You already have an open ticket: <#${active.channel_id}>`,ephemeral:true});
  const parent=process.env.TICKET_CATEGORY_ID||null;
  const ch=await i.guild.channels.create({name:`ticket-${i.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g,'-').slice(0,90),type:ChannelType.GuildText,parent,permissionOverwrites:[{id:i.guild.id,deny:[PermissionsBitField.Flags.ViewChannel]},{id:i.user.id,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages,PermissionsBitField.Flags.ReadMessageHistory]},...STAFF_ROLES.map(id=>({id,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages,PermissionsBitField.Flags.ReadMessageHistory]}))]});
  db.prepare('INSERT INTO tickets(channel_id,guild_id,owner_id,type,status,created_at) VALUES(?,?,?,?,?,?)').run(ch.id,i.guildId,i.user.id,i.values[0],'open',new Date().toISOString());
  await ch.send({content:`<@${i.user.id}> ${STAFF_ROLES.map(x=>`<@&${x}>`).join(' ')}`,embeds:[embed(i.values[0],`Welcome <@${i.user.id}>. Please explain your request. Staff can use \`s!ticket close/claim/transcript\`.`)]});
  return i.reply({content:`Ticket created: ${ch}`,ephemeral:true});
 }
 if(i.isButton()&&i.customId.startsWith('appconfirm:')) {
  const type=i.customId.slice('appconfirm:'.length); if(!appQuestions[type])return i.reply({content:'Unknown application type.',ephemeral:true});
  const dm=await i.user.createDM().catch(()=>null); if(!dm)return i.reply({content:'Your DMs are closed. Enable DMs and try again.',ephemeral:true});
  sessions.set(i.user.id,{type,index:0,answers:[],guildId:i.guildId||process.env.GUILD_ID,phase:'questions'});
  await i.update({embeds:[embed('Application Started',`Your **${type}** has started. Your first question is below.`)],components:[]});
  await askQuestion(i.user,sessions.get(i.user.id)); return;
 }
 if(i.isButton()&&i.customId==='appcancel') return i.update({content:'Application cancelled.',embeds:[],components:[]});
 if(i.isButton()&&i.customId==='app:cancel-submit') {sessions.delete(i.user.id);return i.update({content:'Submission cancelled. Your answers were not submitted.',embeds:[],components:[]});}
 if(i.isButton()&&i.customId==='app:submit') {const s=sessions.get(i.user.id);if(!s||s.phase!=='submit')return i.reply({content:'No completed application found in this session.',ephemeral:true}); await submitApplication(i.user,s); return i.update({content:'Application submitted.',embeds:[],components:[]});}
 if(i.isButton()&&i.customId.startsWith('review:')) {
  if(!i.guild||!isStaff(await i.guild.members.fetch(i.user.id).catch(()=>null)))return i.reply({content:'Authorized staff only.',ephemeral:true});
  const [,action,id]=i.customId.split(':'); const row=db.prepare('SELECT * FROM applications WHERE id=?').get(id); if(!row)return i.reply({content:'Application not found.',ephemeral:true});
  if(action==='more') {db.prepare('UPDATE applications SET status=?,reviewer_id=? WHERE id=?').run('more_info',i.user.id,id); const u=await client.users.fetch(row.user_id).catch(()=>null);if(u)u.send(`Staff requested more information for application #${id}. Please contact staff.`).catch(()=>{});}
  else {db.prepare('UPDATE applications SET status=?,reviewer_id=? WHERE id=?').run(action==='approve'?'approved':'rejected',i.user.id,id); const u=await client.users.fetch(row.user_id).catch(()=>null);if(u)u.send(`Your application #${id} was ${action==='approve'?'approved':'rejected'} by staff.`).catch(()=>{});}
  return i.update({embeds:[EmbedBuilder.from(i.message.embeds[0]).setFooter({text:`Reviewed by **${i.user.tag}** • ${action}`})],components:[]});
 }
 if(!i.isChatInputCommand())return;
 const name=i.commandName, member=i.member, userOpt=i.options.getUser('user'), target=userOpt?await i.guild.members.fetch(userOpt.id).catch(()=>null):null, reason=i.options.getString('reason')||'No reason provided';
 const staffCmd=['application','support','modlogs','modstats','void','antinuke'];
 if(staffCmd.includes(name)&&!isStaff(member))return i.reply({content:'Authorized staff only.',ephemeral:true});
 if(name==='help')return i.reply({embeds:[helpEmbed()],components:[helpRow()]});
 if(name==='application')return i.reply({embeds:[panelEmbed()],components:[appPanelRow()]});
 if(name==='support')return i.reply({embeds:[panelEmbed()],components:[ticketPanelRow()]});
 if(name==='ping')return i.reply(`Pong! Gateway latency: **${client.ws.ping}ms**`);
 if(name==='coinflip')return i.reply(Math.random()<.5?'🪙 Heads!':'🪙 Tails!');
 if(name==='8ball')return i.reply(['Yes.','No.','Definitely.','Ask again later.','It is uncertain.'][Math.floor(Math.random()*5)]);
 if(name==='avatar'){const u=i.options.getUser('user')||i.user;return i.reply({embeds:[embed(`${u.username}'s avatar`, `[Open avatar](${u.displayAvatarURL({size:1024})})`).setImage(u.displayAvatarURL({size:1024}))]});}
 if(name==='serverinfo')return i.reply({embeds:[embed(i.guild.name,`Owner: <@${i.guild.ownerId}>\nMembers: ${i.guild.memberCount}\nChannels: ${i.guild.channels.cache.size}`)]});
 if(name==='afk'){afk.set(i.user.id,i.options.getString('reason')||'AFK');return i.reply({content:'AFK status set.',ephemeral:true});}
 if(name==='purge'){if(!member.permissions.has(PermissionsBitField.Flags.ManageMessages))return i.reply({content:'Manage Messages permission required.',ephemeral:true});const n=i.options.getInteger('amount');const r=await i.channel.bulkDelete(n,true);return i.reply({content:`Deleted ${r.size} messages.`,ephemeral:true});}
 if(name==='lock'||name==='unlock'){if(!member.permissions.has(PermissionsBitField.Flags.ManageChannels))return i.reply({content:'Manage Channels permission required.',ephemeral:true});await i.channel.permissionOverwrites.edit(i.guild.roles.everyone,{SendMessages:name==='unlock'});return i.reply({content:name==='lock'?'Channel locked.':'Channel unlocked.'});}
 if(['ban','hardban','kick','warn','mute','unmute','nick','clearnick','strip'].includes(name)) {
  const perm=({ban:PermissionsBitField.Flags.BanMembers,hardban:PermissionsBitField.Flags.BanMembers,kick:PermissionsBitField.Flags.KickMembers,warn:PermissionsBitField.Flags.ModerateMembers,mute:PermissionsBitField.Flags.ModerateMembers,unmute:PermissionsBitField.Flags.ModerateMembers,nick:PermissionsBitField.Flags.ManageNicknames,clearnick:PermissionsBitField.Flags.ManageNicknames,strip:PermissionsBitField.Flags.ManageRoles})[name];
  if(!member.permissions.has(perm))return i.reply({content:'You lack the required Discord permission.',ephemeral:true});
  const id=userOpt?.id||i.options.getString('user_id'); if(!id)return i.reply({content:'A target user is required.',ephemeral:true});
  if(name==='warn'){const c=addCase(i.guild,id,i.user.id,'WARN',reason);return i.reply(`**${target.user.tag}** has been **warned**`);}
  if(name==='ban'||name==='hardban'){await i.guild.members.ban(id,{reason});const c=addCase(i.guild,id,i.user.id,name.toUpperCase(),reason);return i.reply(`<@${id}> has been **Banned**.`);}
  if(name==='kick'){if(!target)return i.reply({content:'Target must be a current server member.',ephemeral:true});await target.kick(reason);return i.reply(`**${target.user.tag}** has been **Kicked**.`);}
  if(name==='mute'){if(!target)return i.reply({content:'Target must be a current server member.',ephemeral:true});const mins=i.options.getInteger('minutes');await target.timeout(mins*60000,reason);const c=addCase(i.guild,id,i.user.id,'TIMEOUT',reason,mins);return i.reply(`**${target.user.tag}** has been timed-out for a duration of ${mins} minutes.`);}
  if(name==='unmute'){if(!target)return i.reply({content:'Target must be a current server member.',ephemeral:true});await target.timeout(null,reason);return i.reply(`**${target.user.tag}** has been un-timed-out.`);}
  if(name==='nick'){if(!target)return i.reply({content:'Target member not found.',ephemeral:true});await target.setNickname(i.options.getString('nickname'));return i.reply('Nickname updated.');}
  if(name==='clearnick'){if(!target)return i.reply({content:'Target member not found.',ephemeral:true});await target.setNickname(null);return i.reply('Nickname cleared.');}
  if(name==='strip'){if(!target)return i.reply({content:'Target member not found.',ephemeral:true});await target.roles.remove(target.roles.cache.filter(r=>r.id!==i.guild.id&&r.editable));return i.reply('Manageable roles has been **striped**.');}
 }
 if(name==='unban'){if(!member.permissions.has(PermissionsBitField.Flags.BanMembers))return i.reply({content:'Ban Members permission required.',ephemeral:true});const id=i.options.getString('user_id');await i.guild.members.unban(id,reason);return i.reply(`**${id}** has been unbanned.`);}
 if(name==='modlogs'){const id=i.options.getString('user_id')||i.user.id;const rows=db.prepare('SELECT * FROM cases WHERE guild_id=? AND target_id=? ORDER BY id DESC LIMIT 15').all(i.guildId,id);return i.reply({embeds:[embed(`Modlogs: ${id}`,rows.map(x=>`#${x.id} ${x.action} by <@${x.moderator_id}> — ${x.reason}${x.voided?' (VOIDED)':''}`).join('\n')||'No cases found.')]});}
 if(name==='modstats'){const id=i.options.getString('user_id')||i.user.id;const rows=db.prepare('SELECT action,COUNT(*) n FROM cases WHERE guild_id=? AND moderator_id=? AND voided=0 GROUP BY action').all(i.guildId,id);return i.reply({embeds:[embed(`Modstats: ${id}`,rows.map(x=>`${x.action}: ${x.n}`).join('\n')||'No cases.')]});}
 if(name==='void'){if(!member.permissions.has(PermissionsBitField.Flags.ManageGuild))return i.reply({content:'Manage Server permission required.',ephemeral:true});const id=i.options.getInteger('case_id');const r=db.prepare('UPDATE cases SET voided=1 WHERE id=? AND guild_id=?').run(id,i.guildId);return i.reply(r.changes?`Case #${id} voided; audit record retained.`:'Case not found.');}
 if(name==='antinuke'){if(!member.permissions.has(PermissionsBitField.Flags.Administrator))return i.reply({content:'Administrator permission required.',ephemeral:true});const u=userOpt,action=i.options.getString('action');if(action==='add')db.prepare('INSERT OR IGNORE INTO antinuke VALUES(?,?)').run(i.guildId,u.id);else db.prepare('DELETE FROM antinuke WHERE guild_id=? AND user_id=?').run(i.guildId,u.id);return i.reply(`Anti-nuke admin ${action}: ${u.tag}`);}
 if(name==='say'){if(!member.permissions.has(PermissionsBitField.Flags.ManageMessages))return i.reply({content:'Manage Messages permission required.',ephemeral:true});const text=i.options.getString('message');if(i.options.getBoolean('embed'))await i.channel.send({embeds:[embed(' ',text)]});else await i.channel.send(text);return i.reply({content:'Sent.',ephemeral:true});}
 if(name==='autoskull'){if(!member.permissions.has(PermissionsBitField.Flags.ManageMessages))return i.reply({content:'Manage Messages permission required.',ephemeral:true});skullChannels.has(i.channelId)?skullChannels.delete(i.channelId):skullChannels.add(i.channelId);return i.reply(`Auto-skull ${skullChannels.has(i.channelId)?'enabled':'disabled'}.`);}
 if(name==='botclean')return i.reply({content:'Use s!botclean in a text channel to clean bot messages.',ephemeral:true});
 if(name==='dih')return i.reply(`${userOpt||i.user}: Your dih is **${Math.floor(Math.random()*16)-3} inches**.`);
 if(name==='puh')return i.reply(`${userOpt||i.user}: Your puh is **${['tight','big','large','perfect','small','cave'][Math.floor(Math.random()*6)]}**.`);
 if(name==='compliment')return i.reply({embeds:[embed('A compliment',`${i.user}, you're doing better than you think. 💙`)]});
 if(name==='highfive')return i.reply({embeds:[embed('High five!',`${i.user} high-fived ${userOpt||i.user} for the first time! 🙌`)]});
 if(name==='snipe'||name==='editedsnipe'||name==='clearsnipes'){if(name==='clearsnipes'){deleted.delete(i.channelId);edited.delete(i.channelId);return i.reply({content:'Snipe cache cleared.',ephemeral:true});}const x=(name==='snipe'?deleted:edited).get(i.channelId);return i.reply({embeds:[embed(name==='snipe'?'Last deleted message':'Last edited message',x?(name==='snipe'?`**Author:** <@${x.author}>\n**Message:** ${x.content}`:`**Author:** <@${x.author}>\n**Before:** ${x.before}\n**After:** ${x.after}`):'Nothing cached.')]});}
 } catch(e) { console.error('Interaction error:',e); const msg=`Action failed: ${String(e.message||e).slice(0,180)}`; if(i.deferred||i.replied) await i.followUp({content:msg,ephemeral:true}).catch(()=>{}); else await i.reply({content:msg,ephemeral:true}).catch(()=>{}); }
});
client.login(process.env.DISCORD_TOKEN);

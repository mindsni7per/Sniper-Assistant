require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { commands } = require('./slash-commands');
if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) throw new Error('Set DISCORD_TOKEN and CLIENT_ID in .env');
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
(async () => {
  const route = process.env.REGISTRATION_SCOPE === 'global'
    ? Routes.applicationCommands(process.env.CLIENT_ID)
    : Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID);
  await rest.put(route, { body: commands });
  console.log(`Registered ${commands.length} slash commands (${process.env.REGISTRATION_SCOPE || 'guild'} scope).`);
})().catch(e => { console.error(e); process.exit(1); });
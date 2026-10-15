# Sniper's Assistant

Node.js 20+ and discord.js v14. SQLite persistence is stored in `data/snipers.sqlite`.

## Install
1. Install Node.js 20.11 or newer.
2. Extract this folder and run `npm install`.
3. Copy `.env.example` to `.env` and fill in your bot token and application client ID.
4. In Discord Developer Portal, enable **Server Members Intent** and **Message Content Intent** under Bot → Privileged Gateway Intents.
5. Invite the bot with `bot` and `applications.commands` scopes. Grant only the permissions needed for your enabled features (View Channels, Send Messages, Read Message History, Embed Links, Attach Files, Manage Messages, Manage Channels, Manage Roles, Moderate Members, Kick Members, Ban Members, Add Reactions).
6. Register slash commands with `npm run register`.
7. Start with `npm start`.

## Slash command registration
Default `.env.example` registers commands to `GUILD_ID` for fast development updates. Set `REGISTRATION_SCOPE=global` to register globally; global updates can take longer to appear. Re-run `npm run register` after changing `slash-commands.js`.

## Configuration
- `STAFF_ROLE_IDS`: comma-separated IDs allowed to post panels and review applications.
- `REVIEW_CHANNEL_ID`: application review channel.
- `LOG_CHANNEL_ID`: optional moderation log channel.
- `TICKET_CATEGORY_ID`: optional category where ticket channels are created.
- `PREFIX`: default `s!`.
- `EMBED_COLOR`: decimal color value.

Never commit `.env` or your SQLite database. Keep the token secret and reset it immediately if exposed.

## Important implementation notes
- Discord message components appear beneath the embed in the same message; Discord does not allow buttons inside an embed body.
- Purge is capped at 100 because Discord bulk-delete cannot bulk-delete messages older than 14 days.
- Application progress is held in memory while questions are being answered; submitted application records are persisted in SQLite. A process restart will interrupt an in-progress DM interview, so ask the user to restart it. The database persists submissions, cases, and tickets.
- The anti-nuke feature here is an allowlist for the hardban command, not an automatic audit-log-based anti-nuke protection engine.
- A transcript exports the most recent 100 messages as text.
- Message snipe caches are in-memory and reset on restart.
- Some requested visual commands (wanted/RIP generated images, GIF libraries, role picker, quote layout, nuke confirmation, slowmode, roleinfo, membercount, banner, dehoist, softban and full ticket/application lifecycle) are not included in this initial source yet. Add and test those before treating this as a complete production deployment.
- Always test in a private test server first. This source is a functional starting implementation, not a security audit or guarantee of production readiness.

// Run this ONCE (and again any time you add/change commands) to tell
// Discord which slash commands your bot supports.
//
// Usage:  node src/register-commands.js

require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

function addSlotOptions(cmd) {
  for (let i = 1; i <= 4; i++) {
    cmd.addStringOption(opt =>
      opt.setName(`slot${i}`)
        .setDescription(`Slot ${i} — item name/acronym or tag, depending on what you picked above`)
        .setRequired(false)
        .setAutocomplete(true));
  }
  return cmd;
}

const commands = [
  new SlashCommandBuilder()
    .setName('startlogin')
    .setDescription('Begin linking your Roblox account for trade ads')
    .addStringOption(opt =>
      opt.setName('roblox_username')
        .setDescription('Your Roblox username (not your display name)')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('confirm')
    .setDescription('Confirm you have pasted the phrase into your Roblox bio'),

  new SlashCommandBuilder()
    .setName('logout')
    .setDescription('Remove your saved Rolimons login from this bot'),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Check whether you are currently logged in'),

  addSlotOptions(
    new SlashCommandBuilder()
      .setName('create')
      .setDescription('Build or update your trade ad')
      .addStringOption(opt =>
        opt.setName('ad_part')
          .setDescription('Which part of the ad are you setting?')
          .setRequired(true)
          .addChoices(
            { name: 'Offer', value: 'offer' },
            { name: 'Request Items', value: 'request' },
            { name: 'Tags', value: 'tags' },
            { name: 'Offer Robux', value: 'robux' },
            { name: 'Cooldown', value: 'cooldown' },
          ))
  )
    .addIntegerOption(opt =>
      opt.setName('amount')
        .setDescription('For "Offer Robux" (amount of robux) or "Cooldown" (minutes, min 15)')
        .setRequired(false)),

  new SlashCommandBuilder()
    .setName('myad')
    .setDescription('Show your current trade ad setup'),

  new SlashCommandBuilder()
    .setName('viewad')
    .setDescription('View your ad in offer/request/tags/robux/cooldown format'),

  new SlashCommandBuilder()
    .setName('start')
    .setDescription('Start posting your trade ad automatically on your set cooldown'),

  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop automatically posting your trade ad'),

  new SlashCommandBuilder()
    .setName('forcestop')
    .setDescription('[Admin] Stop another user\'s automatic posting')
    .setDefaultMemberPermissions(0) // hidden from everyone except admins by default
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('The user whose posting you want to stop')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('forcestart')
    .setDescription('[Admin] Start another user\'s automatic posting (uses their saved ad)')
    .setDefaultMemberPermissions(0)
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('The user whose posting you want to start')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('snipe')
    .setDescription('Start sniping trade ads requesting an item you own')
    .addStringOption(opt =>
      opt.setName('item')
        .setDescription('The item from your inventory to snipe for')
        .setRequired(true)
        .setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName('stopsnipe')
    .setDescription('Stop sniping for an item')
    .addStringOption(opt =>
      opt.setName('item')
        .setDescription('Which snipe to stop (leave blank to stop all)')
        .setRequired(false)
        .setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName('snipeoptions')
    .setDescription('Set when the bot pings you for snipe matches')
    .addStringOption(opt =>
      opt.setName('mode')
        .setDescription('When to ping you')
        .setRequired(true)
        .addChoices(
          { name: 'All matches (ping on every matching ad)', value: 'all' },
          { name: 'Overpay only (offer value > your item value)', value: 'overpay' },
          { name: 'Threshold (set a minimum overpay %)', value: 'threshold' },
        ))
    .addIntegerOption(opt =>
      opt.setName('threshold')
        .setDescription('Minimum overpay % to ping (only for Threshold mode, e.g. 10 = 10%+)')
        .setRequired(false)),
].map(cmd => cmd.toJSON());

const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN);

(async () => {
  try {
    console.log('Registering slash commands...');
    await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
      { body: commands }
    );
    console.log('Done! Commands registered:', commands.map(c => c.name).join(', '));
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
})();

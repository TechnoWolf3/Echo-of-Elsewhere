const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const echoRift = require('../utils/echoRift');
const echoCurses = require('../utils/echoCurses');

function fmtDate(d) {
  if (!d) return '-';
  const ms = new Date(d).getTime();
  if (!Number.isFinite(ms)) return String(d);
  const unix = Math.floor(ms / 1000);
  return `<t:${unix}:F> (<t:${unix}:R>)`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('riftdebug')
    .setDescription('Admin tools for Echo Rift')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sc => sc.setName('status').setDescription('Show current rift + schedule status'))
    .addSubcommand(sc => sc.setName('spawn').setDescription('Force-spawn a rift now (in the rift channel)'))
    .addSubcommand(sc => sc.setName('clear').setDescription('Force-collapse the active rift (if any)'))
    .addSubcommand(sc =>
      sc.setName('schedule')
        .setDescription('Set next spawn timestamp (unix seconds)')
        .addIntegerOption(o => o.setName('unix').setDescription('Unix timestamp (seconds)').setRequired(true))
    )
    .addSubcommand(sc =>
      sc.setName('chance')
        .setDescription('Toggle chance mode + set daily chance')
        .addBooleanOption(o => o.setName('enabled').setDescription('Enable chance mode?').setRequired(true))
        .addNumberOption(o => o.setName('perday').setDescription('Chance per day (0.0 - 1.0)').setRequired(true))
    )
    .addSubcommand(sc =>
      sc.setName('tax')
        .setDescription('Set (or clear) a Blood Tax for a user')
        .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
        .addIntegerOption(o => o.setName('amount').setDescription('Amount (0 clears)').setRequired(true))
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'status') {
      const { active, sched } = await echoRift.debugStatus(interaction.guildId);
      const e = new EmbedBuilder()
        .setTitle('Echo Rift Debug')
        .setDescription('Current state snapshot')
        .addFields(
          {
            name: 'Active Rift',
            value: active
              ? `Message: ${active.message_id}\nChannel: <#${active.channel_id}>\nExpires: ${fmtDate(active.expires_at)}\nEntered: ${active.entered_user_id ? `<@${active.entered_user_id}>` : '-'}\nStep: ${active.step}/${active.max_steps}\nTier: ${active.tier ?? '-'}\nRisk: ${active.risk ?? 0}`
              : 'None',
          },
          {
            name: 'Schedule',
            value: sched
              ? `Next: ${fmtDate(sched.next_spawn_at)}\nChance mode: ${sched.chance_mode ? 'ON' : 'OFF'}\nChance/day: ${Number(sched.chance_per_day || 1).toFixed(2)}`
              : 'No schedule row yet (will be created automatically)',
          }
        );
      return interaction.reply({ embeds: [e], ephemeral: true });
    }

    if (sub === 'spawn') {
      await interaction.deferReply({ ephemeral: true });
      const res = await echoRift.spawnRift(interaction.client, interaction.guildId);
      if (!res.ok) return interaction.editReply(`Spawn failed: ${res.reason}`);
      return interaction.editReply(`Rift spawned. Message ID: ${res.messageId} (expires <t:${Math.floor(res.expiresAt / 1000)}:R>)`);
    }

    if (sub === 'clear') {
      await interaction.deferReply({ ephemeral: true });
      const res = await echoRift.debugClearActive(interaction.client, interaction.guildId);
      return interaction.editReply(res.cleared ? 'Active rift collapsed.' : 'No active rift to clear.');
    }

    if (sub === 'schedule') {
      const unix = interaction.options.getInteger('unix', true);
      await echoRift.setSchedule(interaction.guildId, { nextSpawnAt: unix * 1000 });
      return interaction.reply({ content: `Next spawn set to <t:${unix}:F> (<t:${unix}:R>)`, ephemeral: true });
    }

    if (sub === 'chance') {
      const enabled = interaction.options.getBoolean('enabled', true);
      const perday = interaction.options.getNumber('perday', true);
      const clamped = Math.max(0, Math.min(1, perday));
      const sched = await echoRift.getSchedule(interaction.guildId);
      await echoRift.setSchedule(interaction.guildId, {
        nextSpawnAt: sched?.next_spawn_at ? new Date(sched.next_spawn_at).getTime() : null,
        chanceMode: enabled,
        chancePerDay: clamped,
      });
      return interaction.reply({ content: `Chance mode is now ${enabled ? 'ON' : 'OFF'} (chance/day: ${clamped.toFixed(2)})`, ephemeral: true });
    }

    if (sub === 'tax') {
      const user = interaction.options.getUser('user', true);
      const amount = interaction.options.getInteger('amount', true);
      if (amount <= 0) {
        await echoCurses.clearCurse(interaction.guildId, user.id, 'blood_tax');
        return interaction.reply({ content: `Cleared Blood Tax for <@${user.id}>.`, ephemeral: true });
      }
      await echoCurses.setCurse(interaction.guildId, user.id, 'blood_tax', { amount, expiresAt: null });
      return interaction.reply({ content: `Set Blood Tax for <@${user.id}> to $${amount.toLocaleString('en-AU')}.`, ephemeral: true });
    }
  },
};

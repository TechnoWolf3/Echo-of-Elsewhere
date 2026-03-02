const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');

const BOT_MASTER_ROLE_ID = '741251069002121236';

function hasBotMaster(member) {
  return member?.roles?.cache?.has?.(BOT_MASTER_ROLE_ID) === true;
}

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

const CATEGORIES = [
  { value: 'economy', label: 'Economy' },
  { value: 'moderation', label: 'Moderation' },
  { value: 'boards', label: 'Boards' },
  { value: 'patchboard', label: 'Patchboard' },
  { value: 'shop', label: 'Shop / Inventory' },
  { value: 'rift', label: 'Echo Rift' },
  { value: 'misc', label: 'Misc' },
];

const ACTIONS_BY_CATEGORY = {
  economy: [
    { id: 'economy:addbalance', label: 'Add Balance', style: ButtonStyle.Primary, modal: true },
    { id: 'economy:addserverbal', label: 'Add Server Bank', style: ButtonStyle.Primary, modal: true },
    { id: 'economy:serverbal', label: 'View Server Bank', style: ButtonStyle.Secondary, modal: false },
  ],
  moderation: [
    { id: 'moderation:purge', label: 'Purge Messages', style: ButtonStyle.Danger, modal: true },
    { id: 'moderation:setheat', label: 'Set Heat', style: ButtonStyle.Secondary, modal: true },
    { id: 'moderation:setjail', label: 'Set Jail', style: ButtonStyle.Secondary, modal: true },
    { id: 'moderation:cooldown_clear', label: 'Clear Cooldowns', style: ButtonStyle.Secondary, modal: true },
    { id: 'moderation:resetach', label: 'Reset Achievements', style: ButtonStyle.Danger, modal: true },
  ],
  boards: [
    { id: 'boards:create', label: 'Board Create', style: ButtonStyle.Primary, modal: true },
    { id: 'boards:update', label: 'Board Update', style: ButtonStyle.Secondary, modal: true },
    { id: 'boards:bump', label: 'Board Bump', style: ButtonStyle.Secondary, modal: true },
    { id: 'boards:list', label: 'Board List', style: ButtonStyle.Secondary, modal: false },
    { id: 'boards:delete', label: 'Board Delete', style: ButtonStyle.Danger, modal: true },
  ],
  patchboard: [
    { id: 'patchboard:set', label: 'Set', style: ButtonStyle.Primary, modal: true },
    { id: 'patchboard:append', label: 'Append', style: ButtonStyle.Secondary, modal: true },
    { id: 'patchboard:overwrite', label: 'Overwrite', style: ButtonStyle.Secondary, modal: true },
    { id: 'patchboard:pause', label: 'Pause', style: ButtonStyle.Secondary, modal: true },
    { id: 'patchboard:resume', label: 'Resume', style: ButtonStyle.Secondary, modal: true },
    { id: 'patchboard:show', label: 'Show', style: ButtonStyle.Secondary, modal: true },
    { id: 'patchboard:repost', label: 'Repost', style: ButtonStyle.Secondary, modal: true },
  ],
  shop: [
    { id: 'shop:add', label: 'Shop Add', style: ButtonStyle.Primary, modal: true },
    { id: 'shop:edit', label: 'Shop Edit', style: ButtonStyle.Secondary, modal: true },
    { id: 'shop:setcategory', label: 'Set Category', style: ButtonStyle.Secondary, modal: true },
    { id: 'shop:enable', label: 'Enable', style: ButtonStyle.Secondary, modal: true },
    { id: 'shop:disable', label: 'Disable', style: ButtonStyle.Secondary, modal: true },
    { id: 'shop:delete', label: 'Delete', style: ButtonStyle.Danger, modal: true },
    { id: 'shop:inv_remove', label: 'Inv Remove', style: ButtonStyle.Danger, modal: true },
  ],
  rift: [
    { id: 'rift:status', label: 'Status', style: ButtonStyle.Secondary, modal: false },
    { id: 'rift:spawn', label: 'Spawn', style: ButtonStyle.Primary, modal: false },
    { id: 'rift:clear', label: 'Clear', style: ButtonStyle.Danger, modal: false },
    { id: 'rift:schedule', label: 'Schedule', style: ButtonStyle.Secondary, modal: true },
    { id: 'rift:chance', label: 'Chance', style: ButtonStyle.Secondary, modal: true },
    { id: 'rift:tax', label: 'Blood Tax', style: ButtonStyle.Secondary, modal: true },
  ],
  misc: [
    { id: 'misc:ping', label: 'Ping', style: ButtonStyle.Secondary, modal: false },
  ],
};

function buildPanelEmbed(category) {
  const cat = CATEGORIES.find(c => c.value === category)?.label ?? 'Economy';
  return new EmbedBuilder()
    .setColor(0x0875AF)
    .setTitle('🛠️ Admin Panel')
    .setDescription('Bot Master controls')
    .addFields({ name: 'Category', value: `**${cat}**`, inline: true })
    .setFooter({ text: `Bot Master Panel • ${cat}` })
    .setTimestamp();
}

function buildCategoryRow(category) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('adminpanel:category')
      .setPlaceholder('Select a category')
      .addOptions(
        CATEGORIES.map(c => ({
          label: c.label,
          value: c.value,
          default: c.value === category,
        }))
      )
  );
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function buildActionRows(category) {
  const actions = ACTIONS_BY_CATEGORY[category] ?? ACTIONS_BY_CATEGORY.economy;
  const rows = [];
  for (const group of chunk(actions, 3)) {
    const row = new ActionRowBuilder();
    for (const a of group) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`adminpanel:btn:${a.id}`)
          .setLabel(a.label)
          .setStyle(a.style)
      );
    }
    rows.push(row);
  }
  return rows;
}

function buildPanelMessage({ category = 'economy' } = {}) {
  return {
    embeds: [buildPanelEmbed(category)],
    components: [buildCategoryRow(category), ...buildActionRows(category)],
  };
}

function parseKeyValueLines(text) {
  const out = {};
  if (!text) return out;
  const lines = String(text)
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    out[key] = val;
  }
  return out;
}

async function fetchUserSafe(client, userId) {
  if (!userId) return null;
  const id = String(userId).replace(/[^0-9]/g, '');
  if (!id) return null;
  return client.users.fetch(id).catch(() => null);
}

async function fetchChannelSafe(guild, channelId) {
  if (!channelId) return null;
  const id = String(channelId).replace(/[^0-9]/g, '');
  if (!id) return null;
  return guild.channels.fetch(id).catch(() => null);
}

async function fetchRoleSafe(guild, roleId) {
  if (!roleId) return null;
  const id = String(roleId).replace(/[^0-9]/g, '');
  if (!id) return null;
  return guild.roles.fetch(id).catch(() => null);
}

function makePseudoOptions({ subcommand = null, values = {} } = {}) {
  return {
    getSubcommand: () => subcommand,
    getUser: (name, required = false) => {
      const v = values[name];
      if (!v && required) throw new Error(`Missing user option: ${name}`);
      return v ?? null;
    },
    getInteger: (name, required = false) => {
      const v = values[name];
      if ((v === undefined || v === null) && required) throw new Error(`Missing integer option: ${name}`);
      const n = v === undefined || v === null ? null : Number(v);
      return n;
    },
    getNumber: (name, required = false) => {
      const v = values[name];
      if ((v === undefined || v === null) && required) throw new Error(`Missing number option: ${name}`);
      const n = v === undefined || v === null ? null : Number(v);
      return n;
    },
    getString: (name, required = false) => {
      const v = values[name];
      if ((v === undefined || v === null || v === '') && required) throw new Error(`Missing string option: ${name}`);
      return v ?? null;
    },
    getBoolean: (name, required = false) => {
      const v = values[name];
      if ((v === undefined || v === null) && required) throw new Error(`Missing boolean option: ${name}`);
      if (v === undefined || v === null) return null;
      if (typeof v === 'boolean') return v;
      return String(v).toLowerCase() === 'true' || String(v) === '1' || String(v).toLowerCase() === 'yes';
    },
    getChannel: (name, required = false) => {
      const v = values[name];
      if (!v && required) throw new Error(`Missing channel option: ${name}`);
      return v ?? null;
    },
    getRole: (name, required = false) => {
      const v = values[name];
      if (!v && required) throw new Error(`Missing role option: ${name}`);
      return v ?? null;
    },
  };
}

function elevatePermsForBotMaster(interaction) {
  // Some legacy commands check Administrator/ManageGuild.
  // If you're Bot Master, we treat you as having those for the purpose of the action.
  if (!hasBotMaster(interaction.member)) return interaction.memberPermissions;

  const fake = {
    has: (perm) => {
      if (perm === PermissionFlagsBits.Administrator) return true;
      if (perm === PermissionFlagsBits.ManageGuild) return true;
      return interaction.memberPermissions?.has?.(perm) ?? false;
    },
  };
  return fake;
}

async function runLegacyCommand({ interaction, commandFile, subcommand = null, values = {} }) {
  const cmd = require(commandFile);

  // Prepare pseudo options
  interaction.options = makePseudoOptions({ subcommand, values });

  // For role/permission checks
  interaction.memberPermissions = elevatePermsForBotMaster(interaction);

  return cmd.execute(interaction);
}

function buildModal(actionId) {
  const modal = new ModalBuilder().setCustomId(`adminpanel:modal:${actionId}`).setTitle('Admin Panel');

  const addInput = (customId, label, style, required = true, placeholder = '') =>
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId(customId)
        .setLabel(label)
        .setStyle(style)
        .setRequired(required)
        .setPlaceholder(placeholder)
    );

  // Economy
  if (actionId === 'economy:addbalance') {
    modal.setTitle('Add Balance');
    modal.addComponents(
      addInput('user_id', 'User ID (or mention)', TextInputStyle.Short, true, '123456789012345678'),
      addInput('amount', 'Amount', TextInputStyle.Short, true, '1000')
    );
    return modal;
  }

  if (actionId === 'economy:addserverbal') {
    modal.setTitle('Add Server Bank');
    modal.addComponents(addInput('amount', 'Amount', TextInputStyle.Short, true, '5000'));
    return modal;
  }

  // Moderation
  if (actionId === 'moderation:purge') {
    modal.setTitle('Purge Messages');
    modal.addComponents(addInput('amount', 'How many messages (1-200)', TextInputStyle.Short, true, '25'));
    return modal;
  }

  if (actionId === 'moderation:setheat') {
    modal.setTitle('Set Heat');
    modal.addComponents(
      addInput('value', 'Heat value (0-100)', TextInputStyle.Short, true, '0'),
      addInput('user_id', 'User ID (blank = you)', TextInputStyle.Short, false, '123...'),
      addInput('ttl', 'TTL minutes (blank = default)', TextInputStyle.Short, false, '60')
    );
    return modal;
  }

  if (actionId === 'moderation:setjail') {
    modal.setTitle('Set Jail');
    modal.addComponents(
      addInput('user_id', 'User ID (or mention)', TextInputStyle.Short, true, '123...'),
      addInput('minutes', 'Minutes (0 clears)', TextInputStyle.Short, true, '10'),
      addInput('reason', 'Reason (optional)', TextInputStyle.Paragraph, false, '—')
    );
    return modal;
  }

  if (actionId === 'moderation:cooldown_clear') {
    modal.setTitle('Clear Cooldowns');
    modal.addComponents(
      addInput('user_id', 'User ID (blank = you)', TextInputStyle.Short, false, '123...'),
      addInput('key', 'Cooldown key (blank=all)', TextInputStyle.Short, false, 'job | crime_heist | all')
    );
    return modal;
  }

  if (actionId === 'moderation:resetach') {
    modal.setTitle('Reset Achievements');
    modal.addComponents(addInput('user_id', 'User ID (or mention)', TextInputStyle.Short, true, '123...'));
    return modal;
  }

  // Boards
  if (actionId.startsWith('boards:')) {
    modal.setTitle(`Board: ${actionId.split(':')[1]}`);
    // For list: no modal
    if (actionId === 'boards:list') return null;

    // Channel required for all but list
    modal.addComponents(addInput('channel_id', 'Channel ID (or #channel)', TextInputStyle.Short, true, '123...'));

    if (actionId === 'boards:create') {
      modal.addComponents(
        addInput('name', 'Board name', TextInputStyle.Short, true, 'Rust'),
        addInput('role_id', 'Role ID (or @role)', TextInputStyle.Short, true, '123...'),
        addInput('emoji', 'Emoji', TextInputStyle.Short, true, '🔥'),
        addInput('description', 'Description (optional)', TextInputStyle.Paragraph, false, '—')
      );
    } else if (actionId === 'boards:update') {
      modal.addComponents(
        addInput('name', 'Board name (optional)', TextInputStyle.Short, false, 'Rust'),
        addInput('role_id', 'Role ID (optional)', TextInputStyle.Short, false, '123...'),
        addInput('emoji', 'Emoji (optional)', TextInputStyle.Short, false, '🔥'),
        addInput('description', 'Description (optional)', TextInputStyle.Paragraph, false, '—')
      );
    } else if (actionId === 'boards:bump') {
      // only channel
    } else if (actionId === 'boards:delete') {
      modal.addComponents(addInput('delete_message', 'Delete message too? (true/false)', TextInputStyle.Short, false, 'false'));
    }

    return modal;
  }

  // Patchboard
  if (actionId.startsWith('patchboard:')) {
    modal.setTitle(`Patchboard: ${actionId.split(':')[1]}`);
    modal.addComponents(addInput('channel_id', 'Channel ID (blank = current channel)', TextInputStyle.Short, false, '123...'));

    if (actionId === 'patchboard:set') {
      modal.addComponents(addInput('title', 'Title (optional)', TextInputStyle.Short, false, 'Patch Notes'));
    } else if (actionId === 'patchboard:append') {
      modal.addComponents(addInput('text', 'Text to append (use \\n for new lines)', TextInputStyle.Paragraph, true, 'Added: ...\\nFixed: ...'));
    } else if (actionId === 'patchboard:overwrite') {
      modal.addComponents(
        addInput('text', 'Full text (use \\n)', TextInputStyle.Paragraph, true, '...'),
        addInput('title', 'Title (optional)', TextInputStyle.Short, false, 'Patch Notes')
      );
    } else {
      // pause/resume/show/repost just channel
    }

    return modal;
  }

  // Shop / inv
  if (actionId.startsWith('shop:')) {
    modal.setTitle(`Shop: ${actionId.split(':')[1]}`);

    if (actionId === 'shop:inv_remove') {
      modal.addComponents(
        addInput('user_id', 'User ID (or mention)', TextInputStyle.Short, true, '123...'),
        addInput('item', 'Item ID', TextInputStyle.Short, true, 'Crime_Kit'),
        addInput('qty', 'Qty (blank if all=true)', TextInputStyle.Short, false, '1'),
        addInput('all', 'Hard delete row? (true/false)', TextInputStyle.Short, false, 'false')
      );
      return modal;
    }

    if (actionId === 'shop:setcategory') {
      modal.addComponents(
        addInput('item_id', 'Item ID', TextInputStyle.Short, true, 'Item_1'),
        addInput('category', 'Category', TextInputStyle.Short, true, 'Tools')
      );
      return modal;
    }

    if (actionId === 'shop:enable' || actionId === 'shop:disable') {
      modal.addComponents(addInput('item_id', 'Item ID', TextInputStyle.Short, true, 'Item_1'));
      return modal;
    }

    if (actionId === 'shop:delete') {
      modal.addComponents(
        addInput('item_id', 'Item ID', TextInputStyle.Short, true, 'Item_1'),
        addInput('wipe_inventory', 'Wipe from all inventories? (true/false)', TextInputStyle.Short, false, 'false')
      );
      return modal;
    }

    // add/edit
    modal.addComponents(
      addInput('item_id', 'Item ID', TextInputStyle.Short, true, 'Item_1'),
      addInput('name', 'Name (required for add)', TextInputStyle.Short, actionId === 'shop:add', 'Cool Item'),
      addInput('price', 'Price (required for add)', TextInputStyle.Short, actionId === 'shop:add', '250'),
      addInput('extras', 'Optional settings (key=value per line)', TextInputStyle.Paragraph, false, 'kind=item\nstackable=true\nsell_enabled=false')
    );
    return modal;
  }

  // Rift
  if (actionId.startsWith('rift:')) {
    modal.setTitle(`Rift: ${actionId.split(':')[1]}`);
    if (actionId === 'rift:schedule') {
      modal.addComponents(addInput('unix', 'Next spawn unix (seconds)', TextInputStyle.Short, true, String(nowUnix() + 3600)));
      return modal;
    }
    if (actionId === 'rift:chance') {
      modal.addComponents(
        addInput('enabled', 'Enabled? (true/false)', TextInputStyle.Short, true, 'true'),
        addInput('perday', 'Chance per day (0.0 - 1.0)', TextInputStyle.Short, true, '0.25')
      );
      return modal;
    }
    if (actionId === 'rift:tax') {
      modal.addComponents(
        addInput('user_id', 'User ID (or mention)', TextInputStyle.Short, true, '123...'),
        addInput('amount', 'Amount (0 clears)', TextInputStyle.Short, true, '1000')
      );
      return modal;
    }
    return null;
  }

  return null;
}

async function handleInteraction(interaction) {
  // Only handle our custom IDs
  const cid = interaction.customId;
  if (typeof cid !== 'string' || !cid.startsWith('adminpanel:')) return false;

  // Role gate for any interaction
  if (!interaction.inGuild?.() || !interaction.guild) {
    await interaction.reply({ content: '❌ Server only.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  const isBotMaster = hasBotMaster(interaction.member);
  if (!isBotMaster) {
    await interaction.reply({ content: '😇 Nope. Bot Master toys are off-limits — don’t be naughty.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  try {
    // Category select
    if (interaction.isStringSelectMenu?.() && cid === 'adminpanel:category') {
      const category = interaction.values?.[0] ?? 'economy';
      const payload = buildPanelMessage({ category });
      await interaction.update(payload);
      return true;
    }

    // Buttons
    if (interaction.isButton?.() && cid.startsWith('adminpanel:btn:')) {
      const actionId = cid.slice('adminpanel:btn:'.length);
      const modal = buildModal(actionId);
      if (modal) {
        await interaction.showModal(modal);
        return true;
      }

      // No modal: run action now
      await runActionFromId({ interaction, actionId, fields: {} });
      return true;
    }

    // Modals
    if (interaction.isModalSubmit?.() && cid.startsWith('adminpanel:modal:')) {
      const actionId = cid.slice('adminpanel:modal:'.length);
      const fields = {};
      for (const [k, v] of interaction.fields.fields) {
        fields[k] = v?.value;
      }

      await runActionFromId({ interaction, actionId, fields });
      return true;
    }

    return false;
  } catch (e) {
    console.error('[ADMINPANEL] interaction failed:', e);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: '❌ Admin panel interaction failed. Check Railway logs.', flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: '❌ Admin panel interaction failed. Check Railway logs.', flags: MessageFlags.Ephemeral });
      }
    } catch (_) {}
    return true;
  }
}

async function runActionFromId({ interaction, actionId, fields }) {
  const base = __dirname; // /utils
  const legacyDir = require('path').join(base, '..', 'commands', '_retired', 'admin');

  const getLegacy = (name) => require('path').join(legacyDir, `${name}.js`);

  const guild = interaction.guild;

  // Helper: resolve mention/id to objects
  const userFromField = async (k) => fetchUserSafe(interaction.client, fields[k]);
  const channelFromField = async (k) => {
    const raw = fields[k];
    if (!raw) return null;
    return fetchChannelSafe(guild, raw);
  };
  const roleFromField = async (k) => {
    const raw = fields[k];
    if (!raw) return null;
    return fetchRoleSafe(guild, raw);
  };

  // ECONOMY
  if (actionId === 'economy:serverbal') {
    return runLegacyCommand({ interaction, commandFile: getLegacy('serverbal') });
  }

  if (actionId === 'economy:addserverbal') {
    return runLegacyCommand({
      interaction,
      commandFile: getLegacy('addserverbal'),
      values: { amount: Number(fields.amount) },
    });
  }

  if (actionId === 'economy:addbalance') {
    const target = await userFromField('user_id');
    if (!target) return interaction.editReply('❌ Could not resolve that user. Use a User ID or mention.');

    return runLegacyCommand({
      interaction,
      commandFile: getLegacy('addbalance'),
      values: { user: target, amount: Number(fields.amount) },
    });
  }

  // MODERATION
  if (actionId === 'moderation:purge') {
    // Patch purge to role gate by elevating perms above.
    return runLegacyCommand({
      interaction,
      commandFile: getLegacy('purge'),
      values: { amount: Number(fields.amount) },
    });
  }

  if (actionId === 'moderation:setheat') {
    const target = (await userFromField('user_id')) ?? interaction.user;
    const ttl = fields.ttl ? Number(fields.ttl) : null;
    return runLegacyCommand({
      interaction,
      commandFile: getLegacy('setheat'),
      values: { value: Number(fields.value), user: target, ttl },
    });
  }

  if (actionId === 'moderation:setjail') {
    const target = await userFromField('user_id');
    if (!target) return interaction.editReply('❌ Could not resolve that user.');
    return runLegacyCommand({
      interaction,
      commandFile: getLegacy('setjail'),
      values: { user: target, minutes: Number(fields.minutes), reason: fields.reason || null },
    });
  }

  if (actionId === 'moderation:cooldown_clear') {
    const target = (await userFromField('user_id')) ?? interaction.user;
    const key = fields.key?.trim() ? fields.key.trim() : null;
    return runLegacyCommand({
      interaction,
      commandFile: getLegacy('cooldown'),
      subcommand: 'clear',
      values: { user: target, key },
    });
  }

  if (actionId === 'moderation:resetach') {
    const target = await userFromField('user_id');
    if (!target) return interaction.editReply('❌ Could not resolve that user.');
    return runLegacyCommand({
      interaction,
      commandFile: getLegacy('resetachievements'),
      values: { user: target },
    });
  }

  // BOARDS
  if (actionId.startsWith('boards:')) {
    const sub = actionId.split(':')[1];
    if (sub === 'list') {
      return runLegacyCommand({ interaction, commandFile: getLegacy('board'), subcommand: 'list', values: {} });
    }

    const channel = await channelFromField('channel_id');
    if (!channel) return interaction.editReply('❌ Could not resolve that channel. Use Channel ID or #channel mention.');

    if (sub === 'bump') {
      return runLegacyCommand({ interaction, commandFile: getLegacy('board'), subcommand: 'bump', values: { channel } });
    }

    if (sub === 'delete') {
      const delMsg = fields.delete_message ? String(fields.delete_message).toLowerCase() === 'true' : null;
      return runLegacyCommand({
        interaction,
        commandFile: getLegacy('board'),
        subcommand: 'delete',
        values: { channel, delete_message: delMsg },
      });
    }

    if (sub === 'create') {
      const role = await roleFromField('role_id');
      if (!role) return interaction.editReply('❌ Could not resolve that role.');
      return runLegacyCommand({
        interaction,
        commandFile: getLegacy('board'),
        subcommand: 'create',
        values: {
          channel,
          name: fields.name,
          role,
          emoji: fields.emoji,
          description: fields.description || null,
        },
      });
    }

    if (sub === 'update') {
      const role = fields.role_id ? await roleFromField('role_id') : null;
      return runLegacyCommand({
        interaction,
        commandFile: getLegacy('board'),
        subcommand: 'update',
        values: {
          channel,
          name: fields.name || null,
          role,
          emoji: fields.emoji || null,
          description: fields.description || null,
        },
      });
    }
  }

  // PATCHBOARD
  if (actionId.startsWith('patchboard:')) {
    const sub = actionId.split(':')[1];
    const channel = fields.channel_id ? await channelFromField('channel_id') : null;
    const values = {};
    if (channel) values.channel = channel;
    if (sub === 'set') {
      if (fields.title) values.title = fields.title;
    }
    if (sub === 'append' || sub === 'overwrite') {
      values.text = fields.text;
      if (sub === 'overwrite' && fields.title) values.title = fields.title;
    }

    return runLegacyCommand({
      interaction,
      commandFile: getLegacy('patchboard'),
      subcommand: sub,
      values,
    });
  }

  // SHOP
  if (actionId.startsWith('shop:')) {
    const sub = actionId.split(':')[1];

    if (sub === 'inv_remove') {
      const target = await userFromField('user_id');
      if (!target) return interaction.editReply('❌ Could not resolve that user.');
      const qty = fields.qty ? Number(fields.qty) : null;
      const all = fields.all ? String(fields.all).toLowerCase() === 'true' : null;
      return runLegacyCommand({
        interaction,
        commandFile: getLegacy('invadmin'),
        subcommand: 'remove',
        values: { user: target, item: fields.item, qty, all },
      });
    }

    // shopadmin subcommands
    const extras = parseKeyValueLines(fields.extras);

    if (sub === 'add' || sub === 'edit') {
      const values = {
        item_id: fields.item_id,
      };
      if (fields.name) values.name = fields.name;
      if (fields.price) values.price = Number(fields.price);

      // Optional fields from extras
      for (const [k, v] of Object.entries(extras)) {
        values[k] = v;
      }

      return runLegacyCommand({
        interaction,
        commandFile: getLegacy('shopadmin'),
        subcommand: sub,
        values,
      });
    }

    if (sub === 'setcategory') {
      return runLegacyCommand({
        interaction,
        commandFile: getLegacy('shopadmin'),
        subcommand: 'setcategory',
        values: { item_id: fields.item_id, category: fields.category },
      });
    }

    if (sub === 'enable' || sub === 'disable') {
      return runLegacyCommand({
        interaction,
        commandFile: getLegacy('shopadmin'),
        subcommand: sub,
        values: { item_id: fields.item_id },
      });
    }

    if (sub === 'delete') {
      const wipe = fields.wipe_inventory ? String(fields.wipe_inventory).toLowerCase() === 'true' : null;
      return runLegacyCommand({
        interaction,
        commandFile: getLegacy('shopadmin'),
        subcommand: 'delete',
        values: { item_id: fields.item_id, wipe_inventory: wipe },
      });
    }
  }

  // RIFT
  if (actionId.startsWith('rift:')) {
    const sub = actionId.split(':')[1];
    if (sub === 'status' || sub === 'spawn' || sub === 'clear') {
      return runLegacyCommand({ interaction, commandFile: getLegacy('riftdebug'), subcommand: sub, values: {} });
    }

    if (sub === 'schedule') {
      return runLegacyCommand({
        interaction,
        commandFile: getLegacy('riftdebug'),
        subcommand: 'schedule',
        values: { unix: Number(fields.unix) },
      });
    }

    if (sub === 'chance') {
      return runLegacyCommand({
        interaction,
        commandFile: getLegacy('riftdebug'),
        subcommand: 'chance',
        values: { enabled: String(fields.enabled).toLowerCase() === 'true', perday: Number(fields.perday) },
      });
    }

    if (sub === 'tax') {
      const target = await userFromField('user_id');
      if (!target) return interaction.editReply('❌ Could not resolve that user.');
      return runLegacyCommand({
        interaction,
        commandFile: getLegacy('riftdebug'),
        subcommand: 'tax',
        values: { user: target, amount: Number(fields.amount) },
      });
    }
  }

  // MISC
  if (actionId === 'misc:ping') {
    return runLegacyCommand({ interaction, commandFile: getLegacy('ping') });
  }

  return interaction.editReply('❌ Unknown admin panel action.');
}

module.exports = {
  buildPanelMessage,
  handleInteraction,
};

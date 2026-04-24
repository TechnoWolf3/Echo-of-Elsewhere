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
const botGames = require('./botGames');
const lottery = require('./lottery');
const effectSystem = require('./effectSystem');
const {
  getStockAdminView,
  setStockCurrentPrice,
  setStockNextTickPrice,
  setStockFloor,
  clearStockFloor,
  resetStockToLaunch,
} = require('./ese/engine');
const contracts = require('./contracts');
const farming = require('./farming/engine');
const seasonControl = require('./farming/seasonControl');
const channelPurger = require('./channelPurger');

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
  { value: 'effects', label: 'Effects' },
  { value: 'patchboard', label: 'Patchboard' },
  { value: 'shop', label: 'Shop / Inventory' },
  { value: 'botgames', label: 'Bot Games' },
  { value: 'rift', label: 'Echo Rift' },
  { value: 'ese', label: 'Echo Stock Exchange' },
  { value: 'contracts', label: 'Contracts' },
  { value: 'enterprises', label: 'Enterprises' },
  { value: 'misc', label: 'Misc' },
];

const ACTIONS_BY_CATEGORY = {
  economy: [
    { id: 'economy:addbalance', label: 'Add Balance', style: ButtonStyle.Primary, modal: true },
    { id: 'economy:addserverbal', label: 'Add Server Bank', style: ButtonStyle.Primary, modal: true },
    { id: 'economy:serverbal', label: 'View Server Bank', style: ButtonStyle.Secondary, modal: false },
    { id: 'economy:powerballbuyers', label: 'Powerball Buyers', style: ButtonStyle.Secondary, modal: false },
  ],
  effects: [
    { id: 'effects:give', label: 'Give Effect', style: ButtonStyle.Primary, modal: true },
    { id: 'effects:view', label: 'View Active', style: ButtonStyle.Secondary, modal: true },
    { id: 'effects:clear', label: 'Clear Effect', style: ButtonStyle.Danger, modal: true },
    { id: 'effects:list', label: 'List Effects', style: ButtonStyle.Secondary, modal: false },
  ],
  moderation: [
    { id: 'moderation:purge', label: 'Purge Messages', style: ButtonStyle.Danger, modal: true },
    { id: 'moderation:purge_schedule', label: 'Schedule Purge', style: ButtonStyle.Primary, modal: true },
    { id: 'moderation:purge_status', label: 'Purge Status', style: ButtonStyle.Secondary, modal: false },
    { id: 'moderation:purge_disable', label: 'Disable Purge', style: ButtonStyle.Secondary, modal: false },
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
  botgames: [
    { id: 'botgames:status', label: 'Status', style: ButtonStyle.Secondary, modal: false },
    { id: 'botgames:spawn_random', label: 'Spawn Random', style: ButtonStyle.Primary, modal: false },
    { id: 'botgames:spawn_mystery', label: 'Spawn Mystery Box', style: ButtonStyle.Primary, modal: false },
    { id: 'botgames:spawn_risk', label: 'Spawn Risk Ladder', style: ButtonStyle.Primary, modal: false },
    { id: 'botgames:force_spawn', label: 'Force Spawn…', style: ButtonStyle.Secondary, modal: true },
    { id: 'botgames:expire', label: 'Force Expire', style: ButtonStyle.Danger, modal: false },
  ],
  rift: [
    { id: 'rift:status', label: 'Status', style: ButtonStyle.Secondary, modal: false },
    { id: 'rift:spawn', label: 'Spawn', style: ButtonStyle.Primary, modal: false },
    { id: 'rift:clear', label: 'Clear', style: ButtonStyle.Danger, modal: false },
    { id: 'rift:schedule', label: 'Schedule', style: ButtonStyle.Secondary, modal: true },
    { id: 'rift:chance', label: 'Chance', style: ButtonStyle.Secondary, modal: true },
    { id: 'rift:tax', label: 'Blood Tax', style: ButtonStyle.Secondary, modal: true },
  ],
  ese: [
    { id: 'ese:view', label: 'View Stock', style: ButtonStyle.Secondary, modal: true },
    { id: 'ese:setnow', label: 'Set Price Now', style: ButtonStyle.Primary, modal: true },
    { id: 'ese:setnext', label: 'Set Next Tick', style: ButtonStyle.Primary, modal: true },
    { id: 'ese:setfloor', label: 'Set Floor', style: ButtonStyle.Secondary, modal: true },
    { id: 'ese:clearfloor', label: 'Clear Floor', style: ButtonStyle.Secondary, modal: true },
    { id: 'ese:reset', label: 'Reset Stock', style: ButtonStyle.Danger, modal: true },
  ],
  contracts: [
    { id: 'contracts:status', label: 'Status', style: ButtonStyle.Secondary, modal: false },
    { id: 'contracts:toggle_auto', label: 'Toggle Auto', style: ButtonStyle.Primary, modal: false },
    { id: 'contracts:settings', label: 'Settings', style: ButtonStyle.Secondary, modal: true },
    { id: 'contracts:start', label: 'Start Manual', style: ButtonStyle.Primary, modal: true },
    { id: 'contracts:stop', label: 'Stop Active', style: ButtonStyle.Danger, modal: false },
    { id: 'contracts:rotate', label: 'Rotate', style: ButtonStyle.Secondary, modal: false },
    { id: 'contracts:post_daily', label: 'Post Daily Now', style: ButtonStyle.Secondary, modal: false },
  ],
  enterprises: [
    { id: 'enterprises:season_status', label: 'Season Status', style: ButtonStyle.Secondary, modal: false },
    { id: 'enterprises:next_season', label: 'Skip To Next Season', style: ButtonStyle.Primary, modal: false },
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

function parseBool(value, fallback = false) {
  if (value === true || value === false) return value;
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  if (['true', '1', 'yes', 'y', 'on', 'enabled'].includes(raw)) return true;
  if (['false', '0', 'no', 'n', 'off', 'disabled'].includes(raw)) return false;
  return fallback;
}

class AdminPanelValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AdminPanelValidationError';
  }
}

function parseOptionalNumber(value, fieldName, { min = -Infinity, max = Infinity } = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new AdminPanelValidationError(`${fieldName} must be a number${Number.isFinite(min) ? ` >= ${min}` : ''}${Number.isFinite(max) ? ` and <= ${max}` : ''}.`);
  }
  return n;
}

function parseCsvNumbers(value, fieldName) {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  const nums = raw.split(',').map((part) => parseOptionalNumber(part, fieldName, { min: 0 }));
  if (!nums.length || nums.some((n) => n === undefined)) {
    throw new AdminPanelValidationError(`${fieldName} must be comma-separated numbers.`);
  }
  return nums;
}

function normalizeContractMode(value) {
  const mode = String(value || 'random').trim().toLowerCase();
  return ['random', 'co_op', 'competitive'].includes(mode) ? mode : 'random';
}

function cleanId(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

async function fetchUserSafe(client, userId) {
  if (!userId) return null;
  const id = cleanId(userId);
  if (!id) return null;
  return client.users.fetch(id).catch(() => null);
}

async function fetchChannelSafe(guild, channelId) {
  if (!channelId) return null;
  const id = cleanId(channelId);
  if (!id) return null;
  return guild.channels.fetch(id).catch(() => null);
}

async function fetchRoleSafe(guild, roleId) {
  if (!roleId) return null;
  const id = cleanId(roleId);
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

  if (!interaction.__adminPanelReplyShimApplied) {
    interaction.__adminPanelReplyShimApplied = true;
    const origReply = interaction.reply?.bind(interaction);
    const origEditReply = interaction.editReply?.bind(interaction);
    const origFollowUp = interaction.followUp?.bind(interaction);
    const origDeferReply = interaction.deferReply?.bind(interaction);

    if (origReply && origEditReply) {
      interaction.reply = async (payload) => {
        if (interaction.deferred) return origEditReply(payload);
        if (interaction.replied) return origFollowUp ? origFollowUp(payload) : origEditReply(payload);
        return origReply(payload);
      };
    }

    if (origDeferReply) {
      interaction.deferReply = async (payload) => {
        if (interaction.deferred || interaction.replied) {
          return interaction;
        }
        return origDeferReply(payload);
      };
    }

    if (origEditReply && origReply) {
      interaction.editReply = async (payload) => {
        if (!interaction.deferred && !interaction.replied) return origReply(payload);
        return origEditReply(payload);
      };
    }
  }

  return cmd.execute(interaction);
}

function buildModal(actionId) {
  const MAX_MODAL_TITLE = 45;
  const MAX_INPUT_LABEL = 45;
  const MAX_INPUT_PLACEHOLDER = 100;
  const trimForDiscord = (value, max) => String(value ?? '').slice(0, max);
  const modal = new ModalBuilder().setCustomId(`adminpanel:modal:${actionId}`).setTitle('Admin Panel');
  const setTitle = (title) => modal.setTitle(trimForDiscord(title, MAX_MODAL_TITLE));

  const addInput = (customId, label, style, required = true, placeholder = '') =>
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId(customId)
        .setLabel(trimForDiscord(label, MAX_INPUT_LABEL))
        .setStyle(style)
        .setRequired(required)
        .setPlaceholder(trimForDiscord(placeholder, MAX_INPUT_PLACEHOLDER))
    );

  // Economy
  if (actionId === 'economy:addbalance') {
    setTitle('Add Balance');
    modal.addComponents(
      addInput('user_id', 'User ID (or mention)', TextInputStyle.Short, true, '123456789012345678'),
      addInput('amount', 'Amount', TextInputStyle.Short, true, '1000'),
      addInput('target', 'Target (wallet/bank)', TextInputStyle.Short, false, 'wallet')
    );
    return modal;
  }

  if (actionId === 'economy:addserverbal') {
    setTitle('Add Server Bank');
    modal.addComponents(addInput('amount', 'Amount', TextInputStyle.Short, true, '5000'));
    return modal;
  }


  // Effects
  if (actionId === 'effects:give') {
    setTitle('Give Effect');
    modal.addComponents(
      addInput('user_id', 'User ID (or mention)', TextInputStyle.Short, true, '123456789012345678'),
      addInput('effect_id', 'Effect ID', TextInputStyle.Short, true, 'echo_blessing_minor_percent'),
      addInput('duration_minutes', 'Duration minutes (blank = default/random)', TextInputStyle.Short, false, '30'),
      addInput('uses', 'Uses (blank = default)', TextInputStyle.Short, false, '1'),
      addInput('value', 'Value override (blank = default)', TextInputStyle.Short, false, '15')
    );
    return modal;
  }

  if (actionId === 'effects:view') {
    setTitle('View Active Effect');
    modal.addComponents(addInput('user_id', 'User ID (or mention)', TextInputStyle.Short, true, '123456789012345678'));
    return modal;
  }

  if (actionId === 'effects:clear') {
    setTitle('Clear Active Effect');
    modal.addComponents(addInput('user_id', 'User ID (or mention)', TextInputStyle.Short, true, '123456789012345678'));
    return modal;
  }

  // Moderation
  if (actionId === 'moderation:purge') {
    setTitle('Purge Messages');
    modal.addComponents(addInput('amount', 'How many messages (1-200)', TextInputStyle.Short, true, '25'));
    return modal;
  }

  if (actionId === 'moderation:purge_schedule') {
    setTitle('Schedule Channel Purge');
    modal.addComponents(
      addInput('channel_id', 'Channel ID (or #channel)', TextInputStyle.Short, true, '123456789012345678'),
      addInput('frequency_hours', 'Frequency in hours', TextInputStyle.Short, true, '24'),
      addInput('mode', 'Mode: once or recurring', TextInputStyle.Short, true, 'recurring')
    );
    return modal;
  }

  if (actionId === 'moderation:setheat') {
    setTitle('Set Heat');
    modal.addComponents(
      addInput('value', 'Heat value (0-100)', TextInputStyle.Short, true, '0'),
      addInput('user_id', 'User ID (blank = you)', TextInputStyle.Short, false, '123...'),
      addInput('ttl', 'TTL minutes (blank = default)', TextInputStyle.Short, false, '60')
    );
    return modal;
  }

  if (actionId === 'moderation:setjail') {
    setTitle('Set Jail');
    modal.addComponents(
      addInput('user_id', 'User ID (or mention)', TextInputStyle.Short, true, '123...'),
      addInput('minutes', 'Minutes (0 clears)', TextInputStyle.Short, true, '10'),
      addInput('reason', 'Reason (optional)', TextInputStyle.Paragraph, false, '—')
    );
    return modal;
  }

  if (actionId === 'moderation:cooldown_clear') {
    setTitle('Clear Cooldowns');
    modal.addComponents(
      addInput('user_id', 'User ID (blank = you)', TextInputStyle.Short, false, '123...'),
      addInput('key', 'Cooldown key (blank=all)', TextInputStyle.Short, false, 'job | crime_heist | all')
    );
    return modal;
  }

  if (actionId === 'moderation:resetach') {
    setTitle('Reset Achievements');
    modal.addComponents(addInput('user_id', 'User ID (or mention)', TextInputStyle.Short, true, '123...'));
    return modal;
  }

  // Boards
  if (actionId.startsWith('boards:')) {
    setTitle(`Board: ${actionId.split(':')[1]}`);
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

  // Bot Games
  if (actionId === 'botgames:force_spawn') {
    setTitle('Force Spawn Bot Game');
    modal.addComponents(
      addInput('event_id', 'Event ID (blank = random)', TextInputStyle.Short, false, 'mystery_box | risk_ladder | ...'),
      addInput('channel_id', 'Channel ID (blank = configured)', TextInputStyle.Short, false, '123...'),
      addInput('ping', 'Ping role? (true/false)', TextInputStyle.Short, false, 'false'),
      addInput('force', 'Force replace active? (true/false)', TextInputStyle.Short, false, 'false')
    );
    return modal;
  }

  // Patchboard
  if (actionId.startsWith('patchboard:')) {
    setTitle(`Patchboard: ${actionId.split(':')[1]}`);
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
    setTitle(`Shop: ${actionId.split(':')[1]}`);

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

  // Echo Stock Exchange
  if (actionId.startsWith('ese:')) {
    const sub = actionId.split(':')[1];
    setTitle(`ESE: ${sub}`);

    if (sub === 'view') {
      modal.addComponents(addInput('symbol', 'Stock symbol', TextInputStyle.Short, true, 'LOE'));
      return modal;
    }

    if (sub === 'clearfloor') {
      modal.addComponents(
        addInput('symbol', 'Stock symbol', TextInputStyle.Short, true, 'MMR'),
        addInput('headline', 'Custom news headline (blank = default)', TextInputStyle.Paragraph, false, 'MMR has exited protective floor status.')
      );
      return modal;
    }

    if (sub === 'reset') {
      modal.addComponents(
        addInput('symbol', 'Stock symbol', TextInputStyle.Short, true, 'IQC'),
        addInput('headline', 'Custom news headline (blank = default)', TextInputStyle.Paragraph, false, 'IQC has been reset to a healthier trading baseline.')
      );
      return modal;
    }

    if (sub === 'setnow' || sub === 'setnext' || sub === 'setfloor') {
      modal.addComponents(
        addInput('symbol', 'Stock symbol', TextInputStyle.Short, true, 'MMR'),
        addInput('price', sub === 'setfloor' ? 'Floor price' : 'Target price', TextInputStyle.Short, true, '90'),
        addInput('headline', 'Custom news headline (blank = default)', TextInputStyle.Paragraph, false, sub === 'setnext' ? 'MMR has been queued for a manual price adjustment on the next tick.' : 'MMR has been manually rebalanced.')
      );
      return modal;
    }
  }

  // Contracts
  if (actionId.startsWith('contracts:')) {
    const sub = actionId.split(':')[1];
    setTitle(`Contracts: ${sub}`);

    if (sub === 'settings') {
      modal.addComponents(
        addInput('auto_enabled', 'Auto contracts', TextInputStyle.Short, true, 'true / false'),
        addInput('auto_rotate', 'Auto rotate', TextInputStyle.Short, true, 'true / false'),
        addInput('community_mode', 'Community mode', TextInputStyle.Short, true, 'random / co_op / competitive'),
        addInput('daily', 'Daily post settings', TextInputStyle.Paragraph, false, 'enabled=true\nchannel_id=1449217901306581074'),
        addInput('personal', 'Personal contract settings', TextInputStyle.Paragraph, true, 'enabled=true\nslots=3')
      );
      return modal;
    }

    if (sub === 'start') {
      modal.addComponents(
        addInput('template_id', 'Template ID (blank = random from mode)', TextInputStyle.Short, false, 'co_op_shift_surge'),
        addInput('mode', 'Mode (random / co_op / competitive)', TextInputStyle.Short, false, 'random'),
        addInput('duration_hours', 'Duration hours (blank = template)', TextInputStyle.Short, false, '48'),
        addInput('numbers', 'Numeric overrides', TextInputStyle.Paragraph, false, 'target=100\nreward_pool=25000\npenalty_amount=2000\nstandings_rewards=12000,7000,4000\nopt_in=false'),
        addInput('title', 'Title override (blank = template)', TextInputStyle.Short, false, 'Citywide Push')
      );
      return modal;
    }
  }

  // Rift
  if (actionId.startsWith('rift:')) {
    setTitle(`Rift: ${actionId.split(':')[1]}`);
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

async function execute(interaction) {
  if (!interaction.inGuild?.() || !interaction.guild) {
    await interaction.reply({
      content: "❌ Server only.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return;
  }

  const isBotMaster = hasBotMaster(interaction.member);
  if (!isBotMaster) {
    await interaction.reply({
      content: "😇 Nope. Bot Master toys are off-limits — don’t be naughty.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return;
  }

  const payload = buildPanelMessage({ category: "economy" });

  await interaction.reply({
    ...payload,
    flags: MessageFlags.Ephemeral,
  }).catch(() => {});
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
      await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
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

      await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
      await runActionFromId({ interaction, actionId, fields });
      return true;
    }

    return false;
  } catch (e) {
    console.error('[ADMINPANEL] interaction failed:', e);
    try {
      const content = e?.name === 'AdminPanelValidationError'
        ? `❌ ${e.message}`
        : '❌ Admin panel interaction failed. Check Railway logs.';
      if (e?.name === 'AdminPanelValidationError') {
        if (interaction.deferred) {
          await interaction.editReply({ content, flags: MessageFlags.Ephemeral });
        } else if (interaction.replied) {
          await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
        } else {
          await interaction.reply({ content, flags: MessageFlags.Ephemeral });
        }
        return true;
      }
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

  const safeReply = async (content) => {
    const payload = { content, flags: MessageFlags.Ephemeral };
    try {
      if (interaction.deferred) return await interaction.editReply(payload);
      if (interaction.replied) return await interaction.followUp(payload);
      return await interaction.reply(payload);
    } catch (_) {
      try {
        if (interaction.deferred) return await interaction.editReply(payload);
        return await interaction.followUp(payload);
      } catch (_) {}
    }
  };

  // CONTRACTS
  if (actionId.startsWith('contracts:')) {
    const sub = actionId.split(':')[1];

    if (sub === 'status') {
      const settings = await contracts.getSettings(guild.id);
      const active = await contracts.getActiveCommunityContract(guild.id);
      const lines = [
        `📜 **Contracts Status**`,
        `• Auto contracts: **${settings.autoEnabled ? 'ON' : 'OFF'}**`,
        `• Auto rotate: **${settings.autoRotate ? 'ON' : 'OFF'}**`,
        `• Mode: **${settings.communityMode}**`,
        `• Daily posts: **${settings.dailyPostEnabled ? 'ON' : 'OFF'}**`,
        `• Daily channel: ${settings.dailyPostChannelId ? `<#${settings.dailyPostChannelId}>` : 'Not set'}`,
        `• Personal contracts: **${settings.personalEnabled ? 'ON' : 'OFF'}** (${settings.personalSlots} slots)`,
      ];
      if (active) {
        lines.push('', `**Active Community Contract**`, `• ${active.title} (${active.type})`, `• Metric: ${active.metric}`, `• Progress: ${active.progress}/${active.target}`, `• Ends: <t:${Math.floor(new Date(active.ends_at).getTime() / 1000)}:R>`);
      } else {
        lines.push('', 'No active community contract.');
      }
      return safeReply(lines.join('\n'));
    }

    if (sub === 'toggle_auto') {
      const current = await contracts.getSettings(guild.id);
      const next = await contracts.updateSettings(guild.id, { autoEnabled: !current.autoEnabled });
      return safeReply(`✅ Auto contracts are now **${next.autoEnabled ? 'ON' : 'OFF'}**.`);
    }

    if (sub === 'settings') {
      const kv = parseKeyValueLines(fields.personal || '');
      const daily = parseKeyValueLines(fields.daily || '');
      const current = await contracts.getSettings(guild.id);
      const dailyChannelRaw = daily.channel_id ?? fields.daily_post_channel_id ?? current.dailyPostChannelId ?? '';
      const dailyChannelId = cleanId(dailyChannelRaw);
      const personalSlots = parseOptionalNumber(kv.slots ?? current.personalSlots, 'personal slots', { min: 1, max: 10 }) ?? current.personalSlots;
      const next = await contracts.updateSettings(guild.id, {
        autoEnabled: parseBool(fields.auto_enabled, current.autoEnabled),
        autoRotate: parseBool(fields.auto_rotate, current.autoRotate),
        communityMode: normalizeContractMode(fields.community_mode || current.communityMode),
        dailyPostEnabled: parseBool(daily.enabled, current.dailyPostEnabled),
        dailyPostChannelId: dailyChannelId || null,
        personalEnabled: parseBool(kv.enabled, current.personalEnabled),
        personalSlots,
      });
      return safeReply(`✅ Contracts settings updated.\n• Auto: **${next.autoEnabled ? 'ON' : 'OFF'}**\n• Rotate: **${next.autoRotate ? 'ON' : 'OFF'}**\n• Mode: **${next.communityMode}**\n• Daily posts: **${next.dailyPostEnabled ? 'ON' : 'OFF'}**\n• Daily channel: ${next.dailyPostChannelId ? `<#${next.dailyPostChannelId}>` : 'Not set'}\n• Personal: **${next.personalEnabled ? 'ON' : 'OFF'}** (${next.personalSlots} slots)`);
    }

    if (sub === 'start') {
      const nums = parseKeyValueLines(fields.numbers || '');
      const overrides = {
        templateId: String(fields.template_id || '').trim() || null,
        mode: normalizeContractMode(fields.mode),
        durationHours: parseOptionalNumber(fields.duration_hours, 'duration_hours', { min: 1, max: 720 }),
        target: parseOptionalNumber(nums.target, 'target', { min: 1 }),
        rewardPool: parseOptionalNumber(nums.reward_pool, 'reward_pool', { min: 0 }),
        penaltyAmount: parseOptionalNumber(nums.penalty_amount, 'penalty_amount', { min: 0 }),
        standingsRewards: parseCsvNumbers(nums.standings_rewards, 'standings_rewards'),
        optIn: nums.opt_in == null ? undefined : parseBool(nums.opt_in, false),
        title: String(fields.title || '').trim() || undefined,
      };
      const res = await contracts.createCommunityContract(guild.id, {
        ...overrides,
      });
      if (!res.ok) {
        if (res.reason === 'already_active') return safeReply('⚠️ A community contract is already active. Stop or rotate it first.');
        return safeReply(`❌ Could not start a contract: ${res.reason}`);
      }
      return safeReply(`✅ Started **${res.contract.title}** (${res.contract.type}).`);
    }

    if (sub === 'stop') {
      const res = await contracts.stopCommunityContract(guild.id);
      if (!res.ok) return safeReply('⚠️ There is no active community contract to stop.');
      return safeReply('🛑 Active community contract stopped.');
    }

    if (sub === 'rotate') {
      const res = await contracts.forceRotateCommunity(guild.id);
      if (res?.contract) return safeReply(`🔄 Rotated contracts. New active contract: **${res.contract.title}**.`);
      return safeReply('🔄 Rotation triggered, but no new contract could be started.');
    }

    if (sub === 'post_daily') {
      const res = await contracts.postDailyUpdate(interaction.client, guild.id, true);
      if (!res.ok) return safeReply(`⚠️ Could not post the daily contract update: ${res.reason}`);
      return safeReply('✅ Daily contract update posted.');
    }
  }

  // BOT GAMES (Random Events)
  if (actionId.startsWith('botgames:')) {
    const sub = actionId.split(':')[1];

    if (sub === 'status') {
      const info = botGames.debugGetActive();
      if (!info) return safeReply('✅ No active bot game right now.');

      const exp = info.claimedBy ? info.claimedExpiresAt : info.expiresAt;
      const who = info.claimedBy ? `<@${info.claimedBy}>` : '—';
      return safeReply(
        `🎮 **Active Bot Game**\n` +
        `• Event: **${info.eventName}** (\`${info.eventId}\`)\n` +
        `• Claimed by: ${who}\n` +
        `• Expires: <t:${Math.floor((exp || Date.now())/1000)}:R>\n` +
        `• Message: \`${info.messageId}\``
      );
    }

    if (sub === 'expire') {
      const info = botGames.debugGetActive();
      if (!info) return safeReply('✅ Nothing to expire — no active bot game.');
      await botGames.debugExpire(interaction.client, info.claimedBy ? 'claimed' : 'unclaimed');
      return safeReply('🧹 Done. Active bot game expired and buttons disabled.');
    }

    // Spawns
    const map = {
      spawn_random: null,
      spawn_mystery: 'mystery_box',
      spawn_risk: 'risk_ladder',
      force_spawn: fields.event_id?.trim() ? fields.event_id.trim() : null,
    };

    if (sub === 'spawn_random' || sub === 'spawn_mystery' || sub === 'spawn_risk' || sub === 'force_spawn') {
      const eventId = map[sub] ?? null;
      const channelId = fields.channel_id?.trim() ? fields.channel_id.trim() : null;
      const ping = String(fields.ping || '').toLowerCase() === 'true' || String(fields.ping || '') === '1' || String(fields.ping || '').toLowerCase() === 'yes';
      const force = String(fields.force || '').toLowerCase() === 'true' || String(fields.force || '') === '1' || String(fields.force || '').toLowerCase() === 'yes';

      const res = await botGames.debugSpawn(interaction.client, guild, { eventId, channelId, ping, force });
      if (!res.ok) {
        if (res.reason === 'already_active') {
          return safeReply('⚠️ A bot game is already active. Use **Force Expire** or **Force Spawn…** with `force=true`.');
        }
        return safeReply(`❌ Couldn’t spawn: **${res.reason}**`);
      }
      return safeReply(`✅ Spawned **${res.eventName}** (\`${res.eventId}\`) in <#${res.channelId}>.`);
    }

    return safeReply('❌ Unknown botgames action.');
  }

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


  // EFFECTS
  if (actionId.startsWith('effects:')) {
    const sub = actionId.split(':')[1];

    if (sub === 'list') {
      const defs = effectSystem.listEffectDefinitions();
      const lines = defs.map((d) => `• \`${d.id}\` — **${d.name}** (${d.type}, ${d.target}, ${d.modifierMode})${d.enabled ? '' : ' [disabled]'}`);
      const chunks = [];
      let current = `🪄 **Available Effects**\n\n`;
      for (const line of lines) {
        if ((current + line + `\n`).length > 1900) {
          chunks.push(current.trim());
          current = '';
        }
        current += `${line}\n`;
      }
      if (current.trim()) chunks.push(current.trim());
      if (!chunks.length) return safeReply('No effects are currently defined.');
      if (!interaction.deferred && !interaction.replied) {
        await interaction.reply({ content: chunks[0], flags: MessageFlags.Ephemeral });
      } else {
        await interaction.followUp({ content: chunks[0], flags: MessageFlags.Ephemeral });
      }
      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp({ content: chunks[i], flags: MessageFlags.Ephemeral });
      }
      return true;
    }

    const target = await userFromField('user_id');
    if (!target) return safeReply('❌ Could not resolve that user. Use a User ID or mention.');

    if (sub === 'view') {
      const active = await effectSystem.getActiveEffect(guild.id, target.id);
      if (!active) return safeReply(`🪄 **${target.username}** has no active effect.`);
      const def = effectSystem.getDefinition(active.effect_id);
      const lines = [
        `🪄 **Active Effect for ${target.username}**`,
        `• Name: **${def?.name || active.effect_id}**`,
        `• ID: \`${active.effect_id}\``,
        `• Type: **${active.effect_type}**`,
        `• Target: \`${active.target}\``,
        `• Mode: \`${active.modifier_mode}\``,
        `• Value: **${active.modifier_value}**`,
        `• Duration: ${effectSystem.formatActiveEffectLine(active).replace(/^\*\*.*?\*\*\s+—\s+/, '')}`,
      ];
      if (active.expires_at) {
        const ts = Math.floor(new Date(active.expires_at).getTime() / 1000);
        lines.push(`• Expires: <t:${ts}:F> (<t:${ts}:R>)`);
      }
      if (active.uses_remaining !== null && active.uses_remaining !== undefined) {
        lines.push(`• Uses left: **${active.uses_remaining}**`);
      }
      return safeReply(lines.join('\n'));
    }

    if (sub === 'clear') {
      await effectSystem.clearActiveEffect(guild.id, target.id);
      return safeReply(`🧹 Cleared any active effect from **${target.username}**.`);
    }

    if (sub === 'give') {
      const effectId = String(fields.effect_id || '').trim();
      const def = effectSystem.getDefinition(effectId);
      if (!def) return safeReply('❌ Unknown effect ID. Use **List Effects** to see valid IDs.');
      const award = { source: 'admin_panel' };
      if (fields.duration_minutes?.trim()) {
        award.useTime = true;
        award.durationMinutes = Number(fields.duration_minutes.trim());
      }
      if (fields.uses?.trim()) {
        award.useUses = true;
        award.uses = Number(fields.uses.trim());
      }
      if (fields.value?.trim()) {
        award.value = Number(fields.value.trim());
      }
      const result = await effectSystem.awardEffect(guild.id, target.id, effectId, award);
      const notice = result?.notice ? `\n${result.notice}` : '';
      if (result.status === 'awarded') {
        return safeReply(`✅ Applied **${def.name}** to **${target.username}**.${notice}`);
      }
      if (result.status === 'refreshed') {
        return safeReply(`🔄 Refreshed **${def.name}** on **${target.username}**.${notice}`);
      }
      if (result.status === 'rejected_same_curse') {
        return safeReply(`⛔ **${target.username}** already has that curse active.${notice}`);
      }
      if (result.status === 'rejected_existing_other') {
        return safeReply(`⛔ **${target.username}** already has a different active effect (\`${result.activeEffectId}\`).${notice}`);
      }
      return safeReply(`❌ Could not apply that effect to **${target.username}**.`);
    }
  }


  // ENTERPRISES
  if (actionId.startsWith('enterprises:')) {
    const sub = actionId.split(':')[1];

    if (sub === 'season_status') {
      await seasonControl.ensureSeasonStateLoaded(guild.id);
      const summary = seasonControl.getSeasonStateSummary(guild.id);
      const lines = [
        `🌾 **Enterprise Season Status**`,
        `• Current season: **${summary.season}**`,
        `• Next season: **${summary.nextSeason}**`,
        `• Weekly rollover: <t:${Math.floor(summary.nextWeekStartUtcMs / 1000)}:F>`,
        `• Timezone: **Australia/Brisbane**`,
        `• Manual skips applied: **${summary.manualOffsetWeeks}**`,
      ];
      if (summary.lastAdvancedAt) {
        lines.push(`• Last manual skip: <t:${Math.floor(Number(summary.lastAdvancedAt) / 1000)}:R>`);
      }
      return safeReply(lines.join('\n'));
    }

    if (sub === 'next_season') {
      const before = await seasonControl.ensureSeasonStateLoaded(guild.id).then(() => seasonControl.getSeasonStateSummary(guild.id));
      const after = await seasonControl.advanceToNextSeason(guild.id, 1);
      const rollover = await farming.applySeasonRolloverToAllFarms(guild.id);
      await require('./farming/weather').ensureDailyWeatherState(guild.id);
      return safeReply([
        `✅ Farming season advanced.`,
        `• ${before.season} → **${after.season}**`,
        `• Next weekly rollover: <t:${Math.floor(after.nextWeekStartUtcMs / 1000)}:F>`,
        `• Farms updated: **${rollover.changedCount}**`,
      ].join('\n'));
    }

    return safeReply('❌ Unknown enterprises admin action.');
  }

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
      values: { user: target, amount: Number(fields.amount), target: (fields.target || 'wallet').trim().toLowerCase() },
    });
  }

  if (actionId === 'economy:powerballbuyers') {
    const drawUtc = lottery.nextDrawUtcMs();
    const drawKey = lottery.drawKeyFromDrawUtc(drawUtc);
    const buyers = await lottery.listTicketBuyers(guild.id, drawKey, 100);
    const totalTickets = await lottery.countTickets(guild.id, drawKey);
    const drawUnix = Math.floor(drawUtc / 1000);

    if (!buyers.length) {
      return safeReply(`🎟 **Powerball buyers** for <t:${drawUnix}:F>\nNo tickets have been bought yet.`);
    }

    const lines = buyers.map((b, i) => {
      const last = b.last_purchased_at ? Math.floor(new Date(b.last_purchased_at).getTime() / 1000) : null;
      return `${i + 1}. <@${b.user_id}> — **${b.ticket_count}** ticket${b.ticket_count === 1 ? '' : 's'}${last ? ` • last buy <t:${last}:R>` : ''}`;
    });

    const chunks = [];
    let current = `🎟 **Powerball buyers** for <t:${drawUnix}:F>\nTotal tickets sold: **${totalTickets}**\nUnique buyers: **${buyers.length}**\n\n`;
    for (const line of lines) {
      if ((current + line + '\n').length > 1900) {
        chunks.push(current.trim());
        current = '';
      }
      current += `${line}\n`;
    }
    if (current.trim()) chunks.push(current.trim());

    if (!interaction.deferred && !interaction.replied) {
      await interaction.reply({ content: chunks[0], flags: MessageFlags.Ephemeral });
    } else {
      await interaction.followUp({ content: chunks[0], flags: MessageFlags.Ephemeral });
    }
    for (let i = 1; i < chunks.length; i++) {
      await interaction.followUp({ content: chunks[i], flags: MessageFlags.Ephemeral });
    }
    return true;
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

  if (actionId === 'moderation:purge_schedule') {
    const channel = await channelFromField('channel_id');
    if (!channel) return interaction.editReply('❌ Could not resolve that channel. Use Channel ID or #channel mention.');

    try {
      const job = await channelPurger.scheduleFromAdmin(interaction, {
        channel,
        frequencyHours: fields.frequency_hours,
        mode: fields.mode,
      });
      return interaction.editReply({
        content: `✅ Scheduled purge for <#${job.channel_id}>.\n\n${channelPurger.formatScheduleLine(job)}\n\nThis keeps the same channel ID and deletes messages inside the existing channel.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      return interaction.editReply(`❌ ${error.message || 'Could not schedule that purge.'}`);
    }
  }

  if (actionId === 'moderation:purge_status') {
    try {
      const job = await channelPurger.getStatus(interaction.client, guild.id);
      if (!job) return safeReply('ℹ️ No scheduled purge is configured for this server.');
      return safeReply(`🧹 **Scheduled Purge Status**\n\n${channelPurger.formatScheduleLine(job)}\n\nChannel ID will stay the same when this runs.`);
    } catch (error) {
      return safeReply(`❌ ${error.message || 'Could not load purge status.'}`);
    }
  }

  if (actionId === 'moderation:purge_disable') {
    try {
      const job = await channelPurger.disableJob(interaction.client, guild.id);
      if (!job) return safeReply('ℹ️ No scheduled purge was configured for this server.');
      return safeReply(`✅ Disabled scheduled purge for <#${job.channel_id}>.`);
    } catch (error) {
      return safeReply(`❌ ${error.message || 'Could not disable the purge schedule.'}`);
    }
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

  // ESE
  if (actionId.startsWith('ese:')) {
    const sub = actionId.split(':')[1];
    const symbol = String(fields.symbol || '').trim().toUpperCase();
    const headline = String(fields.headline || '').trim();

    if (!symbol) return safeReply('❌ Enter a stock symbol.');

    if (sub === 'view') {
      const view = await getStockAdminView(symbol);
      if (!view) return safeReply(`❌ Stock \`${symbol}\` was not found.`);
      const override = view.override || {};
      const lines = [
        `📈 **${view.company.symbol} — ${view.company.name}**`,
        `• Sector: **${view.company.sector}**`,
        `• Current: **$${Number(view.company.price).toFixed(2)}**`,
        `• Open: **$${Number(view.company.open).toFixed(2)}**`,
        `• High / Low: **$${Number(view.company.high).toFixed(2)}** / **$${Number(view.company.low).toFixed(2)}**`,
        `• 24H: **${Number(view.company.dayChangePercent).toFixed(2)}%**`,
        `• Launch Price: **$${Number(view.launchPrice).toFixed(2)}**`,
        `• Floor: **${override.priceFloor != null ? `$${Number(override.priceFloor).toFixed(2)}` : 'None'}**`,
        `• Next Tick Override: **${override.nextTickPrice != null ? `$${Number(override.nextTickPrice).toFixed(2)}` : 'None'}**`,
        `• Pending Headline: ${override.pendingHeadline ? `\`${override.pendingHeadline}\`` : 'None'}`,
      ];
      return safeReply(lines.join('\n'));
    }

    if (sub === 'setnow') {
      const value = Number(fields.price);
      if (!Number.isFinite(value) || value <= 0) return safeReply('❌ Enter a valid price greater than 0.');
      const result = await setStockCurrentPrice(symbol, value, headline, interaction.user.id);
      return safeReply(`✅ **${result.symbol}** was set to **$${Number(result.price).toFixed(2)}** immediately.\n📰 Next tick headline: ${headline || 'default auto headline'}`);
    }

    if (sub === 'setnext') {
      const value = Number(fields.price);
      if (!Number.isFinite(value) || value <= 0) return safeReply('❌ Enter a valid target price greater than 0.');
      const result = await setStockNextTickPrice(symbol, value, headline, interaction.user.id);
      return safeReply(`✅ **${result.symbol}** will move to **$${Number(result.nextTickPrice).toFixed(2)}** on the next tick.\n📰 Next tick headline: ${headline || 'default auto headline'}`);
    }

    if (sub === 'setfloor') {
      const value = Number(fields.price);
      if (!Number.isFinite(value) || value <= 0) return safeReply('❌ Enter a valid floor price greater than 0.');
      const result = await setStockFloor(symbol, value, headline, interaction.user.id);
      return safeReply(`🛡️ **${result.symbol}** now has a floor at **$${Number(result.priceFloor).toFixed(2)}**.\n📰 Next tick headline: ${headline || 'default auto headline'}`);
    }

    if (sub === 'clearfloor') {
      const result = await clearStockFloor(symbol, headline, interaction.user.id);
      return safeReply(`🧹 Cleared the protective floor for **${result.symbol}**.\n📰 Next tick headline: ${headline || 'default auto headline'}`);
    }

    if (sub === 'reset') {
      const result = await resetStockToLaunch(symbol, headline, interaction.user.id);
      return safeReply(`♻️ **${result.symbol}** was reset to **$${Number(result.price).toFixed(2)}**.\n📰 Next tick headline: ${headline || 'default auto headline'}`);
    }

    return safeReply('❌ Unknown ESE admin action.');
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
        values: { user: target, amount: Number(fields.amount), target: (fields.target || 'wallet').trim().toLowerCase() },
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
  execute,
  buildPanelMessage,
  handleInteraction,
};

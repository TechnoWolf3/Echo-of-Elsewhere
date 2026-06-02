const appLinking = require("./appLinking");
const economy = require("./economy");
const effectSystem = require("./effectSystem");
const guildConfig = require("./guildConfig");
const jail = require("./jail");
const seasonControl = require("./farming/seasonControl");
const farming = require("./farming/engine");
const farmWeather = require("./farming/weather");
const contracts = require("./contracts");
const communityContracts = require("./communityContracts");
const communityService = require("./community/communityService");
const profileIllusions = require("./profileIllusions");
const {
  getStockAdminView,
  setStockCurrentPrice,
  setStockNextTickPrice,
  setStockFloor,
  clearStockFloor,
  resetStockToLaunch,
} = require("./ese/engine");
const { pool } = require("./db");

function field(id, label, type = "text", required = false, options = null) {
  const out = { id, label, type, required: Boolean(required) };
  if (options) out.options = options;
  return out;
}

function appField(fieldDef) {
  if (!fieldDef || typeof fieldDef !== "object") return fieldDef;
  if ((fieldDef.id === "user_id" || fieldDef.id === "discord_user_id") && fieldDef.type === "text") {
    return { ...fieldDef, label: "User", type: "user" };
  }
  return fieldDef;
}

const targetOptions = [
  { label: "Wallet", value: "wallet" },
  { label: "Bank", value: "bank" },
];

const cooldownOptions = [
  { label: "All Cooldowns", value: "" },
  { label: "Daily Ritual", value: "daily" },
  { label: "Weekly Ritual", value: "weekly" },
  { label: "Monthly Ritual", value: "monthly" },
  { label: "Echo Wheel", value: "echo_wheel" },
  { label: "Store Robbery", value: "store_robbery" },
  { label: "Scam Call", value: "scam_call" },
  { label: "Heist", value: "heist" },
  { label: "Store Clerk", value: "store_clerk" },
  { label: "Transport Contract", value: "transport_contract" },
  { label: "Skill Check", value: "skill_check" },
  { label: "Email Sorter", value: "email_sorter" },
  { label: "Shift", value: "shift" },
  { label: "Trucker", value: "trucker" },
];

const ACTIONS = [
  {
    id: "configure:overview",
    category: "configure",
    label: "Overview",
    description: "View server setup and configured admin role.",
    fields: [],
    run: configureOverview,
  },
  {
    id: "economy:addbalance",
    category: "economy",
    label: "Add Balance",
    description: "Add money to a player wallet or bank.",
    requiresConfirmation: true,
    fields: [
      field("user_id", "User ID", "text", true),
      field("amount", "Amount", "number", true),
      field("target", "Target", "select", true, targetOptions),
    ],
    run: addBalance,
  },
  {
    id: "economy:addserverbal",
    category: "economy",
    label: "Add Server Bank",
    description: "Add money to the server bank.",
    requiresConfirmation: true,
    fields: [field("amount", "Amount", "number", true)],
    run: addServerBalance,
  },
  {
    id: "economy:serverbal",
    category: "economy",
    label: "View Server Bank",
    description: "View the server bank balance.",
    fields: [],
    run: serverBalance,
  },
  {
    id: "economy:txlog",
    category: "economy",
    label: "Tx Log",
    description: "Search recent transaction activity.",
    fields: [
      field("user_id", "User ID", "text", false),
      field("search", "Search/category/type", "text", false),
      field("hours", "Hours Back", "number", false),
      field("limit", "Limit", "number", false),
    ],
    run: transactionLog,
  },
  {
    id: "effects:list",
    category: "effects",
    label: "List Effects",
    description: "List available effect IDs.",
    fields: [],
    run: listEffects,
  },
  {
    id: "effects:view",
    category: "effects",
    label: "View Active",
    description: "View active effect for a user.",
    fields: [field("user_id", "User ID", "text", true)],
    run: viewEffect,
  },
  {
    id: "effects:clear",
    category: "effects",
    label: "Clear Effect",
    description: "Clear active effect from a user.",
    requiresConfirmation: true,
    fields: [field("user_id", "User ID", "text", true)],
    run: clearEffect,
  },
  {
    id: "effects:give",
    category: "effects",
    label: "Give Effect",
    description: "Apply an effect to a user.",
    requiresConfirmation: true,
    fields: [
      field("user_id", "User ID", "text", true),
      field("effect_id", "Effect ID", "text", true),
      field("duration_minutes", "Duration Minutes", "number", false),
      field("uses", "Uses", "number", false),
      field("value", "Value Override", "number", false),
    ],
    run: giveEffect,
  },
  {
    id: "moderation:setheat",
    category: "moderation",
    label: "Set Heat",
    description: "Set or clear crime heat.",
    requiresConfirmation: true,
    fields: [
      field("user_id", "User ID", "text", true),
      field("value", "Heat Value", "number", true),
      field("ttl", "TTL Minutes", "number", false),
    ],
    run: setHeat,
  },
  {
    id: "moderation:setjail",
    category: "moderation",
    label: "Set Jail",
    description: "Jail or release a user.",
    requiresConfirmation: true,
    fields: [
      field("user_id", "User ID", "text", true),
      field("minutes", "Minutes", "number", true),
      field("reason", "Reason", "textarea", false),
    ],
    run: setJail,
  },
  {
    id: "moderation:cooldown_clear",
    category: "moderation",
    label: "Clear Cooldowns",
    description: "Clear all or one cooldown key for a user.",
    requiresConfirmation: true,
    fields: [
      field("user_id", "User ID", "text", true),
      {
        ...field("key", "Cooldown", "cooldown", false, cooldownOptions),
        placeholder: "Leave blank for all cooldowns",
      },
    ],
    run: clearCooldowns,
  },
  {
    id: "shop:enable",
    category: "shop",
    label: "Enable Item",
    description: "Enable a store item.",
    fields: [field("item_id", "Item ID", "text", true)],
    run: setShopEnabled,
  },
  {
    id: "shop:disable",
    category: "shop",
    label: "Disable Item",
    description: "Disable a store item.",
    fields: [field("item_id", "Item ID", "text", true)],
    run: setShopEnabled,
  },
  {
    id: "shop:setcategory",
    category: "shop",
    label: "Set Category",
    description: "Set a store item category.",
    fields: [field("item_id", "Item ID", "text", true), field("category", "Category", "text", true)],
    run: setShopCategory,
  },
  {
    id: "shop:delete",
    category: "shop",
    label: "Delete Item",
    description: "Delete a store item, optionally wiping inventories.",
    requiresConfirmation: true,
    fields: [
      field("item_id", "Item ID", "text", true),
      field("wipe_inventory", "Wipe Inventory", "boolean", false),
    ],
    run: deleteShopItem,
  },
  {
    id: "botgames:status",
    category: "botgames",
    label: "Status",
    description: "Show active bot-game runtime state.",
    fields: [],
    run: botGamesStatus,
  },
  {
    id: "rift:status",
    category: "rift",
    label: "Status",
    description: "Show Echo Rift schedule and active rifts.",
    fields: [],
    run: riftStatus,
  },
  {
    id: "ese:view",
    category: "ese",
    label: "View Stock",
    description: "View stock admin state.",
    fields: [field("symbol", "Symbol", "text", true)],
    run: eseView,
  },
  {
    id: "ese:setnow",
    category: "ese",
    label: "Set Price Now",
    description: "Immediately set a stock price.",
    requiresConfirmation: true,
    fields: [field("symbol", "Symbol", "text", true), field("price", "Price", "number", true), field("headline", "Headline", "textarea", false)],
    run: eseSetNow,
  },
  {
    id: "ese:setnext",
    category: "ese",
    label: "Set Next Tick",
    description: "Queue next tick stock price.",
    requiresConfirmation: true,
    fields: [field("symbol", "Symbol", "text", true), field("price", "Price", "number", true), field("headline", "Headline", "textarea", false)],
    run: eseSetNext,
  },
  {
    id: "ese:setfloor",
    category: "ese",
    label: "Set Floor",
    description: "Set stock floor price.",
    requiresConfirmation: true,
    fields: [field("symbol", "Symbol", "text", true), field("price", "Price", "number", true), field("headline", "Headline", "textarea", false)],
    run: eseSetFloor,
  },
  {
    id: "ese:clearfloor",
    category: "ese",
    label: "Clear Floor",
    description: "Clear stock floor price.",
    requiresConfirmation: true,
    fields: [field("symbol", "Symbol", "text", true), field("headline", "Headline", "textarea", false)],
    run: eseClearFloor,
  },
  {
    id: "ese:reset",
    category: "ese",
    label: "Reset Stock",
    description: "Reset stock to launch price.",
    requiresConfirmation: true,
    fields: [field("symbol", "Symbol", "text", true), field("headline", "Headline", "textarea", false)],
    run: eseReset,
  },
  {
    id: "contracts:status",
    category: "contracts",
    label: "Status",
    description: "View contracts status.",
    fields: [],
    run: contractsStatus,
  },
  {
    id: "community:status",
    category: "community",
    label: "Status",
    description: "View community resonance status.",
    fields: [],
    run: communityStatus,
  },
  {
    id: "community_contracts:status",
    category: "community_contracts",
    label: "View Active",
    description: "View active community contract.",
    fields: [],
    run: communityContractsStatus,
  },
  {
    id: "enterprises:season_status",
    category: "enterprises",
    label: "Season Status",
    description: "View farming season status.",
    fields: [],
    run: seasonStatus,
  },
  {
    id: "enterprises:next_season",
    category: "enterprises",
    label: "Skip To Next Season",
    description: "Advance farming season and apply rollover.",
    requiresConfirmation: true,
    fields: [],
    run: nextSeason,
  },
  {
    id: "misc:ping",
    category: "misc",
    label: "Ping",
    description: "API health check.",
    fields: [],
    run: ping,
  },
];

const CATEGORY_META = [
  { id: "configure", label: "Configure", description: "Server setup overview." },
  { id: "economy", label: "Economy", description: "Money and transaction tools." },
  { id: "effects", label: "Effects", description: "Blessing, curse, and modifier tools." },
  { id: "moderation", label: "Moderation", description: "Heat, jail, cooldown, and safety tools." },
  { id: "shop", label: "Shop / Inventory", description: "Store item and inventory tools." },
  { id: "botgames", label: "Bot Games", description: "Bot random-event tools." },
  { id: "rift", label: "Echo Rift", description: "Echo Rift admin tools." },
  { id: "ese", label: "Echo Stock Exchange", description: "Stock exchange controls." },
  { id: "contracts", label: "Contracts", description: "Contract status and controls." },
  { id: "community", label: "Community / Resonance", description: "Community progression status." },
  { id: "community_contracts", label: "Community Contracts", description: "Community contract status." },
  { id: "enterprises", label: "Enterprises / Farming", description: "Farming enterprise controls." },
  { id: "misc", label: "Misc", description: "Small admin utilities." },
];

const ACTION_BY_ID = new Map(ACTIONS.map((action) => [action.id, action]));

function requireDb() {
  if (!pool?.query) {
    const error = new Error("Database is not available.");
    error.statusCode = 503;
    throw error;
  }
}

function cleanId(value) {
  return String(value || "").replace(/[^0-9]/g, "");
}

function asNumber(value, name, { min = -Infinity, max = Infinity } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    const error = new Error(`${name} must be a number${Number.isFinite(min) ? ` >= ${min}` : ""}${Number.isFinite(max) ? ` and <= ${max}` : ""}.`);
    error.statusCode = 400;
    throw error;
  }
  return n;
}

function money(n) {
  return `$${Number(n || 0).toLocaleString()}`;
}

function adminPassword() {
  return String(process.env.ECHO_ADMIN_PANEL_PASSWORD || "").trim();
}

async function assertAdminAccess(ctx, password) {
  requireDb();
  if (!ctx?.guildId || !ctx?.discordUserId) {
    return { ok: false, statusCode: 401, message: "Discord-linked session required." };
  }

  const configuredPassword = adminPassword();
  if (!configuredPassword) {
    return { ok: false, statusCode: 503, message: "Admin panel password is not configured on Railway." };
  }
  if (String(password || "") !== configuredPassword) {
    return { ok: false, statusCode: 403, message: "Invalid admin password." };
  }
  return { ok: true };
}

function categoriesBody() {
  return CATEGORY_META.map((category) => ({
    ...category,
    actions: ACTIONS.filter((action) => action.category === category.id).map((action) => ({
      id: action.id,
      label: action.label,
      description: action.description,
      requiresConfirmation: Boolean(action.requiresConfirmation),
      fields: action.requiresConfirmation
        ? [...action.fields.map(appField), field("confirmation", "Type CONFIRM", "text", true)]
        : action.fields.map(appField),
    })),
  })).filter((category) => category.actions.length > 0);
}

async function list(ctx, password) {
  const access = await assertAdminAccess(ctx, password);
  if (!access.ok) return access;
  await profileIllusions.clearAdminUnlockFailures(ctx.profileId);
  return {
    ok: true,
    body: {
      message: "Admin tools unlocked.",
      categories: categoriesBody(),
    },
  };
}

function discordAvatarUrl(user) {
  if (!user?.id || !user?.avatar) return null;
  const extension = String(user.avatar).startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${extension}?size=128`;
}

async function resolveDiscordUser(discordClient, userId) {
  if (!discordClient?.users || !userId) return null;
  try {
    return discordClient.users.cache?.get?.(userId) || await discordClient.users.fetch(userId);
  } catch {
    return null;
  }
}

async function users(ctx, password, discordClient = null) {
  const access = await assertAdminAccess(ctx, password);
  if (!access.ok) return access;
  await profileIllusions.clearAdminUnlockFailures(ctx.profileId);

  const res = await pool.query(
    `WITH known_users AS (
       SELECT ub.user_id
       FROM user_balances ub
       WHERE ub.guild_id=$1
       UNION
       SELECT li.provider_user_id AS user_id
       FROM linked_identities li
       JOIN profiles p ON p.id = li.profile_id
       WHERE li.provider='discord'
         AND COALESCE(NULLIF(p.primary_guild_id, ''), $1)=$1
     )
     SELECT
       ku.user_id,
       p.id AS profile_id,
       COALESCE(li.display_name, p.display_name) AS display_name,
       ub.account_number
     FROM known_users ku
     LEFT JOIN linked_identities li
       ON li.provider='discord'
      AND li.provider_user_id=ku.user_id
     LEFT JOIN profiles p
       ON p.id=li.profile_id
     LEFT JOIN user_balances ub
       ON ub.guild_id=$1
      AND ub.user_id=ku.user_id
     ORDER BY LOWER(COALESCE(li.display_name, p.display_name, ku.user_id)) ASC
     LIMIT 500`,
    [ctx.guildId]
  );

  const rows = res.rows || [];
  const out = [];
  for (const row of rows) {
    const discordUserId = String(row.user_id || "");
    if (!discordUserId) continue;
    const discordUser = await resolveDiscordUser(discordClient, discordUserId);
    const displayName = String(row.display_name || discordUser?.globalName || discordUser?.username || discordUserId);
    const username = discordUser?.username || null;
    const avatarUrl = discordUser?.displayAvatarURL
      ? discordUser.displayAvatarURL({ extension: "png", size: 128 })
      : discordAvatarUrl(discordUser);
    const accountNumber = row.account_number ? String(row.account_number) : null;
    const profileId = row.profile_id || null;

    out.push({
      profileId,
      profile_id: profileId,
      discordUserId,
      discord_user_id: discordUserId,
      displayName,
      display_name: displayName,
      username,
      avatarUrl,
      avatar_url: avatarUrl,
      accountNumber,
      account_number: accountNumber,
    });
  }

  return { ok: true, body: { users: out } };
}

async function run(ctx, password, _discordClient, actionId, fields = {}) {
  const access = await assertAdminAccess(ctx, password);
  if (!access.ok) return access;
  await profileIllusions.clearAdminUnlockFailures(ctx.profileId);
  const action = ACTION_BY_ID.get(String(actionId || ""));
  if (!action) return { ok: false, statusCode: 404, message: "Admin action is not available to the app." };
  if (action.requiresConfirmation && String(fields.confirmation || "").trim() !== "CONFIRM") {
    return { ok: false, statusCode: 400, message: "This action requires confirmation." };
  }

  const result = await action.run({ ctx, fields, access, actionId: action.id });
  const profile = await appLinking.buildProfileSnapshot(ctx.profileId);
  return {
    ok: true,
    body: {
      status: "ok",
      message: result.message,
      result: result.result || {},
      profile,
    },
  };
}

async function failedUnlock(ctx) {
  if (!ctx?.profileId) {
    return { ok: false, statusCode: 401, message: "Valid app session required." };
  }
  const recorded = await profileIllusions.recordAdminUnlockFailure(ctx.profileId);
  const profile = await appLinking.buildProfileSnapshot(ctx.profileId);
  return {
    ok: true,
    body: {
      status: recorded.illusion ? "illusion_active" : "failed_recorded",
      failedAttempts: recorded.failedAttempts,
      message: "Admin password rejected.",
      profile,
    },
  };
}

async function configureOverview({ ctx }) {
  const cfg = await guildConfig.getGuildConfig(ctx.guildId);
  return {
    message: "Configure overview loaded.",
    result: {
      botChannelId: cfg?.bot_channel_id || null,
      featureHubChannelId: cfg?.feature_hub_channel_id || null,
      powerballChannelId: cfg?.powerball_channel_id || null,
      eseNewsChannelId: cfg?.ese_news_channel_id || null,
      botMasterRoleId: cfg?.bot_master_role_id || null,
    },
  };
}

async function addBalance({ ctx, fields }) {
  const userId = cleanId(fields.user_id);
  const amount = Math.floor(asNumber(fields.amount, "amount", { min: 1 }));
  const target = String(fields.target || "wallet").toLowerCase() === "bank" ? "bank" : "wallet";
  if (!userId) throw Object.assign(new Error("user_id is required."), { statusCode: 400 });
  await economy.ensureUser(ctx.guildId, userId);
  const column = target === "bank" ? "bank_balance" : "balance";
  const update = await pool.query(
    `UPDATE user_balances SET ${column} = ${column} + $3 WHERE guild_id=$1 AND user_id=$2 RETURNING ${column}`,
    [ctx.guildId, userId, amount]
  );
  const tx = await pool.query(
    `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
     VALUES ($1, $2, $3, 'admin_addbalance_mint', $4)
     RETURNING id`,
    [ctx.guildId, userId, amount, { by: ctx.discordUserId, target, source: "app_adminpanel" }]
  );
  return {
    message: `Added ${money(amount)} to ${target}.`,
    result: { transactionId: tx.rows?.[0]?.id || null, balance: Number(update.rows?.[0]?.[column] || 0) },
  };
}

async function addServerBalance({ ctx, fields }) {
  const amount = Math.floor(asNumber(fields.amount, "amount", { min: 1 }));
  const bankBalance = await economy.addServerBank(ctx.guildId, amount, "add_server_bank", {
    by: ctx.discordUserId,
    source: "app_adminpanel",
  });
  return { message: `Added ${money(amount)} to the server bank.`, result: { serverBankBalance: bankBalance } };
}

async function serverBalance({ ctx }) {
  const serverBankBalance = await economy.getServerBank(ctx.guildId);
  return { message: "Server bank loaded.", result: { serverBankBalance } };
}

async function transactionLog({ ctx, fields }) {
  const userId = cleanId(fields.user_id || "");
  const hours = Math.floor(asNumber(fields.hours || 24, "hours", { min: 1, max: 720 }));
  const limit = Math.floor(asNumber(fields.limit || 10, "limit", { min: 1, max: 25 }));
  const search = String(fields.search || "").trim();
  const params = [ctx.guildId, hours];
  const where = ["guild_id=$1", "created_at >= NOW() - ($2::int * INTERVAL '1 hour')"];
  if (userId) {
    params.push(userId);
    where.push(`user_id=$${params.length}`);
  }
  if (search) {
    params.push(search.includes("%") ? search : `%${search}%`);
    where.push(`type ILIKE $${params.length}`);
  }
  params.push(limit);
  const rows = await pool.query(
    `SELECT id, user_id, amount, type, meta, created_at
     FROM transactions
     WHERE ${where.join(" AND ")}
     ORDER BY created_at DESC, id DESC
     LIMIT $${params.length}`,
    params
  );
  return { message: "Transaction log loaded.", result: { transactions: rows.rows || [] } };
}

async function listEffects() {
  return {
    message: "Effects loaded.",
    result: { effects: effectSystem.listEffectDefinitions() },
  };
}

async function viewEffect({ ctx, fields }) {
  const userId = cleanId(fields.user_id);
  if (!userId) throw Object.assign(new Error("user_id is required."), { statusCode: 400 });
  const active = await effectSystem.getActiveEffect(ctx.guildId, userId);
  return { message: active ? "Active effect loaded." : "No active effect.", result: { effect: active || null } };
}

async function clearEffect({ ctx, fields }) {
  const userId = cleanId(fields.user_id);
  if (!userId) throw Object.assign(new Error("user_id is required."), { statusCode: 400 });
  await effectSystem.clearActiveEffect(ctx.guildId, userId);
  return { message: "Active effect cleared.", result: { userId } };
}

async function giveEffect({ ctx, fields }) {
  const userId = cleanId(fields.user_id);
  const effectId = String(fields.effect_id || "").trim();
  const def = effectSystem.getDefinition(effectId);
  if (!userId || !def) throw Object.assign(new Error("Valid user_id and effect_id are required."), { statusCode: 400 });
  const award = { source: "app_adminpanel", by: ctx.discordUserId };
  if (fields.duration_minutes !== undefined && fields.duration_minutes !== "") {
    award.useTime = true;
    award.durationMinutes = asNumber(fields.duration_minutes, "duration_minutes", { min: 1 });
  }
  if (fields.uses !== undefined && fields.uses !== "") {
    award.useUses = true;
    award.uses = asNumber(fields.uses, "uses", { min: 1 });
  }
  if (fields.value !== undefined && fields.value !== "") {
    award.value = asNumber(fields.value, "value");
  }
  const result = await effectSystem.awardEffect(ctx.guildId, userId, effectId, award);
  return { message: `Effect ${result.status || "updated"}.`, result };
}

async function setHeat({ ctx, fields }) {
  const userId = cleanId(fields.user_id);
  const value = Math.floor(asNumber(fields.value, "value", { min: 0, max: 100 }));
  const ttl = Math.floor(asNumber(fields.ttl || 60, "ttl", { min: 1, max: 4320 }));
  if (!userId) throw Object.assign(new Error("user_id is required."), { statusCode: 400 });
  if (value === 0) {
    const res = await pool.query(`DELETE FROM crime_heat WHERE guild_id=$1 AND user_id=$2`, [ctx.guildId, userId]);
    return { message: "Heat cleared.", result: { removed: res.rowCount || 0 } };
  }
  const expiresAt = new Date(Date.now() + ttl * 60 * 1000);
  await pool.query(
    `INSERT INTO crime_heat (guild_id, user_id, heat, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (guild_id, user_id)
     DO UPDATE SET heat=EXCLUDED.heat, expires_at=EXCLUDED.expires_at`,
    [ctx.guildId, userId, value, expiresAt]
  );
  return { message: `Heat set to ${value}.`, result: { userId, heat: value, expiresAt: expiresAt.toISOString() } };
}

async function setJail({ ctx, fields }) {
  const userId = cleanId(fields.user_id);
  const minutes = Math.floor(asNumber(fields.minutes, "minutes", { min: 0, max: 720 }));
  if (!userId) throw Object.assign(new Error("user_id is required."), { statusCode: 400 });
  if (minutes === 0) {
    const released = await jail.releaseJail(ctx.guildId, userId, "admin_release");
    return { message: "Jail cleared.", result: released || {} };
  }
  const releaseAt = await jail.setJail(ctx.guildId, userId, minutes, {
    effects: { admin: true },
    reason: String(fields.reason || "Admin action"),
  });
  return { message: `User jailed for ${minutes} minutes.`, result: { jailedUntil: releaseAt.toISOString() } };
}

async function clearCooldowns({ ctx, fields }) {
  const userId = cleanId(fields.user_id);
  const key = String(fields.key || "all").trim();
  if (!userId) throw Object.assign(new Error("user_id is required."), { statusCode: 400 });
  const res = key && key.toLowerCase() !== "all"
    ? await pool.query(`DELETE FROM cooldowns WHERE guild_id=$1 AND user_id=$2 AND key=$3`, [ctx.guildId, userId, key])
    : await pool.query(`DELETE FROM cooldowns WHERE guild_id=$1 AND user_id=$2`, [ctx.guildId, userId]);
  return { message: "Cooldowns cleared.", result: { cleared: res.rowCount || 0 } };
}

async function setShopEnabled({ ctx, fields, actionId }) {
  const itemId = String(fields.item_id || "").trim();
  if (!itemId) throw Object.assign(new Error("item_id is required."), { statusCode: 400 });
  const enabled = actionId.endsWith(":enable");
  const res = await pool.query(
    `UPDATE store_items SET enabled=$3, updated_at=NOW() WHERE guild_id=$1 AND item_id=$2 RETURNING item_id, name, enabled`,
    [ctx.guildId, itemId, enabled]
  );
  if (!res.rowCount) throw Object.assign(new Error("Store item not found."), { statusCode: 404 });
  return { message: `Store item ${enabled ? "enabled" : "disabled"}.`, result: res.rows[0] };
}

async function setShopCategory({ ctx, fields }) {
  const itemId = String(fields.item_id || "").trim();
  const category = String(fields.category || "").trim();
  if (!itemId || !category) throw Object.assign(new Error("item_id and category are required."), { statusCode: 400 });
  const res = await pool.query(
    `UPDATE store_items
     SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('category', $3),
         updated_at=NOW()
     WHERE guild_id=$1 AND item_id=$2
     RETURNING item_id, name, meta`,
    [ctx.guildId, itemId, category]
  );
  if (!res.rowCount) throw Object.assign(new Error("Store item not found."), { statusCode: 404 });
  return { message: "Store item category updated.", result: res.rows[0] };
}

async function deleteShopItem({ ctx, fields }) {
  const itemId = String(fields.item_id || "").trim();
  if (!itemId) throw Object.assign(new Error("item_id is required."), { statusCode: 400 });
  const item = await pool.query(`DELETE FROM store_items WHERE guild_id=$1 AND item_id=$2 RETURNING item_id, name`, [ctx.guildId, itemId]);
  let inventoryRows = 0;
  if (fields.wipe_inventory === true || String(fields.wipe_inventory).toLowerCase() === "true") {
    const wiped = await pool.query(`DELETE FROM user_inventory WHERE guild_id=$1 AND item_id=$2`, [ctx.guildId, itemId]);
    inventoryRows = wiped.rowCount || 0;
  }
  return { message: "Store item deleted.", result: { item: item.rows?.[0] || null, inventoryRows } };
}

async function botGamesStatus() {
  const botGames = require("./botGames");
  return { message: "Bot game status loaded.", result: { active: botGames.debugGetActive?.() || null } };
}

async function riftStatus({ ctx }) {
  const schedule = await pool.query(`SELECT * FROM echo_rift_schedule WHERE guild_id=$1`, [ctx.guildId]).catch(() => ({ rows: [] }));
  const active = await pool.query(`SELECT * FROM echo_rifts WHERE guild_id=$1 ORDER BY created_at DESC LIMIT 5`, [ctx.guildId]).catch(() => ({ rows: [] }));
  return { message: "Rift status loaded.", result: { schedule: schedule.rows?.[0] || null, activeRifts: active.rows || [] } };
}

async function eseView({ fields }) {
  const symbol = String(fields.symbol || "").trim().toUpperCase();
  const view = await getStockAdminView(symbol);
  if (!view) throw Object.assign(new Error("Stock not found."), { statusCode: 404 });
  return { message: "Stock admin view loaded.", result: view };
}

async function eseSetNow({ ctx, fields }) {
  const result = await setStockCurrentPrice(String(fields.symbol || "").toUpperCase(), asNumber(fields.price, "price", { min: 0.01 }), String(fields.headline || ""), ctx.discordUserId);
  return { message: "Stock price updated immediately.", result };
}

async function eseSetNext({ ctx, fields }) {
  const result = await setStockNextTickPrice(String(fields.symbol || "").toUpperCase(), asNumber(fields.price, "price", { min: 0.01 }), String(fields.headline || ""), ctx.discordUserId);
  return { message: "Stock next tick price queued.", result };
}

async function eseSetFloor({ ctx, fields }) {
  const result = await setStockFloor(String(fields.symbol || "").toUpperCase(), asNumber(fields.price, "price", { min: 0.01 }), String(fields.headline || ""), ctx.discordUserId);
  return { message: "Stock floor set.", result };
}

async function eseClearFloor({ ctx, fields }) {
  const result = await clearStockFloor(String(fields.symbol || "").toUpperCase(), String(fields.headline || ""), ctx.discordUserId);
  return { message: "Stock floor cleared.", result };
}

async function eseReset({ ctx, fields }) {
  const result = await resetStockToLaunch(String(fields.symbol || "").toUpperCase(), String(fields.headline || ""), ctx.discordUserId);
  return { message: "Stock reset.", result };
}

async function contractsStatus({ ctx }) {
  const settings = await contracts.getSettings(ctx.guildId);
  const active = await contracts.getActiveCommunityContract(ctx.guildId);
  return { message: "Contracts status loaded.", result: { settings, active } };
}

async function communityStatus({ ctx }) {
  const settings = await communityService.getSettings(ctx.guildId);
  const pulse = await communityService.getWeeklyPulse(ctx.guildId);
  return { message: "Community status loaded.", result: { settings, pulse } };
}

async function communityContractsStatus({ ctx }) {
  const settings = await communityContracts.getSettings(ctx.guildId);
  const snap = await communityContracts.snapshot(ctx.guildId, ctx.discordUserId);
  return { message: "Community contract status loaded.", result: { settings, snapshot: snap } };
}

async function seasonStatus({ ctx }) {
  await seasonControl.ensureSeasonStateLoaded(ctx.guildId);
  return { message: "Season status loaded.", result: seasonControl.getSeasonStateSummary(ctx.guildId) };
}

async function nextSeason({ ctx }) {
  const before = await seasonControl.ensureSeasonStateLoaded(ctx.guildId).then(() => seasonControl.getSeasonStateSummary(ctx.guildId));
  const after = await seasonControl.advanceToNextSeason(ctx.guildId, 1);
  const rollover = await farming.applySeasonRolloverToAllFarms(ctx.guildId);
  await farmWeather.ensureDailyWeatherState(ctx.guildId);
  return { message: "Farming season advanced.", result: { before, after, farmsUpdated: rollover.changedCount } };
}

async function ping() {
  return { message: "Pong.", result: { ok: true, at: new Date().toISOString() } };
}

module.exports = {
  list,
  users,
  run,
  failedUnlock,
};

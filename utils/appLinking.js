const crypto = require("crypto");
const { pool } = require("./db");
const economy = require("./economy");

const CODE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_DAYS = 90;

function requirePool() {
  if (!pool || typeof pool.query !== "function") {
    throw new Error("DATABASE_URL is not configured.");
  }
  return pool;
}

function profileId() {
  return `profile_${crypto.randomBytes(12).toString("hex")}`;
}

function linkCodeId() {
  return `link_${crypto.randomBytes(12).toString("hex")}`;
}

function sessionId() {
  return `session_${crypto.randomBytes(12).toString("hex")}`;
}

function generateSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function normalizeCode(code) {
  return String(code || "").trim().toUpperCase();
}

function primaryGuildId(guildId = null) {
  return String(guildId || process.env.ECHO_PRIMARY_GUILD_ID || process.env.GUILD_ID || "").trim();
}

function generateLinkCode() {
  const n = crypto.randomInt(0, 1_000_000);
  return `ECHO-${String(n).padStart(6, "0")}`;
}

async function ensureSchema() {
  const db = requirePool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS guilds (
      guild_id TEXT PRIMARY KEY,
      bank_balance BIGINT NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS user_balances (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      balance BIGINT NOT NULL DEFAULT 0,
      bank_balance BIGINT NOT NULL DEFAULT 0,
      account_number TEXT NULL,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS job_progress (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      xp BIGINT NOT NULL DEFAULT 0,
      level BIGINT NOT NULL DEFAULT 1,
      total_jobs BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS crime_heat (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      heat INT NOT NULL DEFAULT 0,
      expires_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS jail (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      jailed_until TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NULL,
      amount BIGINT NOT NULL,
      type TEXT NOT NULL,
      meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_guild_user_created
    ON transactions (guild_id, user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      primary_guild_id TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS primary_guild_id TEXT NULL;

    CREATE TABLE IF NOT EXISTS linked_identities (
      id BIGSERIAL PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (provider, provider_user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_linked_identities_profile
    ON linked_identities (profile_id);

    CREATE TABLE IF NOT EXISTS app_link_codes (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      profile_id TEXT NULL REFERENCES profiles(id) ON DELETE SET NULL,
      claimed_by_provider TEXT NULL,
      claimed_by_provider_user_id TEXT NULL,
      display_name TEXT NULL,
      session_token TEXT NULL,
      session_token_hash TEXT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      claimed_at TIMESTAMPTZ NULL
    );

    ALTER TABLE app_link_codes ADD COLUMN IF NOT EXISTS session_token_hash TEXT NULL;

    CREATE INDEX IF NOT EXISTS idx_app_link_codes_code
    ON app_link_codes (code);

    CREATE INDEX IF NOT EXISTS idx_app_link_codes_status_expires
    ON app_link_codes (status, expires_at);

    CREATE TABLE IF NOT EXISTS app_sessions (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ NULL
    );

    CREATE INDEX IF NOT EXISTS idx_app_sessions_profile
    ON app_sessions (profile_id);
  `);
}

async function createLinkCode() {
  await ensureSchema();
  const db = requirePool();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = generateLinkCode();
    try {
      await db.query(
        `INSERT INTO app_link_codes (id, code, status, expires_at)
         VALUES ($1, $2, 'pending', $3)`,
        [linkCodeId(), code, expiresAt]
      );
      return { linkCode: code, expiresAt: expiresAt.toISOString() };
    } catch (error) {
      if (error?.code !== "23505") throw error;
    }
  }

  throw new Error("Could not generate a unique link code.");
}

async function findOrCreateDiscordProfile(client, { discordUserId, displayName, guildId }) {
  const provider = "discord";
  const userId = String(discordUserId);
  const name = String(displayName || "Echo Player").slice(0, 120);
  const preferredGuildId = primaryGuildId(guildId);

  const existing = await client.query(
    `SELECT p.id, p.display_name, p.primary_guild_id
     FROM linked_identities li
     JOIN profiles p ON p.id = li.profile_id
     WHERE li.provider=$1 AND li.provider_user_id=$2
     LIMIT 1`,
    [provider, userId]
  );

  if (existing.rows?.[0]) {
    const row = existing.rows[0];
    await client.query(
      `UPDATE profiles
       SET display_name=$2,
           primary_guild_id=COALESCE(primary_guild_id, NULLIF($3, '')),
           updated_at=NOW()
       WHERE id=$1`,
      [row.id, name, preferredGuildId]
    );
    await client.query(
      `UPDATE linked_identities
       SET display_name=$3
       WHERE provider=$1 AND provider_user_id=$2`,
      [provider, userId, name]
    );
    return { id: row.id, displayName: name, guildId: row.primary_guild_id || preferredGuildId };
  }

  const id = profileId();
  await client.query(
    `INSERT INTO profiles (id, display_name, primary_guild_id)
     VALUES ($1, $2, NULLIF($3, ''))`,
    [id, name, preferredGuildId]
  );
  await client.query(
    `INSERT INTO linked_identities (profile_id, provider, provider_user_id, display_name)
     VALUES ($1, $2, $3, $4)`,
    [id, provider, userId, name]
  );
  return { id, displayName: name, guildId: preferredGuildId };
}

async function claimLinkCode(codeInput, { discordUserId, displayName, guildId = null }) {
  await ensureSchema();
  const db = requirePool();
  const code = normalizeCode(codeInput);
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const codeRes = await client.query(
      `SELECT *
       FROM app_link_codes
       WHERE code=$1
       FOR UPDATE`,
      [code]
    );
    const row = codeRes.rows?.[0];
    if (!row) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 404, message: "Link code not found." };
    }
    if (row.status === "linked") {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "That link code has already been claimed." };
    }
    if (row.status === "expired" || new Date(row.expires_at).getTime() <= Date.now()) {
      await client.query(
        `UPDATE app_link_codes SET status='expired' WHERE id=$1`,
        [row.id]
      );
      await client.query("COMMIT");
      return { ok: false, statusCode: 410, message: "That link code has expired." };
    }

    const profile = await findOrCreateDiscordProfile(client, {
      discordUserId,
      displayName,
      guildId,
    });

    const token = generateSessionToken();
    const tokenHash = hashToken(token);
    const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

    await client.query(
      `INSERT INTO app_sessions (id, profile_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [sessionId(), profile.id, tokenHash, sessionExpiresAt]
    );

    await client.query(
      `UPDATE app_link_codes
       SET status='linked',
           profile_id=$2,
           claimed_by_provider='discord',
           claimed_by_provider_user_id=$3,
           display_name=$4,
           session_token=$5,
           session_token_hash=$6,
           claimed_at=NOW()
       WHERE id=$1`,
      [row.id, profile.id, String(discordUserId), String(displayName || "Echo Player"), token, tokenHash]
    );

    await client.query("COMMIT");
    return { ok: true, status: "linked", message: "Discord account linked." };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function getDiscordIdentity(profileIdValue) {
  const db = requirePool();
  const res = await db.query(
    `SELECT provider_user_id, display_name
     FROM linked_identities
     WHERE profile_id=$1 AND provider='discord'
     ORDER BY linked_at ASC
     LIMIT 1`,
    [profileIdValue]
  );
  return res.rows?.[0] || null;
}

async function buildProfileSnapshot(profileIdValue) {
  await ensureSchema();
  const db = requirePool();
  const profileRes = await db.query(
    `SELECT id, display_name, primary_guild_id
     FROM profiles
     WHERE id=$1
     LIMIT 1`,
    [profileIdValue]
  );
  const profile = profileRes.rows?.[0];
  if (!profile) return null;

  const discord = await getDiscordIdentity(profile.id);
  const discordUserId = discord?.provider_user_id || null;
  const guildId = primaryGuildId(profile.primary_guild_id);
  const displayName = discord?.display_name || profile.display_name || "Echo Player";

  let walletBalance = 0;
  let bankBalance = 0;
  let serverBankBalance = 0;
  let accountNumber = null;
  let jobLevel = 1;
  let jobXp = 0;
  let heat = 0;
  let jailedUntil = null;

  if (guildId && discordUserId) {
    const [balanceRes, serverRes, jobRes, heatRes, jailRes] = await Promise.all([
      db.query(
        `SELECT balance, bank_balance, account_number
         FROM user_balances
         WHERE guild_id=$1 AND user_id=$2`,
        [guildId, discordUserId]
      ),
      db.query(
        `SELECT bank_balance
         FROM guilds
         WHERE guild_id=$1`,
        [guildId]
      ),
      db.query(
        `SELECT xp, level
         FROM job_progress
         WHERE guild_id=$1 AND user_id=$2`,
        [guildId, discordUserId]
      ),
      db.query(
        `SELECT heat
         FROM crime_heat
         WHERE guild_id=$1 AND user_id=$2 AND expires_at > NOW()`,
        [guildId, discordUserId]
      ),
      db.query(
        `SELECT jailed_until
         FROM jail
         WHERE guild_id=$1 AND user_id=$2 AND jailed_until > NOW()`,
        [guildId, discordUserId]
      ),
    ]);

    walletBalance = Number(balanceRes.rows?.[0]?.balance || 0);
    bankBalance = Number(balanceRes.rows?.[0]?.bank_balance || 0);
    accountNumber = balanceRes.rows?.[0]?.account_number
      ? String(balanceRes.rows[0].account_number)
      : null;
    serverBankBalance = Number(serverRes.rows?.[0]?.bank_balance || 0);
    jobLevel = Number(jobRes.rows?.[0]?.level || 1);
    jobXp = Number(jobRes.rows?.[0]?.xp || 0);
    heat = Number(heatRes.rows?.[0]?.heat || 0);
    jailedUntil = jailRes.rows?.[0]?.jailed_until
      ? new Date(jailRes.rows[0].jailed_until).toISOString()
      : null;
  }

  return {
    profileId: profile.id,
    discordUserId,
    displayName,
    walletBalance,
    bankBalance,
    serverBankBalance,
    accountNumber,
    account_number: accountNumber,
    jobLevel,
    jobXp,
    heat,
    jailedUntil,
  };
}

async function getLinkCodeStatus(codeInput) {
  await ensureSchema();
  const db = requirePool();
  const code = normalizeCode(codeInput);
  const res = await db.query(
    `SELECT *
     FROM app_link_codes
     WHERE code=$1
     LIMIT 1`,
    [code]
  );
  const row = res.rows?.[0];
  if (!row) return { ok: false, statusCode: 404, message: "Link code not found." };

  if (row.status === "pending" && new Date(row.expires_at).getTime() <= Date.now()) {
    await db.query(`UPDATE app_link_codes SET status='expired' WHERE id=$1`, [row.id]);
    return { ok: true, body: { status: "expired", profile: null, sessionToken: null } };
  }

  if (row.status === "linked") {
    return {
      ok: true,
      body: {
        status: "linked",
        sessionToken: row.session_token,
        profile: await buildProfileSnapshot(row.profile_id),
      },
    };
  }

  return {
    ok: true,
    body: {
      status: row.status === "expired" ? "expired" : "pending",
      profile: null,
      sessionToken: null,
    },
  };
}

async function getProfileForSessionToken(token) {
  await ensureSchema();
  const db = requirePool();
  const tokenHash = hashToken(token);
  const res = await db.query(
    `SELECT profile_id
     FROM app_sessions
     WHERE token_hash=$1
       AND revoked_at IS NULL
       AND expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );
  const profileIdValue = res.rows?.[0]?.profile_id;
  if (!profileIdValue) return null;
  return buildProfileSnapshot(profileIdValue);
}

async function getSessionContext(token) {
  await ensureSchema();
  const db = requirePool();
  const tokenHash = hashToken(token);
  const sessionRes = await db.query(
    `SELECT s.profile_id, p.primary_guild_id, p.display_name
     FROM app_sessions s
     JOIN profiles p ON p.id = s.profile_id
     WHERE s.token_hash=$1
       AND s.revoked_at IS NULL
       AND s.expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );
  const session = sessionRes.rows?.[0];
  if (!session) return null;

  const discord = await getDiscordIdentity(session.profile_id);
  return {
    profileId: session.profile_id,
    guildId: primaryGuildId(session.primary_guild_id),
    discordUserId: discord?.provider_user_id || null,
    displayName: discord?.display_name || session.display_name || "Echo Player",
  };
}

async function getOrCreateDiscordContext({ discordUserId, displayName, guildId = null }) {
  await ensureSchema();
  const db = requirePool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const profile = await findOrCreateDiscordProfile(client, {
      discordUserId,
      displayName,
      guildId,
    });
    await client.query("COMMIT");
    return {
      profileId: profile.id,
      guildId: primaryGuildId(profile.guildId || guildId),
      discordUserId: String(discordUserId),
      displayName: profile.displayName || displayName || "Echo Player",
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  ensureSchema,
  createLinkCode,
  claimLinkCode,
  getLinkCodeStatus,
  getProfileForSessionToken,
  getSessionContext,
  getOrCreateDiscordContext,
  buildProfileSnapshot,
  normalizeCode,
};

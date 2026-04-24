# Echo of Elsewhere Maintainer Notes

This is a working map for taking over the bot. Keep it updated when command routing, database tables, or scheduler behavior changes.

## Runtime Shape

- Main entry point: `index.js`
- Slash command deployer: `deploy-commands.js`
- Runtime: Node.js CommonJS, Discord.js v14, PostgreSQL via `pg`
- Environment:
  - `DISCORD_TOKEN`
  - `CLIENT_ID`
  - `GUILD_ID`
  - `DATABASE_URL`
- Local `.env` currently has Discord variables but is missing `DATABASE_URL`, so DB-backed features will not work locally until that is added.

## Startup Flow

1. `index.js` loads `.env`, imports command/game/util modules, creates the Discord client, and attaches `client.db = pool`.
2. `loadCommands()` loads only top-level files in `commands/*.js`.
3. On `ClientReady`, the bot:
   - optionally posts a Railway deploy announcement,
   - ensures the persistent Bot Features hub,
   - creates/migrates DB tables via `ensureAchievementTables`, `ensureEconomyTables`, and `ensureEseSchema`,
   - starts Bot Games, Lottery, Echo Rift, and Contracts schedulers,
   - syncs achievements from `data/achievements`,
   - starts the Echo Stock Exchange market ticker.

Important: `commands/_retired/**` and `admin/legacy_commands/**` are not active slash commands. Some admin panel actions still call legacy command files through `utils/adminPanel.js`.

## Active Slash Commands

- `/achievements` - paginated achievement viewer.
- `/adminpanel` - Bot Master control panel routed through `utils/adminPanel.js`.
- `/bal` and `/balance` - wallet/bank/total balance aliases.
- `/bank` - banking hub with deposit, withdraw, account transfer, and history.
- `/contracts` - community/personal contracts dashboard routed through `utils/contracts.js`.
- `/ese` - Echo Stock Exchange hub.
- `/games` - Games Hub panel.
- `/help` - help panel with local collectors.
- `/inventory` - inventory viewer.
- `/job` - job board, crime, grind, nightwalker, trucking, farming, and machine shed.
- `/leaderboard` - top wealth rankings.
- `/lottery` - weekly Echo Powerball info.
- `/pay` and `/sendmoney` - player-to-player money transfer.
- `/profile` - server profile snapshot with local select menu.
- `/rituals` - timed ritual hub.
- `/roles` - self-assign role board management.
- `/shop` - buy/sell shop panel.

## Global Interaction Routing

`index.js` handles persistent interactions before normal slash command execution:

- `help:*` is ignored globally so `/help` collectors can handle it.
- `ese-*` and `ese-view-stock` go to `commands/ese.js`.
- `adminpanel:*` goes to `utils/adminPanel.js`.
- `bank:*` goes to `commands/bank.js`.
- `contracts:*` goes to `commands/contracts.js`, which delegates to `utils/contracts.js`.
- `rituals:*` and ritual-specific IDs go to `commands/rituals.js`.
- Blood Tax buttons go to `utils/echoCurses.js`.
- `features:*` goes to `data/features/index.js`.
- `botgames:*` goes to `utils/botGames.js`.
- `lotto:*` goes to `utils/lottery.js`.
- `rift:*` goes to `utils/echoRift.js`.
- `rr:<boardId>:<roleId>` toggles self-assign roles.
- Game modal/select routing is global for blackjack, roulette, higher/lower, bullshit, and keno.
- `/job` uses message collectors and local session state. Global routing intentionally skips IDs beginning with `job_select:`, `job_`, `farm_`, or `enterprise:`.

When adding a new persistent button/select/modal, choose a unique custom ID prefix and route it before the generic command handler if it must survive restarts.

## Database Ownership

Main schema setup in `index.js`:

- Achievements and stats:
  - `achievements`
  - `user_achievements`
  - `blackjack_stats`
  - `roulette_stats`
  - `message_stats`
  - `user_achievement_counters`
  - `job_progress`
- Economy and admin:
  - `guilds`
  - `system_state`
  - `user_balances`
  - `transactions`
  - `cooldowns`
  - `robbery_protection`
  - `casino_security_state`
  - `patch_boards`
  - `role_boards`
  - `self_role_boards`
  - `store_items`
  - `user_inventory`
  - `store_purchases`
  - `grind_runs`
  - `grind_fatigue`
- Status/effects:
  - `crime_heat`
  - `jail`
  - `echo_curses`

Feature modules with their own table setup:

- `utils/ese/engine.js`: `ese_market_meta`, `ese_companies`, `ese_history`, `ese_portfolios`, `ese_trade_cooldowns`, `ese_news`, `ese_dividend_payouts`, `ese_admin_overrides`
- `utils/lottery.js`: `lottery_state`, `lottery_tickets`, `lottery_draws`
- `utils/botGames.js`: `bot_games_schedule`
- `utils/echoRift.js`: `echo_rift_schedule`, `echo_rifts`, `echo_chosen`
- `utils/effectSystem.js`: `user_effects`
- `utils/contracts.js`: `contract_settings`, `community_contracts`, `community_contract_participants`, `personal_contracts`
- `data/features/store.js`: `persistent_messages`

Money movement should go through `utils/economy.js` where possible:

- `ensureUser`, `getEconomySnapshot`, `getWalletBalance`, `getBankBalance`
- `tryDebitUser`, `creditUser`, `tryDebitBank`, `creditBank`
- `depositToBank`, `withdrawFromBank`, `transferBankByAccount`
- `addServerBank`, `bankToUserIfEnough`

## Feature Map

## Visual Identity

- Shared visual constants live in `utils/ui.js`.
- Keep common behavior consistent across the bot:
  - Back, Home, Refresh, and Close labels/icons/styles should come from `ui.nav`.
  - Success, warning, and danger embed colors should come from `ui.colors`.
  - System hub colors/footers should come from `ui.systems` or `ui.applySystemStyle`.
- Keep major systems visually distinct:
  - `/job` uses the work-board identity from `ui.systems.job`.
  - `/games` uses the brighter games identity from `ui.systems.games`.
  - `/rituals` uses the ritual identity from `ui.systems.rituals`.
- Do not make all hubs identical. Share the mechanics and polish, but preserve each system's mood and wording.

### Economy, Bank, Shop, Inventory

- Core utility: `utils/economy.js`
- Bank hub: `commands/bank.js`
- Shop command: `commands/shop.js`
- Store backend: `utils/store.js`
- Inventory helper: `utils/inventoryHelpers.js`

### Jobs

- Main command: `commands/job.js`
- Crime UI/interactions: `features/crime/*`
- Grind UI/interactions: `features/grind/*`
- 9-to-5 UI/interactions: `features/nineToFive/*`
- Night Walker UI/interactions: `features/nightWalker/*`
- 9-to-5 configs: `data/work/categories/nineToFive/*`
- Crime minigames: `data/work/categories/crime/*`
- Grind minigames: `data/work/categories/grind/*`
- Nightwalker minigames: `data/work/categories/nightwalker/*`
- Farming UI: `features/farming/ui.js`
- Farming interactions: `features/farming/handlers.js`
- Farming backend: `utils/farming/*`, `data/farming/*`
- Jail guard: `utils/jail.js`
- Crime heat: `utils/crimeHeat.js`
- Grind fatigue: `utils/grindFatigue.js`

Farming specifics:

- Farm state is stored as JSON in `farms.data`.
- Machine state is stored separately as JSON in `farm_machines.data`.
- Harvested crops are inserted as produce items in `store_items` and quantities in `user_inventory`.
- Crop selling is handled by `utils/farming/market.js`.
- Farming embeds, buttons, field pages, market pages, and machine shed pages are built in `features/farming/ui.js`.
- Farming button/select behaviour is handled in `features/farming/handlers.js`.
- `/job` should mainly route to farming helpers and redraw the current farming view.
- The farming home screen must stay under Discord's 5 component row limit. Field buttons are grouped into rows of up to 5.
- Field tasks should be validated before machinery is reserved. If machinery cannot be reserved after a valid task is started, clear the field task so equipment/fields do not get stuck.
- Machine rentals last 24 hours and are stored as leases in `farm_machines.data.rented`.
- Machine selling pays 60% of the buy price and only allows free owned machines to be sold. Machines busy in active field tasks are protected.

### Games

- Hub command: `commands/games.js`
- Category loader: `data/games/index.js`
- Categories: `data/games/categories/*`
- Casino games with global handlers: blackjack, roulette, higher/lower, bullshit, keno, scratchcards.
- Smaller games are mostly local collector driven.

### Achievements

- Data source: `data/achievements/categories/*`
- Loader: `utils/achievementsLoader.js`
- Unlock engine: `utils/achievementEngine.js`
- Progress counters: `utils/achievementProgress.js`
- Message achievement increments happen in `index.js` on `MessageCreate`.

### Scheduled Systems

- Bot Games: `utils/botGames.js`, planned in Brisbane time.
- Lottery: `utils/lottery.js`, weekly Powerball using configured timezone.
- Echo Rift: `utils/echoRift.js`, scheduled random rift event.
- Echo Stock Exchange: `utils/ese/engine.js`, ticked by `index.js` interval.

### Contracts

- UI and scheduler live in `utils/contracts.js`; slash entry is `commands/contracts.js`.
- Template definitions live in `data/contracts/config.js`.
- Progress is recorded by system code, not by the admin panel.
- Current progress hooks cover jobs, rituals, casino games, farming plant/harvest completions, ESE stock trades/volume, and successful rift entries.
- Lottery, Bot Games, and achievements intentionally do not feed contracts. Lottery is excluded by design, Bot Games are too random to make fair goals, and achievement unlocks should stay milestone-only.
- Casino contract metrics count settled paid casino play: `casino_games_played`, `casino_wins`, and positive `casino_profit`.
- Farming contract metrics count completed field work: `farm_fields_planted` when a crop is planted and `farm_crops_harvested` by harvested quantity.
- Stock contract metrics count completed buy/sell actions: `stock_trades` and gross `stock_volume`.
- Rift entry contracts use `rift_entries` and should keep long durations because rifts are scarce.

### Admin Panel

- Slash entry: `commands/adminpanel.js`
- Implementation: `utils/adminPanel.js`
- Gate: hard-coded Bot Master role ID `741251069002121236`
- Some actions run legacy command files from `commands/_retired/admin`; `admin/legacy_commands` is a duplicate legacy folder and is not the active admin panel target.

## Known Risk Areas

- The bot has both global interaction routers and local collectors. Bugs often happen when a custom ID is routed twice or acknowledged incorrectly before `showModal`.
- `/job` is very large and owns many unrelated systems. Changes there need extra care.
- Database schema is spread across `index.js` and feature modules. New table columns should include migration SQL.
- Some files contain mojibake from emoji encoding. That is cosmetic until it touches Discord-visible labels or string comparisons.
- Local verification cannot fully test DB-backed features without `DATABASE_URL`.
- Retired command folders should not be deployed as slash commands, but admin panel still depends on `commands/_retired/admin`.

## Verification Checklist

- Syntax check all source files:
  - `Get-ChildItem -Recurse -File -Include *.js | Where-Object { $_.FullName -notmatch '\\node_modules\\|\\.git\\' } | ForEach-Object { node --check $_.FullName }`
- Load active command modules:
  - `node -e "require('dotenv').config(); const fs=require('fs'),path=require('path'); for (const f of fs.readdirSync('commands').filter(x=>x.endsWith('.js'))) require(path.resolve('commands',f)); console.log('commands loaded')"`
- Deploy slash commands:
  - `npm run deploy`
- Start bot:
  - `npm start`

Do not run `npm start` casually if the real Discord token is present; it logs the bot into Discord.

### Scheduled Channel Purger

- Scheduler and purge logic live in `utils/channelPurger.js`.
- Admin Panel controls are under **Moderation** in `utils/adminPanel.js`.
- This version intentionally keeps the same channel ID.
- Purges run inside the existing channel by fetching history, bulk-deleting recent messages, and individually deleting older messages that Discord will not bulk-delete.
- Because Discord only bulk-deletes recent history, very large or very old channels may take longer to fully clear.
- Schedule alignment is based on Australia/Brisbane local time boundaries from midnight. Example: `24` hours means the next midnight, then every midnight after that.
- Data is stored in the `channel_purge_jobs` table and started from `index.js` on boot.
- After each scheduled purge, `utils/channelPurger.js` asks `utils/lottery.js` to repost the current Powerball panel if the purged channel is the configured/current Powerball post channel.
- The repost uses the normal lottery post builder/state, so ticket counts, jackpot, buttons, and stored `post_message_id` stay in sync.

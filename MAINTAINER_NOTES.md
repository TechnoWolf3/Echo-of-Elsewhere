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
- `/job` - job board, crime, grind, nightwalker, trucking, farming, machine shed, and Underworld.
- `/jail` - session-aware jail hub for jailed players: bail, work detail, contraband, escape, and prison gambling.
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
- `/job` uses message collectors and local session state. Global routing intentionally skips IDs beginning with `job_select:`, `job_`, `farm_`, `uw_`, or `enterprise:`.

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
  - `bank_recurring_deposits`
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
- Recurring bank deposits: `utils/bankRecurringDeposits.js`
- Shop command: `commands/shop.js`
- Store backend: `utils/store.js`
- Inventory helper: `utils/inventoryHelpers.js`

Bank specifics:

- `/bank` deposit modals include an optional `Recurring daily? yes/no` field. Blank input defaults to no recurring schedule.
- Entering `yes`, `y`, or `daily` after a successful deposit creates or updates a daily wallet-to-bank auto-deposit for that same amount. Entering `stop`, `cancel`, `off`, or `disable` disables it.
- Recurring deposits are stored in `bank_recurring_deposits`; schema setup and scheduler startup happen from `index.js`.
- The scheduler runs roughly every 10 minutes, processes due rows, and silently skips when the wallet lacks funds. Three consecutive failed transfers disable the recurring deposit.
- Recurring deposit movement writes a zero-amount `bank_deposit` transaction with `recurring: true`, `from: "wallet"`, and `to: "bank"` metadata.

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
- Jail guard/session engine: `utils/jail.js`
- Jail command/UI: `commands/jail.js`
- Jail balance/config: `data/jail/config.js`, `data/jail/npcs.js`
- Crime heat: `utils/crimeHeat.js`
- Grind fatigue: `utils/grindFatigue.js`

Crime specifics:

- Crime menu rendering is in `features/crime/ui.js`; action routing is in `features/crime/handlers.js`; cooldown keys live in `features/crime/constants.js`.
- Crime heat is persisted in `crime_heat` and decays on read through `utils/crimeHeat.js`. `setCrimeHeat()` now deletes the heat row when the new heat value is `0`, so clean outcomes and heat-management tools can fully clear heat.
- Store Robbery is tuned to a 15 minute job cooldown/global crime lockout and pays `$9,000-$18,000`.
- Scam Call is tuned to a 45 minute job cooldown, 15 minute global crime lockout, 25% lower payout bands, and weaker base/option effectiveness for `average_person` and `elderly_victim`.
- Heist cooldowns remain 12 hours/24 hours for standard/major, with payout bands increased by 33%. Their global crime lockout is 15 minutes.
- `Bribe Officer` lives in `data/work/categories/crime/bribeOfficer.js`. It bypasses the global crime lockout, uses its own 30 minute cooldown (`crime_bribe_officer`), debits wallet money, and can lower heat, raise heat on failure, or rarely jail on a failed bribe.
- `Lay Low` lives in `data/work/categories/crime/layLow.js`. It bypasses the global crime lockout, uses its own 30 minute cooldown (`crime_lay_low`), runs four decisions, and applies the final score as heat reduction or heat gain. Higher starting heat makes the generated decision set harsher.
- Heat-management activities intentionally bypass `crime_global`; otherwise players could not reduce heat during the downtime created by crime jobs.

Jail specifics:

- Jail is now session-aware rather than a plain AFK timer. The `jail` table keeps `jailed_until`, `original_sentence_seconds`, `prison_money`, `sentence_reduced_seconds`, `work_count`, `reduction_cap_seconds`, `items`, `effects`, `escape_attempts`, timestamps, and temporary jail state.
- `utils/jail.js` owns jail schema migration with `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ADD COLUMN IF NOT EXISTS`; `index.js` calls `ensureJailSchema()` at startup.
- Prison Money is session-only. Work and prison gambling credit it; contraband spends it. Wallet/bank money cannot buy contraband. On release, leftover Prison Money is converted into wallet cash and written as `jail_prison_money_conversion`.
- Bail is based on the original sentence, not remaining time. It uses wallet cash only via `tryDebitUser`; bank and Prison Money are intentionally excluded.
- Work/items respect the configured reduction cap in `data/jail/config.js` (`sentence.reductionCapPercent`, currently 55%). Bail and successful escape bypass the cap by releasing the player.
- Work detail tasks are handled in `/jail` with different mechanics: memory order, rule matching, risk tile, route choice, sequence order, and effort choice. Diminishing returns are configured under `work.diminishingReturns`.
- Contraband prices/effects live in `data/jail/config.js`. Session unlocks/items are stored in the `jail.items` JSONB field and clear on release.
- NPC gambling requires a Deck of Cards and uses Prison Money only. NPC personalities are in `data/jail/npcs.js`.
- Existing crime/underworld/ritual call sites still use `setJail()`, but it now initializes a full jail session. Store Robbery and failed bribes use 5-15 minute small-crime jail windows, Scam Call trace uses 20-35 minutes, regular Heist uses 20-35 minutes, Major Heist and Underworld full bust remain 45-60 minutes.

Grind specifics:

- Grind routing starts in `features/grind/handlers.js`, with individual sessions in `data/work/categories/grind/*`.
- Shared fatigue is stored in `grind_fatigue` and managed by `utils/grindFatigue.js`. Taxi Driver intentionally ticks fatigue twice per render, making the 10-fare shift land close to full fatigue.
- Store Clerk now uses four selectable answer buttons instead of a modal/manual input. Correct answers pay `$350-$600` before streak/item bonuses.
- Warehousing base pay now rolls `$250-$550` per correct action; rare/special order multipliers still apply on top.
- Fishing base fish/junk values were multiplied by 9 total (an 800% increase).
- Quarry base find values were increased by 25%.
- Taxi Driver now runs 10 fares per shift, with normal/sketchy fares buffed and VIP fares reduced. Shift timeout was extended to 12 minutes to support the longer run.

Night Walker specifics:

- Night Walker menu rendering is in `features/nightWalker/ui.js`; interaction routing and choice resolution are in `features/nightWalker/handlers.js`.
- Job definitions and scenario data are loaded from `data/work/categories/nightwalker/index.js` and the sibling Night Walker data files.
- Night Walker uses per-job cooldown keys: `job:nw:flirt`, `job:nw:lapDance`, and `job:nw:prostitute`. Default cooldowns are 5 minutes, 7 minutes, and 10 minutes unless overridden by job config.
- Runs are held in `/job` session state as `session.nw` with picked scenarios, round index, wrong count, penalty tokens, risk, and payout modifier.
- Flirt fails after too many wrong answers, Lap Dance fails after too many penalty tokens, and Prostitute fails if risk reaches the configured fail threshold.
- Successful Night Walker payouts go through the shared `/job` `payUser` path with XP, level bonuses, job counting, legendary spawn eligibility, and configured activity effects.

9-to-5 specifics:

- 9-to-5 menu rendering is in `features/nineToFive/ui.js`; interaction routing lives in `features/nineToFive/handlers.js`.
- Config/data lives under `data/work/categories/nineToFive/*`; Email Sorter runtime generation/scoring lives in `features/nineToFive/emailSorter.js`.
- Cooldown keys are `job:95:contract`, `job:95:skill`, `job:95:shift`, `job:95:email_sorter`, and `job:95:trucker`. Trucker uses `0` cooldown seconds after collection.
- Transport Contract is a multi-step pick flow with level-gated VIP/danger choices from `transportContract.js`.
- Skill Check shows a short memorise phase, then hides the pattern and requires replay through buttons. Legendary jobs reuse the skill-check path when `session.legendaryAvailable` is true.
- Shift Work is timer-based and uses a session interval to redraw progress until Collect Pay is enabled.
- Trucker creates a manifest, starts a timed delivery, posts a completion ping when ready, and pays on manual collection. Clear `session.trucker.interval` whenever the run ends or restarts.
- Email Sorter uses generated emails, folder buttons, and `scoreRun()` to determine payout/failure. It includes scam/spam folder logic separate from Crime's Scam Call.

Farming specifics:

- Farm state is stored as JSON in `farms.data`.
- Machine state is stored separately as JSON in `farm_machines.data`.
- Fertiliser stock is stored inside the farm JSON as `farm.fertilisers`.
- Harvested crops are inserted as produce items in `store_items` and quantities in `user_inventory`.
- Crop selling is handled by `utils/farming/market.js`.
- Fertiliser definitions live in `data/farming/fertilisers.js`; animal husbandry definitions live in `data/farming/animalHusbandry.js`; crops, machines, livestock, weather, and market tuning live in sibling `data/farming/*` files.
- Farming embeds, buttons, field pages, market pages, and machine shed pages are built in `features/farming/ui.js`.
- Farming button/select behaviour is handled in `features/farming/handlers.js`.
- `/job` should mainly route to farming helpers and redraw the current farming view.
- The farming home screen must stay under Discord's 5 component row limit. Field buttons are grouped into rows of up to 5.
- Field tasks should be validated before machinery is reserved. If machinery cannot be reserved after a valid task is started, clear the field task so equipment/fields do not get stuck.
- Field upgrades are timed `upgrade` tasks controlled by `FIELD_UPGRADE_DURATION_MS`; the field level changes only when `applyFieldTaskRollovers()` completes the task.
- Machine purchase uses bank funds through `tryDebitBank`; rentals still follow the existing rental payment path.
- Machine task speed comes from the best compatible owned/rented machine set. `machineEngine.getBestTaskSpeedMultiplier()` is applied when starting machine-backed field tasks, with a minimum task duration guard.
- Machine rentals last 24 hours and are stored as leases in `farm_machines.data.rented`.
- Machine selling pays 60% of the buy price and only allows free owned machines to be sold. Machines busy in active field tasks are protected.
- Farm Store is a category hub like Machine Shed. Fertiliser and Animal Husbandry are stocked categories; avoid renaming the page to a fertiliser-only shop.
- Fertiliser can be applied only while a crop is actively growing in the first 10% of the current growth/regrow cycle or from 75% to before ready. It is optional and not applying it should not penalize the crop.
- Regrowing crops reset fertiliser stage/application data after harvest, so each regrow cycle can be fertilised again in its own early/late windows.
- Fertiliser purchases use a select-to-modal flow: choose the fertiliser under the Store's Fertiliser category, then enter the quantity to buy. Purchase debits the bank once for `price * qty`.
- Field views show the current fertiliser window in the embed. During an active window, the controls show either an apply dropdown for owned fertiliser or a `Buy Fertiliser` route when the player has none.
- Fertiliser effects are recorded per stage in `field.fertiliserApplications`: growth mixes shorten the current `readyAt`, yield mixes increase the harvest roll through `getScaledYieldRange()`.
- Barns are represented as farm fields with `kind: "barn"` and livestock metadata from `data/farming/livestock.js`.
- Barn actions are handled by `farm_barn_collect:*`, `farm_barn_slaughter:*`, `farm_barn_restock:*`, `farm_barn_upgrade:*`, and `farm_barn_demolish:*` in `features/farming/handlers.js`.
- Field-to-barn conversion and barn-to-field demolition both reset the resulting structure to level 1. Existing barns keep their saved level until players choose a future conversion/demolition path.
- Barn upgrades are timed tasks controlled by `BARN_UPGRADE_DURATION_MS`. Animals remain inside during the upgrade, but production is paused and `lastCollectedAt` is reset when the upgrade completes.
- Barn capacity scales by level. Produce output uses adult animals only; young animals count toward capacity but do not produce until their `maturesAt` time has passed.
- Animal husbandry items are bought from the Farm Store via `farm_store_husbandry_buy:*` and used from barn views via `farm_barn_breed:*`. Breeding requires a matching livestock type, at least two adults, and enough free capacity for the offspring.
- Barn produce and slaughter outputs are inserted into `store_items`/`user_inventory` through `addFarmItemToInventory()`. That path now validates `item.itemId || item.id` before writing so missing livestock output IDs fail loudly instead of producing confusing DB errors.
- Barn collect/slaughter currently record contract progress as `farm_crops_harvested` by output quantity, matching the existing farming contract metric naming.

Underworld specifics:

- State is stored as JSON in `underworld_state.data`.
- Data/config lives under `data/underworld/*`.
- UI lives in `features/underworld/ui.js`.
- Interaction handling lives in `features/underworld/handlers.js`.
- Business rules and runtime progression live in `utils/underworld/engine.js`.
- `/job` owns the top-level Underworld category board, but detailed building rendering and actions should stay in the feature/engine modules.
- Underworld branch selection is data-driven from `data/underworld/branches.js`.
- Building actions use stable `building.id` values in component payloads; do not switch back to array indexes.
- Underworld payouts now use the effect-aware credit path through `creditUserWithEffects`, matching the rest of `/job`.
- Runtime progression is phase-split in `utils/underworld/engine.js` (`applyConversionRollover`, pending event expiry, due-event opening, run finalization, and building runtime application).
- Police/event choices that reduce suspicion now immediately apply negative `suspicionDelta` to the building as well as the active run, so payoffs visibly reduce suspicion at once.
- Storage House is now a live storage operation. Finished cooled-off goods move into `building.storage`, clear `building.activeRun`, and allow another run to start while sellable goods remain in storage.
- Storage House sell options can resolve either a cooling active run or accumulated `building.storage` goods. Selling clears storage after payout.
- Storage House start is blocked only while an active run exists or storage is full. UI shows both sell buttons and Start Operation when cooled goods are waiting and the building can stockpile more.
- Storage goods values live in `data/underworld/storageGoods.js` and were raised by about 15% to counterbalance police payoff costs and Storage House setup investment.

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

### Rituals

- Hub command: `commands/rituals.js`
- Ritual registry: `data/rituals/index.js`
- Ritual payout balance is intentionally stronger than repeatable short work because rituals are once per Sydney day/week/month. Current passive payouts: Daily `$20,000-$35,000`, Weekly `$175,000-$275,000`, Monthly `$900,000-$1,400,000`.
- Daily interactive ritual payouts are tuned to feel worthwhile beside work/crime cooldowns rather than as tiny novelty claims: Echo Cipher pays `$35,000-$100,000` by attempts used, Veil Sequence pays up to `$85,000`, Blade Grid pays `$60,000-$90,000` on survival, and Echo Wheel has a `$10,000` spin cost with boosted cash/jackpot outcomes.
- Echo Wheel cash outcomes now report positive `contractEarnings` so ritual earnings contracts progress correctly on wallet/bank cash wins. Non-cash perks, neutral outcomes, and losses still do not count as ritual earnings.
- Echo Arrangement / Echo Seating lives in `data/rituals/echoArrangement.js`, with scenario/name/clue text pools in `data/rituals/echoArrangementScenarios.js`.
- Echo Seating is a daily public ritual using the `echo_arrangement` cooldown key. It creates a per-user session with 5-10 seats and mistake limits of 2 for 5 seats, 3 for 6-7 seats, and 4 for 8-10 seats.
- Puzzle generation creates the hidden answer first, generates clues from that answer, and checks uniqueness with a small solver before showing the puzzle. If a generated puzzle is weak or ambiguous, it retries.
- Answer input is modal-based and accepts comma-separated names, plus space-separated names when unambiguous. Invalid formatting does not spend a mistake.
- Wrong answers spend one mistake and only reveal limited feedback, currently correct-position count. Final reveal happens only when solved, when mistakes run out, or when the player gives up.
- Final Echo Seating reveal mirrors Veil Sequence: `Your Order` appears directly above `Correct Order` for comparison. Give-up without any submitted answer shows `No answer submitted.`
- Successful Echo Seating rewards go through `creditUserWithEffects` with source/type `echo_arrangement`; payout scales by seat count from `8000 + seatCount * 6500`, has a 1.25x perfect-solve bonus, and is reduced by mistakes used down to a 0.65 floor.

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

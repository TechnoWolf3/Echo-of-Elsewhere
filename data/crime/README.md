# 🕶️ Crime System — Rubicon Royal Bot

This document describes the **Crime job system** inside the Rubicon Royal Discord Bot. It is intended as a **developer-facing reference** so new crime jobs can be added cleanly and consistently.

---

## 📌 High-Level Design

Crime jobs are:

* **Interactive** (multi-step, choice-driven)
* **Risk vs reward focused**
* Affected by a persistent **Crime Heat** system
* Fully **separate** from standard `/job` payout cooldowns

Key rules:

* **Crime Heat only affects Crime jobs**
* **Jail disables ALL jobs** (Crime, 9–5, Night Walker, Grind)
* Cooldowns apply on **success and failure**

---

## 📂 Folder Structure

```
/data/crime/
├─ index.js              # Crime category menu & routing
├─ storeRobbery.js       # Store Robbery job logic
├─ storeRobbery.scenarios.js
├─ (future)
│  ├─ carChase.js
│  ├─ drugPushing.js
│  ├─ heist.js
│  └─ heistMajor.js

/utils/
├─ crimeHeat.js          # Crime heat persistence helpers
```

---

## 🔥 Crime Heat System

Crime Heat represents police attention and suspicion.

### How Heat Works

* Stored per **guild + user**
* Only read/written by Crime jobs
* Persists for a **limited time** (TTL)
* Automatically clears when expired

### Database Table

Created automatically at bot startup:

```sql
crime_heat (
  guild_id TEXT,
  user_id TEXT,
  heat INT,
  expires_at TIMESTAMPTZ,
  PRIMARY KEY (guild_id, user_id)
)
```

### Utility Functions (`utils/crimeHeat.js`)

* `getCrimeHeat(guildId, userId)`
* `setCrimeHeat(guildId, userId, heat, ttlMinutes)`
* `clearCrimeHeat(guildId, userId)`
* `heatTTLMinutesForOutcome(outcome, meta)`

Expired heat is cleaned up automatically when read.

### Persistence Rules

* **finalHeat <= 0** → nothing is persisted
* Messy / busted outcomes persist heat
* Being **identified** increases TTL

---

## 🚓 Jail Interaction

* Jail is enforced via `utils/jail.js`
* While jailed:

  * ❌ All job buttons are blocked
  * ❌ Crime cannot be started

This is enforced at the **component interaction level**, not just slash commands.

---

## ⏱️ Cooldowns

Crime jobs use **their own cooldown keys**, separate from `/job` payout cooldowns.

### Cooldown Keys

```js
crime_global        // Global Crime lockout
crime_store         // Store Robbery
crime_chase         // Car Chase
crime_drugs         // Drug Pushing
crime_heist         // Heist
crime_heist_major   // Major Heist
```

### Cooldown Rules

* **crime_global** applies on BOTH success and failure
* Individual job cooldowns apply in addition to global
* Jail time extends effective cooldowns implicitly

---

## 🏪 Store Robbery (S1)

### Design

* Severity: **S1**
* 3–5 step interactive job
* No hostages
* Focus on subtlety and risk management

### Outcomes

| Outcome     | Result                          |
| ----------- | ------------------------------- |
| Clean       | Payout, no heat                 |
| Partial     | Reduced payout, some heat       |
| Busted      | Fine, chance of jail            |
| Busted Hard | Bigger fine, higher jail chance |

### Payouts & Penalties

* Success payout: **$2,000 – $6,000**
* Fines on bust: **$3,000 – $8,000**
* Jail chance:

  * Busted: uncommon
  * Busted hard: rare
* Jail time: **2–5 minutes**

### Random Events

* Dropping loot (reduces payout)
* Finding valuables (small payout boost)

### Heat Interaction

* Clean runs usually leave no heat
* Messy runs persist heat with short TTL

---

## 🚗 Planned Crime Jobs

### Car Chase (S2–S3)

* Multi-tier car rarity
* Higher rarity = more steps + higher risk
* Longer cooldown (15m)

### Drug Pushing (S3–S4)

* Placeholder for now
* Will integrate with inventory / confiscation
* Cooldowns depend on outcomes

### Heist (S4)

* 6–10 steps
* High risk, hostages & police escalation
* 12 hour cooldown

### Major Heist (S5)

* 8–15 steps
* Extreme risk & heat
* 24 hour cooldown

---

## 🧠 Design Principles

* No obvious "correct" choices
* Failure is interesting, not punishing
* Risk compounds across runs via heat
* Systems are **config-driven** and modular

---

## 🔧 Adding a New Crime Job (Checklist)

1. Create job file in `/data/crime/`
2. Define scenarios & step flow
3. Read `lingeringHeat` at start
4. Apply heat modifiers during job
5. Return `{ outcome, finalHeat, identified }`
6. Let `job.js` persist heat + cooldowns
7. Add button to `crime/index.js`

---

## ✅ Status

* Crime category: **LIVE**
* Store Robbery: **LIVE**
* Crime Heat: **LIVE**
* Car Chase / Heists: **Planned**

---

*Last updated: Crime Store Robbery implementation*

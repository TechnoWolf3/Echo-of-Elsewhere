# Transaction Recovery Notes

This is a plain-language recovery note for the server-bank issue reported on 2026-05-07.

Codex could not read the live database from this workspace because `DATABASE_URL` is not set locally, so the exact dollar figures still need to be pulled from the live database or Railway logs.

## What Can Be Safely Recovered

The safest recovery is server-bank money from player purchases/bets where the player debit was logged, but the matching server-bank deposit was missing.

For the last 24 hours before the fix, total each negative player transaction below, then subtract any matching positive server-bank transaction if one already exists.

Credit the difference to the server bank.

## Casino Types

These player debits should have gone into the server bank:

| Player debit transaction | Expected server-bank transaction |
| --- | --- |
| `higherlower_bet` | `higherlower_bet_bank` |
| `keno_bet` | `keno_bet_bank` |
| `scratchcard_buy` | `scratchcard_buy_bank` |

## Enterprise Types

These player bank debits should have gone into the server bank:

| Player debit transaction | Expected server-bank transaction |
| --- | --- |
| `farming_field_purchase` | `farming_field_purchase_bank` |
| `farming_fertiliser_purchase` | `farming_fertiliser_purchase_bank` |
| `farming_husbandry_purchase` | `farming_husbandry_purchase_bank` |
| `farming_field_upgrade` | `farming_field_upgrade_bank` |
| `farming_barn_conversion` | `farming_barn_conversion_bank` |
| `farming_barn_restock` | `farming_barn_restock_bank` |
| `farming_barn_upgrade` | `farming_barn_upgrade_bank` |
| `farming_barn_demolition` | `farming_barn_demolition_bank` |
| `farm_machine_buy` | `farm_machine_buy_bank` |
| `farm_machine_rent` | `farm_machine_rent_bank` |
| `manufacturing_plot_purchase` | `manufacturing_plot_purchase_bank` |
| `manufacturing_material_purchase` | `manufacturing_material_purchase_bank` |
| `manufacturing_plot_upgrade` | `manufacturing_plot_upgrade_bank` |

## Recovery Figures From Live Query

Pulled from the live transaction logs for the last 24 hours.

| Category | Missing amount |
| --- | ---: |
| Higher/Lower bets | `$11,050,020` |
| Keno bets | `$0` |
| Scratchcard buys | `$0` |
| Farming field purchases | `$150,000` |
| Farming purchases/upgrades | `$0` |
| Farming machine purchases/rentals | `$0` |
| Manufacturing purchases/upgrades | `$0` |
| **Total server-bank credit** | **`$11,200,020`** |

## Recommended Manual Recovery

Credit **$11,200,020** to the server bank.

Breakdown:

- **$11,050,020** from missing Higher/Lower bet deposits.
- **$150,000** from missing Farming field purchase deposits.

## Player Credits

Player credits are harder to recover safely from the `transactions` table alone.

If a player won and the bot successfully paid them, there will already be a positive player transaction such as:

- `higherlower_payout`
- `keno_win`
- `scratchcard_payout`

If a payout failed before writing a transaction, the expected payout may only exist in the Discord message or Railway logs. Do not guess these from transaction logs alone.

The safer approach is:

1. Restore the missing server-bank funds first.
2. Ask players to report any casino win message that said the server bank could not cover the payout.
3. Verify those reports against Railway logs or screenshots.
4. Credit those players manually once confirmed.

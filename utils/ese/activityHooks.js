const { pool } = require("../db");
const eseConfig = require("../../data/ese/config");

function num(v) {
  return Number(v || 0);
}

async function getEseActivitySnapshot() {
  const lookbackMinutes = Math.max(5, Number(eseConfig.tickIntervalMinutes || 10));

  const res = await pool.query(
    `
    WITH recent AS (
      SELECT
        COALESCE(type, '') AS type,
        COALESCE(amount, 0) AS amount,
        COALESCE(meta, '{}'::jsonb) AS meta
      FROM transactions
      WHERE created_at >= NOW() - ($1::text || ' minutes')::interval
    )
    SELECT
      -- Casino house result: positive = players lost more than they won
      COALESCE(SUM(
        CASE
          WHEN type IN (
            'blackjack_bet',
            'roulette_bet',
            'higherlower_bet',
            'bullshit_bet',
            'keno_bet',
            'lottery_ticket',
            'powerball_ticket'
          )
          THEN ABS(amount)
          ELSE 0
        END
      ), 0)
      -
      COALESCE(SUM(
        CASE
          WHEN type IN (
            'blackjack_payout',
            'roulette_payout',
            'higherlower_payout',
            'bullshit_payout',
            'keno_payout',
            'lottery_payout',
            'powerball_payout'
          )
          THEN ABS(amount)
          ELSE 0
        END
      ), 0)
      AS casino_net,

      -- Transport / contract style work
      COALESCE(SUM(
        CASE
          WHEN type ILIKE ANY (ARRAY[
            '%transport%',
            '%contract%',
            '%delivery%',
            '%shift_work%'
          ])
          THEN 1 ELSE 0
        END
      ), 0) AS transport_jobs,

      -- Grind/resource style work
      COALESCE(SUM(
        CASE
          WHEN type ILIKE ANY (ARRAY[
            '%quarry%',
            '%warehouse%',
            '%warehousing%',
            '%fishing%',
            '%store_clerk%',
            '%grind%',
            '%work_payout%',
            '%9to5%',
            '%nine_to_five%'
          ])
          THEN 1 ELSE 0
        END
      ), 0) AS grind_jobs,

      -- Crime activity count
      COALESCE(SUM(
        CASE
          WHEN type ILIKE ANY (ARRAY[
            '%crime%',
            '%robbery%',
            '%heist%',
            '%drug%',
            '%push%',
            '%nightwalker%',
            '%prostitute%',
            '%lap_dance%',
            '%flirt%'
          ])
          THEN 1 ELSE 0
        END
      ), 0) AS crime_activity,

      -- Shop / retail spending
      COALESCE(SUM(
        CASE
          WHEN type ILIKE ANY (ARRAY[
            'store_buy',
            '%shop%',
            '%purchase%',
            '%buy_item%',
            '%store_item%'
          ])
          THEN ABS(amount)
          ELSE 0
        END
      ), 0) AS shop_spend
    FROM recent
    `,
    [lookbackMinutes]
  );

  const row = res.rows?.[0] || {};

  return {
    casinoNet: num(row.casino_net),
    transportJobs: num(row.transport_jobs),
    grindJobs: num(row.grind_jobs),
    crimeActivity: num(row.crime_activity),
    shopSpend: num(row.shop_spend),
  };
}

module.exports = {
  getEseActivitySnapshot,
};
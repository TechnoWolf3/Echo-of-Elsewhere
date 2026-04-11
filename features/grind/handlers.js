const { MessageFlags } = require("discord.js");

const startStoreClerk = require("../../data/work/categories/grind/storeClerk");
const startWarehousing = require("../../data/work/categories/grind/warehousing");
const startFishing = require("../../data/work/categories/grind/fishing");
const startQuarry = require("../../data/work/categories/grind/quarry");
const startTaxiDriver = require("../../data/work/categories/grind/taxiDriver");

const GRIND_JOBS = {
  clerk: startStoreClerk,
  warehousing: startWarehousing,
  fishing: startFishing,
  quarry: startQuarry,
  taxi: startTaxiDriver,
};

function isGrindInteraction(actionId) {
  return actionId.startsWith("grind:");
}

async function handleGrindInteraction({
  actionId,
  interaction,
  session,
  msg,
  pool,
  guildId,
  userId,
  redraw,
  resetInactivity,
  checkCooldownOrTell,
}) {
  if (!isGrindInteraction(actionId)) return false;

  const key = actionId.split(":")[1];
  if (await checkCooldownOrTell(interaction)) return true;

  const runJob = GRIND_JOBS[key];
  if (!runJob) {
    await interaction
      .followUp({ content: "🕒 That Grind job is coming soon.", flags: MessageFlags.Ephemeral })
      .catch(() => {});
    return true;
  }

  session.view = "grind_run";

  await runJob(interaction, {
    pool,
    boardMsg: msg,
    guildId,
    userId,
  });

  await new Promise((resolve) => setTimeout(resolve, 1500));
  resetInactivity();

  session.view = "grind";
  await redraw();
  return true;
}

module.exports = {
  handleGrindInteraction,
  isGrindInteraction,
};

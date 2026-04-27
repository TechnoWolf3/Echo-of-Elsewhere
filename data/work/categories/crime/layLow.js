const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");

const path = require("path");
const { pool } = require(path.join(process.cwd(), "utils", "db"));
const { getCrimeHeat, setCrimeHeat } = require(path.join(process.cwd(), "utils", "crimeHeat"));

const CRIME_KEY = "crime_lay_low";
const COOLDOWN_MINUTES = 30;
const HEAT_TTL_MINUTES = 12 * 60;
const RESULTS_LINGER_MS = 10_000;
const DECISIONS_PER_RUN = 4;

const SCENARIOS = [
  {
    prompt: "Police presence has increased around your block. What's your first move?",
    options: [
      { label: "Stay inside with lights off", tier: "green" },
      { label: "Move through back streets", tier: "yellow" },
      { label: "Visit a friend nearby", tier: "yellow" },
      { label: "Go for a late-night drive", tier: "red" },
    ],
  },
  {
    prompt: "A patrol car slows near your usual hangout.",
    options: [
      { label: "Leave separately and quietly", tier: "green" },
      { label: "Wait it out in the alley", tier: "yellow" },
      { label: "Call someone for a pickup", tier: "yellow" },
      { label: "Wave and act normal", tier: "red" },
    ],
  },
  {
    prompt: "Your phone starts buzzing with people asking where you are.",
    options: [
      { label: "Turn it off for the night", tier: "green" },
      { label: "Answer only trusted contacts", tier: "yellow" },
      { label: "Send short vague replies", tier: "yellow" },
      { label: "Post a story to look casual", tier: "red" },
    ],
  },
  {
    prompt: "Someone says they saw officers asking questions nearby.",
    options: [
      { label: "Change clothes and stay put", tier: "green" },
      { label: "Move to a quiet safe room", tier: "yellow" },
      { label: "Ask around for details", tier: "yellow" },
      { label: "Confront the person talking", tier: "red" },
    ],
  },
  {
    prompt: "A familiar car idles outside longer than it should.",
    options: [
      { label: "Kill the lights and wait", tier: "green" },
      { label: "Exit through the back", tier: "yellow" },
      { label: "Text a lookout", tier: "yellow" },
      { label: "Step outside to check plates", tier: "red" },
    ],
  },
  {
    prompt: "The night is nearly over, but your name is still warm.",
    options: [
      { label: "Sleep somewhere quiet", tier: "green" },
      { label: "Move once before sunrise", tier: "yellow" },
      { label: "Split your cash and phone", tier: "yellow" },
      { label: "Head to your regular spot", tier: "red" },
    ],
  },
];

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function scoreForTier(tier, heat) {
  const highHeatPenalty = heat >= 75 ? 1 : heat >= 50 ? 0.5 : 0;
  if (tier === "green") return randInt(4, 6);
  if (tier === "yellow") return Math.max(0, randInt(1, 3) - Math.floor(highHeatPenalty));
  return -randInt(2, heat >= 65 ? 4 : 3);
}

function scenarioPoolForHeat(heat) {
  const pool = shuffle(SCENARIOS).slice(0, DECISIONS_PER_RUN);
  if (heat < 60) return pool;
  return pool.map((scenario) => ({
    ...scenario,
    options: scenario.options.map((option) => {
      if (option.tier !== "green" || Math.random() > 0.35) return option;
      return { ...option, tier: "yellow" };
    }),
  }));
}

async function setCooldown(guildId, userId) {
  const next = new Date(Date.now() + COOLDOWN_MINUTES * 60_000);
  await pool.query(
    `INSERT INTO cooldowns (guild_id, user_id, key, next_claim_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (guild_id, user_id, key)
     DO UPDATE SET next_claim_at = EXCLUDED.next_claim_at`,
    [guildId, userId, CRIME_KEY, next]
  );
}

function buildEmbed({ heat, scenario, step, score, feedback = "" }) {
  return new EmbedBuilder()
    .setTitle("🧥 Lay Low")
    .setDescription(
      [
        `Decision **${step + 1}/${DECISIONS_PER_RUN}**`,
        `Current heat: **${heat}/100**`,
        `Current score: **${score}**`,
        "",
        scenario.prompt,
        feedback ? `\n${feedback}` : "",
      ].join("\n")
    )
    .setColor(0x334155);
}

function componentsForScenario(sessionId, scenarioIndex, scenario) {
  const options = shuffle(scenario.options).slice(0, 4);
  return [
    new ActionRowBuilder().addComponents(
      options.map((option, index) =>
        new ButtonBuilder()
          .setCustomId(`laylow:${sessionId}:${scenarioIndex}:${index}:${option.tier}`)
          .setLabel(option.label)
          .setStyle(ButtonStyle.Secondary)
      )
    ),
  ];
}

module.exports = function startLayLow(interaction, context = {}) {
  return new Promise(async (resolve) => {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const startingHeat = Math.max(0, Math.min(100, Number(context.lingeringHeat ?? await getCrimeHeat(guildId, userId)) || 0));
    let heat = startingHeat;
    const scenarios = scenarioPoolForHeat(startingHeat);
    const sessionId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    let step = 0;
    let score = 0;
    let done = false;

    const finishOnce = () => {
      if (done) return;
      done = true;
      resolve();
    };

    const message = await interaction.fetchReply();
    const collector = message.createMessageComponentCollector({ time: 2 * 60_000 });

    async function render(feedback = "") {
      const scenario = scenarios[step];
      await interaction.editReply({
        content: null,
        embeds: [buildEmbed({ heat, scenario, step, score, feedback })],
        components: componentsForScenario(sessionId, step, scenario),
      }).catch(() => {});
    }

    async function finish(reason = "done") {
      await setCooldown(guildId, userId);
      collector.stop(reason);

      const delta = score;
      if (delta >= 0) {
        heat = Math.max(0, startingHeat - delta);
      } else {
        heat = Math.min(100, startingHeat + Math.abs(delta));
      }
      await setCrimeHeat(guildId, userId, heat, HEAT_TTL_MINUTES);

      const line = delta >= 0
        ? `✅ You stayed quiet and reduced heat by **${delta}%**.`
        : `❌ You made noise and increased heat by **${Math.abs(delta)}%**.`;

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🧥 Lay Low Complete")
            .setDescription(line)
            .addFields(
              { name: "Starting Heat", value: `${startingHeat}/100`, inline: true },
              { name: "Final Heat", value: `${heat}/100`, inline: true },
              { name: "Score", value: String(score), inline: true }
            )
            .setColor(delta >= 0 ? 0x22aa55 : 0xaa0000),
        ],
        components: [],
      }).catch(() => {});

      setTimeout(finishOnce, RESULTS_LINGER_MS);
    }

    collector.on("collect", async (i) => {
      if (i.user.id !== userId) {
        return i.reply({ content: "❌ Not your heat run.", flags: 64 }).catch(() => {});
      }

      await i.deferUpdate().catch(() => {});
      const parts = String(i.customId || "").split(":");
      if (parts.length !== 5 || parts[0] !== "laylow" || parts[1] !== sessionId) return;

      const tier = parts[4];
      const gained = scoreForTier(tier, startingHeat);
      score += gained;
      step += 1;

      if (step >= scenarios.length) return finish("done");

      const feedback = gained >= 4
        ? `Good move. **+${gained}**`
        : gained >= 0
          ? `It helps a little. **+${gained}**`
          : `Bad look. **${gained}**`;
      await render(feedback);
    });

    collector.on("end", async (_, reason) => {
      if (done || reason === "done") return;
      score -= 3;
      await finish("timeout");
    });

    await render();
  });
};

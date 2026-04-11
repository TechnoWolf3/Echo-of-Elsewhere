const { ButtonStyle } = require("discord.js");

const colors = {
  job: 0x2f8f5b,
  games: 0xd4af37,
  rituals: 0x7a2bff,
  bank: 0x0875af,
  ese: 0x2ecc71,
  admin: 0x5865f2,
  neutral: 0x2b2d31,
  success: 0x22aa55,
  danger: 0xaa0000,
  warning: 0xffd54a,
};

const systems = {
  job: {
    color: colors.job,
    footer: "Echo Work Board",
  },
  games: {
    color: colors.games,
    footer: "Echo Games Hub",
  },
  rituals: {
    color: colors.rituals,
    footer: "Echo Rituals",
  },
  bank: {
    color: colors.bank,
    footer: "Echo Reserve",
  },
};

const nav = {
  back: { label: "Back", emoji: "⬅️", style: ButtonStyle.Secondary },
  home: { label: "Home", emoji: "🏠", style: ButtonStyle.Primary },
  refresh: { label: "Refresh", emoji: "🔄", style: ButtonStyle.Secondary },
  close: { label: "Close", emoji: "🗑️", style: ButtonStyle.Danger },
};

function money(value) {
  return `$${Number(value || 0).toLocaleString("en-AU")}`;
}

function applySystemStyle(embed, systemId, footerText = null) {
  const system = systems[systemId] || systems.job;
  embed.setColor(system.color);
  if (footerText !== false) {
    embed.setFooter({ text: footerText || system.footer });
  }
  return embed;
}

function statusEmoji(status) {
  if (status === "success") return "✅";
  if (status === "danger" || status === "error") return "❌";
  if (status === "warning") return "⚠️";
  if (status === "active") return "🟡";
  return "🟢";
}

module.exports = {
  colors,
  systems,
  nav,
  money,
  applySystemStyle,
  statusEmoji,
};

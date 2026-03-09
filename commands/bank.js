const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require("discord.js");
const economy = require("../utils/economy");
const { guardNotJailed } = require("../utils/jail");

const BRAND_NAME = "Echo Holdings";
const BRAND_COLOR = 0x0875AF;

function money(n) {
  return `$${Number(n || 0).toLocaleString("en-AU")}`;
}

function buildHomeEmbed(user, snapshot) {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`🏦 ${BRAND_NAME}`)
    .setDescription("A polished ledger for the chaos of Echo of Elsewhere.")
    .addFields(
      { name: "Wallet", value: money(snapshot.wallet), inline: true },
      { name: "Bank", value: money(snapshot.bank), inline: true },
      { name: "Total Wealth", value: money(snapshot.total), inline: true },
      { name: "Account Number", value: `\`${snapshot.accountNumber || "Pending"}\``, inline: false },
      { name: "Banking Notes", value: "• Casino uses your **wallet**\n• Purchases use your **bank**\n• Transfers move **bank → bank**", inline: false },
    )
    .setFooter({ text: `${user.username} • ${BRAND_NAME}` })
    .setTimestamp();
}

function buildHomeComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("bank:deposit").setLabel("Deposit").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("bank:withdraw").setLabel("Withdraw").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("bank:transfer").setLabel("Transfer").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("bank:history").setLabel("History").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("bank:refresh").setLabel("Refresh").setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function parseAmount(raw, max) {
  const text = String(raw || "").trim().toLowerCase();
  if (!text) return null;
  if (text === "all" || text === "max") return Math.max(0, Number(max || 0));
  const n = Math.floor(Number(text.replace(/[$,\s]/g, "")));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function txLine(tx) {
  const meta = tx.meta || {};
  const ts = Math.floor(new Date(tx.created_at).getTime() / 1000);
  if (tx.type === "bank_deposit") return `📥 Deposited **${money(meta.amount)}** • <t:${ts}:R>`;
  if (tx.type === "bank_withdraw") return `📤 Withdrew **${money(meta.amount)}** • <t:${ts}:R>`;
  if (tx.type === "bank_transfer_out") return `🔁 Sent **${money(Math.abs(meta.amount || tx.amount || 0))}** to account \`${meta.toAccountNumber || "?"}\` • <t:${ts}:R>`;
  if (tx.type === "bank_transfer_in") return `💸 Received **${money(meta.amount || tx.amount || 0)}** from account \`${meta.fromAccountNumber || "?"}\` • <t:${ts}:R>`;
  const amount = Number(tx.amount || 0);
  const icon = amount >= 0 ? "➕" : "➖";
  return `${icon} **${tx.type}** • ${money(amount)} • <t:${ts}:R>`;
}

async function sendHome(interaction, user) {
  const snapshot = await economy.getEconomySnapshot(interaction.guildId, user.id);
  const payload = {
    embeds: [buildHomeEmbed(user, snapshot)],
    components: buildHomeComponents(),
    flags: MessageFlags.Ephemeral,
  };
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.reply(payload);
}

function buildAmountModal(kind) {
  return new ModalBuilder()
    .setCustomId(`bank:modal:${kind}`)
    .setTitle(kind === "deposit" ? "Deposit Funds" : "Withdraw Funds")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("amount")
          .setLabel("Amount")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Enter a number, or type 'all'")
          .setRequired(true)
      )
    );
}

function buildTransferModal() {
  return new ModalBuilder()
    .setCustomId("bank:modal:transfer")
    .setTitle("Bank Transfer")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("account_number")
          .setLabel("Recipient Account Number")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("10-digit account number")
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("amount")
          .setLabel("Amount")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Enter an amount")
          .setRequired(true)
      )
    );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("bank")
    .setDescription("Open the Echo Holdings banking hub."),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: "❌ Server only.", flags: MessageFlags.Ephemeral });
    }
    await economy.ensureUser(interaction.guildId, interaction.user.id);
    return sendHome(interaction, interaction.user);
  },

  async handleInteraction(interaction) {
    const cid = String(interaction.customId || "");
    if (!cid.startsWith("bank:")) return false;

    if (!interaction.inGuild()) {
      await interaction.reply({ content: "❌ Server only.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }

    try {
      if (interaction.isButton()) {
        if (cid === "bank:refresh") {
          await interaction.deferUpdate().catch(() => {});
          await sendHome(interaction, interaction.user);
          return true;
        }

        if (cid === "bank:history") {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
          const txs = await economy.getRecentTransactions(interaction.guildId, interaction.user.id, 10);
          const embed = new EmbedBuilder()
            .setColor(BRAND_COLOR)
            .setTitle(`📜 ${BRAND_NAME} Statement`)
            .setDescription(txs.length ? txs.map(txLine).join("\n") : "No transactions have been recorded yet.")
            .setFooter({ text: "Last 10 transactions" })
            .setTimestamp();
          await interaction.editReply({ embeds: [embed], components: buildHomeComponents() });
          return true;
        }

        if (cid === "bank:deposit") {
          if (await guardNotJailed(interaction)) return true;
          await interaction.showModal(buildAmountModal("deposit"));
          return true;
        }

        if (cid === "bank:withdraw") {
          if (await guardNotJailed(interaction)) return true;
          await interaction.showModal(buildAmountModal("withdraw"));
          return true;
        }

        if (cid === "bank:transfer") {
          if (await guardNotJailed(interaction)) return true;
          await interaction.showModal(buildTransferModal());
          return true;
        }
      }

      if (interaction.isModalSubmit()) {
        if (await guardNotJailed(interaction)) return true;

        if (cid === "bank:modal:deposit") {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
          const snap = await economy.getEconomySnapshot(interaction.guildId, interaction.user.id);
          const amount = parseAmount(interaction.fields.getTextInputValue("amount"), snap.wallet);
          if (!amount || amount > snap.wallet) {
            await interaction.editReply(`❌ You can only deposit up to **${money(snap.wallet)}** from your wallet.`);
            return true;
          }
          const moved = await economy.depositToBank(interaction.guildId, interaction.user.id, amount, { via: "bank_hub" });
          if (!moved.ok) {
            await interaction.editReply("❌ Deposit failed.");
            return true;
          }
          await interaction.editReply({
            content: `✅ Deposited **${money(amount)}** into your ${BRAND_NAME} account.`,
            embeds: [buildHomeEmbed(interaction.user, { ...moved, total: moved.wallet + moved.bank })],
            components: buildHomeComponents(),
          });
          return true;
        }

        if (cid === "bank:modal:withdraw") {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
          const snap = await economy.getEconomySnapshot(interaction.guildId, interaction.user.id);
          const amount = parseAmount(interaction.fields.getTextInputValue("amount"), snap.bank);
          if (!amount || amount > snap.bank) {
            await interaction.editReply(`❌ You can only withdraw up to **${money(snap.bank)}** from your bank.`);
            return true;
          }
          const moved = await economy.withdrawFromBank(interaction.guildId, interaction.user.id, amount, { via: "bank_hub" });
          if (!moved.ok) {
            await interaction.editReply("❌ Withdrawal failed.");
            return true;
          }
          await interaction.editReply({
            content: `✅ Withdrew **${money(amount)}** into your wallet.`,
            embeds: [buildHomeEmbed(interaction.user, { ...moved, total: moved.wallet + moved.bank })],
            components: buildHomeComponents(),
          });
          return true;
        }

        if (cid === "bank:modal:transfer") {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
          const accountNumber = String(interaction.fields.getTextInputValue("account_number") || "").replace(/\D/g, "");
          const amount = parseAmount(interaction.fields.getTextInputValue("amount"), Infinity);
          if (!accountNumber || accountNumber.length < 6) {
            await interaction.editReply("❌ Enter a valid account number.");
            return true;
          }
          if (!amount) {
            await interaction.editReply("❌ Enter a valid transfer amount.");
            return true;
          }

          const res = await economy.transferBankByAccount(interaction.guildId, interaction.user.id, accountNumber, amount, { via: "bank_hub" });
          if (!res.ok) {
            const reasonMap = {
              account_not_found: "❌ That account number could not be found.",
              same_account: "❌ You can’t transfer to your own account.",
              insufficient_funds: "❌ You don’t have enough in your bank balance for that transfer.",
              source_missing: "❌ Your bank profile could not be loaded.",
            };
            await interaction.editReply(reasonMap[res.reason] || "❌ Transfer failed.");
            return true;
          }

          const snap = await economy.getEconomySnapshot(interaction.guildId, interaction.user.id);
          await interaction.editReply({
            content: `✅ Sent **${money(amount)}** to account \`${accountNumber}\`.`,
            embeds: [buildHomeEmbed(interaction.user, snap)],
            components: buildHomeComponents(),
          });
          return true;
        }
      }
    } catch (e) {
      console.error("[BANK] interaction failed:", e);
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: "❌ Echo Holdings hit a paperwork snag.", flags: MessageFlags.Ephemeral });
        } else {
          await interaction.reply({ content: "❌ Echo Holdings hit a paperwork snag.", flags: MessageFlags.Ephemeral });
        }
      } catch {}
      return true;
    }

    return false;
  },
};

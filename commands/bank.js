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
const bankLoans = require("../utils/bankLoans");
const recurringDeposits = require("../utils/bankRecurringDeposits");
const { guardNotJailed } = require("../utils/jail");

const BRAND_NAME = "The Echo Reserve";
const BRAND_COLOR = 0x0875AF;
const BANK_LOGO = "https://i.ibb.co/rR1VMCSW/The-Echo-Reserve-Logo.png";
const BRAND_MOTTO = "Stability. Security. Silence.";

function money(n) {
  return `$${Number(n || 0).toLocaleString("en-AU")}`;
}

function formatTs(dateLike, style = "R") {
  const ts = Math.floor(new Date(dateLike).getTime() / 1000);
  return `<t:${ts}:${style}>`;
}

function buildHomeEmbed(user, snapshot, loan, recurringDeposit = null) {
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`🏦 ${BRAND_NAME}`)
    .setDescription(`${BRAND_MOTTO}\n\nA polished ledger for the chaos of Echo of Elsewhere.`)
    .addFields(
      { name: "Wallet", value: money(snapshot.wallet), inline: true },
      { name: "Bank", value: money(snapshot.bank), inline: true },
      { name: "Total Wealth", value: money(snapshot.total), inline: true },
      { name: "Account Number", value: `\`${snapshot.accountNumber || "Pending"}\``, inline: false },
      { name: "Banking Notes", value: "• Casino uses your **wallet**\n• Purchases use your **bank**\n• Transfers move **bank → bank**", inline: false },
    )
    .setFooter({ text: `${user.username} • ${BRAND_NAME} • ${BRAND_MOTTO}` })
    .setTimestamp();

  if (loan) {
    embed.addFields({
      name: "Loan Status",
      value: `**${bankLoans.formatLoanStatus(loan.status)}**\nRemaining: **${money(loan.remaining_due)}**\nDue: ${formatTs(loan.due_at)}${loan.status !== bankLoans.STATUS.ACTIVE ? `\nDefault: ${formatTs(loan.default_at)}` : ""}`,
      inline: false,
    });
  }

  if (recurringDeposit?.enabled) {
    embed.addFields({
      name: "Daily Auto-Deposit",
      value: `**${money(recurringDeposit.amount)}** from wallet to bank\nNext run: ${formatTs(recurringDeposit.next_run_at)}`,
      inline: false,
    });
  }

  if (BANK_LOGO && BANK_LOGO !== "https://i.ibb.co/rR1VMCSW/The-Echo-Reserve-Logo.png") {
    embed.setThumbnail(BANK_LOGO);
  }

  return embed;
}

function buildHomeComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("bank:deposit").setLabel("Deposit").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("bank:withdraw").setLabel("Withdraw").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("bank:transfer").setLabel("Transfer").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("bank:history").setLabel("History").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("bank:loans").setLabel("Loans").setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("bank:refresh").setLabel("Refresh").setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function buildLoansComponents(activeLoan) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("bank:loan:offers").setLabel("View Offers").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("bank:loan:view").setLabel("My Loan").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("bank:loan:repay").setLabel("Repay").setStyle(ButtonStyle.Success).setDisabled(!activeLoan),
      new ButtonBuilder().setCustomId("bank:home").setLabel("Back").setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function buildRepayModal() {
  return new ModalBuilder()
    .setCustomId("bank:modal:loan_repay")
    .setTitle("Repay Loan")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("amount")
          .setLabel("Amount")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Enter an amount, or type 'all'")
          .setRequired(true)
      )
    );
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
  if (tx.type === "bank_transfer_in") {
    const recovered = Number(meta.recoveredAmount || 0);
    const extra = recovered > 0 ? ` (${money(recovered)} seized for debt)` : "";
    return `💸 Received **${money(meta.creditedAmount || meta.amount || tx.amount || 0)}** from account \`${meta.fromAccountNumber || "?"}\`${extra} • <t:${ts}:R>`;
  }
  if (tx.type === "loan_disbursed") return `🏦 Loan disbursed **${money(tx.amount)}** • <t:${ts}:R>`;
  if (tx.type === "loan_recovery_garnish") return `⚖️ Reserve seized **${money(meta.amount)}** from incoming funds • <t:${ts}:R>`;
  if (tx.type === "loan_recovery_bank_sweep") return `🏛️ Reserve swept **${money(Math.abs(tx.amount || 0))}** from bank • <t:${ts}:R>`;
  if (tx.type === "loan_recovery_wallet_sweep") return `👛 Reserve swept **${money(Math.abs(tx.amount || 0))}** from wallet • <t:${ts}:R>`;
  if (tx.type === "loan_manual_payment_bank") return `✅ Loan payment **${money(Math.abs(tx.amount || 0))}** from bank • <t:${ts}:R>`;
  if (tx.type === "loan_manual_payment_wallet") return `✅ Loan payment **${money(Math.abs(tx.amount || 0))}** from wallet • <t:${ts}:R>`;
  const amount = Number(tx.amount || 0);
  const icon = amount >= 0 ? "➕" : "➖";
  return `${icon} **${tx.type}** • ${money(amount)} • <t:${ts}:R>`;
}

async function buildLoansHome(user, guildId) {
  await bankLoans.sweepRecoverableBalances(guildId, user.id).catch(() => {});
  const snapshot = await economy.getEconomySnapshot(guildId, user.id);
  const loan = await bankLoans.getActiveLoan(guildId, user.id);
  const history = await bankLoans.getLoanHistory(guildId, user.id, 3);

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`💳 ${BRAND_NAME} Loans`)
    .setDescription("Reserve lending is simple, expensive, and extremely serious once you miss your date.")
    .addFields(
      { name: "Wallet", value: money(snapshot.wallet), inline: true },
      { name: "Bank", value: money(snapshot.bank), inline: true },
      { name: "Total Wealth", value: money(snapshot.total), inline: true },
    )
    .setFooter({ text: `${user.username} • ${BRAND_MOTTO}` })
    .setTimestamp();

  if (loan) {
    const garnish = loan.status === bankLoans.STATUS.OVERDUE ? "50%" : loan.status === bankLoans.STATUS.DEFAULTED ? "90%" : "0%";
    embed.addFields({
      name: `Current Obligation • ${bankLoans.formatLoanStatus(loan.status)}`,
      value: `Principal: **${money(loan.principal)}**\nRemaining: **${money(loan.remaining_due)}**\nDue: ${formatTs(loan.due_at)}\nDefault: ${formatTs(loan.default_at)}\nRecovery Rate: **${garnish}**`,
      inline: false,
    });
  } else {
    embed.addFields({ name: "Current Obligation", value: "No active Reserve obligation.", inline: false });
  }

  if (history.length) {
    embed.addFields({
      name: "Recent Loan History",
      value: history.map((x) => `• **${x.offer_name}** — ${bankLoans.formatLoanStatus(x.status)} — ${money(x.remaining_due)} remaining`).join("\n"),
      inline: false,
    });
  }

  if (BANK_LOGO && BANK_LOGO !== "https://i.ibb.co/rR1VMCSW/The-Echo-Reserve-Logo.png") {
    embed.setThumbnail(BANK_LOGO);
  }

  return { embeds: [embed], components: buildLoansComponents(loan) };
}

async function sendHome(interaction, user) {
  await bankLoans.sweepRecoverableBalances(interaction.guildId, user.id).catch(() => {});
  const snapshot = await economy.getEconomySnapshot(interaction.guildId, user.id);
  const loan = await bankLoans.getActiveLoan(interaction.guildId, user.id);
  const recurringDeposit = await recurringDeposits.getRecurringDeposit(interaction.guildId, user.id).catch(() => null);
  const payload = {
    embeds: [buildHomeEmbed(user, snapshot, loan, recurringDeposit)],
    components: buildHomeComponents(),
    flags: MessageFlags.Ephemeral,
  };
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.reply(payload);
}

function buildAmountModal(kind) {
  const modal = new ModalBuilder()
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

  if (kind === "deposit") {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("recurring")
          .setLabel("Recurring daily? yes/no")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("yes to enable, no to skip, stop to cancel")
          .setRequired(false)
      )
    );
  }

  return modal;
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
    .setDescription("Open the Echo Reserve banking hub."),

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
        if (cid === "bank:refresh" || cid === "bank:home") {
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
            .setFooter({ text: `Last 10 transactions • ${BRAND_MOTTO}` })
            .setTimestamp();

          if (BANK_LOGO && BANK_LOGO !== "https://i.ibb.co/rR1VMCSW/The-Echo-Reserve-Logo.png") {
            embed.setThumbnail(BANK_LOGO);
          }

          await interaction.editReply({ embeds: [embed], components: buildHomeComponents() });
          return true;
        }

        if (cid === "bank:loans") {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
          const payload = await buildLoansHome(interaction.user, interaction.guildId);
          await interaction.editReply(payload);
          return true;
        }

        if (cid === "bank:loan:view") {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
          const payload = await buildLoansHome(interaction.user, interaction.guildId);
          await interaction.editReply(payload);
          return true;
        }

        if (cid === "bank:loan:offers") {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
          const snapshot = await economy.getEconomySnapshot(interaction.guildId, interaction.user.id);
          const offers = await bankLoans.getLoanOffersForUser(interaction.guildId, interaction.user.id, snapshot);
          const rows = [];
          let current = new ActionRowBuilder();
          let used = 0;
          for (const offer of offers) {
            if (used === 5) {
              rows.push(current);
              current = new ActionRowBuilder();
              used = 0;
            }
            current.addComponents(
              new ButtonBuilder()
                .setCustomId(`bank:loan:take:${offer.id}`)
                .setLabel(offer.name.slice(0, 80))
                .setStyle(offer.available ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setDisabled(!offer.available)
            );
            used += 1;
          }
          if (used) rows.push(current);
          rows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("bank:loan:view").setLabel("Back").setStyle(ButtonStyle.Secondary)
          ));

          const embed = new EmbedBuilder()
            .setColor(BRAND_COLOR)
            .setTitle(`💼 ${BRAND_NAME} Offers`)
            .setDescription(offers.map((offer) => {
              const req = Number(offer.minTotalWealth || 0) > 0 ? `Requires total wealth of **${money(offer.minTotalWealth)}**.` : "Available to all account holders.";
              const state = offer.available ? "✅ Available" : `⛔ ${offer.unavailableReason}`;
              return `**${offer.name}**\n${offer.description}\nBorrow **${money(offer.principal)}** • Repay **${money(offer.totalDue)}** • Due in **${offer.days}d** (+${offer.graceDays}d grace)\n${req}\n${state}`;
            }).join("\n\n"))
            .setTimestamp();

          await interaction.editReply({ embeds: [embed], components: rows });
          return true;
        }

        if (cid.startsWith("bank:loan:take:")) {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
          const offerId = cid.split(":").pop();
          const result = await bankLoans.acceptLoanOffer(interaction.guildId, interaction.user.id, offerId);
          if (!result.ok) {
            const msg = {
              offer_not_found: "❌ That loan offer no longer exists.",
              active_loan_exists: "❌ You already have an active Reserve obligation.",
              offer_locked: "❌ Your account does not meet the requirements for that offer.",
            }[result.reason] || "❌ The Reserve declined that application.";
            await interaction.editReply({ content: msg });
            return true;
          }
          await interaction.editReply({
            content: `✅ Loan approved. **${money(result.loan.principal)}** has been deposited into your bank account. You owe **${money(result.loan.total_due)}** by ${formatTs(result.loan.due_at, "F")}.`,
            embeds: [buildHomeEmbed(interaction.user, result.snapshot, result.loan)],
            components: buildHomeComponents(),
          });
          return true;
        }

        if (cid === "bank:loan:repay") {
          if (await guardNotJailed(interaction)) return true;
          await interaction.showModal(buildRepayModal());
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
          const recurringText = String(interaction.fields.getTextInputValue("recurring") || "").trim().toLowerCase();
          let recurringLine = "";
          if (["yes", "y", "daily"].includes(recurringText)) {
            const schedule = await recurringDeposits.setRecurringDeposit(interaction.guildId, interaction.user.id, amount);
            recurringLine = ` Daily auto-deposit set for **${money(schedule.amount)}** starting ${formatTs(schedule.next_run_at)}.`;
          } else if (["stop", "cancel", "off", "disable"].includes(recurringText)) {
            await recurringDeposits.disableRecurringDeposit(interaction.guildId, interaction.user.id);
            recurringLine = " Daily auto-deposit cancelled.";
          }
          const recurringDeposit = await recurringDeposits.getRecurringDeposit(interaction.guildId, interaction.user.id).catch(() => null);
          if (recurringLine) {
            await interaction.followUp({ content: recurringLine.trim(), flags: MessageFlags.Ephemeral }).catch(() => {});
          }
          await interaction.editReply({
            content: `✅ Deposited **${money(amount)}** into your ${BRAND_NAME} account.`,
            embeds: [buildHomeEmbed(interaction.user, { ...moved, total: moved.wallet + moved.bank }, await bankLoans.getActiveLoan(interaction.guildId, interaction.user.id), recurringDeposit)],
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
            const msg = moved.reason === "loan_defaulted"
              ? "❌ Your bank is under Reserve recovery. Withdrawals are blocked while defaulted."
              : "❌ Withdrawal failed.";
            await interaction.editReply(msg);
            return true;
          }
          await interaction.editReply({
            content: `✅ Withdrew **${money(amount)}** into your wallet.`,
            embeds: [buildHomeEmbed(interaction.user, { ...moved, total: moved.wallet + moved.bank }, await bankLoans.getActiveLoan(interaction.guildId, interaction.user.id))],
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
              loan_defaulted: "❌ Transfers are blocked while your account is in default recovery.",
            };
            await interaction.editReply(reasonMap[res.reason] || "❌ Transfer failed.");
            return true;
          }

          const snap = await economy.getEconomySnapshot(interaction.guildId, interaction.user.id);
          await interaction.editReply({
            content: `✅ Sent **${money(amount)}** to account \`${accountNumber}\`.`,
            embeds: [buildHomeEmbed(interaction.user, snap, await bankLoans.getActiveLoan(interaction.guildId, interaction.user.id))],
            components: buildHomeComponents(),
          });
          return true;
        }

        if (cid === "bank:modal:loan_repay") {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
          const snap = await economy.getEconomySnapshot(interaction.guildId, interaction.user.id);
          const loan = await bankLoans.getActiveLoan(interaction.guildId, interaction.user.id);
          if (!loan) {
            await interaction.editReply("❌ You do not have an active loan.");
            return true;
          }
          const amount = parseAmount(interaction.fields.getTextInputValue("amount"), snap.wallet + snap.bank);
          if (!amount) {
            await interaction.editReply("❌ Enter a valid repayment amount.");
            return true;
          }
          const result = await bankLoans.repayLoan(interaction.guildId, interaction.user.id, amount);
          if (!result.ok) {
            const msg = result.reason === "insufficient_funds"
              ? "❌ You do not have enough available funds to make that payment."
              : "❌ You do not have an active loan.";
            await interaction.editReply(msg);
            return true;
          }
          await interaction.editReply({
            content: `✅ Paid **${money(result.paid)}** toward your Reserve obligation.${result.loan.status === bankLoans.STATUS.PAID ? " Loan cleared." : ` Remaining due: **${money(result.loan.remaining_due)}**.`}`,
            embeds: [buildHomeEmbed(interaction.user, result.snapshot, result.loan.status === bankLoans.STATUS.PAID ? null : result.loan)],
            components: buildHomeComponents(),
          });
          return true;
        }
      }
    } catch (e) {
      console.error("[BANK] interaction failed:", e);
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: "❌ The Echo Reserve hit a paperwork snag.", flags: MessageFlags.Ephemeral });
        } else {
          await interaction.reply({ content: "❌ The Echo Reserve hit a paperwork snag.", flags: MessageFlags.Ephemeral });
        }
      } catch {}
      return true;
    }

    return false;
  },
};

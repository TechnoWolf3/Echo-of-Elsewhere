const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require("discord.js");

const db = require("../utils/db");

const SETTINGS = {
    bot_channel_id: {
        label: "Bot Channel",
        placeholder: "Enter Channel ID",
        type: "channel"
    },
    feature_hub_channel_id: {
        label: "Feature Hub",
        placeholder: "Enter Channel ID",
        type: "channel"
    },
    powerball_channel_id: {
        label: "Powerball",
        placeholder: "Enter Channel ID",
        type: "channel"
    },
    ese_news_channel_id: {
        label: "ESE News",
        placeholder: "Enter Channel ID",
        type: "channel"
    },
    bot_master_role_id: {
        label: "Bot Master",
        placeholder: "Enter Role ID",
        type: "role"
    }
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName("configure")
        .setDescription("Configure Echo for this server.")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await showPanel(interaction);
    },

    async handleComponent(interaction) {
        const cid = interaction.customId;

        if (!cid.startsWith("configure:")) return false;

        // =========================================
        // MODAL SUBMISSIONS
        // =========================================
        if (interaction.isModalSubmit()) {
            const parts = cid.split(":");

            // configure:modal:set:bot_channel_id
            const settingKey = parts[3];

            if (!SETTINGS[settingKey]) {
                await interaction.reply({
                    content: "Unknown configuration option.",
                    ephemeral: true
                });
                return true;
            }

            const value =
                interaction.fields.getTextInputValue("value");

            await db.query(
                `
                INSERT INTO guild_settings
                    (guild_id, ${settingKey})
                VALUES
                    ($1, $2)
                ON CONFLICT (guild_id)
                DO UPDATE SET
                    ${settingKey} = EXCLUDED.${settingKey}
                `,
                [interaction.guild.id, value]
            );

            await interaction.reply({
                content: `✅ ${SETTINGS[settingKey].label} updated.`,
                ephemeral: true
            });

            return true;
        }

        // =========================================
        // BUTTONS
        // =========================================
        if (interaction.isButton()) {
            const parts = cid.split(":");

            // configure:set:bot_channel_id
            const action = parts[1];
            const settingKey = parts[2];

            if (action === "refresh") {
                await showPanel(interaction, true);
                return true;
            }

            if (!SETTINGS[settingKey]) {
                await interaction.reply({
                    content: "Unknown configuration option.",
                    ephemeral: true
                });
                return true;
            }

            // OPEN SET MODAL
            if (action === "set") {
                const modal = new ModalBuilder()
                    .setCustomId(
                        `configure:modal:set:${settingKey}`
                    )
                    .setTitle(
                        `Set ${SETTINGS[settingKey].label}`
                    );

                const input = new TextInputBuilder()
                    .setCustomId("value")
                    .setLabel(SETTINGS[settingKey].placeholder)
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(input)
                );

                await interaction.showModal(modal);
                return true;
            }

            // CLEAR SETTING
            if (action === "clear") {
                await db.query(
                    `
                    INSERT INTO guild_settings
                        (guild_id, ${settingKey})
                    VALUES
                        ($1, NULL)
                    ON CONFLICT (guild_id)
                    DO UPDATE SET
                        ${settingKey} = NULL
                    `,
                    [interaction.guild.id]
                );

                await interaction.reply({
                    content: `🗑️ ${SETTINGS[settingKey].label} cleared.`,
                    ephemeral: true
                });

                return true;
            }
        }

        return false;
    }
};

async function showPanel(interaction, update = false) {
    const result = await db.query(
        `
        SELECT *
        FROM guild_settings
        WHERE guild_id = $1
        `,
        [interaction.guild.id]
    );

    const settings = result.rows[0] || {};

    const embed = new EmbedBuilder()
        .setColor("#0875AF")
        .setTitle("⚙️ Echo Configuration")
        .setDescription(
            [
                "**Missing Setup**",
                !settings.bot_channel_id
                    ? "• Bot Channel"
                    : null,
                !settings.feature_hub_channel_id
                    ? "• Feature Hub"
                    : null,
                !settings.powerball_channel_id
                    ? "• Powerball"
                    : null,
                !settings.ese_news_channel_id
                    ? "• ESE News"
                    : null,
                !settings.bot_master_role_id
                    ? "• Bot Master"
                    : null,
                "",
                "Basic setup lives here. Powerful tuning stays in /adminpanel."
            ]
                .filter(Boolean)
                .join("\n")
        );

    const rows = [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(
                    "configure:set:bot_channel_id"
                )
                .setLabel("Set Bot Channel")
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId(
                    "configure:set:feature_hub_channel_id"
                )
                .setLabel("Set Feature Hub")
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId(
                    "configure:set:powerball_channel_id"
                )
                .setLabel("Set Powerball")
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId(
                    "configure:set:ese_news_channel_id"
                )
                .setLabel("Set ESE News")
                .setStyle(ButtonStyle.Primary)
        ),

        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(
                    "configure:clear:bot_channel_id"
                )
                .setLabel("Clear Bot Channel")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId(
                    "configure:clear:feature_hub_channel_id"
                )
                .setLabel("Clear Feature Hub")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId(
                    "configure:clear:powerball_channel_id"
                )
                .setLabel("Clear Powerball")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId(
                    "configure:clear:ese_news_channel_id"
                )
                .setLabel("Clear ESE News")
                .setStyle(ButtonStyle.Secondary)
        ),

        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(
                    "configure:set:bot_master_role_id"
                )
                .setLabel("Set Bot Master")
                .setStyle(ButtonStyle.Danger),

            new ButtonBuilder()
                .setCustomId("configure:refresh")
                .setLabel("Refresh")
                .setStyle(ButtonStyle.Secondary)
        )
    ];

    if (update) {
        await interaction.update({
            embeds: [embed],
            components: rows
        });
    } else {
        await interaction.reply({
            embeds: [embed],
            components: rows,
            ephemeral: true
        });
    }
}
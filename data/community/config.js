const COMMUNITY_SYSTEM = {
  name: "Echo Resonance",
  hubName: "Echo Community",
  color: 0x0875af,
  footer: "Echo Community",
};

const DEFAULT_SETTINGS = {
  enabled: true,
  levelupChannelId: null,
  announceLevelups: true,
  chatXpMin: 15,
  chatXpMax: 25,
  chatXpCooldownSeconds: 60,
  minMessageLength: 5,
  voiceXpMin: 8,
  voiceXpMax: 15,
  voiceXpIntervalSeconds: 5 * 60,
  ignoredTextChannelIds: [],
  ignoredVoiceChannelIds: [],
  ignoredRoleIds: [],
};

module.exports = {
  COMMUNITY_SYSTEM,
  DEFAULT_SETTINGS,
};

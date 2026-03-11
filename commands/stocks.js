const eseCommand = require("./ese");

module.exports = {
  data: eseCommand.data
    .toJSON
    ? {
        ...eseCommand.data.toJSON(),
        name: "stocks",
        description: "Open the Echo Stock Exchange hub.",
      }
    : eseCommand.data,

  async execute(interaction) {
    return eseCommand.execute(interaction);
  },

  async handleComponent(interaction) {
    return eseCommand.handleComponent(interaction);
  },
};
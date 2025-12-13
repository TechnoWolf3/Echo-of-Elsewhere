const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function makeDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ r, s });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardStr(c) {
  if (!c) return "?";
  return `${c.r}${c.s}`;
}

function handValue(hand) {
  let total = 0;
  let aces = 0;

  for (const c of hand) {
    if (c.r === "A") {
      aces++;
      total += 11;
    } else if (["K", "Q", "J"].includes(c.r)) {
      total += 10;
    } else {
      total += parseInt(c.r, 10);
    }
  }

  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }

  return total;
}

class BlackjackSession {
  constructor({ channel, hostId }) {
    this.channel = channel;
    this.hostId = hostId;

    this.state = "lobby"; // lobby | playing | ended
    this.players = new Map();
    this.turnOrder = [];
    this.turnIndex = 0;

    this.dealerHand = [];
    this.deck = makeDeck();

    this.message = null;
    this.resultsMessage = null;
    this.timeout = null;

    this.gameId = `${Date.now()}`;
    this.maxPlayers = 10;
  }

  isHost(id) {
    return id === this.hostId;
  }

  currentPlayerId() {
    return this.turnOrder[this.turnIndex] ?? null;
  }

  addPlayer(user) {
    if (this.state !== "lobby") return { ok: false, msg: "Game already started." };
    if (this.players.has(user.id)) return { ok: false, msg: "You’re already in." };
    if (this.players.size >= this.maxPlayers)
      return { ok: false, msg: `Game is full (${this.maxPlayers} players).` };

    this.players.set(user.id, { user, hand: [], status: "Waiting" });
    return { ok: true };
  }

  removePlayer(id) {
    if (!this.players.has(id)) return { ok: false, msg: "You’re not in the game." };
    if (this.state !== "lobby") return { ok: false, msg: "Can’t leave after start." };
    this.players.delete(id);
    return { ok: true };
  }

  draw() {
    if (this.deck.length === 0) this.deck = makeDeck();
    return this.deck.pop();
  }

  dealInitial() {
    this.dealerHand = [this.draw(), this.draw()];

    for (const p of this.players.values()) {
      p.hand = [this.draw(), this.draw()];
      p.status = handValue(p.hand) === 21 ? "Blackjack" : "Playing";
    }

    this.turnOrder = [...this.players.keys()].filter(
      (id) => this.players.get(id)?.status === "Playing"
    );
    this.turnIndex = 0;
  }

  async start() {
    this.state = "playing";
    this.dealInitial();

    if (this.turnOrder.length === 0) {
      await this.finishGame();
      return;
    }

    await this.updatePanel();
    this.armTimeout();
  }

  armTimeout() {
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = setTimeout(async () => {
      const id = this.currentPlayerId();
      if (!id) return;
      const p = this.players.get(id);
      if (p && p.status === "Playing") p.status = "Stood";
      await this.advanceTurn();
    }, 60_000);
  }

  async hit(id) {
    if (id !== this.currentPlayerId()) return { ok: false, msg: "Not your turn." };
    const p = this.players.get(id);
    p.hand.push(this.draw());

    const v = handValue(p.hand);
    if (v > 21) p.status = "Busted";
    else if (v === 21) p.status = "Stood";

    await this.advanceTurn();
    return { ok: true, player: p };
  }

  async stand(id) {
    if (id !== this.currentPlayerId()) return { ok: false, msg: "Not your turn." };
    const p = this.players.get(id);
    p.status = "Stood";
    await this.advanceTurn();
    return { ok: true, player: p };
  }

  async advanceTurn() {
    if (this.timeout) clearTimeout(this.timeout);

    while (
      this.turnIndex < this.turnOrder.length &&
      this.players.get(this.turnOrder[this.turnIndex])?.status !== "Playing"
    ) {
      this.turnIndex++;
    }

    if (this.turnIndex >= this.turnOrder.length) {
      await this.finishGame();
      return;
    }

    await this.updatePanel();
    this.armTimeout();
  }

  async finishGame() {
    let dv = handValue(this.dealerHand);
    while (dv < 17) {
      this.dealerHand.push(this.draw());
      dv = handValue(this.dealerHand);
    }

    this.state = "ended";
    await this.updatePanel(true);

    this.resultsMessage = await this.channel.send({
      embeds: [this.resultsEmbed()],
    });
  }

  resultsEmbed() {
    const dv = handValue(this.dealerHand);
    const lines = [];

    for (const p of this.players.values()) {
      const pv = handValue(p.hand);
      let result = "❌ Lose";
      if (p.status === "Busted") result = "❌ Bust";
      else if (dv > 21 || pv > dv) result = "✅ Win";
      else if (pv === dv) result = "🤝 Push";

      lines.push(`${p.user}: **${pv}** — ${result}`);
    }

    return new EmbedBuilder()
      .setTitle("🃏 Blackjack Results")
      .setDescription(
        `**Dealer:** ${this.dealerHand.map(cardStr).join(" ")} (**${dv}**)\n\n${lines.join("\n")}`
      );
  }

  lobbyComponents() {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`bj:${this.gameId}:join`).setLabel("Join").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`bj:${this.gameId}:leave`).setLabel("Leave").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`bj:${this.gameId}:start`).setLabel("Start").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`bj:${this.gameId}:end`).setLabel("End").setStyle(ButtonStyle.Danger)
      ),
    ];
  }

  playComponents() {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`bj:${this.gameId}:hit`).setLabel("Hit").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`bj:${this.gameId}:stand`).setLabel("Stand").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`bj:${this.gameId}:hand`).setLabel("View Hand").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`bj:${this.gameId}:end`).setLabel("End").setStyle(ButtonStyle.Danger)
      ),
    ];
  }

  panelEmbed(reveal = false) {
    const dealer =
      this.dealerHand.length === 0
        ? "_Not dealt yet_"
        : reveal
        ? `${this.dealerHand.map(cardStr).join(" ")} (**${handValue(this.dealerHand)}**)`
        : `${cardStr(this.dealerHand[0])} ?`;

    const players = [...this.players.values()].map(
      (p) => `${p.user} — **${p.status}**`
    );

    return new EmbedBuilder()
      .setTitle("🃏 Blackjack")
      .setDescription(
        `**Dealer:** ${dealer}\n\n**Players (${this.players.size}/${this.maxPlayers}):**\n${
          players.join("\n") || "_None_"
        }`
      );
  }

  async postOrEditPanel() {
    const embed = this.panelEmbed(false);
    const components = this.lobbyComponents();

    if (!this.message) {
      this.message = await this.channel.send({ embeds: [embed], components });
    } else {
      await this.message.edit({ embeds: [embed], components });
    }
  }

  async updatePanel(reveal = false) {
    if (!this.message) return;

    const embeds = [this.panelEmbed(reveal)];
    const components =
      this.state === "lobby"
        ? this.lobbyComponents()
        : this.state === "playing"
        ? this.playComponents()
        : [];

    await this.message.edit({ embeds, components });
  }
}

module.exports = {
  BlackjackSession,
  handValue,
  cardStr,
};

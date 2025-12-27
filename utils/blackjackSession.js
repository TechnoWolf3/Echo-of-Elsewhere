// utils/blackjackSession.js
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

function handValue(cards) {
  let total = 0;
  let aces = 0;

  for (const c of cards) {
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

function isBlackjack(cards) {
  return cards.length === 2 && handValue(cards) === 21;
}

/**
 * ✅ House Rule:
 * - Allow split for any combo of K/Q/J (face cards), e.g. K+Q, Q+J, K+J
 * - Allow split for exact same rank for everything else, e.g. 10+10, 9+9, A+A, etc.
 * ❌ Not allowed: K+10, Q+10, J+10
 */
function canSplitCards(cards) {
  if (!cards || cards.length !== 2) return false;

  const [a, b] = cards;
  if (!a?.r || !b?.r) return false;

  const face = new Set(["K", "Q", "J"]);

  // Any combo of face cards K/Q/J
  if (face.has(a.r) && face.has(b.r)) return true;

  // Otherwise must be exact same rank (10+10, 9+9, A+A, etc)
  return a.r === b.r;
}

class BlackjackSession {
  constructor({ channel, hostId, guildId, maxPlayers = 10, defaultBet = null }) {
    this.channel = channel;
    this.guildId = guildId;
    this.hostId = hostId;

    this.state = "lobby"; // lobby | playing | ended
    // userId -> { user, bet, paid, hands: [{cards,status,bet,doubled}], activeHand }
    this.players = new Map();

    this.turnOrder = [];
    this.turnIndex = 0;

    this.dealerHand = [];
    this.deck = makeDeck();

    this.message = null;
    this.resultsMessage = null;

    this.gameId = `${Date.now()}`;
    this.timeout = null;

    this.maxPlayers = maxPlayers;
    this.defaultBet = defaultBet;

    this.endHandled = false;
  }

  isHost(userId) {
    return userId === this.hostId;
  }

  currentPlayerId() {
    return this.turnOrder[this.turnIndex] ?? null;
  }

  getPlayer(userId) {
    return this.players.get(userId) || null;
  }

  // Compatibility helper: returns current active hand object
  getActiveHand(userId) {
    const p = this.players.get(userId);
    if (!p) return null;
    return p.hands?.[p.activeHand] ?? null;
  }

  // Used by blackjack.js to know how much to charge for split/double
  getCurrentHandBet(userId) {
    const h = this.getActiveHand(userId);
    return Number(h?.bet || 0);
  }

  addPlayer(user) {
    if (this.state !== "lobby") return { ok: false, msg: "Game already started." };
    if (this.players.has(user.id)) return { ok: false, msg: "You’re already in." };
    if (this.players.size >= this.maxPlayers) return { ok: false, msg: `Game is full (${this.maxPlayers} players).` };

    this.players.set(user.id, {
      user,
      bet: null,
      paid: false,
      hands: [],        // not dealt yet
      activeHand: 0,
      status: "Waiting" // lobby display only
    });

    return { ok: true };
  }

  removePlayer(userId) {
    if (!this.players.has(userId)) return { ok: false, msg: "You’re not in the game." };
    if (this.state !== "lobby") return { ok: false, msg: "Can’t leave after start." };
    this.players.delete(userId);
    return { ok: true };
  }

  setBet(userId, amount) {
    const p = this.players.get(userId);
    if (!p) return { ok: false, msg: "You’re not in the game." };
    if (this.state !== "lobby") return { ok: false, msg: "Bets are locked after start." };

    p.bet = amount;
    return { ok: true };
  }

  allPlayersPaid() {
    if (this.players.size < 1) return false;
    for (const p of this.players.values()) {
      if (!p.bet || !p.paid) return false;
    }
    return true;
  }

  draw() {
    if (this.deck.length === 0) this.deck = makeDeck();
    return this.deck.pop();
  }

  dealInitial() {
    this.dealerHand = [this.draw(), this.draw()];

    for (const p of this.players.values()) {
      const cards = [this.draw(), this.draw()];

      p.hands = [{
        cards,
        status: isBlackjack(cards) ? "Blackjack" : "Playing",
        bet: Number(p.bet || 0),
        doubled: false,
      }];

      p.activeHand = 0;

      // overall status used mostly for display
      p.status = isBlackjack(cards) ? "Blackjack" : "Playing";
    }

    this.turnOrder = [...this.players.keys()].filter((id) => {
      const pl = this.players.get(id);
      return pl && this.playerHasPlayableHand(pl);
    });

    this.turnIndex = 0;
  }

  playerHasPlayableHand(p) {
    if (!p?.hands?.length) return false;
    return p.hands.some((h) => h.status === "Playing");
  }

  armTurnTimeout() {
    if (this.timeout) clearTimeout(this.timeout);

    this.timeout = setTimeout(async () => {
      const pid = this.currentPlayerId();
      if (!pid) return;

      const p = this.players.get(pid);
      if (!p) return;

      // auto-stand current active hand (if still playing)
      const h = p.hands[p.activeHand];
      if (h && h.status === "Playing") h.status = "Stood";

      await this.advanceTurn();
    }, 60_000);
  }

  async start() {
    if (this.state !== "lobby") return;
    if (this.players.size < 1) return;

    this.state = "playing";
    this.dealInitial();

    if (this.turnOrder.length === 0) {
      await this.finishGame();
      return;
    }

    await this.updatePanel();
    this.armTurnTimeout();
  }

  // Move to next playable hand for same player if split; otherwise next player
  normalizeAfterAction(p) {
    // If current hand finished, try next hand for this player
    while (p.activeHand < p.hands.length) {
      const h = p.hands[p.activeHand];
      if (h.status === "Playing") return; // still active
      p.activeHand += 1;
    }

    // no more hands to play
    // keep p.status readable
    if (p.hands.every((h) => h.status === "Busted")) p.status = "Busted";
    else if (p.hands.some((h) => h.status === "Blackjack")) p.status = "Blackjack";
    else p.status = "Done";
  }

  async advanceTurn() {
    if (this.timeout) clearTimeout(this.timeout);

    while (this.turnIndex < this.turnOrder.length) {
      const pid = this.turnOrder[this.turnIndex];
      const p = this.players.get(pid);

      if (!p) {
        this.turnIndex++;
        continue;
      }

      // If this player has another playable hand, keep turnIndex
      if (this.playerHasPlayableHand(p)) {
        // ensure activeHand points at a playable hand
        if (p.hands[p.activeHand]?.status !== "Playing") {
          const idx = p.hands.findIndex((h) => h.status === "Playing");
          p.activeHand = idx >= 0 ? idx : p.activeHand;
        }
        break;
      }

      this.turnIndex++;
    }

    if (this.turnIndex >= this.turnOrder.length) {
      await this.finishGame();
      return;
    }

    await this.updatePanel();
    this.armTurnTimeout();
  }

  async hit(userId) {
    if (this.state !== "playing") return { ok: false, msg: "Game not active." };
    if (userId !== this.currentPlayerId()) return { ok: false, msg: "Not your turn." };

    const p = this.players.get(userId);
    const h = this.getActiveHand(userId);
    if (!p || !h || h.status !== "Playing") return { ok: false, msg: "You can’t hit right now." };

    h.cards.push(this.draw());
    const v = handValue(h.cards);

    if (v > 21) h.status = "Busted";
    else if (v === 21) h.status = "Stood";

    this.normalizeAfterAction(p);
    await this.advanceTurn();
    return { ok: true, player: p, hand: h };
  }

  async stand(userId) {
    if (this.state !== "playing") return { ok: false, msg: "Game not active." };
    if (userId !== this.currentPlayerId()) return { ok: false, msg: "Not your turn." };

    const p = this.players.get(userId);
    const h = this.getActiveHand(userId);
    if (!p || !h || h.status !== "Playing") return { ok: false, msg: "You can’t stand right now." };

    h.status = "Stood";
    this.normalizeAfterAction(p);
    await this.advanceTurn();
    return { ok: true, player: p, hand: h };
  }

  canDoubleDown(userId) {
    const p = this.players.get(userId);
    const h = this.getActiveHand(userId);
    if (!p || !h) return false;
    if (userId !== this.currentPlayerId()) return false;
    if (h.status !== "Playing") return false;
    if (h.doubled) return false;
    if (h.cards.length !== 2) return false;
    return true;
  }

  async doubleDown(userId) {
    if (this.state !== "playing") return { ok: false, msg: "Game not active." };
    if (!this.canDoubleDown(userId)) return { ok: false, msg: "Double Down not allowed right now." };

    const p = this.players.get(userId);
    const h = this.getActiveHand(userId);

    // bet doubling is handled here; blackjack.js charges the extra stake+fee before calling this
    h.bet = Number(h.bet || 0) * 2;
    h.doubled = true;

    // exactly one card, then auto-stand (or bust)
    h.cards.push(this.draw());
    const v = handValue(h.cards);
    if (v > 21) h.status = "Busted";
    else h.status = "Stood";

    this.normalizeAfterAction(p);
    await this.advanceTurn();
    return { ok: true, player: p, hand: h };
  }

  canSplit(userId) {
    const p = this.players.get(userId);
    const h = this.getActiveHand(userId);
    if (!p || !h) return false;
    if (userId !== this.currentPlayerId()) return false;
    if (this.state !== "playing") return false;
    if (p.hands.length !== 1) return false; // one split only (simple + safe)
    if (h.status !== "Playing") return false;
    if (!canSplitCards(h.cards)) return false;
    return true;
  }

  async split(userId) {
    if (!this.canSplit(userId)) return { ok: false, msg: "Split not allowed right now." };

    const p = this.players.get(userId);
    const h = this.getActiveHand(userId);

    const baseBet = Number(h.bet || 0);
    const [c1, c2] = h.cards;

    // blackjack.js charges extra stake+fee before calling this
    const hand1 = {
      cards: [c1, this.draw()],
      status: "Playing",
      bet: baseBet,
      doubled: false,
    };

    const hand2 = {
      cards: [c2, this.draw()],
      status: "Playing",
      bet: baseBet,
      doubled: false,
    };

    // if either becomes blackjack immediately, mark it
    if (isBlackjack(hand1.cards)) hand1.status = "Blackjack";
    if (isBlackjack(hand2.cards)) hand2.status = "Blackjack";

    p.hands = [hand1, hand2];
    p.activeHand = 0;
    p.status = "Playing";

    // if hand1 auto-blackjack, move to hand2 if playable
    this.normalizeAfterAction(p);

    await this.updatePanel();
    this.armTurnTimeout();
    return { ok: true, player: p };
  }

  async finishGame() {
    let dv = handValue(this.dealerHand);
    while (dv < 17) {
      this.dealerHand.push(this.draw());
      dv = handValue(this.dealerHand);
    }

    this.state = "ended";
    await this.updatePanel(true);
  }

  buildOutcomeData() {
    const dv = handValue(this.dealerHand);
    const dealerBJ = (dv === 21 && this.dealerHand.length === 2);

    const outcomes = [];

    for (const [userId, p] of this.players.entries()) {
      const user = p.user;

      // per-hand outcomes (split supported)
      const hands = p.hands?.length
        ? p.hands
        : [{ cards: [], status: "Waiting", bet: p.bet || 0, doubled: false }];

      hands.forEach((h, idx) => {
        const pv = handValue(h.cards);
        const playerBJ = (pv === 21 && h.cards.length === 2);

        let result = "lose";

        if (h.status === "Busted") result = "lose";
        else if (dealerBJ && playerBJ) result = "push";
        else if (dealerBJ) result = "lose";
        else if (playerBJ) result = "blackjack_win";
        else if (dv > 21) result = "win";
        else if (pv > dv) result = "win";
        else if (pv < dv) result = "lose";
        else result = "push";

        outcomes.push({
          userId,
          user,
          handIndex: idx,
          handLabel: hands.length > 1 ? `Hand ${idx + 1}` : null,
          bet: Number(h.bet || 0),
          playerValue: pv,
          playerHand: h.cards.slice(),
          status: h.status,
          result,
        });
      });
    }

    return {
      dealerValue: dv,
      dealerHand: this.dealerHand.slice(),
      outcomes,
    };
  }

  lobbyComponents() {
    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`bj:${this.gameId}:join`).setLabel("Join").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`bj:${this.gameId}:leave`).setLabel("Leave").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`bj:${this.gameId}:setbet`).setLabel("Set Bet").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`bj:${this.gameId}:quickbet`).setLabel("Quick Bet").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`bj:${this.gameId}:clearbet`).setLabel("Clear Bet").setStyle(ButtonStyle.Danger),
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`bj:${this.gameId}:start`).setLabel("Start").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`bj:${this.gameId}:end`).setLabel("End").setStyle(ButtonStyle.Danger),
    );

    return [row1, row2];
  }
playComponents() {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`bj:${this.gameId}:hit`).setLabel("Hit").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`bj:${this.gameId}:stand`).setLabel("Stand").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`bj:${this.gameId}:double`).setLabel("Double").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`bj:${this.gameId}:split`).setLabel("Split").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`bj:${this.gameId}:end`).setLabel("End").setStyle(ButtonStyle.Danger),
      ),
    ];
  }

  panelEmbed(revealDealer = false) {
    let dealerShown;
    if (this.dealerHand.length === 0) dealerShown = "_Not dealt yet_";
    else if (revealDealer) dealerShown = `${this.dealerHand.map(cardStr).join(" ")} (**${handValue(this.dealerHand)}**)`;
    else dealerShown = `${cardStr(this.dealerHand[0])}  ?`;

    const lines = [...this.players.values()].map((p) => {
      const betText = p.bet && p.paid
        ? `$${Number(p.bet).toLocaleString()} ✅`
        : p.bet
          ? `Pending…`
          : "No bet";

      const hands = p.hands?.length
        ? p.hands
        : [{ cards: [], status: p.status || "Waiting", bet: p.bet || 0, doubled: false }];

      const handLines = hands.map((h, idx) => {
        const cards = h.cards.length ? h.cards.map(cardStr).join(" ") : "_Not dealt_";
        const total = h.cards.length ? ` (**${handValue(h.cards)}**)` : "";
        const label = hands.length > 1 ? `Hand ${idx + 1}` : "Hand";
        const activeMark =
          (this.state === "playing" && this.currentPlayerId() === p.user.id && p.activeHand === idx && h.status === "Playing")
            ? " 👉"
            : "";
        const doubledMark = h.doubled ? " (DOUBLED)" : "";
        return `• ${label}: ${cards}${total} — **${h.status}**${doubledMark}${activeMark}`;
      });

      return `${p.user} — Bet: **${betText}**\n${handLines.join("\n")}`;
    });

    const joinNote = this.defaultBet
      ? `Join auto-buy-in: **$${Number(this.defaultBet).toLocaleString()}** (override with **/blackjack bet:<amount>**).`
      : `Place your buy-in using **Set Bet** (modal) or **Quick Bet**. Minimum **$500**.`;

    const turnId = this.currentPlayerId();
    const turnLine =
      this.state === "playing" && turnId ? `👉 Turn: <@${turnId}>`
      : this.state === "lobby" ? joinNote
      : "Game finished.";

    return new EmbedBuilder()
      .setTitle("🃏 Blackjack")
      .setDescription(
        `**Dealer:** ${dealerShown}\n\n` +
        `**Players (${this.players.size}/${this.maxPlayers}):**\n${lines.join("\n\n") || "_None yet_"}\n\n` +
        `${turnLine}`
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

  async updatePanel(revealDealer = false) {
    if (!this.message) return;

    let embeds;
    let components;

    if (this.state === "lobby") {
      embeds = [this.panelEmbed(false)];
      components = this.lobbyComponents();
    } else if (this.state === "playing") {
      embeds = [this.panelEmbed(false)];
      components = this.playComponents();
    } else {
      embeds = [this.panelEmbed(true)];
      components = [];
    }

    await this.message.edit({ embeds, components });
  }
}

module.exports = {
  BlackjackSession,
  handValue,
  cardStr,
};

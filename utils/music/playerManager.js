const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState,
} = require("@discordjs/voice");

const playdl = require("play-dl");
const { buildPanelMessagePayload } = require("./panelView");

const guildPlayers = new Map();

function getOrCreateGuildPlayer(guildId) {
  if (guildPlayers.has(guildId)) return guildPlayers.get(guildId);

  const state = {
    guildId,
    connection: null,
    player: createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    }),
    queue: [],
    now: null,
    loopMode: "off", // off | track | queue
    panel: {
      channelId: null,
      messageId: null,
    },
    isStarting: false,
  };

  state.player.on(AudioPlayerStatus.Idle, async () => {
    if (state.loopMode === "track" && state.now) {
      state.queue.unshift(state.now);
    } else if (state.loopMode === "queue" && state.now) {
      state.queue.push(state.now);
    }

    state.now = null;
    await tryStartNext(state);
  });

  state.player.on("error", async (err) => {
    console.error("[music] audio player error:", err);
    state.now = null;
    await tryStartNext(state);
  });

  const api = {
    state,

    async connect(voiceChannel) {
      // Reuse existing connection if already in guild
      const existing = getVoiceConnection(voiceChannel.guild.id);
      if (existing) state.connection = existing;

      if (!state.connection) {
        state.connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: voiceChannel.guild.id,
          adapterCreator: voiceChannel.guild.voiceAdapterCreator,
          selfDeaf: true,
        });

        state.connection.subscribe(state.player);

        // Wait until ready (prevents flaky first play)
        try {
          await entersState(state.connection, VoiceConnectionStatus.Ready, 15_000);
        } catch (e) {
          console.error("[music] voice connection not ready:", e);
        }

        state.connection.on(VoiceConnectionStatus.Disconnected, async () => {
          // If fully disconnected, clear connection ref
          state.connection = null;
        });
      }
    },

    async enqueue(query, user) {
      const items = await resolveToTracks(query, user);

      if (!items.length) {
        throw new Error("No tracks found for that query.");
      }

      for (const t of items) state.queue.push(t);

      // Autostart
      await tryStartNext(state);

      return {
        count: items.length,
        title: items[0]?.title,
      };
    },

    async ensurePanel(textChannel) {
      const guild = textChannel.guild;
      state.panel.channelId = textChannel.id;

      // If we already have a message id, try edit it, else create
      const payload = buildPanelMessagePayload(state);

      if (state.panel.messageId) {
        try {
          const msg = await textChannel.messages.fetch(state.panel.messageId);
          await msg.edit(payload);
          return;
        } catch {
          // message gone, recreate
          state.panel.messageId = null;
        }
      }

      const msg = await textChannel.send(payload);
      state.panel.messageId = msg.id;
    },

    async refreshPanel(client) {
      if (!state.panel.channelId || !state.panel.messageId) return;
      const guild = client.guilds.cache.get(state.guildId);
      const channel = guild?.channels?.cache?.get(state.panel.channelId);
      if (!channel?.isTextBased?.()) return;

      try {
        const msg = await channel.messages.fetch(state.panel.messageId);
        await msg.edit(buildPanelMessagePayload(state));
      } catch {}
    },

    async pauseToggle(client) {
      if (state.player.state.status === AudioPlayerStatus.Playing) state.player.pause();
      else state.player.unpause();
      await api.refreshPanel(client);
    },

    async skip(client) {
      state.player.stop(true);
      await api.refreshPanel(client);
    },

    async stop(client) {
      state.queue = [];
      state.now = null;
      state.player.stop(true);
      const conn = getVoiceConnection(state.guildId);
      conn?.destroy?.();
      state.connection = null;
      await api.refreshPanel(client);
    },

    async shuffle(client) {
      // Fisher–Yates
      for (let i = state.queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [state.queue[i], state.queue[j]] = [state.queue[j], state.queue[i]];
      }
      await api.refreshPanel(client);
    },

    async cycleLoop(client) {
      state.loopMode = state.loopMode === "off" ? "track" : state.loopMode === "track" ? "queue" : "off";
      await api.refreshPanel(client);
    },

    async jumpTo(index, client) {
      if (index < 0 || index >= state.queue.length) return;
      const [picked] = state.queue.splice(index, 1);
      state.queue.unshift(picked);
      state.player.stop(true);
      await api.refreshPanel(client);
    },
  };

  guildPlayers.set(guildId, api);
  return api;
}

async function tryStartNext(state) {
  if (state.isStarting) return;
  if (state.player.state.status !== AudioPlayerStatus.Idle) return;
  if (!state.queue.length) return;

  state.isStarting = true;
  try {
    const next = state.queue.shift();
    state.now = next;

    const stream = await playdl.stream(next.url, { quality: 2 });

    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
      inlineVolume: true,
    });

    // (optional) set default volume
    if (resource.volume) resource.volume.setVolume(0.5);

    state.player.play(resource);
  } catch (e) {
    console.error("[music] failed to start next:", e);
    state.now = null;
  } finally {
    state.isStarting = false;
  }
}

async function resolveToTracks(query, user) {
  // Ensure play-dl has spotify creds from env already
  // Supported: Spotify URLs, YouTube URLs, search text
  const tracks = [];

  const type = await playdl.validate(query).catch(() => false);

  // Spotify link → turn into track search queries
  if (type === "sp_track" || type === "sp_album" || type === "sp_playlist") {
    const sp = await playdl.spotify(query);
    const list = type === "sp_track" ? [sp] : await sp.all_tracks();

    for (const t of list) {
      const title = `${t.name} - ${t.artists?.[0]?.name || ""}`.trim();
      const yt = await playdl.search(title, { limit: 1 }).then(r => r?.[0]).catch(() => null);
      if (yt?.url) {
        tracks.push({
          title: yt.title || title,
          url: yt.url,
          requestedBy: user,
          source: "spotify",
        });
      }
    }

    return tracks;
  }

  // YouTube / SoundCloud / etc direct
  if (type) {
    // For youtube video/playlist URLs, play-dl can still stream the url directly.
    // If it's a playlist, we’ll try to expand; otherwise just add the one url.
    if (type === "yt_playlist") {
      const pl = await playdl.playlist_info(query);
      const vids = await pl.all_videos();
      for (const v of vids) {
        tracks.push({
          title: v.title,
          url: v.url,
          requestedBy: user,
          source: "youtube",
        });
      }
      return tracks;
    }

    // single url
    const info = await playdl.video_basic_info(query).catch(() => null);
    tracks.push({
      title: info?.video_details?.title || "Track",
      url: query,
      requestedBy: user,
      source: "url",
    });
    return tracks;
  }

  // Search text
  const results = await playdl.search(query, { limit: 1 }).catch(() => []);
  const pick = results?.[0];
  if (pick?.url) {
    tracks.push({
      title: pick.title || query,
      url: pick.url,
      requestedBy: user,
      source: "search",
    });
  }

  return tracks;
}

module.exports = { getOrCreateGuildPlayer };

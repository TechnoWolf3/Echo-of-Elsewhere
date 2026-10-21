package place.echo.meridian;

import com.cobblemon.mod.common.api.Priority;
import com.cobblemon.mod.common.api.events.CobblemonEvents;
import com.cobblemon.mod.common.pokemon.Pokemon;
import com.google.gson.*;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.logging.LogUtils;
import kotlin.Unit;
import net.minecraft.ChatFormatting;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.event.lifecycle.FMLCommonSetupEvent;
import net.neoforged.fml.loading.FMLPaths;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.neoforged.neoforge.event.ServerChatEvent;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;
import org.slf4j.Logger;

import java.io.*;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;

@Mod("meridian_bridge")
public final class MeridianBridge {
    private static final Logger LOG = LogUtils.getLogger();
    private static final Gson JSON = new Gson();
    private final LinkedBlockingDeque<Pending> outgoing = new LinkedBlockingDeque<>(200);
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private volatile MinecraftServer server;
    private ScheduledExecutorService worker;
    private String baseUrl = "";
    private String token = "";
    private boolean enabled;
    private volatile boolean stopping;
    private long cursor;
    private long heartbeatAt;
    private long warningAt;
    private final Set<UUID> spawnedLegendaries = new LinkedHashSet<>();
    private final LinkedBlockingQueue<Runnable> spawnChecks = new LinkedBlockingQueue<>(200);
    private record Pending(JsonObject body, long createdAt) {}

    public MeridianBridge(IEventBus modBus) {
        modBus.addListener(this::setup);
        NeoForge.EVENT_BUS.addListener(this::started);
        NeoForge.EVENT_BUS.addListener(this::stopped);
        NeoForge.EVENT_BUS.addListener(this::chat);
        NeoForge.EVENT_BUS.addListener(this::joined);
        NeoForge.EVENT_BUS.addListener(this::left);
        NeoForge.EVENT_BUS.addListener(this::commands);
        NeoForge.EVENT_BUS.addListener(this::afterTick);
    }

    private void setup(FMLCommonSetupEvent event) {
        event.enqueueWork(() -> {
            CobblemonEvents.POKEMON_CAPTURED.subscribe(Priority.LOWEST, capture -> {
                Pokemon pokemon = capture.getPokemon();
                if (pokemon.isLegendary() || pokemon.getShiny()) {
                    JsonObject body = pokemonEvent(pokemon.isLegendary() ? "legendary_capture" : "shiny_capture", pokemon);
                    body.addProperty("player", capture.getPlayer().getGameProfile().getName());
                    enqueue(body);
                }
                return Unit.INSTANCE;
            });
            CobblemonEvents.POKEMON_ENTITY_SPAWN.subscribe(Priority.LOWEST, spawn -> {
                // Defer until after spawning: ignore cancelled spawns and player-owned Pokémon.
                var entity = spawn.getEntity();
                MinecraftServer current = server;
                if (current != null && enabled && entity.getPokemon().isLegendary()) spawnChecks.offer(() -> {
                    if (spawn.isCanceled() || entity.isRemoved() || !entity.isAddedToLevel() || entity.getPokemon().getOwnerUUID() != null) return;
                    UUID id = entity.getPokemon().getUuid();
                    if (!spawnedLegendaries.add(id)) return;
                    while (spawnedLegendaries.size() > 2000) spawnedLegendaries.remove(spawnedLegendaries.iterator().next());
                    enqueue(pokemonEvent("legendary_spawn", entity.getPokemon()));
                });
                return Unit.INSTANCE;
            });
        });
    }

    private void afterTick(ServerTickEvent.Post event) {
        Runnable check;
        while ((check = spawnChecks.poll()) != null) check.run();
    }

    private void readConfig() {
        Path path = FMLPaths.CONFIGDIR.get().resolve("meridian-echo.properties");
        Properties props = new Properties();
        try {
            if (!Files.exists(path)) {
                props.setProperty("enabled", "false");
                props.setProperty("echo-url", "https://YOUR-ECHO-SERVICE.up.railway.app");
                props.setProperty("bridge-token", "SET_A_SEPARATE_RANDOM_SECRET_AT_LEAST_32_CHARACTERS");
                try (Writer writer = Files.newBufferedWriter(path, StandardCharsets.UTF_8)) {
                    props.store(writer, "Meridian -> Echo. Use a dedicated bridge secret, never the Discord bot token.");
                }
            }
            try (Reader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) { props.load(reader); }
            enabled = Boolean.parseBoolean(props.getProperty("enabled", "false"));
            baseUrl = props.getProperty("echo-url", "").trim().replaceAll("/+$", "");
            token = props.getProperty("bridge-token", "").trim();
            if (enabled) {
                URI uri = URI.create(baseUrl);
                if (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null || !uri.getPath().isEmpty()) throw new IllegalArgumentException("echo-url must be an HTTPS origin without a path");
                if (token.length() < 32 || token.contains("SET_A_SEPARATE")) throw new IllegalArgumentException("Set a random bridge-token of at least 32 characters");
            }
        } catch (Exception error) {
            enabled = false;
            LOG.error("[Meridian] Bridge disabled: check meridian-echo.properties ({})", error.getClass().getSimpleName());
        }
    }

    private void started(ServerStartedEvent event) {
        server = event.getServer();
        readConfig();
        if (!enabled) { LOG.info("[Meridian] Bridge disabled; configure config/meridian-echo.properties then restart."); return; }
        stopping = false;
        cursor = 0;
        heartbeatAt = 0;
        enqueue(basic("server_start"));
        worker = Executors.newSingleThreadScheduledExecutor(runnable -> {
            Thread thread = new Thread(runnable, "meridian-echo-bridge"); thread.setDaemon(true); return thread;
        });
        worker.scheduleWithFixedDelay(this::tick, 0, 3, TimeUnit.SECONDS);
        LOG.info("[Meridian] Bridge worker started.");
    }

    private void stopped(ServerStoppingEvent event) {
        if (worker != null) {
            stopping = true;
            // Queue a best-effort shutdown notice ahead of ordinary chat.
            Pending notice = new Pending(basic("server_stop"), System.currentTimeMillis());
            if (!outgoing.offerFirst(notice)) { outgoing.pollLast(); outgoing.offerFirst(notice); }
            worker.execute(() -> { try { drain(1); } catch (Exception ignored) { } });
            worker.shutdown();
            try { if (!worker.awaitTermination(12, TimeUnit.SECONDS)) worker.shutdownNow(); }
            catch (InterruptedException interrupted) { worker.shutdownNow(); Thread.currentThread().interrupt(); }
            worker = null;
        }
        server = null;
        outgoing.clear();
        spawnedLegendaries.clear();
        spawnChecks.clear();
    }

    private void chat(ServerChatEvent event) {
        if (event.isCanceled()) return;
        JsonObject body = basic("chat");
        body.addProperty("player", event.getPlayer().getGameProfile().getName());
        body.addProperty("message", limit(event.getMessage().getString(), 500));
        enqueue(body);
    }

    private void joined(PlayerEvent.PlayerLoggedInEvent event) { playerEvent("player_join", event); }
    private void left(PlayerEvent.PlayerLoggedOutEvent event) { playerEvent("player_leave", event); }
    private void playerEvent(String type, PlayerEvent event) {
        JsonObject body = basic(type);
        body.addProperty("player", event.getEntity().getGameProfile().getName());
        enqueue(body);
    }

    private void commands(RegisterCommandsEvent event) {
        event.getDispatcher().register(Commands.literal("meridianrestart")
            .requires(source -> source.hasPermission(2))
            .then(Commands.argument("minutes", IntegerArgumentType.integer(1, 120)).executes(context -> {
                if (!enabled) { context.getSource().sendFailure(Component.literal("Echo bridge is disabled.")); return 0; }
                int minutes = IntegerArgumentType.getInteger(context, "minutes");
                String text = "Server restart in " + minutes + " minute" + (minutes == 1 ? "." : "s.");
                JsonObject body = basic("restart_notice"); body.addProperty("message", text); enqueue(body);
                context.getSource().getServer().getPlayerList().broadcastSystemMessage(Component.literal("[Meridian] " + text).withStyle(ChatFormatting.GOLD), false);
                context.getSource().sendSuccess(() -> Component.literal("Notice sent. This command does not schedule or perform a restart."), false);
                return 1;
            })));
    }

    private static String limit(String text, int length) { return text.length() <= length ? text : text.substring(0, length); }
    private JsonObject basic(String type) {
        JsonObject body = new JsonObject(); body.addProperty("id", UUID.randomUUID().toString()); body.addProperty("type", type); return body;
    }
    private JsonObject pokemonEvent(String type, Pokemon pokemon) {
        JsonObject body = basic(type);
        body.addProperty("pokemon", pokemon.getSpecies().getName());
        body.addProperty("shiny", pokemon.getShiny());
        return body;
    }
    private void enqueue(JsonObject body) {
        if (!enabled || stopping) return;
        if (!outgoing.offerLast(new Pending(body, System.currentTimeMillis()))) LOG.warn("[Meridian] Outgoing queue full; dropping an event.");
    }

    private JsonObject request(String endpoint, JsonObject body) throws IOException, InterruptedException {
        var builder = HttpRequest.newBuilder(URI.create(baseUrl + endpoint))
            .timeout(Duration.ofSeconds(5)).header("Authorization", "Bearer " + token).header("Accept", "application/json");
        if (body == null) builder.GET();
        else builder.header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(JSON.toJson(body)));
        var response = http.send(builder.build(), HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) throw new IOException("Echo returned HTTP " + response.statusCode());
        if (response.body().length() > 65536) throw new IOException("Echo response too large");
        return JsonParser.parseString(response.body()).getAsJsonObject();
    }

    private void drain(int count) throws IOException, InterruptedException {
        for (int i = 0; i < count; i++) {
            Pending pending = outgoing.peekFirst();
            if (pending == null) return;
            if (System.currentTimeMillis() - pending.createdAt() > 300000) { outgoing.remove(pending); continue; }
            request("/v1/meridian/events", pending.body());
            outgoing.remove(pending);
        }
    }

    private void tick() {
        if (stopping) return;
        try {
            if (System.currentTimeMillis() - heartbeatAt > 15000) {
                request("/v1/meridian/heartbeat", new JsonObject()); heartbeatAt = System.currentTimeMillis();
            }
            drain(5);
            if (stopping) return;
            JsonArray messages = request("/v1/meridian/messages?after=" + cursor, null).getAsJsonArray("messages");
            for (JsonElement element : messages) {
                JsonObject message = element.getAsJsonObject();
                long id = message.get("id").getAsLong();
                String author = limit(message.get("author").getAsString(), 40);
                String text = limit(message.get("text").getAsString(), 500);
                MinecraftServer current = server;
                if (current == null || stopping) break;
                // Literal components only. Discord messages never execute Minecraft commands.
                current.execute(() -> current.getPlayerList().broadcastSystemMessage(
                    Component.literal("[Discord] ").withStyle(ChatFormatting.AQUA)
                        .append(Component.literal(author + " » ").withStyle(ChatFormatting.WHITE))
                        .append(Component.literal(text).withStyle(ChatFormatting.GRAY)), false));
                cursor = Math.max(cursor, id);
            }
        } catch (Exception error) {
            if (error instanceof InterruptedException) Thread.currentThread().interrupt();
            if (System.currentTimeMillis() - warningAt > 60000) {
                LOG.warn("[Meridian] Echo connection failed; retrying. {}", error.getMessage()); warningAt = System.currentTimeMillis();
            }
        }
    }
}

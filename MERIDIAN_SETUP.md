# Meridian and Echo

## What is included

- Live Feed (`1562601698315206726`): two-way plain-text chat, joins and leaves.
- Meridian Events (`1562601993556594729`): online/stopped notices, connection loss/recovery, shiny catches, legendary catches and natural legendary spawns.
- Optional `/meridianrestart <minutes>` in Minecraft (operator required), or `meridianrestart <minutes>` in the Bisect console. This only posts a notice to Minecraft and Discord. Schedule the actual restart separately in Bisect.
- Pokémon that are both shiny and legendary produce one catch announcement. Ordinary catches are not announced. Legendary status follows Cobblemon's classification; mythical and Ultra Beast announcements are not separately implemented.
- Spawn notices do not reveal coordinates. Spawns cancelled by other mods are ignored.

## Railway (Echo)

1. Review the local changes to `api/server.js`, `utils/meridianBridge.js`, `utils/meridianBridge.test.js` and `MAINTAINER_NOTES.md`.
2. Set a new Railway service variable called `MERIDIAN_BRIDGE_TOKEN` to a random secret of at least 32 characters. Generate it locally; do not post it in chat or GitHub. Do not reuse Echo's Discord token.
3. Echo's existing API must remain enabled (`ECHO_API_DISABLED` must not be `true`). It runs through `npm start` in the same process as the bot. API-only `npm run start:api` does not attach the Discord client and cannot relay messages.
4. In the Echo service: Settings -> Networking -> Public Networking -> Generate Domain (or use the existing HTTPS domain). Use the service's actual listening port, normally Railway's `PORT` value; the source fallback is 3000.
5. Review, commit and push to the branch Railway deploys. These changes have not been pushed or deployed automatically.
6. Echo must have View Channel and Send Messages in both chosen Discord channels. The existing source already requests Message Content intent; ensure it is also enabled for Echo in Discord's Developer Portal.

## Bisect (Minecraft)

1. Create a server backup and stop Meridian.
2. Upload `meridian-echo-bridge-0.1.0.jar` to the server `mods` folder. It is a server-only mod for Minecraft 1.21.1, NeoForge 21.1 and Cobblemon 1.7.3. Players do not need to install it.
3. Start the server once to create `config/meridian-echo.properties`, then stop it.
4. Edit that file:

```properties
enabled=true
echo-url=https://echo-of-elsewhere-production.up.railway.app
bridge-token=THE_SAME_SECRET_YOU_SET_IN_RAILWAY
```

5. Start Meridian. There should be an online notice in Meridian Events. Check the Bisect console for `[Meridian]` logs.

## Live checks still required

- Send a Minecraft chat message; it should appear once in Live Feed through Echo.
- Send a human text message in Live Feed; it should appear once in Minecraft within a few seconds. Messages starting with `/` remain chat text and do not execute commands.
- Join and leave; confirm Live Feed notices.
- Use `meridianrestart 5` in the console; confirm notices in Minecraft and Meridian Events. This does not restart the server.
- During a controlled test, capture a shiny and a legendary, and verify a natural legendary spawn. Summoned Pokémon or captures can differ by addon; actual pack testing is required.
- Stop the server; confirm the stop message, or a connection-loss notice after about 90 seconds if an abrupt stop prevents delivery.
- Restart Echo and Meridian, then repeat chat in both directions.

## Delivery limits

This is a small private-server bridge, not a durable event archive. Discord chat is kept in memory for up to two minutes, with a 200-message cap, and is ignored while the bridge is offline. Outgoing Minecraft events retry for up to five minutes, with a 200-event cap. Restarting either process can discard pending messages. Event IDs suppress duplicate retries within the running Echo process; a crash during delivery can still duplicate an event. Attachments, edits/deletes, account linking, remote commands, and automatic Bisect restart scheduling are not implemented.

## Rollback

Set `enabled=false` in the Minecraft bridge config and restart Meridian. Remove `MERIDIAN_BRIDGE_TOKEN` from Railway to disable the Echo feature. Existing Echo features are independent of the bridge. To remove it completely, stop Minecraft and remove only the Meridian bridge JAR; remove the bridge require/handler/start lines from Echo's API and its two utility files.

# Meridian Echo Bridge (server only)

Target: Java 21, Minecraft 1.21.1, NeoForge 21.1, Cobblemon 1.7.3.

This addon sends JSON events to the existing Echo HTTP service and polls for Discord messages. It does not run a Discord bot or use a Discord bot token. All network requests run on a background worker; received messages are displayed using literal Minecraft chat components on the server thread.

## Build

1. Install JDK 21.
2. Download the official **NeoForge** Cobblemon 1.7.3 file from https://modrinth.com/mod/cobblemon/version/S1TrAn8c .
3. Put it in this project's `libs` directory and rename the file to `cobblemon.jar`. Do not commit that dependency.
4. Run `gradlew.bat build` on Windows. The result is `build/libs/meridian-echo-bridge-0.1.0.jar`.

The Gradle wrapper comes from the official NeoForge 1.21.1 ModDevGradle template. Do not disable certificate validation if downloads fail; use your operating system's trusted certificate store as appropriate for your environment.

## Installation

Follow `MERIDIAN_SETUP.md` in the Echo project or the packaged instructions. Upload the resulting JAR to the Bisect server only, start once to generate `config/meridian-echo.properties`, then configure the HTTPS Echo origin and a dedicated secret shared with Railway's `MERIDIAN_BRIDGE_TOKEN`. The bridge starts disabled.

## Verification so far

- Compiled against NeoForge 21.1.219 and the official Cobblemon 1.7.3 NeoForge JAR using Java 21.
- The actual Cobblemon JAR's capture, spawn and Pokémon API signatures were checked before compilation.
- The Echo component has isolated tests for authentication, channel routing, mention suppression, duplicate retries, loop prevention, expiry, connection notices, input validation, and delivery retry.
- No live Minecraft, Discord or Railway end-to-end test has been performed. Test with a backed-up server before relying on it.

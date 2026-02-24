const fs = require("fs");
const path = require("path");

function loadEvents() {
  const dir = path.join(__dirname, "events");
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter(f => f.endsWith(".js"));

  const events = [];
  for (const file of files) {
    const p = path.join(dir, file);
    try {
      delete require.cache[require.resolve(p)];
      const mod = require(p);

      if (!mod?.id || typeof mod.create !== "function") {
        console.warn(`[BOTGAMES] Skipped ${file}: missing id or create()`);
        continue;
      }
      // Optional: weight, name, render/onAction or run
      events.push(mod);
    } catch (e) {
      console.warn(`[BOTGAMES] Failed loading ${file}: ${e?.message || e}`);
    }
  }
  return events;
}

module.exports = { loadEvents };

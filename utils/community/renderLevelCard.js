const { Resvg } = require("@resvg/resvg-js");
const { buildLevelCardSvg, CARD_WIDTH, CARD_HEIGHT } = require("./levelCardSvg");

const AVATAR_TIMEOUT_MS = 6000;

function mimeFromContentType(contentType) {
  const type = String(contentType || "").toLowerCase();
  if (type.includes("image/jpeg") || type.includes("image/jpg")) return "image/jpeg";
  if (type.includes("image/webp")) return "image/webp";
  return "image/png";
}

async function fetchAvatarDataUri(avatarUrl) {
  if (!avatarUrl || typeof fetch !== "function") return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AVATAR_TIMEOUT_MS);

  try {
    const response = await fetch(avatarUrl, { signal: controller.signal });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type");
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (!buffer.length) return null;
    return `data:${mimeFromContentType(contentType)};base64,${buffer.toString("base64")}`;
  } catch (error) {
    console.warn("[community] avatar fetch failed for level card:", error?.message || error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function toLevelCardData(profile, avatarDataUri = null) {
  const progress = profile.progress || {};
  return {
    displayName: profile.displayName,
    avatarDataUri,
    level: progress.level || 1,
    rank: profile.rank || null,
    title: progress.title || "New Voice",
    currentXp: progress.currentLevelXp || 0,
    neededXp: progress.xpForNextLevel || 1,
    totalXp: progress.totalXp || 0,
    progressPercent: progress.progressPercent || 0,
    progressRatio: progress.progressRatio || 0,
    messageCount: profile.messageCount || 0,
    voiceSeconds: profile.voiceSeconds || 0,
  };
}

async function renderLevelCardSvg(profile) {
  const avatarDataUri = await fetchAvatarDataUri(profile.avatarUrl);
  return buildLevelCardSvg(toLevelCardData(profile, avatarDataUri));
}

async function renderLevelCardPng(profile) {
  const svg = await renderLevelCardSvg(profile);
  const resvg = new Resvg(svg, {
    fitTo: {
      mode: "width",
      value: CARD_WIDTH,
    },
    font: {
      loadSystemFonts: true,
      defaultFontFamily: "Arial",
    },
  });

  const pngData = resvg.render();
  const pngBuffer = Buffer.from(pngData.asPng());
  if (!pngBuffer.length) {
    throw new Error("Resvg returned an empty PNG buffer.");
  }
  return pngBuffer;
}

module.exports = {
  renderLevelCardPng,
  renderLevelCardSvg,
  toLevelCardData,
  fetchAvatarDataUri,
  CARD_WIDTH,
  CARD_HEIGHT,
};

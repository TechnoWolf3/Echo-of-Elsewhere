const CARD_WIDTH = 934;
const CARD_HEIGHT = 282;
const FONT_FAMILY = "Arial, sans-serif";

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function fmtInt(value) {
  return Math.floor(Number(value) || 0).toLocaleString("en-AU");
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function escapeSvg(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function trimText(value, maxLength) {
  const text = String(value ?? "").trim();
  const safeMax = Math.max(1, Math.floor(Number(maxLength) || 1));
  if (text.length <= safeMax) return text;
  return `${text.slice(0, Math.max(0, safeMax - 1)).trimEnd()}...`;
}

function initialsFromName(displayName) {
  const parts = String(displayName || "Echo")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const initials = parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return initials || "E";
}

function textAttrs({
  fill = "#f4fbff",
  size = 16,
  weight = 700,
  anchor = null,
} = {}) {
  const anchorAttr = anchor ? ` text-anchor="${anchor}"` : "";
  return `font-family="${FONT_FAMILY}" font-size="${size}" font-weight="${weight}" fill="${fill}"${anchorAttr}`;
}

function buildStatPill({ x, y, label, value }) {
  return `
    <g>
      <rect x="${x}" y="${y}" width="154" height="48" rx="15" fill="#0e334d" fill-opacity="0.72" stroke="#55bce8" stroke-opacity="0.22" />
      <text x="${x + 16}" y="${y + 19}" ${textAttrs({ fill: "#9fc3d5", size: 12, weight: 700 })}>${escapeSvg(label)}</text>
      <text x="${x + 16}" y="${y + 38}" ${textAttrs({ fill: "#eef9ff", size: 16, weight: 800 })}>${escapeSvg(value)}</text>
    </g>`;
}

function buildLevelCardSvg(card) {
  const displayName = escapeSvg(trimText(card.displayName || "Unknown Voice", 22));
  const title = escapeSvg(trimText(card.title || "New Voice", 30));
  const level = fmtInt(card.level || 1);
  const rank = card.rank ? `#${fmtInt(card.rank)}` : "Unranked";
  const currentXp = fmtInt(card.currentXp || 0);
  const neededXp = fmtInt(card.neededXp || 1);
  const totalXp = fmtInt(card.totalXp || 0);
  const messages = fmtInt(card.messageCount || 0);
  const voiceTime = formatDuration(card.voiceSeconds || 0);
  const progressRatio = clamp01(card.progressPercent != null ? Number(card.progressPercent) / 100 : card.progressRatio);
  const progressWidth = Math.round(560 * progressRatio);
  const progressLabel = `${currentXp} / ${neededXp} XP`;
  const avatarDataUri = card.avatarDataUri ? String(card.avatarDataUri) : null;
  const initials = escapeSvg(initialsFromName(card.displayName));

  const avatar = avatarDataUri
    ? `<image x="58" y="54" width="136" height="136" href="${escapeSvg(avatarDataUri)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)" />`
    : `<circle cx="126" cy="122" r="68" fill="url(#avatarFallback)" />
       <text x="126" y="133" ${textAttrs({ fill: "#effaff", size: 42, weight: 850, anchor: "middle" })}>${initials}</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="934" y2="282" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#07131d"/>
      <stop offset="0.48" stop-color="#0b2233"/>
      <stop offset="1" stop-color="#05080f"/>
    </linearGradient>
    <radialGradient id="pulse" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(710 10) rotate(128) scale(410 250)">
      <stop offset="0" stop-color="#0875AF" stop-opacity="0.48"/>
      <stop offset="0.62" stop-color="#0875AF" stop-opacity="0.1"/>
      <stop offset="1" stop-color="#0875AF" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="barFill" x1="284" y1="218" x2="844" y2="218" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#0875AF"/>
      <stop offset="0.55" stop-color="#20B4E8"/>
      <stop offset="1" stop-color="#8BD5FF"/>
    </linearGradient>
    <linearGradient id="avatarFallback" x1="58" y1="54" x2="194" y2="190" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#0875AF"/>
      <stop offset="1" stop-color="#152F45"/>
    </linearGradient>
    <clipPath id="avatarClip">
      <circle cx="126" cy="122" r="68"/>
    </clipPath>
    <filter id="softGlow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="8" result="blur"/>
      <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0.031 0 0 0 0 0.459 0 0 0 0 0.686 0 0 0 0.58 0"/>
      <feBlend in="SourceGraphic"/>
    </filter>
  </defs>

  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="30" fill="url(#bg)"/>
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="30" fill="url(#pulse)"/>
  <path d="M-10 248 C 160 190, 240 308, 420 232 S 706 244, 952 176" fill="none" stroke="#0875AF" stroke-opacity="0.18" stroke-width="2"/>
  <path d="M-20 34 C 160 84, 278 -18, 470 44 S 736 84, 960 28" fill="none" stroke="#8BD5FF" stroke-opacity="0.09" stroke-width="2"/>

  <circle cx="126" cy="122" r="78" fill="#0875AF" opacity="0.18" filter="url(#softGlow)"/>
  <circle cx="126" cy="122" r="74" fill="none" stroke="#0875AF" stroke-width="4"/>
  <circle cx="126" cy="122" r="70" fill="#07131d" stroke="#ffffff" stroke-opacity="0.12" stroke-width="2"/>
  ${avatar}

  <text x="232" y="56" ${textAttrs({ fill: "#8bd5ff", size: 16, weight: 700 })}>Echo Resonance</text>
  <text x="232" y="104" ${textAttrs({ fill: "#f4fbff", size: 34, weight: 800 })}>${displayName}</text>
  <text x="234" y="135" ${textAttrs({ fill: "#b8d9ea", size: 21, weight: 600 })}>${title}</text>

  <g transform="translate(676 50)">
    <text x="0" y="18" ${textAttrs({ fill: "#9fc3d5", size: 12, weight: 700 })}>LEVEL</text>
    <text x="0" y="58" ${textAttrs({ fill: "#ffffff", size: 32, weight: 850 })}>${level}</text>
  </g>
  <g transform="translate(802 50)">
    <text x="0" y="18" ${textAttrs({ fill: "#9fc3d5", size: 12, weight: 700 })}>RANK</text>
    <text x="0" y="58" ${textAttrs({ fill: "#ffffff", size: 32, weight: 850 })}>${escapeSvg(rank)}</text>
  </g>

  ${buildStatPill({ x: 232, y: 153, label: "TOTAL XP", value: totalXp })}
  ${buildStatPill({ x: 402, y: 153, label: "MESSAGES", value: messages })}
  ${buildStatPill({ x: 572, y: 153, label: "VOICE", value: voiceTime })}

  <text x="284" y="223" ${textAttrs({ fill: "#d7edf8", size: 18, weight: 800 })}>${escapeSvg(progressLabel)}</text>
  <text x="844" y="223" ${textAttrs({ fill: "#9fc3d5", size: 15, weight: 650, anchor: "end" })}>${Math.round(progressRatio * 100)}%</text>
  <rect x="284" y="237" width="560" height="20" rx="10" fill="#07111b" stroke="#8bd5ff" stroke-opacity="0.18"/>
  <rect x="284" y="237" width="${progressWidth}" height="20" rx="10" fill="url(#barFill)"/>
  <circle cx="${284 + progressWidth}" cy="247" r="${progressWidth > 0 ? 4 : 0}" fill="#e7f8ff" opacity="0.85"/>
</svg>`;
}

module.exports = {
  CARD_WIDTH,
  CARD_HEIGHT,
  buildLevelCardSvg,
  escapeSvg,
  trimText,
};

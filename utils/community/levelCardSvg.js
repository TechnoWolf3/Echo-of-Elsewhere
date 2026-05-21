const CARD_WIDTH = 934;
const CARD_HEIGHT = 282;
const FONT_FAMILY = "Inter, Arial, sans-serif";

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function fmtInt(value) {
  return Math.floor(Number(value) || 0).toLocaleString("en-AU");
}

function formatCompactNumber(value) {
  const n = Math.max(0, Math.floor(Number(value) || 0));
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(n >= 10_000_000_000 ? 0 : 1).replace(/\.0$/, "")}b`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}m`;
  if (n >= 100_000) return `${Math.round(n / 1000)}k`;
  return n.toLocaleString("en-AU");
}

function formatRank(rank) {
  const n = Math.floor(Number(rank) || 0);
  if (!Number.isFinite(n) || n <= 0) return "N/A";
  if (n > 9999) return "#9999+";
  return `#${n.toLocaleString("en-AU")}`;
}

function formatVoiceSeconds(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function truncateForCard(text, maxChars) {
  return trimText(text, maxChars);
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
  return `font-family="${FONT_FAMILY}" font-size="${size}" font-weight="${weight}" fill="${fill}" fill-opacity="0"${anchorAttr}`;
}

const GLYPHS = {
  "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  "C": ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  "G": ["01111", "10000", "10000", "10011", "10001", "10001", "01111"],
  "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  "I": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  "J": ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  "W": ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  "#": ["01010", "11111", "01010", "01010", "11111", "01010", "01010"],
  "/": ["00001", "00001", "00010", "00100", "01000", "10000", "10000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ",": ["00000", "00000", "00000", "00000", "00000", "01100", "01000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  "%": ["11001", "11010", "00010", "00100", "01000", "01011", "10011"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
  "<": ["00010", "00100", "01000", "10000", "01000", "00100", "00010"],
  ">": ["01000", "00100", "00010", "00001", "00010", "00100", "01000"],
  "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
  "h": ["10000", "10000", "10110", "11001", "10001", "10001", "10001"],
  "m": ["00000", "00000", "11010", "10101", "10101", "10101", "10101"],
  "k": ["10000", "10010", "10100", "11000", "10100", "10010", "10001"],
  "b": ["10000", "10000", "11110", "10001", "10001", "10001", "11110"],
};

function vectorTextWidth(text, scale, letterSpacing = 1) {
  const chars = String(text ?? "").toUpperCase().split("");
  let width = 0;
  for (const ch of chars) {
    if (ch === " ") width += 4 * scale;
    else width += 5 * scale;
    width += letterSpacing * scale;
  }
  return Math.max(0, width - letterSpacing * scale);
}

function vectorText({ x, y, text, scale, fill, anchor = "start", opacity = 1, letterSpacing = 1 }) {
  const raw = String(text ?? "");
  const width = vectorTextWidth(raw, scale, letterSpacing);
  let cursor = anchor === "end" ? x - width : anchor === "middle" ? x - width / 2 : x;
  const d = [];

  for (const ch of raw) {
    if (ch === " ") {
      cursor += 4 * scale;
      continue;
    }
    const glyph = GLYPHS[ch] || GLYPHS[ch.toUpperCase()] || GLYPHS["?"];
    for (let row = 0; row < glyph.length; row += 1) {
      for (let col = 0; col < glyph[row].length; col += 1) {
        if (glyph[row][col] !== "1") continue;
        const px = Number((cursor + col * scale).toFixed(2));
        const py = Number((y + row * scale).toFixed(2));
        d.push(`M${px} ${py}h${scale}v${scale}h-${scale}z`);
      }
    }
    cursor += (5 + letterSpacing) * scale;
  }

  if (!d.length) return "";
  return `<path d="${d.join("")}" fill="${fill}" opacity="${opacity}"/>`;
}

function buildStatPill({ x, y, width = 154, label, value }) {
  return `
    <g>
      <rect x="${x}" y="${y}" width="${width}" height="48" rx="15" fill="#0e334d" fill-opacity="0.72" stroke="#55bce8" stroke-opacity="0.22" />
      <text x="${x + 16}" y="${y + 19}" ${textAttrs({ fill: "#9fc3d5", size: 12, weight: 700 })}>${escapeSvg(label)}</text>
      <text x="${x + 16}" y="${y + 38}" ${textAttrs({ fill: "#eef9ff", size: 16, weight: 800 })}>${escapeSvg(value)}</text>
      ${vectorText({ x: x + 16, y: y + 10, text: label, scale: 1.35, fill: "#9fc3d5", opacity: 0.98 })}
      ${vectorText({ x: x + 16, y: y + 26, text: value, scale: 1.85, fill: "#eef9ff", opacity: 1 })}
    </g>`;
}

function buildLevelCardSvg(card) {
  const displayNameRaw = truncateForCard(card.displayName || "Unknown Voice", 18);
  const titleRaw = truncateForCard(card.title || "New Voice", 24);
  const displayName = escapeSvg(displayNameRaw);
  const title = escapeSvg(titleRaw);
  const level = formatCompactNumber(card.level || 1);
  const rank = formatRank(card.rank);
  const currentXp = formatCompactNumber(card.currentXp || 0);
  const neededXp = formatCompactNumber(card.neededXp || 1);
  const totalXp = formatCompactNumber(card.totalXp || 0);
  const messages = formatCompactNumber(card.messageCount || 0);
  const voiceTime = formatVoiceSeconds(card.voiceSeconds || 0);
  const progressRatio = clamp01(card.progressPercent != null ? Number(card.progressPercent) / 100 : card.progressRatio);
  const progressWidth = Math.round(560 * progressRatio);
  const progressLabel = `${currentXp} / ${neededXp} XP`;
  const avatarDataUri = card.avatarDataUri ? String(card.avatarDataUri) : null;
  const initials = escapeSvg(initialsFromName(card.displayName));

  const avatar = avatarDataUri
    ? `<image x="58" y="54" width="136" height="136" href="${escapeSvg(avatarDataUri)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)" />`
    : `<circle cx="126" cy="122" r="68" fill="url(#avatarFallback)" />
       <text x="126" y="133" ${textAttrs({ fill: "#effaff", size: 42, weight: 850, anchor: "middle" })}>${initials}</text>
       ${vectorText({ x: 126, y: 104, text: initials, scale: 4.7, fill: "#effaff", anchor: "middle" })}`;

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
  ${vectorText({ x: 232, y: 45, text: "Echo Resonance", scale: 2.05, fill: "#8bd5ff" })}
  ${vectorText({ x: 232, y: 77, text: displayNameRaw, scale: 3.65, fill: "#f4fbff" })}
  ${vectorText({ x: 234, y: 120, text: titleRaw, scale: 2.25, fill: "#b8d9ea" })}

  <g transform="translate(690 50)">
    <text x="0" y="18" ${textAttrs({ fill: "#9fc3d5", size: 12, weight: 700 })}>LEVEL</text>
    <text x="0" y="58" ${textAttrs({ fill: "#ffffff", size: 32, weight: 850 })}>${level}</text>
    ${vectorText({ x: 0, y: 9, text: "LEVEL", scale: 1.35, fill: "#9fc3d5" })}
    ${vectorText({ x: 0, y: 36, text: level, scale: level.length > 3 ? 2.85 : 3.7, fill: "#ffffff" })}
  </g>
  <g transform="translate(836 50)">
    <text x="0" y="18" ${textAttrs({ fill: "#9fc3d5", size: 12, weight: 700 })}>RANK</text>
    <text x="0" y="58" ${textAttrs({ fill: "#ffffff", size: 32, weight: 850 })}>${escapeSvg(rank)}</text>
    ${vectorText({ x: 0, y: 9, text: "RANK", scale: 1.35, fill: "#9fc3d5" })}
    ${vectorText({ x: 0, y: 36, text: rank, scale: rank.length > 5 ? 2.1 : rank.length > 3 ? 2.65 : 3.35, fill: "#ffffff" })}
  </g>

  ${buildStatPill({ x: 232, y: 153, width: 156, label: "TOTAL XP", value: totalXp })}
  ${buildStatPill({ x: 406, y: 153, width: 156, label: "MESSAGES", value: messages })}
  ${buildStatPill({ x: 580, y: 153, width: 172, label: "VOICE", value: voiceTime })}

  <text x="284" y="223" ${textAttrs({ fill: "#d7edf8", size: 18, weight: 800 })}>${escapeSvg(progressLabel)}</text>
  <text x="844" y="223" ${textAttrs({ fill: "#9fc3d5", size: 15, weight: 650, anchor: "end" })}>${Math.round(progressRatio * 100)}%</text>
  ${vectorText({ x: 284, y: 209, text: progressLabel, scale: 2.4, fill: "#d7edf8" })}
  ${vectorText({ x: 844, y: 211, text: `${Math.round(progressRatio * 100)}%`, scale: 1.85, fill: "#9fc3d5", anchor: "end" })}
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

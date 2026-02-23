import fs from "node:fs/promises";
import path from "node:path";

const OUT_FILE = process.env.ACCOLADES_OUT_FILE || "data/accolades_index.json";

const WIKI_SOURCES = {
  mvp_wins: "https://en.wikipedia.org/w/index.php?title=AP_NFL_Most_Valuable_Player&action=raw",
  opoy_wins: "https://en.wikipedia.org/w/index.php?title=AP_NFL_Offensive_Player_of_the_Year&action=raw",
  dpoy_wins: "https://en.wikipedia.org/w/index.php?title=AP_NFL_Defensive_Player_of_the_Year&action=raw",
};

const GAMES_CSV_URL = "https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv";
const ROSTERS_CSV_URL = "https://github.com/nflverse/nflverse-data/releases/download/misc/pfr_rosters.csv";

function normalizePersonName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[.,'\-]/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanPlayerDisplayName(name) {
  return String(name || "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "EgomaniacsWidget/1.0 (+https://egomaniacswidget.onrender.com)",
      Accept: "text/plain, text/csv, */*",
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status}`);
  }
  return res.text();
}

function parseCsv(csvText) {
  const rows = [];
  const text = String(csvText || "");
  let i = 0;
  let field = "";
  let row = [];
  let inQuotes = false;

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }

    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }

    if (ch === "\r") {
      i += 1;
      continue;
    }

    field += ch;
    i += 1;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (!rows.length) return [];
  const headers = rows[0].map((h) => String(h || "").trim());
  const out = [];
  for (let r = 1; r < rows.length; r += 1) {
    const line = rows[r];
    if (!line || line.length === 0) continue;
    const obj = {};
    for (let c = 0; c < headers.length; c += 1) {
      obj[headers[c]] = line[c] ?? "";
    }
    out.push(obj);
  }
  return out;
}

function extractSortnameFromTemplate(tpl) {
  const m = tpl.match(/\{\{\s*sortname\s*\|([^}]*)\}\}/i);
  if (!m) return null;
  const parts = String(m[1] || "")
    .split("|")
    .map((p) => String(p || "").trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]} ${parts[1]}`;
  }
  if (parts.length === 1) return parts[0];
  return null;
}

function extractNameFromWikiRow(rowText) {
  const sortname = extractSortnameFromTemplate(rowText);
  if (sortname) return cleanPlayerDisplayName(sortname);

  const link = rowText.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/);
  if (link) {
    return cleanPlayerDisplayName(link[1]);
  }

  return null;
}

function parseWikiWinners(rawText) {
  const text = String(rawText || "");
  const startIdx = text.indexOf("==Winners==");
  if (startIdx < 0) return [];
  const after = text.slice(startIdx);
  const nextHeader = after.search(/\n==[^=]+==\n/);
  const section = nextHeader > 0 ? after.slice(0, nextHeader) : after;

  const winners = [];
  let pendingSeasonRow = false;
  const lines = section.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();

    // OPOY/MVP style: season row then player row on next line.
    if (
      (!trimmed.includes("||") && /^\|\s*\[\[\d{4}\s+NFL season\|/i.test(trimmed)) ||
      (!trimmed.includes("||") && /^\|\s*\{\{center\|\[\[\d{4}\s+NFL season\|/i.test(trimmed))
    ) {
      pendingSeasonRow = true;
      continue;
    }

    if (pendingSeasonRow && /^!\s*scope="row"\|/i.test(trimmed)) {
      const name = extractNameFromWikiRow(line);
      if (name) winners.push(name);
      pendingSeasonRow = false;
      continue;
    }

    // DPOY style: season + player in same row.
    if (!trimmed.startsWith("|")) continue;
    if (/^\|\-/.test(trimmed) || /^\|\+/.test(trimmed) || /^\|\}/.test(trimmed) || /^\|\s*class=/i.test(trimmed)) {
      continue;
    }
    if (!trimmed.includes("||")) continue;
    const cols = trimmed.split("||").map((c) => c.trim());
    if (cols.length < 2) continue;
    const seasonCell = cols[0] || "";
    if (!/\d{4}\s+NFL season/i.test(seasonCell)) continue;
    const name = extractNameFromWikiRow(cols[1]);
    if (name) winners.push(name);
  }
  return winners;
}

function addAccoladeCount(store, playerName, key, delta = 1) {
  const clean = cleanPlayerDisplayName(playerName);
  const norm = normalizePersonName(clean);
  if (!norm) return;
  if (!store[norm]) {
    store[norm] = {
      displayName: clean,
      super_bowl_wins: 0,
      mvp_wins: 0,
      opoy_wins: 0,
      dpoy_wins: 0,
    };
  }
  if (!store[norm].displayName || store[norm].displayName.length < clean.length) {
    store[norm].displayName = clean;
  }
  store[norm][key] = Number(store[norm][key] || 0) + Number(delta || 0);
}

function winnerTeamBySeason(gamesRows) {
  const map = new Map();
  for (const row of gamesRows) {
    const gameType = String(row.game_type || "").trim().toUpperCase();
    if (gameType !== "SB") continue;
    const season = Number(row.season);
    const away = String(row.away_team || "").trim().toUpperCase();
    const home = String(row.home_team || "").trim().toUpperCase();
    const awayScore = Number(row.away_score);
    const homeScore = Number(row.home_score);
    if (!Number.isFinite(season) || !away || !home) continue;
    if (!Number.isFinite(awayScore) || !Number.isFinite(homeScore)) continue;
    const winner = awayScore > homeScore ? away : home;
    map.set(season, winner);
  }
  return map;
}

async function buildAccoladesIndex() {
  const players = {};

  for (const [key, url] of Object.entries(WIKI_SOURCES)) {
    const raw = await fetchText(url);
    const winners = parseWikiWinners(raw);
    for (const winner of winners) {
      addAccoladeCount(players, winner, key, 1);
    }
  }

  const [gamesCsv, rostersCsv] = await Promise.all([fetchText(GAMES_CSV_URL), fetchText(ROSTERS_CSV_URL)]);
  const gamesRows = parseCsv(gamesCsv);
  const rostersRows = parseCsv(rostersCsv);

  const winners = winnerTeamBySeason(gamesRows);
  for (const row of rostersRows) {
    const season = Number(row.season);
    const nflTeam = String(row.nfl || "").trim().toUpperCase();
    const player = cleanPlayerDisplayName(row.player || "");
    if (!Number.isFinite(season) || !nflTeam || !player) continue;
    const winner = winners.get(season);
    if (!winner) continue;
    if (nflTeam !== winner) continue;
    addAccoladeCount(players, player, "super_bowl_wins", 1);
  }

  const out = {
    version: "accolades-v1",
    builtAt: new Date().toISOString(),
    sources: {
      wiki: WIKI_SOURCES,
      games: GAMES_CSV_URL,
      rosters: ROSTERS_CSV_URL,
    },
    players,
  };

  const outPath = path.resolve(process.cwd(), OUT_FILE);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(out, null, 2), "utf8");

  const totalPlayers = Object.keys(players).length;
  const totals = {
    super_bowl_wins: 0,
    mvp_wins: 0,
    opoy_wins: 0,
    dpoy_wins: 0,
  };
  for (const p of Object.values(players)) {
    totals.super_bowl_wins += Number(p.super_bowl_wins || 0);
    totals.mvp_wins += Number(p.mvp_wins || 0);
    totals.opoy_wins += Number(p.opoy_wins || 0);
    totals.dpoy_wins += Number(p.dpoy_wins || 0);
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        outFile: OUT_FILE,
        totalPlayers,
        totals,
      },
      null,
      2
    )
  );
}

buildAccoladesIndex().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});

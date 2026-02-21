import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import https from "node:https";
import { fileURLToPath } from "node:url";

const SOURCE_URL =
  "https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats.csv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const tmpDir = path.join(root, "data", "tmp");
const sourceCsv = path.join(tmpDir, "player_stats.csv");
const outputJson = path.join(root, "data", "skill_position_season_stats.json");

function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function download(url, destination) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        download(res.headers.location, destination).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: ${res.statusCode}`));
        return;
      }
      const file = fs.createWriteStream(destination);
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
      file.on("error", reject);
    });
    request.on("error", reject);
  });
}

function num(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

async function build() {
  ensureDir(tmpDir);
  console.log("Downloading player stats CSV...");
  await download(SOURCE_URL, sourceCsv);

  const allowed = new Set(["RB", "WR", "TE", "FB"]);
  const seasonMap = new Map();
  let headers = [];
  let rowCount = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(sourceCsv),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line) continue;
    if (!headers.length) {
      headers = parseCsvLine(line);
      continue;
    }
    const cols = parseCsvLine(line);
    if (cols.length !== headers.length) continue;

    const row = {};
    for (let i = 0; i < headers.length; i += 1) row[headers[i]] = cols[i];

    const position = String(row.position || "").toUpperCase();
    if (!allowed.has(position)) continue;
    if ((row.season_type || "").toUpperCase() !== "REG") continue;

    const season = Number(row.season);
    if (!Number.isFinite(season) || season < 1999) continue;

    const displayName = row.player_display_name || row.player_name || "";
    if (!displayName) continue;

    const playerKey = normalizeName(displayName);
    const key = `${playerKey}::${season}`;
    const prev = seasonMap.get(key) || {
      playerName: displayName,
      playerKey,
      position,
      season,
      games: 0,
      rushing_yards: 0,
      rushing_tds: 0,
      receiving_yards: 0,
      receiving_tds: 0,
      receptions: 0,
      targets: 0,
    };

    prev.games += 1;
    prev.rushing_yards += num(row.rushing_yards);
    prev.rushing_tds += num(row.rushing_tds);
    prev.receiving_yards += num(row.receiving_yards);
    prev.receiving_tds += num(row.receiving_tds);
    prev.receptions += num(row.receptions);
    prev.targets += num(row.targets);
    seasonMap.set(key, prev);
    rowCount += 1;
  }

  const perPlayer = new Map();
  for (const agg of seasonMap.values()) {
    const list = perPlayer.get(agg.playerKey) || [];
    list.push(agg);
    perPlayer.set(agg.playerKey, list);
  }

  const players = {};
  const allSeasons = [];
  for (const [playerKey, seasons] of perPlayer.entries()) {
    const filtered = seasons
      .filter((s) => s.games >= 6)
      .sort((a, b) => b.season - a.season)
      .map((s) => ({
        season: s.season,
        position: s.position,
        games: Number(s.games.toFixed(0)),
        rushing_yards: Number(s.rushing_yards.toFixed(0)),
        rushing_tds: Number(s.rushing_tds.toFixed(0)),
        receiving_yards: Number(s.receiving_yards.toFixed(0)),
        receiving_tds: Number(s.receiving_tds.toFixed(0)),
        receptions: Number(s.receptions.toFixed(0)),
        targets: Number(s.targets.toFixed(0)),
      }));

    if (!filtered.length) continue;
    players[playerKey] = {
      playerName: seasons[0]?.playerName || playerKey,
      seasons: filtered,
    };
    allSeasons.push(...filtered);
  }

  const byPos = { RB: [], WR: [], TE: [], FB: [] };
  for (const s of allSeasons) {
    if (byPos[s.position]) byPos[s.position].push(s);
  }

  const mean = (arr, key) => {
    const vals = arr.map((x) => Number(x[key] || 0)).filter((v) => Number.isFinite(v));
    if (!vals.length) return 0;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };

  const output = {
    version: "skill-season-stats-v1",
    builtAt: new Date().toISOString(),
    sourceUrl: SOURCE_URL,
    sourceRowsRead: rowCount,
    playersCount: Object.keys(players).length,
    latestSeason: allSeasons.length ? Math.max(...allSeasons.map((s) => Number(s.season) || 0)) : null,
    league: {
      RB: {
        rushing_yards_mean: Number(mean(byPos.RB, "rushing_yards").toFixed(2)),
        rushing_tds_mean: Number(mean(byPos.RB, "rushing_tds").toFixed(2)),
        receiving_yards_mean: Number(mean(byPos.RB, "receiving_yards").toFixed(2)),
        receiving_tds_mean: Number(mean(byPos.RB, "receiving_tds").toFixed(2)),
        receptions_mean: Number(mean(byPos.RB, "receptions").toFixed(2)),
      },
      WR: {
        rushing_yards_mean: Number(mean(byPos.WR, "rushing_yards").toFixed(2)),
        rushing_tds_mean: Number(mean(byPos.WR, "rushing_tds").toFixed(2)),
        receiving_yards_mean: Number(mean(byPos.WR, "receiving_yards").toFixed(2)),
        receiving_tds_mean: Number(mean(byPos.WR, "receiving_tds").toFixed(2)),
        receptions_mean: Number(mean(byPos.WR, "receptions").toFixed(2)),
      },
      TE: {
        rushing_yards_mean: Number(mean(byPos.TE, "rushing_yards").toFixed(2)),
        rushing_tds_mean: Number(mean(byPos.TE, "rushing_tds").toFixed(2)),
        receiving_yards_mean: Number(mean(byPos.TE, "receiving_yards").toFixed(2)),
        receiving_tds_mean: Number(mean(byPos.TE, "receiving_tds").toFixed(2)),
        receptions_mean: Number(mean(byPos.TE, "receptions").toFixed(2)),
      },
      FB: {
        rushing_yards_mean: Number(mean(byPos.FB, "rushing_yards").toFixed(2)),
        rushing_tds_mean: Number(mean(byPos.FB, "rushing_tds").toFixed(2)),
        receiving_yards_mean: Number(mean(byPos.FB, "receiving_yards").toFixed(2)),
        receiving_tds_mean: Number(mean(byPos.FB, "receiving_tds").toFixed(2)),
        receptions_mean: Number(mean(byPos.FB, "receptions").toFixed(2)),
      },
    },
    players,
  };

  fs.writeFileSync(outputJson, JSON.stringify(output));
  console.log(`Wrote ${outputJson}`);
  console.log(`Players indexed: ${output.playersCount}`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});

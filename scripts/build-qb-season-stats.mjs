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
const outputJson = path.join(root, "data", "qb_season_stats.json");

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
      file.on("finish", () => {
        file.close(resolve);
      });
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
  if (!fs.existsSync(sourceCsv)) {
    console.log("Downloading player stats CSV...");
    await download(SOURCE_URL, sourceCsv);
  } else {
    console.log("Using cached player_stats.csv");
  }

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

    if ((row.position || "").toUpperCase() !== "QB") continue;
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
      season,
      passingTds: 0,
      passingInts: 0,
      passingAttempts: 0,
      passingYards: 0,
      rushingYards: 0,
      rushingTds: 0,
      rushingAttempts: 0,
      games: 0,
    };

    prev.passingTds += num(row.passing_tds);
    prev.passingInts += num(row.interceptions);
    prev.passingAttempts += num(row.attempts);
    prev.passingYards += num(row.passing_yards);
    prev.rushingYards += num(row.rushing_yards);
    prev.rushingTds += num(row.rushing_tds);
    prev.rushingAttempts += num(row.carries);
    prev.games += 1;
    seasonMap.set(key, prev);
    rowCount += 1;
  }

  const perPlayer = new Map();
  for (const agg of seasonMap.values()) {
    const list = perPlayer.get(agg.playerKey) || [];
    list.push(agg);
    perPlayer.set(agg.playerKey, list);
  }

  const seasonsAll = [];
  const players = {};
  for (const [playerKey, seasons] of perPlayer.entries()) {
    const filtered = seasons
      .filter((s) => s.games >= 4 && s.passingAttempts >= 80)
      .sort((a, b) => b.season - a.season);
    if (!filtered.length) continue;

    for (const s of filtered) seasonsAll.push(s);

    players[playerKey] = {
      playerName: filtered[0].playerName,
      seasons: filtered.map((s) => ({
        season: s.season,
        passingTds: Number(s.passingTds.toFixed(0)),
        passingInts: Number(s.passingInts.toFixed(0)),
        passingAttempts: Number(s.passingAttempts.toFixed(0)),
        passingYards: Number(s.passingYards.toFixed(0)),
        rushingYards: Number(s.rushingYards.toFixed(0)),
        rushingTds: Number(s.rushingTds.toFixed(0)),
        rushingAttempts: Number(s.rushingAttempts.toFixed(0)),
        games: Number(s.games.toFixed(0)),
      })),
    };
  }

  const tdPerSeason = seasonsAll.map((s) => s.passingTds).filter((v) => Number.isFinite(v));
  const intPerSeason = seasonsAll.map((s) => s.passingInts).filter((v) => Number.isFinite(v));
  const rushPerSeason = seasonsAll.map((s) => s.rushingYards).filter((v) => Number.isFinite(v));

  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const std = (arr) => {
    if (!arr.length) return 0;
    const m = mean(arr);
    return Math.sqrt(arr.reduce((a, v) => a + (v - m) ** 2, 0) / arr.length);
  };

  const data = {
    version: "qb-season-stats-v1",
    builtAt: new Date().toISOString(),
    sourceUrl: SOURCE_URL,
    sourceRowsRead: rowCount,
    playersCount: Object.keys(players).length,
    latestSeason: seasonsAll.length ? Math.max(...seasonsAll.map((s) => Number(s.season) || 0)) : null,
    league: {
      qbSeasonSampleSize: tdPerSeason.length,
      passingTdsMean: Number(mean(tdPerSeason).toFixed(2)),
      passingTdsStd: Number(std(tdPerSeason).toFixed(2)),
      passingIntsMean: Number(mean(intPerSeason).toFixed(2)),
      passingIntsStd: Number(std(intPerSeason).toFixed(2)),
      rushingYardsMean: Number(mean(rushPerSeason).toFixed(2)),
      rushingYardsStd: Number(std(rushPerSeason).toFixed(2)),
    },
    players,
  };

  fs.writeFileSync(outputJson, JSON.stringify(data));
  console.log(`Wrote ${outputJson}`);
  console.log(`Players indexed: ${data.playersCount}`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});

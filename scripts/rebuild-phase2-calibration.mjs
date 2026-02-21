import fs from "node:fs/promises";
import path from "node:path";

const outPath = path.resolve(process.cwd(), "data/phase2_calibration.json");

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const calibration = {
    version: "phase2-v1",
    builtAt: todayIso(),
    awards: {
      earlyCareerMultiplier: 0.82,
      decay: { mvp: 0.965, opoy: 0.965, dpoy: 0.965, allpro: 0.97 },
      hof: { base: 6, slope: 9.5 },
      basePct: {
        mvp: { qb: 4.2, rb: 0.8, receiver: 0.6, defense: 0.15, other: 0.08 },
        opoy: { qb: 2.6, rb: 2.0, receiver: 1.8, defense: 0.03, other: 0.05 },
        dpoy: { qb: 0.02, rb: 0.02, receiver: 0.02, defense: 1.9, other: 0.05 },
        allpro: { qb: 6.2, rb: 5.6, receiver: 6.4, defense: 5.8, other: 3.0 },
      },
    },
    team: {
      defaultSuperBowlSeasonPct: 4.5,
    },
    performance: {
      decay: 0.965,
      seasonStatModel: {
        passingInterceptionsMean: {
          elite: 9,
          high: 10.5,
          young: 12.5,
          default: 11,
        },
        passingTdsMean: {
          elite: 34,
          high: 30,
          young: 24,
          default: 27,
        },
      },
    },
    career: {
      longevityLambda: 0.14,
      earningsRetention: 0.78,
    },
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(calibration, null, 2)}\n`, "utf8");
  console.log(`Phase 2 calibration rebuilt at ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

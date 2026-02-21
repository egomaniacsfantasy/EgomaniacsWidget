function clamp(num, min, max) {
  return Math.min(max, Math.max(min, num));
}

function round1(num) {
  return Math.round(num * 10) / 10;
}

function countDistribution(perSeasonProbabilities, maxCount = 8) {
  const n = perSeasonProbabilities.length;
  const dp = new Array(n + 1).fill(0);
  dp[0] = 1;
  for (const pRaw of perSeasonProbabilities) {
    const p = clamp(pRaw, 0, 1);
    for (let j = n; j >= 1; j -= 1) {
      dp[j] = dp[j] * (1 - p) + dp[j - 1] * p;
    }
    dp[0] *= 1 - p;
  }
  const probs = [];
  let used = 0;
  for (let i = 0; i < Math.min(maxCount, dp.length); i += 1) {
    const pct = clamp(dp[i] * 100, 0, 100);
    probs.push({ count: i, probabilityPct: round1(pct) });
    used += pct;
  }
  if (dp.length > maxCount) {
    probs.push({ count: `${maxCount}+`, probabilityPct: round1(clamp(100 - used, 0, 100)) });
  }
  const expected = perSeasonProbabilities.reduce((acc, p) => acc + clamp(p, 0, 1), 0);
  return {
    expectedCount: round1(expected),
    distribution: probs,
  };
}

function toAmericanOdds(probabilityPct) {
  const p = clamp(probabilityPct / 100, 0.001, 0.999);
  if (p >= 0.5) return `${-Math.round((p / (1 - p)) * 100)}`;
  return `+${Math.round(((1 - p) / p) * 100)}`;
}

function playerTierMultiplier(playerName) {
  const key = String(playerName || "").toLowerCase();
  if (["patrick mahomes"].includes(key)) return 2.6;
  if (["joe burrow", "josh allen", "lamar jackson"].includes(key)) return 2.0;
  if (["jalen hurts", "justin herbert", "cj stroud"].includes(key)) return 1.5;
  if (["drake maye", "caleb williams", "jayden daniels"].includes(key)) return 0.9;
  return 1.0;
}

function calibrationValue(calibration, path, fallback) {
  const parts = String(path || "").split(".");
  let cur = calibration || {};
  for (const p of parts) {
    if (!cur || typeof cur !== "object" || !(p in cur)) return fallback;
    cur = cur[p];
  }
  return cur ?? fallback;
}

function ageCurve(age) {
  const a = Number(age || 27);
  if (!Number.isFinite(a)) return 1;
  if (a <= 24) return 0.85;
  if (a <= 28) return 1.05;
  if (a <= 31) return 1.0;
  if (a <= 34) return 0.9;
  if (a <= 37) return 0.7;
  return 0.45;
}

function yearsRemaining(age, yearsExp) {
  const a = Number(age || 0);
  const exp = Number(yearsExp || 0);
  if (Number.isFinite(a) && a > 0) return clamp(41 - a, 2, 15);
  if (Number.isFinite(exp) && exp >= 0) return clamp(12 - exp, 2, 15);
  return 9;
}

function positionGroup(position) {
  const p = String(position || "").toUpperCase();
  if (["QB"].includes(p)) return "qb";
  if (["WR", "TE"].includes(p)) return "receiver";
  if (["RB", "FB"].includes(p)) return "rb";
  if (["DE", "DT", "LB", "EDGE", "CB", "S"].includes(p)) return "defense";
  if (["K", "P", "LS"].includes(p)) return "special";
  return "other";
}

function buildSeasonVector(basePct, years, decay = 0.97) {
  const arr = [];
  for (let i = 0; i < years; i += 1) {
    arr.push(clamp((basePct * Math.pow(decay, i)) / 100, 0.0005, 0.8));
  }
  return arr;
}

function awardBasePctByType(type, posGroup, calibration) {
  const table = {
    mvp: { qb: 4.2, rb: 0.8, receiver: 0.6, defense: 0.15, other: 0.08 },
    opoy: { qb: 2.6, rb: 2.0, receiver: 1.8, defense: 0.03, other: 0.05 },
    dpoy: { qb: 0.02, rb: 0.02, receiver: 0.02, defense: 1.9, other: 0.05 },
    allpro: { qb: 6.2, rb: 5.6, receiver: 6.4, defense: 5.8, other: 3.0 },
  };
  const map = calibrationValue(calibration, `awards.basePct.${type}`, null) || table[type] || table.mvp;
  return map[posGroup] ?? map.other;
}

function buildAwardsOutcomes(profile, calibration) {
  const posGroup = positionGroup(profile.position);
  const years = yearsRemaining(profile.age, profile.yearsExp);
  const tier = playerTierMultiplier(profile.name);
  const ageMul = ageCurve(profile.age);
  const yearMul = Number(profile.yearsExp || 0) <= 2
    ? calibrationValue(calibration, "awards.earlyCareerMultiplier", 0.82)
    : 1.0;

  const mk = (type) => {
    const base = awardBasePctByType(type, posGroup, calibration) * tier * ageMul * yearMul;
    const decay = calibrationValue(calibration, `awards.decay.${type}`, 0.965);
    return countDistribution(buildSeasonVector(base, years, decay), 8);
  };

  const mvp = mk("mvp");
  const opoy = mk("opoy");
  const dpoy = mk("dpoy");
  const allPro = mk("allpro");

  // HOF is a blended proxy using expected high-end outcomes and longevity.
  const hofScore =
    mvp.expectedCount * 2.2 +
    opoy.expectedCount * 1.4 +
    dpoy.expectedCount * 1.6 +
    allPro.expectedCount * 0.9 +
    (years >= 10 ? 1.1 : 0.4);
  const hofBase = calibrationValue(calibration, "awards.hof.base", 6);
  const hofSlope = calibrationValue(calibration, "awards.hof.slope", 9.5);
  const hofProbPct = clamp(hofBase + hofScore * hofSlope, 0.5, 95);

  return {
    mvp,
    opoy,
    dpoy,
    allPro,
    hallOfFame: {
      probabilityPct: round1(hofProbPct),
      impliedOdds: toAmericanOdds(hofProbPct),
    },
  };
}

function buildTeamOutcomes(profile, teamSuperBowlPct, calibration) {
  const years = yearsRemaining(profile.age, profile.yearsExp);
  const posGroup = positionGroup(profile.position);
  const tier = playerTierMultiplier(profile.name);
  const qbImpact = posGroup === "qb" ? 1.0 : 0.65;

  const fallbackSb = calibrationValue(calibration, "team.defaultSuperBowlSeasonPct", 4.5);
  const sbSeason = clamp((teamSuperBowlPct || fallbackSb) * qbImpact * Math.min(1.35, 0.8 + tier * 0.25), 0.3, 28);
  const ccgSeason = clamp(sbSeason * 2.2, 0.7, 45);
  const playoffsSeason = clamp(26 + sbSeason * 2.0, 8, 78);
  const undefeatedSeason = clamp(sbSeason * 0.006, 0.01, 0.35);

  const sb = countDistribution(buildSeasonVector(sbSeason, years, 0.95), 7);
  const conferenceTitles = countDistribution(buildSeasonVector(ccgSeason, years, 0.95), 9);
  const playoffBerths = countDistribution(buildSeasonVector(playoffsSeason, years, 0.97), 15);
  const undefeated = countDistribution(buildSeasonVector(undefeatedSeason, years, 0.98), 3);

  const avgWinsIfPlayoffs = clamp(0.8 + sbSeason / 6, 0.5, 2.1);
  const expectedPlayoffWins = round1((playoffBerths.expectedCount * avgWinsIfPlayoffs));

  return {
    superBowlsWon: sb,
    conferenceChampionshipsWon: conferenceTitles,
    expectedPlayoffWins,
    playoffBerths,
    playoffRatePct: round1((playoffBerths.expectedCount / Math.max(1, years)) * 100),
    undefeatedSeasons: undefeated,
  };
}

function thresholdBasePct(metric, posGroup, threshold, calibration) {
  const calibrated = calibrationValue(calibration, `performance.thresholdBasePct.${metric}.${posGroup}`, null);
  if (Number.isFinite(calibrated)) return calibrated;
  const t = Number(threshold || 0);
  if (metric === "passing_yards") {
    if (posGroup !== "qb") return 0.05;
    if (t >= 5500) return 0.5;
    if (t >= 5000) return 1.4;
    if (t >= 4500) return 5.0;
    if (t >= 4000) return 16;
    return 28;
  }
  if (metric === "passing_tds") {
    if (posGroup !== "qb") return 0.05;
    if (t >= 50) return 0.6;
    if (t >= 45) return 1.7;
    if (t >= 40) return 5.4;
    if (t >= 35) return 13.2;
    return 25;
  }
  if (metric === "receiving_yards") {
    if (!["receiver", "rb"].includes(posGroup)) return 0.05;
    if (t >= 1900) return 0.9;
    if (t >= 1700) return 2.4;
    if (t >= 1500) return 7.0;
    if (t >= 1300) return 15.4;
    return 26;
  }
  if (metric === "sacks") {
    if (posGroup !== "defense") return 0.05;
    if (t >= 22) return 1.0;
    if (t >= 18) return 2.6;
    if (t >= 15) return 8.1;
    if (t >= 12) return 15.7;
    return 24;
  }
  if (metric === "interceptions") {
    if (posGroup !== "defense") return 0.08;
    if (t >= 10) return 0.9;
    if (t >= 8) return 2.3;
    if (t >= 6) return 8.3;
    if (t >= 5) return 13.5;
    return 24;
  }
  return 0.5;
}

function buildPerformanceOutcomes(profile, calibration) {
  const posGroup = positionGroup(profile.position);
  const years = yearsRemaining(profile.age, profile.yearsExp);
  const tier = playerTierMultiplier(profile.name);
  const ageMul = ageCurve(profile.age);
  const lift = clamp(0.8 + tier * 0.22, 0.6, 1.7) * ageMul;

  const thresholdDist = (metric, threshold) => {
    const base = thresholdBasePct(metric, posGroup, threshold, calibration) * lift;
    const decay = calibrationValue(calibration, "performance.decay", 0.965);
    return countDistribution(buildSeasonVector(base, years, decay), 8);
  };

  const recordBreak = {
    passingTdsSingleSeason: round1(clamp((thresholdDist("passing_tds", 56).expectedCount / 1.6) * 100, 0.1, 55)),
    passingYardsSingleSeason: round1(clamp((thresholdDist("passing_yards", 5600).expectedCount / 1.5) * 100, 0.1, 55)),
    receivingYardsSingleSeason: round1(clamp((thresholdDist("receiving_yards", 2000).expectedCount / 1.7) * 100, 0.1, 55)),
    sacksSingleSeason: round1(clamp((thresholdDist("sacks", 23).expectedCount / 1.5) * 100, 0.1, 55)),
  };

  const leagueLeader = {
    passingYards: thresholdDist("passing_yards", 5000),
    passingTds: thresholdDist("passing_tds", 45),
    receivingYards: thresholdDist("receiving_yards", 1700),
    sacks: thresholdDist("sacks", 18),
    interceptions: thresholdDist("interceptions", 8),
  };

  const qbrAtLeast70 = posGroup === "qb"
    ? countDistribution(buildSeasonVector(clamp(18 * lift, 4, 42), years, 0.97), 8)
    : countDistribution(buildSeasonVector(0.05, years, 1), 3);

  return {
    thresholdTemplates: {
      passingYards4500: thresholdDist("passing_yards", 4500),
      passingTds40: thresholdDist("passing_tds", 40),
      receivingYards1500: thresholdDist("receiving_yards", 1500),
      sacks15: thresholdDist("sacks", 15),
      interceptions6: thresholdDist("interceptions", 6),
    },
    leagueLeadingFinishes: leagueLeader,
    recordBreakProbabilityPct: recordBreak,
    qbrAbove70: qbrAtLeast70,
  };
}

function buildCareerOutcomes(profile, calibration) {
  const posGroup = positionGroup(profile.position);
  const age = Number(profile.age || 26);
  const tier = playerTierMultiplier(profile.name);
  const years = yearsRemaining(profile.age, profile.yearsExp);

  const probPlayToAge = (targetAge) => {
    const delta = targetAge - age;
    if (delta <= 0) return 100;
    const decayLambda = calibrationValue(calibration, "career.longevityLambda", 0.14);
    let p = 100 * Math.exp(-decayLambda * delta);
    if (posGroup === "qb") p *= 1.25;
    p *= clamp(0.8 + tier * 0.12, 0.65, 1.5);
    return round1(clamp(p, 0.2, 99.9));
  };

  const annualEarningsM = (() => {
    if (posGroup === "qb") return clamp(28 + tier * 9, 8, 65);
    if (posGroup === "receiver") return clamp(13 + tier * 4, 2, 35);
    if (posGroup === "rb") return clamp(8 + tier * 2, 1, 18);
    if (posGroup === "defense") return clamp(12 + tier * 3, 2, 32);
    return clamp(6 + tier * 2, 1, 20);
  })();
  const earningsRetention = calibrationValue(calibration, "career.earningsRetention", 0.78);
  const expectedEarningsM = round1(annualEarningsM * years * earningsRetention);

  const milestone = (label, target, basePct) => ({
    label,
    target,
    probabilityPct: round1(clamp(basePct * clamp(0.82 + tier * 0.2, 0.6, 1.7), 0.1, 95)),
    impliedOdds: toAmericanOdds(clamp(basePct * clamp(0.82 + tier * 0.2, 0.6, 1.7), 0.1, 95)),
  });

  const milestones = [];
  if (posGroup === "qb") {
    milestones.push(milestone("Career passing TDs", 300, 26));
    milestones.push(milestone("Career passing TDs", 400, 11));
    milestones.push(milestone("Career passing TDs", 500, 3.4));
    milestones.push(milestone("Career passing yards", 50000, 18));
  } else if (posGroup === "receiver") {
    milestones.push(milestone("Career receiving yards", 10000, 21));
    milestones.push(milestone("Career receiving yards", 13000, 9));
    milestones.push(milestone("Career receiving yards", 15000, 3));
  } else if (posGroup === "rb") {
    milestones.push(milestone("Career rushing yards", 8000, 23));
    milestones.push(milestone("Career rushing yards", 12000, 6));
  } else if (posGroup === "defense") {
    milestones.push(milestone("Career sacks", 80, 17));
    milestones.push(milestone("Career sacks", 120, 6));
  }

  return {
    longevity: {
      playToAge30Pct: probPlayToAge(30),
      playToAge35Pct: probPlayToAge(35),
      playToAge40Pct: probPlayToAge(40),
    },
    expectedCareerEarningsMillionUsd: expectedEarningsM,
    milestoneProbabilities: milestones,
  };
}

export function buildPlayerOutcomes(profile, context) {
  const teamSuperBowlPct = Number(context?.teamSuperBowlPct || 0);
  const calibration = context?.calibration || {};
  const awards = buildAwardsOutcomes(profile, calibration);
  const teamOutcomes = buildTeamOutcomes(profile, teamSuperBowlPct, calibration);
  const performance = buildPerformanceOutcomes(profile, calibration);
  const career = buildCareerOutcomes(profile, calibration);
  return {
    asOfDate: context?.asOfDate || new Date().toISOString().slice(0, 10),
    player: {
      name: profile.name,
      position: profile.position || "NA",
      teamAbbr: profile.teamAbbr || "",
      age: profile.age ?? null,
      yearsExp: profile.yearsExp ?? null,
    },
    awards,
    teamOutcomes,
    performance,
    career,
  };
}

export function buildPerformanceThresholdOutcome(profile, metric, threshold, context = {}) {
  const posGroup = positionGroup(profile.position);
  const years = yearsRemaining(profile.age, profile.yearsExp);
  const tier = playerTierMultiplier(profile.name);
  const ageMul = ageCurve(profile.age);
  const lift = clamp(0.8 + tier * 0.22, 0.6, 1.7) * ageMul;
  const calibration = context?.calibration || {};
  const base = thresholdBasePct(metric, posGroup, threshold, calibration) * lift;
  const decay = calibrationValue(calibration, "performance.decay", 0.965);
  const dist = countDistribution(buildSeasonVector(base, years, decay), 8);
  return {
    metric,
    threshold,
    expectedCount: dist.expectedCount,
    distribution: dist.distribution,
  };
}

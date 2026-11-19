// GTA VI trophy rarity forecast — forecaster for Exophase PS5 earn rates.
//
// Model (written from scratch for this competition):
//   A trophy's earn rate is earners / players_tracked. Exophase refreshes its
//   counts on its own schedule, so a read shows the rates as of its last
//   refresh. Between refreshes the page is frozen; at a refresh the
//   denominator (players tracked) jumps much faster than the numerator
//   (earners), so rates fall. The forecaster therefore models, on the logit
//   scale, (a) the trend each trophy's rate actually shows in the case's
//   history — a least-squares line of logit(rate) against ln(1 + hours since
//   the first read) — and extrapolates it to the target, and (b) when the
//   whole history is frozen (identical reads: no refresh has landed yet), a
//   refresh/dilution prior: the denominator is assumed to jump at the next
//   refresh while earners only creep up with play time, so the median logit
//   shifts down and the spread widens a lot (a flat history carries no
//   information about when or how big the next refresh is).
//   The spread combines the house random-walk term (0.5*sqrt(days)), the
//   trend fit's residual, extrapolation distance, and — for a frozen history
//   — refresh uncertainty. Everything is a pure function of the input file:
//   no randomness, no clock, no network. Only Node's standard library.

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const Z = [
  -1.6448536269514722, -0.6744897501960817, 0, 0.6744897501960817,
  1.6448536269514722,
];

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function logit(pct: number): number {
  const p = clamp(pct, 0.01, 99.99) / 100;
  return Math.log(p / (1 - p));
}

function sigmoid(l: number): number {
  return 100 / (1 + Math.exp(-l));
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

// Earner growth per hour, by tier: how fast the count of players who have
// earned a trophy of this tier grows while people keep playing. Story/bronze
// trophies are earned quickly by the launch-night crowd; the platinum (full
// completion) barely moves in the first hours.
function earnerRatePerHour(tier: string): number {
  if (tier === "platinum") return 0.05;
  if (tier === "gold") return 0.1;
  if (tier === "silver") return 0.2;
  return 0.35;
}

type Read = {
  atMs: number;
  players: number;
  rates: (number | null)[];
};

type Trophy = { id: number; tier: string };

function forecastTrophy(
  trophy: Trophy,
  reads: Read[],
  lastRate: number,
  horizonHours: number,
  staleHours: number,
  targetHours: number,
): number[] {
  // A trophy everyone already has stays (nearly) universal: the 100% rate
  // did not fall at the launch-night refresh, and "Complete Gone Fishing" is
  // earned in the first minutes of play, so new tracked players earn it too.
  if (lastRate >= 99.99) {
    return [99.9, 99.97, 99.99, 99.99, 99.99];
  }

  const n = trophy.id;
  const pts: { u: number; l: number }[] = [];
  const t0 = reads[0].atMs;
  for (const r of reads) {
    const rate = r.rates[n - 1];
    if (rate === null || rate === undefined) continue;
    const hours = Math.max(0, (r.atMs - t0) / 3600000);
    pts.push({ u: Math.log(1 + hours), l: logit(rate) });
  }

  const lastLogit = logit(lastRate);
  const days = horizonHours / 24;

  // Is the whole history frozen? Every read identical (same players tracked
  // and same rates) means no refresh has landed since the first read.
  let frozen = reads.length >= 2;
  if (frozen) {
    const p0 = reads[0].players;
    for (const r of reads) {
      if (r.players !== p0) { frozen = false; break; }
    }
  }
  if (frozen) {
    for (let i = 0; i < reads.length && frozen; i++) {
      for (let j = i + 1; j < reads.length; j++) {
        for (let k = 0; k < reads[i].rates.length; k++) {
          if (reads[i].rates[k] !== reads[j].rates[k]) { frozen = false; break; }
        }
        if (!frozen) break;
      }
    }
  }

  let medianLogit: number;
  let sigma: number;

  if (frozen) {
    // Refresh/dilution prior. The page has already been stale for
    // `staleHours` and the target is `horizonHours` further out, so the
    // denominator at the next refresh has had (stale + horizon) hours of
    // player inflow behind it. On launch night one refresh took players
    // tracked 638 -> 3,868 (about 6x) after roughly 4.7 hours of staleness,
    // which the 1 + t/0.9 shape reproduces (1 + 4.7/0.9 ~= 6.2); the factor
    // is capped so a very stale page cannot imply an absurd jump.
    const denomFactor = clamp(1 + (staleHours + horizonHours) / 0.9, 1, 8);
    const earnFactor = 1 + earnerRatePerHour(trophy.tier) * horizonHours;
    medianLogit = lastLogit - Math.log(denomFactor) + Math.log(earnFactor);
    // Refresh timing and size are both unknown, so the spread is wide:
    // about 0.85 logit units (calibrated on the practice refresh: with the
    // median centred on the dilution prior, 0.85 minimises the mean pinball
    // loss across earner-growth scenarios from pure dilution to 2.5x earner
    // growth, and keeps the worst case under 0.27), growing a little with
    // a longer horizon.
    const sigmaRefresh = Math.min(1.3, 0.85 * Math.sqrt(Math.max(1, horizonHours / 1.5)));
    sigma = Math.sqrt(
      0.25 * days + sigmaRefresh * sigmaRefresh,
    );
  } else {
    // Trend fit: least squares of logit(rate) on ln(1 + hours since first
    // read), extrapolated to the target. With fewer than 3 points the line
    // is meaningless, so fall back to the last rate.
    let a = lastLogit;
    let b = 0;
    let resid = 0;
    if (pts.length >= 3) {
      let su = 0;
      let sl = 0;
      for (const p of pts) { su += p.u; sl += p.l; }
      const mu = su / pts.length;
      const ml = sl / pts.length;
      let sxx = 0;
      let sxl = 0;
      for (const p of pts) {
        sxx += (p.u - mu) * (p.u - mu);
        sxl += (p.u - mu) * (p.l - ml);
      }
      if (sxx > 1e-12) {
        b = sxl / sxx;
        a = ml - b * mu;
      } else {
        a = ml;
        b = 0;
      }
      let ss = 0;
      for (const p of pts) {
        const e = p.l - (a + b * p.u);
        ss += e * e;
      }
      resid = Math.sqrt(ss / Math.max(1, pts.length - 2));
    }
    const uTarget = Math.log(1 + targetHours);
    const uLast = pts.length > 0 ? pts[pts.length - 1].u : 0;
    // Guard the extrapolation: a line fitted on launch night must not
    // extrapolate the median off a cliff over a 4.5-day horizon.
    const shift = clamp(a + b * uTarget - lastLogit, -5, 2);
    medianLogit = lastLogit + shift;
    const sigmaRw = 0.5 * Math.sqrt(days);
    const sigmaExtrap = 0.25 * Math.max(0, uTarget - uLast);
    sigma = Math.sqrt(
      sigmaRw * sigmaRw + resid * resid + sigmaExtrap * sigmaExtrap,
    );
  }

  sigma = clamp(sigma, 0.15, 2.0);
  const qs: number[] = [];
  for (let k = 0; k < 5; k++) {
    qs.push(round4(clamp(sigmoid(medianLogit + Z[k] * sigma), 0.01, 99.99)));
  }
  // Rounding can only tie neighbours; enforce non-decreasing explicitly.
  for (let k = 1; k < 5; k++) {
    if (qs[k] < qs[k - 1]) qs[k] = qs[k - 1];
  }
  return qs;
}

function forecastCase(c: any): { trophies: { id: number; q: number[] }[] } {
  const trophies: Trophy[] = c.trophies;
  const history = c.history as any[];
  const reads: Read[] = history.map((h: any) => ({
    atMs: Date.parse(h.at),
    players: h.players_tracked,
    rates: h.rates as (number | null)[],
  }));
  const checkpointMs = Date.parse(c.at);
  const targetMs = Date.parse(c.target);
  const horizonHours =
    (typeof c.horizon_minutes === "number"
      ? c.horizon_minutes
      : (targetMs - checkpointMs) / 60000) / 60;
  const staleHours =
    reads.length > 0 ? Math.max(0, (checkpointMs - reads[0].atMs) / 3600000) : 0;
  const targetHours =
    reads.length > 0 ? Math.max(0, (targetMs - reads[0].atMs) / 3600000) : horizonHours;

  const last = reads[reads.length - 1];
  const rows = trophies.map((t) => {
    let lastRate: number | null = null;
    for (let i = reads.length - 1; i >= 0; i--) {
      const r = reads[i].rates[t.id - 1];
      if (r !== null && r !== undefined) { lastRate = r; break; }
    }
    if (lastRate === null) lastRate = 0.63;
    return {
      id: t.id,
      q: forecastTrophy(t, reads, lastRate, horizonHours, staleHours, targetHours),
    };
  });
  void last;
  return { trophies: rows };
}

function main(): void {
  const inputDir = process.env.MAKEFUN_INPUT_DIR || "/input/";
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR || "/output/";
  mkdirSync(outputDir, { recursive: true });
  const files = readdirSync(inputDir)
    .filter((f) => f.endsWith(".in"))
    .sort();
  for (const f of files) {
    const c = JSON.parse(readFileSync(join(inputDir, f), "utf8"));
    const out = forecastCase(c);
    const id = f.slice(0, -3);
    writeFileSync(join(outputDir, id + ".out"), JSON.stringify(out));
  }
}

main();

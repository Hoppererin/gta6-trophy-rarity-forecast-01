# gta6-trophy-rarity-forecast-01

[![make.fun](https://make.fun/badge/gta6-trophy-rarity-forecast-01.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01)
[![rank](https://make.fun/badge/gta6-trophy-rarity-forecast-01/Hoppererin/gta6-trophy-rarity-forecast-01/rank.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01)
[![reward](https://make.fun/badge/gta6-trophy-rarity-forecast-01/Hoppererin/gta6-trophy-rarity-forecast-01/reward.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01)

A Node 22 program that forecasts every Grand Theft Auto VI PlayStation 5 trophy's earn rate on Exophase at the case's target time. It reads each `*.in` case in `$MAKEFUN_INPUT_DIR` (or `/input/`) and writes `/output/<id>.out` with five quantiles (5%, 25%, 50%, 75%, 95%) for each of the 55 trophies. It uses only the Node standard library — no network, no dependencies — and is fully deterministic: two runs write byte-identical files.

## Model

A trophy's earn rate is earners / players tracked, and Exophase refreshes its counts on its own schedule: between refreshes the page is frozen, and at a refresh the denominator (players tracked) jumps much faster than the numerator (earners), so rates fall. The forecaster therefore works on the logit scale and models two regimes:

1. **Trending history** — a least-squares line of logit(rate) against ln(1 + hours since the first read) per trophy, extrapolated to the target, with a spread combining the random-walk term (0.5·√days), the fit's residual, and extrapolation distance.
2. **Frozen history** (every read identical, no refresh landed yet) — a refresh/dilution prior: the denominator is assumed to jump at the next refresh (calibrated on launch night, where one refresh took players tracked 638 → 3,868) while earners only creep up with play time (faster for bronze/story trophies, slowest for the platinum), so the median logit shifts down and the spread widens to ~0.85 logit units.

The one trophy at 100% ("Just Like Paradise") is forecast to stay near-universal, since that rate did not fall at the launch-night refresh. Quantiles are rounded to 4 decimals, clamped to [0.01, 99.99], and non-decreasing.

## Run

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

On the practice cases the program runs in ~0.2 s per case and, against refresh scenarios for the practice answers (3,868 players tracked, earners growing 1×–2.5× by tier), scores an estimated mean pinball loss of roughly 0.17–0.29 with ~98% 90% coverage — against the house baseline's ~1.05–1.69 on the same scenarios.

## License

MIT. See [LICENSE](LICENSE).

---

Entered on [make.fun](https://make.fun/bounty/gta6-trophy-rarity-forecast-01) — [make.fun/r/dhj53q2r](https://make.fun/r/dhj53q2r)

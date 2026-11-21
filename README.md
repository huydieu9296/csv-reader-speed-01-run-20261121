# Fast CSV Reader

[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![Rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/huydieu9296/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![Reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/huydieu9296/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0: `solve.js` answers every
case exactly as csv-reader does — same `{columns, rows, errors}` on every
input, including its broken-row policy (BOM, stray CR, unterminated quotes,
quote junk, short/long rows, CRLF inside quotes) — but reads the text with
native `indexOf` jumps between delimiters and `slice` cuts instead of walking
it one character at a time.

## Layout

- `solve.js` — the entry: `run(input)` returns csv-reader's answer for
  `{text, header}`. No dependencies.
- `main.ts` — the harness driver: reads `/input/cases.json`, answers each case
  with `run`, writes `/output/answers.json`. Turns V8's incremental marking
  off, as the house baseline does.
- `package.json` — `{"type": "module"}` so Node treats the entry as ESM
  without a reparse.

## Results on the practice set (local, this machine)

- Correctness: 6/6 cases identical to csv-reader, byte-identical output;
  `grade-local` says `passed: 1`, L1 regrade reproduced byte for byte.
- Fuzz: 33,170 crafted + random checks against the reference, 0 failures.
- Speed (solve only, median of 9 runs over the 6 practice cases, ~10.2M
  chars): ~123 ms vs csv-reader's ~551 ms — about 4.5x. End-to-end
  (`main.ts`, incl. JSON parse/stringify and Node startup): ~0.89 s vs
  ~1.62 s of CPU user time, about 1.8x.

## Grade locally

```sh
node cli/makefun.mjs grade-local --kit <kit-dir> --bot . --driver process
```

An entry for the [Read broken CSV files faster bounty on make.fun](https://make.fun/bounty/csv-reader-speed-01-run-20261121).

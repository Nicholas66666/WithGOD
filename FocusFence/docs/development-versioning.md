# Development Versioning

## Baselines

- Keep `main` as the last human-verified stable baseline.
- Tag human-verified baselines with `baseline/YYYY-MM-DD-<name>`.
- Do not continue experimental Watch work on `main` after a baseline is tagged.

## Branches

- Use `codex/deep-response-lab` for DeepResponse Watch Lab and realtime server work.
- Keep DeepResponse changes inside `Sources/DeepResponseWatchLab`, `scripts/deep-response*`, and related docs/tests unless explicitly integrating later.
- Do not modify the Presence quick-response flow for DeepResponse experiments.

## Required Checks Before A Baseline

Run these before tagging a stable baseline:

```bash
node --test scripts/*.test.mjs scripts/deep-response/**/*.test.mjs
set -a && source .env.local && set +a && xcodebuild -project Focus.xcodeproj -scheme Presence -configuration Debug -destination 'platform=iOS,id=00008150-000544D901E2401C' -derivedDataPath /Users/nicho/Library/Developer/Xcode/DerivedData/Focus-cybkojzcswzxyscwwemxdhsnugsk build
set -a && source .env.local && set +a && xcodebuild -project Focus.xcodeproj -scheme DeepResponseWatchLab -configuration Debug -destination 'platform=watchOS,id=6B873DBC-11D7-5F93-AA64-96FB0531C28B' -derivedDataPath /Users/nicho/Library/Developer/Xcode/DerivedData/Focus-cybkojzcswzxyscwwemxdhsnugsk build
```

## Rollback

To inspect stable points:

```bash
git tag --list 'baseline/*'
git log --oneline --decorate --max-count=20
```

To return the working tree to a known baseline, first save or commit any current work, then switch to the tagged state deliberately. Do not use destructive reset commands without an explicit human decision.

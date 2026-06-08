# SEMrush API Runbook

## Secret Setup

Do not paste the key into committed files. Add it to `.env.local`:

```bash
SEMRUSH_API_KEY=...
```

Then load it before running scripts:

```bash
set -a
source .env.local
set +a
```

## Seed Keywords

Seed clusters live in:

```text
launch-os/config/seed-keywords.json
```

Current clusters:

- `anxiety-worry`
- `anger-reaction`
- `overwhelmed-peace`
- `conflict-relationships`

## Preview Requests Without Pulling

```bash
node launch-os/scripts/semrush/fetch-seed-keywords.mjs
```

This prints redacted API URLs and does not expose the API key.

## Pull One Keyword

```bash
node launch-os/scripts/semrush/fetch-keyword-overview.mjs --phrase="bible verses for anxiety"
```

Raw CSV is written to:

```text
launch-os/data/raw/semrush/
```

## Normalize

```bash
npm run launch:semrush:normalize
npm run launch:dashboard:build
npm run launch:verify
```

Processed keyword rows are written to:

```text
launch-os/data/processed/semrush-keywords.json
```

## Analysis Questions

After the first pull, answer:

- Which demand clusters have real US volume?
- Which terms have CPC high enough to imply commercial competition?
- Which terms look like pure free-content intent and should be avoided or handled carefully?
- Which negative keywords should be added?
- Which landing page type should each ad group use?


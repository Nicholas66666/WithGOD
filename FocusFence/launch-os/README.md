# Launch OS

Launch OS is the public-ready operating system for the Scripture companion overseas launch.

It keeps the launch honest: every data pull, decision, mistake, page draft, keyword finding, ad result, and daily review should be traceable from this workspace.

## Current Launch Goal

Ship a mature $149 Scripture companion wearable to the US market, run the first focused paid-search validation, and get the first real order.

## Source Of Truth

- `daily/` records what happened each day.
- `decisions/` records important commercial and product decisions.
- `research/` stores keyword, competitor, ad, and landing-page investigations.
- `data/raw/` stores API outputs exactly as received.
- `data/processed/` stores normalized data used by the dashboard.
- `scripts/` contains repeatable data and dashboard jobs.
- `dashboard/public/` contains the readable project dashboard.
- `infra/volcengine/` contains the public deployment scaffold.

## Daily Loop

1. Plan the day.
2. Pull or inspect source data.
3. Record findings before making decisions.
4. Write decisions with evidence and reversal criteria.
5. Update the dashboard.
6. Commit meaningful progress.

## Data Rule

Raw API results are never edited by hand. Processed files can be regenerated from scripts. If a decision cites a number, it should cite the source file or query that produced it.

## Secret Rule

Do not commit API keys or cloud credentials. Scripts read secrets from environment variables only.


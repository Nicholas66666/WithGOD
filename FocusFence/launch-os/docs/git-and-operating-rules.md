# Git And Operating Rules

## Branches

- Use `codex/` branches for implementation.
- Keep launch-system work isolated from app feature work when possible.
- Do not commit secrets, raw credentials, or personal tokens.

## Commit Cadence

Commit after each coherent unit:

- process templates
- dashboard renderer
- SEMrush scripts
- deployment scaffold
- verification scripts

## Decision Hygiene

Every commercial decision should include:

- the question
- options considered
- evidence
- final choice
- reversal criteria

## Data Hygiene

- Raw API files go under `data/raw/`.
- Processed data goes under `data/processed/`.
- Decisions cite processed outputs and source files.
- If a number cannot be traced, it should not drive spending.

## Deployment Hygiene

- Production secrets live on the server or in a secret manager, not git.
- Deployment scripts must avoid printing secret values.
- Rollback steps should be documented before public launch.


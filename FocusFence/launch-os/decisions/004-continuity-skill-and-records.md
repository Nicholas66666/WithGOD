# Decision 004: Continuity Through Skill And Records

## Decision

Use both repository records and a local Codex Skill to preserve Launch OS continuity across sessions.

## Options Considered

- Rely on chat memory.
- Rely only on repository records.
- Use repository records plus a project-specific Skill.

## Evidence

- Chat history can be compacted or lost.
- Repository files are versioned and auditable.
- A Skill can force future sessions to read Launch OS records before acting.

## Final Choice

Create `focusfence-launch-os` under `/Users/nicho/.codex/skills/focusfence-launch-os` and keep the durable source of truth under `launch-os/`.

## Reversal Criteria

Revisit if the Skill does not trigger reliably in future sessions or if another project-level instruction mechanism becomes more reliable.


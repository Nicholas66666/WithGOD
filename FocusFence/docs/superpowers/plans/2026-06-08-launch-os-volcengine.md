# Launch OS Volcengine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public-ready launch operating system for the Scripture companion launch, with git-managed process records, SEMrush data scripts, a readable dashboard, and Volcengine deployment scaffolding.

**Architecture:** The system starts as a local repo-native `launch-os` workspace with static dashboard rendering from JSON/Markdown data. Deployment uses a single Volcengine ECS host running Docker Compose and Caddy, avoiding Kubernetes until the data and operations surface stabilizes.

**Tech Stack:** Node.js ES modules, static HTML/CSS/JS, JSON/JSONL/Markdown records, Docker Compose, Caddy, Volcengine ECS runbook and environment-driven scripts.

---

### Task 1: Repository Skeleton And Process Templates

**Files:**
- Create: `launch-os/README.md`
- Create: `launch-os/.env.example`
- Create: `launch-os/daily/2026-06-08.md`
- Create: `launch-os/decisions/001-brand-positioning-mature-product.md`
- Create: `launch-os/decisions/002-price-149.md`
- Create: `launch-os/decisions/003-data-source-semrush-first.md`
- Create: `launch-os/docs/git-and-operating-rules.md`

- [ ] **Step 1: Create the workspace skeleton**

Create the directories used by the launch operating system:

```bash
mkdir -p launch-os/{ads,config,dashboard/public,data/raw/semrush,data/processed,daily,decisions,docs,infra/volcengine,research/{competitors,keywords,landing-pages},scripts/{dashboard,semrush}}
```

- [ ] **Step 2: Write the README and templates**

Add concise documentation explaining the source of truth, daily loop, decision log rules, data flow, and deployment responsibilities.

- [ ] **Step 3: Commit**

```bash
git add launch-os docs/superpowers/plans/2026-06-08-launch-os-volcengine.md
git commit -m "chore: add launch operating system skeleton"
```

### Task 2: Dashboard Data Model And Static Renderer

**Files:**
- Create: `launch-os/dashboard/public/index.html`
- Create: `launch-os/dashboard/public/styles.css`
- Create: `launch-os/dashboard/public/app.js`
- Create: `launch-os/data/processed/dashboard-state.json`
- Create: `launch-os/scripts/dashboard/build-dashboard-state.mjs`
- Create: `launch-os/scripts/dashboard/build-dashboard-state.test.mjs`

- [ ] **Step 1: Write failing dashboard-state test**

The test should verify that the builder reads daily notes and decisions and writes a JSON state with `status`, `daily`, `decisions`, and `nextActions`.

- [ ] **Step 2: Run the test and verify it fails**

```bash
node --test launch-os/scripts/dashboard/build-dashboard-state.test.mjs
```

Expected: failure because `buildDashboardState` is not implemented.

- [ ] **Step 3: Implement dashboard-state builder**

Implement a small parser that extracts Markdown headings and decision metadata into `launch-os/data/processed/dashboard-state.json`.

- [ ] **Step 4: Run the dashboard-state test and verify it passes**

```bash
node --test launch-os/scripts/dashboard/build-dashboard-state.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add launch-os/dashboard launch-os/data/processed launch-os/scripts/dashboard
git commit -m "feat: add launch dashboard renderer"
```

### Task 3: SEMrush API Script Framework

**Files:**
- Create: `launch-os/scripts/semrush/semrush-client.mjs`
- Create: `launch-os/scripts/semrush/semrush-client.test.mjs`
- Create: `launch-os/scripts/semrush/fetch-keyword-overview.mjs`
- Create: `launch-os/scripts/semrush/normalize-keywords.mjs`
- Create: `launch-os/config/seed-keywords.json`

- [ ] **Step 1: Write failing SEMrush URL-construction test**

The test should verify that keyword requests include database `us`, phrase, API key, export columns, and display limit without exposing the key in logs.

- [ ] **Step 2: Run the test and verify it fails**

```bash
node --test launch-os/scripts/semrush/semrush-client.test.mjs
```

- [ ] **Step 3: Implement SEMrush client helpers**

Implement URL construction, environment validation, safe logging, and JSON/CSV output paths.

- [ ] **Step 4: Run the SEMrush client test and verify it passes**

```bash
node --test launch-os/scripts/semrush/semrush-client.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add launch-os/scripts/semrush launch-os/config/seed-keywords.json
git commit -m "feat: add semrush keyword research scripts"
```

### Task 4: Volcengine Public Deployment Scaffold

**Files:**
- Create: `launch-os/infra/volcengine/README.md`
- Create: `launch-os/infra/volcengine/docker-compose.yml`
- Create: `launch-os/infra/volcengine/Caddyfile`
- Create: `launch-os/infra/volcengine/deploy.sh`
- Create: `launch-os/infra/volcengine/systemd/launch-os.service`

- [ ] **Step 1: Add deployment files**

Use Docker Compose with a Caddy static web service first. `deploy.sh` must require `VOLCENGINE_ACCESS_KEY_ID`, `VOLCENGINE_SECRET_ACCESS_KEY`, and `VOLCENGINE_REGION` from the environment but must not print secret values.

- [ ] **Step 2: Add runbook**

Document ECS setup, DNS, HTTPS, environment variables, deploy command, rollback, and security expectations.

- [ ] **Step 3: Commit**

```bash
git add launch-os/infra/volcengine
git commit -m "chore: add volcengine deployment scaffold"
```

### Task 5: Verification And Git Hygiene

**Files:**
- Modify: `package.json`
- Create: `launch-os/scripts/verify-launch-os.mjs`

- [ ] **Step 1: Add verification script**

Verify that required files exist, dashboard JSON is valid, `.env.local` is ignored, SEMrush scripts do not contain raw keys, and deployment files exist.

- [ ] **Step 2: Run all Launch OS tests**

```bash
node --test launch-os/scripts/**/*.test.mjs
node launch-os/scripts/verify-launch-os.mjs
```

- [ ] **Step 3: Check git status**

```bash
git status --short
```

- [ ] **Step 4: Commit**

```bash
git add package.json launch-os/scripts/verify-launch-os.mjs
git commit -m "test: add launch os verification"
```

## Self-Review

Spec coverage:
- Public-readable project system: covered by dashboard and Volcengine deployment scaffold.
- Daily process retention: covered by daily and decision templates.
- Local scripts and API records: covered by SEMrush scripts and raw/processed data structure.
- Git from Day 1: covered by branch, plan, git rules, and commit cadence.
- Cloud readiness: covered by ECS/Docker/Caddy runbook and deployment scaffold.

Placeholder scan:
- No implementation placeholders are left as required deliverables. Future API values are environment variables by design.

Type consistency:
- Dashboard builder and tests use `status`, `daily`, `decisions`, `nextActions`.
- SEMrush helper tests and scripts use `SEMRUSH_API_KEY` and `us` database defaults.

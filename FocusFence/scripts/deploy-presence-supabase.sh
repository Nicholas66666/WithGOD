#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/supabase/.env.local"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE"
  echo "Copy supabase/.env.example to supabase/.env.local and fill the values."
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

if [[ -z "${SUPABASE_PROJECT_REF:-}" ]]; then
  echo "Missing SUPABASE_PROJECT_REF in $ENV_FILE"
  exit 1
fi

cd "$ROOT_DIR"
if [[ -n "${SUPABASE_DB_PASSWORD:-}" ]]; then
  supabase link --project-ref "$SUPABASE_PROJECT_REF" --password "$SUPABASE_DB_PASSWORD"
  if [[ -f "$ROOT_DIR/supabase/.temp/pooler-url" ]]; then
    DB_URL="$(node -e 'const fs=require("fs"); const base=fs.readFileSync("supabase/.temp/pooler-url","utf8").trim(); const url=new URL(base); url.password=process.env.SUPABASE_DB_PASSWORD; process.stdout.write(url.toString());')"
    supabase db push --db-url "$DB_URL"
  else
    supabase db push --password "$SUPABASE_DB_PASSWORD"
  fi
else
  supabase link --project-ref "$SUPABASE_PROJECT_REF"
  supabase db push
fi
supabase secrets set --env-file "$ENV_FILE"
if [[ -n "${SUPABASE_SECRET_KEY:-}" ]]; then
  supabase secrets set "PRESENCE_SUPABASE_SECRET_KEY=$SUPABASE_SECRET_KEY"
fi
supabase functions deploy presence-process --no-verify-jwt

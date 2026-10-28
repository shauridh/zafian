#!/usr/bin/env bash
# Wrapper Supabase PRODUCTION: meminta PAT lewat input tersembunyi bila belum
# ada di environment. Token tidak ditulis ke file, history, atau output.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  if [ ! -t 0 ]; then
    echo "✖ SUPABASE_ACCESS_TOKEN kosong dan stdin bukan terminal." >&2
    echo "  Jalankan di terminal: bun run supabase:production" >&2
    exit 1
  fi
  printf 'Masukkan SUPABASE_ACCESS_TOKEN — PAT akun berawalan sbp_ (bukan anon/service key), input tersembunyi: '
  IFS= read -rs token
  printf '\n'
  if [ -z "$token" ]; then
    echo "✖ Token kosong. Batalkan." >&2
    exit 1
  fi
  export SUPABASE_ACCESS_TOKEN="$token"
  unset token
fi

exec bun run scripts/supabase-production.ts "$@"

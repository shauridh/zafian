#!/usr/bin/env bash
# Wrapper Fase 1 hosted: meminta token lewat input tersembunyi, lalu menjalankan
# wizard. Token tidak ditulis ke file, history, atau output.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  if [ ! -t 0 ]; then
    echo "✖ SUPABASE_ACCESS_TOKEN kosong dan stdin bukan terminal." >&2
    echo "  Jalankan di terminal: bun run supabase:hosted" >&2
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

exec bun run scripts/supabase-hosted.ts "$@"

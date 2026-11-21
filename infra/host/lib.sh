#!/usr/bin/env bash
# Shared helpers for the 670Send host scripts (sourced, not executed).

if [[ -t 1 ]]; then C_OK=$'\e[32m'; C_WARN=$'\e[33m'; C_ERR=$'\e[31m'; C_DIM=$'\e[2m'; C_OFF=$'\e[0m'; else C_OK=; C_WARN=; C_ERR=; C_DIM=; C_OFF=; fi
log()  { printf '%s▸%s %s\n' "$C_OK" "$C_OFF" "$*"; }
warn() { printf '%s!%s %s\n' "$C_WARN" "$C_OFF" "$*" >&2; }
die()  { printf '%s✗%s %s\n' "$C_ERR" "$C_OFF" "$*" >&2; exit 1; }
note() { printf '%s  %s%s\n' "$C_DIM" "$*" "$C_OFF"; }

need_root() { [[ $EUID -eq 0 ]] || die "run as root (sudo $0)"; }
have() { command -v "$1" >/dev/null 2>&1; }

# Write a file only when its content changed (keeps the scripts idempotent and the output quiet).
# usage: write_file <path> <mode> <<'EOF' ... EOF
write_file() {
  local path=$1 mode=${2:-0644} tmp
  tmp=$(mktemp)
  cat >"$tmp"
  if [[ -f $path ]] && cmp -s "$tmp" "$path"; then rm -f "$tmp"; chmod "$mode" "$path"; note "unchanged  $path"; return 1; fi
  install -D -m "$mode" "$tmp" "$path"; rm -f "$tmp"; log "wrote      $path"; return 0
}

confirm() { # confirm "question" — non-interactive runs (ASSUME_YES=1) answer yes
  [[ ${ASSUME_YES:-0} == 1 ]] && return 0
  local a; read -r -p "$1 [y/N] " a; [[ $a == [yY]* ]]
}

# Load KEY=VALUE pairs from the production env file without executing it.
env_get() { # env_get KEY [file]
  local key=$1 file=${2:-${ENV_FILE:-/opt/670send/.env}}
  [[ -r $file ]] || return 1
  grep -E "^${key}=" "$file" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//"
}

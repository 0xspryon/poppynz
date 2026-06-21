#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"

if [[ "$#" -eq 0 ]]; then
  printf 'Usage: bun setup:worktree <git worktree add args...>\n' >&2
  printf 'Example: bun setup:worktree -b feature/foo ../feature/foo develop \n' >&2
  exit 1
fi

mapfile -t before_worktrees < <(git worktree list --porcelain | awk '/^worktree / { print substr($0, 10) }')

git pull origin develop
git worktree add "$@"

mapfile -t after_worktrees < <(git worktree list --porcelain | awk '/^worktree / { print substr($0, 10) }')

new_worktree=""
for worktree in "${after_worktrees[@]}"; do
  found=false
  for existing_worktree in "${before_worktrees[@]}"; do
    if [[ "$worktree" == "$existing_worktree" ]]; then
      found=true
      break
    fi
  done

  if [[ "$found" == false ]]; then
    new_worktree="$worktree"
    break
  fi
done

if [[ -z "$new_worktree" ]]; then
  printf 'Could not detect newly created worktree.\n' >&2
  exit 1
fi

copy_env() {
  local source_file="$1"
  local target_file="$2"

  if [[ ! -f "$source_file" ]]; then
    printf 'Missing source env file: %s\n' "$source_file" >&2
    exit 1
  fi

  if [[ -e "$target_file" && ! -L "$target_file" ]]; then
    printf 'Refusing to overwrite existing env file: %s\n' "$target_file" >&2
    exit 1
  fi

  rm -f "$target_file"
  cp "$source_file" "$target_file"
}

link_api_env() {
  local target_file="$1"
  local target_dir
  target_dir="$(dirname "$target_file")"

  if [[ -e "$target_file" && ! -L "$target_file" ]]; then
    printf 'Refusing to overwrite existing env file: %s\n' "$target_file" >&2
    exit 1
  fi

  rm -f "$target_file"
  ln -s "$(realpath --relative-to="$target_dir" "$new_worktree/apps/api/.env")" "$target_file"
}

copy_env "$ROOT_DIR/.env" "$new_worktree/.env"
copy_env "$ROOT_DIR/apps/api/.env" "$new_worktree/apps/api/.env"
copy_env "$ROOT_DIR/apps/web/.env" "$new_worktree/apps/web/.env"

link_api_env "$new_worktree/packages/db/.env"
# link_api_env "$new_worktree/apps/worker/.env"

(
  cd "$new_worktree"
  bun install
)

printf 'Worktree setup complete: %s\n' "$new_worktree"

#!/usr/bin/env bash
# Set or change the marketing.vanis.ai login password.
#
# Run it ON THE VPS:   ssh -t owui bash ~/mra-compose/change-password.sh
#
# Same shape as ~/pa-compose/change-password.sh for agentchat. The password is
# typed at a prompt — it never appears in shell history, in a command line
# visible to `ps`, or in a chat transcript. Only its scrypt hash reaches disk.
set -euo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-$HOME/mra-compose}"
ENV_FILE="$COMPOSE_DIR/.env"
[ -f "$ENV_FILE" ] || { echo "no .env at $ENV_FILE" >&2; exit 1; }

read -rsp "New password: " PASSWORD; echo
read -rsp "Confirm:      " CONFIRM; echo
[ -n "$PASSWORD" ] || { echo "empty password" >&2; exit 1; }
[ "$PASSWORD" = "$CONFIRM" ] || { echo "passwords do not match" >&2; exit 1; }
[ ${#PASSWORD} -ge 12 ] || { echo "use at least 12 characters" >&2; exit 1; }

# Hash inside the app image, so the algorithm always matches the running code.
HASH=$(printf '%s' "$PASSWORD" | docker run --rm -i --entrypoint node mra:latest \
        --input-type=module -e "
          import { hashPassword } from '/app/dist/auth.js';
          let input = '';
          for await (const chunk of process.stdin) input += chunk;
          console.log(await hashPassword(input));
        ")
unset PASSWORD CONFIRM
case "$HASH" in scrypt:*) ;; *) echo "unexpected hash format" >&2; exit 1;; esac

cp "$ENV_FILE" "$ENV_FILE.bak.$(date +%Y%m%d_%H%M%S)"

read -rp "Also sign out all existing sessions? [y/N] " ROTATE
python3 - "$ENV_FILE" "$HASH" "${ROTATE:-n}" <<'PY'
import secrets, sys, pathlib
env_path, new_hash, rotate = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3].lower()
lines, seen = [], False
for line in env_path.read_text().splitlines():
    if line.startswith("MRA_APP_PASSWORD_HASH="):
        line, seen = f"MRA_APP_PASSWORD_HASH={new_hash}", True
    elif line.startswith("MRA_JWT_SECRET=") and rotate.startswith("y"):
        line = f"MRA_JWT_SECRET={secrets.token_hex(32)}"
    lines.append(line)
if not seen:
    lines.append(f"MRA_APP_PASSWORD_HASH={new_hash}")
env_path.write_text("\n".join(lines) + "\n")
print("  .env updated" + ("  (MRA_JWT_SECRET rotated — every session signed out)" if rotate.startswith("y") else ""))
PY
chmod 600 "$ENV_FILE"

cd "$COMPOSE_DIR"
docker compose up -d >/dev/null
echo "  restarted; waiting for health…"
for _ in $(seq 1 20); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' mra 2>/dev/null)" = healthy ] && break
  sleep 3
done
echo
echo "Done. Sign in at https://marketing.vanis.ai with the new password."
echo "Note: restarting mra ends any research run that was in progress."

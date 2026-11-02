#!/usr/bin/env bash
# Stores the two secrets the API needs. Each is typed at a hidden prompt: nothing is
# written to disk, the shell history or this repository.
#
#   scripts/ops/set-secrets.sh
#
# Use "off" for TURNSTILE_SECRET_KEY if you are not using the bot check.
set -euo pipefail
project="${GCLOUD_PROJECT:-esspordecants}"
for name in PAYSTACK_SECRET_KEY TURNSTILE_SECRET_KEY; do
  printf 'Value for %s (input hidden): ' "$name"
  read -rs value
  echo
  printf '%s' "$value" | firebase functions:secrets:set "$name" --project "$project" --data-file=-
done
echo "Done. Now deploy the function once by hand: firebase deploy --only functions --project $project"

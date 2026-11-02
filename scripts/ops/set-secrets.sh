#!/usr/bin/env bash
# Stores a key in Google Secret Manager and lets the API read it. The key is typed at a
# hidden prompt: nothing is written to disk, the shell history or this repository.
#
#   scripts/ops/set-secrets.sh paystack     # your Paystack secret key (test first, live later)
#   scripts/ops/set-secrets.sh turnstile    # your Cloudflare Turnstile secret key (optional)
#
# Run it as someone who owns the Google Cloud project. It enables the Secret Manager API
# (a few cents a month at most for two secrets), stores the key, and allows the API's own
# identity to read that one secret. Afterwards, add the line it prints to
# apps/api/.env.esspordecants and deploy. Run it again to replace the key (a new version).
set -euo pipefail
project="${GCLOUD_PROJECT:-esspordecants}"
runtime="esspor-api@${project}.iam.gserviceaccount.com"
case "${1:-}" in
  paystack) name="paystack-secret-key"; variable="PAYSTACK_SECRET_NAME" ;;
  turnstile) name="turnstile-secret-key"; variable="TURNSTILE_SECRET_NAME" ;;
  *) echo "Usage: set-secrets.sh paystack|turnstile" >&2; exit 1 ;;
esac

gcloud services enable secretmanager.googleapis.com --project "$project"
printf 'Value for %s (input hidden): ' "$name"
read -rs value
echo
if gcloud secrets describe "$name" --project "$project" >/dev/null 2>&1; then
  printf '%s' "$value" | gcloud secrets versions add "$name" --project "$project" --data-file=-
else
  printf '%s' "$value" | gcloud secrets create "$name" --project "$project" --replication-policy=automatic --data-file=-
fi
gcloud secrets add-iam-policy-binding "$name" --project "$project" \
  --member="serviceAccount:${runtime}" --role="roles/secretmanager.secretAccessor" >/dev/null
echo
echo "Stored. Now add this line to apps/api/.env.esspordecants and deploy (git push):"
echo "  ${variable}=${name}"
echo "A running function reads the key when it starts, so a replaced key takes effect after the next deploy."

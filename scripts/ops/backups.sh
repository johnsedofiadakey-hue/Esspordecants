#!/usr/bin/env bash
# Turns on automatic daily Firestore backups, kept for 14 days, and point-in-time recovery
# (restore to any minute in the last 7 days). Orders cannot be recreated, so this is the
# one thing worth paying a little for. Not run by anyone yet.
#
#   scripts/ops/backups.sh
set -euo pipefail
project="${GCLOUD_PROJECT:-esspordecants}"
gcloud firestore backups schedules create \
  --project="$project" --database='(default)' \
  --recurrence=daily --retention=14d
gcloud firestore databases update \
  --project="$project" --database='(default)' \
  --enable-pitr
echo "Backups scheduled. List them with: gcloud firestore backups list --project=$project"

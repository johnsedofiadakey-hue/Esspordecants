#!/usr/bin/env bash
# Creates a monthly billing budget with email alerts at 50%, 90% and 100%.
# A budget only ALERTS; it does not stop spending. Not run by anyone yet.
#
#   scripts/ops/budget.sh BILLING_ACCOUNT_ID 25
#
# Find the billing account id with: gcloud billing accounts list
set -euo pipefail
account="${1:?Usage: budget.sh BILLING_ACCOUNT_ID MONTHLY_AMOUNT_USD}"
amount="${2:?Usage: budget.sh BILLING_ACCOUNT_ID MONTHLY_AMOUNT_USD}"
gcloud billing budgets create \
  --billing-account="$account" \
  --display-name="Esspor monthly" \
  --budget-amount="${amount}USD" \
  --filter-projects="projects/esspordecants" \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=0.9 \
  --threshold-rule=percent=1.0
echo "Budget created. Alerts go to the billing account's admins."

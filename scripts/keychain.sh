#!/bin/bash
# Stores Lock In's launcher/CLI credentials in the login Keychain (service "lockin").
# Secrets are never passed in argv: `security ... -w` with no value prompts for the
# password itself (hidden, asked twice) and re-saves over any existing item (-U).
set -euo pipefail

store() {
  local account="$1" label="$2"
  echo "$label"
  security add-generic-password -U -s lockin -a "$account" -T /usr/bin/security -w
  echo "Saved $account."
}

store supabase_url "Supabase URL (https://<ref>.supabase.co) - enter it at the prompt below:"
store service_key "Supabase service-role key - enter it at the prompt below:"
store owner_id "Owner user id (LOCKIN_OWNER_ID) - enter it at the prompt below:"

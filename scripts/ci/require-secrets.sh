#!/usr/bin/env bash
# Fails a workflow step early, naming every setting that's missing and where to add it, so a job
# can't fail quietly for weeks because a secret was never set. Values are never printed.
#
# Usage: scripts/ci/require-secrets.sh "<where to add them>" NAME...
#   e.g. scripts/ci/require-secrets.sh "Settings → Environments → backup → Environment secrets" R2_BUCKET
# Each NAME must be passed to the step as an environment variable of the same name.
set -euo pipefail

where="${1:?usage: require-secrets.sh \"<where to add them>\" NAME...}"
shift

missing=0
for name in "$@"; do
  if [ -z "${!name:-}" ]; then
    line="${name} is not set. Add it in ${where}."
    echo "::error title=Missing setting::${line}"
    if [ -n "${RUNNER_TEMP:-}" ]; then echo "$line" >> "$RUNNER_TEMP/alert.txt"; fi
    missing=$((missing + 1))
  fi
done

if [ "$missing" -gt 0 ]; then
  exit 1
fi
echo "Found all $# settings for ${where}."

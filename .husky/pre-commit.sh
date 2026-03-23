#!/bin/sh

if git diff --cached --name-only --diff-filter=ACMR | grep -qE '\.(js|jsx|ts|tsx|json|css|md|yml|yaml)$'; then
  pnpm -r stylecheck --write
else
  echo "No files matching lint-staged patterns, skipping..."
fi

#!/usr/bin/env bash
# Renders the Mermaid diagrams to PNG + SVG using @mermaid-js/mermaid-cli.
# Requires: Node.js + npx (npm 7+). Internet access for the first run only.
#
# Usage:  ./render-diagrams.sh
# Output: <name>.png and <name>.svg next to each <name>.md
#         (Multi-block .md files produce numbered outputs: -1.png, -2.png, etc.)

set -e
cd "$(dirname "$0")"

CONFIG="mermaid-config.json"
SOURCES=(01-system-architecture.md 02-user-flow-sequence.md 03-langgraph-workflows.md)

for src in "${SOURCES[@]}"; do
  base="${src%.md}"
  echo "→ ${src} → ${base}.png + ${base}.svg"
  npx -y -p @mermaid-js/mermaid-cli mmdc \
    -i "${src}" -o "${base}.png" -c "${CONFIG}" -b transparent -w 1800
  npx -y -p @mermaid-js/mermaid-cli mmdc \
    -i "${src}" -o "${base}.svg" -c "${CONFIG}" -b transparent
done

echo
echo "✓ Done. Renders written to $(pwd)"
ls -1 *.png *.svg 2>/dev/null

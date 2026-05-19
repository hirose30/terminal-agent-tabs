#!/bin/bash
# Build and package the plugin for distribution
set -e

cd "$(dirname "$0")/.."

# Build the plugin
echo "Building plugin..."
npm run build

# Create distribution package
PLUGIN_ID="terminal-agent-tabs"
VERSION=$(grep '"version"' manifest.json | sed 's/.*: "\(.*\)".*/\1/')
ZIP_NAME="${PLUGIN_ID}-${VERSION}.zip"

echo "Creating ${ZIP_NAME}..."

# Remove old zip if exists
rm -f "${ZIP_NAME}"

# Create zip with required files
zip -r "${ZIP_NAME}" \
    main.js \
    manifest.json \
    styles.css \
    resources/

echo "Done! Created ${ZIP_NAME}"
echo ""
echo "Contents:"
unzip -l "${ZIP_NAME}"

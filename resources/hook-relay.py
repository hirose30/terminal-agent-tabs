#!/usr/bin/env python3
"""
Hook relay for Claude Code → Obsidian plugin.
Reads JSON from stdin (sent by Claude Code hooks),
adds the hook type, and appends to a JSONL file.

Usage: python3 hook-relay.py <hook_type> <output_file>
"""

import sys
import json
import os


def main():
    if len(sys.argv) < 3:
        sys.exit(1)

    hook_type = sys.argv[1]
    output_file = sys.argv[2]

    try:
        data = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        data = {}

    if not isinstance(data, dict):
        data = {"raw": data}

    data["hook"] = hook_type

    # Ensure directory exists
    output_dir = os.path.dirname(output_file)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)

    with open(output_file, "a") as f:
        f.write(json.dumps(data) + "\n")


if __name__ == "__main__":
    main()

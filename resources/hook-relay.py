#!/usr/bin/env python3
"""
Hook relay for Claude Code → Obsidian plugin.
Reads JSON from stdin (sent by Claude Code hooks),
adds the hook type, and appends to a JSONL file.

Usage: python3 hook-relay.py <hook_type> <output_file> [--tat-session <id>]

--tat-session embeds the plugin-side session id as tat_session_id, so the
plugin can link the event to its tab deterministically even when Claude's
own session_id differs (e.g. resumed sessions fork to a new id). Omitting
it keeps the legacy output format.
"""

import sys
import json
import os


def main():
    tat_session_id = None
    positional = []
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--tat-session":
            if i + 1 < len(args):
                tat_session_id = args[i + 1]
            i += 2
            continue
        positional.append(args[i])
        i += 1

    if len(positional) < 2:
        sys.exit(1)

    hook_type = positional[0]
    output_file = positional[1]

    try:
        data = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        data = {}

    if not isinstance(data, dict):
        data = {"raw": data}

    data["hook"] = hook_type
    if tat_session_id:
        data["tat_session_id"] = tat_session_id

    # Ensure directory exists
    output_dir = os.path.dirname(output_file)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)

    with open(output_file, "a") as f:
        f.write(json.dumps(data) + "\n")


if __name__ == "__main__":
    main()

#!/bin/bash
# Emits the file named by FAKE_CLAUDE_OUTPUT, or after the first call the file
# named by FAKE_CLAUDE_OUTPUT_2 if set (call count kept in FAKE_CLAUDE_COUNTER file).
count_file="${FAKE_CLAUDE_COUNTER:-/tmp/fake-claude-count}"
n=$(cat "$count_file" 2>/dev/null || echo 0)
echo $((n + 1)) > "$count_file"
if [ "$n" -ge 1 ] && [ -n "$FAKE_CLAUDE_OUTPUT_2" ]; then
  cat "$FAKE_CLAUDE_OUTPUT_2"
else
  cat "$FAKE_CLAUDE_OUTPUT"
fi

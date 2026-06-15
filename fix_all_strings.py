"""Fix all unterminated string literals in chat.ts caused by CRLF in string literals."""
import sys
sys.stdout.reconfigure(encoding='utf-8')

with open('src/webui/chat.ts', 'rb') as f:
    data = f.read()

# Find ALL instances of literal CRLF inside single-quoted strings
# Pattern: ' \r \n  (quote + CR + LF inside a string)
import re

# Strategy: Find all positions where a ' is followed by \r before the closing '
# These are broken strings where \n was used as escape but became literal newlines

# Simpler approach: find all ' followed by \r or \n
# within what should be a string literal context
fixes = []
i = 0
while i < len(data):
    if data[i:i+1] == b"'":
        # Check if this ' is followed by \r or \n (indicating unterminated)
        if i+1 < len(data) and data[i+1] in (0x0D, 0x0A):
            # Find the closing ' on a subsequent line
            j = i + 1
            while j < len(data):
                if data[j:j+1] == b"'":
                    # This might be the closing quote
                    # Check that there's only whitespace between
                    middle = data[i+1:j]
                    if all(b in (0x0D, 0x0A, 0x20, 0x09) for b in middle):
                        # Found a broken string literal! Replace it
                        fixes.append((i, j))
                        i = j
                        break
                j += 1
            else:
                i += 1
                continue
        elif data[i-1:i] == b'=' and i+1 < len(data) and data[i+1:i+2] == b"'":
            # This is already a '' empty string, skip
            i += 1
        else:
            i += 1
    else:
        i += 1

print(f"Found {len(fixes)} unterminated string literals")
for start, end in fixes:
    context = data[max(0, start-20):end+20]
    print(f"  pos {start}: ...{context!r}...")

# Apply fixes
for start, end in reversed(fixes):
    # Replace the ' \r... ' with ' ' (empty string) or with appropriate content
    # The original intent was \n as escape sequence
    middle = data[start+1:end]
    # Count how many \r\n pairs there are
    newline_count = middle.count(b'\r\n')
    replacement = b"'" + b'\\n' * newline_count + b"'"
    print(f"  Replacing at {start}: {data[start:end+1]!r} -> {replacement!r}")
    data = data[:start] + replacement + data[end+1:]

with open('src/webui/chat.ts', 'wb') as f:
    f.write(data)
print(f"Done. Fixed {len(fixes)} instances.")

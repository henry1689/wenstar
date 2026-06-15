"""Fix unterminated string literals in chat.ts."""
import sys

with open('src/webui/chat.ts', 'rb') as f:
    data = f.read()

# Strategy: find all cases where a single quote is followed by \r or \n
# and the content between quotes spans multiple lines with only whitespace
# Then replace with escaped \n sequences

result = bytearray()
i = 0
fix_count = 0

while i < len(data):
    # Look for a single quote that starts a string
    if data[i:i+1] == b"'" and i > 0:
        # Check if previous non-whitespace char suggests this is a string start
        prev = data[max(0, i-20):i]
        prev_text = prev.decode('utf-8', errors='replace')

        # Check if the NEXT char after quote is \r or \n (broken string)
        if i+1 < len(data) and data[i+1] in (0x0D, 0x0A):
            # This is likely a broken string literal
            # Find the closing quote
            j = i + 1
            while j < len(data):
                if data[j:j+1] == b"'":
                    # Check content between quotes
                    middle = data[i+1:j]
                    # Count newlines
                    lf_count = middle.count(b'\n')
                    if lf_count > 0 and all(b in (0x0D, 0x0A, 0x20, 0x09) for b in middle):
                        # It's a broken escape. Replace with '\\n' * count
                        result.extend(b"'" + b'\\n' * lf_count + b"'")
                        i = j + 1
                        fix_count += 1
                        break
                    else:
                        # Normal string, copy as-is
                        result.append(data[i])
                        i += 1
                        break
                j += 1
            else:
                # No closing quote found, copy as-is
                result.append(data[i])
                i += 1
        else:
            result.append(data[i])
            i += 1
    else:
        result.append(data[i])
        i += 1

data = bytes(result)
print(f"Fixed {fix_count} unterminated string literals")

with open('src/webui/chat.ts', 'wb') as f:
    f.write(data)

# Count how many cases of unterminated strings remain
# by checking for single quotes followed by \r or \n
remaining = data.count(b"'\r") + data.count(b"'\n")
print(f"Remaining potential issues: {remaining}")

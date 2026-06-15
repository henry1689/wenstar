import sys
sys.stdout.reconfigure(encoding='utf-8')

with open('src/webui/chat.ts', 'rb') as f:
    data = f.read()

# Fix 1: Replace literal CRLF inside quoted string with escaped \n\n
old = bytes([0x27, 0x0D, 0x0A, 0x0D, 0x0A, 0x27])  # '\r\n\r\n'
new = bytes([0x27, 0x5C, 0x6E, 0x5C, 0x6E, 0x27])  # '\\n\\n'

count = data.count(old)
print(f'Found {count} instances of CRLF in quotes')
data = data.replace(old, new)

# Also check for: '\n\n' (LF only without CR)
old2 = bytes([0x27, 0x0A, 0x0A, 0x27])  # '\n\n'
new2 = bytes([0x27, 0x5C, 0x6E, 0x5C, 0x6E, 0x27])  # '\\n\\n'
count2 = data.count(old2)
print(f'Found {count2} instances of LF in quotes')
data = data.replace(old2, new2)

with open('src/webui/chat.ts', 'wb') as f:
    f.write(data)

# Verify
idx = data.find(b'finalKnowledgeText = innerThought')
if idx >= 0:
    chunk = data[idx+55:idx+70]
    print(f'Hex: {chunk.hex()}')
    print(f'Bytes: {list(chunk)}')
    if chunk[2:4] == b'\\n':
        print('SUCCESS: correctly escaped')
    elif chunk[2:4] == b'\n':
        print('FAILED: still literal newlines')
    else:
        print(f'UNKNOWN: {chunk[2:4]}')
PYEOF
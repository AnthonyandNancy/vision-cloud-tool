import zstandard
import io
import sys
import json

path = sys.argv[1]
with open(path, "rb") as f:
    raw = f.read()
reader = zstandard.ZstdDecompressor().stream_reader(io.BytesIO(raw))
text = reader.read().decode("utf-8", errors="replace")
for i, line in enumerate(text.splitlines(), 1):
    try:
        ev = json.loads(line)
        t = ev.get("type")
        if t == "chat/message" or t == "user/message" or (t == "assistant/message"):
            content = ev.get("data", {}).get("message", {}).get("content")
            print(f"--- L{i} {t} seq={ev.get('seq')} ---")
            print(json.dumps(content, ensure_ascii=False)[:1500])
        elif t == "turn/begin" or t == "turn/end":
            print(f"--- L{i} {t} seq={ev.get('seq')} reason={json.dumps(ev.get('data',{}).get('reason', ev.get('data')), ensure_ascii=False)[:300]}")
    except Exception:
        print(f"--- L{i} raw ---")
        print(line[:600])
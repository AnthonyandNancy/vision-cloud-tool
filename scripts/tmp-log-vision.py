import zstandard
import io
import sys
import json
import re

path = sys.argv[1]
raw = open(path, "rb").read()
text = zstandard.ZstdDecompressor().stream_reader(io.BytesIO(raw)).read().decode("utf-8", "replace")
for i, line in enumerate(text.splitlines(), 1):
    try:
        ev = json.loads(line)
    except Exception:
        continue
    t = ev.get("type")
    d = ev.get("data", {})
    if t == "tool/call":
        name = d.get("name")
        if name == "vision_cloud_tool":
            print(f"L{i} TOOL-CALL vision_cloud_tool args={d.get('arguments','')[:260]}")
    elif t == "tool/result":
        msg = d.get("message", {})
        src = msg.get("source", {})
        if src.get("callId") and "vision" in msg.get("content", "")[0:0] or src.get("kind") == "tool":
            content = json.dumps(msg.get("content"), ensure_ascii=False)
            if "evidence" in content or "summary" in content or "transcription" in content:
                print(f"L{i} TOOL-RESULT (vision evidence): {content[:400]}")
    elif t == "assistant/message":
        msg = d.get("message", {})
        content = json.dumps(msg.get("content"), ensure_ascii=False)
        if "vision" in content.lower() or "tool-call" in content:
            print(f"L{i} ASSISTANT: {content[:320]}")
    elif t == "user/message":
        content = json.dumps(d.get("content"), ensure_ascii=False)
        if "Pasted image" in content:
            print(f"L{i} USER (bridged): {content[:260]}")
import zstandard
import io
import sys
import os

for path in sys.argv[1:]:
    print(f"==== {os.path.basename(os.path.dirname(path))} ({os.path.getsize(path)} bytes) ====")
    try:
        with open(path, "rb") as f:
            raw = f.read()
        reader = zstandard.ZstdDecompressor().stream_reader(io.BytesIO(raw))
        data = reader.read()
        text = data.decode("utf-8", errors="replace")
        lines = text.splitlines()
        print(f"decompressed: {len(data)} bytes, {len(lines)} lines")
        err = [l for l in lines if ("UNSUPPORTED_CONTENT" in l or "does not support image" in l)]
        print(f"error lines: {len(err)}")
        for l in err[:2]:
            print("  ERR>", l[:500].replace("\u0000", " ").replace("\n", " "))
        img = sum(l.count('"type":"image"') for l in lines)
        print(f'"type":"image" occurrences: {img}')
        flash = [i for i, l in enumerate(lines) if "DeepSeek-V4-Flash-0731" in l]
        print(f"Flash-0731 lines: {len(flash)}")
        for i in flash[-4:]:
            print(f"  F{i}>", lines[i][:300].replace("\u0000", " ").replace("\n", " "))
    except Exception as e:
        print("  FAILED:", repr(e))
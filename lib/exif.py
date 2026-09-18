"""Strip JPEG APP1/APP2 and PNG text/EXIF chunks. Lockstep with pb/pb_hooks/exif.js."""

from __future__ import annotations


def strip_jpeg(data: bytes) -> bytes:
    if len(data) < 4 or data[:2] != b"\xff\xd8":
        return data
    out = bytearray(b"\xff\xd8")
    i = 2
    while i < len(data) - 1:
        if data[i] != 0xFF:
            out.extend(data[i:])
            break
        marker = data[i + 1]
        if marker == 0xDA:
            out.extend(data[i:])
            break
        if marker == 0xD9:
            out.extend(b"\xff\xd9")
            break
        if i + 3 >= len(data):
            break
        length = (data[i + 2] << 8) | data[i + 3]
        skip = marker in (0xE1, 0xE2)
        if not skip:
            out.extend(data[i : i + length + 2])
        i += length + 2
    return bytes(out)


def strip_png(data: bytes) -> bytes:
    sig = b"\x89PNG\r\n\x1a\n"
    if not data.startswith(sig):
        return data
    out = bytearray(sig)
    i = 8
    while i + 12 <= len(data):
        length = int.from_bytes(data[i : i + 4], "big")
        typ = data[i + 4 : i + 8]
        total = 12 + length
        if i + total > len(data):
            break
        if typ not in (b"eXIf", b"iTXt", b"tEXt", b"zTXt"):
            out.extend(data[i : i + total])
        i += total
        if typ == b"IEND":
            break
    return bytes(out)


def strip_exif(data: bytes) -> bytes:
    if data[:2] == b"\xff\xd8":
        return strip_jpeg(data)
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return strip_png(data)
    return data

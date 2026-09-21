from __future__ import annotations

import json
import urllib.error
import urllib.request


def request(base: str, method: str, path: str, token: str | None = None, body=None):
    # Event signup cannot invent a team. Tests that still pass team_name
    # create the master row first, then send its id.
    if (
        method == "POST"
        and isinstance(path, str)
        and path.rstrip("/").endswith("/signup")
        and token
        and isinstance(body, dict)
        and not body.get("team_id")
        and not body.get("team_slug")
        and (body.get("team_name") or body.get("name"))
    ):
        master = request(base, "POST", "/api/teams", token, {
            "name": body.get("team_name") or body.get("name"),
            "age_group": body.get("age_group") or "",
        })
        body = dict(body)
        body["team_id"] = master["id"]
    data = None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = token
    if body is not None:
        data = json.dumps(body).encode()
    req = urllib.request.Request(base.rstrip("/") + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read()
            return json.loads(raw.decode()) if raw else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode()
        raise RuntimeError(f"{method} {path} -> {exc.code}: {detail}") from exc


def request_multipart(base: str, path: str, token: str | None, fields: dict, files: dict | None = None):
    boundary = "----DiamondBoundary7MA4YWxkTrZu0gW"
    chunks = []
    for key, value in (fields or {}).items():
        chunks.append(f"--{boundary}\r\n".encode())
        chunks.append(f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode())
        chunks.append(str(value).encode() + b"\r\n")
    for key, (filename, content, ctype) in (files or {}).items():
        chunks.append(f"--{boundary}\r\n".encode())
        chunks.append(
            f'Content-Disposition: form-data; name="{key}"; filename="{filename}"\r\n'
            f"Content-Type: {ctype}\r\n\r\n".encode()
        )
        chunks.append(content if isinstance(content, bytes) else content.encode())
        chunks.append(b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode())
    data = b"".join(chunks)
    headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
    if token:
        headers["Authorization"] = token
    req = urllib.request.Request(base.rstrip("/") + path, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read()
            return json.loads(raw.decode()) if raw else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode()
        raise RuntimeError(f"POST {path} -> {exc.code}: {detail}") from exc


def auth(base: str, email: str, password: str, collection: str = "users") -> str:
    out = request(base, "POST", f"/api/collections/{collection}/auth-with-password", None, {
        "identity": email,
        "password": password,
    })
    return out["token"]

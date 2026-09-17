from __future__ import annotations

import json
import urllib.error
import urllib.request


def request(base: str, method: str, path: str, token: str | None = None, body=None):
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


def auth(base: str, email: str, password: str, collection: str = "users") -> str:
    out = request(base, "POST", f"/api/collections/{collection}/auth-with-password", None, {
        "identity": email,
        "password": password,
    })
    return out["token"]

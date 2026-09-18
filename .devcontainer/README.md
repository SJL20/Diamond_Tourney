# Dev container

Opens this repo in VS Code / GitHub Codespaces with PocketBase 0.40 on the host OS that Codespaces actually is (the install script maps `uname`, so a Mac laptop is `darwin_arm64` and this Linux container is `linux_amd64`).

Port **8097** is forwarded. After create/start:

- Public board: http://127.0.0.1:8097
- Local logins: `scripts/local-accounts.txt`

The Cloud Agent boot path (`.cursor/environment.json`) already does the same install + `ensure-pocketbase.sh` and must keep returning after the listener is healthy.

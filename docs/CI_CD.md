# CI/CD

Rukh deploys automatically to production on every merge to `main`. The VPS
pulls and rebuilds itself on a GitHub webhook — no SSH key is ever stored in
GitHub, which keeps the blast radius small if the repo or Actions runner is
ever compromised.

## How it works

1. A push lands on `main` (merge of a pull request).
2. GitHub sends a webhook event to the VPS.
3. [`webhook`](https://github.com/adnanh/webhook) (running as a systemd
   service, bound to `127.0.0.1`) verifies the payload signature and that the
   ref is `refs/heads/main`, then runs the deploy script.
4. The script pulls the new code, reinstalls dependencies, rebuilds, and
   reloads the app under [pm2](https://pm2.keymetrics.io/).

## VPS setup

### 1. Deploy script

```bash
sudo mkdir -p /opt/deploy && sudo chown $USER:$USER /opt/deploy
```

`/opt/deploy/deploy-rukh.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd /home/$USER/rukh
git fetch origin main
git reset --hard origin/main
pnpm install --frozen-lockfile
pnpm build
pm2 reload rukh --update-env
```

```bash
chmod +x /opt/deploy/deploy-rukh.sh
```

### 2. Webhook listener

Install [`webhook`](https://github.com/adnanh/webhook):

```bash
sudo apt install webhook
```

`/home/$USER/hooks.json`:

```json
[
  {
    "id": "deploy-rukh",
    "execute-command": "/opt/deploy/deploy-rukh.sh",
    "response-message": "deploying",
    "trigger-rule": {
      "and": [
        {
          "match": {
            "type": "payload-hash-sha256",
            "secret": "REPLACE_ME",
            "parameter": { "source": "header", "name": "X-Hub-Signature-256" }
          }
        },
        {
          "match": {
            "type": "value",
            "value": "refs/heads/main",
            "parameter": { "source": "payload", "name": "ref" }
          }
        }
      ]
    }
  }
]
```

Generate the secret with `openssl rand -hex 32` and use the same value on
the GitHub side (step 5).

### 3. systemd service

`/etc/systemd/system/webhook.service`:

```ini
[Unit]
Description=GitHub webhook listener
After=network.target

[Service]
ExecStart=/usr/bin/webhook -hooks /home/YOUR_USER/hooks.json -ip 127.0.0.1 -port 9000 -verbose
Restart=always
User=YOUR_USER

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now webhook
```

The listener only binds to `127.0.0.1` — it is never reachable directly from
the internet, only through the reverse proxy below.

### 4. Nginx reverse proxy

Add to the existing vhost (HTTPS only):

```nginx
location /hooks/deploy-rukh {
    proxy_pass http://127.0.0.1:9000/hooks/deploy-rukh;
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 5. GitHub webhook

Repo → **Settings → Webhooks → Add webhook**:

- Payload URL: `https://your-domain/hooks/deploy-rukh`
- Content type: `application/json`
- Secret: same value as `REPLACE_ME` in `hooks.json`
- Events: **Just the push event**

## Why pull, not push

A push-based setup (GitHub Actions SSHing into the VPS) requires storing a
private key as a repository secret. If that secret or the Actions runner is
ever compromised, an attacker gets direct SSH access to production. The
pull-based setup here keeps the VPS in control: it only reacts to an
HMAC-signed webhook restricted to `main`, and no credential capable of
reaching the server ever leaves it.

See [CLAUDE.md](../.claude/CLAUDE.md) for where the app runs.

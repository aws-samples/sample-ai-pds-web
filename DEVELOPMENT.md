# Developing AI-PDS Web

[한국어](DEVELOPMENT.ko.md) | **English**

Running the app locally, its environment variables, the tests, and how screen access is enforced. For
what AI-PDS is and how to deploy it, see the [README](README.md).

## Screens and who can open them

The frontend middleware is only a UX gate — **the security boundary is the backend's `require_admin` /
`require_user` / `require_project_access`.** The public-path list is asserted from both sides
(`frontend/lib/auth/gate.ts` and `backend/tests/test_auth_route_coverage.py`).

A project has one owner and any number of viewing members. The owner and administrators read and
change it; members only read; to anyone else it is a 404, the same as a project that does not exist
(`backend/aipds/project_access.py`). That is the *project* access below.

| Screen | What it does | Access |
|---|---|---|
| `/` | The projects you own or view (all of them for an admin), creation, export and import | logged in |
| `/projects/{id}/workspace` | The Discovery conversation — live turns, question sheets, attachments, the generated-document drawer | project |
| `/projects/{id}/dashboard` | Stage progress, artifacts, activity | project |
| `/projects/{id}/review` | Document review and the approval gate | project |
| `/projects/{id}/questions` | One question file, expanded to answer | project |
| `/projects/{id}/prototypes` | Build sessions, hosting, and the validation survey | project |
| `/projects/{id}/handoff` | The AI-DLC handoff — readiness, supplementary questions, confirming AI suggestions, and the package (vision document, decision ledger, start prompt) as a zip | project |
| `/survey/{token}` | The anonymous validation survey | **public** (token) |
| `/api/proto/{pid}/{slug}` | The built prototype, served **only on the preview domain** (`AipdsPreviewStack`). The share link plants the access cookie; without it, 404 is the correct answer | **public** (token cookie) |
| `/admin/users` · `/admin/models` · `/admin/design` | Users and roles, the model catalog, the brand design profile | admin |
| `/manual` | The manual. It sits in front of the login so you can read what the tool does before you have an account | **public** |

## Running locally

Frontend (:3000) → backend (:8000) → the agent calls Bedrock. You still need the bucket and role, so
deploy `AipdsDrillStack` first. Python **3.11** and Node.js 20+.

```bash
git submodule update --init --recursive
cd backend && python3.11 -m venv .venv && .venv/bin/pip install -e ".[dev]"
cd ../frontend && npm install
cp ../backend/.env.example ../backend/.env           # fill in from the DrillStack outputs

cd backend && .venv/bin/python -m uvicorn aipds.app:app --host 127.0.0.1 --port 8000 --reload
cd frontend && npm run dev                           # http://localhost:3000
```

Locally, agents run directly as your user — the sandbox is an instance feature. With authentication off, the backend treats every request as an admin, so keep it on `127.0.0.1`.

| Variable | Set it to |
|---|---|
| `AIPDS_S3_BUCKET` / `AIPDS_S3_REGION` | `AipdsDrillStack.ArtifactsBucketName` and its region. Unset, the app silently runs local-only |
| `AIPDS_DISCOVERY_CONFIG_DIR` / `AIPDS_PROTO_CONFIG_DIR` | Absolute paths to the repo's `discovery-config/` and `proto-config/`. Unset, the agent reads **your own `~/.claude`** and your personal skills leak into the results |
| `ANTHROPIC_MODEL` | Fallback Bedrock inference profile id, used when a project has none |
| `AIPDS_COGNITO_USER_POOL_ID` / `AIPDS_COGNITO_CLIENT_ID` | Leave **both** empty and set `AIPDS_AUTH_DISABLED=1` to skip authentication (the local default in `.env.example`). Both empty without that switch, or only one set, and the backend refuses to start |
| `AIPDS_PUBLIC_PATH_PREFIX` | `""` when the browser calls the backend directly on :8000 |

Every other variable, with the value a deployment uses and why, is commented in the systemd units in
[`infra/lib/user-data.ts`](infra/lib/user-data.ts); defaults live in the code that reads them
(`backend/aipds/app.py`, `backend/aipds/cli_settings.py`).

**If the browser is remote** (behind a proxy hostname rather than `localhost`), calls to
`localhost:8000` hit the browser's own machine. Put `NEXT_PUBLIC_API_BASE_URL=/api` in
`frontend/.env.local` so the Next route handler proxies to the backend (`AIPDS_BACKEND_URL`, default
`http://localhost:8000`), and add the hostname to `allowedDevOrigins` in `next.config.mjs`.

## Tests

```bash
cd backend && .venv/bin/python -m pytest -q     # backend unit (no AWS needed)
cd frontend && npm test                         # frontend unit (Vitest + MSW)
cd infra && npm test                            # synth + template assertions (no deployment)
cd frontend && npm run test:e2e                 # e2e (needs a real backend and Bedrock)
```

| Run this | When you touched |
|---|---|
| `npm test -- noHardcodedKorean` | UI strings — catches Korean literals that bypass the dictionary |
| `npm test -- parity` | The manual — catches ko/en drifting apart in structure or anchors |
| `pytest -q -k sdk_available` | The `claude-agent-sdk` version — checks the option fields and the bundled binary |
| `pytest -q -k no_legacy_brand` | Anything with the product name in it |
| `pytest -q -k no_hardcoded_secrets` | A string under a name with token, secret or password in it — catches what the security scan's Bandit flags (B105/B106/B107) |
| `pytest -q -k synthetic_email_domains` | Example email addresses — only reserved domains (`example.com`, `.test`, …) |

# Ops Orchestrator — Internal Access & Workflow Automation

AI-native backend for access provisioning and operational change management in regulated financial services. Accepts requests in natural language, generates auditable execution plans via Claude, applies deterministic risk gating aligned to change-management policy, and routes sensitive changes through a mandatory human approval queue.

---

## Architecture

```
POST /requests
    │
    ├─ 1. Idempotency check (SQLite)
    ├─ 2. Claude (claude-haiku) → structured TaskPlan JSON
    ├─ 3. Deterministic risk engine (rule-based, no LLM)
    │
    ├─ LOW/MEDIUM risk ──→ auto-execute (Slack + GitHub adapters)
    │                        └─ status: COMPLETED
    │
    └─ HIGH/HUMAN_ONLY ──→ in-memory ApprovalQueue*
                            └─ status: AWAITING_APPROVAL
                                │
                            POST /approvals/{id}/approve
                                └─ execute all steps → COMPLETED
```

*The queue is intentionally in-memory for MVP simplicity; in production this layer swaps to a durable queue (Redis Streams / SQS) without changing orchestration logic.

**RBAC roles** (enforced via JWT claims):

| Role       | Can submit | Can approve/reject | Can read |
|------------|-----------|-------------------|---------|
| requester  | ✅        | ❌                | ✅      |
| approver   | ❌        | ✅                | ✅      |
| admin      | ✅        | ✅                | ✅      |

---

## Quick Start

### 1. Install dependencies

```bash
cd ops-orchestrator
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

### 2. (Optional) Set Claude API key

Without a key, the orchestrator falls back to a deterministic stub planner — fully functional for local dev and tests.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

### 3. Run the backend

```bash
uvicorn app.main:app --reload
```

API docs: http://localhost:8000/docs

### 4. Run the frontend

```bash
cd web
cp .env.local.example .env.local   # edit NEXT_PUBLIC_API_BASE_URL if needed
npm install
npm run dev
```

Frontend: http://localhost:3000 — log in with any seeded account (password: `password123`)

---

## Endpoints

Get a token first (or use `export TOKEN=$(curl -s -X POST http://localhost:8000/auth/login -H "Content-Type: application/json" -d '{"email":"alice@acme-fintech.com","password":"password123"}' | jq -r .access_token)`).

### `POST /requests` — Submit an ops request
```bash
curl -s -X POST http://localhost:8000/requests \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "idempotency_key": "provision-analyst-2891",
    "requester_id": "alice@acme-fintech.com",
    "role": "requester",
    "intent": "provision_repository_access",
    "payload": {
      "user_email": "j.smith@acme-fintech.com",
      "repo": "risk-models",
      "permission": "read"
    }
  }' | jq .
```

**Expected**: status `AWAITING_APPROVAL` (add_collaborator modifies repository access — HIGH risk)

---

### `GET /requests/{id}` — Fetch request status
```bash
curl -s http://localhost:8000/requests/<ID> \
  -H "Authorization: Bearer $TOKEN" | jq .
```

---

### `POST /approvals/{id}/approve` — Approve a pending request
```bash
export APPROVER_TOKEN=$(curl -s -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"compliance@acme-fintech.com","password":"password123"}' | jq -r .access_token)

curl -s -X POST http://localhost:8000/approvals/<ID>/approve \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $APPROVER_TOKEN" \
  -d '{"approver_id": "compliance@acme-fintech.com", "reason": "Background check complete; line manager confirmed via JIRA-2891; role entitlement verified"}' | jq .
```

---

### `POST /approvals/{id}/reject` — Reject a pending request
```bash
curl -s -X POST http://localhost:8000/approvals/<ID>/reject \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $APPROVER_TOKEN" \
  -d '{"approver_id": "compliance@acme-fintech.com", "reason": "Requested permission level exceeds approved role entitlement for this environment"}' | jq .
```

---

### `POST /demo/onboard` — End-to-end demo (no auth required)
```bash
curl -s -X POST http://localhost:8000/demo/onboard | jq .
```

Runs a full analyst onboarding scenario: adds the new hire to the GitHub org and sends a Slack welcome message. The request lands in `AWAITING_APPROVAL` because org membership changes are HIGH risk and require compliance sign-off. Copy the `id` and run the approve command above to complete execution.

---

## Human Role in the Loop

The human approver is responsible for:
- Authorizing irreversible or high-blast-radius access changes
- Providing written justification for HUMAN_ONLY decisions
- Applying contextual judgment beyond system-visible inputs

The system may recommend and prepare changes, but it never executes HUMAN_ONLY actions without explicit human approval.

---

## Critical Human Decision

> **Production access changes — granting admin, infra-level, or org-wide permissions — must remain human-authorized.**
>
> Blast radius is unbounded. Regulatory liability is real. And these changes are irreversible without explicit rollback. No automation shortcut justifies removing the human from this decision.

This is not a configuration option. It is a hard architectural constraint enforced at the risk layer, before any LLM output is trusted.

---

## Risk Rules (deterministic, no LLM)

| Action type                                              | Risk Level  | Auto-execute? |
|----------------------------------------------------------|-------------|---------------|
| revoke_access, offboard, terminate                       | HUMAN_ONLY  | Never         |
| Production access change (target: prod/infra/security)   | HUMAN_ONLY  | Never         |
| Privileged access change (admin/owner/org_wide role)     | HUMAN_ONLY  | Never         |
| add_to_org, grant_access, add_collaborator, deploy       | HIGH        | Never         |
| Any arg referencing "prod" or "production"               | HIGH        | Never         |
| create_pr, create_repo, invite_to_channel                | MEDIUM      | Yes           |
| send_message, read-only actions                          | LOW         | Yes           |

> **HUMAN_ONLY gate:** Approving a HUMAN_ONLY decision requires a written justification of at least 20 characters. This is enforced server-side — no role, including admin, may bypass it. HUMAN_ONLY classification is determined before model reasoning is trusted, and enforced via deterministic policy checks.

---

## Run Tests

```bash
pytest tests/ -v
```

Expected output:
```
tests/test_idempotency.py::test_first_request_succeeds        PASSED
tests/test_idempotency.py::test_duplicate_key_rejected        PASSED
tests/test_idempotency.py::test_different_keys_both_succeed   PASSED
tests/test_idempotency.py::test_requester_role_required       PASSED
tests/test_approval.py::test_high_risk_requires_approval      PASSED
tests/test_approval.py::test_low_risk_auto_executes           PASSED
tests/test_approval.py::test_approver_can_approve             PASSED
tests/test_approval.py::test_requester_cannot_approve         PASSED
tests/test_approval.py::test_approver_can_reject              PASSED
tests/test_approval.py::test_double_approve_rejected          PASSED
```

---

## Project Structure

```
ops-orchestrator/
├── app/
│   ├── main.py                     # FastAPI app, lifespan, global handlers
│   ├── models/
│   │   ├── orm.py                  # SQLAlchemy: OpsRequest, AuditLog, ApprovalRecord, User
│   │   └── schemas.py              # Pydantic: TaskPlan, TaskStep, responses, auth
│   ├── db/
│   │   └── database.py             # SQLite/Postgres engine, get_db(), init_db()
│   ├── auth/
│   │   ├── jwt.py                  # HS256 token creation + verification
│   │   └── rbac.py                 # JWT-based RBAC, require_role() dependency
│   ├── queue/
│   │   └── memory_queue.py         # In-memory approval queue
│   ├── services/
│   │   ├── orchestrator.py         # Main pipeline (submit/approve/reject)
│   │   └── risk.py                 # Deterministic rule-based risk engine
│   ├── tools/
│   │   ├── slack.py                # Mocked Slack adapter
│   │   └── github.py               # Mocked GitHub adapter
│   ├── observability/
│   │   └── logger.py               # Structured JSON logger + DB audit writer
│   └── routers/
│       ├── auth.py                 # POST /auth/register|login
│       ├── requests.py             # POST /requests, GET /requests, GET /requests/{id}
│       ├── approvals.py            # GET /approvals/pending, POST /approvals/{id}/approve|reject
│       └── demo.py                 # POST /demo/onboard
├── web/                            # Next.js 15 + Tailwind frontend
│   ├── src/
│   │   ├── lib/
│   │   │   ├── api.ts              # Typed API client (auto-attaches Bearer token)
│   │   │   └── Layout.tsx          # Shared nav, route guard, Badge/Spinner components
│   │   └── app/
│   │       ├── login/page.tsx      # Login form + seeded account helper
│   │       ├── page.tsx            # Dashboard: submit form + recent requests table
│   │       ├── approvals/page.tsx  # Pending approvals list + approve/reject modal
│   │       └── requests/[request_id]/page.tsx  # Request detail with live polling
│   └── .env.local.example
└── tests/
    ├── conftest.py                 # TestClient + JWT fixtures
    ├── test_auth.py                # Auth endpoint tests
    ├── test_idempotency.py         # Duplicate key rejection tests
    └── test_approval.py            # Approval gating + RBAC enforcement tests
```

---

## Audit Log

Every state transition writes a row to `audit_logs`:

| Field          | Description                              |
|----------------|------------------------------------------|
| correlation_id | Ties all events for one request together |
| actor          | User or "system"                         |
| action         | REQUEST_SUBMITTED, PLAN_GENERATED, etc.  |
| input_hash     | SHA-256 of the original request payload  |
| decision       | PLANNING / COMPLETED / AWAITING_APPROVAL |
| created_at     | When the log entry was written           |
| executed_at    | When the action actually ran             |

---

## Swap to Production

| Concern        | MVP                    | Production swap                        |
|----------------|------------------------|----------------------------------------|
| Database       | SQLite                 | Set `DATABASE_URL` to Postgres DSN     |
| Queue          | In-memory dict         | Redis Streams / SQS / Celery           |
| Auth           | X-User-Role header     | JWT + OAuth2 middleware                |
| Tools          | Mocked adapters        | Real Slack/GitHub API clients          |
| LLM            | claude-haiku (or stub) | claude-sonnet-4-6 with structured output |

---

## Auth

JWT-based authentication (HS256, 1-hour expiry). Every protected endpoint requires `Authorization: Bearer <token>`.

### Login
```bash
curl -s -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "alice@acme-fintech.com", "password": "password123"}' | jq .
```

Copy `access_token` from the response, then pass it on every subsequent call:

```bash
export TOKEN="<paste token here>"

curl -s http://localhost:8000/requests \
  -H "Authorization: Bearer $TOKEN" | jq .
```

### Register (new user)
```bash
curl -s -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "newuser@acme-fintech.com", "password": "password123", "role": "requester"}' | jq .
```

### Default seed accounts (dev only — created automatically on first startup)

| Email | Role | Password |
|---|---|---|
| alice@acme-fintech.com | requester | password123 |
| compliance@acme-fintech.com | approver | password123 |
| admin@acme-fintech.com | admin | password123 |

> Seed accounts use a hardcoded password for local development only. In production, change passwords immediately or disable seeding by setting real users before first boot.

---

## Deploy

### Railway (recommended)

1. Push repo to GitHub
2. Create a new Railway project → **Deploy from GitHub repo**
3. Add a **Postgres** plugin — `DATABASE_URL` is injected automatically
4. Set the remaining environment variables under **Variables**:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Auto-set by Railway Postgres plugin |
| `JWT_SECRET` | Yes | Random 32+ char string — `python -c "import secrets; print(secrets.token_hex(32))"` |
| `ANTHROPIC_API_KEY` | No | Falls back to deterministic stub planner if unset |
| `ENV` | No | Set to `production` |

5. Set the **start command**:
```
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

### Render

Same steps — add a Postgres database service, copy the internal DSN to `DATABASE_URL`, set `JWT_SECRET`, and use the start command above.

### Frontend (Vercel / Netlify / Railway static)

```bash
cd web
npm run build   # output: .next/
```

Set `NEXT_PUBLIC_API_BASE_URL` to your deployed backend URL (e.g. `https://ops-orchestrator.up.railway.app`). No other env vars required for the frontend.

---

## What Breaks First at Scale

### 1. Prompt Injection
**Risk:** A malicious requester crafts an `intent` or `payload` that hijacks the LLM planner into emitting steps for arbitrary destructive actions (e.g. `grant_prod_trading_access`, `exfiltrate_pii`).

**Mitigation (implemented):** Every generated step passes through `app/tools/catalog.py` before execution. `_tool_dispatch` rejects any `(tool, action)` pair not in `TOOL_CATALOG` — the injected step is blocked at the tool layer regardless of what the LLM emits. Adding a new capability requires an explicit code change to the allowlist.

---

### 2. Policy Drift
**Risk:** Risk rules or the LLM prompt change silently over time. An audit log from six months ago says "LOW risk — auto-executed", but the current rule-set would classify the same step as HUMAN_ONLY. Incident replay and compliance reviews become unreliable.

**Mitigation (implemented):** `POLICY_VERSION` (in `app/services/risk.py`) and `PROMPT_VERSION` (in `app/services/orchestrator.py`) are stamped on every `ops_requests` row and on every `PLAN_GENERATED` audit log entry. A compliance query can filter by version to compare decisions across rule-set generations. Bumping either constant is the mandatory first step before merging policy changes.

---

### 3. Partial Tool Failures
**Risk:** A multi-step plan partially executes — step 1 (add analyst to risk-models repo) succeeds, step 2 (send onboarding message) fails. The user is left in an inconsistent intermediate state, and the audit log shows COMPLETED.

**Mitigation (partially implemented):** `execution_results` records per-step `ok`, `data`, and `error` fields. Every `AUTO_EXECUTED` and `APPROVED_EXECUTION_COMPLETE` audit entry carries `results_count`. At scale, add a compensating-action catalog that maps each action to its rollback action; if any step returns `ok: false`, trigger rollback steps before marking FAILED.

---

### 4. Automation Bias
**Risk:** Approvers rubber-stamp HUMAN_ONLY requests without meaningful review because the UI makes approval a single click. The human gate becomes theatre.

**Mitigation (implemented):** `approve_request` requires `decision_reason` ≥ 20 characters for any request with `overall_risk = HUMAN_ONLY`. This is enforced server-side — no role (including admin) can bypass it. The reason is stored on `ApprovalRecord.reason` and included in the `REQUEST_APPROVED` audit log metadata, creating a written paper trail for each high-stakes decision.

---

*Ops Orchestrator demonstrates how AI can expand operational throughput without expanding operational authority.*

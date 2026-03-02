# Ops Orchestrator

AI-native access provisioning and operational change management for regulated financial services. Natural-language requests are planned by Claude, gated through a deterministic risk engine, and either auto-executed or routed to a mandatory human approval queue — with every decision stamped, versioned, and auditable.

---

## Architecture

```
POST /requests
    │
    ├─ 1. Idempotency check (SQLite / Postgres)
    ├─ 2. Claude (claude-haiku) → structured TaskPlan JSON   [PROMPT_VERSION stamped]
    ├─ 3. Deterministic risk engine (rule-based, no LLM)     [POLICY_VERSION stamped]
    │
    ├─ LOW / MEDIUM ──→ auto-execute → COMPLETED
    │
    └─ HIGH / HUMAN_ONLY ──→ ApprovalQueue → AWAITING_APPROVAL
                              │
                          POST /approvals/{id}/approve
                              └─ execute all steps → COMPLETED
```

**RBAC roles** (enforced via JWT claims, not headers):

| Role       | Submit requests | Approve / Reject | HR events | Admin dashboard |
|------------|:--------------:|:----------------:|:---------:|:---------------:|
| requester  | ✅ | ❌ | ❌ | ❌ |
| approver   | ❌ | ✅ | ❌ | ❌ |
| hr         | ❌ | ❌ | ✅ | ❌ |
| admin      | ✅ | ✅ | ✅ | ✅ |

---

## Features

### Request Pipeline
Submit an ops request in plain language. Claude generates a structured execution plan; the risk engine classifies each step. Low and medium risk requests execute automatically. High risk and human-only requests enter a human approval queue with mandatory written justification (≥ 20 characters, enforced server-side).

### Approvals
Approvers see a live pending queue with full request context — intent, AI plan, risk classification, and clarification history. Each approve/reject action requires a written reason that is stored in the audit trail. A History tab shows all decided requests with outcome and approver.

### HR Events
HR submits lifecycle events (new hire, role change, termination) through a structured form. The policy engine derives the correct access actions for each event and the employee's department, then queues them through the standard request pipeline. An Event History tab shows all submitted events grouped by employee, with a slide-out panel showing per-system status and approval outcomes.

### Drift Detection
Compares actual provisioning records against HR department policy to surface three classes of anomaly:

| Type | Meaning | Severity |
|------|---------|----------|
| Unexpected | Access exists with no policy justification for current department | HIGH |
| Missing | Policy requires access but no grant record exists | MEDIUM |
| Stale | Access was legitimately granted but is over 90 days old | LOW |

Results include one-click Revoke (unexpected) and Grant (missing) actions.

### Admin Dashboard
Admins land on a live system overview — pending approval count, drift findings, auto-revocations in the last 24 hours, and total requests today — with alert banners for aging queues and open drift findings.

### Access Expiry
A background thread polls every 60 seconds for grants with an `expires_at` timestamp that have passed, and fires `auto_revoke` for each — no manual intervention needed.

---

## Quick Start

### 1. Backend

```bash
cd ops-orchestrator
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env   # set JWT_SECRET; optionally set ANTHROPIC_API_KEY
uvicorn app.main:app --reload
```

Without `ANTHROPIC_API_KEY`, the orchestrator falls back to a deterministic stub planner — fully functional for local dev and tests.

API docs: http://localhost:8000/docs

### 2. Frontend

```bash
cd web
cp .env.local.example .env.local   # edit NEXT_PUBLIC_API_BASE_URL if needed
npm install
npm run dev
```

Frontend: http://localhost:3000

### 3. Seed accounts (created automatically on first startup)

| Email | Role | Password |
|---|---|---|
| alice@acme-fintech.com | requester | password123 |
| compliance@acme-fintech.com | approver | password123 |
| hr@acme-fintech.com | hr | password123 |
| admin@acme-fintech.com | admin | password123 |

> Seed accounts use a hardcoded password for local development only.

---

## API Reference

Get a token first:
```bash
export TOKEN=$(curl -s -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@acme-fintech.com","password":"password123"}' | jq -r .access_token)
```

### Submit a request
```bash
curl -s -X POST http://localhost:8000/requests \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "idempotency_key": "provision-analyst-2891",
    "intent": "provision_repository_access",
    "payload": {
      "user_email": "j.smith@acme-fintech.com",
      "repo": "risk-models",
      "permission": "read"
    }
  }' | jq .
```

Expected: `AWAITING_APPROVAL` — repository access changes are HIGH risk.

### Approve a pending request
```bash
export APPROVER_TOKEN=$(curl -s -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"compliance@acme-fintech.com","password":"password123"}' | jq -r .access_token)

curl -s -X POST http://localhost:8000/approvals/<ID>/approve \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $APPROVER_TOKEN" \
  -d '{"reason": "Background check complete; line manager confirmed via JIRA-2891; role entitlement verified"}' | jq .
```

### Submit an HR lifecycle event
```bash
export HR_TOKEN=$(curl -s -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"hr@acme-fintech.com","password":"password123"}' | jq -r .access_token)

curl -s -X POST http://localhost:8000/hr/events \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $HR_TOKEN" \
  -d '{
    "event": {
      "type": "new_hire",
      "name": "Jordan Smith",
      "email": "j.smith@acme-fintech.com",
      "department": "Engineering",
      "start_date": "2026-03-10"
    }
  }' | jq .
```

### Scan for access drift
```bash
curl -s "http://localhost:8000/drift/scan" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

### End-to-end demo (no auth required)
```bash
curl -s -X POST http://localhost:8000/demo/onboard | jq .
```

---

## Risk Rules

| Action type | Risk | Auto-execute? |
|---|---|---|
| revoke_access, offboard, terminate | HUMAN_ONLY | Never |
| Production access (target: prod/infra/security) | HUMAN_ONLY | Never |
| Privileged access (admin/owner/org_wide) | HUMAN_ONLY | Never |
| add_to_org, grant_access, add_collaborator, deploy | HIGH | Never |
| Any argument referencing "prod" or "production" | HIGH | Never |
| create_pr, create_repo, invite_to_channel | MEDIUM | Yes |
| send_message, read-only actions | LOW | Yes |

**HUMAN_ONLY gate:** Approving a HUMAN_ONLY request requires `decision_reason` ≥ 20 characters, enforced server-side. No role — including admin — can bypass this.

---

## Security Properties

**Prompt injection containment** — Every generated step passes through `_tool_dispatch` before execution. It rejects any `(tool, action)` pair not in `TOOL_CATALOG`. A hijacked LLM output cannot escape the allowlist; adding a new capability requires an explicit code change.

**Identity from JWT only** — `requester_id` is always overwritten from the JWT `user_id` claim at the router layer. Client-supplied identity is ignored.

**Policy and prompt versioning** — `POLICY_VERSION` (in `risk.py`) and `PROMPT_VERSION` (in `orchestrator.py`) are stamped on every `ops_requests` row and on every `PLAN_GENERATED` audit log entry. Compliance queries can filter by version to compare decisions across rule-set generations. Bumping either constant is the mandatory first step before merging policy changes.

**Audit trail** — Every state transition writes a row to `audit_logs`:

| Field | Description |
|---|---|
| correlation_id | Ties all events for one request together |
| actor | User email or "system" |
| action | REQUEST_SUBMITTED, PLAN_GENERATED, AUTO_EXECUTED, REQUEST_APPROVED, … |
| input_hash | SHA-256 of the original request payload |
| decision | PLANNING / COMPLETED / AWAITING_APPROVAL |
| created_at | When the log entry was written |
| executed_at | When the action actually ran |

---

## Project Structure

```
ops-orchestrator/
├── app/
│   ├── main.py                     # FastAPI app, lifespan, dev seed users
│   ├── models/
│   │   ├── orm.py                  # SQLAlchemy: OpsRequest, AuditLog, ApprovalRecord, User
│   │   └── schemas.py              # Pydantic: TaskPlan, TaskStep, responses, ApprovalInfo
│   ├── db/
│   │   └── database.py             # SQLite/Postgres engine, get_db(), init_db()
│   ├── auth/
│   │   ├── jwt.py                  # HS256 token creation + verification
│   │   └── rbac.py                 # JWT-based RBAC, require_role(), Role enum
│   ├── queue/
│   │   └── memory_queue.py         # In-memory approval queue (swap to Redis/SQS for prod)
│   ├── services/
│   │   ├── orchestrator.py         # Main pipeline: submit / approve / reject / auto_revoke
│   │   ├── risk.py                 # Deterministic rule-based risk engine
│   │   ├── drift.py                # Access drift scanner (actual vs HR policy)
│   │   ├── expiry.py               # Background thread: auto-revoke expired grants
│   │   ├── hr_policy.py            # Dept → required systems policy + access reasoning
│   │   └── injection.py            # Prompt injection detection helpers
│   ├── tools/
│   │   ├── slack.py                # Mocked Slack adapter
│   │   └── github.py               # Mocked GitHub adapter
│   ├── observability/
│   │   └── logger.py               # Structured JSON logger + DB audit writer
│   └── routers/
│       ├── auth.py                 # POST /auth/register|login
│       ├── requests.py             # POST /requests, GET /requests, GET /requests/{id}
│       ├── approvals.py            # GET /approvals/pending, POST /approvals/{id}/approve|reject
│       ├── hr_events.py            # POST /hr/events (new_hire, role_change, termination)
│       ├── drift.py                # GET /drift/scan
│       └── demo.py                 # POST /demo/onboard
├── web/                            # Next.js 15 App Router + Tailwind CSS
│   └── src/
│       ├── lib/
│       │   ├── api.ts              # Typed API client (auto-attaches Bearer token, 401 redirect)
│       │   └── Layout.tsx          # Shared nav, route guard, Badge/Spinner components
│       └── app/
│           ├── login/              # Login form
│           ├── page.tsx            # Admin: system dashboard | Requester: submit form
│           ├── my-requests/        # Requester's request history with live polling
│           ├── approvals/          # Pending queue + History tab (approver/admin)
│           ├── hr/                 # HR event submission + Event History with slide-out panel
│           ├── drift/              # Drift scan results (unexpected / missing / stale)
│           └── requests/[request_id]/  # Request detail: timeline, plan, audit log
└── tests/
    ├── conftest.py                 # TestClient + JWT fixtures
    ├── test_auth.py
    ├── test_idempotency.py
    └── test_approval.py
```

---

## Run Tests

```bash
pytest tests/ -v
```

---

## Deploy

### Railway (recommended)

1. Push repo to GitHub
2. New Railway project → **Deploy from GitHub repo**
3. Add a **Postgres** plugin — `DATABASE_URL` is injected automatically
4. Set environment variables:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Auto-set by Railway Postgres plugin |
| `JWT_SECRET` | Yes | `python -c "import secrets; print(secrets.token_hex(32))"` |
| `ANTHROPIC_API_KEY` | No | Falls back to stub planner if unset |
| `ENV` | No | Set to `production` |

5. Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`

### Frontend (Vercel / Netlify)

```bash
cd web && npm run build
```

Set `NEXT_PUBLIC_API_BASE_URL` to your deployed backend URL. No other frontend env vars required.

---

## Known Limitations (MVP → Production)

| Concern | MVP | Production swap |
|---|---|---|
| Database | SQLite | Set `DATABASE_URL` to Postgres DSN |
| Approval queue | In-memory (lost on restart) | Redis Streams / SQS / Celery |
| HR policy | Hardcoded JSON in `hr_policy.py` | External config service or DB table |
| Tool adapters | Mocked Slack / GitHub | Real API clients |
| LLM model | claude-haiku (or stub) | claude-sonnet-4-6 with structured output |

---

*Ops Orchestrator demonstrates how AI can expand operational throughput without expanding operational authority.*

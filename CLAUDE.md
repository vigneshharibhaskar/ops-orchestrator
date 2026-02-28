# Ops Orchestrator — Claude Context

AI-native access provisioning and operational change management system for regulated fintech. FastAPI backend + Next.js 15 frontend.

## Key Files

| File | Purpose |
|------|---------|
| `app/main.py` | — |
| `app/models/orm.py` | — |
| `app/models/schemas.py` | `OpsRequestCreate.requester_id` is optional — always overwritten from JWT |
| `app/services/orchestrator.py` | Main pipeline: submit → plan → risk → execute/queue. `PROMPT_VERSION` stamped here |
| `app/services/risk.py` | Deterministic rule-based risk engine (no LLM). `POLICY_VERSION` stamped here |
| `app/auth/rbac.py` | `require_role()` FastAPI dependency, `UserContext` |
| `app/auth/jwt.py` | — |
| `app/routers/requests.py` | `POST /requests`, `GET /requests`, `GET /requests/{id}`, clarifications, audit |
| `app/routers/approvals.py` | `GET /approvals/pending`, `POST /approvals/{id}/approve\|reject` |
| `web/src/lib/api.ts` | Auto-attaches Bearer token from localStorage |
| `web/src/lib/Layout.tsx` | Shared nav, route guard, `useRole()` hook, `RiskBadge`, `StatusBadge`, `Spinner` |
| `web/src/app/page.tsx` | — |
| `web/src/app/requests/[request_id]/page.tsx` | Request detail with package-tracking timeline + 2s polling |
| `web/src/app/approvals/page.tsx` | — |

## Architecture

```
POST /requests
    ├─ Idempotency check (SQLite)
    ├─ Claude (claude-haiku) → TaskPlan JSON  [PROMPT_VERSION stamped]
    ├─ Deterministic risk engine              [POLICY_VERSION stamped]
    ├─ LOW/MEDIUM → auto-execute → COMPLETED
    └─ HIGH/HUMAN_ONLY → in-memory ApprovalQueue → AWAITING_APPROVAL
```

**RBAC** (enforced via JWT):
- `requester` — submit + read own requests
- `approver` — read all + approve/reject
- `admin` — all of the above

## Critical Constraints

- **HUMAN_ONLY gate**: approval requires `decision_reason` ≥ 20 characters, enforced server-side. No role bypasses this.
- **Identity from JWT only**: `requester_id` is always overwritten from `user.user_id` (email) at `routers/requests.py:78`. Never trust client-supplied identity.
- **Tool allowlist**: step execution goes through `_tool_dispatch` which rejects any `(tool, action)` pair not in `TOOL_CATALOG` — prompt injection cannot escape the allowlist.
- **Policy/prompt versioning**: bump `POLICY_VERSION` in `risk.py` and `PROMPT_VERSION` in `orchestrator.py` before merging any policy changes.
- **bcrypt**: Uses direct `bcrypt` calls (not passlib) — passlib 1.7.4 is incompatible with bcrypt ≥ 4. Don't swap back.

## Known Gotchas

- **Datetime timezones**: ORM uses `datetime.utcnow` (naive UTC). Pydantic serializes without `Z` suffix. Frontend must append `Z` before passing to `new Date()` — see `fmt()` in the detail page and the dashboard table cell.
- **In-memory queue**: `ApprovalQueue` is reset on server restart. Pending approvals are lost. This is intentional for MVP — swap to Redis/SQS for production.
- **Stale SQLite**: `create_all()` does not migrate — only creates missing tables. If columns are missing, delete `ops_orchestrator.db` and restart.
- **Audit endpoint RBAC**: `GET /requests/{id}/audit` requires APPROVER or ADMIN. Frontend handles 403 with `.catch(() => [])`.


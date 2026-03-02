const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

function token(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const tok = token();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (tok) headers["Authorization"] = `Bearer ${tok}`;

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    if (typeof window !== "undefined") {
      localStorage.removeItem("token");
      window.location.href = "/login";
    }
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? body.error ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }

  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type Role = "requester" | "approver" | "admin";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "HUMAN_ONLY";
export type RequestStatus =
  | "PENDING"
  | "PLANNING"
  | "NEEDS_CLARIFICATION"
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "EXECUTING"
  | "COMPLETED"
  | "FAILED";

export interface TokenResponse {
  access_token: string;
  token_type: string;
  role: Role;
}

export interface TaskStep {
  step_id: string;
  step: number;
  name: string;
  tool: string;
  action: string;
  args: Record<string, unknown>;
  risk: RiskLevel;
  requires_approval: boolean;
  reason?: string;
}

export interface PolicyReference {
  id: string;
  title: string;
  severity: RiskLevel;
}

export interface EvidenceItem {
  type: string;
  field?: string;
  value?: string;
  snippet?: string;
}

export interface TaskPlan {
  correlation_id: string;
  plan: TaskStep[];
  assumptions: string[];
  policy_flags: string[];
  policy_references: PolicyReference[];
  evidence: EvidenceItem[];
  confidence: number;
  questions: string[];
  needs_human_approval: boolean;
  overall_risk: RiskLevel;
  risk_summary?: string;
  model_name?: string;
  safety_flags: string[];
  policy_version?: string;
  prompt_version?: string;
}

export interface OpsRequest {
  id: string;
  correlation_id: string;
  idempotency_key: string;
  requester_id: string;
  intent: string;
  payload: Record<string, unknown>;
  status: RequestStatus;
  task_plan?: TaskPlan;
  risk_level?: RiskLevel;
  risk_score?: number;
  risk_flags?: string[];
  request_safety_flags?: string[];
  execution_results?: Record<string, unknown>[];
  error_message?: string;
  policy_version?: string;
  prompt_version?: string;
  expires_at?: string | null;
  auto_revoked?: boolean;
  revoke_request_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PendingApprovalItem {
  id: string;
  correlation_id: string;
  requester_id: string;
  intent: string;
  created_at: string;
  overall_risk?: string;
  needs_human_approval: boolean;
}

export interface AuditLogEntry {
  id: string;
  correlation_id: string;
  actor: string;
  action: string;
  input_hash?: string;
  decision?: string;
  metadata_?: Record<string, unknown>;
  created_at: string;
  executed_at?: string;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export const auth = {
  login: (email: string, password: string) =>
    request<TokenResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  register: (email: string, password: string, role: Role) =>
    request<TokenResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, role }),
    }),
};

// ── Requests ──────────────────────────────────────────────────────────────────

export const requests = {
  list: (limit = 20) =>
    request<OpsRequest[]>(`/requests?limit=${limit}`),

  get: (request_id: string) =>
    request<OpsRequest>(`/requests/${request_id}`),

  submit: (body: {
    idempotency_key: string;
    intent: string;
    payload: Record<string, unknown>;
    justification?: string;
    expires_at?: string | null;
  }) =>
    request<OpsRequest>("/requests", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  clarify: (request_id: string, answers: Record<string, string>) =>
    request<OpsRequest>(`/requests/${request_id}/clarifications`, {
      method: "POST",
      body: JSON.stringify({ answers }),
    }),

  audit: (request_id: string) =>
    request<AuditLogEntry[]>(`/requests/${request_id}/audit`),
};

// ── Approvals ─────────────────────────────────────────────────────────────────

export const approvals = {
  pending: () => request<PendingApprovalItem[]>("/approvals/pending"),

  approve: (request_id: string, reason: string) =>
    request(`/approvals/${request_id}/approve`, {
      method: "POST",
      body: JSON.stringify({ approver_id: "from-jwt", reason }),
    }),

  reject: (request_id: string, reason: string) =>
    request(`/approvals/${request_id}/reject`, {
      method: "POST",
      body: JSON.stringify({ approver_id: "from-jwt", reason }),
    }),
};

// ── HR Events ─────────────────────────────────────────────────────────────────

export interface HRActionSummary {
  request_id: string;
  system: string;
  action: string;
  risk: string;
  status: string;
}

export interface HREventResponse {
  event_id: string;
  employee: string;
  total_actions: number;
  auto_executing: number;
  awaiting_approval: number;
  actions: HRActionSummary[];
}

export const hrEvents = {
  submit: (event: Record<string, unknown>) =>
    request<HREventResponse>("/hr/events", {
      method: "POST",
      body: JSON.stringify({ event }),
    }),
};

// ── Drift ─────────────────────────────────────────────────────────────────────

export interface DriftItem {
  email: string;
  system: string;
  drift_type: "unexpected" | "missing" | "stale";
  severity: "HIGH" | "MEDIUM" | "LOW";
  detail: string;
  last_grant_id?: string | null;
  last_grant_date?: string | null;
  days_since_grant?: number | null;
  department?: string | null;
}

export const drift = {
  scan: (email?: string) =>
    request<DriftItem[]>(`/drift${email ? `?email=${encodeURIComponent(email)}` : ""}`),
};

// ── Health ────────────────────────────────────────────────────────────────────

export const health = () => request<{ status: string }>("/health");

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Layout, { RiskBadge, StatusBadge, ErrorMsg, useRole } from "@/lib/Layout";
import { requests, type OpsRequest, type AuditLogEntry } from "@/lib/api";

const TERMINAL = new Set(["COMPLETED", "REJECTED", "FAILED"]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(s: string | null | undefined): string {
  if (!s) return "—";
  const ts = s.endsWith("Z") || s.includes("+") ? s : s + "Z";
  return new Date(ts).toLocaleString();
}

function auditTs(audit: AuditLogEntry[], action: string): string | undefined {
  return audit.find((a) => a.action === action)?.created_at;
}

function timeAgo(isoStr: string): string {
  const ts = isoStr.endsWith("Z") || isoStr.includes("+") ? isoStr : isoStr + "Z";
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function stripRiskPrefix(s: string): string {
  return s.replace(/RiskLevel\./gi, "");
}

const INTENT_LABEL: Record<string, string> = {
  // Requester-submitted intents
  invite_to_channel:           "Slack Channel",
  provision_repository_access: "GitHub Repository",
  provision_vpn_access:        "VPN Access",
  provision_drive_access:      "Google Drive",
  provision_jira_access:       "Jira Project",
  provision_aws_access:        "AWS Console",
  // HR-generated provision intents
  provision_github_access:          "GitHub",
  provision_slack_access:           "Slack",
  provision_okta_access:            "Okta",
  provision_netsuite_access:        "NetSuite",
  provision_workday_access:         "Workday",
  // HR-generated revoke intents
  revoke_github_access:             "GitHub",
  revoke_slack_access:              "Slack",
  revoke_okta_access:               "Okta",
  revoke_vpn_access:                "VPN",
  revoke_netsuite_access:           "NetSuite",
  revoke_workday_access:            "Workday",
  // Auto-revoke
  auto_revoke_expired_access:       "Auto-revoke",
};

const RESOURCE_KEY: Record<string, string> = {
  invite_to_channel:           "channel",
  provision_repository_access: "repo",
  provision_vpn_access:        "vpn_group",
  provision_drive_access:      "folder",
  provision_jira_access:       "project_key",
  provision_aws_access:        "service",
  // HR-generated intents: show the employee name as the resource
  provision_github_access:     "full_name",
  provision_slack_access:      "full_name",
  provision_okta_access:       "full_name",
  provision_netsuite_access:   "full_name",
  provision_workday_access:    "full_name",
  revoke_github_access:        "full_name",
  revoke_slack_access:         "full_name",
  revoke_okta_access:          "full_name",
  revoke_vpn_access:           "full_name",
  revoke_netsuite_access:      "full_name",
  revoke_workday_access:       "full_name",
};

function getLabel(intent: string): string {
  return INTENT_LABEL[intent] ?? intent;
}

function getResource(intent: string, payload: Record<string, unknown>): string {
  const key = RESOURCE_KEY[intent];
  return key && payload[key] ? String(payload[key]) : "";
}

// ── Timeline types ────────────────────────────────────────────────────────────

type StageState = "completed" | "active" | "failed" | "upcoming";

interface Stage {
  id: string;
  title: string;
  state: StageState;
  timestamp?: string;
  detail: unknown;
}

function buildTimeline(req: OpsRequest, audit: AuditLogEntry[]): Stage[] {
  const status = req.status;
  const plan = req.task_plan;
  const hasPlan = !!plan;
  const hasRisk = !!req.risk_level;
  const hasExecution = (req.execution_results ?? []).length > 0;
  const needsApproval =
    plan?.needs_human_approval ||
    status === "AWAITING_APPROVAL" ||
    status === "APPROVED" ||
    status === "REJECTED";
  const isFailed = status === "FAILED";
  const isRejected = status === "REJECTED";
  const isCompleted = status === "COMPLETED";
  const isExecuting = status === "EXECUTING";
  const isAwaiting = status === "AWAITING_APPROVAL";
  const isPlanningOrLater = !["PENDING"].includes(status);
  const isRiskOrLater = !["PENDING", "PLANNING"].includes(status);

  const approvalEntry =
    audit.find((a) => a.action === "REQUEST_APPROVED") ??
    audit.find((a) => a.action === "REQUEST_REJECTED");

  const stages: Stage[] = [
    {
      id: "submitted",
      title: "Request submitted",
      state: "completed",
      timestamp: req.created_at,
      detail: {
        requester_id: req.requester_id,
        intent: req.intent,
        idempotency_key: req.idempotency_key,
        payload: req.payload,
      },
    },

    {
      id: "plan",
      title: "Plan generated",
      state: hasPlan
        ? "completed"
        : isFailed && !hasPlan
        ? "failed"
        : isPlanningOrLater
        ? "active"
        : "upcoming",
      timestamp: auditTs(audit, "PLAN_GENERATED") ?? (hasPlan ? req.updated_at : undefined),
      detail: hasPlan
        ? {
            step_count: plan.plan.length,
            overall_risk: plan.overall_risk,
            confidence: plan.confidence,
            risk_summary: plan.risk_summary,
            model_name: plan.model_name,
            assumptions: plan.assumptions,
            steps: plan.plan.map((s) => ({
              step: s.step,
              name: s.name,
              tool: s.tool,
              action: s.action,
              risk: s.risk,
            })),
          }
        : null,
    },

    {
      id: "risk",
      title: "Risk assessed",
      state: hasRisk
        ? "completed"
        : isFailed && !hasRisk
        ? "failed"
        : isRiskOrLater
        ? "active"
        : "upcoming",
      timestamp: auditTs(audit, "PLAN_GENERATED") ?? (hasRisk ? req.updated_at : undefined),
      detail: hasRisk
        ? {
            risk_level: req.risk_level,
            risk_score: req.risk_score,
            risk_flags: req.risk_flags,
            safety_flags: req.request_safety_flags,
            policy_references: plan?.policy_references,
            policy_version: req.policy_version,
          }
        : null,
    },

    ...(needsApproval
      ? [
          {
            id: "approval_wait",
            title: "Awaiting approval",
            state: (
              isAwaiting
                ? "active"
                : isRejected || isCompleted || isExecuting || hasExecution
                ? "completed"
                : isFailed
                ? "failed"
                : "upcoming"
            ) as StageState,
            timestamp: auditTs(audit, "REQUEST_QUEUED_FOR_APPROVAL"),
            detail: {
              overall_risk: plan?.overall_risk,
              needs_human_approval: plan?.needs_human_approval,
              risk_summary: plan?.risk_summary,
            },
          },
        ]
      : []),

    ...(needsApproval && (isCompleted || isRejected || hasExecution)
      ? [
          {
            id: "decision",
            title: isRejected ? "Request rejected" : "Request approved",
            state: (isRejected ? "failed" : "completed") as StageState,
            timestamp:
              approvalEntry?.created_at ??
              auditTs(audit, "REQUEST_APPROVED") ??
              auditTs(audit, "REQUEST_REJECTED"),
            detail: approvalEntry
              ? {
                  actor: approvalEntry.actor,
                  decision: approvalEntry.decision,
                  metadata: approvalEntry.metadata_,
                }
              : null,
          },
        ]
      : []),

    ...(!isRejected
      ? [
          {
            id: "executing",
            title: "Executing steps",
            state: (
              hasExecution && isCompleted
                ? "completed"
                : hasExecution && isFailed
                ? "failed"
                : isExecuting
                ? "active"
                : isCompleted
                ? "completed"
                : "upcoming"
            ) as StageState,
            timestamp:
              auditTs(audit, "AUTO_EXECUTED") ??
              auditTs(audit, "APPROVED_EXECUTION_COMPLETE") ??
              (hasExecution ? req.updated_at : undefined),
            detail: hasExecution
              ? {
                  steps_total: req.execution_results!.length,
                  steps_ok: req.execution_results!.filter((r) => r.ok).length,
                  results: req.execution_results!.map((r) => ({
                    tool: r.tool_name,
                    action: r.action_name,
                    ok: r.ok,
                    duration_ms: r.execution_duration_ms,
                    error: r.error ?? null,
                  })),
                }
              : null,
          },
        ]
      : []),

    {
      id: "terminal",
      title: isCompleted ? "Completed" : isRejected ? "Rejected" : isFailed ? "Failed" : "Outcome",
      state: isCompleted
        ? "completed"
        : isRejected || isFailed
        ? "failed"
        : "upcoming",
      timestamp: isCompleted || isRejected || isFailed ? req.updated_at : undefined,
      detail: req.error_message ? { error: req.error_message } : null,
    },
  ];

  return stages;
}

// ── Stage UI ──────────────────────────────────────────────────────────────────

const DOT_CLS: Record<StageState, string> = {
  completed: "bg-green-500",
  active:    "bg-amber-400 animate-pulse",
  failed:    "bg-red-500",
  upcoming:  "bg-gray-300",
};

function StageSummary({ stage, req }: { stage: Stage; req: OpsRequest }) {
  switch (stage.id) {
    case "submitted": {
      const label = getLabel(req.intent);
      const resource = getResource(req.intent, req.payload);
      const justification =
        typeof req.payload?.justification === "string" ? req.payload.justification : "";
      const permission =
        typeof req.payload?.permission === "string" ? req.payload.permission : "";
      return (
        <div className="text-[13px] text-gray-600 space-y-0.5 mt-1.5">
          <p>
            System:{" "}
            <span className="font-medium text-gray-900">
              {label}
              {resource ? ` — ${resource}` : ""}
            </span>
          </p>
          {justification && (
            <p>
              Justification: <span className="text-gray-700">{justification}</span>
            </p>
          )}
          {permission && (
            <p>
              Permission: <span className="text-gray-700">{permission}</span>
            </p>
          )}
        </div>
      );
    }

    case "plan": {
      const plan = req.task_plan;
      if (!plan) return null;
      const confidence =
        plan.confidence !== undefined ? `${(plan.confidence * 100).toFixed(0)}%` : "—";
      const riskSummary = plan.risk_summary ? stripRiskPrefix(plan.risk_summary) : null;
      return (
        <div className="text-[13px] text-gray-600 space-y-0.5 mt-1.5">
          <p>
            {plan.plan.length} step{plan.plan.length !== 1 ? "s" : ""} planned · {confidence}{" "}
            confidence · Assessed by {plan.model_name ?? "AI"}
          </p>
          {riskSummary && <p className="text-gray-500">Risk summary: {riskSummary}</p>}
        </div>
      );
    }

    case "risk": {
      const flags = req.risk_flags ?? [];
      return (
        <div className="text-[13px] text-gray-600 space-y-1.5 mt-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            {req.risk_level && <RiskBadge level={req.risk_level} />}
            {req.policy_version && (
              <span className="text-gray-400">Policy version {req.policy_version}</span>
            )}
          </div>
          {flags.length === 0 ? (
            <p className="text-gray-400">No risk flags raised</p>
          ) : (
            <ul className="list-disc list-inside text-gray-500 space-y-0.5">
              {flags.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          )}
        </div>
      );
    }

    case "approval_wait":
      return (
        <div className="mt-1.5 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[13px] text-amber-800">
          This request requires human approval before executing. A compliance approver has been
          notified.
        </div>
      );

    case "decision": {
      const d = stage.detail as {
        actor?: string;
        decision?: string;
        metadata?: Record<string, unknown>;
      } | null;
      if (!d) return null;
      const reason = d.metadata?.decision_reason as string | undefined;
      return (
        <div className="text-[13px] text-gray-600 space-y-0.5 mt-1.5">
          <p>
            {d.decision === "REJECTED" ? "Rejected" : "Approved"} by{" "}
            <span className="font-medium text-gray-900">{d.actor ?? "—"}</span>
          </p>
          {reason && <p className="text-gray-500">Reason: {reason}</p>}
        </div>
      );
    }

    case "executing": {
      const d = stage.detail as {
        results?: Array<{
          tool: unknown;
          action: unknown;
          ok: unknown;
          duration_ms: unknown;
        }>;
      } | null;
      if (!d?.results?.length) return null;
      return (
        <div className="mt-1.5 overflow-x-auto">
          <table className="text-[12px] text-gray-600 border-collapse">
            <thead>
              <tr className="text-gray-400 text-left">
                <th className="pr-5 font-medium pb-1">Tool</th>
                <th className="pr-5 font-medium pb-1">Action</th>
                <th className="pr-5 font-medium pb-1">Status</th>
                <th className="font-medium pb-1">Duration</th>
              </tr>
            </thead>
            <tbody>
              {d.results.map((r, i) => (
                <tr key={i}>
                  <td className="pr-5 py-0.5 font-mono">{String(r.tool ?? "—")}</td>
                  <td className="pr-5 py-0.5 font-mono">{String(r.action ?? "—")}</td>
                  <td className="pr-5 py-0.5">{r.ok ? "✅" : "❌"}</td>
                  <td className="py-0.5 text-gray-400">
                    {r.duration_ms != null ? `${Number(r.duration_ms).toFixed(2)}ms` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case "terminal": {
      if (req.status === "REJECTED") return null;
      if (req.status === "AWAITING_APPROVAL" || req.status === "APPROVED") {
        return (
          <p className="text-[13px] text-gray-500 mt-1.5">
            Waiting for approval — execution will begin once a compliance approver approves this
            request.
          </p>
        );
      }
      if (!TERMINAL.has(req.status)) return null;
      const stepsOk = req.execution_results?.filter((r) => r.ok).length ?? 0;
      const stepsTotal = req.execution_results?.length ?? 0;
      const allOk = stepsTotal === 0 || stepsOk === stepsTotal;
      const completedAt = req.updated_at ? fmt(req.updated_at) : "—";
      return (
        <p className="text-[13px] text-gray-600 mt-1.5">
          {req.status === "COMPLETED" && allOk
            ? `All steps completed successfully at ${completedAt}`
            : req.status === "FAILED"
            ? (req.error_message ?? "Request failed — check steps above")
            : `Completed with errors — ${stepsOk} of ${stepsTotal} steps succeeded`}
        </p>
      );
    }

    default:
      return null;
  }
}

function StageRow({
  stage,
  req,
  isLast,
}: {
  stage: Stage;
  req: OpsRequest;
  isLast: boolean;
}) {
  return (
    <div className="flex gap-4">
      {/* connector column */}
      <div className="flex flex-col items-center w-5 shrink-0">
        <div className={`w-2 h-2 rounded-full shrink-0 mt-[5px] ${DOT_CLS[stage.state]}`} />
        {!isLast && <div className="w-px flex-1 mt-1 bg-[#e8e8e4]" />}
      </div>

      {/* content */}
      <div className={`flex-1 min-w-0 ${isLast ? "pb-0" : "pb-5"}`}>
        <span className="font-sora text-sm font-semibold text-gray-900 leading-snug">
          {stage.title}
        </span>

        {stage.timestamp && (
          <p className="text-xs text-gray-400 mt-0.5">{fmt(stage.timestamp)}</p>
        )}

        <StageSummary stage={stage} req={req} />
      </div>
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <Layout>
      <div className="animate-pulse space-y-4 max-w-2xl mx-auto">
        <div className="bg-white rounded-[14px] border border-[#e8e8e4] p-6 space-y-3">
          <div className="h-5 bg-gray-200 rounded w-1/3" />
          <div className="h-4 bg-gray-100 rounded w-1/2" />
          <div className="h-3 bg-gray-100 rounded w-1/4 mt-2" />
        </div>
        <div className="bg-white rounded-[14px] border border-[#e8e8e4] p-6 space-y-6">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex gap-4">
              <div className="w-2 h-2 rounded-full bg-gray-200 mt-1 shrink-0" />
              <div className="flex-1 space-y-1 pb-4">
                <div className="h-4 bg-gray-200 rounded w-1/4" />
                <div className="h-3 bg-gray-100 rounded w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Layout>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RequestDetailPage() {
  const { request_id } = useParams<{ request_id: string }>();
  const router = useRouter();
  const role = useRole();
  const searchParams = useSearchParams();
  const fromApprovals = searchParams.get("from") === "approvals";

  // HR coordinators should never land on request detail — send them home
  useEffect(() => {
    if (role === "hr") router.replace("/hr");
  }, [role, router]);
  const [req, setReq] = useState<OpsRequest | null>(null);
  const [audit, setAudit] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // clarification form
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [clarifyError, setClarifyError] = useState("");
  const [clarifyLoading, setClarifyLoading] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const doFetch = useCallback(async () => {
    try {
      const [r, a] = await Promise.all([
        requests.get(request_id),
        requests.audit(request_id).catch(() => [] as AuditLogEntry[]),
      ]);
      setReq(r);
      setAudit(a);
      return r;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load request");
      return null;
    } finally {
      setLoading(false);
    }
  }, [request_id]);

  useEffect(() => {
    doFetch().then((r) => {
      if (r && !TERMINAL.has(r.status)) {
        pollRef.current = setInterval(async () => {
          const updated = await doFetch();
          if (updated && TERMINAL.has(updated.status)) {
            clearInterval(pollRef.current!);
          }
        }, 2000);
      }
    });
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [doFetch]);

  async function submitClarification(e: React.FormEvent) {
    e.preventDefault();
    setClarifyError("");
    setClarifyLoading(true);
    try {
      const updated = await requests.clarify(request_id, answers);
      setReq(updated);
      setAnswers({});
      if (!TERMINAL.has(updated.status)) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(async () => {
          const r = await doFetch();
          if (r && TERMINAL.has(r.status)) clearInterval(pollRef.current!);
        }, 2000);
      }
    } catch (e: unknown) {
      setClarifyError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setClarifyLoading(false);
    }
  }

  if (loading) return <Skeleton />;
  if (error) return <Layout><div className="pt-4 max-w-2xl mx-auto"><ErrorMsg msg={error} /></div></Layout>;
  if (!req) return null;

  const stages = buildTimeline(req, audit);
  const completedCount = stages.filter((s) => s.state === "completed").length;
  const isPolling = !TERMINAL.has(req.status);
  const plan = req.task_plan;
  const resource = getResource(req.intent, req.payload);
  const label = getLabel(req.intent);

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-4">

        {/* ── Header card ───────────────────────────────────────────── */}
        <div className="bg-white rounded-[14px] border border-[#e8e8e4] p-6">
          {/* Back link */}
          <a
            href={role === "hr" ? "/hr" : fromApprovals ? "/approvals" : "/my-requests"}
            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mb-4 transition-colors"
          >
            {role === "hr" ? "← HR Events" : fromApprovals ? "← Approvals" : "← My Requests"}
          </a>

          {/* Title + badges */}
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h1 className="font-sora text-xl font-bold text-gray-900 leading-tight">
                {label}
                {resource ? ` — ${resource}` : ""}
              </h1>
              <p className="text-xs text-gray-400 mt-1">
                Requested by {req.requester_id} · {timeAgo(req.created_at)}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              <StatusBadge status={req.status} />
              {req.risk_level && <RiskBadge level={req.risk_level} />}
              {isPolling && (
                <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse inline-block" />
                  Live
                </span>
              )}
            </div>
          </div>

          {/* Step count */}
          <p className="text-xs text-gray-400 mt-3">
            Step {completedCount} of {stages.length} completed
          </p>

          {/* Expiry / auto-revoked */}
          {req.expires_at && (
            <div className="flex items-center gap-2 text-xs mt-3 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400 inline-block" />
                Expires {fmt(req.expires_at)}
              </span>
              {req.auto_revoked && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 text-red-700 font-medium">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500 inline-block" />
                  Auto-revoked
                  {req.revoke_request_id && (
                    <a
                      href={`/requests/${req.revoke_request_id}`}
                      className="ml-1 underline hover:text-red-900"
                    >
                      View →
                    </a>
                  )}
                </span>
              )}
            </div>
          )}
        </div>

        {/* ── Clarification callout ──────────────────────────────────── */}
        {req.status === "NEEDS_CLARIFICATION" && plan && plan.questions.length > 0 && (
          <div className="bg-white rounded-[14px] border border-[#e8e8e4] p-6">
            <p className="text-sm font-semibold text-purple-800 mb-4">
              Clarification required before planning can continue
            </p>
            {clarifyError && (
              <div className="mb-3">
                <ErrorMsg msg={clarifyError} />
              </div>
            )}
            <form onSubmit={submitClarification} className="space-y-4">
              {plan.questions.map((q, idx) => (
                <div key={idx}>
                  <label className="block text-sm font-medium text-gray-800 mb-1">
                    {idx + 1}. {q}
                  </label>
                  <input
                    type="text"
                    required
                    value={answers[q] ?? ""}
                    onChange={(e) =>
                      setAnswers((prev) => ({ ...prev, [q]: e.target.value }))
                    }
                    className="w-full rounded-[9px] border border-[#e8e8e4] px-3 py-2 text-sm focus:outline-none focus:border-[#111] focus:shadow-[0_0_0_3px_rgba(0,0,0,0.06)] bg-white transition-shadow"
                    placeholder="Your answer…"
                  />
                </div>
              ))}
              <button
                type="submit"
                disabled={clarifyLoading}
                className="rounded-[9px] bg-[#111] text-white px-5 py-2 text-sm font-sora font-semibold hover:bg-black disabled:opacity-40 transition-colors"
              >
                {clarifyLoading ? "Submitting…" : "Submit Answers"}
              </button>
            </form>
          </div>
        )}

        {/* ── Safety flags ──────────────────────────────────────────── */}
        {(req.request_safety_flags ?? []).length > 0 && (
          <div className="rounded-[14px] bg-orange-50 border border-orange-200 px-4 py-3">
            <p className="text-xs font-semibold text-orange-700 mb-1">Safety Flags</p>
            <div className="flex flex-wrap gap-1">
              {req.request_safety_flags!.map((f, i) => (
                <span key={i} className="px-2 py-0.5 rounded bg-orange-100 text-orange-700 text-xs">
                  {f}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── Timeline ──────────────────────────────────────────────── */}
        <div className="bg-white rounded-[14px] border border-[#e8e8e4] p-6">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-6">
            Timeline
          </h2>
          {stages.map((stage, i) => (
            <StageRow
              key={stage.id}
              stage={stage}
              req={req}
              isLast={i === stages.length - 1}
            />
          ))}
        </div>


      </div>
    </Layout>
  );
}

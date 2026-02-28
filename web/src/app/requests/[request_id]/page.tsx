"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Layout, { RiskBadge, StatusBadge, ErrorMsg } from "@/lib/Layout";
import { requests, type OpsRequest, type AuditLogEntry } from "@/lib/api";

const TERMINAL = new Set(["COMPLETED", "REJECTED", "FAILED"]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(s: string | null | undefined): string {
  if (!s) return "—";
  // Backend stores naive UTC datetimes — append Z so JS interprets as UTC
  const ts = s.endsWith("Z") || s.includes("+") ? s : s + "Z";
  return new Date(ts).toLocaleString();
}

function auditTs(audit: AuditLogEntry[], action: string): string | undefined {
  return audit.find((a) => a.action === action)?.created_at;
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

  // Derive approval audit entry
  const approvalEntry =
    audit.find((a) => a.action === "REQUEST_APPROVED") ??
    audit.find((a) => a.action === "REQUEST_REJECTED");

  const stages: Stage[] = [
    // A — submitted
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

    // B — plan generated
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

    // C — risk assessed
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

    // D — awaiting approval (conditional)
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

    // E — approved/rejected (conditional, only when resolved)
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

    // F — executing
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

    // G — terminal
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

const STAGE_ICON: Record<StageState, string> = {
  completed: "✅",
  active: "⏳",
  failed: "❌",
  upcoming: "⚪",
};

const STAGE_ACCENT: Record<StageState, { dot: string; title: string; line: string; pill: string }> = {
  completed: {
    dot: "bg-green-500 border-green-200",
    title: "text-gray-900",
    line: "bg-green-200",
    pill: "bg-green-50 text-green-700",
  },
  active: {
    dot: "bg-amber-400 border-amber-100 animate-pulse",
    title: "text-gray-900 font-semibold",
    line: "bg-gray-200",
    pill: "bg-amber-50 text-amber-700",
  },
  failed: {
    dot: "bg-red-500 border-red-200",
    title: "text-red-700",
    line: "bg-red-200",
    pill: "bg-red-50 text-red-700",
  },
  upcoming: {
    dot: "bg-gray-200 border-gray-100",
    title: "text-gray-400",
    line: "bg-gray-100",
    pill: "bg-gray-50 text-gray-400",
  },
};

function StageRow({
  stage,
  isLast,
  expanded,
  onToggle,
}: {
  stage: Stage;
  isLast: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const ac = STAGE_ACCENT[stage.state];
  const hasDetail = stage.detail !== null && stage.detail !== undefined;

  return (
    <div className="flex gap-4">
      {/* connector column */}
      <div className="flex flex-col items-center w-8 shrink-0">
        <div
          className={`w-4 h-4 rounded-full border-2 shrink-0 mt-1 ${ac.dot}`}
        />
        {!isLast && <div className={`w-0.5 flex-1 mt-1 ${ac.line}`} />}
      </div>

      {/* content */}
      <div className={`pb-6 flex-1 min-w-0 ${isLast ? "pb-0" : ""}`}>
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base">{STAGE_ICON[stage.state]}</span>
            <span className={`text-sm ${ac.title}`}>{stage.title}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ac.pill}`}>
              {stage.state}
            </span>
          </div>
          {hasDetail && (
            <button
              aria-expanded={expanded}
              onClick={onToggle}
              className="text-xs text-indigo-500 hover:text-indigo-700 transition-colors shrink-0"
            >
              {expanded ? "Hide details ▲" : "View details ▼"}
            </button>
          )}
        </div>

        {stage.timestamp && (
          <p className="text-xs text-gray-400 mt-0.5 ml-7">{fmt(stage.timestamp)}</p>
        )}

        {expanded && hasDetail && (
          <pre className="mt-2 ml-7 text-xs text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 overflow-x-auto max-h-64 scrollbar-thin">
            {JSON.stringify(stage.detail, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <Layout>
      <div className="animate-pulse space-y-4">
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
          <div className="h-6 bg-gray-200 rounded w-1/3" />
          <div className="h-3 bg-gray-100 rounded w-1/2" />
          <div className="h-2 bg-gray-100 rounded w-full mt-4" />
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex gap-4">
              <div className="w-4 h-4 rounded-full bg-gray-200 mt-1 shrink-0" />
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
  const [req, setReq] = useState<OpsRequest | null>(null);
  const [audit, setAudit] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

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

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function copyId() {
    if (!req) return;
    navigator.clipboard.writeText(req.id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  if (loading) return <Skeleton />;
  if (error) return <Layout><div className="pt-4"><ErrorMsg msg={error} /></div></Layout>;
  if (!req) return null;

  const stages = buildTimeline(req, audit);
  const completedCount = stages.filter((s) => s.state === "completed").length;
  const progressPct = Math.round((completedCount / stages.length) * 100);
  const isPolling = !TERMINAL.has(req.status);
  const plan = req.task_plan;

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-4">
        {/* ── Header card ───────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
            <h1 className="text-lg font-bold font-mono text-gray-900 leading-tight">
              {req.intent}
            </h1>
            <div className="flex items-center gap-2 shrink-0">
              <StatusBadge status={req.status} />
              {req.risk_level && <RiskBadge level={req.risk_level} />}
              {isPolling && (
                <span className="inline-flex items-center gap-1 text-xs text-indigo-500 animate-pulse">
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 inline-block" />
                  Live
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-gray-400 mt-1 mb-4 flex-wrap">
            <span className="font-mono text-gray-400">{req.id.slice(0, 6)}…</span>
            <button
              onClick={copyId}
              className="px-1.5 py-0.5 rounded border border-gray-200 hover:bg-gray-50 text-gray-500 transition-colors"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
            <span>·</span>
            <span>Submitted {fmt(req.created_at)}</span>
            {plan?.confidence !== undefined && (
              <>
                <span>·</span>
                <span>Confidence {(plan.confidence * 100).toFixed(0)}%</span>
              </>
            )}
          </div>

          {/* Progress bar */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-xs text-gray-400 shrink-0 w-10 text-right">
              {progressPct}%
            </span>
          </div>
        </div>

        {/* ── Clarification callout ──────────────────────────────────── */}
        {req.status === "NEEDS_CLARIFICATION" && plan && plan.questions.length > 0 && (
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-6">
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
                  <label className="block text-sm font-medium text-purple-900 mb-1">
                    {idx + 1}. {q}
                  </label>
                  <input
                    type="text"
                    required
                    value={answers[q] ?? ""}
                    onChange={(e) =>
                      setAnswers((prev) => ({ ...prev, [q]: e.target.value }))
                    }
                    className="w-full rounded-lg border border-purple-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    placeholder="Your answer…"
                  />
                </div>
              ))}
              <button
                type="submit"
                disabled={clarifyLoading}
                className="rounded-lg bg-purple-600 text-white px-5 py-2 text-sm font-medium hover:bg-purple-700 disabled:opacity-50 transition-colors"
              >
                {clarifyLoading ? "Submitting…" : "Submit Answers"}
              </button>
            </form>
          </div>
        )}

        {/* ── Safety flags ──────────────────────────────────────────── */}
        {(req.request_safety_flags ?? []).length > 0 && (
          <div className="rounded-xl bg-orange-50 border border-orange-200 px-4 py-3">
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
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-6">
            Tracking
          </h2>
          <div>
            {stages.map((stage, i) => (
              <StageRow
                key={stage.id}
                stage={stage}
                isLast={i === stages.length - 1}
                expanded={expanded.has(stage.id)}
                onToggle={() => toggleExpanded(stage.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
}

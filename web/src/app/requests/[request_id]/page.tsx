"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Layout, { RiskBadge, StatusBadge, ErrorMsg, Spinner } from "@/lib/Layout";
import { requests, type OpsRequest, type AuditLogEntry } from "@/lib/api";

const TERMINAL = new Set(["COMPLETED", "REJECTED", "FAILED"]);

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
      <h3 className="text-sm font-semibold text-gray-700 mb-4 uppercase tracking-wide">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Tag({ text }: { text: string }) {
  return (
    <span className="inline-block px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-xs mr-1 mb-1">
      {text}
    </span>
  );
}

export default function RequestDetailPage() {
  const { request_id } = useParams<{ request_id: string }>();
  const [req, setReq] = useState<OpsRequest | null>(null);
  const [audit, setAudit] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // clarification form
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [clarifyError, setClarifyError] = useState("");
  const [clarifyLoading, setClarifyLoading] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetch = useCallback(async () => {
    try {
      const [r, a] = await Promise.all([
        requests.get(request_id),
        requests.audit(request_id),
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
    fetch().then((r) => {
      if (r && !TERMINAL.has(r.status)) {
        pollRef.current = setInterval(async () => {
          const updated = await fetch();
          if (updated && TERMINAL.has(updated.status)) {
            clearInterval(pollRef.current!);
          }
        }, 2000);
      }
    });
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetch]);

  async function submitClarification(e: React.FormEvent) {
    e.preventDefault();
    setClarifyError("");
    setClarifyLoading(true);
    try {
      const updated = await requests.clarify(request_id, answers);
      setReq(updated);
      setAnswers({});
      // restart polling
      if (!TERMINAL.has(updated.status)) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(async () => {
          const r = await fetch();
          if (r && TERMINAL.has(r.status)) clearInterval(pollRef.current!);
        }, 2000);
      }
    } catch (e: unknown) {
      setClarifyError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setClarifyLoading(false);
    }
  }

  if (loading) return <Layout><Spinner /></Layout>;
  if (error) return <Layout><ErrorMsg msg={error} /></Layout>;
  if (!req) return null;

  const plan = req.task_plan;
  const isPolling = !TERMINAL.has(req.status);

  return (
    <Layout>
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="mb-6">
        <div className="flex items-start gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold font-mono">{req.intent}</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              {req.id} · {new Date(req.created_at).toLocaleString()}
            </p>
          </div>
          <div className="flex gap-2 items-center ml-auto">
            <StatusBadge status={req.status} />
            {req.risk_level && <RiskBadge level={req.risk_level} />}
            {isPolling && (
              <span className="inline-flex items-center gap-1 text-xs text-indigo-500 animate-pulse">
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 inline-block" />
                Polling…
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {/* ── Error / safety flags ─────────────────────────────────── */}
        {req.error_message && <ErrorMsg msg={req.error_message} />}

        {(req.request_safety_flags ?? []).length > 0 && (
          <div className="rounded-md bg-orange-50 border border-orange-200 px-4 py-3">
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

        {/* ── Clarification form ───────────────────────────────────── */}
        {req.status === "NEEDS_CLARIFICATION" && plan && plan.questions.length > 0 && (
          <Section title="Clarification Required">
            {clarifyError && (
              <div className="mb-3">
                <ErrorMsg msg={clarifyError} />
              </div>
            )}
            <form onSubmit={submitClarification} className="space-y-4">
              {plan.questions.map((q, idx) => (
                <div key={idx}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {idx + 1}. {q}
                  </label>
                  <input
                    type="text"
                    required
                    value={answers[q] ?? ""}
                    onChange={(e) =>
                      setAnswers((prev) => ({ ...prev, [q]: e.target.value }))
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="Your answer…"
                  />
                </div>
              ))}
              <button
                type="submit"
                disabled={clarifyLoading}
                className="rounded-lg bg-indigo-600 text-white px-5 py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {clarifyLoading ? "Submitting…" : "Submit Answers"}
              </button>
            </form>
          </Section>
        )}

        {/* ── Task plan ────────────────────────────────────────────── */}
        {plan && (
          <Section title="Task Plan">
            {/* meta */}
            <div className="flex flex-wrap gap-4 text-xs text-gray-500 mb-4 pb-3 border-b border-gray-100">
              {plan.overall_risk && (
                <span>
                  Overall risk: <RiskBadge level={plan.overall_risk} />
                </span>
              )}
              {plan.confidence !== undefined && (
                <span>Confidence: {(plan.confidence * 100).toFixed(0)}%</span>
              )}
              {plan.model_name && <span>Model: {plan.model_name}</span>}
            </div>

            {plan.risk_summary && (
              <p className="text-sm text-gray-600 mb-4">{plan.risk_summary}</p>
            )}

            {/* Steps */}
            {plan.plan.length > 0 && (
              <div className="space-y-2 mb-4">
                {plan.plan.map((step) => (
                  <div
                    key={step.step_id}
                    className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3"
                  >
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-xs font-mono text-gray-400">
                        {step.step}.
                      </span>
                      <span className="text-sm font-medium">{step.name}</span>
                      <RiskBadge level={step.risk} />
                      {step.requires_approval && (
                        <span className="px-1.5 py-0.5 rounded text-xs bg-yellow-100 text-yellow-700 font-medium">
                          Needs approval
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">
                      <span className="font-medium">{step.tool}</span> /{" "}
                      {step.action}
                    </p>
                    {Object.keys(step.args).length > 0 && (
                      <pre className="mt-1 text-xs text-gray-500 bg-white rounded border border-gray-100 px-2 py-1 overflow-x-auto">
                        {JSON.stringify(step.args, null, 2)}
                      </pre>
                    )}
                    {step.reason && (
                      <p className="text-xs text-gray-400 mt-1 italic">
                        {step.reason}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Policy, assumptions, evidence */}
            {plan.assumptions.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-semibold text-gray-500 mb-1">Assumptions</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {plan.assumptions.map((a, i) => (
                    <li key={i} className="text-xs text-gray-600">
                      {a}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {plan.policy_references.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-semibold text-gray-500 mb-1">
                  Policy References
                </p>
                <div className="flex flex-wrap gap-2">
                  {plan.policy_references.map((p) => (
                    <span
                      key={p.id}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 text-xs"
                    >
                      {p.id}: {p.title}
                      <RiskBadge level={p.severity} />
                    </span>
                  ))}
                </div>
              </div>
            )}

            {plan.evidence.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-semibold text-gray-500 mb-1">Evidence</p>
                <div className="flex flex-wrap">
                  {plan.evidence.map((ev, i) => (
                    <Tag
                      key={i}
                      text={[ev.type, ev.field, ev.value, ev.snippet]
                        .filter(Boolean)
                        .join(": ")}
                    />
                  ))}
                </div>
              </div>
            )}

            {plan.safety_flags.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-orange-600 mb-1">Safety Flags</p>
                <div className="flex flex-wrap">
                  {plan.safety_flags.map((f, i) => (
                    <Tag key={i} text={f} />
                  ))}
                </div>
              </div>
            )}
          </Section>
        )}

        {/* ── Execution results ────────────────────────────────────── */}
        {req.execution_results && req.execution_results.length > 0 && (
          <Section title="Execution Results">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-100">
                    <th className="pb-2 pr-3 font-medium">#</th>
                    <th className="pb-2 pr-3 font-medium">Tool / Action</th>
                    <th className="pb-2 pr-3 font-medium">OK</th>
                    <th className="pb-2 pr-3 font-medium">Duration (ms)</th>
                    <th className="pb-2 font-medium">Data / Error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {req.execution_results.map((r, i) => (
                    <tr key={i}>
                      <td className="py-2 pr-3 text-gray-400">{i + 1}</td>
                      <td className="py-2 pr-3 font-mono">
                        {String(r.tool_name ?? "—")}/{String(r.action_name ?? "—")}
                      </td>
                      <td className="py-2 pr-3">
                        <span
                          className={`font-semibold ${r.ok ? "text-green-600" : "text-red-600"}`}
                        >
                          {r.ok ? "✓" : "✗"}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-gray-500">
                        {r.execution_duration_ms !== undefined
                          ? String(r.execution_duration_ms)
                          : "—"}
                      </td>
                      <td className="py-2 text-gray-500 max-w-[280px] truncate">
                        {r.error
                          ? String(r.error)
                          : r.data
                          ? JSON.stringify(r.data)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {/* ── Audit timeline ───────────────────────────────────────── */}
        {audit.length > 0 && (
          <Section title="Audit Timeline">
            <ol className="relative border-l border-gray-200 space-y-4">
              {audit.map((entry) => (
                <li key={entry.id} className="pl-5">
                  <span className="absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full bg-indigo-400 border-2 border-white" />
                  <div className="flex flex-wrap items-center gap-2 mb-0.5">
                    <span className="text-xs font-semibold text-gray-700">
                      {entry.action}
                    </span>
                    {entry.decision && (
                      <span
                        className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                          entry.decision === "approved"
                            ? "bg-green-100 text-green-700"
                            : entry.decision === "rejected"
                            ? "bg-red-100 text-red-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {entry.decision}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">
                    {entry.actor} ·{" "}
                    {new Date(entry.created_at).toLocaleString()}
                  </p>
                </li>
              ))}
            </ol>
          </Section>
        )}

        {/* ── Raw payload ──────────────────────────────────────────── */}
        <Section title="Request Payload">
          <pre className="text-xs text-gray-600 overflow-x-auto">
            {JSON.stringify(req.payload, null, 2)}
          </pre>
        </Section>
      </div>
    </Layout>
  );
}

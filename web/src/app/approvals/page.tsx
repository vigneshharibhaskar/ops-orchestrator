"use client";

import { Fragment, useEffect, useState, useCallback } from "react";
import Layout, { RiskBadge, StatusBadge, ErrorMsg, Spinner } from "@/lib/Layout";
import { approvals, requests, type OpsRequest } from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function fmt(s: string | null | undefined): string {
  if (!s) return "—";
  const ts = s.endsWith("Z") || s.includes("+") ? s : s + "Z";
  return new Date(ts).toLocaleString();
}

function stripRiskPrefix(s: string): string {
  return s.replace(/RiskLevel\./gi, "");
}

function expiryDisplay(req: OpsRequest): { text: string; cls: string } | null {
  if (!req.expires_at) return null;
  const ts = req.expires_at.endsWith("Z") || req.expires_at.includes("+")
    ? req.expires_at : req.expires_at + "Z";
  const exp = new Date(ts);
  const diffDays = (exp.getTime() - Date.now()) / 86400000;
  if (diffDays < 0) return { text: exp.toLocaleDateString(), cls: "text-red-500" };
  if (diffDays < 7) return { text: exp.toLocaleDateString(), cls: "text-amber-500" };
  return { text: exp.toLocaleDateString(), cls: "text-gray-500" };
}

const PAGE_SIZE = 15;

// ── ExpandedPanel ─────────────────────────────────────────────────────────────

function ExpandedPanel({
  req,
  reason,
  onReasonChange,
  onDecide,
  isActing,
  actionError,
}: {
  req: OpsRequest;
  reason: string;
  onReasonChange: (v: string) => void;
  onDecide: (action: "approve" | "reject") => void;
  isActing: "approve" | "reject" | null;
  actionError: string;
}) {
  const label = getLabel(req.intent);
  const resource = getResource(req.intent, req.payload);
  const riskSummary = req.task_plan?.risk_summary
    ? stripRiskPrefix(req.task_plan.risk_summary)
    : null;
  const summaryLower = riskSummary?.toLowerCase() ?? "";
  const riskFlags = (req.risk_flags ?? []).filter(
    (f) => !summaryLower.includes(f.toLowerCase())
  );
  const policyRef = req.task_plan?.policy_references?.[0];
  const hasAiReasoning = riskSummary || riskFlags.length > 0 || policyRef;

  return (
    <div className="px-5 pt-4 pb-5 border-t border-[#e8e8e4]">
      {/* AI Reasoning */}
      <div className="rounded-lg bg-[#f9f9f7] border border-[#e8e8e4] px-4 py-3 mb-4">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
          AI Reasoning
        </p>
        {riskSummary && (
          <p className="text-[13px] text-gray-700 mb-2">{riskSummary}</p>
        )}
        {riskFlags.length > 0 && (
          <ul className="list-disc list-inside text-[12px] text-gray-600 space-y-0.5 mb-2">
            {riskFlags.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        )}
        {policyRef && (
          <p className="text-[12px] text-gray-500">
            Policy: {policyRef.title} ({stripRiskPrefix(policyRef.severity)})
          </p>
        )}
        {!hasAiReasoning && (
          <p className="text-[12px] text-gray-400 italic">No AI reasoning available</p>
        )}
      </div>

      {/* Request details */}
      <div className="grid grid-cols-3 gap-x-4 gap-y-3 text-[12px] mb-4">
        <div>
          <span className="text-gray-400 block mb-0.5">System</span>
          <span className="text-gray-800 font-medium">{label}</span>
        </div>
        <div>
          <span className="text-gray-400 block mb-0.5">Resource</span>
          <span className="text-gray-800 font-mono">{resource || "—"}</span>
        </div>
        <div>
          <span className="text-gray-400 block mb-0.5">Permission</span>
          <span className="text-gray-800">{String(req.payload?.permission ?? "—")}</span>
        </div>
        <div className="col-span-2">
          <span className="text-gray-400 block mb-0.5">Justification</span>
          <span className="text-gray-800">{String(req.payload?.justification ?? "—")}</span>
        </div>
        <div>
          <span className="text-gray-400 block mb-0.5">Submitted</span>
          <span className="text-gray-800">{timeAgo(req.created_at)}</span>
        </div>
        {req.expires_at && (
          <div>
            <span className="text-gray-400 block mb-0.5">Expires</span>
            <span className="text-gray-800">{fmt(req.expires_at)}</span>
          </div>
        )}
      </div>

      <hr className="border-[#e8e8e4] mb-4" />

      {/* Decision */}
      <div>
        <p className="text-[12px] font-semibold text-gray-700 mb-2">Your decision</p>
        {actionError && <p className="text-xs text-red-600 mb-2">{actionError}</p>}
        <textarea
          rows={2}
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          placeholder="Explain your decision (required — minimum 20 characters)…"
          className="w-full rounded-[9px] border border-[#e8e8e4] px-3 py-2 text-sm focus:outline-none focus:border-[#111] focus:shadow-[0_0_0_3px_rgba(0,0,0,0.06)] bg-white resize-none transition-shadow"
        />
        <p className={`text-[11px] mt-1 mb-3 ${reason.length >= 20 ? "text-green-600" : "text-gray-400"}`}>
          {reason.length} / 20 minimum
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => onDecide("approve")}
            disabled={reason.length < 20 || isActing !== null}
            className="flex-1 rounded-[9px] bg-[#111] text-white py-2 text-sm font-sora font-semibold hover:bg-black disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
          >
            {isActing === "approve" ? (
              <><span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />Approving…</>
            ) : "Approve"}
          </button>
          <button
            onClick={() => onDecide("reject")}
            disabled={reason.length < 20 || isActing !== null}
            className="flex-1 rounded-[9px] border border-red-300 text-red-600 py-2 text-sm font-sora font-semibold hover:bg-red-50 disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
          >
            {isActing === "reject" ? (
              <><span className="h-3.5 w-3.5 rounded-full border-2 border-red-200 border-t-red-500 animate-spin" />Rejecting…</>
            ) : "Reject"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ApprovalsPage() {
  // ── Tab ──
  const [activeTab, setActiveTab] = useState<"pending" | "history">("pending");

  // ── Pending state ──
  const [fullReqs, setFullReqs] = useState<OpsRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [acting, setActing] = useState<Record<string, "approve" | "reject" | null>>({});
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingPage, setPendingPage] = useState(1);

  // ── History state ──
  const [histReqs, setHistReqs] = useState<OpsRequest[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [histError, setHistError] = useState("");
  const [histFilter, setHistFilter] = useState("ALL");
  const [histSearch, setHistSearch] = useState("");
  const [histPage, setHistPage] = useState(1);

  // ── Pending: fetch + poll ──
  const fetchPending = useCallback(async () => {
    try {
      const list = await approvals.pending();
      const full = await Promise.all(list.map((item) => requests.get(item.id)));
      setFullReqs(full);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load pending approvals");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPending();
    const id = setInterval(fetchPending, 5000);
    return () => clearInterval(id);
  }, [fetchPending]);

  // ── History: fetch when tab activates ──
  useEffect(() => {
    if (activeTab !== "history") return;
    setHistLoading(true);
    setHistError("");
    requests
      .list(500)
      .then((list) =>
        setHistReqs(list.filter((r) => r.status !== "AWAITING_APPROVAL"))
      )
      .catch((e) =>
        setHistError(e instanceof Error ? e.message : "Failed to load history")
      )
      .finally(() => setHistLoading(false));
  }, [activeTab]);

  // ── Pending: helpers ──
  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  async function handleDecision(req: OpsRequest, action: "approve" | "reject") {
    const reason = (reasons[req.id] ?? "").trim();
    if (reason.length < 20) return;
    setActing((p) => ({ ...p, [req.id]: action }));
    setActionErrors((p) => ({ ...p, [req.id]: "" }));
    try {
      if (action === "approve") await approvals.approve(req.id, reason);
      else await approvals.reject(req.id, reason);
      setExpandedId((prev) => (prev === req.id ? null : prev));
      setDismissed((p) => new Set(p).add(req.id));
      setTimeout(() => {
        setFullReqs((p) => p.filter((r) => r.id !== req.id));
        setDismissed((p) => { const s = new Set(p); s.delete(req.id); return s; });
      }, 400);
    } catch (e: unknown) {
      setActionErrors((p) => ({
        ...p,
        [req.id]: e instanceof Error ? e.message : "Action failed",
      }));
    } finally {
      setActing((p) => ({ ...p, [req.id]: null }));
    }
  }

  // ── Pending: pagination ──
  const pendingTotalPages = Math.max(1, Math.ceil(fullReqs.length / PAGE_SIZE));
  const pendingSafePage = Math.min(pendingPage, pendingTotalPages);
  const pendingPaginated = fullReqs.slice((pendingSafePage - 1) * PAGE_SIZE, pendingSafePage * PAGE_SIZE);
  const pendingShowStart = fullReqs.length === 0 ? 0 : (pendingSafePage - 1) * PAGE_SIZE + 1;
  const pendingShowEnd = Math.min(pendingSafePage * PAGE_SIZE, fullReqs.length);

  // ── History: counts + filter + search + pagination ──
  const histCounts: Record<string, number> = {
    ALL: histReqs.length,
    APPROVED: histReqs.filter((r) => ["COMPLETED", "APPROVED", "EXECUTING"].includes(r.status)).length,
    REJECTED: histReqs.filter((r) => r.status === "REJECTED").length,
    AUTO_REVOKED: histReqs.filter((r) => !!r.auto_revoked).length,
  };

  const histFiltered = histReqs
    .filter((r) => {
      if (histFilter === "APPROVED") return ["COMPLETED", "APPROVED", "EXECUTING"].includes(r.status);
      if (histFilter === "REJECTED") return r.status === "REJECTED";
      if (histFilter === "AUTO_REVOKED") return !!r.auto_revoked;
      return true;
    })
    .filter((r) => {
      if (!histSearch.trim()) return true;
      const q = histSearch.toLowerCase();
      return (
        getLabel(r.intent).toLowerCase().includes(q) ||
        r.requester_id.toLowerCase().includes(q) ||
        getResource(r.intent, r.payload).toLowerCase().includes(q)
      );
    });

  const histTotalPages = Math.max(1, Math.ceil(histFiltered.length / PAGE_SIZE));
  const histSafePage = Math.min(histPage, histTotalPages);
  const histPaginated = histFiltered.slice((histSafePage - 1) * PAGE_SIZE, histSafePage * PAGE_SIZE);
  const histShowStart = histFiltered.length === 0 ? 0 : (histSafePage - 1) * PAGE_SIZE + 1;
  const histShowEnd = Math.min(histSafePage * PAGE_SIZE, histFiltered.length);

  const histPillCls = (f: string) =>
    `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
      histFilter === f
        ? "bg-[#111] text-white"
        : "bg-white border border-[#e8e8e4] text-gray-600 hover:bg-gray-50"
    }`;

  const HIST_PILLS = [
    { key: "ALL",         label: "All" },
    { key: "APPROVED",    label: "Approved" },
    { key: "REJECTED",    label: "Rejected" },
    { key: "AUTO_REVOKED", label: "Auto-revoked" },
  ];

  // ── Shared pagination renderer ──
  function PaginationFooter({
    showStart, showEnd, total, totalPages, currentPage, onPageChange,
  }: {
    showStart: number; showEnd: number; total: number;
    totalPages: number; currentPage: number; onPageChange: (p: number) => void;
  }) {
    return (
      <div className="px-5 py-3 border-t border-[#e8e8e4] flex items-center justify-between">
        <span className="text-xs text-gray-400">
          Showing {showStart}–{showEnd} of {total} requests
        </span>
        {totalPages > 1 && (
          <div className="flex gap-1">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => onPageChange(p)}
                className={`w-7 h-7 rounded text-xs font-medium transition-colors ${
                  p === currentPage ? "bg-[#111] text-white" : "text-gray-500 hover:bg-gray-100"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <Layout>
      <div className="pb-12">
        {/* Page header */}
        <div className="mb-6">
          <div className="flex items-center gap-3">
            <h1 className="font-sora text-[22px] font-bold text-gray-900">Approvals</h1>
            {!loading && fullReqs.length > 0 && (
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                {fullReqs.length} pending
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Review AI-flagged requests and approve or reject with written justification
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab("pending")}
            className={`px-4 py-2 text-sm font-sora font-semibold rounded-[9px] transition-colors ${
              activeTab === "pending"
                ? "bg-[#111] text-white"
                : "bg-white border border-[#e8e8e4] text-gray-600 hover:bg-gray-50"
            }`}
          >
            Pending
            {fullReqs.length > 0 && (
              <span className={`ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                activeTab === "pending" ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500"
              }`}>
                {fullReqs.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`px-4 py-2 text-sm font-sora font-semibold rounded-[9px] transition-colors ${
              activeTab === "history"
                ? "bg-[#111] text-white"
                : "bg-white border border-[#e8e8e4] text-gray-600 hover:bg-gray-50"
            }`}
          >
            History
          </button>
        </div>

        {/* ── PENDING TAB ── */}
        {activeTab === "pending" && (
          <>
            {error && <div className="mb-4"><ErrorMsg msg={error} /></div>}

            {loading ? (
              <Spinner />
            ) : fullReqs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <p className="text-sm text-gray-400">No pending approvals — all caught up ✓</p>
              </div>
            ) : (
              <div className="bg-white rounded-[14px] border border-[#e8e8e4] overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[#e8e8e4]">
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-400">Request</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">Requester</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">Submitted</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">Risk</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {pendingPaginated.map((req) => {
                      const label = getLabel(req.intent);
                      const resource = getResource(req.intent, req.payload);
                      const isExpanded = expandedId === req.id;
                      const isDismissed = dismissed.has(req.id);

                      return (
                        <Fragment key={req.id}>
                          <tr
                            onClick={() => toggleExpand(req.id)}
                            className={`border-b border-[#f0f0ed] cursor-pointer transition-colors ${
                              isExpanded ? "bg-gray-50" : "hover:bg-gray-50"
                            } ${isDismissed ? "opacity-40 pointer-events-none" : ""}`}
                          >
                            <td className="px-5 py-3 whitespace-nowrap">
                              <span className="font-sora text-sm font-semibold text-gray-900">
                                {label}{resource ? ` — ${resource}` : ""}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                              {req.requester_id}
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                              {timeAgo(req.created_at)}
                            </td>
                            <td className="px-4 py-3">
                              <RiskBadge level={req.risk_level} />
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                className="text-xs text-gray-400 hover:text-gray-700 transition-colors whitespace-nowrap"
                                onClick={(e) => { e.stopPropagation(); toggleExpand(req.id); }}
                              >
                                {isExpanded ? "▲ Close" : "Review →"}
                              </button>
                            </td>
                          </tr>
                          <tr>
                            <td colSpan={5} className="p-0">
                              <div className={`overflow-hidden transition-[max-height] duration-300 ease-in-out ${
                                isExpanded ? "max-h-[900px]" : "max-h-0"
                              }`}>
                                <ExpandedPanel
                                  req={req}
                                  reason={reasons[req.id] ?? ""}
                                  onReasonChange={(v) => setReasons((p) => ({ ...p, [req.id]: v }))}
                                  onDecide={(action) => handleDecision(req, action)}
                                  isActing={acting[req.id] ?? null}
                                  actionError={actionErrors[req.id] ?? ""}
                                />
                              </div>
                            </td>
                          </tr>
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
                <PaginationFooter
                  showStart={pendingShowStart} showEnd={pendingShowEnd}
                  total={fullReqs.length} totalPages={pendingTotalPages}
                  currentPage={pendingSafePage}
                  onPageChange={(p) => { setPendingPage(p); setExpandedId(null); }}
                />
              </div>
            )}
          </>
        )}

        {/* ── HISTORY TAB ── */}
        {activeTab === "history" && (
          <>
            {histError && <div className="mb-4"><ErrorMsg msg={histError} /></div>}

            {/* Filter pills + search */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {HIST_PILLS.map(({ key, label }) => (
                <button
                  key={key}
                  className={histPillCls(key)}
                  onClick={() => { setHistFilter(key); setHistPage(1); }}
                >
                  {label}
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    histFilter === key ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500"
                  }`}>
                    {histCounts[key] ?? 0}
                  </span>
                </button>
              ))}
              <input
                type="text"
                value={histSearch}
                onChange={(e) => { setHistSearch(e.target.value); setHistPage(1); }}
                placeholder="Search by requester or system…"
                className="ml-auto rounded-[9px] border border-[#e8e8e4] px-3 py-1.5 text-sm focus:outline-none focus:border-[#111] focus:shadow-[0_0_0_3px_rgba(0,0,0,0.06)] bg-white w-52 transition-shadow"
              />
            </div>

            {histLoading ? (
              <Spinner />
            ) : histFiltered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <p className="text-sm text-gray-400">No requests found</p>
              </div>
            ) : (
              <div className="bg-white rounded-[14px] border border-[#e8e8e4] overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#e8e8e4]">
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-400">Request</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">Requester</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">Risk</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">Submitted</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">Expires</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f0f0ed]">
                    {histPaginated.map((req) => {
                      const label = getLabel(req.intent);
                      const resource = getResource(req.intent, req.payload);
                      const expiry = expiryDisplay(req);

                      return (
                        <tr key={req.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-5 py-3 whitespace-nowrap">
                            <div className="font-sora text-sm font-semibold text-gray-900">
                              {label}{resource ? ` — ${resource}` : ""}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                            {req.requester_id}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              {req.auto_revoked && (
                                <span className="text-xs text-red-500 font-medium">Revoked</span>
                              )}
                              <StatusBadge status={req.status} />
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <RiskBadge level={req.risk_level} />
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                            {timeAgo(req.created_at)}
                          </td>
                          <td className="px-4 py-3 text-xs whitespace-nowrap">
                            {expiry ? (
                              <span className={expiry.cls}>{expiry.text}</span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <a
                              href={`/requests/${req.id}?from=approvals`}
                              className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
                            >
                              View →
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <PaginationFooter
                  showStart={histShowStart} showEnd={histShowEnd}
                  total={histFiltered.length} totalPages={histTotalPages}
                  currentPage={histSafePage}
                  onPageChange={(p) => setHistPage(p)}
                />
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}

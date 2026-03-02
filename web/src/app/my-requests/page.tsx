"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Layout, { StatusBadge, RiskBadge } from "@/lib/Layout";
import { requests, type OpsRequest } from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────────

const INTENT_META: Record<string, { label: string; resourceKey: string }> = {
  provision_repository_access: { label: "GitHub Repository", resourceKey: "repo" },
  invite_to_channel:           { label: "Slack Channel",     resourceKey: "channel" },
  provision_vpn_access:        { label: "VPN Access",        resourceKey: "vpn_group" },
  provision_drive_access:      { label: "Google Drive",      resourceKey: "folder" },
  provision_jira_access:       { label: "Jira Project",      resourceKey: "project_key" },
  provision_aws_access:        { label: "AWS Console",       resourceKey: "service" },
};

function getSystemLabel(intent: string): string {
  return INTENT_META[intent]?.label ?? intent;
}

function getResource(req: OpsRequest): string {
  const key = INTENT_META[req.intent]?.resourceKey;
  if (key && req.payload[key]) return String(req.payload[key]);
  return "";
}

function timeAgo(isoStr: string): string {
  const ts = isoStr.endsWith("Z") || isoStr.includes("+") ? isoStr : isoStr + "Z";
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function expiryDisplay(req: OpsRequest): { text: string; cls: string } | null {
  if (!req.expires_at) return null;
  const ts = req.expires_at.endsWith("Z") || req.expires_at.includes("+")
    ? req.expires_at : req.expires_at + "Z";
  const exp = new Date(ts);
  const now = new Date();
  const diffDays = (exp.getTime() - now.getTime()) / 86400000;
  if (diffDays < 0) return { text: exp.toLocaleDateString(), cls: "text-red-500" };
  if (diffDays < 7) return { text: exp.toLocaleDateString(), cls: "text-amber-500" };
  return { text: exp.toLocaleDateString(), cls: "text-gray-500" };
}

const FILTER_STATUSES = ["COMPLETED", "AWAITING_APPROVAL", "EXECUTING", "FAILED"] as const;

const PAGE_SIZE = 10;

// ── Component ─────────────────────────────────────────────────────────────────

export default function MyRequestsPage() {
  const router = useRouter();
  const [allReqs, setAllReqs] = useState<OpsRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeFilter, setActiveFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const fetchList = useCallback(async () => {
    try {
      const list = await requests.list(100);
      setAllReqs(list);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load requests");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchList();
    const id = setInterval(fetchList, 5000);
    return () => clearInterval(id);
  }, [fetchList]);

  // Status counts
  const counts: Record<string, number> = { ALL: allReqs.length };
  for (const s of FILTER_STATUSES) {
    counts[s] = allReqs.filter((r) => r.status === s).length;
  }
  // Also count auto-revoked
  counts["AUTO_REVOKED"] = allReqs.filter((r) => r.auto_revoked).length;

  // Filter + search
  const filtered = allReqs.filter((r) => {
    if (activeFilter === "AUTO_REVOKED") return r.auto_revoked;
    if (activeFilter !== "ALL" && r.status !== activeFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const label = getSystemLabel(r.intent).toLowerCase();
      const res = getResource(r).toLowerCase();
      if (!label.includes(q) && !res.includes(q)) return false;
    }
    return true;
  });

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const showStart = filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const showEnd = Math.min(safePage * PAGE_SIZE, filtered.length);

  function handleFilterChange(f: string) {
    setActiveFilter(f);
    setPage(1);
  }

  const pillCls = (f: string) =>
    `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
      activeFilter === f
        ? "bg-[#111] text-white"
        : "bg-white border border-[#e8e8e4] text-gray-600 hover:bg-gray-50"
    }`;

  const filterPills: { key: string; label: string }[] = [
    { key: "ALL", label: "All" },
    { key: "COMPLETED", label: "Completed" },
    { key: "AWAITING_APPROVAL", label: "Awaiting Approval" },
    { key: "EXECUTING", label: "Executing" },
    { key: "AUTO_REVOKED", label: "Auto-revoked" },
  ];

  return (
    <Layout>
      <div className="pb-12">
        {/* Page header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="font-sora text-[22px] font-bold text-gray-900">My Requests</h1>
            <p className="text-sm text-gray-500 mt-1">
              All your access requests and their current status
            </p>
          </div>
          <button
            onClick={() => router.push("/")}
            className="rounded-[9px] bg-[#111] text-white px-4 py-2 text-sm font-sora font-semibold hover:bg-black transition-colors whitespace-nowrap"
          >
            + New Request
          </button>
        </div>

        {/* Filter row */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {filterPills.map(({ key, label }) => (
            <button key={key} className={pillCls(key)} onClick={() => handleFilterChange(key)}>
              {label}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                activeFilter === key ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500"
              }`}>
                {counts[key] ?? 0}
              </span>
            </button>
          ))}
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by system or resource…"
            className="ml-auto rounded-[9px] border border-[#e8e8e4] px-3 py-1.5 text-sm focus:outline-none focus:border-[#111] focus:shadow-[0_0_0_3px_rgba(0,0,0,0.06)] bg-white w-52 transition-shadow"
          />
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-[#e8e8e4] overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-8 w-8 rounded-full border-4 border-gray-200 border-t-gray-800 animate-spin" />
            </div>
          ) : error ? (
            <div className="px-6 py-8 text-sm text-red-600">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <p className="text-sm text-gray-400">
                No requests yet —{" "}
                <button
                  onClick={() => router.push("/")}
                  className="underline text-gray-500 hover:text-gray-700"
                >
                  use the form to request access to a system
                </button>
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 border-b border-[#e8e8e4]">
                      <th className="px-6 py-3 font-medium">Request</th>
                      <th className="px-4 py-3 font-medium">Justification</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Risk</th>
                      <th className="px-4 py-3 font-medium">Submitted</th>
                      <th className="px-4 py-3 font-medium">Expires</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f0f0ed]">
                    {paginated.map((r) => {
                      const label = getSystemLabel(r.intent);
                      const resource = getResource(r);
                      const expiry = expiryDisplay(r);
                      const justification = typeof r.payload?.justification === "string"
                        ? r.payload.justification : "";
                      const isTimed = !!r.expires_at;
                      const isExecuting = r.status === "EXECUTING";

                      return (
                        <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-3 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-gray-900 text-sm">{label}</span>
                              {isTimed && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-600 border border-blue-100">
                                  ⏱ Timed
                                </span>
                              )}
                            </div>
                            {resource && (
                              <div className="font-mono text-xs text-gray-400 mt-0.5">{resource}</div>
                            )}
                            <div className="text-xs text-gray-400 mt-0.5">{timeAgo(r.created_at)}</div>
                          </td>
                          <td className="px-4 py-3 max-w-[200px]">
                            <span className="text-xs text-gray-500 truncate block" title={justification}>
                              {justification || "—"}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              {isExecuting && (
                                <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse flex-shrink-0" />
                              )}
                              <StatusBadge status={r.status} />
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <RiskBadge level={r.risk_level} />
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                            {timeAgo(r.created_at)}
                          </td>
                          <td className="px-4 py-3 text-xs whitespace-nowrap">
                            {r.auto_revoked ? (
                              <span className="text-red-500 font-medium">Revoked</span>
                            ) : expiry ? (
                              <span className={expiry.cls}>{expiry.text}</span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => router.push(`/requests/${r.id}`)}
                              className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
                            >
                              View →
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="px-6 py-3 border-t border-[#e8e8e4] flex items-center justify-between">
                <span className="text-xs text-gray-400">
                  Showing {showStart}–{showEnd} of {filtered.length} requests
                </span>
                {totalPages > 1 && (
                  <div className="flex gap-1">
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                      <button
                        key={p}
                        onClick={() => setPage(p)}
                        className={`w-7 h-7 rounded text-xs font-medium transition-colors ${
                          p === safePage
                            ? "bg-[#111] text-white"
                            : "text-gray-500 hover:bg-gray-100"
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}

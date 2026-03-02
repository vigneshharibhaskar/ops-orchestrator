"use client";

import { useState } from "react";
import Layout, { ErrorMsg, Spinner } from "@/lib/Layout";
import { drift, type DriftItem } from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────────

const SYSTEM_LABEL: Record<string, string> = {
  github:           "GitHub",
  slack:            "Slack",
  okta:             "Okta",
  vpn:              "VPN",
  netsuite:         "NetSuite",
  workday:          "Workday",
  google_workspace: "Google Workspace",
  jira:             "Jira",
  aws:              "AWS",
  drive:            "Google Drive",
};

function sysLabel(s: string): string {
  return SYSTEM_LABEL[s.toLowerCase()] ?? (s.charAt(0).toUpperCase() + s.slice(1));
}

// Replace bare system names in a detail string with their display labels,
// then capitalize the first character of the result.
function fmtDetail(detail: string): string {
  // Replace longest keys first to avoid partial replacement (google_workspace before workspace)
  let s = detail;
  for (const [key, label] of Object.entries(SYSTEM_LABEL).sort((a, b) => b[0].length - a[0].length)) {
    s = s.replace(new RegExp(`\\b${key}\\b`, "gi"), label);
  }
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Section metadata ──────────────────────────────────────────────────────────

const SECTION: Record<string, { label: string; countCls: string; desc: string }> = {
  unexpected: {
    label:    "Unexpected",
    countCls: "text-red-700",
    desc:     "Access exists with no policy justification for current department.",
  },
  missing: {
    label:    "Missing",
    countCls: "text-amber-700",
    desc:     "Policy requires this access but no grant record exists.",
  },
  stale: {
    label:    "Stale",
    countCls: "text-gray-600",
    desc:     "Access was legitimately granted but is over 90 days old — verify still needed.",
  },
};

// ── Severity badge ────────────────────────────────────────────────────────────

const SEVERITY_CLS: Record<string, string> = {
  HIGH:   "bg-red-50 text-red-700 border border-red-200",
  MEDIUM: "bg-amber-50 text-amber-700 border border-amber-200",
  LOW:    "bg-gray-100 text-gray-600 border border-gray-200",
};

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${SEVERITY_CLS[severity] ?? "bg-gray-100 text-gray-600"}`}>
      {severity}
    </span>
  );
}

// ── Drift table ───────────────────────────────────────────────────────────────

function DriftTable({
  type,
  items,
}: {
  type: "unexpected" | "missing" | "stale";
  items: DriftItem[];
}) {
  const meta = SECTION[type];
  if (items.length === 0) return null;

  return (
    <div className="bg-white rounded-[14px] border border-[#e8e8e4] overflow-hidden">
      {/* Section header */}
      <div className="px-5 py-4 border-b border-[#e8e8e4]">
        <div className="flex items-center gap-2">
          <h3 className={`font-sora text-sm font-semibold ${meta.countCls}`}>
            {meta.label}
          </h3>
          <span className="text-xs font-medium text-gray-400">({items.length})</span>
        </div>
        <p className="text-xs text-gray-500 mt-0.5">{meta.desc}</p>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#e8e8e4]">
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-400">Email</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">System</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">Dept</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">Severity</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">Detail</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">Days</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0f0ed]">
            {items.map((item, i) => (
              <tr key={i} className="hover:bg-gray-50 transition-colors">
                <td className="px-5 py-3 text-xs font-mono text-gray-700 whitespace-nowrap">
                  {item.email}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className="font-sora text-sm font-semibold text-gray-900">
                    {sysLabel(item.system)}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                  {item.department ?? "—"}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <SeverityBadge severity={item.severity} />
                </td>
                <td className="px-4 py-3 text-xs text-gray-600 max-w-xs">
                  {fmtDetail(item.detail)}
                </td>
                <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                  {item.days_since_grant != null ? `${item.days_since_grant}d` : "—"}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    {(type === "unexpected" || type === "stale") && item.last_grant_id && (
                      <a
                        href={`/requests/${item.last_grant_id}`}
                        className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
                      >
                        View →
                      </a>
                    )}
                    {type === "unexpected" && (
                      <button
                        className="inline-flex items-center px-2.5 py-1 rounded-[7px] border border-red-300 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors"
                      >
                        Revoke
                      </button>
                    )}
                    {type === "missing" && (
                      <button
                        className="inline-flex items-center px-2.5 py-1 rounded-[7px] border border-amber-300 text-xs font-semibold text-amber-700 hover:bg-amber-50 transition-colors"
                      >
                        Grant
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DriftPage() {
  const [emailFilter, setEmailFilter] = useState("");
  const [items, setItems] = useState<DriftItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [scanned, setScanned] = useState(false);

  async function handleScan(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await drift.scan(emailFilter.trim() || undefined);
      setItems(result);
      setScanned(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setLoading(false);
    }
  }

  const unexpected = (items ?? []).filter((i) => i.drift_type === "unexpected");
  const missing    = (items ?? []).filter((i) => i.drift_type === "missing");
  const stale      = (items ?? []).filter((i) => i.drift_type === "stale");

  const highCount = (items ?? []).filter((i) => i.severity === "HIGH").length;
  const medCount  = (items ?? []).filter((i) => i.severity === "MEDIUM").length;
  const lowCount  = (items ?? []).filter((i) => i.severity === "LOW").length;

  return (
    <Layout>
      <div className="space-y-6 pb-12">

        {/* Page header */}
        <div>
          <h1 className="font-sora text-[22px] font-bold text-gray-900">Drift Detection</h1>
          <p className="text-sm text-gray-500 mt-1">
            Compare actual system access against HR policy to surface gaps and anomalies.
          </p>
        </div>

        {/* Scan card */}
        <div className="bg-white rounded-[14px] border border-[#e8e8e4] px-5 py-4">
          <form onSubmit={handleScan} className="flex items-center gap-4">
            <p className="font-sora text-sm font-semibold text-gray-900 shrink-0">
              Scan for access drift
            </p>
            <input
              type="email"
              value={emailFilter}
              onChange={(e) => setEmailFilter(e.target.value)}
              placeholder="Filter by email — leave blank to scan all users"
              className="flex-1 rounded-[9px] border border-[#e8e8e4] px-3 py-2 text-sm focus:outline-none focus:border-[#111] focus:shadow-[0_0_0_3px_rgba(0,0,0,0.06)] bg-white transition-shadow"
            />
            <button
              type="submit"
              disabled={loading}
              className="shrink-0 rounded-[9px] bg-[#111] text-white px-5 py-2 text-sm font-sora font-semibold hover:bg-black disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              {loading ? "Scanning…" : "Run Scan →"}
            </button>
          </form>
        </div>

        {/* Error */}
        {error && <ErrorMsg msg={error} />}

        {/* Loading */}
        {loading && <Spinner />}

        {/* Results */}
        {!loading && scanned && items !== null && (
          <>
            {/* Summary row */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-sora text-sm font-semibold text-gray-700">
                {items.length} drift item{items.length !== 1 ? "s" : ""} found
              </span>
              {highCount > 0 && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-50 text-red-700 text-xs font-semibold border border-red-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500 inline-block" />
                  HIGH · {highCount}
                </span>
              )}
              {medCount > 0 && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-semibold border border-amber-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 inline-block" />
                  MEDIUM · {medCount}
                </span>
              )}
              {lowCount > 0 && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-100 text-gray-600 text-xs font-semibold border border-gray-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-gray-400 inline-block" />
                  LOW · {lowCount}
                </span>
              )}
            </div>

            {/* Empty state */}
            {items.length === 0 && (
              <div className="bg-white rounded-[14px] border border-[#e8e8e4] px-6 py-16 text-center">
                <p className="text-sm text-gray-400">
                  No drift detected — all access matches policy.
                </p>
              </div>
            )}

            {/* Sections */}
            <DriftTable type="unexpected" items={unexpected} />
            <DriftTable type="missing"    items={missing} />
            <DriftTable type="stale"      items={stale} />
          </>
        )}
      </div>
    </Layout>
  );
}

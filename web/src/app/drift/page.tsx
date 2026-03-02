"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Layout, { ErrorMsg, Spinner } from "@/lib/Layout";
import { drift, type DriftItem } from "@/lib/api";

const SEVERITY_CHIP: Record<string, string> = {
  HIGH: "bg-red-100 text-red-700 border border-red-200",
  MEDIUM: "bg-amber-100 text-amber-700 border border-amber-200",
  LOW: "bg-gray-100 text-gray-600 border border-gray-200",
};

const SECTION_HEADER: Record<string, { label: string; color: string; desc: string }> = {
  unexpected: {
    label: "Unexpected",
    color: "text-red-700",
    desc: "Access exists with no policy justification for current department.",
  },
  missing: {
    label: "Missing",
    color: "text-amber-700",
    desc: "Policy requires this access but no grant record exists.",
  },
  stale: {
    label: "Stale",
    color: "text-gray-600",
    desc: "Access was legitimately granted but is over 90 days old — verify still needed.",
  },
};

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${SEVERITY_CHIP[severity] ?? "bg-gray-100 text-gray-600"}`}>
      {severity}
    </span>
  );
}

function DriftTable({
  type,
  items,
}: {
  type: "unexpected" | "missing" | "stale";
  items: DriftItem[];
}) {
  const router = useRouter();
  const meta = SECTION_HEADER[type];

  if (items.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h3 className={`text-sm font-semibold ${meta.color}`}>
          {meta.label}{" "}
          <span className="ml-1 text-xs font-normal text-gray-500">({items.length})</span>
        </h3>
        <p className="text-xs text-gray-500 mt-0.5">{meta.desc}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
              <th className="px-6 py-2 font-medium">Email</th>
              <th className="px-6 py-2 font-medium">System</th>
              <th className="px-6 py-2 font-medium">Dept</th>
              <th className="px-6 py-2 font-medium">Detail</th>
              <th className="px-6 py-2 font-medium">Days</th>
              <th className="px-6 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {items.map((item, i) => (
              <tr key={i} className="hover:bg-gray-50 transition-colors">
                <td className="px-6 py-3 font-mono text-xs text-gray-700 whitespace-nowrap">
                  {item.email}
                </td>
                <td className="px-6 py-3 font-mono text-xs text-gray-700 whitespace-nowrap">
                  {item.system}
                </td>
                <td className="px-6 py-3 text-xs text-gray-500 whitespace-nowrap">
                  {item.department ?? "—"}
                </td>
                <td className="px-6 py-3 text-xs text-gray-600 max-w-xs">
                  {item.detail}
                </td>
                <td className="px-6 py-3 text-xs text-gray-500 whitespace-nowrap">
                  {item.days_since_grant != null ? `${item.days_since_grant}d` : "—"}
                </td>
                <td className="px-6 py-3 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    {(type === "unexpected" || type === "stale") && item.last_grant_id && (
                      <button
                        onClick={() => router.push(`/requests/${item.last_grant_id}`)}
                        className="text-xs text-indigo-600 hover:text-indigo-800 underline transition-colors"
                      >
                        View →
                      </button>
                    )}
                    {type === "unexpected" && (
                      <button
                        onClick={() => router.push(`/?intent=revoke_access&email=${encodeURIComponent(item.email)}`)}
                        className="text-xs text-red-600 hover:text-red-800 underline transition-colors"
                      >
                        Revoke
                      </button>
                    )}
                    {type === "missing" && (
                      <button
                        onClick={() => router.push(`/?intent=onboard_user&email=${encodeURIComponent(item.email)}`)}
                        className="text-xs text-amber-600 hover:text-amber-800 underline transition-colors"
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
  const missing = (items ?? []).filter((i) => i.drift_type === "missing");
  const stale = (items ?? []).filter((i) => i.drift_type === "stale");

  const highCount = (items ?? []).filter((i) => i.severity === "HIGH").length;
  const medCount = (items ?? []).filter((i) => i.severity === "MEDIUM").length;
  const lowCount = (items ?? []).filter((i) => i.severity === "LOW").length;

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Drift Detection</h1>
          <p className="text-sm text-gray-500 mt-1">
            Compare actual provisioned access against HR policy to surface gaps and anomalies.
          </p>
        </div>

        {/* Scan bar */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <form onSubmit={handleScan} className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Filter by email{" "}
                <span className="text-gray-400 font-normal">(leave blank to scan all users)</span>
              </label>
              <input
                type="email"
                value={emailFilter}
                onChange={(e) => setEmailFilter(e.target.value)}
                placeholder="user@acme-fintech.com"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-indigo-600 text-white px-5 py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {loading ? "Scanning…" : "Scan"}
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
            {/* Summary chips */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-medium text-gray-700">
                {items.length} drift item{items.length !== 1 ? "s" : ""} found
              </span>
              {highCount > 0 && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-100 text-red-700 text-xs font-semibold border border-red-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500 inline-block" />
                  HIGH · {highCount}
                </span>
              )}
              {medCount > 0 && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold border border-amber-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500 inline-block" />
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
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-16 text-center">
                <p className="text-sm text-gray-500">
                  No drift detected — all access matches policy.
                </p>
              </div>
            )}

            {/* Drift sections */}
            <DriftTable type="unexpected" items={unexpected} />
            <DriftTable type="missing" items={missing} />
            <DriftTable type="stale" items={stale} />
          </>
        )}
      </div>
    </Layout>
  );
}

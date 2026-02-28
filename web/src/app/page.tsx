"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Layout, { useRole, RiskBadge, StatusBadge, ErrorMsg, Spinner } from "@/lib/Layout";
import { requests, type OpsRequest } from "@/lib/api";

// Requesters get low-blast-radius intents only
const REQUESTER_INTENTS = [
  "provision_repository_access",
  "onboard_user",
  "invite_to_channel",
];

const ALL_INTENTS = [
  "provision_repository_access",
  "onboard_user",
  "invite_to_channel",
  "revoke_access",
  "offboard_user",
  "deploy_service",
];

const PAYLOAD_EXAMPLES: Record<string, Record<string, unknown>> = {
  provision_repository_access: {
    user_email: "j.smith@acme-fintech.com",
    repo: "risk-models",
    permission: "read",
  },
  onboard_user: {
    user_email: "new.hire@acme-fintech.com",
    team: "risk-engineering",
    role: "analyst",
  },
  invite_to_channel: {
    user_email: "j.smith@acme-fintech.com",
    channel: "#risk-alerts",
  },
  revoke_access: {
    user_email: "former.employee@acme-fintech.com",
    resource: "all",
  },
  offboard_user: {
    user_email: "former.employee@acme-fintech.com",
    reason: "contract ended",
  },
  deploy_service: {
    service: "risk-api",
    environment: "staging",
    version: "v1.4.2",
  },
};

function genKey() {
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export default function DashboardPage() {
  const router = useRouter();
  const role = useRole();
  const canSeeRisk = role === "approver" || role === "admin";
  const availableIntents = canSeeRisk ? ALL_INTENTS : REQUESTER_INTENTS;

  const [reqs, setReqs] = useState<OpsRequest[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState("");

  // form state
  const [intent, setIntent] = useState(availableIntents[0]);
  const [payloadText, setPayloadText] = useState(
    JSON.stringify(PAYLOAD_EXAMPLES[availableIntents[0]], null, 2)
  );
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [successId, setSuccessId] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    try {
      const list = await requests.list();
      setReqs(list);
    } catch (e: unknown) {
      setListError(e instanceof Error ? e.message : "Failed to load requests");
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  function handleIntentChange(v: string) {
    setIntent(v);
    const ex = PAYLOAD_EXAMPLES[v];
    if (ex) setPayloadText(JSON.stringify(ex, null, 2));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setSuccessId(null);

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(payloadText);
    } catch {
      setFormError("Payload must be valid JSON");
      return;
    }

    setSubmitting(true);
    try {
      const res = await requests.submit({
        idempotency_key: genKey(),
        intent,
        payload,
      });
      setSuccessId(res.id);
      fetchList();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Layout>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* ── Submit form ─────────────────────────────────────────────── */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-base font-semibold mb-4">Submit Request</h2>

            {formError && (
              <div className="mb-4">
                <ErrorMsg msg={formError} />
              </div>
            )}

            {successId && (
              <div className="mb-4 rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700 flex items-center justify-between">
                <span>Request submitted successfully.</span>
                <button
                  onClick={() => router.push(`/requests/${successId}`)}
                  className="ml-3 text-green-700 underline text-xs whitespace-nowrap"
                >
                  View details
                </button>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Intent
                </label>
                <select
                  value={intent}
                  onChange={(e) => handleIntentChange(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                >
                  {availableIntents.map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Payload (JSON)
                </label>
                <textarea
                  rows={6}
                  value={payloadText}
                  onChange={(e) => setPayloadText(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-indigo-600 text-white py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {submitting ? "Submitting…" : "Submit Request"}
              </button>
            </form>
          </div>
        </div>

        {/* ── Recent requests table ───────────────────────────────────── */}
        <div className="lg:col-span-3">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold">Recent Requests</h2>
              <button
                onClick={fetchList}
                className="text-xs text-indigo-600 hover:text-indigo-800 transition-colors"
              >
                Refresh
              </button>
            </div>

            {loadingList ? (
              <Spinner />
            ) : listError ? (
              <ErrorMsg msg={listError} />
            ) : reqs.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">
                No requests yet. Submit one!
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                      <th className="pb-2 pr-3 font-medium">Created</th>
                      <th className="pb-2 pr-3 font-medium">Intent</th>
                      <th className="pb-2 pr-3 font-medium">Status</th>
                      {canSeeRisk && (
                        <th className="pb-2 pr-3 font-medium">Risk</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {reqs.map((r) => (
                      <tr
                        key={r.id}
                        className="cursor-pointer hover:bg-indigo-50 transition-colors"
                        onClick={() => router.push(`/requests/${r.id}`)}
                      >
                        <td className="py-2 pr-3 text-xs text-gray-500 whitespace-nowrap">
                          {new Date(r.created_at.endsWith("Z") || r.created_at.includes("+") ? r.created_at : r.created_at + "Z").toLocaleString()}
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs max-w-[160px] truncate">
                          {r.intent}
                        </td>
                        <td className="py-2 pr-3">
                          <StatusBadge status={r.status} />
                        </td>
                        {canSeeRisk && (
                          <td className="py-2">
                            <RiskBadge level={r.risk_level} />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}

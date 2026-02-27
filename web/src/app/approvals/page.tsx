"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Layout, { RiskBadge, ErrorMsg, Spinner } from "@/lib/Layout";
import { approvals, type PendingApprovalItem } from "@/lib/api";

function ReasonModal({
  action,
  onConfirm,
  onCancel,
}: {
  action: "approve" | "reject";
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 10) {
      setError("Please provide at least 10 characters.");
      return;
    }
    onConfirm(reason.trim());
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h3 className="text-base font-semibold mb-1">
          {action === "approve" ? "Approve Request" : "Reject Request"}
        </h3>
        <p className="text-sm text-gray-500 mb-4">
          A written justification is required.
        </p>
        {error && (
          <div className="mb-3">
            <ErrorMsg msg={error} />
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <textarea
            rows={4}
            placeholder="Enter your reason…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          />
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`px-4 py-2 text-sm rounded-lg text-white font-medium transition-colors ${
                action === "approve"
                  ? "bg-green-600 hover:bg-green-700"
                  : "bg-red-600 hover:bg-red-700"
              }`}
            >
              Confirm {action === "approve" ? "Approve" : "Reject"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ApprovalsPage() {
  const router = useRouter();
  const [items, setItems] = useState<PendingApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<{
    requestId: string;
    action: "approve" | "reject";
  } | null>(null);
  const [actionError, setActionError] = useState("");

  const fetchPending = useCallback(async () => {
    setError("");
    try {
      const list = await approvals.pending();
      setItems(list);
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : "Failed to load pending approvals"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPending();
  }, [fetchPending]);

  async function handleConfirm(reason: string) {
    if (!modal) return;
    setActionError("");
    try {
      if (modal.action === "approve") {
        await approvals.approve(modal.requestId, reason);
      } else {
        await approvals.reject(modal.requestId, reason);
      }
      setModal(null);
      setLoading(true);
      fetchPending();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "Action failed");
    }
  }

  return (
    <Layout>
      {modal && (
        <ReasonModal
          action={modal.action}
          onConfirm={handleConfirm}
          onCancel={() => {
            setModal(null);
            setActionError("");
          }}
        />
      )}

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Pending Approvals</h1>
        <button
          onClick={() => {
            setLoading(true);
            fetchPending();
          }}
          className="text-sm text-indigo-600 hover:text-indigo-800 transition-colors"
        >
          Refresh
        </button>
      </div>

      {actionError && (
        <div className="mb-4">
          <ErrorMsg msg={actionError} />
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorMsg msg={error} />
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center text-gray-400 text-sm">
          No pending approvals.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr className="text-left text-xs text-gray-500">
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Requester</th>
                <th className="px-4 py-3 font-medium">Intent</th>
                <th className="px-4 py-3 font-medium">Risk</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                    {new Date(item.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-xs font-mono text-gray-700">
                    {item.requester_id}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => router.push(`/requests/${item.id}`)}
                      className="font-mono text-xs text-indigo-600 hover:underline"
                    >
                      {item.intent}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <RiskBadge level={item.overall_risk} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() =>
                          setModal({ requestId: item.id, action: "approve" })
                        }
                        className="px-3 py-1 text-xs rounded-lg bg-green-50 text-green-700 hover:bg-green-100 font-medium transition-colors"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() =>
                          setModal({ requestId: item.id, action: "reject" })
                        }
                        className="px-3 py-1 text-xs rounded-lg bg-red-50 text-red-700 hover:bg-red-100 font-medium transition-colors"
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => router.push(`/requests/${item.id}`)}
                        className="px-3 py-1 text-xs rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                      >
                        View
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
}

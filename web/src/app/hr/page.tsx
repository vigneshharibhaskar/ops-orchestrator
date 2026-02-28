"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Layout, { RiskBadge, StatusBadge, ErrorMsg } from "@/lib/Layout";
import { hrEvents, requests, type HREventResponse, type HRActionSummary } from "@/lib/api";

const TERMINAL = new Set(["COMPLETED", "REJECTED", "FAILED"]);
const DEPARTMENTS = ["engineering", "finance", "hr", "security"];

type Tab = "new_hire" | "role_change" | "termination";

// ── Form field primitives ─────────────────────────────────────────────────────

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white";

function TextInput({
  value,
  onChange,
  placeholder = "",
  type = "text",
  required = true,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      required={required}
      className={inputCls}
    />
  );
}

function DeptSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
      {DEPARTMENTS.map((d) => (
        <option key={d} value={d}>
          {d.charAt(0).toUpperCase() + d.slice(1)}
        </option>
      ))}
    </select>
  );
}

// ── Tab bar ───────────────────────────────────────────────────────────────────

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "new_hire", label: "New Hire" },
    { id: "role_change", label: "Role Change" },
    { id: "termination", label: "Termination" },
  ];
  return (
    <div className="flex border-b border-gray-200 mb-6">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
            active === t.id
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ── Tab form bodies ───────────────────────────────────────────────────────────

function NewHireFields({
  form,
  set,
}: {
  form: { name: string; email: string; department: string; start_date: string };
  set: (f: typeof form) => void;
}) {
  return (
    <div className="space-y-4">
      <Field label="Full name">
        <TextInput
          value={form.name}
          onChange={(v) => set({ ...form, name: v })}
          placeholder="Jane Smith"
        />
      </Field>
      <Field label="Work email">
        <TextInput
          value={form.email}
          onChange={(v) => set({ ...form, email: v })}
          placeholder="j.smith@acme-fintech.com"
          type="email"
        />
      </Field>
      <Field label="Department">
        <DeptSelect value={form.department} onChange={(v) => set({ ...form, department: v })} />
      </Field>
      <Field label="Start date">
        <TextInput
          value={form.start_date}
          onChange={(v) => set({ ...form, start_date: v })}
          type="date"
        />
      </Field>
    </div>
  );
}

function RoleChangeFields({
  form,
  set,
}: {
  form: { email: string; old_department: string; new_department: string; new_title: string };
  set: (f: typeof form) => void;
}) {
  return (
    <div className="space-y-4">
      <Field label="Employee email">
        <TextInput
          value={form.email}
          onChange={(v) => set({ ...form, email: v })}
          placeholder="j.smith@acme-fintech.com"
          type="email"
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="From department">
          <DeptSelect
            value={form.old_department}
            onChange={(v) => set({ ...form, old_department: v })}
          />
        </Field>
        <Field label="To department">
          <DeptSelect
            value={form.new_department}
            onChange={(v) => set({ ...form, new_department: v })}
          />
        </Field>
      </div>
      <Field label="New title">
        <TextInput
          value={form.new_title}
          onChange={(v) => set({ ...form, new_title: v })}
          placeholder="Senior Analyst"
        />
      </Field>
    </div>
  );
}

function TerminationFields({
  form,
  set,
}: {
  form: { email: string; last_day: string };
  set: (f: typeof form) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
        All access revocations for terminations are <strong>HUMAN_ONLY</strong> and require written
        justification from an approver.
      </div>
      <Field label="Employee email">
        <TextInput
          value={form.email}
          onChange={(v) => set({ ...form, email: v })}
          placeholder="former.employee@acme-fintech.com"
          type="email"
        />
      </Field>
      <Field label="Last day">
        <TextInput
          value={form.last_day}
          onChange={(v) => set({ ...form, last_day: v })}
          type="date"
        />
      </Field>
    </div>
  );
}

// ── Action tracker ────────────────────────────────────────────────────────────

function Tracker({
  response,
  statuses,
  onReset,
}: {
  response: HREventResponse;
  statuses: Record<string, string>;
  onReset: () => void;
}) {
  const router = useRouter();
  const allDone = response.actions.every((a) =>
    TERMINAL.has(statuses[a.request_id] ?? a.status)
  );

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-gray-900">{response.employee}</p>
            <p className="text-xs text-gray-400 font-mono mt-0.5">{response.event_id}</p>
          </div>
          <button
            onClick={onReset}
            className="text-xs text-indigo-600 hover:text-indigo-800 transition-colors whitespace-nowrap"
          >
            New event
          </button>
        </div>

        <div className="flex gap-3 mt-4">
          <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
            {response.total_actions} action{response.total_actions !== 1 ? "s" : ""}
          </span>
          {response.auto_executing > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-green-50 text-green-700 font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
              {response.auto_executing} auto-executing
            </span>
          )}
          {response.awaiting_approval > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-yellow-50 text-yellow-700 font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-yellow-500" />
              {response.awaiting_approval} awaiting approval
            </span>
          )}
          {!allDone && (
            <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-gray-50 text-gray-500">
              <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-pulse" />
              polling
            </span>
          )}
        </div>
      </div>

      {/* Action rows */}
      {response.actions.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-10 text-center text-sm text-gray-400">
          No access changes required — department not found in policy.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr className="text-left text-xs text-gray-500">
                <th className="px-4 py-3 font-medium">System</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Risk</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {response.actions.map((action: HRActionSummary) => {
                const liveStatus = statuses[action.request_id] ?? action.status;
                return (
                  <tr key={action.request_id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-gray-800">
                      {action.system}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                          action.action === "revoke"
                            ? "bg-red-50 text-red-700"
                            : "bg-indigo-50 text-indigo-700"
                        }`}
                      >
                        {action.action}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <RiskBadge level={action.risk} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={liveStatus} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => router.push(`/requests/${action.request_id}`)}
                        className="text-xs text-indigo-600 hover:text-indigo-800 transition-colors"
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
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HREventsPage() {
  const [tab, setTab] = useState<Tab>("new_hire");

  const [newHire, setNewHire] = useState({
    name: "",
    email: "",
    department: "engineering",
    start_date: "",
  });
  const [roleChange, setRoleChange] = useState({
    email: "",
    old_department: "engineering",
    new_department: "finance",
    new_title: "",
  });
  const [termination, setTermination] = useState({ email: "", last_day: "" });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [response, setResponse] = useState<HREventResponse | null>(null);
  const [statuses, setStatuses] = useState<Record<string, string>>({});

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Start polling once we have a response with action request IDs
  useEffect(() => {
    if (!response || response.actions.length === 0) return;

    const poll = async () => {
      const updates: Record<string, string> = {};
      let allDone = true;

      await Promise.allSettled(
        response.actions.map(async (a) => {
          try {
            const req = await requests.get(a.request_id);
            updates[a.request_id] = req.status;
            if (!TERMINAL.has(req.status)) allDone = false;
          } catch {
            allDone = false;
          }
        })
      );

      setStatuses((prev) => ({ ...prev, ...updates }));
      if (allDone && timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };

    poll();
    timerRef.current = setInterval(poll, 2000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [response]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    // Clear previous results
    if (timerRef.current) clearInterval(timerRef.current);
    setResponse(null);
    setStatuses({});

    try {
      let event: Record<string, unknown>;
      if (tab === "new_hire") {
        event = { type: "new_hire", ...newHire };
      } else if (tab === "role_change") {
        event = { type: "role_change", ...roleChange };
      } else {
        event = { type: "termination", ...termination };
      }

      const res = await hrEvents.submit(event);
      setResponse(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    if (timerRef.current) clearInterval(timerRef.current);
    setResponse(null);
    setStatuses({});
    setError("");
  }

  return (
    <Layout>
      <div className="max-w-2xl">
        <h1 className="text-xl font-bold mb-1">HR Events</h1>
        <p className="text-sm text-gray-500 mb-6">
          Submit an HR lifecycle event to provision or revoke system access per department policy.
        </p>

        {response ? (
          <Tracker response={response} statuses={statuses} onReset={handleReset} />
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <TabBar active={tab} onChange={(t) => { setTab(t); setError(""); }} />

            {error && (
              <div className="mb-5">
                <ErrorMsg msg={error} />
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              {tab === "new_hire" && (
                <NewHireFields form={newHire} set={setNewHire} />
              )}
              {tab === "role_change" && (
                <RoleChangeFields form={roleChange} set={setRoleChange} />
              )}
              {tab === "termination" && (
                <TerminationFields form={termination} set={setTermination} />
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-indigo-600 text-white py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {submitting ? "Submitting…" : "Submit Event"}
              </button>
            </form>
          </div>
        )}
      </div>
    </Layout>
  );
}

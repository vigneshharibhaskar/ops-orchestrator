"use client";

import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from "react";
import Layout, { RiskBadge, ErrorMsg } from "@/lib/Layout";
import { hrEvents, requests, type HREventResponse, type OpsRequest } from "@/lib/api";

const TERMINAL = new Set(["COMPLETED", "REJECTED", "FAILED"]);
const DEPARTMENTS = ["engineering", "finance", "hr", "security"];
const HR_EVENT_RE = /^[0-9a-f]{12}-/;
const PAGE_SIZE = 15;

type FormTab = "new_hire" | "role_change" | "termination";
type PageTab = "submit" | "history";
type EventType = "new_hire" | "role_change" | "termination";
type HistFilter = "all" | EventType;

// ── Design system constants ───────────────────────────────────────────────────

const inputCls =
  "w-full rounded-[9px] border border-[#e8e8e4] px-3 py-2 text-sm focus:outline-none focus:border-[#111] focus:shadow-[0_0_0_3px_rgba(0,0,0,0.06)] bg-white transition-shadow";

const labelCls = "block font-sora text-sm font-semibold text-gray-700 mb-1.5";

const SYSTEM_LABEL: Record<string, string> = {
  slack:            "Slack",
  github:           "GitHub",
  okta:             "Okta",
  google_workspace: "Google Workspace",
  vpn:              "VPN",
  netsuite:         "NetSuite",
  workday:          "Workday",
};

const EVENT_TYPE_LABEL: Record<EventType, string> = {
  new_hire:    "New Hire",
  role_change: "Role Change",
  termination: "Termination",
};

const EVENT_TYPE_CLS: Record<EventType, string> = {
  new_hire:    "bg-green-50 text-green-700",
  role_change: "bg-blue-50 text-blue-700",
  termination: "bg-red-50 text-red-700",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function detectEventType(req: OpsRequest): EventType {
  const p = req.payload;
  if (p.last_day) return "termination";
  if (p.old_department) return "role_change";
  return "new_hire";
}

function timeAgo(iso: string): string {
  const ts = iso.endsWith("Z") ? iso : iso + "Z";
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function fmtDateShort(iso: string): string {
  const ts = iso.endsWith("Z") ? iso : iso + "Z";
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

interface EventGroup {
  eventId: string;
  employee: string;
  email: string;
  eventType: EventType;
  department: string;
  submittedAt: string;
  actions: OpsRequest[];
}

function groupByEvent(reqs: OpsRequest[]): EventGroup[] {
  const map = new Map<string, OpsRequest[]>();
  for (const req of reqs) {
    if (!HR_EVENT_RE.test(req.idempotency_key)) continue;
    const eventId = req.idempotency_key.split("-")[0];
    if (!map.has(eventId)) map.set(eventId, []);
    map.get(eventId)!.push(req);
  }
  const groups: EventGroup[] = [];
  for (const [eventId, actions] of map) {
    const first = actions[0];
    const p = first.payload;
    const eventType = detectEventType(first);
    const employee = (p.full_name as string) || (p.email as string) || "Unknown";
    const email = (p.email as string) || "";
    const department =
      (p.new_department as string) ||
      (p.department as string) ||
      "";
    const submittedAt = actions.reduce(
      (earliest, r) => (r.created_at < earliest ? r.created_at : earliest),
      actions[0].created_at
    );
    groups.push({ eventId, employee, email, eventType, department, submittedAt, actions });
  }
  groups.sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));
  return groups;
}

// ── Form field primitives ─────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  );
}

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

function DeptSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
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

// ── Event type tab bar (within Submit form) ───────────────────────────────────

function FormTabBar({ active, onChange }: { active: FormTab; onChange: (t: FormTab) => void }) {
  const tabs: { id: FormTab; label: string }[] = [
    { id: "new_hire",    label: "New Hire" },
    { id: "role_change", label: "Role Change" },
    { id: "termination", label: "Termination" },
  ];
  return (
    <div className="flex gap-2 mb-6">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={`px-4 py-2 text-sm font-sora font-semibold rounded-[9px] transition-colors ${
            active === t.id
              ? "bg-[#111] text-white"
              : "bg-white border border-[#e8e8e4] text-gray-600 hover:bg-gray-50"
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
        <TextInput value={form.name} onChange={(v) => set({ ...form, name: v })} placeholder="Jane Smith" />
      </Field>
      <Field label="Work email">
        <TextInput value={form.email} onChange={(v) => set({ ...form, email: v })} placeholder="j.smith@acme-fintech.com" type="email" />
      </Field>
      <Field label="Department">
        <DeptSelect value={form.department} onChange={(v) => set({ ...form, department: v })} />
      </Field>
      <Field label="Start date">
        <TextInput value={form.start_date} onChange={(v) => set({ ...form, start_date: v })} type="date" />
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
        <TextInput value={form.email} onChange={(v) => set({ ...form, email: v })} placeholder="j.smith@acme-fintech.com" type="email" />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="From department">
          <DeptSelect value={form.old_department} onChange={(v) => set({ ...form, old_department: v })} />
        </Field>
        <Field label="To department">
          <DeptSelect value={form.new_department} onChange={(v) => set({ ...form, new_department: v })} />
        </Field>
      </div>
      <Field label="New title">
        <TextInput value={form.new_title} onChange={(v) => set({ ...form, new_title: v })} placeholder="Senior Analyst" />
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
      <Field label="Employee email">
        <TextInput value={form.email} onChange={(v) => set({ ...form, email: v })} placeholder="former.employee@acme-fintech.com" type="email" />
      </Field>
      <Field label="Last day">
        <TextInput value={form.last_day} onChange={(v) => set({ ...form, last_day: v })} type="date" />
      </Field>
    </div>
  );
}

// ── Status dot ────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  if (status === "COMPLETED") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700">
        <span className="h-4 w-4 rounded-full bg-green-100 flex items-center justify-center text-green-600 text-[10px]">✓</span>
        Completed
      </span>
    );
  }
  if (status === "FAILED" || status === "REJECTED") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600">
        <span className="h-1.5 w-1.5 rounded-full bg-red-500 inline-block" />
        {status === "REJECTED" ? "Rejected" : "Failed"}
      </span>
    );
  }
  if (status === "AWAITING_APPROVAL") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse inline-block" />
        Awaiting approval
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600">
      <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse inline-block" />
      In progress
    </span>
  );
}

// ── Slide-out detail panel ────────────────────────────────────────────────────

function SlidePanel({
  group,
  liveReqs,
  onClose,
}: {
  group: EventGroup | null;
  liveReqs: Record<string, OpsRequest>;
  onClose: () => void;
}) {
  const isOpen = group !== null;

  // Keep last group rendered during slide-out animation
  const lastGroupRef = useRef<EventGroup | null>(null);
  if (group !== null) lastGroupRef.current = group;
  const displayedGroup = group ?? lastGroupRef.current;

  // Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!displayedGroup) return null;

  interface ApprovalEntry {
    req: OpsRequest;
    sysLabel: string;
    approver: string;
    decision: string;
    reason: string;
    decidedAt: string;
  }

  // Collect decided approvals for the Approvals section
  const decidedApprovals: ApprovalEntry[] = displayedGroup.actions.flatMap((req) => {
    const live = liveReqs[req.id] ?? req;
    const approval = live.approval;
    if (!approval?.decided_at) return [];
    return [{
      req,
      sysLabel: SYSTEM_LABEL[(req.payload.system as string)?.toLowerCase()] ?? (req.payload.system as string) ?? "",
      approver: approval.approver_id ?? "Unknown",
      decision: approval.decision ?? "",
      reason: approval.reason ?? "",
      decidedAt: approval.decided_at,
    }];
  });

  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 z-40 transition-opacity duration-300 ${
          isOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
        style={{ background: "rgba(0,0,0,0.2)" }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-[480px] bg-white shadow-2xl z-50 flex flex-col transition-transform duration-300 ease-in-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-[#e8e8e4] shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="font-sora text-base font-bold text-gray-900">
                  {displayedGroup.employee}
                </h2>
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${EVENT_TYPE_CLS[displayedGroup.eventType]}`}>
                  {EVENT_TYPE_LABEL[displayedGroup.eventType]}
                </span>
              </div>
              <p className="text-xs text-gray-400">
                {displayedGroup.department && (
                  <span className="capitalize">{displayedGroup.department}</span>
                )}
                {displayedGroup.department && " · "}
                Submitted {fmtDateShort(displayedGroup.submittedAt)}
              </p>
            </div>
            <button
              onClick={onClose}
              className="mt-0.5 text-gray-400 hover:text-gray-700 transition-colors text-lg leading-none shrink-0"
              aria-label="Close panel"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {/* Systems */}
          <div>
            <h3 className="font-sora text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Systems
            </h3>
            <div className="space-y-2">
              {displayedGroup.actions.map((req) => {
                const live = liveReqs[req.id] ?? req;
                const liveStatus = live.status;
                const sys = (req.payload.system as string) ?? "";
                const sysLabel = SYSTEM_LABEL[sys.toLowerCase()] ?? sys;
                const action = (req.payload.action as string) ?? "provision";
                const risk = (live.risk_level ?? req.risk_level ?? req.payload.risk ?? "MEDIUM") as "LOW" | "MEDIUM" | "HIGH" | "HUMAN_ONLY";
                return (
                  <div
                    key={req.id}
                    className="flex items-center gap-3 rounded-[9px] border border-[#e8e8e4] px-4 py-2.5"
                  >
                    <span className="font-sora text-sm font-semibold text-gray-900 w-24 shrink-0">
                      {sysLabel}
                    </span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold shrink-0 ${
                      action === "revoke"
                        ? "bg-red-50 text-red-700"
                        : "bg-blue-50 text-blue-700"
                    }`}>
                      {action === "revoke" ? "Revoked" : "Provisioned"}
                    </span>
                    <RiskBadge level={risk} />
                    <div className="ml-auto shrink-0">
                      <StatusDot status={liveStatus} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Approvals — only if any decisions have been made */}
          {decidedApprovals.length > 0 && (
            <div>
              <h3 className="font-sora text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Approvals
              </h3>
              <div className="space-y-3">
                {decidedApprovals.map((e) => (
                  <div
                    key={e.req.id}
                    className="rounded-[9px] border border-[#e8e8e4] px-4 py-3"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-sora text-sm font-semibold text-gray-900">
                        {e.sysLabel}
                      </span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                        e.decision === "REJECTED"
                          ? "bg-red-50 text-red-700"
                          : "bg-green-50 text-green-700"
                      }`}>
                        {e.decision === "REJECTED" ? "Rejected" : "Approved"}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500">
                      by{" "}
                      <span className="font-medium text-gray-700">{e.approver}</span>
                      {" · "}
                      {timeAgo(e.decidedAt)}
                    </p>
                    {e.reason && (
                      <p className="text-xs text-gray-400 mt-1.5 italic leading-relaxed">
                        &ldquo;{e.reason}&rdquo;
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HREventsPage() {
  // Page-level tab
  const [pageTab, setPageTab] = useState<PageTab>("submit");

  // Submit Event form state
  const [formTab, setFormTab] = useState<FormTab>("new_hire");
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
  const [submitError, setSubmitError] = useState("");

  // History tab state
  const [histReqs, setHistReqs] = useState<OpsRequest[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [histError, setHistError] = useState("");
  const [histFilter, setHistFilter] = useState<HistFilter>("all");
  const [histSearch, setHistSearch] = useState("");
  const [histPage, setHistPage] = useState(1);
  const [histVersion, setHistVersion] = useState(0);
  const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null);

  // Slide-out panel state
  const [panelGroup, setPanelGroup] = useState<EventGroup | null>(null);
  const [panelLiveReqs, setPanelLiveReqs] = useState<Record<string, OpsRequest>>({});

  const panelPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch history
  const fetchHistory = useCallback(async () => {
    setHistLoading(true);
    setHistError("");
    try {
      const data = await requests.list(500);
      setHistReqs(data);
    } catch (err: unknown) {
      setHistError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setHistLoading(false);
    }
  }, []);

  useEffect(() => {
    if (pageTab === "history") {
      fetchHistory();
    }
  }, [pageTab, histVersion, fetchHistory]);

  // Derived groups
  const eventGroups = useMemo(() => groupByEvent(histReqs), [histReqs]);

  const filteredGroups = useMemo(() => {
    let groups = eventGroups;
    if (histFilter !== "all") {
      groups = groups.filter((g) => g.eventType === histFilter);
    }
    if (histSearch.trim()) {
      const q = histSearch.trim().toLowerCase();
      groups = groups.filter(
        (g) =>
          g.employee.toLowerCase().includes(q) ||
          g.email.toLowerCase().includes(q)
      );
    }
    return groups;
  }, [eventGroups, histFilter, histSearch]);

  const filterCounts = useMemo(() => {
    const counts: Record<HistFilter, number> = {
      all: eventGroups.length,
      new_hire: 0,
      role_change: 0,
      termination: 0,
    };
    for (const g of eventGroups) counts[g.eventType]++;
    return counts;
  }, [eventGroups]);

  const totalPages = Math.max(1, Math.ceil(filteredGroups.length / PAGE_SIZE));
  const pagedGroups = filteredGroups.slice(
    (histPage - 1) * PAGE_SIZE,
    histPage * PAGE_SIZE
  );

  // Poll panel requests every 5s while panel is open
  useEffect(() => {
    if (panelPollRef.current) {
      clearInterval(panelPollRef.current);
      panelPollRef.current = null;
    }
    if (!panelGroup) return;

    const actions = panelGroup.actions;
    const poll = async () => {
      const updates: Record<string, OpsRequest> = {};
      await Promise.allSettled(
        actions.map(async (req) => {
          try {
            const fresh = await requests.get(req.id);
            updates[req.id] = fresh;
          } catch {
            /* ignore */
          }
        })
      );
      setPanelLiveReqs((prev) => ({ ...prev, ...updates }));
    };

    poll();
    panelPollRef.current = setInterval(poll, 5000);
    return () => {
      if (panelPollRef.current) clearInterval(panelPollRef.current);
    };
  }, [panelGroup]);

  function closePanel() {
    setPanelGroup(null);
  }

  // Reset pagination when filter/search changes
  useEffect(() => {
    setHistPage(1);
  }, [histFilter, histSearch]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError("");
    setSubmitting(true);

    try {
      let event: Record<string, unknown>;
      if (formTab === "new_hire") {
        event = { type: "new_hire", ...newHire };
      } else if (formTab === "role_change") {
        event = { type: "role_change", ...roleChange };
      } else {
        event = { type: "termination", ...termination };
      }

      const res = await hrEvents.submit(event);

      setHighlightedEventId(res.event_id);
      setHistVersion((v) => v + 1);
      setPageTab("history");

      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = setTimeout(() => {
        setHighlightedEventId(null);
      }, 3000);
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  function groupStatusSummary(group: EventGroup): React.ReactNode {
    const statuses = group.actions.map((a) => (panelLiveReqs[a.id]?.status ?? a.status));
    const completed  = statuses.filter((s) => s === "COMPLETED").length;
    const awaiting   = statuses.filter((s) => s === "AWAITING_APPROVAL" || s === "APPROVED").length;
    const failed     = statuses.filter((s) => s === "FAILED" || s === "REJECTED").length;
    const inProgress = statuses.filter((s) => !TERMINAL.has(s) && s !== "AWAITING_APPROVAL" && s !== "APPROVED").length;

    const parts: { key: string; node: React.ReactNode }[] = [];
    if (completed > 0)  parts.push({ key: "c", node: <span className="text-green-700">{completed} completed</span> });
    if (awaiting > 0)   parts.push({ key: "a", node: <span className="text-amber-700">{awaiting} awaiting approval</span> });
    if (failed > 0)     parts.push({ key: "f", node: <span className="text-red-600">{failed} failed</span> });
    if (inProgress > 0) parts.push({ key: "p", node: <span className="text-blue-600">{inProgress} in progress</span> });

    if (parts.length === 0) return <span className="text-gray-400 text-xs">—</span>;

    return (
      <span className="text-xs font-medium">
        {parts.map((p, i) => (
          <Fragment key={p.key}>
            {i > 0 && <span className="text-gray-300 mx-1">·</span>}
            {p.node}
          </Fragment>
        ))}
      </span>
    );
  }

  const filterPills: { id: HistFilter; label: string }[] = [
    { id: "all",         label: "All" },
    { id: "new_hire",    label: "New Hire" },
    { id: "role_change", label: "Role Change" },
    { id: "termination", label: "Termination" },
  ];

  return (
    <Layout>
      <div className="max-w-[900px] mx-auto">
        {/* Page header */}
        <div className="mb-6">
          <h1 className="font-sora text-[22px] font-bold text-gray-900">HR Events</h1>
          <p className="text-sm text-gray-500 mt-1">
            Submit lifecycle events or review provisioning history.
          </p>
        </div>

        {/* Page-level tabs */}
        <div className="flex gap-2 mb-6">
          {(["submit", "history"] as PageTab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setPageTab(t)}
              className={`px-4 py-2 text-sm font-sora font-semibold rounded-[9px] transition-colors ${
                pageTab === t
                  ? "bg-[#111] text-white"
                  : "bg-white border border-[#e8e8e4] text-gray-600 hover:bg-gray-50"
              }`}
            >
              {t === "submit" ? "Submit Event" : "Event History"}
            </button>
          ))}
        </div>

        {/* ── Submit Event tab ───────────────────────────────────────────────── */}
        {pageTab === "submit" && (
          <div className="max-w-[600px] mx-auto">
            <div className="bg-white rounded-[14px] border border-[#e8e8e4] p-6">
              <FormTabBar
                active={formTab}
                onChange={(t) => { setFormTab(t); setSubmitError(""); }}
              />

              {submitError && (
                <div className="mb-5">
                  <ErrorMsg msg={submitError} />
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-6">
                {formTab === "new_hire" && (
                  <NewHireFields form={newHire} set={setNewHire} />
                )}
                {formTab === "role_change" && (
                  <RoleChangeFields form={roleChange} set={setRoleChange} />
                )}
                {formTab === "termination" && (
                  <TerminationFields form={termination} set={setTermination} />
                )}

                {formTab === "termination" && (
                  <div className="rounded-[9px] bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                    All access revocation actions are <strong>HUMAN ONLY</strong> and will require
                    compliance approval before executing. This action cannot be undone.
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-[9px] bg-[#111] text-white py-2.5 text-sm font-sora font-semibold hover:bg-black disabled:opacity-40 transition-colors"
                >
                  {submitting ? "Submitting…" : "Submit Event →"}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ── Event History tab ──────────────────────────────────────────────── */}
        {pageTab === "history" && (
          <div>
            {/* Toolbar: filter pills + search */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex gap-2 flex-wrap">
                {filterPills.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setHistFilter(p.id)}
                    className={`px-3 py-1.5 text-xs font-sora font-semibold rounded-[7px] transition-colors ${
                      histFilter === p.id
                        ? "bg-[#111] text-white"
                        : "bg-white border border-[#e8e8e4] text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {p.label}
                    <span className={`ml-1.5 ${histFilter === p.id ? "text-gray-300" : "text-gray-400"}`}>
                      {filterCounts[p.id]}
                    </span>
                  </button>
                ))}
              </div>
              <input
                type="search"
                value={histSearch}
                onChange={(e) => setHistSearch(e.target.value)}
                placeholder="Search by name or email…"
                className="rounded-[9px] border border-[#e8e8e4] px-3 py-1.5 text-sm focus:outline-none focus:border-[#111] focus:shadow-[0_0_0_3px_rgba(0,0,0,0.06)] bg-white w-56 transition-shadow"
              />
            </div>

            {histLoading ? (
              <div className="bg-white rounded-[14px] border border-[#e8e8e4] p-10 text-center text-sm text-gray-400">
                Loading…
              </div>
            ) : histError ? (
              <div className="mb-4"><ErrorMsg msg={histError} /></div>
            ) : filteredGroups.length === 0 ? (
              <div className="bg-white rounded-[14px] border border-[#e8e8e4] p-10 text-center text-sm text-gray-400">
                {eventGroups.length === 0
                  ? "No HR events submitted yet."
                  : "No events match your filter."}
              </div>
            ) : (
              <div className="bg-white rounded-[14px] border border-[#e8e8e4] overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[#e8e8e4]">
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-400">Employee</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">Event Type</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">Department</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">Submitted</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f0f0ed]">
                    {pagedGroups.map((group) => {
                      const isHighlighted = highlightedEventId === group.eventId;
                      return (
                        <tr
                          key={group.eventId}
                          onClick={() => setPanelGroup(group)}
                          className={`cursor-pointer transition-colors ${
                            isHighlighted
                              ? "ring-2 ring-inset ring-amber-300 bg-amber-50"
                              : "hover:bg-gray-50"
                          }`}
                        >
                          <td className="px-5 py-3">
                            <span className="font-sora text-sm font-semibold text-gray-900">
                              {group.employee}
                            </span>
                            {group.email && group.employee !== group.email && (
                              <span className="block text-xs text-gray-400">{group.email}</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${EVENT_TYPE_CLS[group.eventType]}`}>
                              {EVENT_TYPE_LABEL[group.eventType]}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600 capitalize">
                            {group.department || "—"}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-400">
                            {timeAgo(group.submittedAt)}
                          </td>
                          <td className="px-4 py-3">
                            {groupStatusSummary(group)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="border-t border-[#e8e8e4] px-5 py-3 flex items-center justify-between">
                    <span className="text-xs text-gray-400">
                      Showing {(histPage - 1) * PAGE_SIZE + 1}–{Math.min(histPage * PAGE_SIZE, filteredGroups.length)} of {filteredGroups.length}
                    </span>
                    <div className="flex gap-1">
                      <button
                        disabled={histPage === 1}
                        onClick={() => setHistPage((p) => p - 1)}
                        className="px-3 py-1.5 text-xs font-sora font-semibold rounded-[7px] border border-[#e8e8e4] text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        ← Prev
                      </button>
                      <button
                        disabled={histPage === totalPages}
                        onClick={() => setHistPage((p) => p + 1)}
                        className="px-3 py-1.5 text-xs font-sora font-semibold rounded-[7px] border border-[#e8e8e4] text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        Next →
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Slide-out panel — rendered outside the content flow so it overlays everything */}
      <SlidePanel
        group={panelGroup}
        liveReqs={panelLiveReqs}
        onClose={closePanel}
      />
    </Layout>
  );
}

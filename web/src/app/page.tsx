"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Layout from "@/lib/Layout";
import { approvals, requests, drift } from "@/lib/api";

// ── Requester form data tables ─────────────────────────────────────────────────

const SYSTEMS = [
  { value: "github", label: "GitHub Repository" },
  { value: "slack",  label: "Slack Channel" },
  { value: "vpn",    label: "VPN Access" },
  { value: "drive",  label: "Google Drive Folder" },
  { value: "jira",   label: "Jira Project" },
  { value: "aws",    label: "AWS Console" },
] as const;

type SystemKey = (typeof SYSTEMS)[number]["value"];

const SYSTEM_INTENT: Record<SystemKey, string> = {
  github: "provision_repository_access",
  slack:  "invite_to_channel",
  vpn:    "provision_vpn_access",
  drive:  "provision_drive_access",
  jira:   "provision_jira_access",
  aws:    "provision_aws_access",
};

const RESOURCE_FIELD: Record<SystemKey, { label: string; placeholder: string; key: string }> = {
  github: { label: "Repository name",    placeholder: "e.g. payments-service",    key: "repo" },
  slack:  { label: "Channel name",       placeholder: "e.g. #engineering-alerts", key: "channel" },
  vpn:    { label: "VPN group",          placeholder: "e.g. employees",            key: "vpn_group" },
  drive:  { label: "Folder name or URL", placeholder: "e.g. Q2 Audit Documents",  key: "folder" },
  jira:   { label: "Project key",        placeholder: "e.g. RISK, ENG",            key: "project_key" },
  aws:    { label: "AWS service / role", placeholder: "e.g. s3-readonly",          key: "service" },
};

const RISK_BANNER: Record<SystemKey, {
  level: string; bg: string; border: string; text: string; icon: string; desc: string;
}> = {
  slack:  { level: "LOW",        bg: "bg-green-50", border: "border-green-200", text: "text-green-800", icon: "✓",  desc: "will be provisioned automatically" },
  drive:  { level: "MEDIUM",     bg: "bg-blue-50",  border: "border-blue-200",  text: "text-blue-800",  icon: "ℹ",  desc: "will be auto-provisioned after a brief policy check" },
  jira:   { level: "MEDIUM",     bg: "bg-blue-50",  border: "border-blue-200",  text: "text-blue-800",  icon: "ℹ",  desc: "will be auto-provisioned after a brief policy check" },
  github: { level: "HIGH",       bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-800", icon: "⚠", desc: "requires a compliance approver to review before it executes" },
  vpn:    { level: "HIGH",       bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-800", icon: "⚠", desc: "requires a compliance approver to review before it executes" },
  aws:    { level: "HUMAN ONLY", bg: "bg-red-50",   border: "border-red-200",   text: "text-red-800",   icon: "🔒", desc: "written justification and human approval are mandatory" },
};

const PERMISSIONS = ["Member", "Read only", "Read & write", "Admin"];

function genKey() {
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const inputCls =
  "w-full rounded-[9px] border border-[#e8e8e4] px-3 py-2 text-sm focus:outline-none focus:border-[#111] focus:shadow-[0_0_0_3px_rgba(0,0,0,0.06)] bg-white transition-shadow";

// ── Dashboard helpers ─────────────────────────────────────────────────────────

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function formatToday(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
}

// ── Dashboard icons ───────────────────────────────────────────────────────────

function IconClock() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function IconAlert() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function IconRefresh() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

function IconFile() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

// ── Admin dashboard ───────────────────────────────────────────────────────────

function AdminDashboard({ email }: { email: string }) {
  const [loading, setLoading] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [oldPendingCount, setOldPendingCount] = useState(0);
  const [driftCount, setDriftCount] = useState(0);
  const [autoRevokedCount, setAutoRevokedCount] = useState(0);
  const [todayCount, setTodayCount] = useState(0);

  const fetchData = useCallback(async () => {
    const now = Date.now();
    const oneDayMs = 24 * 3600 * 1000;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [pendingRes, driftRes, reqsRes] = await Promise.allSettled([
      approvals.pending(),
      drift.scan(),
      requests.list(500),
    ]);

    if (pendingRes.status === "fulfilled") {
      const items = pendingRes.value;
      setPendingCount(items.length);
      const cutoff = now - oneDayMs;
      setOldPendingCount(
        items.filter((r) => {
          const ts = r.created_at.endsWith("Z") ? r.created_at : r.created_at + "Z";
          return new Date(ts).getTime() < cutoff;
        }).length
      );
    }

    if (driftRes.status === "fulfilled") {
      setDriftCount(driftRes.value.length);
    }

    if (reqsRes.status === "fulfilled") {
      const reqs = reqsRes.value;
      const cutoff24 = now - oneDayMs;
      setAutoRevokedCount(
        reqs.filter((r) => {
          if (!r.auto_revoked) return false;
          const ts = r.updated_at.endsWith("Z") ? r.updated_at : r.updated_at + "Z";
          return new Date(ts).getTime() >= cutoff24;
        }).length
      );
      setTodayCount(
        reqs.filter((r) => {
          const ts = r.created_at.endsWith("Z") ? r.created_at : r.created_at + "Z";
          return new Date(ts) >= startOfToday;
        }).length
      );
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const cards = [
    {
      label:   "Pending Approvals",
      count:   pendingCount,
      href:    "/approvals",
      iconBg:  "bg-amber-50 text-amber-500",
      icon:    <IconClock />,
    },
    {
      label:   "Drift Findings",
      count:   driftCount,
      href:    "/drift",
      iconBg:  "bg-red-50 text-red-500",
      icon:    <IconAlert />,
    },
    {
      label:   "Auto-revoked Last 24h",
      count:   autoRevokedCount,
      href:    "/approvals?tab=history",
      iconBg:  "bg-blue-50 text-blue-500",
      icon:    <IconRefresh />,
    },
    {
      label:   "Total Requests Today",
      count:   todayCount,
      href:    "/approvals?tab=history",
      iconBg:  "bg-green-50 text-green-600",
      icon:    <IconFile />,
    },
  ];

  const CONNECTED_SYSTEMS = ["Okta", "GitHub", "Slack", "Google Workspace", "VPN"];

  return (
    <div className="pb-12">
      {/* Page header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="font-sora text-[22px] font-bold text-gray-900">
            {getGreeting()}, {email}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Here&rsquo;s your access posture overview
          </p>
        </div>
        <p className="text-sm text-gray-400 mt-1 text-right shrink-0 ml-6">
          {formatToday()}
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {cards.map((card) => (
          <a
            key={card.label}
            href={card.href}
            className="bg-white rounded-[14px] border border-[#e8e8e4] p-5 flex flex-col gap-4 hover:shadow-sm transition-shadow no-underline group"
          >
            <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${card.iconBg}`}>
              {card.icon}
            </div>
            <div>
              <p className="font-sora text-[32px] font-bold text-gray-900 leading-none">
                {loading ? (
                  <span className="inline-block h-8 w-12 rounded-lg bg-gray-100 animate-pulse" />
                ) : (
                  card.count
                )}
              </p>
              <p className="text-sm text-gray-500 mt-1.5">{card.label}</p>
            </div>
          </a>
        ))}
      </div>

      {/* Alert banners */}
      {!loading && oldPendingCount > 0 && (
        <div className="mb-4 rounded-[12px] bg-amber-50 border border-amber-200 px-4 py-3 flex items-center justify-between gap-4">
          <p className="text-sm text-amber-800">
            <strong>{oldPendingCount}</strong> request{oldPendingCount > 1 ? "s have" : " has"} been awaiting approval for more than 24 hours — review now
          </p>
          <a
            href="/approvals"
            className="text-sm font-semibold text-amber-800 hover:text-amber-900 whitespace-nowrap underline underline-offset-2"
          >
            Go to Approvals →
          </a>
        </div>
      )}
      {!loading && driftCount > 0 && (
        <div className="mb-4 rounded-[12px] bg-red-50 border border-red-200 px-4 py-3 flex items-center justify-between gap-4">
          <p className="text-sm text-red-800">
            <strong>{driftCount}</strong> unresolved drift finding{driftCount > 1 ? "s" : ""} require attention
          </p>
          <a
            href="/drift"
            className="text-sm font-semibold text-red-800 hover:text-red-900 whitespace-nowrap underline underline-offset-2"
          >
            Go to Drift →
          </a>
        </div>
      )}

      {/* System health */}
      <div className="bg-white rounded-[14px] border border-[#e8e8e4] px-5 py-4">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Connected Systems
        </p>
        <div className="flex flex-wrap gap-2">
          {CONNECTED_SYSTEMS.map((sys) => (
            <div
              key={sys}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#e8e8e4] bg-white text-xs font-medium text-gray-700"
            >
              <span className="h-2 w-2 rounded-full bg-green-500 flex-shrink-0" />
              {sys}
              <span className="text-gray-400 font-normal">Connected</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Requester form ────────────────────────────────────────────────────────────

function RequesterView({ email: userEmail }: { email: string }) {
  const router = useRouter();

  const [system, setSystem] = useState<SystemKey | "">("");
  const [resource, setResource] = useState("");
  const [permission, setPermission] = useState("Read only");
  const [justification, setJustification] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [successId, setSuccessId] = useState<string | null>(null);
  const [successLabel, setSuccessLabel] = useState("");

  const step1 = system !== "";
  const step2 = step1 && resource.trim() !== "";
  const step3 = step2 && justification.trim() !== "";
  const step4 = expiresAt !== "";
  const steps = [step1, step2, step3, step4];

  function handleSystemChange(v: SystemKey | "") {
    setSystem(v);
    setResource("");
    setFormError("");
    setSuccessId(null);
  }

  function handleClear() {
    setSystem("");
    setResource("");
    setPermission("Read only");
    setJustification("");
    setExpiresAt("");
    setFormError("");
    setSuccessId(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");

    if (!system) { setFormError("Please select a system."); return; }
    if (!resource.trim()) { setFormError("Please fill in the resource field."); return; }
    if (!justification.trim()) { setFormError("Please provide a justification."); return; }
    if (expiresAt && new Date(`${expiresAt}T23:59:59Z`) <= new Date()) {
      setFormError("Expiry date must be in the future.");
      return;
    }

    const resourceKey = RESOURCE_FIELD[system].key;
    const systemLabel = SYSTEMS.find((s) => s.value === system)!.label;

    setSubmitting(true);
    try {
      const res = await requests.submit({
        idempotency_key: genKey(),
        intent: SYSTEM_INTENT[system],
        payload: {
          user_email: userEmail,
          [resourceKey]: resource.trim(),
          permission,
        },
        justification: justification.trim(),
        expires_at: expiresAt ? `${expiresAt}T23:59:59Z` : null,
      });
      setSuccessId(res.id);
      setSuccessLabel(systemLabel);
      handleClear();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  }

  const banner = system ? RISK_BANNER[system] : null;
  const resourceField = system ? RESOURCE_FIELD[system] : null;
  const canSubmit = step3 && !submitting;

  return (
    <div className="max-w-[560px] mx-auto pt-4 pb-12 px-4">
      <div className="mb-6">
        <h1 className="font-sora text-[22px] font-bold text-gray-900">Request Access</h1>
        <p className="text-sm text-gray-500 mt-1">
          Submit a request — AI will assess risk and route it automatically
        </p>
      </div>

      {successId && (
        <div className="mb-5 rounded-xl bg-green-50 border border-green-200 px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-green-700">
            ✓ Access request submitted for <strong>{successLabel}</strong>.
          </span>
          <button
            onClick={() => router.push(`/requests/${successId}`)}
            className="ml-3 text-sm text-green-700 underline whitespace-nowrap font-medium"
          >
            View request →
          </button>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-[#e8e8e4] p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">New Access Request</p>
            <p className="text-xs text-gray-400 mt-0.5">All fields marked are required</p>
          </div>
          <div className="flex gap-1.5" title="Steps 1–3 required; step 4 optional (expiry)">
            {steps.map((done, i) => (
              <div
                key={i}
                className={`w-6 h-1.5 rounded-sm transition-colors ${done ? "bg-[#111]" : "bg-[#e8e8e4]"}`}
              />
            ))}
          </div>
        </div>

        {formError && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {formError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              What do you need access to?
            </label>
            <select
              value={system}
              onChange={(e) => handleSystemChange(e.target.value as SystemKey | "")}
              className={inputCls}
            >
              <option value="" disabled>— Select a system —</option>
              {SYSTEMS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>

          <div className={`grid grid-cols-2 gap-3 transition-opacity duration-150 ${system ? "opacity-100" : "opacity-40 pointer-events-none"}`}>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                {resourceField?.label ?? "Resource"}
              </label>
              <input
                type="text"
                value={resource}
                onChange={(e) => setResource(e.target.value)}
                placeholder={resourceField?.placeholder ?? ""}
                disabled={!system}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Permission level
              </label>
              <select
                value={permission}
                onChange={(e) => setPermission(e.target.value)}
                disabled={!system}
                className={inputCls}
              >
                {PERMISSIONS.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>

          <hr className="border-[#e8e8e4]" />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Why do you need this?{" "}
              <span className="text-gray-400 font-normal text-xs">Required for audit trail</span>
            </label>
            <textarea
              rows={3}
              maxLength={200}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Describe why you need this access..."
              className={`${inputCls} resize-none`}
            />
            <p className={`text-xs mt-1 text-right ${justification.length > 160 ? "text-amber-500" : "text-gray-400"}`}>
              {justification.length} / 200
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-0.5">
              Access expires
            </label>
            <p className="text-xs text-gray-400 mb-1.5">Optional — leave blank for permanent access</p>
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
              className={inputCls}
            />
          </div>

          <hr className="border-[#e8e8e4]" />

          {banner && (
            <div className={`rounded-xl border px-4 py-3 ${banner.bg} ${banner.border}`}>
              <div className={`flex items-start gap-2 ${banner.text}`}>
                <span className="text-base leading-5 flex-shrink-0">{banner.icon}</span>
                <span className="text-sm">
                  <strong>{banner.level}</strong> — this request {banner.desc}.
                </span>
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={!canSubmit}
              className="flex-1 rounded-[9px] bg-[#111] text-white py-2.5 text-sm font-sora font-semibold hover:bg-black disabled:opacity-40 transition-colors"
            >
              {submitting ? "Submitting…" : "Submit Request →"}
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="rounded-[9px] border border-[#e8e8e4] px-5 py-2.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Clear
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    setRole(localStorage.getItem("role") ?? "");
    setEmail(localStorage.getItem("email") ?? "");
  }, []);

  return (
    <Layout>
      {role === "admin" ? (
        <AdminDashboard email={email} />
      ) : (
        // role === "" (loading) falls through to the form, which is fine —
        // Layout handles the auth redirect if there's no token.
        <RequesterView email={email} />
      )}
    </Layout>
  );
}

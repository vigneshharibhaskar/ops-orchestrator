"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Layout from "@/lib/Layout";
import { requests } from "@/lib/api";

// ── Data tables ──────────────────────────────────────────────────────────────

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

// ── Component ────────────────────────────────────────────────────────────────

export default function RequestAccessPage() {
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
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    setUserEmail(localStorage.getItem("email") ?? "");
  }, []);

  // Progress steps
  const step1 = system !== "";
  const step2 = step1 && resource.trim() !== "";
  const step3 = step2 && justification.trim() !== "";
  const step4 = expiresAt !== ""; // optional — only fills when expiry is explicitly set
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
    <Layout>
      <div className="max-w-[560px] mx-auto pt-4 pb-12 px-4">
        {/* Page header */}
        <div className="mb-6">
          <h1 className="font-sora text-[22px] font-bold text-gray-900">Request Access</h1>
          <p className="text-sm text-gray-500 mt-1">
            Submit a request — AI will assess risk and route it automatically
          </p>
        </div>

        {/* Success banner */}
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

        {/* Main card */}
        <div className="bg-white rounded-2xl border border-[#e8e8e4] p-6 space-y-5">
          {/* Card header */}
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

          {/* Error */}
          {formError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {formError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Field 1 — System */}
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

            {/* Field 2 — Resource + Permission */}
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

            {/* Field 3 — Justification */}
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

            {/* Field 4 — Expiry (optional) */}
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

            {/* Risk banner */}
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

            {/* Submit row */}
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
    </Layout>
  );
}

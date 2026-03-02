"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/api";

const ROLES = [
  {
    key: "hr",
    label: "HR Coordinator",
    description: "Submit lifecycle events — onboarding, offboarding, role changes",
    badge: "HR",
    badgeCls: "bg-violet-500/20 text-violet-300 border border-violet-500/30",
    icon: "👩‍💼",
    email: "hr@acme-fintech.com",
  },
  {
    key: "requester",
    label: "Employee",
    description: "Request individual access, timed grants",
    badge: "REQUESTER",
    badgeCls: "bg-blue-500/20 text-blue-300 border border-blue-500/30",
    icon: "👩‍💻",
    email: "alice@acme-fintech.com",
  },
  {
    key: "approver",
    label: "Compliance Approver",
    description: "Review AI-flagged requests, approve or reject",
    badge: "APPROVER",
    badgeCls: "bg-amber-500/20 text-amber-300 border border-amber-500/30",
    icon: "🔍",
    email: "compliance@acme-fintech.com",
  },
  {
    key: "admin",
    label: "Admin",
    description: "Full access — HR events, audit logs, drift",
    badge: "ADMIN",
    badgeCls: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
    icon: "⚙️",
    email: "admin@acme-fintech.com",
  },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function selectRole(roleKey: string, roleEmail: string) {
    setSelectedRole(roleKey);
    setEmail(roleEmail);
    setPassword("password123");
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await auth.login(email, password);
      localStorage.setItem("token", res.access_token);
      localStorage.setItem("role", res.role);
      localStorage.setItem("email", email);
      const ROLE_REDIRECT: Record<string, string> = {
        hr: "/hr",
        approver: "/approvals",
        requester: "/",
        admin: "/",
      };
      router.replace(ROLE_REDIRECT[res.role] ?? "/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* ── Left panel ──────────────────────────────────────────────────── */}
      <div className="lg:w-[55%] bg-[#0d0d0d] flex flex-col p-8 lg:p-12">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-12">
          <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-emerald-500 text-lg select-none">
            ⚡
          </span>
          <span className="text-white text-sm font-semibold tracking-wide">
            Ops Orchestrator
          </span>
        </div>

        {/* Hero */}
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <span className="inline-block w-5 h-px bg-emerald-400" />
            <span className="text-xs text-emerald-400 uppercase tracking-widest font-medium">
              Access Intelligence
            </span>
          </div>
          <h1 className="text-4xl lg:text-5xl font-black text-white leading-tight mb-2">
            AI-native ops.
          </h1>
          <h1 className="text-4xl lg:text-5xl font-black text-emerald-400 leading-tight mb-6">
            Human in control.
          </h1>
          <p className="text-sm text-zinc-400 max-w-sm leading-relaxed">
            Automates access provisioning across the full employee lifecycle —
            with drift detection, timed grants, and a hard human gate on every
            sensitive decision.
          </p>
        </div>

        {/* Role cards */}
        <div className="flex-1">
          <p className="text-xs text-zinc-500 uppercase tracking-widest mb-3 font-medium">
            Choose your role
          </p>
          <div className="space-y-2">
            {ROLES.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => selectRole(r.key, r.email)}
                className={`w-full flex items-center gap-3 rounded-xl p-4 text-left transition-all ${
                  selectedRole === r.key
                    ? "bg-zinc-800 ring-1 ring-emerald-500/50"
                    : "bg-zinc-900 hover:bg-zinc-800"
                }`}
              >
                <span className="text-2xl flex-shrink-0 select-none">{r.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white">{r.label}</div>
                  <div className="text-xs text-zinc-500 truncate mt-0.5">
                    {r.description}
                  </div>
                </div>
                <span
                  className={`flex-shrink-0 text-xs font-semibold px-2 py-0.5 rounded ${r.badgeCls}`}
                >
                  {r.badge}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Footer */}
        <p className="mt-8 text-xs text-zinc-600">
          Acme Fintech · Internal tooling · v1.1.0
        </p>
      </div>

      {/* ── Right panel ─────────────────────────────────────────────────── */}
      <div className="lg:w-[45%] bg-white flex flex-col justify-center px-10 lg:px-16 py-12">
        <div className="max-w-sm w-full mx-auto">
          <h2 className="text-3xl font-bold text-gray-900">Welcome back</h2>
          <p className="text-sm text-gray-500 mt-1 mb-8">
            Sign in to your workspace
          </p>

          {error && (
            <div className="mb-5 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@acme-fintech.com"
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-gray-900 text-white py-3 text-sm font-semibold hover:bg-black disabled:opacity-50 transition-colors mt-2"
            >
              {loading ? "Signing in…" : "Sign in →"}
            </button>
          </form>

          <p className="text-xs text-gray-400 text-center mt-6">
            Select a role on the left to auto-fill
          </p>
        </div>
      </div>
    </div>
  );
}

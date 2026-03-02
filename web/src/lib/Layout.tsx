"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function useRole(): string {
  const [role, setRole] = useState("");
  useEffect(() => {
    setRole(localStorage.getItem("role") ?? "");
  }, []);
  return role;
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [role, setRole] = useState("");

  useEffect(() => {
    const tok = localStorage.getItem("token");
    if (!tok) {
      router.replace("/login");
    } else {
      setRole(localStorage.getItem("role") ?? "");
      setReady(true);
    }
  }, [router]);

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    localStorage.removeItem("email");
    router.replace("/login");
  }

  if (!ready) return null;

  const navLink = (href: string, label: string) => (
    <Link
      href={href}
      className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
        pathname === href || pathname.startsWith(href + "/")
          ? "bg-indigo-700 text-white"
          : "text-indigo-100 hover:bg-indigo-700"
      }`}
    >
      {label}
    </Link>
  );

  const canApprove = role === "approver" || role === "admin";
  const isAdmin = role === "admin";
  const isHR = role === "hr";
  const isRequester = role === "requester";

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="bg-indigo-800 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-4">
          <span className="text-white font-semibold mr-4">Ops Orchestrator</span>
          {isRequester ? navLink("/", "Request Access") : navLink("/", "Dashboard")}
          {isRequester && navLink("/my-requests", "My Requests")}
          {canApprove && navLink("/approvals", "Approvals")}
          {(isAdmin || isHR) && navLink("/hr", "HR Events")}
          {canApprove && navLink("/drift", "Drift")}
          <button
            onClick={logout}
            className="ml-auto text-indigo-200 hover:text-white text-sm transition-colors"
          >
            Logout
          </button>
        </div>
      </nav>
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-8">
        {children}
      </main>
    </div>
  );
}

// ── Reusable UI primitives ────────────────────────────────────────────────────

const RISK_COLORS: Record<string, string> = {
  LOW: "bg-green-100 text-green-800",
  MEDIUM: "bg-yellow-100 text-yellow-800",
  HIGH: "bg-orange-100 text-orange-800",
  HUMAN_ONLY: "bg-red-100 text-red-800",
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-gray-100 text-gray-700",
  PLANNING: "bg-blue-100 text-blue-700",
  NEEDS_CLARIFICATION: "bg-purple-100 text-purple-700",
  AWAITING_APPROVAL: "bg-yellow-100 text-yellow-700",
  APPROVED: "bg-indigo-100 text-indigo-700",
  REJECTED: "bg-red-100 text-red-700",
  EXECUTING: "bg-blue-100 text-blue-700",
  COMPLETED: "bg-green-100 text-green-700",
  FAILED: "bg-red-100 text-red-700",
};

export function RiskBadge({ level }: { level?: string | null }) {
  if (!level) return null;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${RISK_COLORS[level] ?? "bg-gray-100 text-gray-700"}`}
    >
      {level}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${STATUS_COLORS[status] ?? "bg-gray-100 text-gray-700"}`}
    >
      {status}
    </span>
  );
}

export function ErrorMsg({ msg }: { msg: string }) {
  return (
    <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
      {msg}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 rounded-full border-4 border-indigo-200 border-t-indigo-600 animate-spin" />
    </div>
  );
}

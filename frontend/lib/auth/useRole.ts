"use client";
// frontend/lib/auth/useRole.ts — the signed-in user's role, for drawing buttons.
//
// A display value only (same as /api/auth/me): the backend decides the real permission. Returns
// `undefined` while loading, so callers can tell "not known yet" from "no role" (null). The home
// screen hides its create controls only once the role is known to be viewer — holding them back
// for everyone until the fetch lands would slow the common case to spare the shared read-only
// account a brief flash.
import { useEffect, useState } from "react";

export type MyRole = "admin" | "pm" | "viewer" | null;

export function useRole(): MyRole | undefined {
  const [role, setRole] = useState<MyRole | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void fetch("/api/auth/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => { if (alive) setRole(body?.role ?? null); })
      .catch(() => { if (alive) setRole(null); });
    return () => { alive = false; };
  }, []);
  return role;
}

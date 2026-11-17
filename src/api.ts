import { useEffect, useRef, useState } from "react";
import type { View } from "./engine/types";

export interface GameSummary {
  id: string;
  name: string;
  phase: string;
  round: number;
  rounds: number;
  seats: { name: string; kind: string; color: string }[];
  open: boolean;
  createdAt: number;
}

const tokenKey = (id: string) => `driftholm:token:${id}`;
export const getToken = (id: string) => localStorage.getItem(tokenKey(id));
export const setToken = (id: string, t: string) => localStorage.setItem(tokenKey(id), t);

async function call<T>(path: string, init: RequestInit = {}, token?: string | null): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  list: () => call<GameSummary[]>("/api/games"),
  create: (name: string, opts: { exchangeSeconds?: number; buildSeconds?: number; rounds?: number }) =>
    call<{ id: string }>("/api/games", { method: "POST", body: JSON.stringify({ name, ...opts }) }),
  join: (id: string, name: string) =>
    call<{ token: string; seat: string; state: View }>(`/api/games/${id}/join`, {
      method: "POST",
      body: JSON.stringify({ name, kind: "human" }),
    }),
  act: (id: string, action: "start" | "bots" | "say" | "offer" | "accept" | "cancel" | "bank" | "orders" | "done", body: object = {}) =>
    call<View>(`/api/games/${id}/${action}`, { method: "POST", body: JSON.stringify(body) }, getToken(id)),
};

/** Follows a game with the same long-poll agents use. */
export function useGame(id: string) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const version = useRef(0);
  const [tokenRev, setTokenRev] = useState(0);

  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    version.current = 0;
    (async () => {
      while (alive) {
        try {
          const t = getToken(id);
          const res = await fetch(`/api/games/${id}/wait?since=${version.current}&timeout=50`, {
            headers: t ? { authorization: `Bearer ${t}` } : {},
            signal: ctrl.signal,
          });
          if (!res.ok) throw new Error((await res.json()).error ?? "Lost the game.");
          const v = (await res.json()) as View;
          version.current = v.version;
          setView(v);
          setError(null);
        } catch (e) {
          if (!alive) return;
          setError((e as Error).message);
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    })();
    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [id, tokenRev]);

  return { view, error, refresh: () => setTokenRev((n) => n + 1), apply: (v: View) => setView(v) };
}

/** A ticking clock so countdowns move between server updates. */
export function useNow(ms = 500) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

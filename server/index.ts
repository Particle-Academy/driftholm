import express, { type Request, type Response } from "express";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join as joinPath, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BOT_NAMES, botStep } from "../src/engine/bots";
import {
  accept,
  advance,
  bank,
  cancel,
  createGame,
  join,
  markDone,
  offer,
  project,
  say,
  start,
  submitOrders,
} from "../src/engine/rules";
import type { Game, Result, SeatKind } from "../src/engine/types";
import { playGuide } from "./guide";

// The API runs as a Genie background process on a fixed port; the Vite site proxies /api and /play.md to it.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argPort = process.argv.indexOf("--port");
const port = Number(argPort > -1 ? process.argv[argPort + 1] : process.env.DRIFTHOLM_API_PORT) || 4320;
const dataFile = joinPath(root, "data", "games.json");

// ---------- state ----------

const games = new Map<string, Game>();
if (existsSync(dataFile)) for (const g of JSON.parse(readFileSync(dataFile, "utf8")) as Game[]) games.set(g.id, g);

let saveTimer: NodeJS.Timeout | null = null;
function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    mkdirSync(dirname(dataFile), { recursive: true });
    writeFileSync(dataFile + ".tmp", JSON.stringify([...games.values()]));
    renameSync(dataFile + ".tmp", dataFile);
  }, 500);
}

const waiters = new Map<string, Set<() => void>>();
function changed(g: Game) {
  persist();
  const set = waiters.get(g.id);
  if (!set) return;
  waiters.delete(g.id);
  for (const wake of set) wake();
}

setInterval(() => {
  const now = Date.now();
  for (const g of games.values()) {
    if (g.phase === "lobby" || g.phase === "ended") continue;
    const v = g.version;
    botStep(g, now);
    advance(g, now);
    if (g.version !== v) changed(g);
  }
}, 1000);

// ---------- helpers ----------

const app = express();
app.use(express.json({ limit: "16kb" }));

function token(req: Request): string | null {
  const h = req.get("authorization");
  if (h?.startsWith("Bearer ")) return h.slice(7).trim();
  return typeof req.query.token === "string" ? req.query.token : null;
}
function load(req: Request, res: Response): Game | null {
  const g = games.get(String(req.params.id));
  if (!g) res.status(404).json({ error: "No such game." });
  return g ?? null;
}
const seatOf = (g: Game, req: Request) => {
  const t = token(req);
  return (t && g.seats.find((s) => s.token === t)) || null;
};
function reply(g: Game, req: Request, res: Response, r: Result<unknown>) {
  if (!r.ok) return res.status(400).json({ error: r.error });
  changed(g);
  res.json(project(g, seatOf(g, req)?.id ?? null));
}
/** Wraps an authenticated seat action. */
function action(path: string, run: (g: Game, seatId: string, body: Record<string, unknown>) => Result<unknown>) {
  app.post(`/api/games/:id/${path}`, (req, res) => {
    const g = load(req, res);
    if (!g) return;
    const seat = seatOf(g, req);
    if (!seat) return res.status(401).json({ error: "Send your seat token as 'Authorization: Bearer <token>'." });
    reply(g, req, res, run(g, seat.id, req.body ?? {}));
  });
}
const baseUrl = (req: Request) => {
  const host = (req.get("x-forwarded-host") ?? req.get("host") ?? "").split(",")[0].trim();
  const proto = host.endsWith(".gen") ? "https" : (req.get("x-forwarded-proto")?.split(",")[0].trim() ?? req.protocol);
  return `${proto}://${host}`;
};

// ---------- API ----------

app.get("/api/games", (_req, res) => {
  res.json(
    [...games.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 30)
      .map((g) => ({
        id: g.id,
        name: g.name,
        phase: g.phase,
        round: g.round,
        rounds: g.config.rounds,
        seats: g.seats.map((s) => ({ name: s.name, kind: s.kind, color: s.color })),
        open: g.phase === "lobby" && g.seats.length < g.config.maxSeats,
        createdAt: g.createdAt,
      })),
  );
});

app.post("/api/games", (req, res) => {
  const b = req.body ?? {};
  const num = (v: unknown, lo: number, hi: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : undefined;
  const config = Object.fromEntries(
    Object.entries({
      rounds: num(b.rounds, 4, 20),
      targetVp: num(b.targetVp, 5, 20),
      exchangeSeconds: num(b.exchangeSeconds, 20, 900),
      buildSeconds: num(b.buildSeconds, 20, 900),
    }).filter(([, v]) => v !== undefined),
  );
  const g = createGame({ name: typeof b.name === "string" ? b.name : undefined, config });
  games.set(g.id, g);
  changed(g);
  res.status(201).json({ id: g.id, name: g.name });
});

app.get("/api/games/:id/state", (req, res) => {
  const g = load(req, res);
  if (g) res.json(project(g, seatOf(g, req)?.id ?? null));
});

app.get("/api/games/:id/wait", (req, res) => {
  const g = load(req, res);
  if (!g) return;
  const since = Number(req.query.since) || 0;
  const timeout = Math.min(110, Math.max(1, Number(req.query.timeout) || 60)) * 1000;
  let timer: NodeJS.Timeout | undefined;
  const send = () => {
    clearTimeout(timer);
    if (!res.headersSent) res.json(project(g, seatOf(g, req)?.id ?? null));
  };
  if (g.version > since) return send();
  timer = setTimeout(() => {
    waiters.get(g.id)?.delete(send);
    send();
  }, timeout);
  if (!waiters.has(g.id)) waiters.set(g.id, new Set());
  waiters.get(g.id)!.add(send);
  req.on("close", () => {
    clearTimeout(timer);
    waiters.get(g.id)?.delete(send);
  });
});

app.post("/api/games/:id/join", (req, res) => {
  const g = load(req, res);
  if (!g) return;
  const kind: SeatKind = req.body?.kind === "human" ? "human" : "agent";
  const r = join(g, String(req.body?.name ?? ""), kind);
  if (!r.ok) return res.status(400).json({ error: r.error });
  changed(g);
  res.status(201).json({ token: r.value.token, seat: r.value.id, state: project(g, r.value.id) });
});

action("bots", (g, seatId) => {
  if (seatId !== g.hostSeat) return { ok: false, error: "Only the host adds bots." };
  const name = BOT_NAMES.find((n) => !g.seats.some((s) => s.name === n));
  return name ? join(g, name, "bot") : { ok: false, error: "No bots left." };
});
action("start", (g, seatId) => start(g, seatId));
action("say", (g, seatId, b) => say(g, seatId, String(b.text ?? "")));
action("offer", (g, seatId, b) => offer(g, seatId, b));
action("accept", (g, seatId, b) => accept(g, seatId, String(b.offer ?? "")));
action("cancel", (g, seatId, b) => cancel(g, seatId, String(b.offer ?? "")));
action("bank", (g, seatId, b) => bank(g, seatId, b.give, b.get));
action("orders", (g, seatId, b) => submitOrders(g, seatId, b.orders));
action("done", (g, seatId) => markDone(g, seatId));

app.get(["/play.md", "/api/games/:id/play.md"], (req, res) => {
  const param = (req.params as { id?: string }).id;
  const id = param ?? (typeof req.query.game === "string" ? req.query.game : null);
  res.type("text/markdown").send(playGuide(baseUrl(req), id && games.has(id) ? id : null, id ? games.get(id)?.config : undefined));
});

app.use("/api", (_req, res) => res.status(404).json({ error: "Unknown endpoint. See /play.md." }));

app.listen(port, "127.0.0.1", () => console.log(`Driftholm API on http://127.0.0.1:${port}`));

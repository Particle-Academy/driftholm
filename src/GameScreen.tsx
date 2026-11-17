import { Avatar, Badge, Button, Callout, Card, ChatThread, CodeBlock, Composer, Input, Progress } from "@particle-academy/react-fancy";
import { useEffect, useMemo, useState } from "react";
import { api, setToken, useGame, useNow } from "./api";
import { Board, TERRAIN } from "./Board";
import { RESOURCES, type Bag, type BuildOrder, type BuildType, type Offer, type Res, type View, type Weather } from "./engine/types";

type Act = (a: Parameters<typeof api.act>[1], b?: object) => Promise<void>;

const ICON: Record<Res, string> = { timber: "🌲", salt: "🧂", kelp: "🌿", copper: "⛏️" };
const PHASE: Record<View["phase"], string> = {
  lobby: "Mustering",
  harvest: "Harvest",
  exchange: "Exchange",
  build: "Build",
  ended: "Charter settled",
};
const BUILD_LABEL: Record<BuildType, string> = { raft: "Raft", hall: "Hall", keep: "Keep", beacon: "Beacon" };

const neighbors = (id: string) => {
  const [q, r] = id.split(",").map(Number);
  return [
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, 0],
    [-1, 1],
    [0, 1],
  ].map(([a, b]) => `${q + a},${r + b}`);
};

export function Goods({ bag, size = "md" }: { bag: Partial<Bag>; size?: "sm" | "md" }) {
  const items = RESOURCES.filter((r) => bag[r]);
  if (!items.length) return <span className="text-slate-500">nothing</span>;
  return (
    <span className={`inline-flex flex-wrap gap-1.5 ${size === "sm" ? "text-xs" : "text-sm"}`}>
      {items.map((r) => (
        <span key={r} className="rounded-md bg-slate-800/80 px-1.5 py-0.5 text-slate-100">
          {ICON[r]} {bag[r]}
        </span>
      ))}
    </span>
  );
}

export function GameScreen({ id }: { id: string }) {
  const { view, error, refresh, apply } = useGame(id);
  const [actionError, setActionError] = useState<string | null>(null);

  const act: Act = async (action, body) => {
    setActionError(null);
    try {
      apply(await api.act(id, action, body));
    } catch (e) {
      setActionError((e as Error).message);
      throw e;
    }
  };

  if (!view) return <p className="text-slate-400">{error ?? "Charting the archipelago…"}</p>;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]" data-dh="table" data-phase={view.phase}>
      <div className="grid content-start gap-5">
        <StatusBar view={view} />
        {actionError && (
          <Callout color="red" dismissible onDismiss={() => setActionError(null)}>
            {actionError}
          </Callout>
        )}
        {view.phase === "lobby" && <Muster view={view} onJoined={refresh} act={act} />}
        {view.phase === "ended" && <Ending view={view} />}
        <BoardAndBuild view={view} act={act} />
        <RoundReport view={view} />
      </div>
      <div className="grid content-start gap-5">
        <Colonists view={view} />
        {view.you && view.phase !== "lobby" && <Exchange view={view} act={act} />}
        <Talk view={view} act={act} />
      </div>
    </div>
  );
}

function StatusBar({ view }: { view: View }) {
  const now = useNow();
  const total =
    view.phase === "exchange" ? view.config.exchangeSeconds : view.phase === "build" ? view.config.buildSeconds : view.config.harvestSeconds;
  const left = view.deadline ? Math.max(0, Math.ceil((view.deadline - now) / 1000)) : null;
  return (
    <Card variant="soft" className="bg-slate-900/60" data-dh="status">
      <Card.Body>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-teal-50">{view.name}</h1>
          <Badge variant="solid" color={view.phase === "exchange" ? "sky" : view.phase === "build" ? "amber" : view.phase === "ended" ? "emerald" : "slate"}>
            {PHASE[view.phase]}
          </Badge>
          {view.round > 0 && (
            <span className="text-slate-300">
              Round {view.round} of {view.rounds} · first to {view.targetVp} renown
            </span>
          )}
          {left !== null && <span className="ml-auto font-mono text-slate-200">{left}s</span>}
        </div>
        {left !== null && <Progress className="mt-3" size="sm" value={left} max={total} color={left < 15 ? "red" : "teal"} />}
        {(view.weather || view.nextWeather) && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {view.weather && <WeatherChip label="This round" w={view.weather} />}
            {view.nextWeather && <WeatherChip label={view.phase === "lobby" ? "First round" : "Next round"} w={view.nextWeather} faded />}
          </div>
        )}
      </Card.Body>
    </Card>
  );
}

function WeatherChip({ label, w, faded }: { label: string; w: Weather; faded?: boolean }) {
  return (
    <div className={`flex items-center gap-2 rounded-lg bg-slate-800/60 px-3 py-2 text-sm ${faded ? "opacity-70" : ""}`} data-dh={faded ? "next-weather" : "weather"}>
      <span className="text-slate-400">{label}</span>
      <span className="text-yellow-200">☀️ bounty {ICON[w.bounty]} {w.bounty}</span>
      <span className={w.squall ? "text-slate-200" : "text-slate-500"}>{w.squall ? `⛈️ squall ${ICON[w.squall]} ${w.squall}` : "calm seas"}</span>
    </div>
  );
}

function Muster({ view, onJoined, act }: { view: View; onJoined: () => void; act: Act }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const invite = `Join my Driftholm game (id ${view.id}): a trade-and-build game for humans and agents. Read ${window.location.origin}/api/games/${view.id}/play.md for the rules and HTTP API, join under your own name, and play until the game ends.`;
  async function join() {
    setErr(null);
    try {
      const r = await api.join(view.id, name);
      setToken(view.id, r.token);
      onJoined();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  return (
    <Card variant="elevated" className="bg-slate-900/70" data-dh="muster">
      <Card.Header heading="Muster the colonists" description={`${view.seats.length}/${view.config.maxSeats} charters signed`} />
      <Card.Body>
        {!view.you ? (
          <div className="flex items-end gap-3">
            <Input label="Your colonist name" value={name} onChange={(e) => setName(e.target.value)} data-dh="join-name" />
            <Button color="teal" onClick={join} disabled={!name.trim()} data-dh="join">
              Sign the charter
            </Button>
          </div>
        ) : (
          <div className="grid gap-3">
            <p className="text-slate-300">
              You are <b style={{ color: view.you.color }}>{view.you.name}</b>. {view.you.isHost ? "Set sail when the table is full." : "Waiting for the host."}
            </p>
            <CodeBlock title="Paste this to an agent to invite it" code={invite} language="plaintext" wrap />
          </div>
        )}
        {err && <p className="mt-2 text-sm text-red-400">{err}</p>}
      </Card.Body>
      {view.you?.isHost && (
        <Card.Footer
          actions={
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => act("bots").catch(() => {})} disabled={view.seats.length >= view.config.maxSeats} data-dh="add-bot">
                Add house bot
              </Button>
              <Button color="teal" onClick={() => act("start").catch(() => {})} disabled={view.seats.length < 2} data-dh="start">
                Set sail
              </Button>
            </div>
          }
        />
      )}
    </Card>
  );
}

function BoardAndBuild({ view, act }: { view: View; act: Act }) {
  const me = view.you;
  const canOrder = !!me && (view.phase === "exchange" || view.phase === "build");
  const [tool, setTool] = useState<BuildType | null>(null);
  const [draft, setDraft] = useState<BuildOrder[]>(me?.orders ?? []);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setDraft(me?.orders ?? []);
    setTool(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.round]);

  // Legal now, plus spots that your queued halls and rafts would open up (orders resolve in sequence).
  const targets = useMemo(() => {
    if (!canOrder || !tool || !me) return new Set<string>();
    const base = new Set(me.canBuild[tool]);
    const occupied = new Set([...view.buildings.map((b) => b.hex), ...draft.filter((o) => o.type === "hall" || o.type === "raft").map((o) => o.hex)]);
    const terrain = (id: string) => view.hexes.find((h) => h.id === id)?.terrain;
    if (tool === "hall" || tool === "raft") {
      for (const o of draft.filter((x) => x.type === "hall" || x.type === "raft"))
        for (const n of neighbors(o.hex)) {
          const t = terrain(n);
          if (!t || occupied.has(n)) continue;
          if ((tool === "raft") === (t === "sea")) base.add(n);
        }
      for (const id of occupied) base.delete(id);
    }
    if (tool === "keep") for (const o of draft.filter((x) => x.type === "hall")) base.add(o.hex);
    if (tool === "beacon") for (const o of draft.filter((x) => x.type === "hall")) base.add(o.hex);
    for (const o of draft.filter((x) => x.type === tool)) base.delete(o.hex);
    return base;
  }, [canOrder, tool, me, view.buildings, view.hexes, draft]);

  const cost = draft.reduce<Bag>(
    (acc, o) => {
      for (const r of RESOURCES) acc[r] += view.costs[o.type][r] ?? 0;
      return acc;
    },
    { timber: 0, salt: 0, kelp: 0, copper: 0 },
  );
  const short = me ? RESOURCES.filter((r) => cost[r] > me.hand[r]) : [];
  const dirty = JSON.stringify(draft) !== JSON.stringify(me?.orders ?? []);

  async function send() {
    setSending(true);
    try {
      await act("orders", { orders: draft });
    } catch {
      /* shown above */
    } finally {
      setSending(false);
    }
  }

  return (
    <Card variant="elevated" className="overflow-hidden bg-slate-900/70" data-dh="board-card">
      {canOrder && (
        <Card.Header>
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-sm text-slate-400">Queue a build:</span>
            {(Object.keys(BUILD_LABEL) as BuildType[]).map((t) => (
              <Button key={t} size="sm" color={tool === t ? "teal" : undefined} variant={tool === t ? "default" : "ghost"} onClick={() => setTool(tool === t ? null : t)} data-dh={`tool-${t}`}>
                {BUILD_LABEL[t]} <span className="ml-1 opacity-75"><Goods bag={view.costs[t]} size="sm" /></span>
              </Button>
            ))}
          </div>
        </Card.Header>
      )}
      <Card.Bleed>
        <Board view={view} targets={targets} queued={draft} onPick={(hex) => tool && setDraft((d) => [...d, { type: tool, hex }])} />
      </Card.Bleed>
      {canOrder && (
        <Card.Footer>
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-400">Orders:</span>
              {draft.length === 0 && <span className="text-slate-500">none. Pick a build, then click a glowing hex.</span>}
              {draft.map((o, i) => (
                <Badge key={i} color="amber" className="cursor-pointer" onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}>
                  {i + 1}. {BUILD_LABEL[o.type]} @{o.hex} ✕
                </Badge>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-slate-400">Total cost</span> <Goods bag={cost} size="sm" />
              {short.length > 0 && <span className="text-amber-300">short of {short.join(", ")}: trade first, or later orders will fail</span>}
              <div className="ml-auto flex items-center gap-2">
                {me?.orders && !dirty && <Badge color="emerald">orders submitted</Badge>}
                <Button color="teal" onClick={send} loading={sending} disabled={!dirty && !!me?.orders} data-dh="submit-orders">
                  {view.phase === "build" ? "Submit orders" : "Queue orders early"}
                </Button>
              </div>
            </div>
          </div>
        </Card.Footer>
      )}
    </Card>
  );
}

function Colonists({ view }: { view: View }) {
  const sorted = [...view.seats].sort((a, b) => b.vp - a.vp);
  return (
    <Card variant="elevated" className="bg-slate-900/70" data-dh="colonists">
      <Card.Header heading="Colonists" description={view.initiative.length ? `Build order: ${view.initiative.map((id) => view.seats.find((s) => s.id === id)?.name).join(" → ")}` : undefined} />
      <Card.Body>
        <div className="grid gap-3">
          {sorted.map((s) => {
            const status =
              view.phase === "exchange" ? (s.done ? "done trading" : "trading") : view.phase === "build" ? (s.submitted ? "orders in" : "planning…") : null;
            return (
              <div key={s.id} className="flex items-center gap-3" data-dh={`colonist-${s.id}`}>
                <div className="relative">
                  <Avatar fallback={s.name.slice(0, 2).toUpperCase()} />
                  <span className="absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full ring-2 ring-slate-900" style={{ background: s.color }} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium text-slate-100">{s.name}</span>
                    <Badge size="sm" color={s.kind === "agent" ? "violet" : s.kind === "bot" ? "slate" : "sky"}>
                      {s.kind}
                    </Badge>
                    {s.id === view.you?.id && <Badge size="sm" color="teal">you</Badge>}
                    {s.charter && <Badge size="sm" color="yellow">charter</Badge>}
                  </div>
                  <div className="mt-0.5 flex gap-2 text-xs text-slate-400">
                    <span>🂠 {s.cards} goods</span>
                    {status && <span className={s.done || s.submitted ? "text-emerald-400" : ""}>{status}</span>}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-semibold text-teal-100">{s.vp}</div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">renown</div>
                </div>
              </div>
            );
          })}
        </div>
      </Card.Body>
    </Card>
  );
}

function Counter({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <span className="inline-flex items-center overflow-hidden rounded-md border border-slate-700">
      <button type="button" className="px-1.5 text-slate-300 hover:bg-slate-700" onClick={() => onChange(Math.max(0, value - 1))} aria-label="less">
        −
      </button>
      <span className="w-5 text-center font-mono text-sm">{value}</span>
      <button type="button" className="px-1.5 text-slate-300 hover:bg-slate-700" onClick={() => onChange(Math.min(9, value + 1))} aria-label="more">
        +
      </button>
    </span>
  );
}

function Exchange({ view, act }: { view: View; act: Act }) {
  const me = view.you!;
  const open = view.phase === "exchange";
  const [give, setGive] = useState<Bag>({ timber: 0, salt: 0, kelp: 0, copper: 0 });
  const [get, setGet] = useState<Bag>({ timber: 0, salt: 0, kelp: 0, copper: 0 });
  const [to, setTo] = useState("");
  const [bankGive, setBankGive] = useState<Res>("timber");
  const [bankGet, setBankGet] = useState<Res>("copper");
  const name = (id: string) => view.seats.find((s) => s.id === id)?.name ?? id;
  const live = view.offers.filter((o) => o.round === view.round);
  const zero = { timber: 0, salt: 0, kelp: 0, copper: 0 };

  async function post() {
    try {
      await act("offer", { give, get, to: to || null });
      setGive(zero);
      setGet(zero);
    } catch {
      /* shown above */
    }
  }

  return (
    <Card variant="elevated" className="bg-slate-900/70" data-dh="exchange">
      <Card.Header heading="Your hold & the exchange" description={open ? "Offers are first come, first served." : "The exchange is closed. The bank stays open during build."} />
      <Card.Body>
        <div className="grid gap-4">
          <div className="grid grid-cols-4 gap-2" data-dh="hand">
            {RESOURCES.map((r) => (
              <div key={r} className="rounded-lg p-2 text-center" style={{ background: TERRAIN[r].fill + "55" }}>
                <div className="text-lg">{ICON[r]}</div>
                <div className="text-xl font-semibold">{me.hand[r]}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-300">{r}</div>
              </div>
            ))}
          </div>

          {open && (
            <div className="grid gap-2 rounded-lg bg-slate-800/50 p-3" data-dh="offer-form">
              <div className="grid grid-cols-[48px_1fr] items-center gap-y-2 text-sm">
                <span className="text-slate-400">Give</span>
                <div className="flex flex-wrap gap-2">
                  {RESOURCES.map((r) => (
                    <span key={r} className="inline-flex items-center gap-1">
                      {ICON[r]}
                      <Counter value={give[r]} onChange={(n) => setGive({ ...give, [r]: n })} />
                    </span>
                  ))}
                </div>
                <span className="text-slate-400">Get</span>
                <div className="flex flex-wrap gap-2">
                  {RESOURCES.map((r) => (
                    <span key={r} className="inline-flex items-center gap-1">
                      {ICON[r]}
                      <Counter value={get[r]} onChange={(n) => setGet({ ...get, [r]: n })} />
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <select value={to} onChange={(e) => setTo(e.target.value)} className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm" data-dh="offer-to">
                  <option value="">to anyone</option>
                  {view.seats.filter((s) => s.id !== me.id).map((s) => (
                    <option key={s.id} value={s.id}>
                      to {s.name}
                    </option>
                  ))}
                </select>
                <Button size="sm" color="sky" className="ml-auto" onClick={post} disabled={!Object.values(give).some(Boolean) || !Object.values(get).some(Boolean)} data-dh="post-offer">
                  Post offer
                </Button>
              </div>
            </div>
          )}

          <div className="grid gap-1.5" data-dh="offers">
            {live.length === 0 && <p className="text-sm text-slate-500">No offers this round yet.</p>}
            {[...live].reverse().map((o) => (
              <OfferRow key={o.id} o={o} view={view} name={name} act={act} />
            ))}
          </div>

          {(view.phase === "exchange" || view.phase === "build") && (
            <div className="flex flex-wrap items-center gap-2 text-sm" data-dh="bank">
              <span className="text-slate-400">Bank {view.config.bankRate}:1</span>
              <select value={bankGive} onChange={(e) => setBankGive(e.target.value as Res)} className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1">
                {RESOURCES.map((r) => (
                  <option key={r} value={r}>
                    {view.config.bankRate} {r}
                  </option>
                ))}
              </select>
              →
              <select value={bankGet} onChange={(e) => setBankGet(e.target.value as Res)} className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1">
                {RESOURCES.map((r) => (
                  <option key={r} value={r}>
                    1 {r}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="ghost" onClick={() => act("bank", { give: bankGive, get: bankGet }).catch(() => {})} disabled={me.hand[bankGive] < view.config.bankRate || bankGive === bankGet} data-dh="bank-trade">
                Trade
              </Button>
              {open && !me.done && (
                <Button size="sm" color="teal" className="ml-auto" onClick={() => act("done").catch(() => {})} data-dh="done">
                  Done trading
                </Button>
              )}
            </div>
          )}
        </div>
      </Card.Body>
    </Card>
  );
}

function OfferRow({ o, view, name, act }: { o: Offer; view: View; name: (id: string) => string; act: Act }) {
  const me = view.you!;
  const mine = o.from === me.id;
  const forMe = !o.to || o.to === me.id;
  const affordable = RESOURCES.every((r) => me.hand[r] >= (o.get[r] ?? 0));
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${o.status === "open" ? "bg-slate-800/70" : "bg-slate-800/30 opacity-60"}`} data-dh={`offer-${o.id}`}>
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: view.seats.find((s) => s.id === o.from)?.color }} />
      <span className="font-medium">{mine ? "You" : name(o.from)}</span>
      <span className="text-slate-400">give</span>
      <Goods bag={o.give} size="sm" />
      <span className="text-slate-400">for</span>
      <Goods bag={o.get} size="sm" />
      {o.to && <span className="text-xs text-slate-400">(to {o.to === me.id ? "you" : name(o.to)})</span>}
      <span className="ml-auto">
        {o.status === "open" ? (
          mine ? (
            <Button size="xs" variant="ghost" onClick={() => act("cancel", { offer: o.id }).catch(() => {})}>
              Cancel
            </Button>
          ) : forMe && view.phase === "exchange" ? (
            <Button size="xs" color="emerald" disabled={!affordable} onClick={() => act("accept", { offer: o.id }).catch(() => {})} data-dh={`accept-${o.id}`}>
              Accept
            </Button>
          ) : null
        ) : (
          <span className="text-xs text-slate-400">{o.status === "accepted" ? `taken by ${o.acceptedBy === me.id ? "you" : name(o.acceptedBy!)}` : o.status}</span>
        )}
      </span>
    </div>
  );
}

function RoundReport({ view }: { view: View }) {
  if (view.round < 1) return null;
  const name = (id: string) => view.seats.find((s) => s.id === id)?.name ?? id;
  return (
    <Card variant="soft" className="bg-slate-900/50" data-dh="report">
      <Card.Header heading={`Round ${view.round} ledger`} />
      <Card.Body>
        <div className="grid gap-3 text-sm md:grid-cols-2">
          <div>
            <div className="mb-1 text-slate-400">Harvest</div>
            {view.seats.map((s) => (
              <div key={s.id} className="flex items-center gap-2">
                <span className="w-28 truncate" style={{ color: s.color }}>
                  {s.name}
                </span>
                <Goods bag={view.lastHarvest[s.id] ?? {}} size="sm" />
              </div>
            ))}
          </div>
          <div>
            <div className="mb-1 text-slate-400">Last builds</div>
            {view.lastBuilds.length === 0 && <span className="text-slate-500">none yet</span>}
            {view.lastBuilds.map((b, i) => (
              <div key={i} className={b.ok ? "text-slate-200" : "text-slate-500 line-through"} title={b.reason}>
                <span style={{ color: view.seats.find((s) => s.id === b.seat)?.color }}>{name(b.seat)}</span> {b.type} @{b.hex}
                {!b.ok && <span className="ml-1 text-xs no-underline">({b.reason})</span>}
              </div>
            ))}
          </div>
        </div>
      </Card.Body>
    </Card>
  );
}

function Talk({ view, act }: { view: View; act: Act }) {
  const messages = view.messages.map((m) => ({
    id: m.id,
    role: m.seat === null ? "system" : m.seat === view.you?.id ? "user" : view.seats.find((s) => s.id === m.seat)?.kind === "human" ? "customer" : "agent",
    author: { name: m.name },
    content: m.text,
    format: "text" as const,
    createdAt: m.at,
  }));
  return (
    <Card variant="elevated" className="bg-slate-900/70" padding="none" data-dh="talk">
      <ChatThread
        heading={<span className="block px-4 pt-3">Dockside talk</span>}
        className="h-[460px]"
        messages={messages}
        composer={
          view.you ? (
            <Composer
              placeholder="Haggle, scheme, promise…"
              onSubmit={async (text) => {
                try {
                  await act("say", { text });
                } catch (e) {
                  return { ok: false, error: (e as Error).message };
                }
              }}
            />
          ) : undefined
        }
      />
    </Card>
  );
}

function Ending({ view }: { view: View }) {
  const names = (view.winners ?? []).map((id) => view.seats.find((s) => s.id === id)?.name);
  const won = view.you && view.winners?.includes(view.you.id);
  return (
    <Card variant="elevated" className="bg-gradient-to-b from-teal-900/50 to-slate-900/80" data-dh="ending">
      <Card.Body>
        <div className="py-3">
          <div className="text-3xl font-semibold text-teal-50">{won ? "Driftholm is yours." : `${names.join(" & ")} ${names.length > 1 ? "share" : "rules"} Driftholm.`}</div>
          <a href="#/" className="mt-2 inline-block text-sky-300">
            Back to the harbor
          </a>
        </div>
      </Card.Body>
    </Card>
  );
}

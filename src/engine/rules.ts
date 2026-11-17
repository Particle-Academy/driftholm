import {
  RESOURCES,
  type Bag,
  type BuildOrder,
  type BuildOutcome,
  type BuildType,
  type Game,
  type GameConfig,
  type Hex,
  type Offer,
  type Res,
  type Result,
  type Seat,
  type SeatKind,
  type SeatView,
  type View,
  type Weather,
} from "./types";

export const DEFAULT_CONFIG: GameConfig = {
  rounds: 12,
  targetVp: 10,
  exchangeSeconds: 150,
  buildSeconds: 120,
  harvestSeconds: 6,
  maxSeats: 4,
  bankRate: 3,
};

export const COSTS: Record<BuildType, Partial<Bag>> = {
  raft: { timber: 1, kelp: 1 },
  hall: { timber: 1, salt: 1, kelp: 1 },
  keep: { salt: 2, copper: 2 },
  beacon: { timber: 1, salt: 1, copper: 1 },
};

export const SEAT_COLORS = ["#f59e0b", "#38bdf8", "#e879f9", "#4ade80"];
const MAX_ORDERS = 8;
const MAX_MESSAGES_PER_ROUND = 8;

// ---------- seeded randomness ----------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: T[], rnd: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const randomId = (n = 8) =>
  Array.from(globalThis.crypto.getRandomValues(new Uint8Array(n)), (b) => (b % 36).toString(36)).join("");

// ---------- hex geometry (axial q,r) ----------

export const hexId = (q: number, r: number) => `${q},${r}`;
const DIRS = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];
export function neighbors(id: string): string[] {
  const [q, r] = id.split(",").map(Number);
  return DIRS.map(([dq, dr]) => hexId(q + dq, r + dr));
}
export function distance(a: Pick<Hex, "q" | "r">, b: Pick<Hex, "q" | "r">) {
  return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
}

export function generateMap(seed: number, radius = 3): Hex[] {
  const rnd = mulberry32(seed);
  const cells: { q: number; r: number; land: boolean }[] = [];
  for (let q = -radius; q <= radius; q++)
    for (let r = -radius; r <= radius; r++) {
      const d = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
      if (d > radius) continue;
      const land = d <= 1 ? true : d === 2 ? rnd() < 0.85 : rnd() < 0.35;
      cells.push({ q, r, land });
    }
  const landCount = cells.filter((c) => c.land).length;
  const bag = shuffle(
    Array.from({ length: landCount }, (_, i) => RESOURCES[i % 4]),
    rnd,
  );
  let k = 0;
  return cells.map((c) => ({ id: hexId(c.q, c.r), q: c.q, r: c.r, terrain: c.land ? bag[k++] : "sea" }));
}

export function generateWeather(seed: number, rounds: number): Weather[] {
  const rnd = mulberry32(seed ^ 0x5eed);
  return Array.from({ length: rounds }, (_, i) => {
    const [bounty, squall] = shuffle(RESOURCES, rnd);
    return { round: i + 1, bounty, squall: rnd() < 0.3 ? null : squall };
  });
}

// ---------- bags ----------

export const emptyBag = (): Bag => ({ timber: 0, salt: 0, kelp: 0, copper: 0 });
export const bagSize = (b: Partial<Bag>) => RESOURCES.reduce((a, r) => a + (b[r] ?? 0), 0);
export const canPay = (hand: Bag, cost: Partial<Bag>) => RESOURCES.every((r) => hand[r] >= (cost[r] ?? 0));
function pay(hand: Bag, cost: Partial<Bag>) {
  for (const r of RESOURCES) hand[r] -= cost[r] ?? 0;
}
function gain(hand: Bag, add: Partial<Bag>) {
  for (const r of RESOURCES) hand[r] += add[r] ?? 0;
}
function cleanBag(x: unknown): Partial<Bag> | null {
  if (!x || typeof x !== "object") return null;
  const out: Partial<Bag> = {};
  for (const [k, v] of Object.entries(x)) {
    if (!RESOURCES.includes(k as Res)) return null;
    if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 20) return null;
    if (v) out[k as Res] = v as number;
  }
  return out;
}
export const describeBag = (b: Partial<Bag>) =>
  RESOURCES.filter((r) => b[r]).map((r) => `${b[r]} ${r}`).join(" + ") || "nothing";

// ---------- lifecycle ----------

export function createGame(opts: { name?: string; seed?: number; config?: Partial<GameConfig>; now?: number }): Game {
  const now = opts.now ?? Date.now();
  const config = { ...DEFAULT_CONFIG, ...opts.config };
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
  return {
    id: randomId(6),
    name: opts.name?.trim().slice(0, 60) || "Driftholm",
    createdAt: now,
    seed,
    config,
    phase: "lobby",
    round: 0,
    hexes: generateMap(seed),
    buildings: [],
    weather: generateWeather(seed, config.rounds),
    seats: [],
    hostSeat: null,
    initiative: [],
    offers: [],
    orders: {},
    done: [],
    lastHarvest: {},
    lastBuilds: [],
    messages: [],
    deadline: null,
    winners: null,
    version: 1,
  };
}

const bump = (g: Game) => void g.version++;
const seatName = (g: Game, id: string) => g.seats.find((s) => s.id === id)?.name ?? id;

function system(g: Game, text: string, now: number) {
  g.messages.push({ id: randomId(), seat: null, name: "Harbor reeve", text, at: now, round: g.round });
}

export function join(g: Game, name: string, kind: SeatKind, now = Date.now()): Result<Seat> {
  if (g.phase !== "lobby") return { ok: false, error: "The fleet has already sailed; this game has started." };
  if (g.seats.length >= g.config.maxSeats) return { ok: false, error: "Every colony charter is taken." };
  const clean = name.replace(/[\r\n\t]/g, " ").trim().slice(0, 32);
  if (!clean) return { ok: false, error: "A colonist needs a name." };
  if (g.seats.some((s) => s.name.toLowerCase() === clean.toLowerCase()))
    return { ok: false, error: `The name "${clean}" is taken in this game.` };
  const seat: Seat = {
    id: `p${g.seats.length + 1}`,
    name: clean,
    kind,
    token: randomId(24),
    hand: emptyBag(),
    color: SEAT_COLORS[g.seats.length % SEAT_COLORS.length],
    charter: false,
    joinedAt: now,
  };
  g.seats.push(seat);
  if (!g.hostSeat && kind === "human") g.hostSeat = seat.id; // agents never host: the person sets sail
  system(g, `${clean} (${kind}) signed a colony charter.`, now);
  bump(g);
  return { ok: true, value: seat };
}

/** Spread starting colonies: farthest-point sampling over outer land, then a second hall next door on a different terrain. */
export function placeStarts(g: Game) {
  const rnd = mulberry32(g.seed ^ 0xbeef);
  const land = g.hexes.filter((h) => h.terrain !== "sea");
  const outer = land.filter((h) => distance(h, { q: 0, r: 0 }) >= 2);
  const pool = outer.length >= g.seats.length ? outer : land;
  const homes: Hex[] = [pool[Math.floor(rnd() * pool.length)]];
  while (homes.length < g.seats.length) {
    const next = pool
      .filter((h) => !homes.includes(h))
      .map((h) => ({ h, d: Math.min(...homes.map((x) => distance(h, x))) + rnd() * 0.1 }))
      .sort((a, b) => b.d - a.d)[0].h;
    homes.push(next);
  }
  const taken = new Set(homes.map((h) => h.id));
  g.seats.forEach((s, i) => {
    const home = homes[i];
    g.buildings.push({ hex: home.id, owner: s.id, kind: "hall", beacon: false });
    const near = neighbors(home.id)
      .map((id) => g.hexes.find((h) => h.id === id))
      .filter((h): h is Hex => !!h && h.terrain !== "sea" && !taken.has(h.id))
      .filter((h) => !homes.some((o, j) => j !== i && distance(o, h) <= 1));
    const second = near.find((h) => h.terrain !== home.terrain) ?? near[0];
    if (second) {
      taken.add(second.id);
      g.buildings.push({ hex: second.id, owner: s.id, kind: "hall", beacon: false });
    }
    s.hand = { timber: 1, salt: 1, kelp: 1, copper: 1 };
  });
}

export function start(g: Game, seatId: string, now = Date.now()): Result {
  if (g.phase !== "lobby") return { ok: false, error: "Already started." };
  if (seatId !== g.hostSeat) return { ok: false, error: "Only the host can start the game." };
  if (g.seats.length < 2) return { ok: false, error: "Need at least two colonists." };
  placeStarts(g);
  system(g, "The fleet makes landfall. Each colony holds two halls and one of each good.", now);
  enterHarvest(g, now);
  return { ok: true, value: undefined };
}

function enterHarvest(g: Game, now: number) {
  g.round++;
  g.phase = "harvest";
  const w = g.weather[g.round - 1];
  const harvest: Record<string, Partial<Bag>> = {};
  for (const s of g.seats) harvest[s.id] = {};
  for (const b of g.buildings) {
    if (b.kind === "raft") continue;
    const t = g.hexes.find((h) => h.id === b.hex)!.terrain as Res;
    if (w.squall === t && !b.beacon) continue;
    const n = (b.kind === "keep" ? 2 : 1) * (w.bounty === t ? 2 : 1);
    harvest[b.owner][t] = (harvest[b.owner][t] ?? 0) + n;
  }
  for (const s of g.seats) gain(s.hand, harvest[s.id]);
  g.lastHarvest = harvest;
  const n = g.seats.length;
  g.initiative = g.seats.map((_, i) => g.seats[(i + g.round - 1) % n].id);
  g.offers = g.offers.filter((o) => o.status === "open" ? false : o.round >= g.round - 1);
  g.done = [];
  g.orders = {};
  g.deadline = now + g.config.harvestSeconds * 1000;
  system(
    g,
    `Round ${g.round}/${g.config.rounds}. Bounty on ${w.bounty} (double yield)` +
      (w.squall ? `, squall over ${w.squall} (no yield unless beaconed).` : ", calm seas.") +
      ` Build initiative: ${g.initiative.map((id) => seatName(g, id)).join(" → ")}.`,
    now,
  );
  bump(g);
}

function enterExchange(g: Game, now: number) {
  g.phase = "exchange";
  g.done = [];
  g.deadline = now + g.config.exchangeSeconds * 1000;
  bump(g);
}

function enterBuild(g: Game, now: number) {
  for (const o of g.offers) if (o.status === "open") o.status = "expired";
  g.phase = "build";
  g.done = [];
  g.deadline = now + g.config.buildSeconds * 1000;
  bump(g);
}

// ---------- talk ----------

export function say(g: Game, seatId: string, text: string, now = Date.now()): Result {
  const seat = g.seats.find((s) => s.id === seatId);
  if (!seat) return { ok: false, error: "Unknown seat." };
  const clean = text.trim().slice(0, 280);
  if (!clean) return { ok: false, error: "Empty message." };
  const mine = g.messages.filter((m) => m.seat === seatId && m.round === g.round).length;
  if (g.phase !== "lobby" && mine >= MAX_MESSAGES_PER_ROUND)
    return { ok: false, error: `At most ${MAX_MESSAGES_PER_ROUND} messages per round.` };
  g.messages.push({ id: randomId(), seat: seatId, name: seat.name, text: clean, at: now, round: g.round });
  bump(g);
  return { ok: true, value: undefined };
}

// ---------- trade ----------

const tradingOpen = (g: Game) => g.phase === "exchange";

export function offer(g: Game, seatId: string, body: { give?: unknown; get?: unknown; to?: unknown }, now = Date.now()): Result<Offer> {
  if (!tradingOpen(g)) return { ok: false, error: "Offers can only be made during the exchange." };
  const seat = g.seats.find((s) => s.id === seatId);
  if (!seat) return { ok: false, error: "Unknown seat." };
  const give = cleanBag(body.give);
  const get = cleanBag(body.get);
  if (!give || !get || !bagSize(give) || !bagSize(get))
    return { ok: false, error: 'give and get must each name at least one good, e.g. {"give":{"timber":2},"get":{"copper":1}}.' };
  if (RESOURCES.some((r) => give[r] && get[r])) return { ok: false, error: "Don't give and get the same good." };
  if (!canPay(seat.hand, give)) return { ok: false, error: `You don't hold ${describeBag(give)}.` };
  const to = typeof body.to === "string" && body.to ? body.to : null;
  if (to && (to === seatId || !g.seats.some((s) => s.id === to))) return { ok: false, error: "Unknown trade partner." };
  if (g.offers.filter((o) => o.from === seatId && o.status === "open").length >= 4)
    return { ok: false, error: "At most 4 open offers. Cancel one first." };
  const o: Offer = { id: randomId(6), from: seatId, to, give, get, status: "open", round: g.round, at: now };
  g.offers.push(o);
  bump(g);
  return { ok: true, value: o };
}

export function accept(g: Game, seatId: string, offerId: string): Result {
  if (!tradingOpen(g)) return { ok: false, error: "The exchange is closed." };
  const o = g.offers.find((x) => x.id === offerId);
  if (!o || o.status !== "open") return { ok: false, error: "That offer is no longer open." };
  if (o.from === seatId) return { ok: false, error: "You can't accept your own offer." };
  if (o.to && o.to !== seatId) return { ok: false, error: "That offer is for someone else." };
  const from = g.seats.find((s) => s.id === o.from)!;
  const taker = g.seats.find((s) => s.id === seatId);
  if (!taker) return { ok: false, error: "Unknown seat." };
  if (!canPay(from.hand, o.give)) {
    o.status = "cancelled";
    bump(g);
    return { ok: false, error: `${from.name} no longer holds ${describeBag(o.give)}; the offer was withdrawn.` };
  }
  if (!canPay(taker.hand, o.get)) return { ok: false, error: `You don't hold ${describeBag(o.get)}.` };
  pay(from.hand, o.give);
  gain(taker.hand, o.give);
  pay(taker.hand, o.get);
  gain(from.hand, o.get);
  o.status = "accepted";
  o.acceptedBy = seatId;
  bump(g);
  return { ok: true, value: undefined };
}

export function cancel(g: Game, seatId: string, offerId: string): Result {
  const o = g.offers.find((x) => x.id === offerId);
  if (!o || o.from !== seatId || o.status !== "open") return { ok: false, error: "No open offer of yours with that id." };
  o.status = "cancelled";
  bump(g);
  return { ok: true, value: undefined };
}

/** Trade `rate` of one good to the bank for 1 of another. Open during exchange and build. */
export function bank(g: Game, seatId: string, give: unknown, get: unknown): Result {
  if (g.phase !== "exchange" && g.phase !== "build") return { ok: false, error: "The bank is shut right now." };
  const seat = g.seats.find((s) => s.id === seatId);
  if (!seat) return { ok: false, error: "Unknown seat." };
  if (!RESOURCES.includes(give as Res) || !RESOURCES.includes(get as Res) || give === get)
    return { ok: false, error: `Name two different goods: give one of ${RESOURCES.join(", ")}.` };
  const rate = g.config.bankRate;
  if (seat.hand[give as Res] < rate) return { ok: false, error: `The bank wants ${rate} ${give}.` };
  seat.hand[give as Res] -= rate;
  seat.hand[get as Res] += 1;
  bump(g);
  return { ok: true, value: undefined };
}

export function markDone(g: Game, seatId: string, now = Date.now()): Result {
  if (g.phase !== "exchange" && g.phase !== "build") return { ok: false, error: "Nothing to be done with right now." };
  if (!g.seats.some((s) => s.id === seatId)) return { ok: false, error: "Unknown seat." };
  if (!g.done.includes(seatId)) g.done.push(seatId);
  bump(g);
  advance(g, now);
  return { ok: true, value: undefined };
}

// ---------- building ----------

export function legalTargets(g: Game, seatId: string, type: BuildType): string[] {
  const mine = g.buildings.filter((b) => b.owner === seatId);
  const occupied = new Set(g.buildings.map((b) => b.hex));
  const reach = new Set(mine.flatMap((b) => neighbors(b.hex)));
  const terrain = (id: string) => g.hexes.find((h) => h.id === id)?.terrain;
  switch (type) {
    case "raft":
      return [...reach].filter((id) => terrain(id) === "sea" && !occupied.has(id));
    case "hall":
      return [...reach].filter((id) => terrain(id) && terrain(id) !== "sea" && !occupied.has(id));
    case "keep":
      return mine.filter((b) => b.kind === "hall").map((b) => b.hex);
    case "beacon":
      return mine.filter((b) => b.kind !== "raft" && !b.beacon).map((b) => b.hex);
  }
}

export function submitOrders(g: Game, seatId: string, orders: unknown, now = Date.now()): Result {
  if (g.phase !== "build" && g.phase !== "exchange")
    return { ok: false, error: "Build orders are taken during the exchange and build phases." };
  if (!g.seats.some((s) => s.id === seatId)) return { ok: false, error: "Unknown seat." };
  if (!Array.isArray(orders) || orders.length > MAX_ORDERS)
    return { ok: false, error: `Send {"orders":[{"type":"hall","hex":"1,-2"}, ...]}, at most ${MAX_ORDERS}.` };
  const clean: BuildOrder[] = [];
  for (const o of orders) {
    const type = (o as BuildOrder)?.type;
    const hex = (o as BuildOrder)?.hex;
    if (!["raft", "hall", "keep", "beacon"].includes(type) || typeof hex !== "string" || !g.hexes.some((h) => h.id === hex))
      return { ok: false, error: `Bad order ${JSON.stringify(o)}: type is raft|hall|keep|beacon and hex is an id like "1,-2".` };
    clean.push({ type, hex });
  }
  g.orders[seatId] = clean;
  bump(g);
  if (g.phase === "build") {
    if (!g.done.includes(seatId)) g.done.push(seatId); // submitting during build = done
    advance(g, now);
  }
  return { ok: true, value: undefined };
}

function resolveBuilds(g: Game, now: number) {
  const outcomes: BuildOutcome[] = [];
  for (const seatId of g.initiative) {
    const seat = g.seats.find((s) => s.id === seatId)!;
    for (const o of g.orders[seatId] ?? []) {
      const out: BuildOutcome = { ...o, seat: seatId, ok: false };
      if (!legalTargets(g, seatId, o.type).includes(o.hex)) out.reason = "not a legal spot (taken, out of reach or wrong terrain)";
      else if (!canPay(seat.hand, COSTS[o.type])) out.reason = `could not pay ${describeBag(COSTS[o.type])}`;
      else {
        pay(seat.hand, COSTS[o.type]);
        if (o.type === "raft" || o.type === "hall") g.buildings.push({ hex: o.hex, owner: seatId, kind: o.type, beacon: false });
        else {
          const b = g.buildings.find((x) => x.hex === o.hex && x.owner === seatId)!;
          if (o.type === "keep") b.kind = "keep";
          else b.beacon = true;
        }
        out.ok = true;
      }
      outcomes.push(out);
    }
  }
  for (const s of g.seats) {
    if (!s.charter && hasCharter(g, s.id)) {
      s.charter = true;
      system(g, `${s.name} holds land on all four terrains: Charter of the Four (+2).`, now);
    }
  }
  g.lastBuilds = outcomes;
  const built = outcomes.filter((o) => o.ok);
  system(
    g,
    built.length
      ? `Builds: ${built.map((o) => `${seatName(g, o.seat)} ${o.type} @${o.hex}`).join("; ")}.` +
          (outcomes.length > built.length ? ` ${outcomes.length - built.length} order(s) failed.` : "")
      : "Nobody built this round.",
    now,
  );
}

function hasCharter(g: Game, seatId: string) {
  const terrains = new Set(
    g.buildings.filter((b) => b.owner === seatId && b.kind !== "raft").map((b) => g.hexes.find((h) => h.id === b.hex)!.terrain),
  );
  return RESOURCES.every((r) => terrains.has(r));
}

export function vp(g: Game, seatId: string): number {
  let n = 0;
  for (const b of g.buildings) {
    if (b.owner !== seatId) continue;
    if (b.kind === "hall") n += 1;
    if (b.kind === "keep") n += 2;
    if (b.beacon) n += 1;
  }
  return n + (g.seats.find((s) => s.id === seatId)?.charter ? 2 : 0);
}

function finish(g: Game, now: number) {
  const key = (s: Seat) => [vp(g, s.id), bagSize(s.hand)] as const;
  const best = g.seats.map(key).reduce((a, b) => (b[0] > a[0] || (b[0] === a[0] && b[1] > a[1]) ? b : a));
  g.winners = g.seats.filter((s) => key(s)[0] === best[0] && key(s)[1] === best[1]).map((s) => s.id);
  g.phase = "ended";
  g.deadline = null;
  const names = g.winners.map((id) => seatName(g, id));
  system(g, `The charter is settled: ${names.join(" and ")} ${names.length > 1 ? "share" : "rules"} Driftholm with ${best[0]} renown.`, now);
  bump(g);
}

/** Moves the clock. Call on every tick and after every action. */
export function advance(g: Game, now = Date.now()): boolean {
  const before = g.version;
  const expired = () => g.deadline !== null && now >= g.deadline;
  if (g.phase === "harvest" && expired()) enterExchange(g, now);
  if (g.phase === "exchange" && (expired() || g.done.length >= g.seats.length)) enterBuild(g, now);
  if (g.phase === "build" && (expired() || g.done.length >= g.seats.length)) {
    resolveBuilds(g, now);
    if (g.seats.some((s) => vp(g, s.id) >= g.config.targetVp) || g.round >= g.config.rounds) finish(g, now);
    else enterHarvest(g, now);
  }
  return g.version !== before;
}

// ---------- what a viewer may see ----------

export function project(g: Game, viewerId: string | null, now = Date.now()): View {
  const seatView = (s: Seat): SeatView => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    color: s.color,
    vp: vp(g, s.id),
    cards: bagSize(s.hand),
    charter: s.charter,
    done: g.done.includes(s.id),
    submitted: Boolean(g.orders[s.id]),
    isHost: s.id === g.hostSeat,
  });
  const me = g.seats.find((s) => s.id === viewerId) ?? null;
  const live = g.phase !== "lobby";
  return {
    id: g.id,
    name: g.name,
    phase: g.phase,
    version: g.version,
    round: g.round,
    rounds: g.config.rounds,
    targetVp: g.config.targetVp,
    deadline: g.deadline,
    secondsLeft: g.deadline === null ? null : Math.max(0, Math.ceil((g.deadline - now) / 1000)),
    now,
    config: g.config,
    hexes: g.hexes,
    buildings: g.buildings,
    weather: live && g.round > 0 ? g.weather[g.round - 1] : null,
    nextWeather: live ? g.weather[g.round] ?? null : g.weather[0],
    initiative: g.initiative,
    seats: g.seats.map(seatView),
    offers: g.offers.filter((o) => o.round >= g.round - 1).slice(-40),
    lastHarvest: g.lastHarvest,
    lastBuilds: g.lastBuilds,
    messages: g.messages.slice(-200),
    you: me
      ? {
          ...seatView(me),
          hand: me.hand,
          orders: g.orders[me.id] ?? null,
          canBuild: {
            raft: legalTargets(g, me.id, "raft"),
            hall: legalTargets(g, me.id, "hall"),
            keep: legalTargets(g, me.id, "keep"),
            beacon: legalTargets(g, me.id, "beacon"),
          },
        }
      : null,
    costs: COSTS,
    winners: g.winners,
    help: helpFor(g, me),
  };
}

function helpFor(g: Game, me: Seat | null): string {
  if (!me) return g.phase === "lobby" ? "POST /join with {name} to take a colony." : "You are watching.";
  switch (g.phase) {
    case "lobby":
      return me.id === g.hostSeat ? "As host, POST /start when at least two colonists have joined." : "Waiting for the host to set sail.";
    case "harvest":
      return "Harvest is in. The exchange opens in a moment. Plan using weather and nextWeather.";
    case "exchange":
      return `Exchange is open. Trade with POST /offer, /accept, /cancel or /bank, chat with /say, and queue builds early with /orders. POST /done when finished trading. You hold ${describeBag(me.hand)}.`;
    case "build":
      return g.orders[me.id]
        ? "Orders submitted. You can resend /orders to replace them until the phase ends."
        : `Submit build orders now: POST /orders {"orders":[...]}. The bank is still open. You hold ${describeBag(me.hand)}.`;
    case "ended":
      return "The game is over.";
  }
}

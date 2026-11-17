import { accept, bank, canPay, COSTS, legalTargets, markDone, neighbors, offer, say, submitOrders } from "./rules";
import { RESOURCES, type Bag, type BuildOrder, type BuildType, type Game, type Res, type Seat } from "./types";

export const BOT_NAMES = ["Reeve Ostra", "Old Tamsk", "Brine Halloway", "Sister Kell"];

const quips = [
  "Copper's dear this season. Anyone selling?",
  "I'll pay fair for salt. Fairer than the bank, anyway.",
  "Watch the squall forecast before you sell your timber.",
  "My halls are humble. Ignore them.",
];

/** What the bot wants to build next, in priority order. */
function wishlist(g: Game, bot: Seat): BuildType[] {
  const want: BuildType[] = [];
  if (legalTargets(g, bot.id, "keep").length) want.push("keep");
  if (legalTargets(g, bot.id, "hall").length) want.push("hall");
  else want.push("raft");
  if (legalTargets(g, bot.id, "beacon").length) want.push("beacon");
  return want;
}

function missing(hand: Bag, cost: Partial<Bag>): Partial<Bag> {
  const m: Partial<Bag> = {};
  for (const r of RESOURCES) if ((cost[r] ?? 0) > hand[r]) m[r] = (cost[r] ?? 0) - hand[r];
  return m;
}

function surplus(hand: Bag, cost: Partial<Bag>): Res[] {
  return RESOURCES.filter((r) => hand[r] > (cost[r] ?? 0)).sort((a, b) => hand[b] - hand[a]);
}

/** Lets house bots act. Called on the server tick. */
export function botStep(g: Game, now: number, rnd: () => number = Math.random): void {
  for (const bot of g.seats.filter((s) => s.kind === "bot")) {
    if (g.done.includes(bot.id)) continue;
    const goal = COSTS[wishlist(g, bot)[0]];
    const need = missing(bot.hand, goal);
    const spare = surplus(bot.hand, goal);
    const elapsed = g.deadline ? now - (g.deadline - (g.phase === "exchange" ? g.config.exchangeSeconds : g.config.buildSeconds) * 1000) : 0;

    if (g.phase === "exchange") {
      if (elapsed < 4000 + rnd() * 4000) continue; // give humans and agents a moment to post first
      // Take any open offer that gives us something we need for something we can spare.
      for (const o of g.offers.filter((x) => x.status === "open" && x.from !== bot.id && (!x.to || x.to === bot.id))) {
        const helps = RESOURCES.some((r) => (o.give[r] ?? 0) > 0 && (need[r] ?? 0) > 0);
        const affordable = RESOURCES.every((r) => (o.get[r] ?? 0) <= Math.max(0, bot.hand[r] - (goal[r] ?? 0)));
        if (helps && affordable && accept(g, bot.id, o.id).ok) break;
      }
      const stillNeed = RESOURCES.filter((r) => (missing(bot.hand, goal)[r] ?? 0) > 0);
      if (stillNeed.length && spare.length && !g.offers.some((o) => o.from === bot.id && o.status === "open")) {
        offer(g, bot.id, { give: { [spare[0]]: 1 }, get: { [stillNeed[0]]: 1 } }, now);
        if (rnd() < 0.35) say(g, bot.id, quips[Math.floor(rnd() * quips.length)], now);
      }
      // Late in the exchange, fall back to the bank and stop trading.
      if (elapsed > 25000 + rnd() * 10000) {
        const n = RESOURCES.filter((r) => (missing(bot.hand, goal)[r] ?? 0) > 0);
        const rich = RESOURCES.find((r) => bot.hand[r] - (goal[r] ?? 0) >= g.config.bankRate);
        if (n.length && rich) bank(g, bot.id, rich, n[0]);
        markDone(g, bot.id, now);
      }
    } else if (g.phase === "build") {
      submitOrders(g, bot.id, planBuilds(g, bot), now);
    }
  }
}

/** Greedy: as many affordable builds as possible, preferring keeps, then halls on new terrain. */
export function planBuilds(g: Game, bot: Seat): BuildOrder[] {
  const hand = { ...bot.hand };
  const orders: BuildOrder[] = [];
  const claimed = new Set<string>();
  const myTerrains = new Set(
    g.buildings.filter((b) => b.owner === bot.id && b.kind !== "raft").map((b) => g.hexes.find((h) => h.id === b.hex)!.terrain),
  );
  const pay = (c: Partial<Bag>) => RESOURCES.forEach((r) => (hand[r] -= c[r] ?? 0));
  for (const hex of legalTargets(g, bot.id, "keep"))
    if (canPay(hand, COSTS.keep)) {
      orders.push({ type: "keep", hex });
      pay(COSTS.keep);
    }
  const halls = legalTargets(g, bot.id, "hall").sort((a, b) => {
    const t = (id: string) => g.hexes.find((h) => h.id === id)!.terrain;
    return Number(myTerrains.has(t(a))) - Number(myTerrains.has(t(b)));
  });
  for (const hex of halls)
    if (canPay(hand, COSTS.hall) && !claimed.has(hex)) {
      orders.push({ type: "hall", hex });
      claimed.add(hex);
      pay(COSTS.hall);
    }
  if (!halls.length && canPay(hand, COSTS.raft)) {
    // Raft toward the nearest unclaimed land.
    const occupied = new Set(g.buildings.map((b) => b.hex));
    const rafts = legalTargets(g, bot.id, "raft").sort(
      (a, b) =>
        neighbors(b).filter((n) => g.hexes.some((h) => h.id === n && h.terrain !== "sea" && !occupied.has(n))).length -
        neighbors(a).filter((n) => g.hexes.some((h) => h.id === n && h.terrain !== "sea" && !occupied.has(n))).length,
    );
    if (rafts[0]) {
      orders.push({ type: "raft", hex: rafts[0] });
      pay(COSTS.raft);
    }
  }
  for (const hex of legalTargets(g, bot.id, "beacon"))
    if (canPay(hand, COSTS.beacon)) {
      orders.push({ type: "beacon", hex });
      pay(COSTS.beacon);
    }
  return orders;
}

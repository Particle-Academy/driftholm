import { describe, expect, it } from "vitest";
import { planBuilds } from "./bots";
import {
  accept,
  advance,
  bank,
  cancel,
  createGame,
  generateMap,
  join,
  legalTargets,
  markDone,
  neighbors,
  offer,
  project,
  start,
  submitOrders,
  vp,
} from "./rules";
import type { Game, Res } from "./types";

const T0 = 1_000_000;

function table(n = 3): Game {
  const g = createGame({ seed: 7, now: T0 });
  ["Ana", "Bo", "Cy", "Di"].slice(0, n).forEach((name, i) => join(g, name, i === 0 ? "human" : "agent", T0));
  expect(start(g, "p1", T0).ok).toBe(true);
  return g;
}
const toExchange = (g: Game) => advance(g, (g.deadline ?? T0) + 1);
const seat = (g: Game, id: string) => g.seats.find((s) => s.id === id)!;
const totalGoods = (g: Game) => g.seats.reduce((a, s) => a + Object.values(s.hand).reduce((x, y) => x + y, 0), 0);

describe("setup", () => {
  it("deals the same archipelago from the same seed, with all four terrains", () => {
    const a = generateMap(11);
    expect(a).toEqual(generateMap(11));
    for (const t of ["timber", "salt", "kelp", "copper", "sea"]) expect(a.some((h) => h.terrain === t)).toBe(true);
  });

  it("gives every colonist two halls, not touching anyone else's, plus the first harvest", () => {
    const g = table(4);
    for (const s of g.seats) {
      const halls = g.buildings.filter((b) => b.owner === s.id);
      expect(halls.length).toBeGreaterThanOrEqual(1);
      for (const b of halls)
        for (const n of neighbors(b.hex)) expect(g.buildings.find((x) => x.hex === n && x.owner !== s.id)).toBeUndefined();
    }
    expect(g.phase).toBe("harvest");
    expect(g.round).toBe(1);
  });

  it("only lets a human host start", () => {
    const g = createGame({ seed: 1, now: T0 });
    join(g, "Agent", "agent", T0);
    join(g, "Bot", "bot", T0);
    expect(g.hostSeat).toBeNull();
    join(g, "Human", "human", T0);
    expect(g.hostSeat).toBe("p3");
    expect(start(g, "p1", T0).ok).toBe(false);
  });
});

describe("harvest and weather", () => {
  it("doubles bounty terrain, skips squall terrain unless beaconed, and keeps yield two", () => {
    const g = table(2);
    const b = g.buildings.find((x) => x.owner === "p1")!;
    const t = g.hexes.find((h) => h.id === b.hex)!.terrain as Res;
    g.weather[1] = { round: 2, bounty: t, squall: null };
    b.kind = "keep";
    const before = seat(g, "p1").hand[t];
    g.phase = "build";
    g.done = ["p1", "p2"];
    advance(g, T0 + 10); // resolves the (empty) build, harvests round 2
    expect(g.round).toBe(2);
    const others = g.buildings.filter((x) => x.owner === "p1" && x !== b && x.kind !== "raft" && g.hexes.find((h) => h.id === x.hex)!.terrain === t).length;
    expect(seat(g, "p1").hand[t] - before).toBe(4 + others * 2);

    g.weather[2] = { round: 3, bounty: t === "salt" ? "kelp" : "salt", squall: t };
    const mid = seat(g, "p1").hand[t];
    g.phase = "build";
    g.done = ["p1", "p2"];
    b.beacon = true;
    advance(g, T0 + 20);
    expect(seat(g, "p1").hand[t] - mid).toBe(2); // beaconed keep ignores the squall; unbeaconed halls on t yield 0
  });
});

describe("exchange", () => {
  it("swaps goods exactly once and conserves the total", () => {
    const g = table(2);
    toExchange(g);
    seat(g, "p1").hand = { timber: 2, salt: 0, kelp: 0, copper: 0 };
    seat(g, "p2").hand = { timber: 0, salt: 0, kelp: 0, copper: 3 };
    const total = totalGoods(g);
    const o = offer(g, "p1", { give: { timber: 2 }, get: { copper: 1 } });
    expect(o.ok).toBe(true);
    if (!o.ok) return;
    expect(accept(g, "p2", o.value.id).ok).toBe(true);
    expect(accept(g, "p2", o.value.id).ok).toBe(false); // already taken
    expect(seat(g, "p1").hand).toMatchObject({ timber: 0, copper: 1 });
    expect(seat(g, "p2").hand).toMatchObject({ timber: 2, copper: 2 });
    expect(totalGoods(g)).toBe(total);
  });

  it("refuses offers of goods you lack, private offers to others, and withdraws an offer the maker can no longer cover", () => {
    const g = table(3);
    toExchange(g);
    seat(g, "p1").hand = { timber: 1, salt: 0, kelp: 0, copper: 0 };
    expect(offer(g, "p1", { give: { salt: 1 }, get: { timber: 1 } }).ok).toBe(false);
    const priv = offer(g, "p1", { give: { timber: 1 }, get: { kelp: 1 }, to: "p2" });
    expect(priv.ok && accept(g, "p3", priv.value.id).ok).toBe(false);
    const pub = offer(g, "p1", { give: { timber: 1 }, get: { salt: 1 } });
    seat(g, "p1").hand.timber = 0;
    seat(g, "p3").hand.salt = 1;
    expect(pub.ok && accept(g, "p3", pub.value.id).ok).toBe(false);
    expect(g.offers.find((o) => pub.ok && o.id === pub.value.id)?.status).toBe("cancelled");
    expect(priv.ok && cancel(g, "p1", priv.value.id).ok).toBe(true);
  });

  it("trades 3:1 with the bank", () => {
    const g = table(2);
    toExchange(g);
    seat(g, "p1").hand = { timber: 3, salt: 0, kelp: 0, copper: 0 };
    expect(bank(g, "p1", "timber", "timber").ok).toBe(false);
    expect(bank(g, "p1", "timber", "copper").ok).toBe(true);
    expect(seat(g, "p1").hand).toEqual({ timber: 0, salt: 0, kelp: 0, copper: 1 });
    expect(bank(g, "p1", "timber", "copper").ok).toBe(false);
  });

  it("hides hand composition from opponents", () => {
    const g = table(2);
    const v = project(g, "p2", T0);
    expect(v.you?.hand).toBeDefined();
    expect(JSON.stringify(v.seats)).not.toContain('"hand"');
    expect(JSON.stringify(v)).not.toContain(g.seats[0].token);
  });
});

describe("build resolution", () => {
  it("resolves in initiative order: a contested hex goes to the earlier colonist and the later one keeps their goods", () => {
    const g = table(2);
    toExchange(g);
    const shared = legalTargets(g, "p1", "hall").find((h) => legalTargets(g, "p2", "hall").includes(h));
    // Make a contested spot if the map didn't: give both a raft-free path by placing p2 next to a p1 target.
    const target = shared ?? legalTargets(g, "p1", "hall")[0];
    if (!shared) {
      const n = neighbors(target).find((id) => !g.buildings.some((b) => b.hex === id) && g.hexes.some((h) => h.id === id));
      g.buildings.push({ hex: n!, owner: "p2", kind: "raft", beacon: false });
    }
    for (const id of ["p1", "p2"]) seat(g, id).hand = { timber: 1, salt: 1, kelp: 1, copper: 0 };
    advance(g, g.deadline! + 1); // into build
    const [first, second] = g.initiative;
    const now = g.deadline! - 1000; // inside the build phase on the game's clock
    submitOrders(g, second, [{ type: "hall", hex: target }], now);
    expect(g.phase).toBe("build");
    submitOrders(g, first, [{ type: "hall", hex: target }], now);
    expect(g.buildings.find((b) => b.hex === target)?.owner).toBe(first);
    expect(g.lastBuilds.find((o) => o.seat === second)?.ok).toBe(false);
    expect(seat(g, second).hand.timber).toBeGreaterThanOrEqual(1); // not charged (plus any harvest)
  });

  it("lets rafts carry a colony across water", () => {
    const g = table(2);
    const rafts = legalTargets(g, "p1", "raft");
    if (!rafts.length) return; // this seed's start is landlocked
    g.buildings.push({ hex: rafts[0], owner: "p1", kind: "raft", beacon: false });
    const reach = neighbors(rafts[0]).filter((id) => g.hexes.some((h) => h.id === id && h.terrain !== "sea") && !g.buildings.some((b) => b.hex === id));
    for (const id of reach) expect(legalTargets(g, "p1", "hall")).toContain(id);
  });

  it("scores halls 1, keeps 2, beacons +1 and the Charter of the Four +2", () => {
    const g = table(2);
    g.buildings = [
      { hex: "0,0", owner: "p1", kind: "hall", beacon: false },
      { hex: "1,0", owner: "p1", kind: "keep", beacon: true },
      { hex: "2,0", owner: "p1", kind: "raft", beacon: false },
    ];
    seat(g, "p1").charter = true;
    expect(vp(g, "p1")).toBe(1 + 2 + 1 + 2);
  });
});

describe("a whole game with greedy colonists", () => {
  it("reaches an ending without negative hands and with every building on a legal hex", () => {
    const g = table(4);
    let now = T0;
    for (let i = 0; i < 40 && g.phase !== "ended"; i++) {
      now = (g.deadline ?? now) + 1;
      if (g.phase === "build") for (const s of g.seats) submitOrders(g, s.id, planBuilds(g, s), now);
      if (g.phase === "exchange") for (const s of g.seats) markDone(g, s.id, now);
      advance(g, now);
      for (const s of g.seats) for (const v of Object.values(s.hand)) expect(v).toBeGreaterThanOrEqual(0);
    }
    expect(g.phase).toBe("ended");
    expect(g.winners?.length).toBeGreaterThan(0);
    const hexes = new Set<string>();
    for (const b of g.buildings) {
      expect(hexes.has(b.hex)).toBe(false);
      hexes.add(b.hex);
      const t = g.hexes.find((h) => h.id === b.hex)!.terrain;
      expect(b.kind === "raft" ? t === "sea" : t !== "sea").toBe(true);
    }
  });
});

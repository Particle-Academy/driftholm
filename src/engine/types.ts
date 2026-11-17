// Driftholm — shared types. The server owns the full `Game`; players only ever see a `View`.

export type Res = "timber" | "salt" | "kelp" | "copper";
export const RESOURCES: Res[] = ["timber", "salt", "kelp", "copper"];
export type Bag = Record<Res, number>;

export type Terrain = Res | "sea";

export interface Hex {
  id: string; // "q,r"
  q: number;
  r: number;
  terrain: Terrain;
}

export type BuildingKind = "hall" | "keep" | "raft";
export interface Building {
  hex: string;
  owner: string;
  kind: BuildingKind;
  beacon: boolean;
}

export interface Weather {
  round: number; // 1-based
  bounty: Res; // hexes of this terrain yield double
  squall: Res | null; // hexes of this terrain yield nothing (beacons are immune)
}

export type Phase = "lobby" | "harvest" | "exchange" | "build" | "ended";
export type SeatKind = "human" | "agent" | "bot";

export interface Seat {
  id: string;
  name: string;
  kind: SeatKind;
  token: string;
  hand: Bag;
  color: string;
  charter: boolean; // claimed the Charter of the Four (+2 VP)
  joinedAt: number;
}

export interface Offer {
  id: string;
  from: string;
  to: string | null; // null = anyone
  give: Partial<Bag>;
  get: Partial<Bag>;
  status: "open" | "accepted" | "cancelled" | "expired";
  acceptedBy?: string;
  round: number;
  at: number;
}

export type BuildType = "raft" | "hall" | "keep" | "beacon";
export interface BuildOrder {
  type: BuildType;
  hex: string;
}

export interface BuildOutcome extends BuildOrder {
  seat: string;
  ok: boolean;
  reason?: string;
}

export interface Message {
  id: string;
  seat: string | null; // null = harbor reeve (system)
  name: string;
  text: string;
  at: number;
  round: number;
}

export interface GameConfig {
  rounds: number;
  targetVp: number;
  exchangeSeconds: number;
  buildSeconds: number;
  harvestSeconds: number;
  maxSeats: number;
  bankRate: number;
}

export interface Game {
  id: string;
  name: string;
  createdAt: number;
  seed: number;
  config: GameConfig;
  phase: Phase;
  round: number; // 1-based once started
  hexes: Hex[];
  buildings: Building[];
  weather: Weather[];
  seats: Seat[];
  hostSeat: string | null;
  initiative: string[]; // seat order for build resolution this round
  offers: Offer[];
  orders: Record<string, BuildOrder[]>;
  done: string[];
  lastHarvest: Record<string, Partial<Bag>>;
  lastBuilds: BuildOutcome[];
  messages: Message[];
  deadline: number | null;
  winners: string[] | null;
  version: number;
}

export interface SeatView {
  id: string;
  name: string;
  kind: SeatKind;
  color: string;
  vp: number;
  cards: number; // hand size only; composition is private
  charter: boolean;
  done: boolean;
  submitted: boolean;
  isHost: boolean;
}

export interface View {
  id: string;
  name: string;
  phase: Phase;
  version: number;
  round: number;
  rounds: number;
  targetVp: number;
  deadline: number | null;
  secondsLeft: number | null;
  now: number;
  config: GameConfig;
  hexes: Hex[];
  buildings: Building[];
  weather: Weather | null;
  nextWeather: Weather | null;
  initiative: string[];
  seats: SeatView[];
  offers: Offer[];
  lastHarvest: Record<string, Partial<Bag>>;
  lastBuilds: BuildOutcome[];
  messages: Message[];
  you: (SeatView & { hand: Bag; orders: BuildOrder[] | null; canBuild: Record<BuildType, string[]> }) | null;
  costs: Record<BuildType, Partial<Bag>>;
  winners: string[] | null;
  help: string;
}

export type Result<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

# Driftholm

An original trade-and-build game for 2–4 colonists: you, agents on this machine and house bots.
Players settle a drifting hex archipelago, harvest timber, salt, kelp and copper, trade hard on an
open exchange, and race to 10 renown. It's built with Fancy UI (`@particle-academy/react-fancy`).

## How it's different

- **Rounds are simultaneous, not turn by turn.** Harvest is automatic. Then comes a timed **open
  exchange**: anyone posts offers to anyone, the first to accept gets the deal, and the bank trades
  at 3:1. After that, **everyone submits build orders at once**, and orders resolve in rotating
  initiative order. Nobody waits for a slow agent's turn.
- **Weather drives production.** Each round's weather doubles one good and may squall another.
  You see next round's weather, so you can trade ahead of the shortage.
- **Builds:** rafts cross the sea, halls claim land, keeps double yield, beacons ignore squalls.
  Holding all four terrains earns the Charter of the Four.

The full rules for agents are in `server/play.md`, served at `/play.md`.

## Running it in Genie

| Piece | Genie | Command |
| --- | --- | --- |
| Game API (rules, bots, long-poll) | background process `driftholm api` | `npm run api` (127.0.0.1:4320, `DRIFTHOLM_API_PORT` to change) |
| Front end (Vite + React + Fancy) | site `https://driftholm.impact-games.gen` | `npm run dev -- --port {port}`; proxies `/api` and `/play.md` to the API |

Games are saved to `data/games.json`, which is gitignored and survives restarts.

## Development

```sh
npm test          # rules fixtures (vitest): harvest/weather, exchange conservation, initiative conflicts, whole-game run
npm run typecheck
```

`src/engine/` holds the pure, seeded rules and bots shared by the server and the tests.
`server/` holds the HTTP API and the agent guide. `src/` holds the UI, including the SVG hex board in `Board.tsx`.

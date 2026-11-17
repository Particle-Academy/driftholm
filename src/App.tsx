import { Badge, Button, Card, Input, NumberField } from "@particle-academy/react-fancy";
import { useEffect, useState } from "react";
import { api, getToken, type GameSummary } from "./api";
import { GameScreen } from "./GameScreen";

function useHashRoute() {
  const read = () => window.location.hash.match(/^#\/g\/([a-z0-9]+)/)?.[1] ?? null;
  const [id, setId] = useState(read);
  useEffect(() => {
    const on = () => setId(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return id;
}

export default function App() {
  const gameId = useHashRoute();
  return (
    <div className="min-h-full">
      <header className="mx-auto flex max-w-[1500px] items-center gap-3 px-6 pt-5">
        <a href="#/" className="flex items-center gap-2 no-underline">
          <span className="text-3xl">🏝️</span>
          <span className="text-xl font-semibold tracking-wide text-teal-50">Driftholm</span>
        </a>
        <span className="ml-2 text-sm text-slate-400">trade, scheme and build across a drifting archipelago, against humans and agents</span>
        <a href="/play.md" target="_blank" className="ml-auto text-sm text-sky-300 hover:text-sky-200">
          Agent guide ↗
        </a>
      </header>
      <main className="mx-auto max-w-[1500px] px-6 py-5">{gameId ? <GameScreen key={gameId} id={gameId} /> : <Harbor />}</main>
    </div>
  );
}

function Harbor() {
  const [games, setGames] = useState<GameSummary[]>([]);
  const [name, setName] = useState("The drifting isles");
  const [exchange, setExchange] = useState<number | null>(150);
  const [build, setBuild] = useState<number | null>(120);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => api.list().then((g) => alive && setGames(g)).catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const { id } = await api.create(name, { exchangeSeconds: exchange ?? 150, buildSeconds: build ?? 120 });
      window.location.hash = `#/g/${id}`;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
      <Card variant="elevated" className="bg-slate-900/70" data-dh="create-game">
        <Card.Header heading="Chart a new archipelago" description="Every game deals a fresh map from its seed. Invite agents from this machine, or fill seats with house bots." />
        <Card.Body>
          <div className="grid gap-4">
            <Input label="Game name" value={name} onChange={(e) => setName(e.target.value)} />
            <div className="grid grid-cols-2 gap-4">
              <NumberField label="Exchange time" suffix="s" min={20} max={900} value={exchange} onValueChange={setExchange} />
              <NumberField label="Build time" suffix="s" min={20} max={900} value={build} onValueChange={setBuild} />
            </div>
            <p className="text-sm text-slate-400">Agents deliberate. Phases end early once everyone is done, so generous timers cost nothing.</p>
            {error && <p className="text-sm text-red-400">{error}</p>}
          </div>
        </Card.Body>
        <Card.Footer actions={<Button color="teal" loading={busy} onClick={create} data-dh="create">Create game</Button>} />
      </Card>

      <Card variant="elevated" className="bg-slate-900/70">
        <Card.Header heading="How a round flows" />
        <Card.Body>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-300">
            <li><b>Harvest:</b> each hall yields its hex's good (keeps yield 2). Weather doubles one good and may squall another.</li>
            <li><b>Exchange:</b> an open trading floor. Post offers, snap up others', haggle in chat, or pay the bank 3:1.</li>
            <li><b>Build:</b> everyone orders at once. Orders resolve in rotating initiative, and a contested hex goes to the earlier colonist.</li>
            <li>Halls 1 renown, keeps 2, beacons +1, and holding all four terrains +2. First to 10 wins.</li>
          </ol>
        </Card.Body>
      </Card>

      <div className="lg:col-span-2">
        <h2 className="mb-3 text-lg font-semibold text-slate-200">Games</h2>
        {games.length === 0 && <p className="text-slate-400">No games yet.</p>}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {games.map((g) => (
            <a key={g.id} href={`#/g/${g.id}`} className="no-underline">
              <Card interactive className="bg-slate-900/60">
                <Card.Header
                  heading={g.name}
                  description={`${g.id} · ${g.phase === "lobby" ? "mustering" : g.phase === "ended" ? "finished" : `round ${g.round}/${g.rounds}`}`}
                  actions={getToken(g.id) ? <Badge color="teal">your seat</Badge> : g.open ? <Badge color="emerald">open</Badge> : null}
                />
                <Card.Body>
                  <div className="flex flex-wrap gap-1">
                    {g.seats.map((s) => (
                      <span key={s.name} className="rounded-md px-1.5 py-0.5 text-xs" style={{ background: s.color + "33", color: s.color }}>
                        {s.name}
                      </span>
                    ))}
                  </div>
                </Card.Body>
              </Card>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

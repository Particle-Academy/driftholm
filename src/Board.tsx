import type { BuildOrder, Building, Hex, Terrain, View } from "./engine/types";

export const TERRAIN: Record<Terrain, { fill: string; edge: string; icon: string; label: string }> = {
  timber: { fill: "#2f6b3a", edge: "#1f4a28", icon: "🌲", label: "Timber woods" },
  salt: { fill: "#cfc6ae", edge: "#a69c84", icon: "🧂", label: "Salt flats" },
  kelp: { fill: "#1f8a7a", edge: "#156156", icon: "🌿", label: "Kelp shallows" },
  copper: { fill: "#b5652b", edge: "#8a4a1d", icon: "⛏️", label: "Copper bluffs" },
  sea: { fill: "#0e3a55", edge: "#0b2e44", icon: "", label: "Open sea" },
};

const SIZE = 42;
const SQ3 = Math.sqrt(3);
const center = (h: Pick<Hex, "q" | "r">) => ({ x: SIZE * SQ3 * (h.q + h.r / 2), y: SIZE * 1.5 * h.r });
const corners = (cx: number, cy: number, s = SIZE) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return `${(cx + s * Math.cos(a)).toFixed(1)},${(cy + s * Math.sin(a)).toFixed(1)}`;
  }).join(" ");

export function Board({
  view,
  targets,
  queued,
  onPick,
}: {
  view: View;
  targets: Set<string>;
  queued: BuildOrder[];
  onPick: (hex: string) => void;
}) {
  const pts = view.hexes.map(center);
  const pad = SIZE * 1.2;
  const minX = Math.min(...pts.map((p) => p.x)) - pad;
  const maxX = Math.max(...pts.map((p) => p.x)) + pad;
  const minY = Math.min(...pts.map((p) => p.y)) - pad;
  const maxY = Math.max(...pts.map((p) => p.y)) + pad;
  const color = (id: string) => view.seats.find((s) => s.id === id)?.color ?? "#fff";
  const w = view.weather;

  return (
    <svg viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} className="w-full select-none" role="img" aria-label="Archipelago map" data-dh="board">
      <defs>
        <radialGradient id="seaGlow" cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor="#14506e" />
          <stop offset="100%" stopColor="#081d2b" />
        </radialGradient>
      </defs>
      <rect x={minX} y={minY} width={maxX - minX} height={maxY - minY} fill="url(#seaGlow)" rx="18" />
      {view.hexes.map((h) => {
        const { x, y } = center(h);
        const t = TERRAIN[h.terrain];
        const target = targets.has(h.id);
        const squalled = w?.squall === h.terrain;
        const bounty = w?.bounty === h.terrain;
        return (
          <g
            key={h.id}
            className={target ? "hex-target" : undefined}
            onClick={target ? () => onPick(h.id) : undefined}
            data-dh={`hex-${h.id}`}
            data-terrain={h.terrain}
          >
            <polygon className="hex-face" points={corners(x, y, SIZE - 1.5)} fill={t.fill} stroke={t.edge} strokeWidth="2" opacity={h.terrain === "sea" ? 0.55 : 1} />
            {h.terrain !== "sea" && (
              <text x={x} y={y - 12} textAnchor="middle" fontSize="17" className="swell" style={{ transformOrigin: `${x}px ${y}px` }}>
                {t.icon}
              </text>
            )}
            {bounty && <polygon points={corners(x, y, SIZE - 5)} fill="none" stroke="#fde047" strokeWidth="2.5" strokeDasharray="6 4" />}
            {squalled && <polygon points={corners(x, y, SIZE - 1.5)} fill="#334155" opacity="0.55" />}
            {squalled && <text x={x + 18} y={y - 14} fontSize="13">⛈️</text>}
            {target && (
              <>
                <polygon points={corners(x, y, SIZE - 4)} fill="#ffffff" fillOpacity="0.07" stroke="none" />
                <polygon points={corners(x, y, SIZE - 4)} fill="none" stroke="#f0fdfa" strokeWidth="3" className="glow" />
              </>
            )}
            <text x={x} y={y + 30} textAnchor="middle" fontSize="8.5" fill="#ffffff" opacity="0.45" fontFamily="ui-monospace,monospace">
              {h.id}
            </text>
          </g>
        );
      })}
      {view.buildings.map((b) => (
        <Piece key={b.hex} b={b} at={center(view.hexes.find((h) => h.id === b.hex)!)} color={color(b.owner)} />
      ))}
      {queued.map((o, i) => {
        const h = view.hexes.find((x) => x.id === o.hex);
        if (!h) return null;
        const { x, y } = center(h);
        return (
          <g key={`${o.hex}-${o.type}-${i}`} pointerEvents="none">
            <circle cx={x} cy={y + 8} r="13" fill="#0f172a" opacity="0.8" stroke="#fde68a" strokeWidth="1.5" strokeDasharray="3 2" />
            <text x={x} y={y + 12.5} textAnchor="middle" fontSize="11" fill="#fde68a" fontWeight="700">
              {i + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Piece({ b, at, color }: { b: Building; at: { x: number; y: number }; color: string }) {
  const { x, y } = at;
  const stroke = "#0b1220";
  return (
    <g data-dh={`piece-${b.hex}`} pointerEvents="none">
      {b.kind === "raft" && (
        <g>
          {[-9, 0, 9].map((dx) => (
            <rect key={dx} x={x + dx - 3.5} y={y - 4} width="7" height="20" rx="2" fill="#a16207" stroke={stroke} strokeWidth="1" />
          ))}
          <rect x={x - 14} y={y + 1} width="28" height="4" fill={color} stroke={stroke} strokeWidth="1" />
        </g>
      )}
      {b.kind === "hall" && <path d={`M${x - 11} ${y + 14} v-12 l11 -9 l11 9 v12 z`} fill={color} stroke={stroke} strokeWidth="1.6" />}
      {b.kind === "keep" && (
        <path
          d={`M${x - 12} ${y + 15} v-20 h5 v4 h4 v-4 h6 v4 h4 v-4 h5 v20 z`}
          fill={color}
          stroke={stroke}
          strokeWidth="1.6"
        />
      )}
      {b.beacon && (
        <g>
          <circle cx={x + 15} cy={y - 10} r="9" fill="#fde047" opacity="0.35" className="glow" />
          <circle cx={x + 15} cy={y - 10} r="4" fill="#fde047" stroke={stroke} strokeWidth="1" />
        </g>
      )}
    </g>
  );
}

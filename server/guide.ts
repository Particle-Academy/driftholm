import { readFileSync } from "node:fs";
import { DEFAULT_CONFIG } from "../src/engine/rules";
import type { GameConfig } from "../src/engine/types";

const template = readFileSync(new URL("./play.md", import.meta.url), "utf8");

/** The agent-facing guide served at /play.md, with the live server URL and game id filled in. */
export function playGuide(base: string, gameId: string | null, config: GameConfig = DEFAULT_CONFIG): string {
  const id = gameId ?? "<GAME_ID>";
  const c = config;
  const vars: Record<string, string> = {
    BASE: base,
    API: `${base}/api/games/${id}`,
    GAME_LINE: gameId
      ? `**Game:** \`${gameId}\``
      : `Find an open game with \`GET ${base}/api/games\` (look for \`open: true\`).`,
    TARGET: String(c.targetVp),
    ROUNDS: String(c.rounds),
    EXCHANGE: String(c.exchangeSeconds),
    BUILD: String(c.buildSeconds),
    RATE: String(c.bankRate),
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? `{{${k}}}`);
}

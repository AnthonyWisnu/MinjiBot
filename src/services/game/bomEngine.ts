export const BOM_BOARD_SIZE = 9;
export const BOM_SAFE_TOTAL = BOM_BOARD_SIZE - 1;

export interface BomState {
  bombIndex: number; // 0..8
  openedSafeIndices: Set<number>;
  openedByUser: Map<number, string>;
  steps: number;
}

export type BomPickOutcome =
  | { status: "invalid" }
  | { status: "already_open"; cell: number }
  | { status: "bomb"; cell: number }
  | { status: "safe"; cell: number; steps: number; remainingSafe: number; cleanSweep: boolean };

const NUMBER_TILES = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"] as const;

export function createBomState(bombIndex: number): BomState {
  const safeIndex = Math.abs(Math.trunc(bombIndex)) % BOM_BOARD_SIZE;
  return {
    bombIndex: safeIndex,
    openedSafeIndices: new Set<number>(),
    openedByUser: new Map<number, string>(),
    steps: 0,
  };
}

export function pickBomCell(state: BomState, rawCell: number, userJid: string): BomPickOutcome {
  if (!Number.isInteger(rawCell) || rawCell < 1 || rawCell > BOM_BOARD_SIZE) {
    return { status: "invalid" };
  }

  const idx = rawCell - 1;
  if (state.openedSafeIndices.has(idx)) {
    return { status: "already_open", cell: rawCell };
  }

  if (idx === state.bombIndex) {
    return { status: "bomb", cell: rawCell };
  }

  state.openedSafeIndices.add(idx);
  state.openedByUser.set(idx, userJid);
  state.steps += 1;

  const remainingSafe = BOM_SAFE_TOTAL - state.openedSafeIndices.size;
  return {
    status: "safe",
    cell: rawCell,
    steps: state.steps,
    remainingSafe,
    cleanSweep: remainingSafe === 0,
  };
}

export function formatBomBoard(
  state: BomState,
  revealBomb: boolean,
  explodedCell?: number,
): string {
  const rows: string[] = [];
  for (let row = 0; row < 3; row++) {
    const cells: string[] = [];
    for (let col = 0; col < 3; col++) {
      const idx = row * 3 + col;
      if (revealBomb && idx === state.bombIndex) {
        cells.push(explodedCell === idx + 1 ? "💥" : "💣");
      } else if (state.openedSafeIndices.has(idx)) {
        cells.push("✅");
      } else {
        cells.push(NUMBER_TILES[idx] ?? String(idx + 1));
      }
    }
    rows.push(cells.join(" "));
  }
  return rows.join("\n");
}

import type { ArkGridAttr } from '../constants/enums';
import type { ArkGridGem } from '../models/arkGridGems';
import type { GemSetPackTuple } from './models';

export type WorkerCore = {
  energy: number;
  point: number;
  coeff: number[];
};

export type SolverScoreSet = {
  score: number;
  bestScore: number;
  perfectScore: number;
};

export type SolverProgressStage =
  | 'preparing'
  | 'searching_order_packs'
  | 'searching_chaos_packs'
  | 'combining_results'
  | 'simulating_launcher_gems'
  | 'finalizing';

export type SolverProgress = {
  stage: SolverProgressStage;
  totalPercent: number;
  stagePercent: number;
  attr?: ArkGridAttr;
  current?: number;
  total?: number;
};

export type SolverAdditionalGemResult = Record<
  ArkGridAttr,
  Record<
    string,
    {
      corePointTuple: [number, number, number];
      gems: ArkGridGem[];
      score: number;
    }
  >
>;

// Plain-object form of GemSet / GemSetPack for structured-clone transfer between workers.
// BigInt fields (bitmask) are preserved by structured clone; class prototypes are not,
// but all consumers access only plain properties so duck-typing is sufficient.
export type PlainGemSet = {
  att: number;
  skill: number;
  boss: number;
  point: number;
  bitmask: bigint;
  coreCoeff: number;
  core: WorkerCore;
  maxScore: number;
  minScore: number;
};

export type PlainGemSetPack = {
  gs1: PlainGemSet | null;
  gs2: PlainGemSet | null;
  gs3: PlainGemSet | null;
  att: number;
  skill: number;
  boss: number;
  coreScore: number;
  minScore: number;
  maxScore: number;
};

export type SolverRunPayload = {
  orderCores: WorkerCore[];
  chaosCores: WorkerCore[];
  orderGems: ArkGridGem[];
  chaosGems: ArkGridGem[];
  isSupporter: boolean;
  // attr: when set, Phase-2 result is filtered to that attr only (assignedGemIndexes for the
  // other side are zeroed out and score is single-attr).  When undefined, full 6-core result.
  attr?: ArkGridAttr;
  // Per-attr stability tiebreaker bitmasks — separate because order/chaos gem indices are
  // independent arrays, so a single shared bitmask would be meaningless for both sides.
  orderCurrentBitmasks?: bigint[];
  chaosCurrentBitmasks?: bigint[];
  // Memory-fix fields: set by SolverController for two-phase sequential execution.
  // precomputedStats: attMax/skillMax/bossMax across all 6 cores, computed via DP in
  // the main thread so each worker only needs to build one attr's GemSet list.
  precomputedStats?: { attMax: number; skillMax: number; bossMax: number };
  // precalculatedOrderGspList: serialized orderGspList from the Phase-1 worker, passed
  // to the Phase-2+3 worker so it can skip order Phase 2 and go straight to Phase 3.
  precalculatedOrderGspList?: PlainGemSetPack[];
};

export type SolverRunResult = {
  assignedGemIndexes: number[][];
  gemSetPackTuple: GemSetPackTuple;
  scoreSet: SolverScoreSet;
  additionalGemResult: SolverAdditionalGemResult;
  needLauncherGem: Record<ArkGridAttr, boolean>;
};

export type SolverWorkerRequest =
  | {
      type: 'runSolve';
      payload: SolverRunPayload;
    }
  | {
      // Phase-1 message: build orderGssList, run order Phase 2, return serialized GspList.
      // Worker terminates after this so OS reclaims ~2.35 GB before Phase 2+3 begins.
      type: 'runSolvePhase2Order';
      payload: SolverRunPayload;
    };

export type SolverWorkerResponse =
  | {
      type: 'runSolve:progress';
      progress: SolverProgress;
    }
  | {
      type: 'runSolve:done';
      result: SolverRunResult;
    }
  | {
      type: 'runSolve:error';
      message: string;
    }
  | {
      type: 'runSolvePhase2Order:progress';
      progress: SolverProgress;
    }
  | {
      type: 'runSolvePhase2Order:done';
      gspList: PlainGemSetPack[];
    }
  | {
      type: 'runSolvePhase2Order:error';
      message: string;
    };

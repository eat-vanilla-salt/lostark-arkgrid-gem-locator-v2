import type { ArkGridAttr } from '../constants/enums';
import type { ArkGridGem, ArkGridGemOptionName } from '../models/arkGridGems';
import {
  Core,
  Gem,
  GemSet,
  GemSetPack,
  GemSetPackTuple,
  buildScoreMap,
  gemOptionLevelCoeffs,
  gemOptionLevelCoeffsSupporter,
} from './models';
import { getBestGemSetPacks, getMaxStat, getPossibleGemSets } from './solver';
import type {
  SolverAdditionalGemResult,
  SolverProgress,
  SolverProgressStage,
  SolverRunPayload,
  SolverRunResult,
  SolverWorkerRequest,
  SolverWorkerResponse,
  WorkerCore,
} from './types';
import { gemSetPackKey } from './utils';

const perfectGems = [
  {
    req: 3,
    point: 5,
    option1: { optionType: '공격력', value: 5 },
    option2: {
      optionType: '추가 피해',
      value: 5,
    },
  },
  {
    req: 4,
    point: 5,
    option1: { optionType: '공격력', value: 5 },
    option2: {
      optionType: '보스 피해',
      value: 5,
    },
  },
  {
    req: 5,
    point: 5,
    option1: {
      optionType: '추가 피해',
      value: 5,
    },
    option2: {
      optionType: '보스 피해',
      value: 5,
    },
  },
] satisfies Partial<ArkGridGem>[];

const perfectGemsSupporter = [
  {
    req: 3,
    point: 5,
    option1: { optionType: '낙인력', value: 5 },
    option2: {
      optionType: '아군 피해 강화',
      value: 5,
    },
  },
  {
    req: 4,
    point: 5,
    option1: { optionType: '아군 피해 강화', value: 5 },
    option2: {
      optionType: '아군 공격 강화',
      value: 5,
    },
  },
  {
    req: 5,
    point: 5,
    option1: {
      optionType: '낙인력',
      value: 5,
    },
    option2: {
      optionType: '아군 공격 강화',
      value: 5,
    },
  },
] satisfies Partial<ArkGridGem>[];

const STAGE_RANGES: Record<SolverProgressStage, [number, number]> = {
  preparing: [0, 10],
  searching_order_packs: [10, 50],
  searching_chaos_packs: [50, 90],
  combining_results: [90, 95],
  simulating_launcher_gems: [95, 99],
  finalizing: [99, 100],
};

type PrecalculatedGspList = {
  order?: GemSetPack[];
  chaos?: GemSetPack[];
};

type StepCallback = (orderGspList: GemSetPack[], chaosGspList: GemSetPack[]) => void;
type ProgressReporter = (progress: SolverProgress) => void;

type SolveOptions = {
  isSupporter?: boolean;
  perfectSolve?: boolean;
  precalculatedGsp?: PrecalculatedGspList;
  onStep?: StepCallback;
  attr?: ArkGridAttr;
  orderCurrentBitmasks?: bigint[];
  chaosCurrentBitmasks?: bigint[];
};

function popcount(n: bigint): number {
  let count = 0;
  while (n > 0n) {
    count += Number(n & 1n);
    n >>= 1n;
  }
  return count;
}

function computeGspStability(gsp: GemSetPack | null, bitmasks?: bigint[]): number {
  if (!gsp || !bitmasks) return 0;
  let overlap = 0;
  if (gsp.gs1 && bitmasks[0] !== undefined) overlap += popcount(gsp.gs1.bitmask & bitmasks[0]);
  if (gsp.gs2 && bitmasks[1] !== undefined) overlap += popcount(gsp.gs2.bitmask & bitmasks[1]);
  if (gsp.gs3 && bitmasks[2] !== undefined) overlap += popcount(gsp.gs3.bitmask & bitmasks[2]);
  return overlap;
}

type SolveResultInternal = {
  answer: GemSetPackTuple;
  assignedGemIndexes: number[][];
  needLauncherGem: Record<ArkGridAttr, boolean>;
};

function toCore(core: WorkerCore) {
  return new Core(core.energy, core.point, core.coeff);
}

function convertToSolverGems(
  gems: ArkGridGem[],
  isSupporter: boolean
): {
  gems: Gem[];
} {
  const optionIndexMap: ArkGridGemOptionName[] = isSupporter
    ? ['아군 피해 강화', '낙인력', '아군 공격 강화']
    : ['공격력', '추가 피해', '보스 피해'];

  return {
    gems: gems.map((gem, index) => {
      const coeff = [0, 0, 0];

      for (const option of [gem.option1, gem.option2]) {
        const optionIndex = optionIndexMap.findIndex((name) => name === option.optionType);
        if (optionIndex === -1) {
          continue;
        }
        coeff[optionIndex] += option.value;
      }

      return new Gem(BigInt(index), gem.req, gem.point, coeff[0], coeff[1], coeff[2]);
    }),
  };
}

function assignGemIndexes(gs: GemSet | null | undefined): number[] {
  if (!gs) {
    return [];
  }

  let bitmask = gs.bitmask;
  let index = 0;
  const result: number[] = [];

  while (bitmask > 0n) {
    if ((bitmask & 1n) === 1n) {
      result.push(index);
    }
    index += 1;
    bitmask >>= 1n;
  }

  return result;
}

function isGspNeedMoreGem(gsp: GemSetPack | null) {
  if (!gsp) {
    return false;
  }

  return [gsp.gs1, gsp.gs2, gsp.gs3].some((gs) => {
    if (!gs) {
      return false;
    }

    let maxPoint = 0;
    switch (gs.core.energy) {
      case 9:
        maxPoint = 10;
        break;
      case 12:
        maxPoint = 14;
        break;
      case 15:
      case 17:
        maxPoint = 17;
        break;
    }

    if (maxPoint === 0) {
      return false;
    }

    return gs.point < maxPoint;
  });
}

function emitProgress(
  report: ProgressReporter | undefined,
  stage: SolverProgressStage,
  stagePercent: number,
  extra?: Omit<SolverProgress, 'stage' | 'stagePercent' | 'totalPercent'>
) {
  if (!report) {
    return;
  }

  const boundedStagePercent = Math.max(0, Math.min(100, stagePercent));
  const [start, end] = STAGE_RANGES[stage];
  const totalPercent = start + ((end - start) * boundedStagePercent) / 100;

  report({
    stage,
    stagePercent: boundedStagePercent,
    totalPercent,
    ...extra,
  });
}

function solve(
  rawOrderCores: WorkerCore[],
  rawChaosCores: WorkerCore[],
  inOrderGems: ArkGridGem[],
  inChaosGems: ArkGridGem[],
  { isSupporter = false, perfectSolve = false, precalculatedGsp, onStep, attr, orderCurrentBitmasks, chaosCurrentBitmasks }: SolveOptions = {},
  report?: ProgressReporter
): SolveResultInternal {
  const solveOrder = !attr || attr === '질서';
  const solveChaos = !attr || attr === '혼돈';

  emitProgress(report, 'preparing', 0);
  const orderCores = rawOrderCores.map(toCore);
  const chaosCores = rawChaosCores.map(toCore);

  const { gems: orderGems } = convertToSolverGems(inOrderGems, isSupporter);
  const { gems: chaosGems } = convertToSolverGems(inChaosGems, isSupporter);

  const orderGssList = solveOrder ? orderCores.map((core) => getPossibleGemSets(core, orderGems)) : [];
  const chaosGssList = solveChaos ? chaosCores.map((core) => getPossibleGemSets(core, chaosGems)) : [];

  if (perfectSolve) {
    for (const gssList of [orderGssList, chaosGssList]) {
      for (let i = 0; i < gssList.length; i++) {
        const gss = gssList[i];
        const seen = new Set<string>();
        const uniqueGss: GemSet[] = [];

        for (const gs of gss) {
          const key = JSON.stringify({
            att: gs.att,
            skill: gs.skill,
            boss: gs.boss,
            coreScore: gs.coreCoeff,
          });
          if (!seen.has(key)) {
            seen.add(key);
            uniqueGss.push(gs);
          }
        }

        gssList[i] = uniqueGss;
      }
    }
  }

  const relevantGssList = orderGssList.concat(chaosGssList);
  let attMax = 0;
  let skillMax = 0;
  let bossMax = 0;

  for (const gss of relevantGssList) {
    attMax += getMaxStat(gss, 'att');
    skillMax += getMaxStat(gss, 'skill');
    bossMax += getMaxStat(gss, 'boss');
  }

  const gemOptionCoeff = isSupporter ? gemOptionLevelCoeffsSupporter : gemOptionLevelCoeffs;
  const scoreMaps = [
    buildScoreMap(gemOptionCoeff[0], attMax),
    buildScoreMap(gemOptionCoeff[1], skillMax),
    buildScoreMap(gemOptionCoeff[2], bossMax),
  ];

  for (const gss of relevantGssList) {
    for (const gs of gss) {
      gs.setScoreRange(scoreMaps);
    }
  }

  emitProgress(report, 'preparing', 100);

  let orderGspList: GemSetPack[] = [];
  if (solveOrder) {
    emitProgress(report, 'searching_order_packs', 0);
    orderGspList = precalculatedGsp?.order
      ? [...precalculatedGsp.order]
      : getBestGemSetPacks(orderGssList, scoreMaps, perfectSolve, ({ current, total }) => {
          emitProgress(report, 'searching_order_packs', (current / total) * 100, { current, total });
        });
    emitProgress(report, 'searching_order_packs', 100);
  }

  let chaosGspList: GemSetPack[] = [];
  if (solveChaos) {
    emitProgress(report, 'searching_chaos_packs', 0);
    chaosGspList = precalculatedGsp?.chaos
      ? [...precalculatedGsp.chaos]
      : getBestGemSetPacks(chaosGssList, scoreMaps, perfectSolve, ({ current, total }) => {
          emitProgress(report, 'searching_chaos_packs', (current / total) * 100, { current, total });
        });
    emitProgress(report, 'searching_chaos_packs', 100);
  }

  if (onStep) {
    onStep(orderGspList, chaosGspList);
  }

  // Pick best single-attr pack with stability tiebreaker
  function pickBestGsp(gspList: GemSetPack[], bitmasks?: bigint[]): GemSetPack | null {
    if (gspList.length === 0) return null;
    let best = gspList[0];
    let bestScore = new GemSetPackTuple(best, null, isSupporter).score;
    let bestStability = computeGspStability(best, bitmasks);
    for (let i = 1; i < gspList.length; i++) {
      const gsp = gspList[i];
      const score = new GemSetPackTuple(gsp, null, isSupporter).score;
      const stability = computeGspStability(gsp, bitmasks);
      if (score > bestScore || (score === bestScore && stability > bestStability)) {
        best = gsp;
        bestScore = score;
        bestStability = stability;
      }
    }
    return best;
  }

  const bestOrderGsp = solveOrder ? pickBestGsp(orderGspList, orderCurrentBitmasks) : null;
  const bestChaosGsp = solveChaos ? pickBestGsp(chaosGspList, chaosCurrentBitmasks) : null;

  let answer = new GemSetPackTuple(
    solveOrder ? bestOrderGsp : null,
    solveChaos ? bestChaosGsp : null,
    isSupporter
  );

  // Only run the cross-product combining step when solving both attrs together
  if (solveOrder && solveChaos) {
    emitProgress(report, 'combining_results', 0);
    const gemSetPackSet: GemSetPack[][] = [[], []];

    for (const [i, gspList] of [orderGspList, chaosGspList].entries()) {
      const seen = new Set<string>();
      const total = gspList.length;
      let current = 0;
      for (const gsp of gspList) {
        current += 1;
        emitProgress(report, 'combining_results', ((i + current / Math.max(total, 1)) / 4) * 100, {
          current,
          total,
        });
        const key = `${gsp.att}|${gsp.skill}|${gsp.boss}|${gsp.coreScore}`;
        if (!seen.has(key)) {
          seen.add(key);
          gemSetPackSet[i].push(gsp);
        }
      }
    }

    if (gemSetPackSet[0].length > 0 && gemSetPackSet[1].length > 0) {
      const total = gemSetPackSet[0].length;
      let current = 0;
      for (const gsp1 of gemSetPackSet[0]) {
        current += 1;
        emitProgress(report, 'combining_results', 50 + (current / total) * 50, { current, total });
        for (const gsp2 of gemSetPackSet[1]) {
          const gspt = new GemSetPackTuple(gsp1, gsp2, isSupporter);
          if (gspt.score > answer.score) {
            answer = gspt;
          }
        }
      }
    }

    emitProgress(report, 'combining_results', 100);
  }

  return {
    answer,
    assignedGemIndexes: [
      assignGemIndexes(answer.gsp1?.gs1),
      assignGemIndexes(answer.gsp1?.gs2),
      assignGemIndexes(answer.gsp1?.gs3),
      assignGemIndexes(answer.gsp2?.gs1),
      assignGemIndexes(answer.gsp2?.gs2),
      assignGemIndexes(answer.gsp2?.gs3),
    ],
    needLauncherGem: {
      질서: isGspNeedMoreGem(answer.gsp1),
      혼돈: isGspNeedMoreGem(answer.gsp2),
    },
  };
}

function getPerfectScore(isSupporter: boolean) {
  const coeffs = isSupporter ? gemOptionLevelCoeffsSupporter : gemOptionLevelCoeffs;

  if (!isSupporter) {
    return (
      ((((((1.09 *
        1.09 *
        1.06 *
        1.04 *
        1.04 *
        1.04 *
        (Math.floor((60 * coeffs[0]) / 120) + 10000)) /
        10000) *
        (Math.floor((90 * coeffs[1]) / 120) + 10000)) /
        10000) *
        (Math.floor((90 * coeffs[2]) / 120) + 10000)) /
        10000 -
        1) *
      100
    );
  }

  return (
    ((((((1.0942 *
      1.0942 *
      1.033 *
      1.06 *
      1.06 *
      1.0353 *
      (Math.floor((60 * coeffs[0]) / 120) + 10000)) /
      10000) *
      (Math.floor((90 * coeffs[1]) / 120) + 10000)) /
      10000) *
      (Math.floor((90 * coeffs[2]) / 120) + 10000)) /
      10000 -
      1) *
    100
  );
}

function createProgressReporter(postProgress: ProgressReporter): ProgressReporter {
  let lastTotalPercent = -1;
  let lastStagePercent = -1;
  let lastStage: SolverProgressStage | null = null;

  return (progress) => {
    const roundedTotalPercent = Math.max(0, Math.min(100, Math.round(progress.totalPercent)));
    const roundedStagePercent = Math.max(0, Math.min(100, Math.round(progress.stagePercent)));

    if (
      roundedTotalPercent === lastTotalPercent &&
      roundedStagePercent === lastStagePercent &&
      progress.stage === lastStage
    ) {
      return;
    }

    lastTotalPercent = roundedTotalPercent;
    lastStagePercent = roundedStagePercent;
    lastStage = progress.stage;

    postProgress({
      ...progress,
      totalPercent: roundedTotalPercent,
      stagePercent: roundedStagePercent,
    });
  };
}

function runSolve(payload: SolverRunPayload, report: ProgressReporter): SolverRunResult {
  const { orderCores, chaosCores, orderGems, chaosGems, isSupporter, attr, orderCurrentBitmasks, chaosCurrentBitmasks } = payload;
  const perfectOrderGems: ArkGridGem[] = [];
  const perfectChaosGems: ArkGridGem[] = [];

  for (const gem of isSupporter ? perfectGemsSupporter : perfectGems) {
    for (let i = 0; i < 4; i++) {
      perfectOrderGems.push({ gemAttr: '질서', ...gem });
      perfectChaosGems.push({ gemAttr: '혼돈', ...gem });
    }
  }

  let precalculatedGspListOrder: PrecalculatedGspList | undefined;
  let precalculatedGspListChaos: PrecalculatedGspList | undefined;

  const solved = solve(
    orderCores,
    chaosCores,
    orderGems,
    chaosGems,
    {
      isSupporter,
      attr,
      orderCurrentBitmasks,
      chaosCurrentBitmasks,
      onStep: (order, chaos) => {
        precalculatedGspListOrder = { order };
        precalculatedGspListChaos = { chaos };
      },
    },
    report
  );

  const answer = solved.answer;
  const score = (answer.score - 1) * 100;
  const bestScore =
    (solve(orderCores, chaosCores, perfectOrderGems, perfectChaosGems, {
      isSupporter,
      perfectSolve: true,
      attr,
    }).answer.score -
      1) *
    100;

  const additionalGemResult: SolverAdditionalGemResult = {
    질서: {},
    혼돈: {},
  };

  const simulationTargets = (
    [
      { attr: '질서' as ArkGridAttr, gsp: answer.gsp1 },
      { attr: '혼돈' as ArkGridAttr, gsp: answer.gsp2 },
    ] satisfies { attr: ArkGridAttr; gsp: GemSetPack | null }[]
  ).filter(({ attr: a }) => !attr || a === attr);

  const shouldSimulateLauncherGems = simulationTargets.some(
    ({ attr: a, gsp }) => solved.needLauncherGem[a] && gsp
  );

  if (shouldSimulateLauncherGems) {
    emitProgress(report, 'simulating_launcher_gems', 0);
  }

  for (const { attr: simAttr, gsp } of simulationTargets) {
    if (!solved.needLauncherGem[simAttr] || !gsp) {
      continue;
    }

    const currentKey = gemSetPackKey(gsp).join(',');

    for (let gemReq = 3; gemReq < 10; gemReq++) {
      for (let gemPoint = 5; gemPoint >= 1; gemPoint--) {
        const newGem: ArkGridGem = {
          gemAttr: simAttr,
          req: gemReq,
          point: gemPoint,
          option1: { optionType: '공격력', value: 0 },
          option2: { optionType: '추가 피해', value: 0 },
        };

        const nextSolve = solve(
          orderCores,
          chaosCores,
          simAttr === '질서' ? [...orderGems, newGem] : orderGems,
          simAttr === '혼돈' ? [...chaosGems, newGem] : chaosGems,
          {
            isSupporter,
            attr,
            precalculatedGsp:
              simAttr === '혼돈' ? precalculatedGspListOrder : precalculatedGspListChaos,
          }
        );

        const nextGsp = simAttr === '질서' ? nextSolve.answer.gsp1 : nextSolve.answer.gsp2;
        if (!nextGsp) {
          continue;
        }

        const newKeyRaw = gemSetPackKey(nextGsp);
        const newKey = newKeyRaw.join(',');
        const targetAdditionalGem = additionalGemResult[simAttr];

        if (newKey !== currentKey && nextSolve.answer.score > answer.score) {
          if (targetAdditionalGem[newKey]) {
            targetAdditionalGem[newKey].gems.push(newGem);
            if (targetAdditionalGem[newKey].score < nextSolve.answer.score) {
              targetAdditionalGem[newKey].score = nextSolve.answer.score;
            }
          } else {
            targetAdditionalGem[newKey] = {
              corePointTuple: newKeyRaw,
              gems: [newGem],
              score: nextSolve.answer.score,
            };
          }
        }
      }
    }
  }

  if (shouldSimulateLauncherGems) {
    emitProgress(report, 'simulating_launcher_gems', 100);
  }
  emitProgress(report, 'finalizing', 100);

  return {
    assignedGemIndexes: solved.assignedGemIndexes,
    gemSetPackTuple: answer,
    scoreSet: {
      score,
      bestScore,
      perfectScore: getPerfectScore(isSupporter),
    },
    additionalGemResult,
    needLauncherGem: solved.needLauncherGem,
  };
}

self.onmessage = (e: MessageEvent<SolverWorkerRequest>) => {
  const data = e.data;

  switch (data.type) {
    case 'runSolve':
      try {
        const report = createProgressReporter((progress) => {
          self.postMessage({
            type: 'runSolve:progress',
            progress,
          } satisfies SolverWorkerResponse);
        });

        self.postMessage({
          type: 'runSolve:done',
          result: runSolve(data.payload, report),
        } satisfies SolverWorkerResponse);
      } catch (error) {
        self.postMessage({
          type: 'runSolve:error',
          message: error instanceof Error ? error.message : String(error),
        } satisfies SolverWorkerResponse);
      }
      break;
  }
};

import { ArkGridAttrs } from '../constants/enums';
import {
  type ArkGridCoreCoeffs,
  ArkGridCoreTypes,
  getDefaultCoreEnergy,
} from '../models/arkGridCores';
import { type ArkGridGem, gemFingerprint } from '../models/arkGridGems';
import type { CharacterProfile } from '../state/profile.state.svelte';
import type {
  PlainGemSetPack,
  SolverProgress,
  SolverRunPayload,
  SolverRunResult,
  SolverWorkerRequest,
  SolverWorkerResponse,
  WorkerCore,
} from './types';

function buildCoreArray(coeffs: ArkGridCoreCoeffs): number[] {
  const arr = new Array(21).fill(0);
  arr.fill(coeffs.p10, 10, 14);
  arr.fill(coeffs.p14, 14, 17);
  arr[17] = coeffs.p17;
  arr[18] = coeffs.p18;
  arr[19] = coeffs.p19;
  arr[20] = coeffs.p20;
  return arr;
}

function buildSolverCores(
  profile: CharacterProfile
): Pick<SolverRunPayload, 'orderCores' | 'chaosCores'> {
  const orderCores: WorkerCore[] = [];
  const chaosCores: WorkerCore[] = [];

  for (const attr of Object.values(ArkGridAttrs)) {
    for (const ctype of Object.values(ArkGridCoreTypes)) {
      const core = profile.cores[attr][ctype];
      const targetCores = attr === '질서' ? orderCores : chaosCores;

      if (!core) {
        targetCores.push({
          energy: 0,
          point: 0,
          coeff: [0],
        });
        continue;
      }

      targetCores.push({
        energy: getDefaultCoreEnergy(core),
        point: core.goalPoint,
        coeff: buildCoreArray(core.coeffs),
      });
    }
  }

  return { orderCores, chaosCores };
}

function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// Given the previously assigned gem objects (per core) and the current gem list,
// produce bitmasks (bit i = gem at index i in currentGems is assigned to this core).
// Matches by fingerprint, consuming one copy per duplicate.
function buildCurrentBitmasks(
  assignedGems: ArkGridGem[][],
  currentGems: ArkGridGem[],
  coreOffset: number
): bigint[] {
  const pool = new Map<string, number[]>();
  currentGems.forEach((gem, idx) => {
    const fp = gemFingerprint(gem);
    if (!pool.has(fp)) pool.set(fp, []);
    pool.get(fp)!.push(idx);
  });

  return [0, 1, 2].map((i) => {
    const gems = assignedGems[coreOffset + i] ?? [];
    let bitmask = 0n;
    for (const gem of gems) {
      const fp = gemFingerprint(gem);
      const indices = pool.get(fp);
      if (indices && indices.length > 0) {
        bitmask |= 1n << BigInt(indices.shift()!);
      }
    }
    return bitmask;
  });
}

// DP knapsack: compute the maximum achievable att/skill/boss for a single core
// without enumerating all C(n,4) GemSet objects.
//
// Constraints (matching getPossibleGemSets):
//   • up to 4 gems per set
//   • sum(req) ≤ core.energy
//   • sum(point) ≥ core.point
//
// dp[k][e][p] = max stat value using exactly k gems with total req=e and total point=p.
// O(n × 4 × E × maxP) per core per stat — microseconds for n≤100.
function computeCoreMaxStat(
  energy: number,
  point: number,
  gems: Array<{ req: number; point: number; value: number }>
): number {
  const maxK = 4;
  const maxP = 25; // 4 gems × max 5 points each = 20; 25 gives a safe margin

  // Use a flat Float64Array for speed.  -1 = unreachable.
  const stride2 = maxP + 1;
  const stride1 = (energy + 1) * stride2;
  const stride0 = (maxK + 1) * stride1;
  const dp = new Float64Array(stride0).fill(-1);
  dp[0] = 0; // dp[k=0][e=0][p=0] = 0

  for (const gem of gems) {
    if (gem.req > energy) continue;
    // Process in reverse k to avoid reusing the same gem (0/1 knapsack).
    for (let k = maxK - 1; k >= 0; k--) {
      for (let e = energy - gem.req; e >= 0; e--) {
        for (let p = 0; p <= maxP; p++) {
          const cur = dp[k * stride1 + e * stride2 + p];
          if (cur < 0) continue;
          const newK = k + 1;
          const newE = e + gem.req;
          const newP = Math.min(p + gem.point, maxP);
          const newVal = cur + gem.value;
          const idx = newK * stride1 + newE * stride2 + newP;
          if (newVal > dp[idx]) dp[idx] = newVal;
        }
      }
    }
  }

  // Valid states: k ≥ (point>0 ? 1 : 0), e ≤ energy, p ≥ point
  let result = 0;
  const startK = point > 0 ? 1 : 0;
  for (let k = startK; k <= maxK; k++) {
    for (let e = 0; e <= energy; e++) {
      for (let p = point; p <= maxP; p++) {
        const v = dp[k * stride1 + e * stride2 + p];
        if (v > result) result = v;
      }
    }
  }
  return result;
}

// Convert ArkGridGem option stats to [att, skill, boss] for a given isSupporter setting.
function gemToStats(
  gem: ArkGridGem,
  isSupporter: boolean
): { att: number; skill: number; boss: number } {
  const optionNames = isSupporter
    ? ['아군 피해 강화', '낙인력', '아군 공격 강화']
    : ['공격력', '추가 피해', '보스 피해'];
  let att = 0, skill = 0, boss = 0;
  for (const opt of [gem.option1, gem.option2]) {
    const idx = optionNames.indexOf(opt.optionType);
    if (idx === 0) att += opt.value;
    else if (idx === 1) skill += opt.value;
    else if (idx === 2) boss += opt.value;
  }
  return { att, skill, boss };
}

// Compute combined attMax/skillMax/bossMax across all 6 cores using DP knapsack.
// Runs in the main thread — no GemSet objects are created.
function computeMaxStats(
  orderCores: WorkerCore[],
  chaosCores: WorkerCore[],
  orderGems: ArkGridGem[],
  chaosGems: ArkGridGem[],
  isSupporter: boolean
): { attMax: number; skillMax: number; bossMax: number } {
  const coreGemPairs: Array<{ core: WorkerCore; gems: ArkGridGem[] }> = [
    ...orderCores.map((c) => ({ core: c, gems: orderGems })),
    ...chaosCores.map((c) => ({ core: c, gems: chaosGems })),
  ];

  let attMax = 0;
  let skillMax = 0;
  let bossMax = 0;

  for (const { core, gems } of coreGemPairs) {
    const attGems = gems.map((g) => ({ req: g.req, point: g.point, value: gemToStats(g, isSupporter).att }));
    const skillGems = gems.map((g) => ({ req: g.req, point: g.point, value: gemToStats(g, isSupporter).skill }));
    const bossGems = gems.map((g) => ({ req: g.req, point: g.point, value: gemToStats(g, isSupporter).boss }));

    attMax += computeCoreMaxStat(core.energy, core.point, attGems);
    skillMax += computeCoreMaxStat(core.energy, core.point, skillGems);
    bossMax += computeCoreMaxStat(core.energy, core.point, bossGems);
  }

  return { attMax, skillMax, bossMax };
}

type Deferred<T> = {
  resolve: (result: T) => void;
  reject: (reason?: unknown) => void;
};

export class SolverController {
  private state: 'idle' | 'running' = 'idle';
  // No persistent worker — we spawn fresh workers per phase and terminate them
  // so the OS reclaims their memory before the next phase starts.
  onProgress: ((progress: SolverProgress) => void) | null = null;

  // Spawn a fresh worker, send one message, resolve with the payload field of the done
  // message or reject on error.  The worker is always terminated before settling.
  private runWorkerForResult(payload: SolverRunPayload): Promise<SolverRunResult> {
    return new Promise<SolverRunResult>((resolve, reject) => {
      const worker = new Worker(new URL('./solverWorker.ts', import.meta.url), { type: 'module' });

      worker.onmessage = (e: MessageEvent<SolverWorkerResponse>) => {
        const data = e.data;
        if (data.type === 'runSolve:progress' || data.type === 'runSolvePhase2Order:progress') {
          this.onProgress?.(data.progress);
          return;
        }
        if (data.type === 'runSolve:done') {
          worker.terminate();
          resolve(data.result);
          return;
        }
        if (data.type === 'runSolve:error') {
          worker.terminate();
          reject(new Error(data.message));
        }
      };

      worker.onerror = (e) => {
        worker.terminate();
        reject(e.error ?? new Error(e.message));
      };

      worker.postMessage({ type: 'runSolve', payload } satisfies SolverWorkerRequest);
    });
  }

  private runWorkerForPhase2Order(payload: SolverRunPayload): Promise<PlainGemSetPack[]> {
    return new Promise<PlainGemSetPack[]>((resolve, reject) => {
      const worker = new Worker(new URL('./solverWorker.ts', import.meta.url), { type: 'module' });

      worker.onmessage = (e: MessageEvent<SolverWorkerResponse>) => {
        const data = e.data;
        if (data.type === 'runSolvePhase2Order:progress') {
          this.onProgress?.(data.progress);
          return;
        }
        if (data.type === 'runSolvePhase2Order:done') {
          worker.terminate();
          resolve(data.gspList);
          return;
        }
        if (data.type === 'runSolvePhase2Order:error') {
          worker.terminate();
          reject(new Error(data.message));
        }
      };

      worker.onerror = (e) => {
        worker.terminate();
        reject(e.error ?? new Error(e.message));
      };

      worker.postMessage({ type: 'runSolvePhase2Order', payload } satisfies SolverWorkerRequest);
    });
  }

  runSolve(profile: CharacterProfile): Promise<SolverRunResult> {
    if (this.state === 'running') {
      throw new Error('busy');
    }
    this.state = 'running';

    return this._runSolve(profile).finally(() => {
      this.state = 'idle';
    });
  }

  private async _runSolve(profile: CharacterProfile): Promise<SolverRunResult> {
    const { orderCores, chaosCores } = buildSolverCores(profile);
    const orderGems = toPlain(profile.gems.orderGems);
    const chaosGems = toPlain(profile.gems.chaosGems);

    // Derive stability tiebreaker bitmasks from the previous combined result.
    // Order cores are at offset 0, chaos cores at offset 3 in assignedGems.
    const prevAssigned = profile.solveInfo.after?.solveAnswer?.assignedGems;
    const orderCurrentBitmasks = prevAssigned
      ? buildCurrentBitmasks(prevAssigned, orderGems, 0)
      : undefined;
    const chaosCurrentBitmasks = prevAssigned
      ? buildCurrentBitmasks(prevAssigned, chaosGems, 3)
      : undefined;

    // Step 1 (main thread): compute attMax/skillMax/bossMax via DP — no GemSet objects created.
    const precomputedStats = computeMaxStats(
      orderCores,
      chaosCores,
      orderGems,
      chaosGems,
      profile.isSupporter
    );

    const basePayload: SolverRunPayload = {
      orderCores,
      chaosCores,
      orderGems,
      chaosGems,
      isSupporter: profile.isSupporter,
      orderCurrentBitmasks,
      chaosCurrentBitmasks,
      precomputedStats,
    };

    // Step 2: Phase-1 worker — builds orderGssList only, runs order Phase 2, terminates.
    // Peak RAM: ~one attr's GemSet list.  After terminate() the OS reclaims that memory
    // before the Phase-2+3 worker starts.
    const orderGspList = await this.runWorkerForPhase2Order(basePayload);

    // Step 3: Phase-2+3 worker — builds chaosGssList only, runs chaos Phase 2,
    // runs Phase 3 cross-product with the received orderGspList, runs launcher sim.
    // Peak RAM: ~one attr's GemSet list + tiny serialized orderGspList.
    return this.runWorkerForResult({
      ...basePayload,
      precalculatedOrderGspList: orderGspList,
    });
  }

  destroy() {
    // No persistent worker to clean up.
    this.state = 'idle';
  }
}

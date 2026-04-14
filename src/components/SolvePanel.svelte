<script lang="ts">
  import { onDestroy } from 'svelte';

  import { type AppLocale, ArkGridAttrs } from '../lib/constants/enums';
  import { ArkGridCoreTypes } from '../lib/models/arkGridCores';
  import type { ArkGridGem } from '../lib/models/arkGridGems';
  import { SolverController } from '../lib/solver/solverController';
  import type { SolverProgress, SolverProgressStage } from '../lib/solver/types';
  import { appLocale } from '../lib/state/locale.state.svelte';
  import {
    type CharacterProfile,
    type SolveAfter,
    updateSolveAfter,
  } from '../lib/state/profile.state.svelte';
  import { gemFingerprint } from '../lib/models/arkGridGems';
  import SolveCoreEdit from './SolveCoreEdit.svelte';
  import SolveResult from './SolveResult/SolveResult.svelte';

  type Props = {
    profile: CharacterProfile;
  };
  type ProgressLogEntry = {
    header: string;
    text: string;
  };
  let { profile = $bindable() }: Props = $props();

  let locale = $derived(appLocale.current);
  const LTitle = $derived(
    {
      ko_kr: '최적화 설정',
      en_us: 'Optimization Settings',
    }[locale]
  );
  const LSubtitle = $derived(
    {
      ko_kr: '코어별 최소 포인트 설정',
      en_us: 'Minimum Core Points',
    }[locale]
  );
  const LRunSolve = $derived(
    {
      ko_kr: '최적화 실행',
      en_us: 'Run Optimization',
    }[locale]
  );
  const LOptimizeHint = $derived(
    {
      ko_kr: '이전 결과가 저장됩니다',
      en_us: 'Previous results are saved',
    }[locale]
  );
  const LOptimizeTooltip = $derived(
    {
      ko_kr: '최적화 결과와 젬 목록의 스냅샷이 저장됩니다. 동점일 경우, 이전 배치에서 젬 이동이 가장 적은 배치를 우선합니다. 이전 스냅샷에 없는 새 젬은 결과에서 금색 테두리로 강조 표시됩니다.',
      en_us: 'Your optimization result and astrogem list are snapshotted. On a tie, the optimizer prefers the assignment that moves the fewest gems from your previous result. Newly added astrogems not present in the previous snapshot are highlighted with a gold border in the results.',
    }[locale]
  );
  const LRunning = $derived(
    {
      ko_kr: '계산 중...',
      en_us: 'Optimizing...',
    }[locale]
  );
  const LProgressTitle = $derived(
    {
      ko_kr: '진행 상황',
      en_us: 'Optimization Progress',
    }[locale]
  );
  const LFailed = $derived(
    {
      ko_kr: '목표 포인트를 조절해보세요.',
      en_us: 'Please adjust the minimum core points.',
    }[locale]
  );
  const LOrderFailed = $derived(
    {
      ko_kr: '질서 배치 실패',
      en_us: 'Order cores optimization failed',
    }[locale]
  );
  const LChaosFailed = $derived(
    {
      ko_kr: '혼돈 배치 실패',
      en_us: 'Chaos cores optimization failed',
    }[locale]
  );

  // Local $state for result — guaranteed to trigger re-renders.
  // Initialized from persisted profile so result survives page reload.
  let solveAfter = $state<SolveAfter | undefined>(profile.solveInfo.after);

  let failedSign = $derived.by(() => {
    if (!solveAfter) return { order: false, chaos: false };
    const answerCores = solveAfter.answerCores;
    const allOrderCoresNull = !answerCores || Object.values(answerCores['질서']).every((v) => v == null);
    const allChaosCoresNull = !answerCores || Object.values(answerCores['혼돈']).every((v) => v == null);
    return {
      order: solveAfter.solveAnswer?.gemSetPackTuple.gsp1 === null && !allOrderCoresNull,
      chaos: solveAfter.solveAnswer?.gemSetPackTuple.gsp2 === null && !allChaosCoresNull,
    };
  });

  const solverController = new SolverController();
  let isSolving = $state(false);
  let solveProgress = $state<SolverProgress | null>(null);
  let progressLog = $state<ProgressLogEntry[]>([]);

  solverController.onProgress = (progress: SolverProgress) => {
    solveProgress = progress;
    const header = getProgressLogKey(progress);
    const text = `${progress.stagePercent}% ${getProgressLabel(progress)}`;
    const index = progressLog.findIndex((entry) => entry.header === header);

    if (index === -1) {
      progressLog = [...progressLog, { header, text }];
      return;
    }

    if (progressLog[index].text === text) {
      return;
    }

    progressLog = progressLog.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, text } : entry
    );
  };

  onDestroy(() => {
    solverController.destroy();
  });

  function buildAssignedGems(
    assignedGemIndexes: number[][],
    snapshot: ArkGridGem[] | undefined
  ): ArkGridGem[][] {
    const orderGems = profile.gems.orderGems;
    const chaosGems = profile.gems.chaosGems;
    const gemPools = [orderGems, orderGems, orderGems, chaosGems, chaosGems, chaosGems];

    // Build a consumable multiset of snapshot fingerprints for isNew detection
    const snapshotCounts = new Map<string, number>();
    if (snapshot) {
      for (const gem of snapshot) {
        const fp = gemFingerprint(gem);
        snapshotCounts.set(fp, (snapshotCounts.get(fp) ?? 0) + 1);
      }
    }

    return assignedGemIndexes.map((indexes, coreIndex) =>
      indexes.map((gemIndex) => {
        const gem = gemPools[coreIndex][gemIndex];
        const fp = gemFingerprint(gem);
        const count = snapshotCounts.get(fp) ?? 0;
        const isNew = !snapshot || count === 0;
        if (count > 0) snapshotCounts.set(fp, count - 1);
        return JSON.parse(JSON.stringify({ ...gem, assign: coreIndex, isNew })) as ArkGridGem;
      })
    );
  }

  function getProgressLabel(progress: SolverProgress | null) {
    if (!progress) {
      return '';
    }

    const LProgressStage: Record<AppLocale, Record<SolverProgressStage, string>> = {
      ko_kr: {
        preparing: '입력 정리 중',
        searching_order_packs: '질서 최적 조합 탐색 중',
        searching_chaos_packs: '혼돈 최적 조합 탐색 중',
        combining_results: '두 조합을 모두 고려하여 최적해 탐색 중',
        simulating_launcher_gems: '젬 추가 시뮬레이션 중',
        finalizing: '결과 정리 중',
      },
      en_us: {
        preparing: 'Preparing inputs',
        searching_order_packs: 'Searching for Order combinations',
        searching_chaos_packs: 'Searching for Chaos combinations',
        combining_results: 'Merging both combinations',
        simulating_launcher_gems: 'Simulating Next Astrogem Preview',
        finalizing: 'Finalizing result',
      },
    };
    const baseLabel = LProgressStage[locale][progress.stage];

    if (progress.stage !== 'simulating_launcher_gems' || !progress.total || !progress.current) {
      return baseLabel;
    }

    const attrLabel = {
      ko_kr: { 질서: '질서', 혼돈: '혼돈' },
      en_us: { 질서: 'Order', 혼돈: 'Chaos' },
    }[locale][progress.attr ?? '질서'];

    return `${baseLabel} (${attrLabel} ${progress.current}/${progress.total})`;
  }

  function getProgressLogKey(progress: SolverProgress | null) {
    if (!progress) return '';
    if (progress.stage !== 'simulating_launcher_gems') return progress.stage;
    return `${progress.stage}:${progress.attr ?? ''}`;
  }

  async function runSolve() {
    if (isSolving) return;

    isSolving = true;
    progressLog = [];
    solveProgress = { stage: 'preparing', totalPercent: 0, stagePercent: 0 };

    try {
      // isNew detection: compare against previously *assigned* gems, not the full pool.
      const previousAssigned = profile.solveInfo.after?.solveAnswer?.assignedGems.flat();

      const result = await solverController.runSolve(profile);

      const after: SolveAfter = {
        solveAnswer: {
          assignedGems: buildAssignedGems(result.assignedGemIndexes, previousAssigned),
          gemSetPackTuple: result.gemSetPackTuple,
        },
        scoreSet: result.scoreSet,
        answerCores: JSON.parse(JSON.stringify(profile.cores)),
        additionalGemResult: result.additionalGemResult,
        needLauncherGem: result.needLauncherGem,
        gemSnapshot: JSON.parse(JSON.stringify([
          ...profile.gems.orderGems,
          ...profile.gems.chaosGems,
        ])),
      };
      updateSolveAfter(after);
      solveAfter = after;
    } catch (error) {
      console.error(error);
    } finally {
      isSolving = false;
      if (solveProgress) {
        solverController.onProgress?.({
          ...solveProgress,
          stage: 'finalizing',
          totalPercent: 100,
          stagePercent: 100,
        });
      }
    }
  }
</script>

<div class="panel">
  <div class="title">{LTitle}</div>
  <div class="container">
    <div class="core-solve-goal-edit">
      <div class="title">{LSubtitle}</div>
      <div class="container">
        {#each Object.values(ArkGridAttrs) as attr}
          {#each Object.values(ArkGridCoreTypes) as ctype}
            <SolveCoreEdit {attr} {ctype} bind:core={profile.cores[attr][ctype]}></SolveCoreEdit>
          {/each}
        {/each}
      </div>
    </div>

    {#if failedSign.order || failedSign.chaos}
      <div class="failed-sign">
        {#if failedSign.order}
          <div class="big">⚠️ {LOrderFailed} ⚠️</div>
        {/if}
        {#if failedSign.chaos}
          <div class="big">⚠️ {LChaosFailed} ⚠️</div>
        {/if}
        <div class="small">{LFailed}</div>
      </div>
    {/if}
    <button
      class="solve-button"
      onclick={runSolve}
      disabled={isSolving}
      data-track="run-solve"
    >
      {isSolving ? LRunning : LRunSolve}
    </button>
    <div class="optimize-hint">
      {LOptimizeHint}
      <span class="tooltip">
        <i class="fa-solid fa-circle-info info-icon"></i>
        <span class="tooltip-text">{LOptimizeTooltip}</span>
      </span>
    </div>

    {#if solveProgress || progressLog.length > 0}
      <div class="solve-progress">
        <div class="title">{LProgressTitle}</div>
        {#if solveProgress}
          <div class="progress-label">
            <span>{getProgressLabel(solveProgress)}</span>
            <span>{solveProgress.stagePercent}%</span>
          </div>
          <div
            class="progress-bar"
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={solveProgress.totalPercent}
          >
            <div class="fill" style={`width: ${solveProgress.totalPercent}%`}></div>
          </div>
        {/if}
        <div class="progress-log">
          {#each progressLog as entry}
            <div class="progress-log-entry">{entry.text}</div>
          {/each}
        </div>
      </div>
    {/if}

    {#if solveAfter}
      <SolveResult solveAfter={solveAfter}></SolveResult>
    {/if}
  </div>
</div>

<style>
  .panel {
    min-height: 60rem;
  }
  .solve-button {
    font-size: 1.5rem;
    width: 15rem;
    height: 4rem;
    align-self: center;
  }
  .optimize-hint {
    font-size: 0.85rem;
    color: var(--text-muted, #888);
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .tooltip {
    position: relative;
    display: inline-block;
  }
  .tooltip-text {
    visibility: hidden;
    position: absolute;
    bottom: 125%;
    left: 50%;
    transform: translateX(-50%);
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    padding: 0.5rem 0.75rem;
    width: 22rem;
    font-size: 0.85rem;
    line-height: 1.4;
    z-index: 10;
    white-space: normal;
  }
  .tooltip:hover .tooltip-text {
    visibility: visible;
  }
  .solve-progress {
    width: min(32rem, 100%);
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .solve-progress > .title {
    font-size: 1rem;
    font-weight: 600;
  }
  .progress-label {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    font-size: 0.95rem;
  }
  .progress-bar {
    width: 100%;
    height: 0.75rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--border) 70%, white);
    overflow: hidden;
  }
  .progress-bar > .fill {
    height: 100%;
    background: linear-gradient(90deg, #2f6fed 0%, #5aa1ff 100%);
    transition: width 160ms ease-out;
  }
  .progress-log {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    max-height: 10rem;
    overflow: auto;
    padding-top: 0.25rem;
    border-top: 1px solid var(--border);
  }
  .progress-log-entry {
    font-size: 0.9rem;
    color: var(--text-muted, inherit);
    line-height: 1.3;
  }

  .panel > .container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
  }

  .core-solve-goal-edit {
    display: flex;
    flex-direction: column;
    gap: 2rem;
    padding: 1rem;
  }
  .core-solve-goal-edit > .title {
    font-size: 1.4rem;
    font-weight: 500;
  }
  .core-solve-goal-edit > .container {
    display: flex;
    flex-direction: row;
    justify-content: space-around;
    flex-wrap: wrap;
    gap: 1rem;
  }
  .failed-sign {
    background: var(--card);
    border-radius: 0.4rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    align-items: center;
  }
  .failed-sign > .big {
    font-weight: 500;
    font-size: 1.2rem;
  }
  .failed-sign > .small {
    font-size: 1rem;
  }
</style>

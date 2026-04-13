<script lang="ts">
  import type { SolveAfter } from '../../lib/state/profile.state.svelte';
  import AdditionalGemResult from './AdditionalGemResult.svelte';
  import CoreGemEquippedList from './CoreGemEquippedList.svelte';
  import GemOptionStats from './GemOptionStats.svelte';
  import ScoreIndicator from './ScoreIndicator.svelte';

  type Props = {
    solveAfter: SolveAfter;
  };
  let { solveAfter }: Props = $props();
</script>

<div class="root">
  <div class="title"></div>
  <div class="container">
    <div class="left">
      {#if solveAfter.scoreSet}
        <ScoreIndicator scoreSet={solveAfter.scoreSet}></ScoreIndicator>
      {/if}
      {#if solveAfter.solveAnswer}
        <GemOptionStats solveAnswer={solveAfter.solveAnswer}></GemOptionStats>
      {/if}
      {#if solveAfter.additionalGemResult && solveAfter.solveAnswer && solveAfter.needLauncherGem}
        <AdditionalGemResult
          additionalGemResult={solveAfter.additionalGemResult}
          solveAnswer={solveAfter.solveAnswer}
          needLauncherGem={solveAfter.needLauncherGem}
        ></AdditionalGemResult>
      {/if}
    </div>
    {#if solveAfter.answerCores && solveAfter.solveAnswer}
      <CoreGemEquippedList answerCores={solveAfter.answerCores} solveAnswer={solveAfter.solveAnswer}
      ></CoreGemEquippedList>
    {/if}
  </div>
</div>

<style>
  .root {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }
  .title {
    text-align: center;
  }
  .container {
    display: flex;
    flex-direction: row;
    gap: 2rem;
    align-items: flex-start;
  }
  .root .title {
    font-size: 1.5rem;
    font-weight: 500;
  }
  .left {
    display: flex;
    flex-direction: column;
    /* justify-content: center; */
    align-items: center;
    gap: 2rem;
    max-width: 20rem;
  }
  @media (max-width: 960px) {
    .container {
      flex-direction: column;
    }
  }
</style>

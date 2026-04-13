<script lang="ts">
  import { type ArkGridAttr, ArkGridAttrs } from '../../lib/constants/enums';
  import {
    type ArkGridCore,
    type ArkGridCoreType,
    ArkGridCoreTypes,
  } from '../../lib/models/arkGridCores';
  import type { SolveAnswer } from '../../lib/state/profile.state.svelte';
  import CoreGemEquipped from './CoreGemEquipped.svelte';

  type Props = {
    answerCores: Record<ArkGridAttr, Record<ArkGridCoreType, ArkGridCore | null>>;
    solveAnswer: SolveAnswer;
  };
  let { answerCores, solveAnswer }: Props = $props();
</script>

<div class="root">
  {#each Object.values(ArkGridAttrs) as attr, i}
    {#each Object.values(ArkGridCoreTypes) as ctype, j}
      <CoreGemEquipped
        {attr}
        {ctype}
        core={answerCores[attr][ctype]}
        gems={solveAnswer.assignedGems[i * 3 + j]}
      ></CoreGemEquipped>
    {/each}
  {/each}
</div>

<style>
  .root {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: center;
    justify-content: center;
  }
</style>

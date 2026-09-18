<script setup lang="ts">
/**
 * The stat-variant DmsKpiCard look for a value that is not a plain number:
 * dms-ui's card only formats numeric values (number / currency / percent),
 * and a session duration reads as "1m 32s", which is none of them. Classes
 * are copied from KpiCard's stat variant so the card sits in the same row
 * without a seam.
 */
defineProps<{ title: string, value: string, icon: string }>()
</script>

<template>
  <DmsCard :padded="false" class="p-4 sm:p-5">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <p class="text-dimmed truncate font-mono text-[10px] font-medium uppercase tracking-widest">
          {{ title }}
        </p>
        <p class="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
          {{ value }}
        </p>
      </div>
      <div class="text-dimmed flex shrink-0 items-center justify-center">
        <UIcon :name="icon" class="size-4" aria-hidden="true" />
      </div>
    </div>
  </DmsCard>
</template>

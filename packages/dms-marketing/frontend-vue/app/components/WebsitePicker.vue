<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '#dms/frontend-module'
import type { ContextWebsite } from '../composables/useMarketingContext'
import { useContextWebsite } from '../composables/useContextWebsite'
import { useMarketingNow } from '../composables/useMarketingNow'
import { installLink } from '../composables/useMarketingRoutes'
import { initials, utcDayStart } from '../utils/format'
import {
  WEBSITE_STATE_DOTS,
  websiteDisplayState,
  websiteStateLine,
  websiteStateShort,
} from '../utils/website-state'
import { MAX_PERIOD_DAYS, MS_PER_DAY, PERIOD_SCOPE } from '../constants'

/**
 * The leading child of an analytics page's toolbar (`marketingToolbar()`):
 * the website picker, its state (a dot and the age of its last event, the
 * full line in a tooltip) and the period's hints. The toolbar puts Direct /
 * Pause and the period after it.
 *
 * The website is the page's `?website=` (`useContextWebsite`): a pick saves
 * it and writes the URL, which the blocks read through a `{{query.website}}`
 * token. The websites' last events are read again on the module's arrivals,
 * through the page's live gate (nothing while paused).
 */
const props = withDefaults(
  defineProps<{
    periodScope?: string
    realtimeTopic?: string
  }>(),
  {
    periodScope: PERIOD_SCOPE,
    realtimeTopic: undefined,
  },
)

/** How often the ages the picker shows ("1 min ago") move: display only. */
const CLOCK_TICK_MS = 15_000

const { t, locale } = useI18n()
const { size } = usePageToolbarSize()
const {
  context,
  failed,
  websites,
  selectedId,
  selected,
  switching,
  select,
  reload,
} = useContextWebsite()

usePageLiveRefresh(() => void reload(), {
  realtimeTopic: props.realtimeTopic,
})

const now = useMarketingNow(CLOCK_TICK_MS)
const period = usePeriodScope(props.periodScope)

/** A custom range longer than the routes read: only its last days are shown. */
const cutHint = computed(() => {
  const range = selected.value ? period.value?.range : null
  if (!range) {
    return ''
  }
  const days = Math.round(
    (range.to.getTime() - range.from.getTime()) / MS_PER_DAY,
  )
  return days > MAX_PERIOD_DAYS
    ? t('page.marketing.context.range_cut', { days: MAX_PERIOD_DAYS })
    : ''
})

const displayState = (site: ContextWebsite) =>
  websiteDisplayState(site, now.value)

const stateLine = (site: ContextWebsite) =>
  websiteStateLine(site, now.value, t, locale.value)

const stateShort = (site: ContextWebsite) =>
  websiteStateShort(site, now.value, t, locale.value)

const websiteItems = computed(() => [
  websites.value.map((site) => ({
    label: site.name,
    description: site.domain,
    type: 'checkbox' as const,
    checked: site.id === selectedId.value,
    slot: 'website' as const,
    site,
    onSelect: () => void select(site.id),
  })),
  [
    {
      label: t('page.marketing.context.add_website'),
      icon: 'i-ph-plus',
      to: installLink(),
    },
  ],
])

/**
 * The statistics are kept per UTC day: where the reader's midnight is not
 * UTC's, the state's tooltip says when their days really start.
 */
const utcHint = computed(() => {
  // The reader's zone: the browser's, which a server render reads from its
  // cookie.
  const time = utcDayStart(now.value, locale.value, readerTimeZone())
  return time ? t('page.marketing.context.utc_days', { time }) : ''
})

/** The full state line and the UTC days: the compact state's name. */
const stateHint = computed(() =>
  selected.value
    ? [stateLine(selected.value), utcHint.value].filter(Boolean).join('. ')
    : '',
)
</script>

<template>
  <USkeleton v-if="!context && !failed" class="h-7 w-72" />
  <!-- One group, tighter than the toolbar's gaps: with the live toggle and
       the period, the bar stays on one line at desktop width. -->
  <div
    v-else-if="selected"
    class="flex min-w-0 flex-wrap items-center gap-2"
    data-website-picker
  >
    <UDropdownMenu :items="websiteItems" :content="{ align: 'start' }">
      <UButton
        color="neutral"
        variant="outline"
        :size="size"
        trailing-icon="i-ph-caret-up-down"
        :loading="switching"
        :aria-label="t('page.marketing.context.switch_website')"
      >
        <span
          class="grid size-5 place-items-center rounded bg-primary/15 font-mono text-[10px] font-semibold text-(--ui-color-primary-800) dark:text-primary"
        >
          {{ initials(selected.name) }}
        </span>
        <span class="font-semibold">{{ selected.name }}</span>
      </UButton>
      <template #website="{ item }">
        <span
          class="grid size-6 shrink-0 place-items-center rounded bg-primary/15 font-mono text-[10px] font-semibold text-(--ui-color-primary-800) dark:text-primary"
        >
          {{ initials(item.site.name) }}
        </span>
        <span class="min-w-0 flex-1 text-left">
          <span class="block truncate text-sm font-medium text-highlighted">
            {{ item.site.name }}
          </span>
          <span class="flex min-w-0 items-center gap-1.5 text-xs text-dimmed">
            <span
              class="size-1.5 shrink-0 rounded-full"
              :class="WEBSITE_STATE_DOTS[displayState(item.site)]"
              aria-hidden="true"
            />
            <span class="truncate font-mono">{{ item.site.domain }}</span>
            <span class="shrink-0">· {{ stateLine(item.site) }}</span>
          </span>
        </span>
        <UIcon
          v-if="item.checked"
          name="i-ph-check"
          class="size-4 shrink-0 text-primary"
        />
      </template>
    </UDropdownMenu>

    <UTooltip>
      <span
        class="flex items-center gap-1.5 text-xs whitespace-nowrap text-muted tabular-nums"
        role="status"
        tabindex="0"
        :aria-label="stateHint"
      >
        <span
          class="size-2 rounded-full"
          :class="WEBSITE_STATE_DOTS[displayState(selected)]"
          aria-hidden="true"
        />
        <span aria-hidden="true">{{ stateShort(selected) }}</span>
      </span>
      <template #content>
        <span class="grid max-w-72 gap-1">
          <span>{{ stateLine(selected) }}</span>
          <span v-if="utcHint" class="text-dimmed">{{ utcHint }}</span>
        </span>
      </template>
    </UTooltip>

    <span
      v-if="cutHint"
      class="flex items-center gap-1 text-xs text-warning"
      role="status"
    >
      <UIcon name="i-ph-warning" class="size-3.5 shrink-0" />
      {{ cutHint }}
    </span>
  </div>
  <span v-else-if="!failed" class="text-sm text-muted">
    {{ t('page.marketing.context.no_website') }}
  </span>
</template>

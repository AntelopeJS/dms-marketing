<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDmsRouter, useI18n } from '#dms/frontend-module'
import { useMarketingApi } from '../composables/useMarketingApi'
import { installLink, overviewLink } from '../composables/useMarketingRoutes'
import { useMarketingNow } from '../composables/useMarketingNow'
import {
  formatNumber,
  formatRelativeTime,
  formatShortDate,
  initials,
} from '../utils/format'
import { allowHostConfirmation, hostConflictOf } from '../utils/host-conflict'
import { websiteCardOf, type WebsiteRow } from '../utils/website-card'
import {
  WEBSITE_STATE_DOTS,
  websiteDisplayState,
  websiteStateLine,
} from '../utils/website-state'
import { requestWebsiteSetting } from '../utils/website-settings'
import { fractionDigits } from '../constants'

/**
 * One card of the Websites page's table (its `card.component`): the site's
 * state, volumes, accepted hosts and capture options; a site still waiting
 * for its first pageview leads to the install guide. Hosts the guard refused
 * show with the fix. A click on the card, or its pencil, opens the site's
 * settings modal (the table's default row action); the snapshot pill opens
 * it on the snapshot switch.
 */
const props = withDefaults(
  defineProps<{
    row: WebsiteRow
    rowId?: string
    selected?: boolean
    open?: () => void
  }>(),
  { rowId: undefined, selected: false, open: undefined },
)

const CLOCK_TICK_MS = 15_000

const { t, locale } = useI18n()
const router = useDmsRouter()
const api = useMarketingApi()
const toast = useToast()
const { confirm } = useConfirm()
const fieldErrors = useFieldErrors({ fields: {} })

const card = computed(() => websiteCardOf(props.row))

const now = useMarketingNow(CLOCK_TICK_MS)
/** The browser's zone, which a server render writes the dates in. */
const readerZone = readerTimeZone()

// \`live\` only while the last event is recent (website-state), as everywhere
// a site's state shows.
const displayState = computed(() => websiteDisplayState(card.value, now.value))
const stateLine = computed(() =>
  websiteStateLine(card.value, now.value, t, locale.value),
)

/** Opens the settings modal, on `setting` when given. */
function edit(setting?: 'snapshots'): void {
  if (setting) {
    requestWebsiteSetting(card.value.id, setting)
  }
  props.open?.()
}

/** A click on the card, outside its own controls, opens the settings. */
function onCardClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null
  if (target?.closest('a, button, input, [role="button"]')) {
    return
  }
  edit()
}

async function openOverview(): Promise<void> {
  await api.selectContextWebsite(card.value.id)
  await router.push(overviewLink(card.value.id))
}

/** The card action running (`resume` or a host), for its spinner. */
const busy = ref<string | null>(null)

async function runCardAction(
  key: string,
  action: () => Promise<unknown>,
  successTitle: string,
  errorTitle: string,
): Promise<void> {
  busy.value = key
  try {
    await action()
    toast.add({ color: 'success', title: successTitle })
    // Its state and counts are the backend's: the page reads them again,
    // the card's spinner on until it shows them.
    await refreshPageBlocks()
  } catch (error) {
    const conflict = hostConflictOf(error)
    if (conflict) {
      toast.add({
        color: 'error',
        title: t(errorTitle),
        description: t('page.marketing.errors.duplicate_host_named', {
          ...conflict,
        }),
      })
    } else {
      fieldErrors.toastError(error, { toastTitle: errorTitle })
    }
  } finally {
    busy.value = null
  }
}

async function allowHost(hostname: string): Promise<void> {
  if (!(await confirm(allowHostConfirmation(t, hostname)))) {
    return
  }
  await runCardAction(
    hostname,
    () => api.allowHost(card.value.id, hostname),
    t('page.marketing.install.allowed', { host: hostname }),
    'page.marketing.install.allow_error',
  )
}

function resume(): Promise<void> {
  return runCardAction(
    'resume',
    () => api.updateWebsite(card.value.id, { trackingEnabled: true }),
    t('page.marketing.websites.resumed'),
    'page.marketing.websites.save_error',
  )
}
</script>

<template>
  <article
    class="@container flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-(--ui-bg) transition-colors"
    :class="[
      card.state === 'waiting'
        ? 'border-dashed border-warning/60'
        : 'dms-card p-0 hover:border-primary/35',
      { 'ring-1 ring-primary': props.selected },
    ]"
    @click="onCardClick"
  >
    <header class="flex items-start gap-3 px-4 pt-4">
      <span
        class="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/15 font-mono text-sm font-semibold text-(--ui-color-primary-800) dark:text-primary"
      >
        {{ initials(card.name) }}
      </span>
      <span class="min-w-0 flex-1">
        <span class="block truncate font-semibold text-highlighted">
          {{ card.name }}
        </span>
        <span class="block truncate font-mono text-xs text-dimmed">
          {{ card.domain }}
        </span>
      </span>
      <UButton
        icon="i-ph-pencil-simple"
        size="xs"
        color="neutral"
        variant="ghost"
        :aria-label="
          t('page.marketing.websites.edit_named', { name: card.name })
        "
        @click="edit()"
      />
    </header>
    <p
      class="flex items-center gap-2 px-4 pt-3 pb-3 font-mono text-xs text-muted"
    >
      <span
        class="size-2 rounded-full"
        :class="WEBSITE_STATE_DOTS[displayState]"
      />
      {{ stateLine }}
    </p>

    <div
      v-if="card.state === 'paused' || card.rejected.length > 0"
      class="flex flex-col gap-2 px-4 pb-3"
    >
      <DmsBanner
        v-if="card.state === 'paused'"
        tone="info"
        size="sm"
        icon="i-ph-pause-circle"
        :title="t('page.marketing.websites.paused_description')"
      >
        <template #actions>
          <UButton
            size="xs"
            color="neutral"
            variant="outline"
            icon="i-ph-play"
            :loading="busy === 'resume'"
            :label="t('page.marketing.websites.resume')"
            @click="resume"
          />
        </template>
      </DmsBanner>
      <DmsBanner
        v-for="refused in card.rejected"
        :key="refused.hostname"
        tone="warning"
        size="sm"
        icon="i-ph-prohibit"
        :title="
          t(
            'page.marketing.websites.refused',
            { count: refused.count, host: refused.hostname },
            refused.count,
          )
        "
      >
        <template #actions>
          <UButton
            size="xs"
            color="neutral"
            variant="outline"
            :loading="busy === refused.hostname"
            :label="t('page.marketing.install.allow')"
            @click="allowHost(refused.hostname)"
          />
        </template>
      </DmsBanner>
    </div>

    <template v-if="card.state !== 'waiting'">
      <div class="border-y border-default">
        <!-- The window the three counts cover, whatever period the other
             pages show. -->
        <p class="px-4 pt-1.5 text-right font-mono text-[10px] text-dimmed">
          {{ t('page.marketing.websites.stats.window') }}
        </p>
        <dl class="grid grid-cols-3">
          <div
            v-for="stat in ['sessions', 'pages', 'funnels'] as const"
            :key="stat"
            class="min-w-0 border-default px-4 pt-0.5 pb-3 not-first:border-l @max-[20rem]:px-3"
          >
            <dt>
              <DmsEyebrow :label="t(`page.marketing.websites.stats.${stat}`)" />
            </dt>
            <dd
              class="mt-1 font-mono text-lg font-semibold tabular-nums text-highlighted @max-[20rem]:text-base"
            >
              {{ formatNumber(card[stat], locale) }}
            </dd>
          </div>
        </dl>
      </div>
      <dl class="flex flex-col gap-2 px-4 py-3 text-sm">
        <div class="flex items-start justify-between gap-3">
          <dt
            class="flex shrink-0 items-center gap-2 whitespace-nowrap text-muted"
          >
            <UIcon name="i-ph-link" class="size-3.5" />
            {{ t('page.marketing.websites.also_accepts') }}
          </dt>
          <dd class="flex min-w-0 flex-wrap justify-end gap-1">
            <span
              v-for="host in card.extraDomains"
              :key="host"
              class="max-w-full truncate rounded bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-toned"
            >
              {{ host }}
            </span>
            <span
              v-if="card.extraDomains.length === 0"
              class="text-xs text-dimmed"
            >
              {{ t('page.marketing.websites.subdomains_only') }}
            </span>
          </dd>
        </div>
        <div
          class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
        >
          <dt
            class="flex shrink-0 items-center gap-2 whitespace-nowrap text-muted"
          >
            <UIcon name="i-ph-camera" class="size-3.5" />
            {{ t('page.marketing.websites.snapshots') }}
          </dt>
          <dd class="ml-auto">
            <button
              type="button"
              class="cursor-pointer rounded-full"
              :title="
                t('page.marketing.websites.snapshots_edit', { name: card.name })
              "
              @click="edit('snapshots')"
            >
              <DmsStatusPill
                size="sm"
                :mono="false"
                :tone="card.snapshotsEnabled ? 'success' : 'neutral'"
                :label="
                  card.snapshotsEnabled
                    ? t(
                        card.snapshotMaskText
                          ? 'page.marketing.websites.snapshots_masked'
                          : 'page.marketing.websites.snapshots_on',
                      )
                    : t('page.marketing.websites.snapshots_off')
                "
              />
            </button>
          </dd>
        </div>
        <div
          class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
        >
          <dt
            class="flex shrink-0 items-center gap-2 whitespace-nowrap text-muted"
          >
            <UIcon name="i-ph-cursor-click" class="size-3.5" />
            {{ t('page.marketing.websites.sampling') }}
          </dt>
          <dd
            class="ml-auto text-right font-mono text-xs whitespace-nowrap text-highlighted"
          >
            {{ formatPercentage(card.sampleRate, locale, fractionDigits(0)) }}
            ·
            {{ t('page.marketing.websites.sampling_default') }}
          </dd>
        </div>
      </dl>
      <footer
        class="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-default px-4 py-3"
      >
        <UButton
          icon="i-ph-code"
          size="sm"
          color="neutral"
          variant="outline"
          :label="t('page.marketing.websites.snippet_button')"
          :aria-label="
            t('page.marketing.websites.snippet_named', { name: card.name })
          "
          :to="installLink(card.id)"
        />
        <UButton
          trailing-icon="i-ph-arrow-right"
          size="sm"
          color="neutral"
          variant="ghost"
          :label="t('page.marketing.websites.open_overview')"
          :aria-label="
            t('page.marketing.websites.open_overview_named', {
              name: card.name,
            })
          "
          @click="openOverview"
        />
      </footer>
    </template>

    <template v-else>
      <p class="px-4 text-sm text-muted">
        {{
          t(
            card.rejected.length > 0
              ? 'page.marketing.websites.waiting_refused'
              : 'page.marketing.websites.waiting_description',
            { date: formatShortDate(card.createdAt, locale, readerZone) },
          )
        }}
      </p>
      <footer class="mt-auto px-4 py-4">
        <UButton
          icon="i-ph-pulse"
          size="sm"
          :label="t('page.marketing.websites.finish_install')"
          :aria-label="
            t('page.marketing.websites.finish_install_named', {
              name: card.name,
            })
          "
          :to="installLink(card.id)"
        />
      </footer>
    </template>
  </article>
</template>

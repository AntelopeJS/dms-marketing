<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useDmsRouter, useI18n } from '#dms/frontend-module'
import {
  useMarketingApi,
  type MarketingWebsiteCard,
} from '../composables/useMarketingApi'
import { installLink, overviewLink } from '../composables/useMarketingRoutes'
import {
  formatNumber,
  formatPercent,
  formatRelativeTime,
  formatShortDate,
  initials,
} from '../utils/format'

/**
 * The Websites page: one card per site with its state, volumes, accepted
 * hosts and capture options; a site still waiting for its first pageview
 * leads to the install guide. The pencil opens a drawer with the site's
 * General, Capture and Danger zone tabs.
 */
const props = withDefaults(
  defineProps<{ fetchUrl?: string; componentId?: string; pageId?: string }>(),
  { fetchUrl: undefined, componentId: undefined, pageId: undefined },
)

type DrawerTab = 'general' | 'capture' | 'danger'

const CLOCK_TICK_MS = 15_000
const PERCENT = 100

const { t, locale } = useI18n()
const router = useDmsRouter()
const api = useMarketingApi()
const toast = useToast()
const { confirm } = useConfirm()

void props

const cards = ref<MarketingWebsiteCard[] | null>(null)
const failed = ref(false)

async function load(): Promise<void> {
  failed.value = false
  try {
    cards.value = await api.listWebsiteCards()
  } catch {
    failed.value = true
  }
}

const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  void load()
  clock = setInterval(() => (now.value = Date.now()), CLOCK_TICK_MS)
})
onBeforeUnmount(() => clock && clearInterval(clock))

function stateLine(card: MarketingWebsiteCard): string {
  if (card.state === 'live' && card.lastActivityAt) {
    return t('page.marketing.context.live', {
      ago: formatRelativeTime(card.lastActivityAt, now.value, locale.value),
    })
  }
  return t(`page.marketing.context.state.${card.state}`)
}

const STATE_DOTS = {
  live: 'bg-success',
  waiting: 'bg-warning',
  paused: 'bg-(--ui-text-dimmed)',
} as const

async function openOverview(card: MarketingWebsiteCard): Promise<void> {
  await api.selectContextWebsite(card.id)
  await router.push(overviewLink())
}

// --- Drawer --------------------------------------------------------------------

const editing = ref<MarketingWebsiteCard | null>(null)
const tab = ref<DrawerTab>('general')
const draftName = ref('')
const draftDomain = ref('')
const draftHosts = ref<string[]>([])
const draftSnapshots = ref(false)
const draftMask = ref(false)
const saving = ref(false)

const drawerOpen = computed({
  get: () => editing.value !== null,
  set: (open: boolean) => {
    if (!open) {
      editing.value = null
    }
  },
})

function edit(
  card: MarketingWebsiteCard,
  initialTab: DrawerTab = 'general',
): void {
  editing.value = card
  tab.value = initialTab
  draftName.value = card.name
  draftDomain.value = card.domain
  draftHosts.value = [...card.extraDomains]
  draftSnapshots.value = card.snapshotsEnabled
  draftMask.value = card.snapshotMaskText
}

const tabItems = computed(() => [
  { value: 'general', label: t('page.marketing.websites.drawer.general') },
  { value: 'capture', label: t('page.marketing.websites.drawer.capture') },
  { value: 'danger', label: t('page.marketing.websites.drawer.danger') },
])

/** Turning snapshots off, or changing the mask, discards the captures. */
const discardsSnapshots = computed(
  () =>
    editing.value !== null &&
    editing.value.snapshots > 0 &&
    (draftSnapshots.value !== editing.value.snapshotsEnabled ||
      draftMask.value !== editing.value.snapshotMaskText),
)

async function save(): Promise<void> {
  const card = editing.value
  if (!card) {
    return
  }
  saving.value = true
  try {
    await api.updateWebsite(card.id, {
      name: draftName.value.trim(),
      domain: draftDomain.value.trim(),
      extraDomains: draftHosts.value.map((host) => host.trim()).filter(Boolean),
      snapshotsEnabled: draftSnapshots.value,
      snapshotMaskText: draftMask.value,
    })
    toast.add({ color: 'success', title: t('page.marketing.websites.saved') })
    editing.value = null
    await load()
  } catch {
    toast.add({
      color: 'error',
      title: t('page.marketing.websites.save_error'),
    })
  } finally {
    saving.value = false
  }
}

async function remove(card: MarketingWebsiteCard): Promise<void> {
  await confirm({
    title: t('page.marketing.websites.delete.title', { name: card.name }),
    description: t('page.marketing.websites.delete.description'),
    color: 'error',
    icon: 'i-ph-trash',
    confirmLabel: t('page.marketing.websites.delete.confirm'),
    confirmText: card.domain,
    impact: [
      {
        icon: 'i-ph-users',
        label: t('page.marketing.websites.delete.sessions'),
        count: formatNumber(card.sessions, locale.value),
      },
      {
        icon: 'i-ph-funnel',
        label: t('page.marketing.websites.delete.funnels'),
        count: card.funnels,
      },
      {
        icon: 'i-ph-camera',
        label: t('page.marketing.websites.delete.snapshots'),
        count: card.snapshots,
      },
    ],
    onConfirm: async () => {
      await api.deleteWebsite(card.id)
      toast.add({
        color: 'success',
        title: t('page.marketing.websites.delete.done', { name: card.name }),
      })
      editing.value = null
      await load()
    },
  })
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <DmsEmptyState
      v-if="failed"
      variant="error"
      class="dms-card"
      :title="t('page.marketing.websites.error')"
    >
      <template #actions>
        <UButton
          size="sm"
          color="neutral"
          variant="outline"
          icon="i-ph-arrow-clockwise"
          :label="t('page.marketing.common.retry')"
          @click="load"
        />
      </template>
    </DmsEmptyState>

    <div v-else-if="!cards" class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <USkeleton v-for="index in 3" :key="index" class="h-72 rounded-xl" />
    </div>

    <DmsMarketingFirstRun v-else-if="cards.length === 0" />

    <div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <article
        v-for="card in cards"
        :key="card.id"
        class="flex flex-col overflow-hidden rounded-xl border bg-(--ui-bg)"
        :class="
          card.state === 'waiting'
            ? 'border-dashed border-warning/60'
            : 'dms-card p-0'
        "
      >
        <header class="flex items-start gap-3 px-4 pt-4">
          <span
            class="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/15 font-mono text-sm font-semibold text-primary"
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
            :aria-label="t('page.marketing.websites.edit')"
            @click="edit(card)"
          />
        </header>
        <p
          class="flex items-center gap-2 px-4 pt-3 pb-3 font-mono text-xs text-muted"
        >
          <span class="size-2 rounded-full" :class="STATE_DOTS[card.state]" />
          {{ stateLine(card) }}
        </p>

        <template v-if="card.state !== 'waiting'">
          <dl class="grid grid-cols-3 border-y border-default">
            <div
              v-for="stat in ['sessions', 'pages', 'funnels'] as const"
              :key="stat"
              class="border-default px-4 py-3 not-first:border-l"
            >
              <dt>
                <DmsEyebrow
                  :label="t(`page.marketing.websites.stats.${stat}`)"
                />
              </dt>
              <dd
                class="mt-1 font-mono text-lg font-semibold tabular-nums text-highlighted"
              >
                {{ formatNumber(card[stat], locale) }}
              </dd>
            </div>
          </dl>
          <dl class="flex flex-col gap-2 px-4 py-3 text-sm">
            <div class="flex items-center justify-between gap-3">
              <dt class="flex items-center gap-2 text-muted">
                <UIcon name="i-ph-link" class="size-3.5" />
                {{ t('page.marketing.websites.also_accepts') }}
              </dt>
              <dd class="flex flex-wrap justify-end gap-1">
                <span
                  v-for="host in card.extraDomains"
                  :key="host"
                  class="rounded bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-toned"
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
            <div class="flex items-center justify-between gap-3">
              <dt class="flex items-center gap-2 text-muted">
                <UIcon name="i-ph-camera" class="size-3.5" />
                {{ t('page.marketing.websites.snapshots') }}
              </dt>
              <dd>
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
              </dd>
            </div>
            <div class="flex items-center justify-between gap-3">
              <dt class="flex items-center gap-2 text-muted">
                <UIcon name="i-ph-cursor-click" class="size-3.5" />
                {{ t('page.marketing.websites.sampling') }}
              </dt>
              <dd class="font-mono text-xs text-highlighted">
                {{ formatPercent(card.sampleRate * PERCENT, locale, 0) }} ·
                {{ t('page.marketing.websites.sampling_default') }}
              </dd>
            </div>
          </dl>
          <footer
            class="mt-auto flex items-center justify-between gap-2 border-t border-default px-4 py-3"
          >
            <UButton
              icon="i-ph-code"
              size="sm"
              color="neutral"
              variant="outline"
              :label="t('page.marketing.websites.snippet_button')"
              :to="installLink(card.id)"
            />
            <UButton
              trailing-icon="i-ph-arrow-right"
              size="sm"
              color="neutral"
              variant="ghost"
              :label="t('page.marketing.websites.open_overview')"
              @click="openOverview(card)"
            />
          </footer>
        </template>

        <template v-else>
          <p class="px-4 text-sm text-muted">
            {{
              t('page.marketing.websites.waiting_description', {
                date: formatShortDate(card.createdAt, locale),
              })
            }}
          </p>
          <DmsBanner
            v-if="card.rejected.length > 0"
            class="mx-4 mt-3"
            tone="warning"
            size="sm"
            :title="
              t(
                'page.marketing.websites.refused',
                {
                  count: card.rejected[0]!.count,
                  host: card.rejected[0]!.hostname,
                },
                card.rejected[0]!.count,
              )
            "
          />
          <footer class="mt-auto px-4 py-4">
            <UButton
              icon="i-ph-pulse"
              size="sm"
              :label="t('page.marketing.websites.finish_install')"
              :to="installLink(card.id)"
            />
          </footer>
        </template>
      </article>
    </div>

    <p
      v-if="cards && cards.length > 0"
      class="flex items-center gap-2 text-xs text-dimmed"
    >
      <UIcon name="i-ph-shield-check" class="size-4" />
      {{ t('page.marketing.websites.privacy') }}
    </p>

    <USlideover
      v-model:open="drawerOpen"
      :title="editing?.name"
      :ui="{ content: 'max-w-lg' }"
    >
      <template #header>
        <div v-if="editing" class="flex flex-col gap-2">
          <DmsEyebrow :label="t('page.marketing.websites.drawer.eyebrow')" />
          <span class="flex items-center gap-3">
            <span
              class="grid size-9 place-items-center rounded-lg bg-primary/15 font-mono text-sm font-semibold text-primary"
            >
              {{ initials(editing.name) }}
            </span>
            <span class="text-xl font-semibold text-highlighted">
              {{ editing.name }}
            </span>
          </span>
          <span class="font-mono text-xs text-dimmed">
            {{ editing.id }} ·
            {{
              t('page.marketing.websites.drawer.added', {
                date: formatShortDate(editing.createdAt, locale),
              })
            }}
          </span>
          <DmsSegmented
            v-model="tab"
            :items="tabItems"
            size="sm"
            class="mt-2 self-start"
          />
        </div>
      </template>
      <template #body>
        <div v-if="editing" class="flex flex-col gap-5">
          <template v-if="tab === 'general'">
            <UFormField
              :label="t('page.marketing.websites.fields.name')"
              required
            >
              <UInput v-model="draftName" class="w-full" />
            </UFormField>
            <UFormField
              :label="t('page.marketing.websites.fields.domain')"
              :description="t('page.marketing.websites.fields.domain_hint')"
              required
            >
              <UInput v-model="draftDomain" class="w-full font-mono" />
            </UFormField>
            <UFormField
              :label="t('page.marketing.websites.fields.hosts')"
              :description="t('page.marketing.websites.fields.hosts_hint')"
            >
              <UInputTags
                v-model="draftHosts"
                class="w-full font-mono"
                :placeholder="'staging.example.com'"
              />
            </UFormField>
          </template>
          <template v-else-if="tab === 'capture'">
            <USwitch
              v-model="draftSnapshots"
              :label="t('page.marketing.websites.fields.snapshots')"
              :description="t('page.marketing.websites.fields.snapshots_hint')"
            />
            <USwitch
              v-model="draftMask"
              :disabled="!draftSnapshots"
              :label="t('page.marketing.websites.fields.mask')"
              :description="t('page.marketing.websites.fields.mask_hint')"
            />
            <DmsBanner
              v-if="discardsSnapshots"
              tone="warning"
              size="sm"
              :title="
                t('page.marketing.websites.fields.discard', {
                  count: editing.snapshots,
                })
              "
            />
          </template>
          <template v-else>
            <div
              class="flex flex-col gap-3 rounded-lg border border-error/40 p-4"
            >
              <span class="text-sm font-semibold text-highlighted">
                {{ t('page.marketing.websites.delete.section') }}
              </span>
              <span class="text-sm text-muted">
                {{ t('page.marketing.websites.delete.section_description') }}
              </span>
              <UButton
                class="self-start"
                color="error"
                variant="outline"
                icon="i-ph-trash"
                :label="t('page.marketing.websites.delete.action')"
                @click="remove(editing)"
              />
            </div>
          </template>
        </div>
      </template>
      <template #footer>
        <div
          v-if="tab !== 'danger'"
          class="flex w-full items-center justify-between"
        >
          <UButton
            color="neutral"
            variant="ghost"
            :label="t('page.marketing.common.cancel')"
            @click="editing = null"
          />
          <UButton
            :loading="saving"
            :label="t('page.marketing.common.save_changes')"
            @click="save"
          />
        </div>
      </template>
    </USlideover>
  </div>
</template>

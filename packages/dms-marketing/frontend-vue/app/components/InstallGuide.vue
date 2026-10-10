<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  useDmsRoute,
  useDmsRouter,
  useDmsRuntimeConfig,
  useI18n,
} from '#dms/frontend-module'
import {
  useMarketingApi,
  type MarketingConnectionStatus,
} from '../composables/useMarketingApi'
import {
  installLink,
  overviewLink,
  websitesLink,
} from '../composables/useMarketingRoutes'
import { trackerSnippet } from '../utils/snippet'

/**
 * The guided install (`?website=` once the site exists): add the website,
 * paste the tag, then a connection check that polls until the first accepted
 * pageview arrives — or names a host the guard refused, with the fix.
 */
const props = withDefaults(
  defineProps<{ componentId?: string; pageId?: string }>(),
  {
    componentId: undefined,
    pageId: undefined,
  },
)

const POLL_MS = 4000

void props

const { t, locale } = useI18n()
const route = useDmsRoute()
const router = useDmsRouter()
const config = useDmsRuntimeConfig()
const api = useMarketingApi()
const toast = useToast()
// A field-tied error from the creation shows under its field, the rest as a toast.
const fieldErrors = useFieldErrors({
  fields: { name: 'install-name', domain: 'install-domain' },
})

const websiteId = ref(
  typeof route.query.website === 'string' ? route.query.website : '',
)
const status = ref<MarketingConnectionStatus | null>(null)
const failed = ref(false)
const listeningSince = ref(Date.now())

// --- Step 1 ----------------------------------------------------------------------

const name = ref('')
const domain = ref('')
const creating = ref(false)

async function createWebsite(): Promise<void> {
  creating.value = true
  try {
    const created = await api.createWebsite({
      name: name.value.trim(),
      domain: domain.value.trim(),
    })
    await api.selectContextWebsite(created._id)
    websiteId.value = created._id
    await router.replace(installLink(created._id))
    await poll()
  } catch (error) {
    await fieldErrors.handleApiError(error, {
      toastTitle: 'page.marketing.install.create_error',
    })
  } finally {
    creating.value = false
  }
}

// --- Step 3: connection check ---------------------------------------------------

let timer: ReturnType<typeof setTimeout> | null = null

async function poll(): Promise<void> {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (!websiteId.value) {
    return
  }
  try {
    status.value = await api.getConnection(websiteId.value)
    failed.value = false
  } catch {
    failed.value = true
  }
  if (!status.value?.visit) {
    timer = setTimeout(() => void poll(), POLL_MS)
  }
}

onMounted(() => void poll())
onBeforeUnmount(() => timer && clearTimeout(timer))

watch(
  () => route.query.website,
  (value) => {
    if (typeof value === 'string' && value !== websiteId.value) {
      websiteId.value = value
      void poll()
    }
  },
)

const website = computed(() => status.value?.website ?? null)
const connected = computed(
  () => status.value?.visit !== null && status.value?.visit !== undefined,
)
const allowing = ref<string | null>(null)

async function allow(hostname: string): Promise<void> {
  allowing.value = hostname
  try {
    await api.allowHost(websiteId.value, hostname)
    toast.add({
      color: 'success',
      title: t('page.marketing.install.allowed', { host: hostname }),
    })
    await poll()
  } catch {
    toast.add({
      color: 'error',
      title: t('page.marketing.install.allow_error'),
    })
  } finally {
    allowing.value = null
  }
}

async function openOverview(): Promise<void> {
  await api.selectContextWebsite(websiteId.value)
  await router.push(overviewLink())
}

function time(at: number): string {
  return new Intl.DateTimeFormat(locale.value, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(at)
}

const siteUrl = computed(() =>
  website.value ? `https://${website.value.domain}` : '',
)

const apiOrigin = computed(() =>
  String((config.public as { dms?: { baseURL?: string } }).dms?.baseURL ?? ''),
)

const developerNote = computed(() =>
  website.value
    ? t('page.marketing.install.developer_note', {
        name: website.value.name,
        domain: website.value.domain,
        snippet: trackerSnippet('html', apiOrigin.value, website.value.id),
      })
    : '',
)

const COPIED_FOR_MS = 1600
const copied = ref(false)

async function copy(text: string): Promise<void> {
  await navigator.clipboard?.writeText(text)
  copied.value = true
  setTimeout(() => (copied.value = false), COPIED_FOR_MS)
}

const RECORDS = ['pageviews', 'clicks', 'snapshots', 'privacy'] as const
const RECORD_ICONS: Record<(typeof RECORDS)[number], string> = {
  pageviews: 'i-ph-eye',
  clicks: 'i-ph-cursor-click',
  snapshots: 'i-ph-camera',
  privacy: 'i-ph-shield-check',
}

const stepTwoState = computed(() =>
  connected.value ? 'done' : websiteId.value ? 'current' : 'next',
)
</script>

<template>
  <div class="flex flex-col gap-4">
    <header class="flex flex-wrap items-start gap-4">
      <UButton
        icon="i-ph-arrow-left"
        color="neutral"
        variant="ghost"
        :to="websitesLink()"
        :aria-label="t('page.marketing.install.back')"
      />
      <div class="min-w-0 flex-1">
        <h1 class="text-2xl font-semibold text-highlighted">
          {{
            website
              ? t('page.marketing.install.title_for', { name: website.name })
              : t('page.marketing.install.title')
          }}
        </h1>
        <p class="mt-1 text-sm text-muted">
          {{ t('page.marketing.install.subtitle') }}
        </p>
      </div>
      <UButton
        v-if="website"
        :icon="copied ? 'i-ph-check' : 'i-ph-paper-plane-tilt'"
        color="neutral"
        variant="outline"
        :label="t('page.marketing.install.copy_instructions')"
        @click="copy(developerNote)"
      />
    </header>

    <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <ol class="dms-card flex flex-col gap-0 p-5">
        <li class="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-3 pb-6">
          <span class="flex flex-col items-center">
            <span
              class="grid size-8 place-items-center rounded-full border font-mono text-xs"
              :class="
                websiteId
                  ? 'border-primary/40 text-primary'
                  : 'border-primary bg-primary text-inverted'
              "
            >
              <UIcon v-if="websiteId" name="i-ph-check" class="size-4" />
              <template v-else>1</template>
            </span>
            <span class="mt-2 w-px flex-1 bg-(--ui-border)" />
          </span>
          <div class="flex flex-col gap-2">
            <h2 class="flex items-center gap-2 font-semibold text-highlighted">
              {{ t('page.marketing.install.step1') }}
              <DmsStatusPill
                v-if="websiteId"
                tone="success"
                size="sm"
                :mono="false"
                :label="t('page.marketing.install.done')"
              />
            </h2>
            <p v-if="website" class="text-sm text-muted">
              <span class="font-semibold text-highlighted">
                {{ website.name }}
              </span>
              ·
              <span class="font-mono">{{ website.domain }}</span>
              {{ t('page.marketing.install.and_subdomains') }}
              <DmsAutoLink
                :to="websitesLink()"
                class="text-primary hover:underline"
              >
                {{ t('page.marketing.common.edit') }}
              </DmsAutoLink>
            </p>
            <form
              v-else
              class="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end"
              @submit.prevent="createWebsite"
            >
              <DmsFieldRow
                layout="stack"
                spacing="list"
                :inset="false"
                label="$page.marketing.websites.fields.name"
                label-for="install-name"
                required
              >
                <UInput
                  id="install-name"
                  v-model="name"
                  class="w-full"
                  placeholder="Acme shop"
                  v-bind="fieldErrors.aria('name')"
                  @update:model-value="fieldErrors.clear('name')"
                />
                <DmsFieldError
                  :id="fieldErrors.errorId('name')"
                  :message="fieldErrors.errors.name"
                />
              </DmsFieldRow>
              <DmsFieldRow
                layout="stack"
                spacing="list"
                :inset="false"
                label="$page.marketing.websites.fields.domain"
                label-for="install-domain"
                required
              >
                <UInput
                  id="install-domain"
                  v-model="domain"
                  class="w-full font-mono"
                  placeholder="shop.example.com"
                  v-bind="fieldErrors.aria('domain')"
                  @update:model-value="fieldErrors.clear('domain')"
                />
                <DmsFieldError
                  :id="fieldErrors.errorId('domain')"
                  :message="fieldErrors.errors.domain"
                />
              </DmsFieldRow>
              <UButton
                type="submit"
                icon="i-ph-plus"
                :loading="creating"
                :disabled="!name.trim() || !domain.trim()"
                :label="t('page.marketing.install.add')"
              />
            </form>
          </div>
        </li>

        <li
          class="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-3 pb-6"
          :class="websiteId ? '' : 'opacity-50'"
        >
          <span class="flex flex-col items-center">
            <span
              class="grid size-8 place-items-center rounded-full border font-mono text-xs"
              :class="
                stepTwoState === 'done'
                  ? 'border-primary/40 text-primary'
                  : stepTwoState === 'current'
                    ? 'border-primary bg-primary text-inverted ring-4 ring-primary/20'
                    : 'border-default text-dimmed'
              "
            >
              <UIcon
                v-if="stepTwoState === 'done'"
                name="i-ph-check"
                class="size-4"
              />
              <template v-else>2</template>
            </span>
            <span class="mt-2 w-px flex-1 bg-(--ui-border)" />
          </span>
          <div class="flex flex-col gap-3">
            <h2 class="font-semibold text-highlighted">
              {{ t('page.marketing.install.step2') }}
            </h2>
            <p class="text-sm text-muted">
              {{ t('page.marketing.install.step2_description') }}
            </p>
            <DmsMarketingTrackerSnippet
              v-if="websiteId"
              :website-id="websiteId"
            />
            <UCollapsible
              v-if="websiteId"
              class="rounded-lg border border-default"
            >
              <UButton
                color="neutral"
                variant="ghost"
                block
                class="justify-start"
                icon="i-ph-sliders-horizontal"
                trailing-icon="i-ph-caret-down"
              >
                <span class="font-medium">
                  {{ t('page.marketing.install.options') }}
                </span>
                <span class="text-xs text-dimmed">
                  {{ t('page.marketing.install.options_hint') }}
                </span>
              </UButton>
              <template #content>
                <dl
                  class="grid grid-cols-[12rem_minmax(0,1fr)] gap-x-4 gap-y-2 px-4 pb-4 text-sm"
                >
                  <dt class="font-mono text-xs text-highlighted">
                    data-heatmap-sample
                  </dt>
                  <dd class="text-muted">
                    {{ t('page.marketing.install.option_sample') }}
                  </dd>
                  <dt class="font-mono text-xs text-highlighted">
                    data-do-not-track
                  </dt>
                  <dd class="text-muted">
                    {{ t('page.marketing.install.option_dnt') }}
                  </dd>
                  <dt class="font-mono text-xs text-highlighted">
                    data-host-url
                  </dt>
                  <dd class="text-muted">
                    {{ t('page.marketing.install.option_host') }}
                  </dd>
                </dl>
              </template>
            </UCollapsible>
          </div>
        </li>

        <li
          class="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-3"
          :class="websiteId ? '' : 'opacity-50'"
        >
          <span class="flex flex-col items-center">
            <span
              class="grid size-8 place-items-center rounded-full border font-mono text-xs"
              :class="
                connected
                  ? 'border-success bg-success text-inverted'
                  : 'border-default text-dimmed'
              "
            >
              <UIcon v-if="connected" name="i-ph-check" class="size-4" />
              <template v-else>3</template>
            </span>
          </span>
          <div class="flex flex-col gap-3">
            <h2 class="font-semibold text-highlighted">
              {{ t('page.marketing.install.step3') }}
            </h2>
            <p class="text-sm text-muted">
              {{ t('page.marketing.install.step3_description') }}
            </p>
            <template v-if="websiteId">
              <div
                v-if="connected && status?.visit"
                class="flex flex-wrap items-center gap-4 rounded-lg border border-success/40 bg-success/10 p-4"
              >
                <DmsIconWell icon="i-ph-check" tone="success" />
                <span class="min-w-0 flex-1">
                  <span class="block font-semibold text-highlighted">
                    {{
                      t('page.marketing.install.connected', {
                        time: time(status.visit.at),
                      })
                    }}
                  </span>
                  <span class="block font-mono text-xs text-muted">
                    {{ status.visit.url }} · {{ status.visit.browser ?? '—' }} ·
                    {{ status.visit.deviceType }}
                  </span>
                </span>
                <UButton
                  trailing-icon="i-ph-arrow-right"
                  :label="t('page.marketing.install.open_overview')"
                  @click="openOverview"
                />
              </div>
              <div
                v-else
                class="flex flex-wrap items-center gap-4 rounded-lg border border-dashed border-primary/50 bg-primary/5 p-4"
              >
                <span
                  class="relative grid size-10 place-items-center rounded-full border border-primary/40 text-primary"
                >
                  <UIcon name="i-ph-broadcast" class="size-5" />
                  <span
                    class="absolute inset-0 animate-ping rounded-full border border-primary/30"
                  />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block font-semibold text-highlighted">
                    {{
                      t('page.marketing.install.listening', {
                        domain: website?.domain ?? '',
                      })
                    }}
                  </span>
                  <span class="block text-xs text-muted">
                    {{
                      t('page.marketing.install.listening_since', {
                        time: time(listeningSince),
                      })
                    }}
                  </span>
                </span>
                <UButton
                  v-if="siteUrl"
                  icon="i-ph-arrow-square-out"
                  color="neutral"
                  variant="outline"
                  :to="siteUrl"
                  target="_blank"
                  :label="t('page.marketing.install.open_site')"
                />
              </div>
              <div
                v-for="refused in status?.rejected ?? []"
                :key="refused.hostname"
                class="flex flex-wrap items-center gap-4 rounded-lg border border-error/40 bg-error/10 p-4"
              >
                <DmsIconWell icon="i-ph-prohibit" tone="error" />
                <span class="min-w-0 flex-1">
                  <span class="block font-semibold text-highlighted">
                    {{
                      t(
                        'page.marketing.install.refused',
                        { count: refused.count, host: refused.hostname },
                        refused.count,
                      )
                    }}
                  </span>
                  <span class="block text-xs text-muted">
                    {{ t('page.marketing.install.refused_hint') }}
                  </span>
                </span>
                <UButton
                  color="neutral"
                  variant="outline"
                  :loading="allowing === refused.hostname"
                  :label="t('page.marketing.install.allow')"
                  @click="allow(refused.hostname)"
                />
              </div>
              <p v-if="failed" class="text-xs text-error">
                {{ t('page.marketing.install.poll_error') }}
              </p>
            </template>
          </div>
        </li>
      </ol>

      <aside class="flex flex-col gap-4">
        <section class="dms-card p-0">
          <header class="border-b border-default px-4 py-3">
            <DmsEyebrow :label="t('page.marketing.install.records_title')" />
          </header>
          <ul class="divide-y divide-default">
            <li
              v-for="record in RECORDS"
              :key="record"
              class="flex gap-3 px-4 py-3"
            >
              <UIcon
                :name="RECORD_ICONS[record]"
                class="mt-0.5 size-4 shrink-0 text-primary"
              />
              <span>
                <span class="block text-sm font-medium text-highlighted">
                  {{ t(`page.marketing.install.records.${record}`) }}
                </span>
                <span class="block text-xs text-muted">
                  {{ t(`page.marketing.install.records.${record}_hint`) }}
                </span>
              </span>
            </li>
          </ul>
        </section>
        <section class="dms-card p-0">
          <header class="border-b border-default px-4 py-3">
            <DmsEyebrow :label="t('page.marketing.install.live_title')" />
          </header>
          <div class="flex flex-col gap-2 p-4">
            <p class="text-sm text-muted">
              {{ t('page.marketing.install.live_description') }}
            </p>
            <code
              class="rounded-lg border border-default px-3 py-2 font-mono text-xs text-toned"
            >
              dmsMarketing?.track("quote_requested")
            </code>
          </div>
        </section>
      </aside>
    </div>
  </div>
</template>

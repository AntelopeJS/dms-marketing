<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useDmsRoute, useDmsRouter, useI18n } from '#dms/frontend-module'
import {
  useMarketingApi,
  type MarketingPurgeScope,
} from '../composables/useMarketingApi'
import {
  websiteSettingOf,
  type WebsiteSetting,
} from '../composables/useMarketingRoutes'
import { useWebsiteDeletionImpactRead } from '../composables/useMarketingReads'
import { formatNumber, formatShortDate, initials } from '../utils/format'
import { hostConflictOf } from '../utils/host-conflict'
import { snapshotDiscardConfirmation } from '../utils/snapshot-options'
import { websiteCardOf, type WebsiteRow } from '../utils/website-card'
import { websitePurgeImpact, websitePurgeResult } from '../utils/website-purge'
import {
  blankRequiredFields,
  draftAsksBeforeSaving,
  draftDiscardsSnapshots,
  isWebsiteDraftDirty,
  takeWebsiteSetting,
  websiteDraftOf,
  websitePatchOf,
  type WebsiteSettingsTab,
} from '../utils/website-settings'
import {
  MAX_WEBSITE_DOMAIN_LENGTH,
  MAX_WEBSITE_NAME_LENGTH,
} from '../constants'

/**
 * The settings of one website, in the modal the Websites table opens on a
 * row (a click on its card, its pencil, `?record=<id>`): General (name,
 * hosts, tracking and page snapshots) and Danger zone tabs: purge the
 * heatmaps or all the data, delete the site (never the dashboard's own,
 * which the backend refuses too). Opened on a setting (the snapshot pill,
 * `&setting=snapshots`), it scrolls to it. Saving, purging or deleting
 * closes it and reads the table again.
 */
const props = withDefaults(
  defineProps<{
    rowData?: WebsiteRow
    containerId?: string
    onSuccessCallback?: () => void
  }>(),
  { rowData: undefined, containerId: undefined, onSuccessCallback: undefined },
)

const emit = defineEmits<{ success: [] }>()

const { t, locale } = useI18n()
const route = useDmsRoute()
const router = useDmsRouter()
const api = useMarketingApi()
const toast = useToast()
const { confirm } = useConfirm()
// A field-tied error from the save shows under its field, the rest as a toast.
const fieldErrors = useFieldErrors({
  fields: {
    name: 'website-name',
    domain: 'website-domain',
    extraDomains: 'website-hosts',
  },
})

const card = computed(() => websiteCardOf(props.rowData ?? {}))
const tab = ref<WebsiteSettingsTab>('general')
const draft = ref(websiteDraftOf(card.value))
const saving = ref(false)

/** Saved or deleted: nothing is left to lose, the guard steps aside. */
const settled = ref(false)
// Closing with changes not saved (X, Escape, Cancel, leaving) asks first.
const { confirmLeave } = useUnsavedChanges({
  dirty: () => !settled.value && isWebsiteDraftDirty(card.value, draft.value),
  containerId: () => props.containerId,
})

async function cancel(): Promise<void> {
  if (await confirmLeave()) {
    settled.value = true
    emit('success')
  }
}

/** Control of each setting a link can scroll the modal to. */
const SETTING_CONTROL_IDS: Record<WebsiteSetting, string> = {
  snapshots: 'website-snapshots',
}

/** Waits for the modal to render the row, then brings it into view. */
async function scrollToSetting(setting: WebsiteSetting): Promise<void> {
  await nextTick()
  requestAnimationFrame(() => {
    document
      .getElementById(SETTING_CONTROL_IDS[setting])
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  })
}

// Asked by the card (its snapshot pill) or by the link that opened the
// modal; the link's key then leaves the URL, so a reload opens the modal
// without scrolling it again. `record` stays: the table owns it.
onMounted(() => {
  const fromLink = websiteSettingOf(route.query)
  const setting = takeWebsiteSetting(card.value.id) ?? fromLink
  if (setting) {
    void scrollToSetting(setting)
  }
  if (fromLink) {
    const { setting: _setting, ...rest } = route.query
    void router.replace({ query: rest })
  }
})

const tabItems = computed(() => [
  { value: 'general', label: t('page.marketing.websites.modal.general') },
  { value: 'danger', label: t('page.marketing.websites.modal.danger') },
])

/** Turning snapshots off, or changing the mask, discards the captures. */
const discardsSnapshots = computed(() =>
  draftDiscardsSnapshots(card.value, draft.value),
)

/** Empty required fields say so under themselves, on the General tab. */
async function requireFields(): Promise<boolean> {
  const blank = blankRequiredFields(draft.value)
  if (blank.length > 0) {
    tab.value = 'general'
  }
  for (const field of blank) {
    await fieldErrors.setError(field, t('dms.field_errors.required'))
  }
  return blank.length === 0
}

/**
 * The banner warns; saving asks. Declining puts the snapshot switches back
 * and saves nothing, so the modal stays open on the rest of the draft.
 */
async function confirmSnapshotDiscard(): Promise<boolean> {
  if (!draftAsksBeforeSaving(card.value, draft.value)) {
    return true
  }
  if (await confirm(snapshotDiscardConfirmation(t, card.value.snapshots))) {
    return true
  }
  draft.value.snapshots = card.value.snapshotsEnabled
  draft.value.mask = card.value.snapshotMaskText
  return false
}

/** Closes the modal and reads the table again. */
function done(): void {
  settled.value = true
  if (props.onSuccessCallback) {
    props.onSuccessCallback()
  } else {
    emit('success')
    refreshPageBlocks()
  }
}

async function save(): Promise<void> {
  fieldErrors.clear()
  if (!(await requireFields()) || !(await confirmSnapshotDiscard())) {
    return
  }
  saving.value = true
  try {
    await api.updateWebsite(card.value.id, websitePatchOf(draft.value))
    toast.add({ color: 'success', title: t('page.marketing.websites.saved') })
    done()
  } catch (error) {
    // A refused field lives on the General tab: show it there.
    const conflict = hostConflictOf(error)
    if (conflict) {
      tab.value = 'general'
      await fieldErrors.setError(
        conflict.field === 'extraDomains' ? 'extraDomains' : 'domain',
        t('page.marketing.errors.duplicate_host_named', { ...conflict }),
      )
      return
    }
    if (await fieldErrors.applyApiError(error)) {
      tab.value = 'general'
      return
    }
    fieldErrors.toastError(error, {
      toastTitle: 'page.marketing.websites.save_error',
    })
  } finally {
    saving.value = false
  }
}

/** The purges the danger zone offers, the narrower first. */
const PURGE_SCOPES: readonly MarketingPurgeScope[] = ['heatmaps', 'all']

/** The website a deletion or a purge is asked about. */
const deletionTarget = computed(() => card.value.id)
const readDeletionImpact = useWebsiteDeletionImpactRead(deletionTarget)

/** The scope a purge is running for: its button spins. */
const purging = ref<MarketingPurgeScope | null>(null)

/**
 * Purges the heatmaps or all the data of the site, which stays with its
 * settings and funnels. The dialog counts what the scope deletes, and the
 * domain typed confirms it.
 */
async function purge(scope: MarketingPurgeScope): Promise<void> {
  const website = card.value
  let impact
  purging.value = scope
  try {
    impact = await readDeletionImpact()
  } catch (error) {
    fieldErrors.toastError(error, {
      toastTitle: 'page.marketing.websites.delete.impact_error',
    })
    return
  } finally {
    purging.value = null
  }
  await confirm({
    title: t(`page.marketing.websites.purge.${scope}_title`, {
      name: website.name,
    }),
    description: t(`page.marketing.websites.purge.${scope}_description`),
    color: 'error',
    icon: 'i-ph-eraser',
    confirmLabel: t(`page.marketing.websites.purge.${scope}_confirm`),
    // A hostname is not case-sensitive: neither is the typed check.
    confirmText: website.domain,
    confirmTextCaseInsensitive: true,
    impact: websitePurgeImpact(scope, impact, t, locale.value),
    onConfirm: async () => {
      purging.value = scope
      try {
        const answer = await api.purgeWebsite(website.id, scope)
        toast.add({
          color: 'success',
          title: t(`page.marketing.websites.purge.${scope}_done`, {
            name: website.name,
          }),
          description: websitePurgeResult(answer, t, locale.value),
        })
        done()
      } finally {
        purging.value = null
      }
    },
  })
}

async function remove(): Promise<void> {
  const website = card.value
  // The backend refuses it too (409): the button is disabled.
  if (website.dashboard) {
    return
  }
  let impact
  try {
    impact = await readDeletionImpact()
  } catch (error) {
    fieldErrors.toastError(error, {
      toastTitle: 'page.marketing.websites.delete.impact_error',
    })
    return
  }
  // Every stored day goes, so the counts read "since the oldest one".
  const since =
    impact.since === null ? null : formatShortDate(impact.since, locale.value)
  const sinceLabel = (key: 'sessions' | 'pageviews') =>
    since === null
      ? t(`page.marketing.websites.delete.${key}`)
      : t(`page.marketing.websites.delete.${key}_since`, { date: since })
  await confirm({
    title: t('page.marketing.websites.delete.title', { name: website.name }),
    description: t('page.marketing.websites.delete.description'),
    color: 'error',
    icon: 'i-ph-trash',
    confirmLabel: t('page.marketing.websites.delete.confirm'),
    // A hostname is not case-sensitive: neither is the typed check.
    confirmText: website.domain,
    confirmTextCaseInsensitive: true,
    impact: [
      {
        icon: 'i-ph-users',
        label: sinceLabel('sessions'),
        count: formatNumber(impact.sessions, locale.value),
      },
      {
        icon: 'i-ph-eye',
        label: sinceLabel('pageviews'),
        count: formatNumber(impact.pageviews, locale.value),
      },
      {
        icon: 'i-ph-funnel',
        label: t('page.marketing.websites.delete.funnels'),
        count: impact.funnels,
      },
      {
        icon: 'i-ph-camera',
        label: t('page.marketing.websites.delete.snapshots'),
        count: impact.snapshots,
      },
    ],
    onConfirm: async () => {
      await api.deleteWebsite(website.id)
      toast.add({
        color: 'success',
        title: t('page.marketing.websites.delete.done', { name: website.name }),
      })
      done()
    },
  })
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <header class="flex min-w-0 items-center gap-3">
      <span
        class="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/15 font-mono text-sm font-semibold text-(--ui-color-primary-800) dark:text-primary"
      >
        {{ initials(card.name) }}
      </span>
      <span class="flex min-w-0 flex-col">
        <span class="truncate text-lg font-semibold text-highlighted">
          {{ card.name }}
        </span>
        <span class="font-mono text-xs break-all text-dimmed">
          {{ card.id }} ·
          {{
            t('page.marketing.websites.modal.added', {
              date: formatShortDate(card.createdAt, locale),
            })
          }}
        </span>
      </span>
    </header>

    <DmsSegmented
      v-model="tab"
      :items="tabItems"
      size="sm"
      class="self-start"
    />

    <template v-if="tab === 'general'">
      <div class="grid gap-x-6 gap-y-1 md:grid-cols-2">
        <DmsFieldRow
          layout="stack"
          spacing="list"
          :inset="false"
          label="$page.marketing.websites.fields.name"
          label-for="website-name"
          required
        >
          <UInput
            id="website-name"
            v-model="draft.name"
            class="w-full"
            :maxlength="MAX_WEBSITE_NAME_LENGTH"
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
          description="$page.marketing.websites.fields.domain_hint"
          label-for="website-domain"
          required
        >
          <UInput
            id="website-domain"
            v-model="draft.domain"
            class="w-full font-mono"
            :maxlength="MAX_WEBSITE_DOMAIN_LENGTH"
            v-bind="fieldErrors.aria('domain')"
            @update:model-value="fieldErrors.clear('domain')"
          />
          <DmsFieldError
            :id="fieldErrors.errorId('domain')"
            :message="fieldErrors.errors.domain"
          />
        </DmsFieldRow>
      </div>
      <DmsFieldRow
        layout="stack"
        spacing="list"
        :inset="false"
        label="$page.marketing.websites.fields.hosts"
        description="$page.marketing.websites.fields.hosts_hint"
        label-for="website-hosts"
      >
        <UInputTags
          id="website-hosts"
          v-model="draft.hosts"
          class="w-full font-mono"
          :placeholder="'staging.example.com'"
          v-bind="fieldErrors.aria('extraDomains')"
          @update:model-value="fieldErrors.clear('extraDomains')"
        />
        <DmsFieldError
          :id="fieldErrors.errorId('extraDomains')"
          :message="fieldErrors.errors.extraDomains"
        />
      </DmsFieldRow>
      <DmsFieldRow
        spacing="list"
        :inset="false"
        label="$page.marketing.websites.fields.tracking"
        description="$page.marketing.websites.fields.tracking_hint"
        label-for="website-tracking"
      >
        <USwitch id="website-tracking" v-model="draft.tracking" />
      </DmsFieldRow>
      <DmsFieldRow
        spacing="list"
        :inset="false"
        label="$page.marketing.websites.fields.snapshots"
        description="$page.marketing.websites.fields.snapshots_hint"
        label-for="website-snapshots"
      >
        <USwitch id="website-snapshots" v-model="draft.snapshots" />
      </DmsFieldRow>
      <DmsFieldRow
        spacing="list"
        :inset="false"
        label="$page.marketing.websites.fields.mask"
        description="$page.marketing.websites.fields.mask_hint"
        label-for="website-mask"
        :disabled="!draft.snapshots"
      >
        <USwitch
          id="website-mask"
          v-model="draft.mask"
          :disabled="!draft.snapshots"
        />
      </DmsFieldRow>
      <DmsBanner
        v-if="discardsSnapshots"
        tone="warning"
        size="sm"
        :title="
          t(
            'page.marketing.websites.fields.discard',
            { count: card.snapshots },
            card.snapshots,
          )
        "
      />
      <DmsFormRequiredLegend />
    </template>
    <div v-else class="flex flex-col gap-4">
      <section
        class="flex flex-col gap-3 rounded-lg border border-warning/40 p-4"
      >
        <span class="text-sm font-semibold text-highlighted">
          {{ t('page.marketing.websites.purge.section') }}
        </span>
        <span class="text-sm text-muted">
          {{ t('page.marketing.websites.purge.section_description') }}
        </span>
        <div
          v-for="scope in PURGE_SCOPES"
          :key="scope"
          class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-default pt-3"
        >
          <span class="min-w-0 flex-1 basis-64 text-sm text-muted">
            {{ t(`page.marketing.websites.purge.${scope}_hint`) }}
          </span>
          <UButton
            color="error"
            variant="outline"
            icon="i-ph-eraser"
            :loading="purging === scope"
            :disabled="purging !== null && purging !== scope"
            :label="t(`page.marketing.websites.purge.${scope}_action`)"
            @click="purge(scope)"
          />
        </div>
      </section>
      <section
        class="flex flex-col gap-3 rounded-lg border border-error/40 p-4"
      >
        <span class="text-sm font-semibold text-highlighted">
          {{ t('page.marketing.websites.delete.section') }}
        </span>
        <span class="text-sm text-muted">
          {{
            card.dashboard
              ? t('page.marketing.websites.delete.dashboard_kept')
              : t('page.marketing.websites.delete.section_description')
          }}
        </span>
        <UButton
          class="self-start"
          color="error"
          variant="outline"
          icon="i-ph-trash"
          :disabled="card.dashboard"
          :label="t('page.marketing.websites.delete.action')"
          @click="remove"
        />
      </section>
    </div>

    <footer
      v-if="tab !== 'danger'"
      class="flex items-center justify-end gap-2 border-t border-default pt-4"
    >
      <UButton
        color="neutral"
        variant="ghost"
        :label="t('page.marketing.common.cancel')"
        @click="cancel"
      />
      <UButton
        :loading="saving"
        :label="t('page.marketing.common.save_changes')"
        @click="save"
      />
    </footer>
  </div>
</template>

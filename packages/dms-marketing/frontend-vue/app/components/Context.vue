<script setup lang="ts">
import { provide, watch } from 'vue'
import { useDmsRoute, useDmsRouter, useI18n } from '#dms/frontend-module'
import { MARKETING_CONTEXT_KEY } from '../composables/useMarketingContext'
import { useContextWebsite } from '../composables/useContextWebsite'
import { installLink } from '../composables/useMarketingRoutes'

/**
 * The gate in front of the blocks of every analytics page. The page's
 * toolbar (`marketingToolbar()`, declared by the page) picks the website and
 * the period; this gate renders the blocks once the URL names the website.
 *
 * The page URL is the context: a reload, a copied link or Back opens on what
 * it names, and each tab keeps its own. The period is the DMS
 * `PeriodSelector` of the toolbar, publishing under the scope every block of
 * the page binds to. The website is the module's own (`?website=`): the
 * blocks read it through a `{{query.website}}` token, so a switch reads them
 * again. What the URL leaves out comes from the reader's last explicit pick:
 * the website saved server-side. Only a pick writes the website, so opening a
 * link never moves another tab.
 *
 * Its children render once the URL names one of the tenant's websites; with
 * no website at all the first-run hero takes their place, and with
 * `waitingGuide` a website still waiting for its first event shows the way
 * to its install guide instead. A server render reads the context first: a
 * URL naming no website (or one the tenant does not have) is redirected to
 * the one saved, and the page renders on it.
 */
// The gate comes first under the page toolbar. The DMS page stack sets its
// items 24px apart (space-y-6); `-mt-2` keeps the 16px the analytics pages
// had when the bar was drawn in this gate (gap-4).
const props = withDefaults(defineProps<{ waitingGuide?: boolean }>(), {
  waitingGuide: false,
})

const { t } = useI18n()
const route = useDmsRoute()
const router = useDmsRouter()
const {
  context,
  failed,
  websites,
  linkedId,
  selectedId,
  selected,
  select,
  reload,
  ready,
} = useContextWebsite()

// The URL names no website, or one the tenant does not have: fill in the
// saved one, without a history entry (a server render redirects to it).
// Watched with the query too, so a block rewriting the URL for its own state
// (the heatmap path) keeps it. Set up once the context is read.
await ready
watch(
  [selectedId, () => route.query],
  ([id]) => {
    if (id && route.query.website !== id) {
      void router.replace({ query: { ...route.query, website: id } })
    }
  },
  { immediate: true },
)

provide(MARKETING_CONTEXT_KEY, {
  websites,
  selected,
  select,
  reload,
})
</script>

<template>
  <div class="-mt-2 flex flex-col gap-4">
    <DmsEmptyState
      v-if="failed"
      variant="error"
      :title="t('page.marketing.context.error.title')"
      :description="t('page.marketing.context.error.description')"
      class="dms-card"
    >
      <template #actions>
        <UButton
          icon="i-ph-arrow-clockwise"
          color="neutral"
          variant="outline"
          size="sm"
          :label="t('page.marketing.common.retry')"
          @click="reload"
        />
      </template>
    </DmsEmptyState>

    <DmsMarketingFirstRun v-else-if="context && websites.length === 0" />

    <DmsEmptyState
      v-else-if="
        props.waitingGuide && linkedId && selected?.state === 'waiting'
      "
      icon="i-ph-plugs"
      :title="
        t('page.marketing.context.waiting_guide.title', { name: selected.name })
      "
      :description="t('page.marketing.context.waiting_guide.description')"
      class="dms-card"
    >
      <template #actions>
        <UButton
          icon="i-ph-book-open-text"
          size="sm"
          :label="t('page.marketing.context.waiting_guide.action')"
          @click="router.push(installLink(selected.id))"
        />
      </template>
    </DmsEmptyState>

    <slot v-else-if="linkedId" />

    <div v-else class="grid gap-4 md:grid-cols-4">
      <USkeleton v-for="index in 4" :key="index" class="h-28 rounded-xl" />
      <USkeleton class="h-72 rounded-xl md:col-span-4" />
    </div>
  </div>
</template>

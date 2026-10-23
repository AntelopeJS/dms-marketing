<script setup lang="ts">
import { ref } from 'vue'
import { useDmsRouter, useI18n } from '#dms/frontend-module'
import { useMarketingApi } from '../composables/useMarketingApi'
import { installLink } from '../composables/useMarketingRoutes'
import { hostConflictOf } from '../utils/host-conflict'
import { blankRequiredFields } from '../utils/website-settings'
import {
  MAX_WEBSITE_DOMAIN_LENGTH,
  MAX_WEBSITE_NAME_LENGTH,
} from '../constants'

/**
 * "Add a website", in the modal the Websites page's header button opens:
 * the site's name and domain. Once created, the site becomes the context's
 * and the install guide opens on it, at the tag to paste.
 */
const props = withDefaults(defineProps<{ containerId?: string }>(), {
  containerId: undefined,
})

const emit = defineEmits<{ success: [] }>()

const { t } = useI18n()
const router = useDmsRouter()
const api = useMarketingApi()
// A field-tied error from the creation shows under its field, the rest as a toast.
const fieldErrors = useFieldErrors({
  fields: { name: 'website-create-name', domain: 'website-create-domain' },
})

const name = ref('')
const domain = ref('')
const creating = ref(false)
/** Created: leaving for the install guide loses nothing. */
const created = ref(false)

const { confirmLeave } = useUnsavedChanges({
  dirty: () => !created.value && !!(name.value.trim() || domain.value.trim()),
  containerId: () => props.containerId,
})

/** Empty required fields say so under themselves. */
async function requireFields(): Promise<boolean> {
  const blank = blankRequiredFields({ name: name.value, domain: domain.value })
  for (const field of blank) {
    await fieldErrors.setError(field, t('dms.field_errors.required'))
  }
  return blank.length === 0
}

async function create(): Promise<void> {
  fieldErrors.clear()
  if (!(await requireFields())) {
    return
  }
  creating.value = true
  try {
    const website = await api.createWebsite({
      name: name.value.trim(),
      domain: domain.value.trim(),
    })
    created.value = true
    await api.selectContextWebsite(website._id)
    // Another page: the modal closes on its own.
    await router.push(installLink(website._id))
  } catch (error) {
    const conflict = hostConflictOf(error)
    if (conflict) {
      await fieldErrors.setError(
        'domain',
        t('page.marketing.errors.duplicate_host_named', { ...conflict }),
      )
      return
    }
    await fieldErrors.handleApiError(error, {
      toastTitle: 'page.marketing.install.create_error',
    })
  } finally {
    creating.value = false
  }
}

async function cancel(): Promise<void> {
  if (await confirmLeave()) {
    created.value = true
    emit('success')
  }
}
</script>

<template>
  <form class="flex flex-col gap-4" novalidate @submit.prevent="create">
    <div class="grid gap-x-6 gap-y-1 md:grid-cols-2">
      <DmsFieldRow
        layout="stack"
        spacing="list"
        :inset="false"
        label="$page.marketing.websites.fields.name"
        label-for="website-create-name"
        required
      >
        <UInput
          id="website-create-name"
          v-model="name"
          class="w-full"
          placeholder="Acme shop"
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
        label-for="website-create-domain"
        required
      >
        <UInput
          id="website-create-domain"
          v-model="domain"
          class="w-full font-mono"
          placeholder="shop.example.com"
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
    <DmsFormRequiredLegend />
    <footer
      class="flex items-center justify-end gap-2 border-t border-default pt-4"
    >
      <UButton
        color="neutral"
        variant="ghost"
        :label="t('page.marketing.common.cancel')"
        @click="cancel"
      />
      <UButton
        type="submit"
        icon="i-ph-plus"
        :loading="creating"
        :label="t('page.marketing.install.add')"
      />
    </footer>
  </form>
</template>

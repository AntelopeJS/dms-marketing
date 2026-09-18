import { useI18n } from '#dms/frontend-module'
import TrackerSnippet from '../components/TrackerSnippet.vue'
import { dmsComponent } from '../utils/dmsComponent'
import type { MarketingWebsite } from './useMarketingApi'

const WEBSITES_URL = '/api/marketing/websites'

const WEBSITE_FORM_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    domain: { type: 'string', minLength: 1, maxLength: 253 },
  },
  required: ['name', 'domain'],
}

const WEBSITE_FORM_FIELDS = [
  {
    id: 'name',
    label: '$page.marketing.websites.column.name',
    required: true,
    component: {
      componentName: 'dms-input-text',
      options: { placeholder: '$page.marketing.websites.form.name' },
    },
  },
  {
    id: 'domain',
    label: '$page.marketing.websites.column.domain',
    description: '$page.marketing.websites.form.domain_description',
    required: true,
    component: {
      componentName: 'dms-input-text',
      options: { placeholder: '$page.marketing.websites.form.domain' },
    },
  },
]

export function useMarketingWebsiteForm() {
  const modal = useModal()
  const { t } = useI18n()

  function openCreate(): Promise<MarketingWebsite | undefined> {
    const instance = modal.open<MarketingWebsite | undefined>({
      title: t('page.marketing.websites.create_title'),
      component: dmsComponent('dms-form'),
      componentOptions: {
        fields: WEBSITE_FORM_FIELDS,
        schema: WEBSITE_FORM_SCHEMA,
        submitUrl: WEBSITES_URL,
        submitUrlMethod: 'POST',
        onSuccessCallback: (response?: unknown) => {
          instance.close(response as MarketingWebsite)
        },
      },
    })
    return instance.result
  }

  function openSnippet(website: MarketingWebsite): Promise<void> {
    return modal.open<undefined>({
      title: t('page.marketing.websites.snippet.title'),
      component: TrackerSnippet,
      componentOptions: { website },
    }).result
  }

  return { openCreate, openSnippet }
}

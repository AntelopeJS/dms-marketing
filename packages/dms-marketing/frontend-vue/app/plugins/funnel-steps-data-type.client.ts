import { defineComponent, h } from 'vue'
import { defineDmsPlugin } from '#dms/frontend-module'
import FunnelStepsInput from '../components/FunnelStepsInput.vue'
import {
  isFunnelStepsValue,
  parseFunnelStepsValue,
  type FunnelStepsValue,
} from '../composables/useFunnelSteps'

const MAX_PREVIEW_STEPS = 3

function renderStepsPreview(value: FunnelStepsValue): string {
  const steps = parseFunnelStepsValue(value)
  if (!steps.length) {
    return '—'
  }
  const items = steps.slice(0, MAX_PREVIEW_STEPS).map((step) => step.value)
  const remaining = steps.length - MAX_PREVIEW_STEPS
  const tail = remaining > 0 ? ` +${remaining}` : ''
  return `${items.join(' → ')}${tail}`
}

const FunnelStepsDisplay = defineComponent({
  name: 'FunnelStepsDisplay',
  props: {
    modelValue: {
      type: [Array, String],
      default: null,
    },
  },
  setup(props) {
    return () =>
      h(FunnelStepsInput, {
        modelValue: isFunnelStepsValue(props.modelValue)
          ? props.modelValue
          : null,
        disabled: true,
      })
  },
})

export default defineDmsPlugin(() => {
  const { registerDataType } = useDataTypes()
  registerDataType({
    id: 'marketing_funnel_steps',
    displayComponent: FunnelStepsDisplay,
    formatter: {
      default: (value: unknown) =>
        isFunnelStepsValue(value) ? renderStepsPreview(value) : '—',
    },
  })
})

import {
  BlockFunctions,
  Form,
  FormComponents,
  FormEvents,
  type FormFieldOrGroupSerialized,
  type FormPropsSerialized,
  formSchema,
} from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { HttpMethod } from "@antelopejs/interface-dms/base/types";
import { defaultInUiUnits } from "@/services/settings";
import { API_BASE_PATH } from "@/types/constants";
import {
  BOOLEAN_SETTINGS,
  NUMBER_SETTINGS,
  type NumberSetting,
} from "@/types/settings";

const SETTINGS_URL = `${API_BASE_PATH}/settings`;

/**
 * Optional by design: an emptied numeric field arrives as `null`, which puts
 * the config default back in force. The bounds validate here and on the
 * route; the input keeps a value typed outside them (`clamp: false`) and says
 * so under the field, rather than turning a mistyped 0 into 1 without a word.
 */
function numberField(setting: NumberSetting) {
  return {
    id: setting.id,
    label: setting.labelKey,
    description: setting.descriptionKey,
    type: new DefaultDataTypes.NumberType({
      min: setting.min,
      max: setting.max,
      step: 1,
    }),
    inputComponent: FormComponents.InputNumber({
      min: setting.min,
      max: setting.max,
      step: 1,
      clamp: false,
    }),
  };
}

/**
 * The deployment default of each field, read per request from the module
 * config: shown as the empty field's placeholder and offered as "Use default"
 * on a field holding another value.
 */
function withDeploymentDefaults(
  options: FormPropsSerialized,
): FormPropsSerialized {
  const withDefault = (
    field: FormFieldOrGroupSerialized,
  ): FormFieldOrGroupSerialized => {
    const setting = NUMBER_SETTINGS.find((entry) => entry.id === field.id);
    if (!setting || !("component" in field)) {
      return field;
    }
    const value = defaultInUiUnits(setting);
    return {
      ...field,
      defaultValue: value,
      component: {
        ...field.component,
        options: {
          ...(field.component.options as object),
          placeholder: String(value),
        },
      },
    };
  };
  return { ...options, fields: options.fields.map(withDefault) };
}

function settingsForm(ids: readonly string[], successMessage: string) {
  return Form({
    fields: NUMBER_SETTINGS.filter((setting) => ids.includes(setting.id)).map(
      numberField,
    ),
    fetchUrl: SETTINGS_URL,
    submitUrl: SETTINGS_URL,
    // Not POST: the form then sends only the fields the user changed, so a
    // default left alone is never saved as an override, and a stale tab does
    // not write back what another owner changed since.
    submitUrlMethod: HttpMethod.put,
    successMessage,
  }).onFilter((_permissions, options) =>
    withDeploymentDefaults(options as FormPropsSerialized),
  );
}

/**
 * The Retention section's form: how long each kind of data is kept. A save
 * refreshes the "At a glance" meters.
 */
export const retentionForm = settingsForm(
  [
    "rawEventsRetentionDays",
    "statisticsRetentionDays",
    "snapshotRetentionDays",
  ],
  "$page.marketing.settings.retention_saved",
).watch(FormEvents.SUBMIT_SUCCESS, BlockFunctions.REFRESH_PAGE);

/** The Sampling section's form: the share of page loads recording clicks. */
export const samplingForm = settingsForm(
  ["heatmapSamplePercent"],
  "$page.marketing.settings.sampling_saved",
);

/**
 * Every setting the /api/marketing/settings route accepts, the master switch
 * included (the Collection section sends it alone). Never rendered: the
 * route validates its partial bodies against it.
 */
const allSettingsForm = Form({
  fields: [
    ...BOOLEAN_SETTINGS.map((setting) => ({
      id: setting.id,
      label: setting.labelKey,
      description: setting.descriptionKey,
      type: new DefaultDataTypes.BooleanType({}),
    })),
    ...NUMBER_SETTINGS.map(numberField),
  ],
});

export const marketingSettingsFormSchema: ReturnType<typeof formSchema> =
  formSchema(allSettingsForm);

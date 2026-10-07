import { Form, formSchema } from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { HttpMethod } from "@antelopejs/interface-dms/base/types";
import { API_BASE_PATH } from "@/types/constants";
import {
  BOOLEAN_SETTINGS,
  NUMBER_SETTINGS,
  type NumberSetting,
} from "@/types/settings";

const SETTINGS_URL = `${API_BASE_PATH}/settings`;

/**
 * Optional by design: an emptied numeric field arrives as `null`, which puts
 * the config default back in force.
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
      placeholder: setting.placeholder,
    }),
  };
}

function settingsForm(ids: readonly string[]) {
  return Form({
    fields: NUMBER_SETTINGS.filter((setting) => ids.includes(setting.id)).map(
      numberField,
    ),
    fetchUrl: SETTINGS_URL,
    submitUrl: SETTINGS_URL,
    submitUrlMethod: HttpMethod.post,
  });
}

/** The Retention section's form: how long each kind of data is kept. */
export const retentionForm = settingsForm([
  "rawEventsRetentionDays",
  "statisticsRetentionDays",
  "snapshotRetentionDays",
]);

/** The Sampling section's form: the share of page loads recording clicks. */
export const samplingForm = settingsForm(["heatmapSamplePercent"]);

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

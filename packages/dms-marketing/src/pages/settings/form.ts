import { Form, formSchema } from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { HttpMethod } from "@antelopejs/interface-dms/base/types";
import { API_BASE_PATH } from "@/types/constants";
import { BOOLEAN_SETTINGS, NUMBER_SETTINGS } from "@/types/settings";

/**
 * Declarative settings form, shared between the Settings page (DmsForm) and
 * the /api/marketing/settings endpoints ({@link marketingSettingsFormSchema}).
 * Fields and units come from the settings descriptor (`types/settings`), so
 * a new setting is one entry there.
 */
export const marketingSettingsForm = Form({
  fields: [
    ...BOOLEAN_SETTINGS.map((setting) => ({
      id: setting.id,
      label: setting.labelKey,
      description: setting.descriptionKey,
      type: new DefaultDataTypes.BooleanType({}),
      required: true,
    })),
    // Optional by design: clearing a numeric field resets the override to the
    // config default.
    ...NUMBER_SETTINGS.map((setting) => ({
      id: setting.id,
      label: setting.labelKey,
      description: setting.descriptionKey,
      type: new DefaultDataTypes.NumberType({
        min: setting.min,
        max: setting.max,
        step: 1,
        placeholder: setting.placeholder,
      }),
    })),
  ],
  fetchUrl: `${API_BASE_PATH}/settings`,
  submitUrl: `${API_BASE_PATH}/settings`,
  submitUrlMethod: HttpMethod.post,
});

export const marketingSettingsFormSchema: ReturnType<typeof formSchema> =
  formSchema(marketingSettingsForm);

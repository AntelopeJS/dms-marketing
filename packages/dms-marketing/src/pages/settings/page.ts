import { Banner } from "@antelopejs/interface-dms/base/banner";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { Meter } from "@antelopejs/interface-dms/base/meter";
import { FieldRow, Section } from "@antelopejs/interface-dms/base/section";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { API_BASE_PATH, MARKETING_MODULE_ID } from "@/types/constants";
import { blockMeta } from "../blocks";
import { setupCategory } from "../module";
import { retentionForm, samplingForm } from "./form";

const SETTINGS_PREFIX = "$page.marketing.settings.";

function retentionMeter(item: string, tone: "primary" | "error" | "neutral") {
  return FieldRow({ label: `${SETTINGS_PREFIX}glance.${item}`, layout: "form" })
    .child(
      "meter",
      Meter({
        fetchUrl: `${API_BASE_PATH}/settings/glance?item=${item}`,
        tone,
        size: "sm",
        format: "value",
      }),
    )
    .meta(blockMeta(`glance_${item}`, "i-ph-ruler"));
}

/**
 * Settings — collection, retention and sampling for every website of the
 * deployment. The master switch sits apart from the form, behind a
 * confirmation that says what pausing stops; values apply without restart.
 */
@RegisterPage()
export class MarketingSettingsPage extends PageController(
  "settings",
  {
    displayName: "$page.marketing.settings.title",
    description: "$page.marketing.settings.description",
    icon: "i-ph-gear-six",
    module: MARKETING_MODULE_ID,
    category: setupCategory,
    order: 2,
  },
  DefaultLayout({ fullWidth: false }),
) {
  static collection = Section({
    title: `${SETTINGS_PREFIX}sections.collection`,
    description: `${SETTINGS_PREFIX}sections.collection_description`,
  })
    .child(
      "switch",
      Banner({
        fetchUrl: `${API_BASE_PATH}/settings/collection/banner`,
        size: "sm",
      }).meta(blockMeta("collection", "i-ph-broadcast")),
    )
    .meta(blockMeta("settings_collection", "i-ph-broadcast"));

  static retention = Section({
    title: `${SETTINGS_PREFIX}sections.retention`,
    description: `${SETTINGS_PREFIX}sections.retention_description`,
  })
    .child(
      "form",
      retentionForm.meta(
        blockMeta("retention_form", "i-ph-clock-counter-clockwise"),
      ),
    )
    .meta(blockMeta("settings_retention", "i-ph-clock-counter-clockwise"));

  static glance = Section({
    title: `${SETTINGS_PREFIX}sections.glance`,
    description: `${SETTINGS_PREFIX}sections.glance_description`,
  })
    .child("snapshots", retentionMeter("snapshots", "error"))
    .child("raw", retentionMeter("raw", "primary"))
    .child("statistics", retentionMeter("statistics", "primary"))
    .meta(blockMeta("settings_glance", "i-ph-ruler"));

  static sampling = Section({
    title: `${SETTINGS_PREFIX}sections.sampling`,
    description: `${SETTINGS_PREFIX}sections.sampling_description`,
  })
    .child(
      "form",
      samplingForm.meta(blockMeta("sampling_form", "i-ph-percent")),
    )
    .meta(blockMeta("settings_sampling", "i-ph-percent"));
}

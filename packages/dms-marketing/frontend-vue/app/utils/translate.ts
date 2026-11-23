/** The named values a message interpolates. */
export type MessageParams = Record<string, string | number>

/** The `t` of useI18n, as far as the pure helpers call it. */
export type Translate = (
  key: string,
  named?: MessageParams,
  plural?: number,
) => string

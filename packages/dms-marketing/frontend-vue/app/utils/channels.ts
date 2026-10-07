/** Icon and bar colour of each acquisition channel, in one place. */
export interface ChannelStyle {
  icon: string
  bar: string
  text: string
}

const NEUTRAL_STYLE: ChannelStyle = {
  icon: 'i-ph-question',
  bar: 'bg-(--ui-text-dimmed)',
  text: 'text-muted',
}

const CHANNEL_STYLES: Record<string, ChannelStyle> = {
  direct: {
    icon: 'i-ph-arrow-elbow-down-right',
    bar: 'bg-primary',
    text: 'text-primary',
  },
  organic: {
    icon: 'i-ph-magnifying-glass',
    bar: 'bg-primary/70',
    text: 'text-primary',
  },
  email: {
    icon: 'i-ph-envelope-simple',
    bar: 'bg-success',
    text: 'text-success',
  },
  referral: { icon: 'i-ph-link', bar: 'bg-warning', text: 'text-warning' },
  social: {
    icon: 'i-ph-share-network',
    bar: 'bg-(--ui-text-muted)',
    text: 'text-muted',
  },
  paid: {
    icon: 'i-ph-currency-eur',
    bar: 'bg-(--ui-text-dimmed)',
    text: 'text-muted',
  },
}

export function channelStyle(channel: string): ChannelStyle {
  return CHANNEL_STYLES[channel] ?? NEUTRAL_STYLE
}

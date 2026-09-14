// Activity level → pulse-icon height, one icon per level. Anything
// unrecognised gets the plain pulse rather than reading as active.
export const activityIcon = (level: string) => {
  switch (level) {
    case 'Inactive':
      return '/images/icons/activity-low.svg'
    case 'Semi-active':
      return '/images/icons/activity-mid.svg'
    case 'Active':
      return '/images/icons/activity-high.svg'
    default:
      return '/images/icons/activity.svg'
  }
}

import styles from './Tooltip.module.css'

/* A short label that appears beside an element on hover or keyboard focus,
   from the Figma "tooltip" component (file xQcFkuYX4dACj17xRVfDYD, node
   11665:24766). It sits 8px from the element, on the side `position` names.

     size   small    for xs (32px) icon-only buttons
            default  for everything bigger

   The element it labels needs `tooltipAnchor` in its className: that makes
   it the tooltip's position anchor and shows the tooltip on hover/focus.
   <Button> does this itself for every icon-only button.

   The tooltip is visual only (aria-hidden): the element's own aria-label is
   what screen readers announce, so the text isn't read twice. */

export type TooltipPosition = 'below' | 'above' | 'left' | 'right'

export const tooltipAnchor = styles.anchor

const POSITION_CLASS: Record<TooltipPosition, string> = {
  below: styles.below,
  above: styles.above,
  left: styles.left,
  right: styles.right,
}

export default function Tooltip({
  text,
  size = 'default',
  position = 'below',
}: {
  text: string
  size?: 'default' | 'small'
  position?: TooltipPosition
}) {
  return (
    <span
      className={`${styles.tooltip} ${styles[size]} ${POSITION_CLASS[position]} drop-shadow-dark ${
        size === 'small' ? 'paragraph-xs' : 'paragraph-small'
      }`}
      aria-hidden="true"
    >
      {text}
    </span>
  )
}

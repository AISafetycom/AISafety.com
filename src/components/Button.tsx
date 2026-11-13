import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react'
import Icon from '@/components/Icon'
import Tooltip, { tooltipAnchor, type TooltipPosition } from './Tooltip'
import styles from './Button.module.css'

/* The site's button, built from the Figma "Button" component set
   (file xQcFkuYX4dACj17xRVfDYD, node 11645:18071). Prop names and values
   mirror the Figma properties so design and code use the same words:

     Style          → variant        white | teal | teal-alt | clear | clear-border
     Small          → size           default | small | xs
                                     (icon only: small or xs; xs: icon only)
     Icon position  → iconPosition   preceding | trailing | only
     State          → nothing to pass: hover, focus and disabled come from the
                      browser (:hover, :focus-visible, the `disabled` attribute)

   It renders a real <button> by default. For a link that looks like a button,
   pass the link element with `as`: as={Link} for pages on this site, as="a"
   for other sites, or a tracking wrapper such as as={TrackedLink}. Every other
   prop goes through to that element.

   Text type comes from the global .paragraph-small-bold / .paragraph-xs-bold
   classes; Button.module.css holds only shape and color. */

type Variant = 'white' | 'teal' | 'teal-alt' | 'clear' | 'clear-border'
type Size = 'default' | 'small'

type Look =
  /** A label, with an optional icon before or after it. */
  | {
      children: ReactNode
      variant?: Variant
      size?: Size
      /** Icon shape in /images/icons/, rendered through <Icon>. */
      icon?: string
      /** Where the icon sits. Default 'trailing'. */
      iconPosition?: 'preceding' | 'trailing'
      tooltip?: never
      tooltipPosition?: never
    }
  /** Just an icon, in a circle: small (40px, the default here) with a 24px
      icon, or xs (32px) with a 16px icon. There is no
      48px icon-only button. Needs an aria-label so screen readers can name
      it, and shows that label as a <Tooltip> on hover and keyboard focus
      (not while disabled). */
  | {
      children?: never
      icon: string
      iconPosition: 'only'
      'aria-label': string
      /** Tooltip text, if it should differ from the aria-label. false turns
          the tooltip off. */
      tooltip?: string | false
      /** Which side the tooltip appears on. Default 'below'. */
      tooltipPosition?: TooltipPosition
      variant?: Variant
      size?: 'small' | 'xs'
    }

export type ButtonProps<C extends ElementType = 'button'> = Look & {
  /** The element or component to render. Default 'button'. */
  as?: C
  /** Spins the repeat icon (at the button's icon size) in place of the
      icon while something is on its way (a form sending, say). The button
      keeps its normal colors. */
  loading?: boolean
  className?: string
} & Omit<
    ComponentPropsWithoutRef<C>,
    'as' | 'children' | 'className' | 'aria-label'
  >

const VARIANT_CLASS: Record<Variant, string> = {
  white: styles.white,
  teal: styles.teal,
  'teal-alt': styles.tealAlt,
  clear: styles.clear,
  'clear-border': styles.clearBorder,
}

export default function Button<C extends ElementType = 'button'>(
  props: ButtonProps<C>
) {
  const {
    as,
    children,
    variant = 'white',
    size: sizeProp,
    icon,
    iconPosition = 'trailing',
    className = '',
    loading = false,
    tooltip,
    tooltipPosition = 'below',
    ...rest
  } = props
  const Component: ElementType = as ?? 'button'

  const iconOnly = iconPosition === 'only'
  const size = sizeProp ?? (iconOnly ? 'small' : 'default')
  // No tooltip on a disabled (greyed-out) button: there's nothing to do.
  const disabled = (props as { disabled?: boolean }).disabled === true
  const tooltipText =
    iconOnly && tooltip !== false && !disabled
      ? (tooltip ?? (props as { 'aria-label': string })['aria-label'])
      : ''
  const classes = [
    styles.button,
    VARIANT_CLASS[variant],
    styles[size],
    iconOnly ? styles.iconOnly : '',
    loading ? styles.loading : '',
    tooltipText ? tooltipAnchor : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  // Icon-only buttons: a 24px icon at small (40px), 16px at xs (32px).
  // Buttons with a label always use 16px.
  const iconSize = iconOnly && size === 'small' ? 24 : 16
  const iconEl = loading ? (
    <Icon
      src={
        iconSize === 24
          ? '/images/icons/repeat-large.svg'
          : '/images/icons/repeat.svg'
      }
      size={iconSize}
      className={styles.spinner}
    />
  ) : icon ? (
    <Icon src={icon} size={iconSize} />
  ) : null

  const content = iconOnly ? (
    <>
      {iconEl}
      {tooltipText && (
        <Tooltip
          text={tooltipText}
          size={size === 'xs' ? 'small' : 'default'}
          position={tooltipPosition}
        />
      )}
    </>
  ) : (
    <>
      {iconPosition === 'preceding' && iconEl}
      <span
        className={
          size === 'small' ? 'paragraph-xs-bold' : 'paragraph-small-bold'
        }
      >
        {children}
      </span>
      {iconPosition === 'trailing' && iconEl}
    </>
  )

  // A bare <button> submits its form; make that opt-in with type="submit".
  const defaults = Component === 'button' ? { type: 'button' } : {}

  return (
    <Component
      className={classes}
      {...defaults}
      {...(loading ? { 'aria-busy': true } : {})}
      {...rest}
    >
      {content}
    </Component>
  )
}

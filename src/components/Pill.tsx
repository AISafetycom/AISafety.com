import type { ComponentPropsWithRef, ElementType, ReactNode } from 'react'
import Icon from '@/components/Icon'
import styles from './Pill.module.css'

/* A rounded pill that takes you to a section of the site: an icon in a white
   circle, a label, and an optional count. Used in the global nav (the top row,
   the +N dropdown and the mobile menu) and in the search box's browse grid.

   It renders a <button> by default. Pass `as` for anything else: as={Link}
   for a page on this site, as="a" for a plain link, as="span" for a pill
   that something around it makes clickable (the nav's +N). Every other prop
   goes through to that element.

   States come from the browser and the element: hover (60% white border,
   teal-800 fill), aria-current="page" (the "you are here" ring), and the
   `disabled` attribute on a <button>. */

export type PillProps<C extends ElementType = 'button'> = {
  /** The element or component to render. Default 'button'. */
  as?: C
  /** The label. */
  children: ReactNode
  /** Icon shape in /images/icons/, shown in a white circle before the label. */
  icon?: string
  /** A number after the label, such as how many listings a page has. */
  count?: number
  /** 'large' sets the label in the default text size (the mobile menu). */
  textSize?: 'small' | 'large'
  /** Stretch to the width of its container instead of fitting the label. */
  fullWidth?: boolean
  /** 'teal-alt' for pills on a lighter surface (the +N dropdown, the mobile
      menu, the search box): the teal-alt <Button> colors, no hover shadow. */
  variant?: 'default' | 'teal-alt'
  className?: string
} & Omit<ComponentPropsWithRef<C>, 'as' | 'children' | 'className'>

export default function Pill<C extends ElementType = 'button'>(
  props: PillProps<C>
) {
  const {
    as,
    children,
    icon,
    count,
    textSize = 'small',
    fullWidth = false,
    variant = 'default',
    className = '',
    ...rest
  } = props
  const Component: ElementType = as ?? 'button'

  const classes = [
    styles.pill,
    variant === 'teal-alt' ? styles.tealAlt : '',
    icon ? '' : styles.noIcon,
    fullWidth ? styles.fullWidth : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  // A bare <button> submits its form; make that opt-in with type="submit".
  const defaults = Component === 'button' ? { type: 'button' } : {}

  return (
    <Component className={classes} {...defaults} {...rest}>
      {icon && (
        <span className={styles.icon}>
          <Icon src={icon} className="color-teal-900" />
        </span>
      )}
      <span
        className={`${styles.label} ${
          textSize === 'large'
            ? 'paragraph-default-bold'
            : 'paragraph-small-bold'
        }`}
      >
        {children}
      </span>
      {count !== undefined && count > 0 && (
        <span
          className={`${styles.count} ${
            textSize === 'large' ? 'paragraph-small' : 'paragraph-xs'
          } color-teal-grey-300`}
        >
          {count}
        </span>
      )}
    </Component>
  )
}

import Link from 'next/link'
import Button from '@/components/Button'

/* The design system, in public: every shared component in every variant,
   matching the Figma components. Add a section here for each new shared
   component. */

export const metadata = {
  title: 'Design system – AISafety.com',
  description:
    'The components AISafety.com is built from, in every variant, matching the Figma design system.',
  alternates: { canonical: '/design-system' },
}

const VARIANTS = ['white', 'teal', 'teal-alt', 'clear', 'clear-border'] as const
const SIZES = ['default', 'small'] as const
const ARROW = '/images/icons/arrow-right.svg'
const PERSON = '/images/icons/person.svg'
const TOOLTIP_POSITIONS = ['below', 'above', 'left', 'right'] as const

export default function DesignSystemPage() {
  return (
    <main className="container-default padding-top-40px padding-bottom-40px">
      <h1 className="padding-bottom-40px">Design system</h1>
      <h2 className="padding-bottom-12px">Buttons</h2>
      <p className="paragraph-small color-teal-grey-300 padding-bottom-24px">
        Columns: default, disabled. Hover and tab to see the other states.
      </p>
      <div className="flex flex-col gap-40px">
        {VARIANTS.map(variant => (
          <section key={variant} className="flex flex-col gap-16px">
            <h3>{variant}</h3>
            {SIZES.map(size => (
              <div key={size} className="flex flex-col gap-16px">
                {[false, true].map(disabled => (
                  <div
                    key={String(disabled)}
                    className="flex items-center gap-24px"
                  >
                    <Button variant={variant} size={size} disabled={disabled}>
                      Button
                    </Button>
                    <Button
                      variant={variant}
                      size={size}
                      icon={ARROW}
                      disabled={disabled}
                    >
                      Button
                    </Button>
                    <Button
                      variant={variant}
                      size={size}
                      icon={PERSON}
                      iconPosition="preceding"
                      disabled={disabled}
                    >
                      Button
                    </Button>
                    {/* Icon-only buttons come in small and xs only. */}
                    {size === 'small' && (
                      <Button
                        variant={variant}
                        size="small"
                        icon="/images/icons/arrow-right-large.svg"
                        iconPosition="only"
                        aria-label="Next"
                        disabled={disabled}
                      />
                    )}
                  </div>
                ))}
              </div>
            ))}
            {/* xs (32px) is icon-only. */}
            <div className="flex items-center gap-24px">
              <Button
                variant={variant}
                size="xs"
                icon="/images/icons/arrow-up-right.svg"
                iconPosition="only"
                aria-label="Open"
              />
              <Button
                variant={variant}
                size="xs"
                icon="/images/icons/arrow-up-right.svg"
                iconPosition="only"
                aria-label="Open"
                disabled
              />
            </div>
          </section>
        ))}
        <section className="flex flex-col gap-16px">
          <h3>As a link</h3>
          <div className="flex items-center gap-24px">
            <Button as={Link} href="/events" icon={ARROW}>
              Events
            </Button>
          </div>
        </section>
      </div>

      <h2 className="padding-top-40px padding-bottom-12px">Tooltips</h2>
      <p className="paragraph-small color-teal-grey-300 padding-bottom-24px">
        Every icon-only button shows its label as a tooltip. Hover or tab to
        each one. Small tooltips go with xs buttons, default tooltips with small
        (40px) ones.
      </p>
      <div className="flex flex-col gap-40px">
        {(['xs', 'small'] as const).map(size => (
          <section key={size} className="flex flex-col gap-16px">
            <h3>{size} button</h3>
            <div className="flex flex-wrap items-center gap-192px padding-top-56px padding-bottom-56px padding-left-128px">
              {TOOLTIP_POSITIONS.map(position =>
                size === 'xs' ? (
                  <Button
                    key={position}
                    variant="clear"
                    size="xs"
                    icon="/images/icons/arrow-up-right.svg"
                    iconPosition="only"
                    aria-label={`Tooltip ${position}`}
                    tooltipPosition={position}
                  />
                ) : (
                  <Button
                    key={position}
                    variant="clear"
                    size="small"
                    icon="/images/icons/search-large.svg"
                    iconPosition="only"
                    aria-label={`Tooltip ${position}`}
                    tooltipPosition={position}
                  />
                )
              )}
            </div>
          </section>
        ))}
      </div>
    </main>
  )
}

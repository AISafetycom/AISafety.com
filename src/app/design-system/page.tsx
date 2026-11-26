import Link from 'next/link'
import Button from '@/components/Button'
import FeedbackFormLink from '@/components/FeedbackFormLink'
import TextField from '@/components/TextField'
import { CORRECTIONS_FORM, FEEDBACK_FORM } from '@/lib/selection-feedback'
import ListingLogo from '@/components/ListingLogo'
import PopoverDemo from './PopoverDemo'
import SuggestionsDemo from './SuggestionsDemo'

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
              {/* iconSize={12}: the 12px icon, as on a filter pill's ×. */}
              <Button
                variant={variant}
                size="xs"
                icon="/images/icons/x-small.svg"
                iconSize={12}
                iconPosition="only"
                aria-label="Clear filter"
              />
              <Button
                variant={variant}
                size="xs"
                icon="/images/icons/x-small.svg"
                iconSize={12}
                iconPosition="only"
                aria-label="Clear filter"
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

      <h2 className="padding-top-40px padding-bottom-12px">Text fields</h2>
      <p className="paragraph-small color-teal-grey-300 padding-bottom-24px">
        The label, the box and an error message. Click into one to see its focus
        state. A text area grows as you type.
      </p>
      <div className="flex flex-col gap-24px width-6-col">
        <TextField label="Label" />
        <TextField label="Label" defaultValue="Input text" />
        <TextField label="Label" optional />
        <TextField
          label="Label"
          defaultValue="Input text"
          error="Error message"
        />
        <TextField as="textarea" label="Text area" />
        <TextField
          as="select"
          label="Dropdown"
          options={['First choice', 'Second choice']}
        />
        <SuggestionsDemo />
      </div>

      <h2 className="padding-top-40px padding-bottom-12px">Listing logo</h2>
      <p className="paragraph-small color-teal-grey-300 padding-bottom-24px">
        Starts a row in the site search&apos;s results and a text box&apos;s
        suggestions: the logo, the name&apos;s initials when there&apos;s none,
        or a page&apos;s icon.
      </p>
      <div className="flex items-center gap-16px">
        <ListingLogo
          title="AI Safety Quest"
          logo="/images/ai-safety-quest.png"
        />
        <ListingLogo title="Alignment Forum" logo={null} />
        <ListingLogo title="Events" logo="/images/icons/calendar.svg" page />
      </div>

      <h2 className="padding-top-40px padding-bottom-12px">Popover</h2>
      <p className="paragraph-small color-teal-grey-300 padding-bottom-24px">
        Holds anything: a filter&apos;s options, a form. Opened by something on
        the page, it points at it and goes under it, or above or beside it when
        there&apos;s no room, never over it. It closes on Escape or a click
        outside.
      </p>
      <PopoverDemo />

      <h2 className="padding-top-40px padding-bottom-12px">
        Correction and feedback form
      </h2>
      <p className="paragraph-small color-teal-grey-300 padding-bottom-24px">
        The site&apos;s own form, in a popover by what opened it. Links that
        open it are FeedbackFormLinks: a plain click opens the form, a Cmd-click
        the Airtable form. Selecting text on a page opens it too.
      </p>
      <div className="flex items-center gap-16px">
        <Button
          as={FeedbackFormLink}
          kind="correction"
          href={CORRECTIONS_FORM}
          variant="clear-border"
          size="small"
        >
          Suggest a correction
        </Button>
        <FeedbackFormLink kind="feedback" href={FEEDBACK_FORM} className="link">
          Give feedback
        </FeedbackFormLink>
      </div>
    </main>
  )
}

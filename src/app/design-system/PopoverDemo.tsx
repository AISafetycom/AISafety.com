'use client'

import { useCallback, useRef, useState } from 'react'
import Button from '@/components/Button'
import Popover, { pageBox, type PageBox } from '@/components/Popover'

// The design system page's <Popover> example: a button that opens one under
// itself, the way the site's correction form opens by its link.
export default function PopoverDemo() {
  const [anchor, setAnchor] = useState<PageBox | null>(null)
  const triggerRef = useRef<HTMLElement | SVGElement | null>(null)
  const close = useCallback(() => setAnchor(null), [])

  return (
    <>
      <Button
        variant="clear-border"
        size="small"
        aria-haspopup="dialog"
        onClick={e => {
          if (anchor) return close()
          triggerRef.current = e.currentTarget
          setAnchor(pageBox(e.currentTarget))
        }}
      >
        Open a popover
      </Button>
      <Popover
        open={!!anchor}
        onClose={close}
        triggerRef={triggerRef}
        anchor={anchor ?? undefined}
        label="Example popover"
      >
        <div className="padding-top-24px padding-bottom-24px padding-left-24px padding-right-24px">
          <p className="paragraph-small-bold padding-bottom-8px">
            Popover title
          </p>
          <p className="paragraph-small color-teal-grey-300">
            Any content. Escape or a click outside closes it.
          </p>
        </div>
      </Popover>
    </>
  )
}

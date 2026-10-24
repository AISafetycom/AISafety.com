'use client'

import Icon from './Icon'
import styles from './RangeSlider.module.css'

interface RangeSliderProps {
  /** What each slider position stands for, lowest to highest. */
  labels: string[]
  /** One bar per stretch between positions (labels.length - 1 of them): how
   *  many listings fall in it. */
  bars: number[]
  /** The two handles' positions, lowest first. */
  value: [number, number]
  onChange: (value: [number, number]) => void
  /** What the range is of, in lowercase, for the handles' accessible names
   *  ("grant size" gives "Minimum grant size"). */
  name: string
}

// A bar chart over a two-handle slider, for picking a range of values. Fills
// the width it is given; FilterRange puts it in a filter pill's popover.
//
// The handles are 24px wide. The invisible native inputs (which take the mouse
// and keyboard) and the handles drawn on top of them share that width and the
// same travel, so a handle sits where the pointer is, at the end of the colored
// line, with its centre exactly between two bars.
export default function RangeSlider({
  labels,
  bars,
  value,
  onChange,
  name,
}: RangeSliderProps) {
  const [lo, hi] = value
  const top = labels.length - 1
  const tallest = Math.max(...bars, 1)
  // How far along the track a position is: a handle's left edge travels from
  // 0 to the track's width less one handle.
  const along = (position: number) => `calc(${position / top} * (100% - 24px))`

  return (
    <div>
      <div className={styles.chart}>
        <div className={styles.bars} aria-hidden="true">
          {bars.map((count, i) => {
            const inRange = i >= lo && i < hi
            return (
              <span key={i} className={styles.cell}>
                <span
                  className={`${styles.bar}${inRange ? '' : ` ${styles.barOff}`}`}
                  style={{
                    height: `${(count / tallest) * 100}%`,
                    // Each bar shows its own slice of one gradient that runs
                    // across all of them (the 2px is the gap between bars).
                    backgroundSize: `calc(${bars.length * 100}% + ${(bars.length - 1) * 2}px) 100%`,
                    backgroundPosition: `${bars.length > 1 ? (i / (bars.length - 1)) * 100 : 0}% 0`,
                  }}
                >
                  {inRange && (
                    <span
                      className={`${styles.shadow} drop-shadow-extra-dark`}
                    />
                  )}
                </span>
              </span>
            )
          })}
        </div>
        <span className={styles.track} />
        {/* The colored part of the line is the whole gradient line, cut down to
            the stretch between the two handles. */}
        <span
          className={styles.fill}
          style={{
            clipPath: `inset(0 ${(1 - hi / top) * 100}% 0 ${(lo / top) * 100}% round 2px)`,
          }}
        />

        {/* Handles that meet are grabbed from the side with room to move: the
            upper one near the bottom of the range, the lower one near the
            top. Both inputs cover the whole range; the lower one is kept off
            the very top, where there is no stretch left to pick. */}
        <input
          type="range"
          className={styles.handle}
          min={0}
          max={top}
          value={lo}
          aria-label={`Minimum ${name}`}
          aria-valuetext={labels[lo]}
          style={{ zIndex: lo >= top / 2 ? 2 : 1 }}
          onChange={e =>
            onChange([Math.min(Number(e.target.value), hi, top - 1), hi])
          }
        />
        <span
          className={`${styles.thumb} drop-shadow-extra-dark`}
          style={{ left: along(lo) }}
        >
          <Icon
            src="/images/icons/move-up-down-small.svg"
            size={12}
            className="color-teal-300"
          />
        </span>

        <input
          type="range"
          className={styles.handle}
          min={0}
          max={top}
          value={hi}
          aria-label={`Maximum ${name}`}
          aria-valuetext={labels[hi]}
          style={{ zIndex: lo >= top / 2 ? 1 : 2 }}
          onChange={e => onChange([lo, Math.max(Number(e.target.value), lo)])}
        />
        <span
          className={`${styles.thumb} drop-shadow-extra-dark`}
          style={{ left: along(hi) }}
        >
          <Icon
            src="/images/icons/move-up-down-small.svg"
            size={12}
            className="color-teal-300"
          />
        </span>
      </div>

      <div className="flex justify-between padding-top-16px">
        <div>
          <p className="paragraph-xs color-teal-300">Minimum</p>
          <p className="paragraph-small color-white">{labels[lo]}</p>
        </div>
        <div className="flex flex-col items-end">
          <p className="paragraph-xs color-teal-300">Maximum</p>
          <p className="paragraph-small color-white">{labels[hi]}</p>
        </div>
      </div>
    </div>
  )
}

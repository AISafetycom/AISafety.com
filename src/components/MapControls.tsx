'use client'

import Icon from './Icon'
import styles from './MapControls.module.css'

interface MapControlsProps {
  onZoomIn: () => void
  onZoomOut: () => void
  onReset: () => void
  /** Positioning class from the page's CSS module (top/right offsets, z-index) */
  className: string
}

export default function MapControls({
  onZoomIn,
  onZoomOut,
  onReset,
  className,
}: MapControlsProps) {
  return (
    <div className={className}>
      <div className={`${styles.group} border-plus-fill`}>
        <button className={styles.button} title="Zoom in" onClick={onZoomIn}>
          <Icon
            src="/images/icons/plus.svg"
            size={16}
            className="color-white"
          />
        </button>
        <button className={styles.button} title="Zoom out" onClick={onZoomOut}>
          <Icon
            src="/images/icons/minus.svg"
            size={16}
            className="color-white"
          />
        </button>
        <button className={styles.button} title="Zoom to fit" onClick={onReset}>
          <Icon
            src="/images/icons/scan.svg"
            size={16}
            className="color-white"
          />
        </button>
      </div>
    </div>
  )
}

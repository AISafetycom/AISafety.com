import { describe, expect, it } from 'vitest'
import { isLiveSiteHost } from './live-site'

describe('isLiveSiteHost', () => {
  it('counts the live site, with or without www', () => {
    expect(isLiveSiteHost('aisafety.com')).toBe(true)
    expect(isLiveSiteHost('www.aisafety.com')).toBe(true)
    expect(isLiveSiteHost('WWW.AISAFETY.COM')).toBe(true)
  })

  it('counts readers on Google Translate', () => {
    expect(isLiveSiteHost('aisafety-com.translate.goog')).toBe(true)
  })

  it('never counts dev servers, previews or copies of the site', () => {
    for (const host of [
      'localhost',
      '127.0.0.1',
      '192.168.1.20',
      'ai-safety-com.vercel.app',
      'ai-safety-com-git-filter-pill-clear-alignmentdevs-projects.vercel.app',
      'aisafety-com-jp.vercel.app',
      'map.largeagentsystems.org',
      'aisafety.com.evil.example',
      'notaisafety.com',
    ]) {
      expect(isLiveSiteHost(host), host).toBe(false)
    }
  })
})

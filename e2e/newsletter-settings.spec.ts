import { test, expect } from '@playwright/test'

// /newsletter opened from the "Manage subscriptions" link in an issue shows
// the reader's own newsletters (src/app/newsletter/NewsletterChooser.tsx).
// The settings API is answered here, so no ActiveCampaign key is needed.

const KEY = '12345.abcdefghijklmnopqrstuv'

test('the reader keeps their newsletters after Back from Past issues and a reload', async ({
  page,
}) => {
  const keysSent: string[] = []
  await page.route('**/api/newsletter/settings', async route => {
    keysSent.push(JSON.parse(route.request().postData() ?? '{}').k)
    await route.fulfill({
      json: {
        ok: true,
        email: 'r•••@example.org',
        subscribed: {
          events: true,
          training: false,
          funding: false,
          updates: false,
        },
      },
    })
  })
  const yours = page.getByRole('heading', { name: 'Your newsletters' })

  await page.goto(`/newsletter#k=${KEY}`)
  await expect(yours).toBeVisible()
  expect(page.url()).not.toContain(KEY)
  // A reader sees all four newsletters, Updates among them, ticked or not.
  await expect(page.getByRole('checkbox')).toHaveCount(4)
  await expect(
    page.getByRole('checkbox', { name: /AISafety\.com Updates/ })
  ).not.toBeChecked()
  await expect(
    page.getByRole('checkbox', { name: /AI Safety Events/ })
  ).toBeChecked()

  await page
    .getByRole('link', { name: /Past issues/ })
    .first()
    .click()
  await expect(page).toHaveURL(/\/newsletter\/[a-z]+$/)
  await page.goBack()
  await expect(yours).toBeVisible()

  await page.reload()
  await expect(yours).toBeVisible()
  expect(page.url()).not.toContain(KEY)
  expect(keysSent.length).toBeGreaterThan(1)
  expect(keysSent.every(k => k === KEY)).toBe(true)
})

// Updates has no issue sent through ActiveCampaign when it moves from
// Substack (and CI can't read ActiveCampaign at all), yet the footer links
// its page from that day: the page and its feed must exist with nothing to
// list.
test('the Updates newsletter page and feed exist before its first issue', async ({
  page,
  request,
}) => {
  const response = await page.goto('/newsletter/updates')
  expect(response?.status()).toBe(200)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Updates newsletter' })
  ).toBeVisible()
  await expect(
    page.getByText('goes out when AISafety.com launches a major new feature')
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Past issues' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Substack' })).toHaveAttribute(
    'href',
    /^https:\/\/aisafetycom\.substack\.com\/archive/
  )
  // No resource page to link on to.
  await expect(page.getByText(/For a live list/)).toHaveCount(0)

  const feed = await request.get('/newsletter/updates/feed')
  expect(feed.status()).toBe(200)
  expect(feed.headers()['content-type']).toContain('application/rss+xml')
  expect(await feed.text()).toContain('<title>AISafety.com Updates</title>')

  // The footer leads here, not to Substack.
  await page.goto('/')
  await expect(
    page.getByRole('contentinfo').getByRole('link', {
      name: 'AISafety.com Updates',
    })
  ).toHaveAttribute('href', '/newsletter/updates')
})

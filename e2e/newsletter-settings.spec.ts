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
        subscribed: { events: true, training: false, funding: false },
      },
    })
  })
  const yours = page.getByRole('heading', { name: 'Your newsletters' })

  await page.goto(`/newsletter#k=${KEY}`)
  await expect(yours).toBeVisible()
  expect(page.url()).not.toContain(KEY)

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

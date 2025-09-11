import { test, expect } from './coverage.fixture'

test('explore page shows tabs and trending heading', async ({ page }) => {
  const res = await page.goto('/explore')
  expect(res?.ok()).toBeTruthy()
  await expect(page.getByRole('tab', { name: 'Trending' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'News' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Trending Hashtags/i })).toBeVisible()
})

test('explore tabs switch selection and search shows empty state', async ({ page }) => {
  await page.goto('/explore')
  const trending = page.getByRole('tab', { name: 'Trending' })
  const news = page.getByRole('tab', { name: 'News' })
  await news.click()
  await expect(news).toHaveAttribute('aria-selected', 'true')
  await trending.click()
  await expect(trending).toHaveAttribute('aria-selected', 'true')

  const search = page.locator('header input[placeholder="Search"]').first()
  await expect(search).toBeVisible()
  await search.fill('unlikely-search-term-xyz')
  await page.waitForTimeout(500)
  await expect(page.getByText(/No results for/i)).toBeVisible()
})

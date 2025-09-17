import { test, expect } from './coverage.fixture'

test('server responds 200 on /', async ({ page }) => {
  const res = await page.goto('/')
  expect(res?.ok()).toBeTruthy()
})

test('feed UI shows header and tabs', async ({ page }) => {
  const res = await page.goto('/feed')
  expect(res?.ok()).toBeTruthy()
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'For You' })).toBeVisible()
})

test('feed tabs can be switched', async ({ page }) => {
  await page.goto('/feed')
  const forYou = page.getByRole('tab', { name: 'For You' })
  const yourPosts = page.getByRole('tab', { name: 'Your Posts' })
  await expect(forYou).toBeVisible()
  await expect(yourPosts).toBeVisible()
  await yourPosts.click()
  await expect(yourPosts).toHaveAttribute('data-state', 'active')
})

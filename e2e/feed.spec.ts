import { test, expect } from './coverage.fixture'

test('server responds 200 on /', async ({ page }) => {
  const res = await page.goto('/')
  expect(res?.ok()).toBeTruthy()
})

test('server responds 200 on /feed', async ({ page }) => {
  const res = await page.goto('/feed')
  expect(res?.ok()).toBeTruthy()
})

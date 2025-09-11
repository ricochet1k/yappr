import { test as base, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import v8ToIstanbul from 'v8-to-istanbul'
import { createCoverageMap } from 'istanbul-lib-coverage'

export const test = base.extend({})
export { expect }

test.beforeEach(async ({ page }) => {
  await page.coverage.startJSCoverage({ resetOnNavigation: false })
  // Optionally capture CSS coverage as well
  await page.coverage.startCSSCoverage({ resetOnNavigation: false })
})

test.afterEach(async ({ page }, testInfo) => {
  // Stop coverage
  const [jsCoverage] = await Promise.all([
    page.coverage.stopJSCoverage(),
    page.coverage.stopCSSCoverage().catch(() => []),
  ])

  // Convert V8 coverage to Istanbul and write to .nyc_output
  const map = createCoverageMap({})

  // Prefer instrumentation-based coverage if available
  try {
    const istFromWindow = await page.evaluate(() => (window as any).__coverage__ || null)
    if (istFromWindow && typeof istFromWindow === 'object') {
      map.merge(istFromWindow as any)
    }
  } catch {}
  for (const entry of jsCoverage) {
    try {
      // Only include our app/library chunks, skip Next runtime/vendor
      if (!entry.url) continue
      const isAppChunk = /\/_next\/static\/chunks\//.test(entry.url)
      if (!isAppChunk) continue
      const res = await fetch(entry.url)
      if (!res.ok) continue
      const source = await res.text()
      // Try to fetch source map for better attribution
      let sourceMap
      const smMatch = /[#@]\s*sourceMappingURL=([^\n]+)/.exec(source)
      if (smMatch) {
        const smUrl = new URL(smMatch[1].trim(), entry.url).toString()
        try {
          const smRes = await fetch(smUrl)
          if (smRes.ok) sourceMap = await smRes.json()
        } catch {}
      } else {
        // Heuristic: .map next to the chunk
        try {
          const smUrl = entry.url + '.map'
          const smRes = await fetch(smUrl)
          if (smRes.ok) sourceMap = await smRes.json()
        } catch {}
      }

      const converter = v8ToIstanbul(entry.url, 0, { source, sourceMap })
      await converter.load()
      converter.applyCoverage(entry.functions as any)
      const ist = converter.toIstanbul()
      // Optionally filter sources to our workspace paths only
      const filtered: Record<string, any> = {}
      for (const [file, data] of Object.entries(ist)) {
        if (/\/(app|components|lib|contexts|hooks)\//.test(file) && !/node_modules/.test(file)) {
          filtered[file] = data as any
        }
      }
      map.merge(filtered)
    } catch {
      // ignore single-file conversion errors
    }
  }

  const outDir = path.join(process.cwd(), '.nyc_output')
  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, `playwright-worker-${testInfo.workerIndex}.json`)
  fs.writeFileSync(outPath, JSON.stringify(map.toJSON()), 'utf-8')
})

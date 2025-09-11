#!/usr/bin/env node
/* eslint-disable */
const fs = require('fs')
const path = require('path')
const { createCoverageMap } = require('istanbul-lib-coverage')
const report = require('istanbul-lib-report')
const reports = require('istanbul-reports')

function readJSONSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return null }
}

function main() {
  const root = process.cwd()
  const nycDir = path.join(root, '.nyc_output')
  const vitestJson = path.join(root, 'coverage', 'vitest', 'coverage-final.json')

  const map = createCoverageMap({})

  // Merge Vitest JSON if present (already Istanbul format)
  const vitest = readJSONSafe(vitestJson)
  if (vitest) {
    // Optionally filter to workspace sources only
    const filtered = {}
    for (const [file, data] of Object.entries(vitest)) {
      if (/\/(app|components|lib|contexts|hooks)\//.test(file) && !/node_modules/.test(file)) {
        filtered[file] = data
      }
    }
    map.merge(filtered)
  }

  // Merge all Playwright JSON files
  if (fs.existsSync(nycDir)) {
    for (const f of fs.readdirSync(nycDir)) {
      if (!f.endsWith('.json')) continue
      const data = readJSONSafe(path.join(nycDir, f))
      if (data) {
        const filtered = {}
        for (const [file, entry] of Object.entries(data)) {
          if (/\/(app|components|lib|contexts|hooks)\//.test(file) && !/node_modules/.test(file)) {
            filtered[file] = entry
          }
        }
        map.merge(filtered)
      }
    }
  }

  // Write combined json
  const outDir = path.join(root, 'coverage', 'combined')
  fs.mkdirSync(outDir, { recursive: true })
  const combinedPath = path.join(outDir, 'coverage-final.json')
  fs.writeFileSync(combinedPath, JSON.stringify(map.toJSON()), 'utf-8')

  // Generate reports
  const ctx = report.createContext({ dir: outDir, coverageMap: map })
  const reporters = [reports.create('text-summary'), reports.create('lcov'), reports.create('html')]
  for (const r of reporters) r.execute(ctx)
}

main()

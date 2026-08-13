import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const url = process.argv[2]
const out = process.argv[3] ?? 'packages/applier/test/fixtures/greenhouse-form.html'
if (!url) throw new Error('usage: tsx capture-fixture.ts <apply-url> [out-path]')

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage()
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForSelector('input, textarea, [role="combobox"]', { timeout: 30000 })
await page.evaluate(() => {
  for (const s of [...document.querySelectorAll('script')]) s.remove()
})
writeFileSync(out, await page.content())
console.log(`fixture saved to ${out}`)
await browser.close()

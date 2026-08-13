import { chromium } from 'playwright'

const url = process.argv[2]
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage()
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
await page.waitForTimeout(8000)
console.log('TITLE:', await page.title())
console.log('URL NOW:', page.url())
const text = await page.evaluate(() => document.body.innerText.slice(0, 400))
console.log('BODY TEXT:', JSON.stringify(text))
const counts = await page.evaluate(() => ({
  inputs: document.querySelectorAll('input').length,
  textareas: document.querySelectorAll('textarea').length,
  combos: document.querySelectorAll('[role="combobox"]').length,
  buttons: document.querySelectorAll('button').length,
  iframes: [...document.querySelectorAll('iframe')].map((f) => f.src.slice(0, 90)),
}))
console.log('COUNTS:', JSON.stringify(counts, null, 1))
const report = await page.evaluate(() =>
  [...document.querySelectorAll('input, textarea, select, [role="combobox"]')].slice(0, 40).map((el) => ({
    tag: el.tagName.toLowerCase(),
    type: el.getAttribute('type'),
    name: el.getAttribute('name'),
    id: el.id || null,
    aria: (el.getAttribute('aria-label') || '').slice(0, 40) || null,
  })),
)
console.log(JSON.stringify(report, null, 1))
await browser.close()
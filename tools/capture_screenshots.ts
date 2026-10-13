import puppeteer from 'puppeteer-core'

const BROWSER_PATH = '/usr/bin/vivaldi'

async function capture() {
  console.log('Launching Vivaldi in headless mode with calibrated viewport...')
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--window-size=1920,1184',
    ],
  })

  const page = await browser.newPage()
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })

  const targets = [
    {
      name: 'hero_canvas.png',
      url: 'http://localhost:8080/?workspace=canvas',
    },
    {
      name: 'cad_floorplan.png',
      url: 'http://localhost:8080/?workspace=floorplan&mode=cad',
    },
    {
      name: 'topology_workspace.png',
      url: 'http://localhost:8080/?workspace=topology',
    },
    {
      name: 'ets_diagnostics.png',
      url: 'http://localhost:8080/?workspace=diagnostics',
    },
  ]

  for (const t of targets) {
    console.log(`Capturing ${t.name} from ${t.url}...`)
    await page.goto(t.url, { waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {})
    // Wait for React rendering, SVGs, charts, and animations to stabilize
    await new Promise((resolve) => setTimeout(resolve, 3500))
    await page.screenshot({
      path: `docs/screenshots/${t.name}`,
      type: 'png',
      clip: { x: 0, y: 0, width: 1920, height: 1070 },
    })
    console.log(`✓ Saved docs/screenshots/${t.name}`)
  }

  await browser.close()
  console.log('All screenshots captured successfully!')
}

capture().catch((err) => {
  console.error('Capture failed:', err)
  process.exit(1)
})

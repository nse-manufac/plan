const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  // tests/node/ คือเทสที่รันด้วย node ล้วน (npm run test:core) — ชื่อไฟล์ *.test.js ตรงกับที่ Playwright
  // หาโดยปริยาย ถ้าไม่ข้ามไว้ Playwright จะพยายามรันแล้วพังเพราะไม่ใช่เทสของมัน
  testIgnore: '**/node/**',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8124',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'node tests/server.js 8124',
    url: 'http://127.0.0.1:8124/production_plan_tracker.html',
    reuseExistingServer: !process.env.CI,
    timeout: 20_000
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});

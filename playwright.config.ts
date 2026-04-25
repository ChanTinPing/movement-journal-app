import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: "http://127.0.0.1:4174/movement-journal-app/",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4174",
    url: "http://127.0.0.1:4174/movement-journal-app/",
    reuseExistingServer: false,
    timeout: 20_000,
  },
  projects: [
    {
      name: "mobile-chrome",
      use: devices["Pixel 7"],
    },
  ],
});

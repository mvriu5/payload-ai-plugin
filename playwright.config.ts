import { defineConfig } from "@playwright/test"

export default defineConfig({
    testDir: "./tests/e2e",
    timeout: 60_000,
    workers: 1,
    use: {
        baseURL: "http://localhost:3000",
        trace: "on-first-retry",
    },
    webServer: {
        command: "pnpm dev",
        env: {
            ...process.env,
            PAYLOAD_AI_E2E_MODE: "true",
            PAYLOAD_SECRET: process.env.PAYLOAD_SECRET ?? "test-secret",
        },
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        url: "http://localhost:3000/admin",
    },
})

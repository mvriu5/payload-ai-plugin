import { defineConfig } from "@playwright/test"

export default defineConfig({
    testDir: "./tests/e2e",
    timeout: 30_000,
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
            PAYLOAD_SECRET: (() => {
                const secret = process.env.PAYLOAD_SECRET
                if (!secret) {
                    throw new Error("PAYLOAD_SECRET is required for E2E tests. Set it in your environment.")
                }
                return secret
            })(),
        },
        port: 3000,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
})

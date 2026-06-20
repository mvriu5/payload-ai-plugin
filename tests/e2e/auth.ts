import { expect, type Page } from "@playwright/test"

const adminCredentials = {
    email: "e2e-admin@example.com",
    password: "PayloadAiE2E123!",
}

export const loginAsAdmin = async (page: Page) => {
    const bootstrapResponse = await page.request.post("/api/e2e/bootstrap")

    expect(bootstrapResponse.ok()).toBeTruthy()

    const loginResponse = await page.request.post("/api/users/login", {
        data: adminCredentials,
    })

    expect(loginResponse.ok()).toBeTruthy()

    const loginResult = (await loginResponse.json()) as {
        user?: {
            id?: number | string
        }
    }

    if (loginResult.user?.id === undefined) {
        throw new Error("Login did not return a user id.")
    }

    const updateResponse = await page.request.patch(`/api/users/${loginResult.user.id}`, {
        data: {
            aiProvider: "openai",
        },
    })

    expect(updateResponse.ok()).toBeTruthy()

    return String(loginResult.user.id)
}

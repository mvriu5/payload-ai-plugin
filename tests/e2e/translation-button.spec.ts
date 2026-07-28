import { expect, test } from "@playwright/test"

import { loginAsAdmin } from "./auth"

test("translate action appears when the secondary locale contains copied default-locale content", async ({ page }) => {
    await loginAsAdmin(page)
    const slug = `translation-button-${Date.now()}`
    const response = await page.request.post("/api/posts?locale=en", {
        data: {
            slug,
            status: "draft",
            title: "English translation source",
        },
    })
    expect(response.ok()).toBeTruthy()
    const post = await response.json()

    const copiedLocaleResponse = await page.request.patch(`/api/posts/${post.doc.id}?locale=de`, {
        data: {
            title: "English translation source",
        },
    })
    expect(copiedLocaleResponse.ok()).toBeTruthy()

    await page.goto(`/admin/collections/posts/${post.doc.id}?locale=de`)

    await expect(page.getByRole("button", { name: "Translate", exact: true })).toBeVisible()
})

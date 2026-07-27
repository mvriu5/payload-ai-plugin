import { expect, test } from "@playwright/test"

import { loginAsAdmin } from "./auth"

test("translate action appears for an empty secondary locale", async ({ page }) => {
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

    await page.goto(`/admin/collections/posts/${post.doc.id}?locale=de`)

    await expect(page.getByRole("button", { name: "Translate", exact: true })).toBeVisible()
})

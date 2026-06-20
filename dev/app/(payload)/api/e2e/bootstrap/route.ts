import config from "@payload-config"
import { getPayload } from "payload"

const e2eAdmin = {
    aiProvider: "openai",
    email: "e2e-admin@example.com",
    password: "PayloadAiE2E123!",
}

export const POST = async () => {
    if (process.env.PAYLOAD_AI_E2E_MODE !== "true") {
        return Response.json({ error: "Not found" }, { status: 404 })
    }

    const payload = await getPayload({ config })
    const existingUsers = await payload.find({
        collection: "users",
        depth: 0,
        limit: 1,
        overrideAccess: true,
        pagination: false,
        where: {
            email: {
                equals: e2eAdmin.email,
            },
        },
    })
    const existingUser = existingUsers.docs[0]

    if (!existingUser) {
        await payload.create({
            collection: "users",
            data: e2eAdmin,
            overrideAccess: true,
        })
    } else {
        await payload.update({
            collection: "users",
            data: {
                aiProvider: e2eAdmin.aiProvider,
                password: e2eAdmin.password,
            },
            id: String(existingUser.id),
            overrideAccess: true,
        })
    }

    return Response.json({ ok: true })
}

import type { PayloadHandler } from "payload"

type HandlerRequest = Parameters<PayloadHandler>[0]
type AuthenticatedRequest = HandlerRequest & {
    user: NonNullable<HandlerRequest["user"]>
}

export const jsonError = (error: string, status = 400) => Response.json({ error }, { status })

export const readJSONBody = async <Body>(req: HandlerRequest): Promise<Body | null> => {
    if (!req.json) return null

    return (await req.json().catch(() => null)) as Body | null
}

export const withAuthenticatedHandler =
    (handler: (req: AuthenticatedRequest) => Promise<Response> | Response): PayloadHandler =>
    async (req) => {
        if (!req.user) return jsonError("Unauthorized", 401)

        return handler(req as AuthenticatedRequest)
    }

export const logHandlerError = ({
    details,
    error,
    logMessage,
    publicMessage,
    req,
    status = 500,
}: {
    details?: Record<string, unknown>
    error: unknown
    logMessage: string
    publicMessage: string
    req: HandlerRequest
    status?: number
}) => {
    req.payload.logger.error({
        ...details,
        err: error,
        msg: logMessage,
    })

    return jsonError(publicMessage, status)
}

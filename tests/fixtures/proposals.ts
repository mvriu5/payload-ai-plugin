import { signAIActionProposal } from "../../src/ai/proposalSigning.js"

type ProposalOptions = {
    id?: string
    label?: string
    title?: string
}

export const unsignedUpdatePostProposal = ({ id = "4", label = "Update Jupiter", title = "Jupiter" }: ProposalOptions = {}) => ({
    action: "update" as const,
    collection: "posts",
    data: {
        title,
    },
    id,
    label,
})

export const signedUpdatePostProposal = (options?: ProposalOptions) => signAIActionProposal(unsignedUpdatePostProposal(options))

export const unsignedDeletePostProposal = ({ id = "4", label = "Delete Jupiter" }: Pick<ProposalOptions, "id" | "label"> = {}) => ({
    action: "delete" as const,
    collection: "posts",
    id,
    label,
})

export const signedDeletePostProposal = (options?: Pick<ProposalOptions, "id" | "label">) => signAIActionProposal(unsignedDeletePostProposal(options))

export const signedSensitiveUpdatePostProposal = () =>
    signAIActionProposal({
        action: "update" as const,
        collection: "posts",
        data: {
            apiKey: "secret",
        },
        id: "4",
        label: "Update Jupiter",
    })

export const mockSignedUpdatePostProposal = {
    _aiSignature: {
        expiresAt: "2026-01-01T00:10:00.000Z",
        value: "signature",
    },
    action: "update" as const,
    collection: "posts",
    id: "4",
    label: "Update Jupiter",
}

export type AIActionSignature = {
    expiresAt: string
    value: string
}

export type LocalizedDataInput = Record<string, Record<string, unknown>>

export type ProposalWritePayload =
    | {
          data: Record<string, unknown>
          localizedData?: never
      }
    | {
          data?: never
          localizedData: LocalizedDataInput
      }

export type ActionProposal = (
    | ({
          action: "create"
          collection: string
          label: string
      } & ProposalWritePayload)
    | {
          action: "delete"
          collection: string
          id: string
          label: string
      }
    | ({
          action: "update"
          collection: string
          id: string
          label: string
      } & ProposalWritePayload)
    | ({
          action: "updateGlobal"
          label: string
          slug: string
      } & ProposalWritePayload)
) & {
    _aiSignature?: AIActionSignature
    collection?: string
    id?: string
    locale?: string
    slug?: string
}

export type ActionProposalReference = {
    action: ActionProposal["action"]
    collection?: string
    id?: string
    label: string
    locale?: string
    slug?: string
}

export type ProposalDiff = {
    after: unknown
    before: unknown
}

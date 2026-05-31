import type { PayloadHandler } from 'payload'

import type { AIActionProposal } from './aiChatEndpointHandler.js'

type AIApplyActionBody = {
    proposal?: AIActionProposal
}

const isKnownCollection = (req: Parameters<PayloadHandler>[0], collection: string) => {
    return req.payload.config.collections.some((item) => item.slug === collection)
}

const isKnownGlobal = (req: Parameters<PayloadHandler>[0], slug: string) => {
    return req.payload.config.globals?.some((item) => item.slug === slug) || false
}

export const aiApplyActionEndpointHandler: PayloadHandler = async (req) => {
    if (!req.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const body = req.json ? ((await req.json().catch(() => null)) as AIApplyActionBody | null) : null

    const proposal = body?.proposal
    if (!proposal) return Response.json({ error: 'Proposal is required' }, { status: 400 })

    if (proposal.action === 'updateGlobal') {
        if (!isKnownGlobal(req, proposal.slug)) return Response.json({ error: 'Unknown global' }, { status: 400 })

        const doc = await req.payload.updateGlobal({
            data: proposal.data,
            overrideAccess: false,
            req,
            slug: proposal.slug as never,
        })

        return Response.json({ doc, status: 'applied' })
    }

    if (!isKnownCollection(req, proposal.collection)) return Response.json({ error: 'Unknown collection' }, { status: 400 })

    if (proposal.action === 'create') {
        const doc = await req.payload.create({
            collection: proposal.collection as never,
            data: proposal.data,
            overrideAccess: false,
            req,
        })

        return Response.json({ doc, status: 'applied' })
    }

    if (proposal.action === 'delete') {
        const doc = await req.payload.delete({
            collection: proposal.collection as never,
            id: proposal.id,
            overrideAccess: false,
            req,
        })

        return Response.json({ doc, status: 'applied' })
    }

    const doc = await req.payload.update({
        collection: proposal.collection as never,
        data: proposal.data,
        id: proposal.id,
        overrideAccess: false,
        req,
    })

    return Response.json({ doc, status: 'applied' })
}

import type { Config, PayloadHandler } from 'payload'

import { describe, expect, test, vi } from 'vitest'

import { createAIApplyActionEndpointHandler } from '../src/endpoints/aiApplyActionEndpointHandler.js'
import { createAIMentionSuggestionsEndpointHandler } from '../src/endpoints/aiMentionSuggestionsEndpointHandler.js'
import { payloadAiPlugin } from '../src/index.js'

type HandlerRequest = Parameters<PayloadHandler>[0]

const createRequest = ({
  body,
  payload,
}: {
  body?: unknown
  payload: HandlerRequest['payload']
}) =>
  ({
    json: vi.fn(async () => body),
    payload,
    user: { id: 'user-1' },
  }) as unknown as HandlerRequest

const createPayloadMock = () =>
  ({
    config: {
      collections: [
        {
          admin: { useAsTitle: 'title' },
          fields: [{ name: 'title', type: 'text' }],
          slug: 'posts',
        },
        {
          admin: { useAsTitle: 'alt' },
          fields: [{ name: 'alt', type: 'text' }],
          slug: 'media',
        },
      ],
      globals: [],
    },
    create: vi.fn(async ({ data }) => ({ id: 'created-doc', ...data })),
    delete: vi.fn(),
    find: vi.fn(async () => ({
      docs: [{ id: 'post-1', title: 'First post' }],
    })),
    logger: {
      error: vi.fn(),
    },
    update: vi.fn(),
  }) as unknown as HandlerRequest['payload']

describe('payloadAiPlugin', () => {
  test('registers AI fields and endpoints without replacing incoming onInit', async () => {
    const onInit = vi.fn()
    const config = {
      admin: {
        user: 'users',
      },
      collections: [
        {
          fields: [],
          slug: 'users',
        },
        {
          fields: [{ name: 'title', type: 'text' }],
          slug: 'posts',
        },
      ],
      endpoints: [],
      onInit,
    } as unknown as Config

    const result = payloadAiPlugin({
      collections: {
        posts: true,
      },
    })(config)

    const userCollection = result.collections?.find(
      (collection) => collection.slug === 'users',
    )

    expect(userCollection?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'aiProvider' }),
        expect.objectContaining({ name: 'aiApiKey' }),
      ]),
    )
    expect(result.admin?.components?.beforeDashboard).toContain(
      'payload-ai-plugin/client#AIInput',
    )
    expect(result.endpoints?.map((endpoint) => endpoint.path)).toEqual(
      expect.arrayContaining([
        '/ai-chat',
        '/ai-apply-action',
        '/ai-mention-suggestions',
      ]),
    )

    await result.onInit?.({} as never)
    expect(onInit).toHaveBeenCalledTimes(1)
  })
})

describe('createAIApplyActionEndpointHandler', () => {
  test('applies create proposals for enabled collections with access control', async () => {
    const payload = createPayloadMock()
    const req = createRequest({
      body: {
        proposal: {
          action: 'create',
          collection: 'posts',
          data: {
            title: 123,
          },
          label: 'Create post',
        },
      },
      payload,
    })
    const handler = createAIApplyActionEndpointHandler({
      collections: ['posts'],
    })

    const response = await handler(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toMatchObject({
      doc: {
        id: 'created-doc',
        title: '123',
      },
      status: 'applied',
    })
    expect(payload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'posts',
        data: {
          title: '123',
        },
        overrideAccess: false,
        req,
      }),
    )
  })

  test('rejects collection proposals outside pluginOptions.collections', async () => {
    const payload = createPayloadMock()
    const req = createRequest({
      body: {
        proposal: {
          action: 'create',
          collection: 'media',
          data: {
            alt: 'Hidden media',
          },
          label: 'Create media',
        },
      },
      payload,
    })
    const handler = createAIApplyActionEndpointHandler({
      collections: ['posts'],
    })

    const response = await handler(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toMatchObject({ error: 'Unknown collection' })
    expect(payload.create).not.toHaveBeenCalled()
  })
})

describe('createAIMentionSuggestionsEndpointHandler', () => {
  test('does not suggest documents from disabled collections', async () => {
    const payload = createPayloadMock()
    const req = createRequest({
      body: {
        collectionSlug: 'media',
      },
      payload,
    })
    const handler = createAIMentionSuggestionsEndpointHandler({
      collections: ['posts'],
    })

    const response = await handler(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ suggestions: [] })
    expect(payload.find).not.toHaveBeenCalled()
  })

  test('suggests documents from enabled collections with access control', async () => {
    const payload = createPayloadMock()
    const req = createRequest({
      body: {
        collectionSlug: 'posts',
      },
      payload,
    })
    const handler = createAIMentionSuggestionsEndpointHandler({
      collections: ['posts'],
    })

    const response = await handler(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      suggestions: [
        {
          collection: 'posts',
          id: 'post-1',
          label: 'First post',
          slug: 'posts:post-1',
          type: 'doc',
        },
      ],
    })
    expect(payload.find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'posts',
        depth: 0,
        overrideAccess: false,
        req,
      }),
    )
  })
})

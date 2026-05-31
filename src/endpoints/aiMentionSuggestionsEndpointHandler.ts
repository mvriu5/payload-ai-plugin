import type { PayloadHandler } from 'payload'

type MentionSuggestionsBody = {
  collectionMatches?: number
  query?: string
}

const isInternalCollectionSlug = (slug: string) => {
  return slug.startsWith('payload-') || slug === 'plugin-collection'
}

const getDocLabel = (
  doc: Record<string, unknown>,
  useAsTitle?: string,
) => {
  const titleField =
    useAsTitle && typeof doc[useAsTitle] === 'string' ? doc[useAsTitle] : null

  return (
    titleField ||
    doc.title ||
    doc.name ||
    doc.email ||
    doc.id ||
    'Untitled'
  ).toString()
}

export const aiMentionSuggestionsEndpointHandler: PayloadHandler = async (req) => {
  if (!req.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = req.json
    ? ((await req.json().catch(() => null)) as MentionSuggestionsBody | null)
    : null
  const query = body?.query?.trim()
  const collectionMatches = body?.collectionMatches || 0

  if (!query || collectionMatches >= 3) {
    return Response.json({ suggestions: [] })
  }

  const suggestions = []
  const collections = req.payload.config.collections.filter(
    (collection) => !isInternalCollectionSlug(collection.slug),
  )

  for (const collection of collections) {
    const searchableFields = collection.fields
      .filter(
        (field) =>
          'name' in field && ['email', 'text', 'textarea'].includes(field.type),
      )
      .map((field) => ('name' in field ? field.name : null))
      .filter(Boolean)

    if (searchableFields.length === 0) {
      continue
    }

    const result = await req.payload.find({
      collection: collection.slug as never,
      depth: 0,
      limit: 3,
      overrideAccess: false,
      req,
      where: {
        or: searchableFields.map((field) => ({
          [field as string]: {
            contains: query,
          },
        })),
      },
    })

    for (const doc of result.docs as Record<string, unknown>[]) {
      suggestions.push({
        collection: collection.slug,
        id: doc.id?.toString(),
        label: getDocLabel(doc, collection.admin?.useAsTitle),
        slug: `${collection.slug}:${doc.id?.toString()}`,
        type: 'doc',
      })
    }
  }

  return Response.json({ suggestions: suggestions.slice(0, 5) })
}

import type { PayloadHandler } from "payload";

type MentionSuggestionsBody = {
    collectionMatches?: number;
    collectionSlug?: string | null;
    query?: string;
};

const isInternalCollectionSlug = (slug: string) => {
    return slug.startsWith("payload-") || slug === "plugin-collection";
};

const getDocLabel = (doc: Record<string, unknown>, useAsTitle?: string) => {
    const titleField =
        useAsTitle && typeof doc[useAsTitle] === "string"
            ? doc[useAsTitle]
            : null;

    return (
        titleField ||
        doc.title ||
        doc.name ||
        doc.email ||
        doc.id ||
        "Untitled"
    ).toString();
};

export const aiMentionSuggestionsEndpointHandler: PayloadHandler = async (
    req,
) => {
    if (!req.user)
        return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = req.json
        ? ((await req
              .json()
              .catch(() => null)) as MentionSuggestionsBody | null)
        : null;
    const query = body?.query?.trim();
    const collectionMatches = body?.collectionMatches || 0;
    const collectionSlug = body?.collectionSlug?.trim();

    if ((!query && !collectionSlug) || collectionMatches >= 3)
        return Response.json({ suggestions: [] });

    const suggestions = [];
    const collections = req.payload.config.collections.filter((collection) => {
        if (isInternalCollectionSlug(collection.slug)) return false;
        if (collectionSlug) return collection.slug === collectionSlug;

        return true;
    });

    for (const collection of collections) {
        const searchableFields = collection.fields
            .filter(
                (field) =>
                    "name" in field &&
                    ["email", "text", "textarea"].includes(field.type),
            )
            .map((field) => ("name" in field ? field.name : null))
            .filter(Boolean);

        if (query && searchableFields.length === 0) continue;

        const result = await req.payload.find({
            collection: collection.slug as never,
            depth: 0,
            limit: 3,
            overrideAccess: false,
            req,
            where:
                query && searchableFields.length > 0
                    ? {
                          or: searchableFields.map((field) => ({
                              [field as string]: {
                                  contains: query,
                              },
                          })),
                      }
                    : undefined,
        });

        for (const doc of result.docs as Record<string, unknown>[]) {
            suggestions.push({
                collection: collection.slug,
                id: doc.id?.toString(),
                label: getDocLabel(doc, collection.admin?.useAsTitle),
                slug: `${collection.slug}:${doc.id?.toString()}`,
                type: "doc",
            });
        }
    }

    return Response.json({ suggestions: suggestions.slice(0, 5) });
};

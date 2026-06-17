import type { PayloadHandler } from "payload";

type AIRecentChangesEndpointOptions = {
  changeLogCollection: string;
};

const getNumber = (value: unknown) => {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

const getString = (value: unknown) => {
  return typeof value === "string" ? value : null;
};

export const createAIRecentChangesEndpointHandler =
  (options: AIRecentChangesEndpointOptions): PayloadHandler =>
  async (req) => {
    if (!req.user)
      return Response.json({ error: "Unauthorized" }, { status: 401 });

    const result = await req.payload.find({
      collection: options.changeLogCollection as never,
      depth: 0,
      limit: 12,
      overrideAccess: false,
      req,
      sort: "-createdAt",
    });

    return Response.json({
      changes: result.docs.map((doc) => ({
        additions: getNumber(doc.additions),
        removals: getNumber(doc.removals),
        title: getString(doc.title) || "AI change",
        url: getString(doc.targetURL),
      })),
    });
  };

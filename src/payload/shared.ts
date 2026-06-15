export const getSerializableLabel = (label: unknown, fallback?: string) => {
  if (typeof label === "string") return label;

  if (label && typeof label === "object") {
    const firstLabel = Object.values(label).find(
      (value) => typeof value === "string",
    );

    if (typeof firstLabel === "string") return firstLabel;
  }

  return fallback;
};

export const isInternalCollection = (slug: string) => {
  return slug.startsWith("payload-") || slug === "plugin-collection";
};

import { postgresAdapter } from "@payloadcms/db-postgres";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import path from "path";
import type { Block } from "payload";
import { buildConfig } from "payload";
import { payloadAiPlugin } from "payload-ai-plugin";
import sharp from "sharp";
import { fileURLToPath } from "url";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

if (!process.env.ROOT_DIR) {
  process.env.ROOT_DIR = dirname;
}

const heroBlock: Block = {
  slug: "hero",
  fields: [
    {
      name: "headline",
      type: "text",
      required: true,
    },
    {
      name: "subline",
      type: "textarea",
    },
    {
      name: "image",
      type: "upload",
      relationTo: "media",
    },
  ],
};

const ctaBlock: Block = {
  slug: "cta",
  fields: [
    {
      name: "label",
      type: "text",
      required: true,
    },
    {
      name: "href",
      type: "text",
      required: true,
    },
    {
      name: "style",
      type: "select",
      defaultValue: "primary",
      options: [
        {
          label: "Primary",
          value: "primary",
        },
        {
          label: "Secondary",
          value: "secondary",
        },
      ],
    },
  ],
};

const galleryBlock: Block = {
  slug: "gallery",
  fields: [
    {
      name: "title",
      type: "text",
    },
    {
      name: "images",
      type: "array",
      fields: [
        {
          name: "image",
          type: "upload",
          relationTo: "media",
        },
        {
          name: "caption",
          type: "text",
        },
      ],
    },
  ],
};

export default buildConfig({
  admin: {
    importMap: {
      baseDir: path.resolve(dirname),
    },
    user: "users",
  },
  collections: [
    {
      slug: "users",
      auth: true,
      versions: true,
      fields: [],
    },
    {
      slug: "posts",
      admin: {
        defaultColumns: [
          "title",
          "status",
          "category",
          "featured",
          "publishedAt",
        ],
        useAsTitle: "title",
      },
      versions: true,
      fields: [
        {
          name: "title",
          type: "text",
          required: true,
        },
        {
          name: "slug",
          type: "text",
          index: true,
          unique: true,
        },
        {
          name: "excerpt",
          type: "textarea",
        },
        {
          name: "content",
          type: "richText",
        },
        {
          name: "status",
          type: "select",
          defaultValue: "draft",
          options: [
            {
              label: "Draft",
              value: "draft",
            },
            {
              label: "Published",
              value: "published",
            },
            {
              label: "Archived",
              value: "archived",
            },
          ],
        },
        {
          name: "category",
          type: "radio",
          defaultValue: "news",
          options: [
            {
              label: "News",
              value: "news",
            },
            {
              label: "Guide",
              value: "guide",
            },
            {
              label: "Opinion",
              value: "opinion",
            },
          ],
        },
        {
          name: "featured",
          type: "checkbox",
          defaultValue: false,
        },
        {
          name: "publishedAt",
          type: "date",
          admin: {
            date: {
              pickerAppearance: "dayAndTime",
            },
          },
        },
        {
          name: "heroImage",
          type: "upload",
          relationTo: "media",
        },
        {
          name: "tags",
          type: "array",
          fields: [
            {
              name: "label",
              type: "text",
              required: true,
            },
          ],
        },
        {
          name: "seo",
          type: "group",
          fields: [
            {
              name: "title",
              type: "text",
            },
            {
              name: "description",
              type: "textarea",
            },
          ],
        },
        {
          name: "relatedPosts",
          type: "relationship",
          hasMany: true,
          relationTo: "posts",
        },
        {
          name: "metadata",
          type: "json",
        },
        {
          name: "layout",
          type: "blocks",
          blocks: [heroBlock, ctaBlock, galleryBlock],
        },
      ],
    },
    {
      slug: "media",
      fields: [],
      versions: true,
      upload: {
        staticDir: path.resolve(dirname, "media"),
      },
    },
  ],
  globals: [
    {
      slug: "site-settings",
      label: "Site Settings",
      versions: true,
      fields: [
        {
          name: "siteName",
          type: "text",
          required: true,
        },
        {
          name: "defaultSeo",
          type: "group",
          fields: [
            {
              name: "title",
              type: "text",
            },
            {
              name: "description",
              type: "textarea",
            },
          ],
        },
        {
          name: "homepageSections",
          type: "blocks",
          blocks: [heroBlock, ctaBlock, galleryBlock],
        },
      ],
    },
    {
      slug: "navigation",
      label: "Navigation",
      versions: true,
      fields: [
        {
          name: "items",
          type: "array",
          fields: [
            {
              name: "label",
              type: "text",
              required: true,
            },
            {
              name: "url",
              type: "text",
              required: true,
            },
          ],
        },
      ],
    },
  ],
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URL,
    },
  }),
  editor: lexicalEditor(),
  plugins: [
    payloadAiPlugin({
      collections: {
        posts: true,
      },
    }),
  ],
  secret: process.env.PAYLOAD_SECRET!,
  sharp,
  typescript: {
    outputFile: path.resolve(dirname, "payload-types.ts"),
  },
});

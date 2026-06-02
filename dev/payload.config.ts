import { postgresAdapter } from "@payloadcms/db-postgres";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import path from "path";
import { buildConfig } from "payload";
import { payloadAiPlugin } from "payload-ai-plugin";
import sharp from "sharp";
import { fileURLToPath } from "url";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

if (!process.env.ROOT_DIR) {
    process.env.ROOT_DIR = dirname;
}

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
            ],
        },
        {
            slug: "media",
            fields: [],
            upload: {
                staticDir: path.resolve(dirname, "media"),
            },
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

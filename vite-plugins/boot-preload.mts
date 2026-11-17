import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

const URLS_FILE = path.join("src", "data", "boot-preload-urls.generated.json");

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

export function addBootPreloads(html: string, urls: string[]): string {
  const tags = urls
    .map(
      (url) =>
        `<link rel="preload" as="fetch" href="${escapeAttribute(url)}" crossorigin>`,
    )
    .filter((tag) => !html.includes(tag));
  if (!tags.length) return html;
  return html.replace("</head>", `${tags.join("\n")}\n</head>`);
}

export function readBootUrls(file: string): string[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (url): url is string =>
        typeof url === "string" && url.startsWith("/api/items?"),
    );
  } catch {
    return [];
  }
}

export default function bootPreload(root: string): Plugin {
  return {
    name: "boot-preload",
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        if (ctx.path !== "/index.html") return html;
        return addBootPreloads(html, readBootUrls(path.join(root, URLS_FILE)));
      },
    },
  };
}

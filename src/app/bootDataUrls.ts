import type { ItemsApiClient } from "./ItemsApiClient";

const BOOT_SHAPES = [
  "facets",
  "storylines",
  "shelves",
  "music",
  "heroes",
  "set_of_works",
] as const;

export function bootDataUrls(client: ItemsApiClient): string[] {
  return BOOT_SHAPES.map((shape) => client.apiUrl({ shape }));
}

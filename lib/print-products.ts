import { TRANQUILO_CONFIG } from "./config.generated.ts";

export type Orientation = "hor" | "ver";

const UIDS = TRANQUILO_CONFIG["print.gelato_products"] as Record<
  string,
  string
>;
const ORIENTED = new Set(["poster", "framed", "mini_print"]);

export function orientationOf(width: number, height: number): Orientation {
  return width >= height ? "hor" : "ver";
}

export function gelatoProductUid(
  product: string,
  orientation: Orientation,
): string | null {
  const key = ORIENTED.has(product) ? `${product}_${orientation}` : product;
  return UIDS[key] ?? null;
}

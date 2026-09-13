// pages/404.html's entry point. Built to the OUTPUT ROOT (see
// vite.config.mts's `notFound` entry), not under pages/, so Vercel's
// static-output convention serves it automatically -- with a real 404
// status -- for any unmatched path, no vercel.json rewrite needed.
import { renderErrorState } from "../errorState";

const root = document.getElementById("notFoundRoot");
if (root) {
  root.appendChild(renderErrorState({ detail: "404 — Page not found" }));
}

// Static, bundled art for the offline/error states (404.html and
// TranquiloErrorState) -- deliberately NOT fetched from /api/items or the
// img proxy, since the whole point of this pool is to render correctly
// even when Neon or our own serverless functions are down. Images are
// real files under assets/error-art/, imported so Vite hashes and copies
// them as plain static assets served straight off the CDN, with nothing
// in the request path but static file hosting.
//
// Metadata (title/artist/date/medium/credit/license/url) pulled directly
// from the `items` table for these ten (source, native_id) pairs -- same
// fields TranquiloDetailModal.ts shows, so the attribution here matches
// what a visitor would see on the real piece.

import cleveland142738 from "../../assets/error-art/cleveland-142738.jpg";
import cleveland142745 from "../../assets/error-art/cleveland-142745.webp";
import cleveland147576 from "../../assets/error-art/cleveland-147576.jpg";
import cleveland155432 from "../../assets/error-art/cleveland-155432.jpg";
import met42179 from "../../assets/error-art/met-42179.webp";
import met196439 from "../../assets/error-art/met-196439.jpg";
import met323944 from "../../assets/error-art/met-323944.jpg";
import met436528 from "../../assets/error-art/met-436528.jpg";
import met544864 from "../../assets/error-art/met-544864.jpg";
import met548504 from "../../assets/error-art/met-548504.jpg";

export interface ErrorArtItem {
  source: string;
  native_id: string;
  img: string;
  title: string;
  artist: string;
  date: string;
  medium: string;
  credit: string;
  license: string;
  url: string;
}

export const ERROR_ART: ErrorArtItem[] = [
  {
    source: "met",
    native_id: "548504",
    img: met548504,
    title: "Female Monkey Holding Its Baby",
    artist: "Unknown",
    date: "ca. 1981–1802 B.C.",
    medium: "Amethyst",
    credit: "Gift of Norbert Schimmel Trust, 1989",
    license: "cc0",
    url: "https://www.metmuseum.org/art/collection/search/548504",
  },
  {
    source: "met",
    native_id: "323944",
    img: met323944,
    title: "Vessel in form of horned quadruped",
    artist: "Unknown",
    date: "ca. 700–550 BCE",
    medium: "Ceramic",
    credit: "Rogers Fund, 1943",
    license: "cc0",
    url: "https://www.metmuseum.org/art/collection/search/323944",
  },
  {
    source: "met",
    native_id: "544864",
    img: met544864,
    title: "Statuette of a hippo goddess, probably Taweret",
    artist: "Unknown",
    date: "332–30 BCE",
    medium: "Glassy faience",
    credit: "Purchase, Edward S. Harkness Gift, 1926",
    license: "cc0",
    url: "https://www.metmuseum.org/art/collection/search/544864",
  },
  {
    source: "cleveland",
    native_id: "142745",
    img: cleveland142745,
    title: "Sleeping Puppies on a Mat",
    artist: "House of Fabergé",
    date: "c. 1895–1915",
    medium: "agate, chalcedony",
    credit: "The India Early Minshall Collection",
    license: "cc0",
    url: "https://clevelandart.org/art/1966.451",
  },
  {
    source: "cleveland",
    native_id: "155432",
    img: cleveland155432,
    title: "Crocodile Pendant",
    artist: "Unknown",
    date: "1000–1550",
    medium: "cast gold, modern greenstone",
    credit: "Gift of Mr. and Mrs. James C. Gruener",
    license: "cc0",
    url: "https://clevelandart.org/art/1990.160",
  },
  {
    source: "met",
    native_id: "42179",
    img: met42179,
    title: "Reclining tiger",
    artist: "Unknown",
    date: "4th–3rd century BCE",
    medium: "Bronze",
    credit: "Gift of Ernest Erickson Foundation, 1985",
    license: "cc0",
    url: "https://www.metmuseum.org/art/collection/search/42179",
  },
  {
    source: "cleveland",
    native_id: "142738",
    img: cleveland142738,
    title: "Parrot on a Perch",
    artist: "House of Fabergé",
    date: "1896–1903",
    medium: "silver, enamel, jasper, agate, emeralds",
    credit: "The India Early Minshall Collection",
    license: "cc0",
    url: "https://clevelandart.org/art/1966.447",
  },
  {
    source: "cleveland",
    native_id: "147576",
    img: cleveland147576,
    title: "Mirror with Phoenixes, Birds, Butterflies, and Floral Sprays",
    artist: "Unknown",
    date: "700s",
    medium: "bronze with silver and gold inlaid lacquer",
    credit: "Leonard C. Hanna Jr. Fund",
    license: "cc0",
    url: "https://clevelandart.org/art/1973.74",
  },
  {
    source: "met",
    native_id: "196439",
    img: met196439,
    title: "The Little Fourteen-Year-Old Dancer",
    artist: "Edgar Degas",
    date: "1922 (cast)",
    medium: "Tinted bronze, cotton, silk, wood",
    credit: "H. O. Havemeyer Collection, Bequest of Mrs. H. O. Havemeyer, 1929",
    license: "cc0",
    url: "https://www.metmuseum.org/art/collection/search/196439",
  },
  {
    source: "met",
    native_id: "436528",
    img: met436528,
    title: "Irises",
    artist: "Vincent van Gogh",
    date: "1890",
    medium: "Oil on canvas",
    credit: "Gift of Adele R. Levy, 1958",
    license: "cc0",
    url: "https://www.metmuseum.org/art/collection/search/436528",
  },
];

export function pickRandomErrorArt(): ErrorArtItem {
  return ERROR_ART[Math.floor(Math.random() * ERROR_ART.length)];
}

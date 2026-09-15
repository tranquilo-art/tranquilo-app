// Pre-flight checks and apply-planning for a TRA-274 Phase 3 vibe-tag
// batch, shared by scripts/check_vibe_tag_batch.mts and
// scripts/apply_vibe_tag_batch.mts -- same "extract the testable logic,
// keep the script a thin DB/CLI wrapper" shape as lib/tea-voice-check.ts
// and check_tea_voice_batch.mts.
//
// ERRORS are factual and block the batch (an id that doesn't resolve, a
// tag outside the vocabulary). WARNINGS inform a human reviewer but don't
// block -- an unusual-but-not-wrong shape.

// Mirrors artscroll-poc's (private, separate repo) python/ingest/
// vibe_taxonomy.py VOCABULARY exactly -- that Python module is the real
// source of truth, since it's what the model is actually prompted
// against. The two repos don't share a single file; keep this in sync by
// hand if the vocabulary changes, there is no automated check across the
// repo boundary for this.
export const VOCABULARY = [
  "Chiaroscuro",
  "Luminous",
  "Nocturnal",
  "Misty",
  "Incandescent",
  "Serene",
  "Melancholic",
  "Agitated",
  "Whimsical",
  "Intimate",
  "Botanical",
  "Architectural",
  "Ephemeral",
  "Minimalist",
  "Textural",
];

export interface VibeTagCandidate {
  id: string;
  native_id?: string;
  title?: string;
  primary_vibe: string | null;
  secondary_vibes?: string[];
  confidence_reason?: string;
}

export interface VibeTagItemRow {
  id: string;
  review_status: string;
  vibe_tags: string[] | null;
}

export interface Finding {
  level: "error" | "warning";
  message: string;
}

const UNSERVEABLE_STATUSES = ["quarantined", "rejected", "delisted"];

// A bare object => Set<string> would work too, but returning the actual
// duplicated ids (not just a boolean) is what check_vibe_tag_batch.mts's
// per-candidate loop needs to report which specific id was duplicated.
export function findDuplicateIds(candidates: { id: string }[]): Set<string> {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c.id)) dupes.add(c.id);
    seen.add(c.id);
  }
  return dupes;
}

// One candidate's findings against the item it claims to describe.
// `item` is undefined when the id didn't resolve at all -- checked first
// and short-circuits the rest, since every other check needs a real row
// to check against (review_status, existing vibe_tags).
export function checkCandidate(
  candidate: VibeTagCandidate,
  item: VibeTagItemRow | undefined,
  isDuplicate: boolean,
): Finding[] {
  const findings: Finding[] = [];
  if (!item) {
    findings.push({ level: "error", message: "no such item in the catalogue" });
    return findings;
  }
  if (UNSERVEABLE_STATUSES.includes(item.review_status)) {
    findings.push({
      level: "error",
      message: `item is ${item.review_status} -- must not receive a vibe tag`,
    });
  }
  if (isDuplicate) {
    findings.push({
      level: "error",
      message: "duplicate id within this batch",
    });
  }
  if (
    candidate.primary_vibe !== null &&
    !VOCABULARY.includes(candidate.primary_vibe)
  ) {
    findings.push({
      level: "error",
      message: `primary_vibe "${candidate.primary_vibe}" is outside the closed vocabulary`,
    });
  }
  for (const tag of candidate.secondary_vibes || []) {
    if (!VOCABULARY.includes(tag)) {
      findings.push({
        level: "error",
        message: `secondary vibe "${tag}" is outside the closed vocabulary`,
      });
    }
  }
  if (
    candidate.primary_vibe === null &&
    (candidate.secondary_vibes || []).length > 0
  ) {
    findings.push({
      level: "warning",
      message:
        "no primary vibe but secondary vibes are present -- unusual; confirm this is intended",
    });
  }
  if (item.vibe_tags != null) {
    findings.push({
      level: "warning",
      message: `item already has vibe_tags (${JSON.stringify(item.vibe_tags)}) -- applying this batch will overwrite it`,
    });
  }
  return findings;
}

export interface PlanRow {
  id: string;
  vibeTags: string[];
  previous: string[] | null;
}

export interface ApplyPlan {
  plan: PlanRow[];
  problems: string[];
}

// The same ERROR-level checks checkCandidate() runs, but collected as a
// flat problem list for a single whole-batch refuse/proceed decision --
// apply_vibe_tag_batch.mts must never trust that check_vibe_tag_batch.mts
// ran first, so it re-validates independently rather than importing the
// check's own pass/fail result.
export function planApply(
  candidates: VibeTagCandidate[],
  itemsById: Map<string, VibeTagItemRow>,
): ApplyPlan {
  const dupes = findDuplicateIds(candidates);
  const problems: string[] = [];

  for (const c of candidates) {
    if (dupes.has(c.id)) problems.push(`${c.id}: duplicate id in batch`);
    if (c.primary_vibe !== null && !VOCABULARY.includes(c.primary_vibe)) {
      problems.push(
        `${c.id}: primary_vibe "${c.primary_vibe}" outside vocabulary`,
      );
    }
    for (const tag of c.secondary_vibes || []) {
      if (!VOCABULARY.includes(tag)) {
        problems.push(`${c.id}: secondary vibe "${tag}" outside vocabulary`);
      }
    }
    const item = itemsById.get(c.id);
    if (!item) {
      problems.push(`${c.id}: no such item in the catalogue`);
    } else if (UNSERVEABLE_STATUSES.includes(item.review_status)) {
      problems.push(`${c.id}: item is ${item.review_status}`);
    }
  }

  // A candidate with primary_vibe: null gets vibeTags: [] (not left as
  // the item's current value), not left NULL -- NULL means "never
  // classified", [] means "classified, human-confirmed no vibe applies".
  // Without this distinction a future mining run would re-select and
  // re-pay to reclassify the same item (mine_vibe_tags.py's own selection
  // is WHERE vibe_tags IS NULL).
  const plan: PlanRow[] = candidates.map((c) => ({
    id: c.id,
    vibeTags:
      c.primary_vibe === null
        ? []
        : [c.primary_vibe, ...(c.secondary_vibes || [])],
    previous: itemsById.get(c.id)?.vibe_tags ?? null,
  }));

  return { plan, problems };
}

// "structural" connections are visible directly in existing item fields
// (same artist, same subject); "narrative" connections are a real
// historical fact not visible in the fields and always carry a source_note.
export enum StorylineTier {
  Structural = "structural",
  Narrative = "narrative",
}

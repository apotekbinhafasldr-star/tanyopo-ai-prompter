import { z } from "zod";

/**
 * Structured output contract for the Content Studio generator (product
 * spec §21). `video_script` is only meaningful for VIDEO_SCRIPT content —
 * left null otherwise rather than an empty string, so the UI can tell
 * "not applicable" apart from "generated empty".
 */
export const ContentGenerationSchema = z.object({
  hook: z.string().describe("Opening line meant to stop the scroll"),
  caption: z.string(),
  body: z.string(),
  cta: z.string().max(60),
  hashtags: z.array(z.string()).max(15),
  creative_brief: z.string().describe("Short note for whoever produces the accompanying visual"),
  video_script: z.string().nullable(),
});

export type ContentGeneration = z.infer<typeof ContentGenerationSchema>;

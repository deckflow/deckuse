import { z } from 'zod';

export const textAssertionsSchema = z
  .array(
    z
      .object({
        text: z.string().min(1),
        count: z.number().int().min(0),
        slide: z.number().int().positive().optional(),
      })
      .strict(),
  )
  .min(1)
  .max(1000);

const inspectionSchema = z.object({
  slides: z.array(
    z.object({
      page: z.number().int().positive(),
      text: z.array(z.object({ target: z.string(), text: z.string() })),
    }),
  ),
});

/** Counts matching text objects (not substring occurrences), from one snapshot. */
export function checkTextAssertions(input: unknown, inspection: unknown) {
  const assertions = textAssertionsSchema.parse(input);
  const snapshot = inspectionSchema.parse(inspection);
  return assertions.map((assertion) => {
    const pages = snapshot.slides.filter(
      (s) => assertion.slide === undefined || s.page === assertion.slide,
    );
    const targets = pages.flatMap((s) =>
      s.text.filter((t) => t.text.includes(assertion.text)).map((t) => t.target),
    );
    return {
      ...assertion,
      actual: targets.length,
      valid: pages.length > 0 && targets.length === assertion.count,
      targets,
    };
  });
}

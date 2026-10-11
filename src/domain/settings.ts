import { z } from "zod";
export const speechConcurrencyOptions = [2, 4, 6, 8, 12, 16, 20] as const;
export const settingsSchema = z.object({
  autoTranscribe: z.boolean(),
  jevConsistency: z.boolean().optional(),
  speechMode: z.enum(["fast", "accurate"]),
  speechConcurrency: z.union([
    z.literal(2),
    z.literal(4),
    z.literal(6),
    z.literal(8),
    z.literal(12),
    z.literal(16),
    z.literal(20),
  ]),
});
export type AppSettings = z.infer<typeof settingsSchema>;
export const defaultSettings: AppSettings = {
  autoTranscribe: true,
  jevConsistency: false,
  speechMode: "fast",
  speechConcurrency: 20,
};

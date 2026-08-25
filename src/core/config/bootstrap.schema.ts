import { z } from "zod";

const color = z
  .string()
  .regex(/^(#[0-9a-f]{6}|rgba?\(.+\))$/i, "Expected a safe color value");

export const semanticPaletteSchema = z.object({
  primary: color,
  onPrimary: color,
  background: color,
  surface: color,
  surfaceVariant: color,
  text: color,
  textMuted: color,
  border: color,
  success: color,
  warning: color,
  danger: color,
  info: color,
  pricePositive: color,
  priceNegative: color,
  risk: color,
  focus: color,
  backdrop: color,
});

export const bootstrapSchema = z.object({
  schemaVersion: z.literal(1),
  configVersion: z.string().min(1),
  generatedAt: z.iso.datetime(),
  ttlSeconds: z.number().int().positive().max(86_400),
  requestId: z.string().min(1),
  localization: z.object({
    selectedLocale: z.enum(["zh-CN", "en-US"]),
    fallbackLocale: z.literal("zh-CN"),
    supportedLocales: z.array(z.enum(["zh-CN", "en-US"])).min(1),
    messagesVersion: z.string().min(1),
    messages: z.record(z.string(), z.string()),
  }),
  theme: z.object({
    defaultMode: z.literal("system"),
    allowUserOverride: z.literal(true),
    paletteVersion: z.string().min(1),
    light: semanticPaletteSchema,
    dark: semanticPaletteSchema,
  }),
  features: z.object({
    updateCenter: z.boolean(),
    otaEnabled: z.boolean(),
    directUpdateEnabled: z.boolean(),
    diagnosticsEnabled: z.boolean(),
  }),
  app: z.object({
    version: z.string().min(1),
    buildNumber: z.string().min(1),
    platform: z.enum(["ios", "android"]),
    distribution: z.enum(["store", "direct", "mdm", "development"]),
    runtimeVersion: z.string().min(1),
  }),
  update: z.object({
    decision: z.enum(["none", "optional", "recommended", "required"]),
    minSupportedVersion: z.string().min(1),
    latestVersion: z.string().min(1),
    releaseNotes: z.array(z.string()),
    ota: z.object({
      enabled: z.boolean(),
      channel: z.string().min(1),
      runtimeVersion: z.string().min(1),
    }),
    full: z.object({
      channel: z.enum(["store", "direct", "mdm", "development"]),
      actionUrl: z.url().nullable(),
      artifactId: z.string().nullable(),
      sha256: z.string().nullable(),
      size: z.number().int().positive().nullable(),
    }),
  }),
  support: z.object({
    diagnosticId: z.string().min(1),
    statusPageUrl: z.url(),
  }),
});

export type BootstrapConfig = z.infer<typeof bootstrapSchema>;
export type SemanticPalette = z.infer<typeof semanticPaletteSchema>;
export type SupportedLocale = BootstrapConfig["localization"]["selectedLocale"];

import { z } from "zod";

const color = z
  .string()
  .regex(/^(#[0-9a-f]{6}|rgba?\(.+\))$/i, "Expected a safe color value");

export const languageCodeSchema = z
  .string()
  .regex(
    /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|[0-9]{3}))?$/,
    "Expected canonical BCP 47 language code",
  );

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

export const brandingAssetSchema = z.object({
  assetId: z.string().min(1),
  objectKey: z.string().min(1),
  fileUrl: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.enum(["image/png", "image/jpeg"]),
  size: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  width: z.number().int().min(64).max(4096),
  height: z.number().int().min(64).max(4096),
  localFileUrl: z.string().optional(),
});

const brandingVisualSchema = z.object({
  backgroundColor: color,
  logo: brandingAssetSchema.optional(),
  backgroundImage: brandingAssetSchema.optional(),
});

const localeCatalogItemSchema = z.object({
  code: languageCodeSchema,
  label: z.string().min(1),
  nativeName: z.string().min(1),
});

export const brandingSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.number().int().positive(),
  enabled: z.boolean(),
  selectedLocale: languageCodeSchema,
  fallbackLocale: languageCodeSchema,
  launch: z.object({
    enabled: z.boolean(),
    minDisplayMs: z.number().int().min(0).max(3000),
    maxDisplayMs: z.number().int().min(300).max(5000),
    animation: z.object({
      type: z.enum(["fade_scale", "fade", "none"]),
      durationMs: z.number().int().min(0).max(1500),
    }),
    title: z.string(),
    subtitle: z.string(),
    visuals: z.object({
      light: brandingVisualSchema,
      dark: brandingVisualSchema,
    }),
  }),
  cachePolicy: z.object({
    maxBytes: z
      .number()
      .int()
      .min(1024 * 1024)
      .max(100 * 1024 * 1024),
    keepVersions: z.number().int().min(1).max(3),
    staleAfterSeconds: z.number().int().min(86400).max(2592000),
  }),
});

export const bootstrapSchema = z.object({
  schemaVersion: z.literal(1),
  configVersion: z.string().min(1),
  generatedAt: z.iso.datetime(),
  ttlSeconds: z.number().int().positive().max(86_400),
  requestId: z.string().min(1),
  localization: z.object({
    selectedLocale: languageCodeSchema,
    fallbackLocale: languageCodeSchema,
    supportedLocales: z.array(languageCodeSchema).min(1),
    localeCatalog: z.array(localeCatalogItemSchema).min(1).optional(),
    messagesVersion: z.string().min(1),
    refreshIntervalSeconds: z.number().int().min(300).max(86400).optional(),
    messages: z.record(z.string(), z.string()),
    resource: z
      .object({
        version: z.string(),
        objectKey: z.string(),
        fileUrl: z.string(),
        sha256: z.string(),
        size: z.number().int().nonnegative(),
        publishedAt: z.iso.datetime(),
      })
      .nullable()
      .optional(),
  }),
  theme: z.object({
    defaultMode: z.literal("system"),
    allowUserOverride: z.boolean(),
    paletteVersion: z.string().min(1),
    light: semanticPaletteSchema,
    dark: semanticPaletteSchema,
  }),
  modules: z
    .object({
      predict: z.boolean(),
      dex: z.boolean(),
    })
    .default({ predict: true, dex: true })
    .refine((value) => value.predict || value.dex, {
      message: "At least one business module must be enabled",
    }),
  /** 服务端下发的钱包参数：projectId 是客户端标识（非密钥），按租户下发免重打包 */
  wallet: z
    .object({
      walletConnectProjectId: z.string(),
      chains: z.array(z.enum(["bsc", "eth", "base"])).min(1),
      // 端点按租户下发；老服务端没有这段时用 chains 推默认值，
      // 不能因为版本落后就让整个 bootstrap 解析失败
      networks: z
        .array(
          z.object({
            id: z.enum(["bsc", "eth", "base"]),
            chainId: z.number().int().positive(),
            rpcUrls: z.array(z.url()),
            explorerUrl: z.url(),
          }),
        )
        .optional(),
    })
    .default({ walletConnectProjectId: "", chains: ["bsc", "eth", "base"] }),
  features: z.object({
    updateCenter: z.boolean(),
    otaEnabled: z.boolean(),
    directUpdateEnabled: z.boolean(),
    diagnosticsEnabled: z.boolean(),
  }),
  branding: brandingSchema.optional(),
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
      applyStrategy: z.enum(["next_launch", "immediate"]).nullable().optional(),
      revision: z.number().int().positive().nullable().optional(),
      updateId: z.string().min(1).nullable().optional(),
      baseReleaseId: z.string().min(1).nullable().optional(),
      releaseNotes: z.array(z.string()).optional(),
    }),
    full: z.object({
      channel: z.enum(["store", "direct", "mdm", "development"]),
      actionUrl: z.url().nullable(),
      releaseId: z.string().nullable(),
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
export type BrandingAsset = z.infer<typeof brandingAssetSchema>;
export type SemanticPalette = z.infer<typeof semanticPaletteSchema>;
export type SupportedLocale = string;

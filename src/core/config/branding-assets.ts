import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import { File } from "expo-file-system";
import { z } from "zod";
import {
  brandingAssetSchema,
  type BrandingAsset,
  type BootstrapConfig,
} from "./bootstrap.schema";
import { appRuntime } from "../network/api-client";

type CachedAsset = BrandingAsset & { localFileUrl: string; cachedAt: number };
const cachedAssetsSchema = z.array(
  brandingAssetSchema.extend({
    localFileUrl: z.string().startsWith("file://"),
    cachedAt: z.number().int().nonnegative(),
  }),
);
const CACHE_DIRECTORY = `${FileSystem.documentDirectory}branding/${encodeURIComponent(appRuntime.apiBaseUrl)}-${appRuntime.applicationId}/`;

export function brandingAssetUrl(asset: BrandingAsset): string {
  return /^https?:\/\//i.test(asset.fileUrl)
    ? asset.fileUrl
    : new URL(asset.fileUrl, `${appRuntime.apiBaseUrl}/`).toString();
}

export type BrandingVisual = {
  backgroundColor: string;
  logo?: BrandingAsset & { localFileUrl?: string };
  backgroundImage?: BrandingAsset & { localFileUrl?: string };
};

export function resolveBrandingVisual(
  visuals: { light: BrandingVisual; dark: BrandingVisual },
  theme: "light" | "dark",
): BrandingVisual {
  const selected = visuals[theme];
  const secondary = visuals[theme === "light" ? "dark" : "light"];
  return {
    ...selected,
    logo: selected.logo ?? secondary.logo,
    backgroundImage: selected.backgroundImage ?? secondary.backgroundImage,
  };
}

async function readIndex(): Promise<CachedAsset[]> {
  try {
    const value = await FileSystem.readAsStringAsync(
      `${CACHE_DIRECTORY}index.json`,
    );
    const parsed = cachedAssetsSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

async function writeIndex(items: CachedAsset[]): Promise<void> {
  await FileSystem.makeDirectoryAsync(CACHE_DIRECTORY, { intermediates: true });
  await FileSystem.writeAsStringAsync(
    `${CACHE_DIRECTORY}index.json`,
    JSON.stringify(items),
  );
}

export async function getCachedBrandingAsset(
  assetId: string,
): Promise<CachedAsset | null> {
  const item = (await readIndex()).find(
    (candidate) => candidate.assetId === assetId,
  );
  if (!item) return null;
  const info = await FileSystem.getInfoAsync(item.localFileUrl);
  return info.exists && !info.isDirectory && info.size === item.size
    ? item
    : null;
}

export async function cacheBrandingAsset(
  asset: BrandingAsset,
  onProgress?: (percentage: number) => void,
): Promise<CachedAsset> {
  await FileSystem.makeDirectoryAsync(CACHE_DIRECTORY, { intermediates: true });
  const extension = asset.mimeType === "image/jpeg" ? ".jpg" : ".png";
  const temporary = `${CACHE_DIRECTORY}${asset.assetId}.part`;
  const target = `${CACHE_DIRECTORY}${asset.assetId}${extension}`;
  const task = FileSystem.createDownloadResumable(
    brandingAssetUrl(asset),
    temporary,
    { headers: { Accept: asset.mimeType } },
    ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      const total =
        totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : asset.size;
      onProgress?.(
        total > 0
          ? Math.min(100, Math.round((totalBytesWritten / total) * 100))
          : 0,
      );
    },
  );
  const result = await task.downloadAsync();
  if (!result?.uri)
    throw new Error("branding asset download did not produce a file");
  const info = await FileSystem.getInfoAsync(result.uri);
  if (!info.exists || info.isDirectory || info.size !== asset.size) {
    await FileSystem.deleteAsync(result.uri, { idempotent: true });
    throw new Error("branding asset size mismatch");
  }
  const digest = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    await new File(result.uri).arrayBuffer(),
  );
  const hash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (hash !== asset.sha256) {
    await FileSystem.deleteAsync(result.uri, { idempotent: true });
    throw new Error("branding asset integrity check failed");
  }
  await FileSystem.moveAsync({ from: result.uri, to: target });
  const cached: CachedAsset = {
    ...asset,
    localFileUrl: target,
    cachedAt: Date.now(),
  };
  const existing = (await readIndex()).filter(
    (candidate) => candidate.assetId !== asset.assetId,
  );
  const next = [cached, ...existing].sort(
    (left, right) => right.cachedAt - left.cachedAt,
  );
  await writeIndex(next);
  onProgress?.(100);
  return cached;
}

export async function warmBrandingAssets(
  assets: BrandingAsset[],
  policy?: {
    maxBytes: number;
    keepVersions: number;
    staleAfterSeconds: number;
  },
): Promise<Record<string, CachedAsset>> {
  const result: Record<string, CachedAsset> = {};
  for (const asset of assets) {
    try {
      const cached = await getCachedBrandingAsset(asset.assetId);
      if (cached && cached.sha256 === asset.sha256)
        result[asset.assetId] = cached;
      else result[asset.assetId] = await cacheBrandingAsset(asset);
    } catch {
      // A branding asset is non-critical; the launch screen can still use its
      // tenant URL while a verified local copy is unavailable.
    }
  }
  await pruneBrandingCache(
    assets.map((asset) => asset.assetId),
    policy,
  );
  return result;
}

async function pruneBrandingCache(
  activeAssetIds: string[],
  policy?: {
    maxBytes: number;
    keepVersions: number;
    staleAfterSeconds: number;
  },
): Promise<void> {
  const items = await readIndex();
  const active = new Set(activeAssetIds);
  const maxBytes = policy?.maxBytes ?? 20 * 1024 * 1024;
  const staleAfterMs = (policy?.staleAfterSeconds ?? 7 * 24 * 60 * 60) * 1000;
  let total = items.reduce((sum, item) => sum + item.size, 0);
  const removable = items
    .filter((item) => !active.has(item.assetId))
    .sort((left, right) => left.cachedAt - right.cachedAt);
  const protectedPrevious = new Set(
    [...removable]
      .sort((left, right) => right.cachedAt - left.cachedAt)
      .slice(
        0,
        Math.max(0, (policy?.keepVersions ?? 2) - 1) *
          Math.max(1, activeAssetIds.length),
      )
      .map((item) => item.assetId),
  );
  const deleted = new Set<string>();
  for (const item of removable) {
    if (protectedPrevious.has(item.assetId)) continue;
    if (total <= maxBytes && Date.now() - item.cachedAt < staleAfterMs) break;
    await FileSystem.deleteAsync(item.localFileUrl, { idempotent: true });
    total -= item.size;
    deleted.add(item.localFileUrl);
  }
  await writeIndex(items.filter((item) => !deleted.has(item.localFileUrl)));
}

export function collectBrandingAssets(
  config: BootstrapConfig,
): BrandingAsset[] {
  const visuals = config.branding?.launch.visuals;
  if (!visuals) return [];
  const assets = [
    visuals.light.logo,
    visuals.light.backgroundImage,
    visuals.dark.logo,
    visuals.dark.backgroundImage,
  ].filter((asset): asset is BrandingAsset => Boolean(asset));
  return Array.from(
    new Map(assets.map((asset) => [asset.assetId, asset])).values(),
  );
}

export async function hydrateCachedBranding(
  config: BootstrapConfig,
): Promise<BootstrapConfig> {
  if (!config.branding) return config;
  const cached = Object.fromEntries(
    (
      await Promise.all(
        collectBrandingAssets(config).map(
          async (asset) =>
            [
              asset.assetId,
              await getCachedBrandingAsset(asset.assetId),
            ] as const,
        ),
      )
    ).filter((entry): entry is readonly [string, CachedAsset] =>
      Boolean(entry[1]),
    ),
  );
  const enrich = (asset?: BrandingAsset): BrandingAsset | undefined => {
    if (!asset) return asset;
    const local = cached[asset.assetId];
    return local?.sha256 === asset.sha256
      ? { ...asset, localFileUrl: local.localFileUrl }
      : asset;
  };
  return {
    ...config,
    branding: {
      ...config.branding,
      launch: {
        ...config.branding.launch,
        visuals: {
          light: {
            ...config.branding.launch.visuals.light,
            logo: enrich(config.branding.launch.visuals.light.logo),
            backgroundImage: enrich(
              config.branding.launch.visuals.light.backgroundImage,
            ),
          },
          dark: {
            ...config.branding.launch.visuals.dark,
            logo: enrich(config.branding.launch.visuals.dark.logo),
            backgroundImage: enrich(
              config.branding.launch.visuals.dark.backgroundImage,
            ),
          },
        },
      },
    },
  };
}

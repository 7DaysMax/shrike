"use client";
import * as React from "react";

import { IconCpu } from "@tabler/icons-react";

import { type BrandProfile, MODEL_BRANDS, modelBrand } from "@/lib/model-brands";
import { cn } from "@/lib/utils";

import assets from "../../public/model-brands/SOURCES.json";
export function ModelBrandIcon({ profile, className }: { profile?: BrandProfile | null; className?: string }) {
  const brand = modelBrand(profile),
    [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), []);
  const asset = assets[brand as keyof typeof assets];
  const file = asset && "file" in asset ? String(asset.file) : undefined;
  const label = MODEL_BRANDS.find((b) => b[0] === brand)?.[1] ?? "自定义模型";
  if (!file || failed) return <IconCpu className={cn("model-brand-icon size-4", className)} aria-label={label} />;
  // Native local image keeps official favicon formats and avoids a remote image request.
  return (
    // biome-ignore lint/performance/noImgElement: tiny local official favicons include ICO; static export must not use a remote image optimizer.
    <img
      src={`/model-brands/${file}`}
      width={20}
      height={20}
      alt={label}
      title={label}
      data-brand={brand}
      className={cn("model-brand-icon size-4", className)}
      onError={() => setFailed(true)}
    />
  );
}

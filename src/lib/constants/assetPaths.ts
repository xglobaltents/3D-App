/**
 * Asset Path Convention
 * 
 * GLB files are served from Vite's `public/` directory:
 * - Tent parts:    /tents/<TentType>/<Variant>/frame/xxx.glb
 * - Tent covers:   /tents/<TentType>/<Variant>/covers/xxx.glb
 * - Connectors:    /tents/<TentType>/<Variant>/frame/connectors/xxx.glb
 * - Accessories:   /accessories/<category>/xxx.glb
 * 
 * Code-only accessories live in `src/lib/accessories/` (no GLB needed)
 */

export const PATHS = {
  tents: '/tents',
  sharedFrames: '/tents/SharedFrames',
  accessories: '/accessories',
} as const

// ─── Types ───────────────────────────────────────────────────────────────────

export type TentType = 'PremiumArchTent' | 'RevolutionTent' | (string & {})
export type TentVariant = '15m' | '20m' | (string & {})
export type AccessoryCategory = 'doors' | 'windows' | 'hvac' | 'lighting' | 'flooring' | (string & {})

// ─── Tent Paths ──────────────────────────────────────────────────────────────

/** Base path for a tent variant: /tents/PremiumArchTent/15m */
export function getTentPath(tentType: TentType, variant: TentVariant): string {
  return `${PATHS.tents}/${tentType}/${variant}`
}

/** Frame GLBs folder: /tents/PremiumArchTent/15m/frame/ */
export function getFramePath(tentType: TentType, variant: TentVariant): string {
  return `${getTentPath(tentType, variant)}/frame/`
}

/** Connectors GLBs folder: /tents/PremiumArchTent/15m/frame/connectors/ */
export function getConnectorsPath(tentType: TentType, variant: TentVariant): string {
  return `${getTentPath(tentType, variant)}/frame/connectors/`
}

/** Covers GLBs folder: /tents/PremiumArchTent/15m/covers/ */
export function getCoversPath(tentType: TentType, variant: TentVariant): string {
  return `${getTentPath(tentType, variant)}/covers/`
}

/** Shared frame GLBs folder: /tents/SharedFrames/ */
export function getSharedFramePath(): string {
  return `${PATHS.sharedFrames}/`
}

// ─── Accessory Paths ─────────────────────────────────────────────────────────

/** Accessory GLBs folder: /accessories/doors/ */
export function getAccessoryPath(category: AccessoryCategory): string {
  return `${PATHS.accessories}/${category}/`
}

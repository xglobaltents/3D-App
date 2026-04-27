import type { TentSpecs, TentComponentProps } from '@/types'
import type { FC } from 'react'

// ─── Variant descriptor ──────────────────────────────────────────────────────────────────

export interface TentVariantInfo {
  /** Display label for the UI */
  label: string
  /** Unique key: "PremiumArchTent/15m" */
  key: string
  tentType: string
  variant: string
  /** Short label for width selector, e.g. "15m" */
  widthLabel: string
  /** Short label for eave selector when multiple eave heights exist, e.g. "3.20m" */
  eaveLabel?: string
  specs: TentSpecs
  /** Whether this tent type has frame components implemented */
  available: boolean
  /** Composition component for this variant (renders frame + covers) */
  component?: FC<TentComponentProps>
}

// ─── Tent type metadata ──────────────────────────────────────────────────────

export interface TentTypeInfo {
  id: string
  label: string
  available: boolean
  variants: TentVariantInfo[]
}

// ─── Lazy imports — each specs.ts is only loaded when first needed ───────────

// Premium Arch Tent
import { TENT_SPECS as PAT_10m } from '@/tents/PremiumArchTent/10m/specs'
import { TENT_SPECS as PAT_15m } from '@/tents/PremiumArchTent/15m/specs'
import { TENT_SPECS as PAT_15mHigh } from '@/tents/PremiumArchTent/15m-high/specs'
import { TENT_SPECS as PAT_20m } from '@/tents/PremiumArchTent/20m/specs'
import { TENT_SPECS as PAT_25m } from '@/tents/PremiumArchTent/25m/specs'
import { TENT_SPECS as PAT_30m } from '@/tents/PremiumArchTent/30m/specs'
import { TENT_SPECS as PAT_40m } from '@/tents/PremiumArchTent/40m/specs'
import { TENT_SPECS as PAT_50m } from '@/tents/PremiumArchTent/50m/specs'
import { PremiumArchTent10m } from '@/tents/PremiumArchTent/10m/index'
import { PremiumArchTent15m } from '@/tents/PremiumArchTent/15m/index'
import { PremiumArchTent15mHigh } from '@/tents/PremiumArchTent/15m-high/index'
import { PremiumArchTent20m } from '@/tents/PremiumArchTent/20m/index'
import { PremiumArchTent25m } from '@/tents/PremiumArchTent/25m/index'
import { PremiumArchTent30m } from '@/tents/PremiumArchTent/30m/index'
import { PremiumArchTent40m } from '@/tents/PremiumArchTent/40m/index'
import { PremiumArchTent50m } from '@/tents/PremiumArchTent/50m/index'

// Other tent types (stubs — available: false)
import { TENT_SPECS as REV_15m } from '@/tents/RevolutionTent/15m/specs'

// Polygon & Pyramid tents don't have full TentSpecs yet — use placeholders
const STUB_PROFILE = Object.freeze({ width: 0, height: 0 })
const STUB_SPECS: TentSpecs = Object.freeze({
  name: '', width: 0, halfWidth: 0, eaveHeight: 0, ridgeHeight: 0,
  bayDistance: 5, archOuterSpan: 0,
  profiles: Object.freeze({
    upright: STUB_PROFILE, rafter: STUB_PROFILE, gableColumn: STUB_PROFILE,
    eaveBeam: STUB_PROFILE, gableBeam: STUB_PROFILE, mainPurlin: STUB_PROFILE,
    intermediatePurlin: STUB_PROFILE,
  }),
  baseplate: Object.freeze({ width: 0, height: 0, depth: 0, thickness: 0 }),
  gableSupportPositions: Object.freeze([]) as unknown as number[],
  mainPurlinX: Object.freeze([]) as unknown as number[],
  intermediatePurlinX: Object.freeze([]) as unknown as number[],
})

// ─── Registry ────────────────────────────────────────────────────────────────

export const TENT_REGISTRY: TentTypeInfo[] = [
  {
    id: 'PremiumArchTent',
    label: 'Premium Arch Tent',
    available: true,
    variants: [
      {
        label: 'Premium Arch Tent 10m',
        key: 'PremiumArchTent/10m',
        tentType: 'PremiumArchTent',
        variant: '10m',
        widthLabel: '10m',
        specs: PAT_10m,
        available: true,
        component: PremiumArchTent10m,
      },
      {
        label: 'Premium Arch Tent 15m',
        key: 'PremiumArchTent/15m',
        tentType: 'PremiumArchTent',
        variant: '15m',
        widthLabel: '15m',
        eaveLabel: '3.20m (Standard)',
        specs: PAT_15m,
        available: true,
        component: PremiumArchTent15m,
      },
      {
        label: 'Premium Arch Tent 15m (High Eave)',
        key: 'PremiumArchTent/15m-high',
        tentType: 'PremiumArchTent',
        variant: '15m',
        widthLabel: '15m',
        eaveLabel: '4.26m (High)',
        specs: PAT_15mHigh,
        available: true,
        component: PremiumArchTent15mHigh,
      },
      {
        label: 'Premium Arch Tent 20m',
        key: 'PremiumArchTent/20m',
        tentType: 'PremiumArchTent',
        variant: '20m',
        widthLabel: '20m',
        specs: PAT_20m,
        available: true,
        component: PremiumArchTent20m,
      },
      {
        label: 'Premium Arch Tent 25m',
        key: 'PremiumArchTent/25m',
        tentType: 'PremiumArchTent',
        variant: '25m',
        widthLabel: '25m',
        specs: PAT_25m,
        available: true,
        component: PremiumArchTent25m,
      },
      {
        label: 'Premium Arch Tent 30m',
        key: 'PremiumArchTent/30m',
        tentType: 'PremiumArchTent',
        variant: '30m',
        widthLabel: '30m',
        specs: PAT_30m,
        available: true,
        component: PremiumArchTent30m,
      },
      {
        label: 'Premium Arch Tent 40m',
        key: 'PremiumArchTent/40m',
        tentType: 'PremiumArchTent',
        variant: '40m',
        widthLabel: '40m',
        specs: PAT_40m,
        available: true,
        component: PremiumArchTent40m,
      },
      {
        label: 'Premium Arch Tent 50m',
        key: 'PremiumArchTent/50m',
        tentType: 'PremiumArchTent',
        variant: '50m',
        widthLabel: '50m',
        specs: PAT_50m,
        available: true,
        component: PremiumArchTent50m,
      },
      // Future: 25m, 30m, etc. — add here with same pattern
    ],
  },
  {
    id: 'RevolutionTent',
    label: 'Revolution Tent',
    available: false,
    variants: [
      {
        label: 'Revolution Tent 15m',
        key: 'RevolutionTent/15m',
        tentType: 'RevolutionTent',
        variant: '15m',
        widthLabel: '15m',
        specs: REV_15m,
        available: false,
      },
    ],
  },
  {
    id: 'PolygonTent',
    label: 'Polygon Tent',
    available: false,
    variants: [
      {
        label: 'Polygon Tent 15m',
        key: 'PolygonTent/15m',
        tentType: 'PolygonTent',
        variant: '15m',
        widthLabel: '15m',
        specs: STUB_SPECS,
        available: false,
      },
    ],
  },
  {
    id: 'PyramidTent',
    label: 'Pyramid Tent',
    available: false,
    variants: [
      {
        label: 'Pyramid Tent 15m',
        key: 'PyramidTent/15m',
        tentType: 'PyramidTent',
        variant: '15m',
        widthLabel: '15m',
        specs: STUB_SPECS,
        available: false,
      },
    ],
  },
]

// ─── Lookup helpers ──────────────────────────────────────────────────────────

/** Get a tent type entry by id */
export function getTentType(id: string): TentTypeInfo | undefined {
  return TENT_REGISTRY.find(t => t.id === id)
}

/** Get a specific variant by key (e.g. "PremiumArchTent/15m-high") */
export function getVariant(key: string): TentVariantInfo | undefined {
  for (const type of TENT_REGISTRY) {
    const v = type.variants.find(v => v.key === key)
    if (v) return v
  }
  return undefined
}

/** Get all unique widths for a tent type */
export function getWidths(tentTypeId: string): string[] {
  const type = getTentType(tentTypeId)
  if (!type) return []
  const seen = new Set<string>()
  return type.variants
    .filter(v => v.available)
    .reduce<string[]>((acc, v) => {
      if (!seen.has(v.widthLabel)) {
        seen.add(v.widthLabel)
        acc.push(v.widthLabel)
      }
      return acc
    }, [])
}

/** Get eave variants for a tent type + width */
export function getEaveVariants(tentTypeId: string, widthLabel: string): TentVariantInfo[] {
  const type = getTentType(tentTypeId)
  if (!type) return []
  return type.variants.filter(v => v.available && v.widthLabel === widthLabel)
}

/** Get the default variant for a tent type */
export function getDefaultVariant(tentTypeId: string): TentVariantInfo | undefined {
  const type = getTentType(tentTypeId)
  if (!type) return undefined
  return type.variants.find(v => v.available) ?? type.variants[0]
}

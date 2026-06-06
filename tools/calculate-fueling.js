import { calculateTargets } from '../engine/nutrition-engine.js'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const PRODUCTS = require('../config/products.json')

const SINGLE_TRANSPORTER_CEILING = 65

const REGIONS_API = 'https://plan.getlecka.com/api/regions'

// Hardcoded fallback — used only if the live API is unreachable
const FALLBACK_REGIONS = {
  us: { store_url: 'https://www.getlecka.com', type: 'shopify' },
  de: { store_url: 'https://www.getlecka.de', type: 'shopify' },
  dk: { store_url: 'https://www.getlecka.dk', type: 'shopify' },
  ch: { store_url: 'https://www.getlecka.ch', type: 'shopify' },
  kh: { store_url: 'https://leckacambodia.myshopify.com', type: 'shopify' },
  vn: { store_url: null, type: 'haravan' },
  sg: { store_url: 'https://www.rdrc.sg/collections/lecka', type: 'distributor' },
  hk: { store_url: 'https://foodisdom.is/collections/lecka', type: 'distributor' },
  au: { store_url: 'https://www.wildearth.com.au/brand/Lecka', type: 'distributor' },
  fr: { store_url: 'https://www.audacesports.fr/brand/15-lecka', type: 'distributor' },
}

async function fetchRegions() {
  try {
    const res = await fetch(REGIONS_API, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return FALLBACK_REGIONS
    return await res.json()
  } catch {
    return FALLBACK_REGIONS
  }
}

const ZALO_URL = 'https://zalo.me/0988440434'

function buildMCPCartURL(gelProductIds, gelCount, region, products, regionsData) {
  const regionConfig = regionsData[region] ?? regionsData['us']
  const regionType = regionConfig?.type ?? 'shopify'
  const storeUrl = regionConfig?.store_url ?? 'https://www.getlecka.com'

  // Vietnam — Haravan, no cart URL
  if (regionType === 'haravan') {
    return {
      cart_url: ZALO_URL,
      cart_note: 'Order via Zalo for Vietnam delivery.',
    }
  }

  // Distributor regions — no cart, just store link
  if (regionType === 'distributor') {
    return {
      cart_url: storeUrl,
      cart_note: 'Visit the store to purchase Lecka products in your region.',
    }
  }

  // Shopify regions — build cart URL
  const variantLines = []
  for (const productId of gelProductIds) {
    const product = products.find(p => p.id === productId)
    if (!product) continue

    const regionVariants = product.regions?.[region]?.variants ?? []
    if (regionVariants.length === 0) continue

    // Prefer single-unit variant; fall back to first variant
    const singleUnit = regionVariants.find(v => v.units_per_pack === 1)
    const variant = singleUnit ?? regionVariants[0]
    if (!variant?.shopify_variant_id) continue

    const vid = String(variant.shopify_variant_id)
    if (!/^\d+$/.test(vid)) continue

    const unitsNeeded = Math.ceil(gelCount / gelProductIds.length)
    const packSize = variant.units_per_pack ?? 1
    const packsNeeded = Math.ceil(unitsNeeded / packSize)

    variantLines.push(`${vid}:${packsNeeded}`)
  }

  if (variantLines.length === 0) {
    return { cart_url: storeUrl, cart_note: null }
  }

  const cartPath = `/cart/${variantLines.join(',')}`
  const params = ['utm_source=claude']
  if (region === 'us') params.push('discount=NUTRIPLAN10')

  return {
    cart_url: `${storeUrl}${cartPath}?${params.join('&')}`,
    cart_note: region === 'us'
      ? 'Discount code NUTRIPLAN10 applied automatically.'
      : null,
  }
}

export const toolDef = {
  name: 'calculate_fueling_plan',
  description: 'Calculates personalised race nutrition targets (carbs, sodium, fluid) for an endurance athlete and returns a list of Lecka products that match the target. Use this when an athlete asks what to eat during a race, how many gels they need, or what their carb target should be.',
  inputSchema: {
    type: 'object',
    properties: {
      race_type: {
        type: 'string',
        enum: [
          '5k', '10k', 'half_marathon', 'marathon',
          'ultra_50k', 'ultra_100k',
          'cycling',
          'triathlon_sprint', 'triathlon_olympic', 'triathlon_70_3', 'triathlon_140_6',
        ],
        description: 'The race distance or type.',
      },
      goal_minutes: {
        type: 'number',
        description: 'Athlete\'s goal finish time in minutes. E.g. 240 for a 4-hour marathon.',
      },
      weight_kg: {
        type: 'number',
        description: 'Athlete\'s body weight in kilograms.',
      },
      gender: {
        type: 'string',
        enum: ['male', 'female', 'other'],
        description: 'Affects sodium targets. Defaults to male.',
      },
      conditions: {
        type: 'string',
        enum: ['cool', 'mild', 'warm', 'hot', 'humid'],
        description: 'Race day temperature and humidity conditions. Defaults to mild.',
      },
      effort: {
        type: 'string',
        enum: ['easy', 'race_pace', 'hard'],
        description: 'Intended effort level. Defaults to race_pace.',
      },
      caffeine_ok: {
        type: 'boolean',
        description: 'Whether the athlete is comfortable consuming caffeine. Defaults to false.',
      },
      athlete_profile: {
        type: 'string',
        enum: ['untrained', 'intermediate', 'trained', 'elite'],
        description: 'Training level. Affects carb and sodium targets. Defaults to intermediate.',
      },
      region: {
        type: 'string',
        enum: ['us', 'de', 'dk', 'ch', 'vn'],
        description: 'Used to filter product availability. Defaults to us.',
      },
    },
    required: ['race_type', 'goal_minutes', 'weight_kg'],
  },
}

export async function run(args) {
  const {
    race_type,
    goal_minutes,
    weight_kg,
    gender = 'male',
    conditions = 'mild',
    effort = 'race_pace',
    caffeine_ok = false,
    athlete_profile = 'intermediate',
    region = 'us',
  } = args

  // Fetch live regions and calculate targets in parallel
  const [regionsData, targets] = await Promise.all([
    fetchRegions(),
    Promise.resolve(calculateTargets({
      race_type, goal_minutes, weight_kg,
      gender, conditions, effort, caffeine_ok, athlete_profile,
    })),
  ])

  // Filter products available in the region
  const available = PRODUCTS.filter(p => {
    if (p.type === 'variety_pack') return false
    const variants = p.regions?.[region]?.variants ?? p.regions?.us?.variants ?? []
    return variants.length > 0
  })

  // Separate by type
  const gels = available.filter(p => p.type === 'gel' || p.type === 'ultra_gel')
  const bars  = available.filter(p => p.type === 'bar')

  // Apply caffeine filter
  const eligibleGels = caffeine_ok ? gels : gels.filter(p => !p.caffeine)

  // Estimate how many gels the athlete needs
  const carbs_needed = targets.total_carbs

  // For simplicity: how many standard gels (30g carbs each) would cover the target
  const gel_carbs = eligibleGels[0]?.carbs_per_unit ?? 30
  const gel_count_estimate = Math.round(carbs_needed / gel_carbs)

  // Needs dual transporter?
  const needs_dual_transporter =
    targets.carb_per_hour > SINGLE_TRANSPORTER_CEILING && goal_minutes >= 150

  // Build cart URL
  const gelIdsForCart = eligibleGels.slice(0, 2).map(p => p.id)
  const { cart_url, cart_note } = buildMCPCartURL(
    gelIdsForCart,
    gel_count_estimate,
    region,
    available,
    regionsData
  )

  return {
    targets: {
      carb_per_hour: targets.carb_per_hour,
      sodium_per_hour: targets.sodium_per_hour,
      fluid_ml_per_hour: targets.fluid_ml_per_hour,
      total_carbs_g: targets.total_carbs,
      total_sodium_mg: targets.total_sodium,
      total_duration_minutes: targets.total_duration_minutes,
    },
    needs_dual_transporter,
    warnings: targets.warnings?.map(w => w.message) ?? [],
    recommended_products: {
      gels: eligibleGels.map(p => ({
        id: p.id,
        name: p.name,
        carbs_per_unit: p.carbs_per_unit,
        caffeine: p.caffeine,
        caffeine_mg: p.caffeine_mg ?? 0,
        dual_transporter: p.dual_transporter ?? false,
      })),
      bars: bars.map(p => ({
        id: p.id,
        name: p.name,
        carbs_per_unit: p.carbs_per_unit,
      })),
    },
    plan_guidance: {
      estimated_gels_needed: gel_count_estimate,
      gel_timing: 'Take first gel at 30 minutes, then every 30 minutes throughout the race.',
      bar_timing: goal_minutes >= 60
        ? 'Eat one bar 30 minutes before the race start. One bar after finishing supports recovery.'
        : null,
      sodium_note: (conditions === 'hot' || conditions === 'humid')
        ? 'Hot or humid conditions: consider supplementing with electrolyte tabs (e.g. Nuun, Precision Hydration). Lecka does not currently sell electrolyte products.'
        : null,
    },
    cart_url,
    cart_note,
    planner_url: 'https://plan.getlecka.com',
  }
}

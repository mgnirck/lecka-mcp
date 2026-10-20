/**
 * kit-calculator.js
 *
 * Logic layer for the open planner feature.
 * Handles competitor product addon coverage and Lecka foundation target adjustment.
 *
 * Pure JS module — no DOM, no React imports.
 */

/**
 * 65g carbs/hour — practical ceiling for Lecka gels as real food foundation.
 *
 * Lab-verified fructose profiles per flavour (Eurofins, Dec 2025):
 *   Lime Ginger:     26% of carbs as free fructose (from lime juice)
 *   Kumquat Honey:   26% of carbs as free fructose (from raw honey)
 *   Passion Fruit:   14% of carbs as free fructose (from passion fruit)
 *   Banana:           5% of carbs as free fructose (sucrose-dominant)
 *   Coffee Cacao:    ~0% of carbs as free fructose (sucrose/maltose-dominant)
 *
 * Lime Ginger and Kumquat Honey provide meaningful natural fructose from
 * whole food ingredients. At moderate intakes these support dual-transporter
 * absorption. For targets above 65g/hour, adding an engineered dual-
 * transporter product remains recommended.
 *
 * Sources: Eurofins lab reports AR-25-VD-251832, AR-25-VD-251833,
 *          AR-25-VD-249580, AR-25-VD-249581, AR-25-VD-258719 (Dec 2025)
 */
export const SINGLE_TRANSPORTER_CEILING = 65 // g carbs/hour

/**
 * Returns true when the athlete's carb target exceeds what a single transporter
 * can handle AND the race is long enough for depletion to matter.
 *
 * Both conditions must be true: a short race above 65 g/h doesn't require
 * dual-transporter products because the race ends before depletion matters.
 *
 * @param {{ carb_per_hour: number, total_duration_minutes: number }} targets
 * @returns {boolean}
 */
export function needsDualTransporter(targets) {
  return (
    targets.carb_per_hour > SINGLE_TRANSPORTER_CEILING &&
    targets.total_duration_minutes >= 150
  )
}

/**
 * Aggregates nutritional coverage across all addon items.
 *
 * @param {Array<{ product: object, quantity: number }>} addonItems
 * @param {number} totalDurationMinutes
 * @returns {{
 *   total_carbs: number,
 *   total_sodium: number,
 *   total_caffeine: number,
 *   carbs_per_hour: number,
 *   sodium_per_hour: number,
 *   has_dual_transporter: boolean,
 *   items: Array<{ product: object, quantity: number }>
 * }}
 */
export function computeAddonCoverage(addonItems, totalDurationMinutes) {
  const duration_hours = totalDurationMinutes / 60

  let total_carbs = 0
  let total_sodium = 0
  let total_caffeine = 0
  let has_dual_transporter = false

  for (const { product, quantity } of addonItems) {
    total_carbs += product.carbs_per_unit * quantity
    total_sodium += product.sodium_per_unit * quantity
    total_caffeine += product.caffeine_mg * quantity
    if (product.dual_transporter) has_dual_transporter = true
  }

  const carbs_per_hour = total_carbs / duration_hours
  const sodium_per_hour = total_sodium / duration_hours

  return {
    total_carbs,
    total_sodium,
    total_caffeine,
    carbs_per_hour,
    sodium_per_hour,
    has_dual_transporter,
    items: addonItems,
  }
}

/**
 * Adjusts the Lecka foundation targets to account for carbs and sodium
 * already covered by addon items.
 *
 * The foundation carb rate is clamped to SINGLE_TRANSPORTER_CEILING because
 * Lecka products never need to exceed that threshold — the addon layer handles
 * any dual-transporter requirement above it.
 *
 * @param {object} targets - Output from calculateTargets()
 * @param {ReturnType<typeof computeAddonCoverage>} addonCoverage
 * @returns {object} Modified targets with foundation fields added
 */
export function computeFoundationTargets(targets, addonCoverage) {
  if (addonCoverage.items.length === 0) {
    return { ...targets, is_foundation_only: true }
  }

  const duration_hours = targets.total_duration_minutes / 60

  const raw_foundation_carbs_per_hour = targets.carb_per_hour - addonCoverage.carbs_per_hour
  const foundation_carbs_per_hour = Math.min(
    Math.max(raw_foundation_carbs_per_hour, 0),
    SINGLE_TRANSPORTER_CEILING
  )

  const total_carbs = Math.round(foundation_carbs_per_hour * duration_hours)

  const raw_foundation_sodium_per_hour = targets.sodium_per_hour - addonCoverage.sodium_per_hour
  const foundation_sodium_per_hour = Math.max(raw_foundation_sodium_per_hour, 0)
  const total_sodium = Math.round(foundation_sodium_per_hour * duration_hours)

  return {
    ...targets,
    carb_per_hour: foundation_carbs_per_hour,
    total_carbs,
    sodium_per_hour: foundation_sodium_per_hour,
    total_sodium,
    is_foundation_only: false,
    foundation_carbs_per_hour,
    addon_carbs_per_hour: addonCoverage.carbs_per_hour,
  }
}

/**
 * Formats a list of addon items into a human-readable summary string.
 *
 * @param {Array<{ product: object, quantity: number }>} addonItems
 * @returns {string} e.g. "3× Maurten Gel 160 (120g carbs), 2× Nuun Sport Tab"
 */
export function formatAddonSummary(addonItems) {
  if (addonItems.length === 0) return ''

  return addonItems
    .map(({ product, quantity }) => {
      const totalCarbs = product.carbs_per_unit * quantity
      const carbPart = totalCarbs > 0 ? ` (${totalCarbs}g carbs)` : ''
      return `${quantity}× ${product.display_name}${carbPart}`
    })
    .join(', ')
}

// ─────────────────────────────────────────────────────────────────────────────
// Dev smoke-test — only runs in Vite dev mode, never in production builds
// 100km ultra: 80g carbs/hour target, 480 min race, 2× Maurten Gel 160 as addon
// ─────────────────────────────────────────────────────────────────────────────
if (import.meta.env?.DEV) {
  console.log('=== Lecka Kit Calculator — Smoke Test ===\n')

  const mockTargets = {
    carb_per_hour: 80,
    sodium_per_hour: 700,
    fluid_ml_per_hour: 600,
    total_duration_minutes: 480,
    total_carbs: 640,
    total_sodium: 5600,
    caffeine_ok: false,
    race_type: 'ultra_100k',
    effort: 'race_pace',
    conditions: 'mild',
  }

  const maurtenGel160 = {
    id: 'maurten-gel-160',
    brand: 'Maurten',
    name: 'Gel 160',
    display_name: 'Maurten Gel 160',
    category: 'high_carb_gel',
    type: 'gel',
    carbs_per_unit: 40,
    sodium_per_unit: 0,
    caffeine: false,
    caffeine_mg: 0,
    fructose_ratio: 0.5,
    dual_transporter: true,
  }

  const addonItems = [{ product: maurtenGel160, quantity: 2 }]

  const addonCoverage = computeAddonCoverage(addonItems, mockTargets.total_duration_minutes)
  // 2 × 40g = 80g total carbs over 8 hours → 10g/h
  console.log('Original targets:', mockTargets)
  console.log('Addon coverage:', addonCoverage)

  const foundationTargets = computeFoundationTargets(mockTargets, addonCoverage)
  // 80 - 10 = 70, clamped to 65
  console.log('Foundation targets:', foundationTargets)
  console.log(`foundation_carbs_per_hour = ${foundationTargets.foundation_carbs_per_hour} (expect 65, clamped from 70)`)

  console.log(`needsDualTransporter = ${needsDualTransporter(mockTargets)} (expect true: 80 > 65 and 480 >= 150)`)

  console.log('Summary:', formatAddonSummary(addonItems))
  console.log('=========================================')
}

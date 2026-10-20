/**
 * nutrition-engine.js
 *
 * Pure JS module — no DOM, no React imports.
 * Single export: calculateTargets(inputs) → targets object.
 *
 * Inputs
 * ------
 * race_type        : string  — key matching formula-config carb_rates table
 * goal_minutes     : number  — athlete's goal finish time in minutes
 * weight_kg        : number  — body weight
 * gender           : string  — 'male' | 'female' | 'other'
 * conditions       : string  — 'cool' | 'mild' | 'warm' | 'hot' | 'humid'
 * effort           : string  — 'easy' | 'race_pace' | 'hard'
 * caffeine_ok      : boolean — athlete consents to caffeine products
 * elevation_gain_m : number  — total positive ascent in metres (default 0)
 * distance_km      : number  — course distance in km (default 0 = skip elevation modifier)
 * sweat_profile    : string  — 'light' | 'average' | 'salty' (default 'average'; no UI yet)
 *
 * Returns
 * -------
 * {
 *   carb_per_hour         : number   g/h
 *   sodium_per_hour       : number   mg/h
 *   fluid_ml_per_hour     : number   ml/h
 *   sodium_mg_per_litre   : number   mg/L sodium concentration used for sodium_per_hour
 *   sweat_profile         : string   'light'|'average'|'salty' (resolved profile)
 *   total_duration_minutes: number
 *   total_carbs           : number   g  (whole race)
 *   total_sodium          : number   mg (whole race)
 *   caffeine_ok           : boolean
 *   race_type             : string
 *   effort                : string
 *   conditions            : string
 *   elevation_gain_m      : number
 *   avg_grade_pct         : number
 *   elevation_tier        : string   'flat'|'rolling'|'hilly'|'very_hilly'|'mountain'
 * }
 */

import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const formulaConfig = require('../config/formula-config.json')
import * as carbStrategies from './carb-strategies.js'
import { SINGLE_TRANSPORTER_CEILING } from './kit-calculator.js'

export function calculateTargets(inputs) {
  const {
    race_type,
    goal_minutes,
    weight_kg,
    gender = 'male',
    conditions = 'mild',
    effort = 'race_pace',
    caffeine_ok = false,
    athlete_profile = 'intermediate',
    elevation_gain_m = 0,
    distance_km = 0,
    sweat_profile = 'average',
    age_bracket = null,
  } = inputs

  // ── 1. Validate required inputs ──────────────────────────────────────────
  if (!race_type) throw new Error('race_type is required')
  if (!goal_minutes || goal_minutes <= 0) throw new Error('goal_minutes must be > 0')
  if (!weight_kg || weight_kg <= 0) throw new Error('weight_kg must be > 0')

  const carbRates = formulaConfig.carb_rates_g_per_hour
  if (!carbRates[race_type]) {
    throw new Error(`Unknown race_type "${race_type}". Valid options: ${Object.keys(carbRates).join(', ')}`)
  }

  // ── 2. Base carb rate using selected strategy ──────────────────────────────
  const strategyName = formulaConfig.carb_calculation_strategy.selected
  let carb_per_hour = carbStrategies.selectCarbStrategy(strategyName, inputs, formulaConfig)

  // ── 2a. Gut training mode safety cap ─────────────────────────────────────────
  // training_mode applies a 0.70 multiplier in the strategy layer.
  // For events > 180 min, cap the reduction so carbs never fall below 85% of the
  // non-training target. Fuelling is safety-critical in long events.
  if (inputs.training_mode && goal_minutes > 180) {
    const nonTrainingInputs = { ...inputs, training_mode: false }
    const uncappedBase = carbStrategies.selectCarbStrategy(strategyName, nonTrainingInputs, formulaConfig)
    const minAllowed = Math.round(uncappedBase * 0.85)
    if (carb_per_hour < minAllowed) {
      carb_per_hour = minAllowed
    }
  }

  // Apply athlete profile modifier (trained athletes can absorb more)
  const profileMods = formulaConfig.athlete_profiles[athlete_profile]
  if (profileMods) {
    carb_per_hour *= profileMods.carb_modifier
  } else if (athlete_profile !== 'intermediate') {
    console.warn(`Unknown athlete_profile "${athlete_profile}", using intermediate defaults`)
  }

  carb_per_hour = Math.round(carb_per_hour)

  // ── 2c. Age modifier (optional) ──────────────────────────────────────────────
  // Only applied when age_bracket is explicitly provided. Null = no change.
  if (age_bracket && formulaConfig.age_modifiers?.[age_bracket]) {
    const ageMod = formulaConfig.age_modifiers[age_bracket].carb_modifier
    carb_per_hour = Math.round(carb_per_hour * ageMod)
  }

  // ── 2b. Elevation modifier ────────────────────────────────────────────────
  let elevation_tier = 'flat'
  let avg_grade_pct = 0

  if (elevation_gain_m > 0 && distance_km > 0) {
    avg_grade_pct = (elevation_gain_m / (distance_km * 1000)) * 100

    const elevMods = formulaConfig.elevation_modifiers
    const tier = Object.entries(elevMods)
      .filter(([key]) => key !== '_comment')
      .find(([, cfg]) => avg_grade_pct <= cfg.avg_grade_pct_max)

    if (tier) {
      elevation_tier = tier[0]
      carb_per_hour = Math.round(carb_per_hour * tier[1].carb_modifier)
    }
  }

  // ── 3. Shared modifiers (gender, conditions) ─────────────────────────────
  const genderMod = formulaConfig.gender_modifiers[gender] ?? 1.0
  const condMod = formulaConfig.condition_modifiers[conditions]
  if (!condMod) {
    throw new Error(`Unknown conditions "${conditions}". Valid options: cool, mild, warm, hot, humid`)
  }

  // ── 4. Fluid rate ─────────────────────────────────────────────────────────
  const fluidConfig = formulaConfig.fluid_targets_ml_per_hour
  let fluid_ml_per_hour = weight_kg * fluidConfig.base_per_kg * genderMod * condMod.fluid_multiplier

  // Apply athlete profile modifier for fluid
  if (profileMods) {
    fluid_ml_per_hour *= profileMods.fluid_modifier
  }

  // Use a lower fluid ceiling for running events (gastric emptying limit at race pace).
  // Triathlon bike leg and cycling retain the higher 1000 ml/h ceiling.
  const isCyclingContext = race_type?.includes('triathlon') || race_type === 'cycling'
  const fluidMax = isCyclingContext
    ? (fluidConfig.maximum_cycling_and_bike_leg ?? fluidConfig.maximum)
    : (fluidConfig.maximum_running ?? fluidConfig.maximum)

  fluid_ml_per_hour = Math.round(
    Math.min(Math.max(fluid_ml_per_hour, fluidConfig.minimum), fluidMax)
  )

  // ── 4b. Sodium rate (v2 — fluid × concentration) ──────────────────────────
  // Guidelines set sodium as mg per litre of fluid (ACSM 2007, DGE 2020).
  // Gender, conditions and profile reach sodium only via fluid. No elevation effect.
  // See NUTRITION_RESEARCH_ANALYSIS.md §2.
  const sodiumConfig = formulaConfig.sodium_targets_mg_per_hour
  const sweatProfileKey =
    sodiumConfig.concentration_mg_per_litre[sweat_profile] != null
      ? sweat_profile
      : sodiumConfig.default_sweat_profile
  const sodium_mg_per_litre = sodiumConfig.concentration_mg_per_litre[sweatProfileKey]

  let sodium_per_hour = (fluid_ml_per_hour / 1000) * sodium_mg_per_litre

  sodium_per_hour = Math.round(
    Math.min(Math.max(sodium_per_hour, sodiumConfig.minimum), sodiumConfig.maximum)
  )

  // Sodium duration scaling
  // Short events don't require meaningful sodium replacement.
  // Scale the target down for events under 90 minutes.
  const sodiumDurationAnchors = formulaConfig.sodium_duration_scale?.anchors
  if (sodiumDurationAnchors && sodiumDurationAnchors.length > 0) {
    const lastAnchor = sodiumDurationAnchors[sodiumDurationAnchors.length - 1]
    if (goal_minutes < lastAnchor.minutes) {
      let sodiumScale = 1.0
      for (let i = 1; i < sodiumDurationAnchors.length; i++) {
        const prev = sodiumDurationAnchors[i - 1]
        const curr = sodiumDurationAnchors[i]
        if (goal_minutes >= prev.minutes && goal_minutes <= curr.minutes) {
          const ratio = (goal_minutes - prev.minutes) / (curr.minutes - prev.minutes)
          sodiumScale = prev.multiplier + ratio * (curr.multiplier - prev.multiplier)
          break
        }
      }
      sodium_per_hour = Math.round(sodium_per_hour * sodiumScale)
    }
  }

  // ── 5. Race totals ────────────────────────────────────────────────────────
  const duration_hours = goal_minutes / 60
  const total_carbs = Math.round(carb_per_hour * duration_hours)
  const total_sodium = Math.round(sodium_per_hour * duration_hours)

  // ── 6. Validation and warnings ─────────────────────────────────────────────
  const warnings = []
  const validationRules = formulaConfig.validation_rules || {}

  // Carb rate validation
  if (validationRules.carb) {
    if (goal_minutes < validationRules.carb.min_for_event_min && carb_per_hour > 0) {
      warnings.push({
        type: 'carb_rate_short_race',
        message: validationRules.carb.warning_high_short_race,
        severity: 'info',
      })
    }
    if (goal_minutes < 60 && carb_per_hour > 30) {
      warnings.push({
        type: 'carb_rate_high_short',
        message: validationRules.carb.warning_high_carb_rate,
        severity: 'warning',
      })
    }
  }

  // Sodium pre-load suggestion (hot/humid, long events) — studied protocol
  const sodiumRules = validationRules.sodium
  if (
    sodiumRules &&
    goal_minutes >= sodiumRules.loading_min_duration_min &&
    sodiumRules.loading_conditions.includes(conditions)
  ) {
    const ml = Math.round((weight_kg * sodiumRules.loading_ml_per_kg) / 50) * 50
    const mg = Math.round(((ml / 1000) * sodiumRules.loading_sodium_mg_per_litre) / 100) * 100
    const salt = Math.round((mg / 1000 / sodiumRules.salt_sodium_fraction) * 2) / 2
    warnings.push({
      type: 'sodium_loading_recommendation',
      message: sodiumRules.warning_preload_template
        .replace('{ml}', String(ml))
        .replace('{mg}', String(mg))
        .replace('{salt}', String(salt)),
      severity: 'info',
    })
  }

  // Overdrinking / hyponatremia (long events)
  const fluidRules = validationRules.fluid
  if (fluidRules && goal_minutes >= fluidRules.hyponatremia_min_duration_min) {
    warnings.push({
      type: 'fluid_overhydration_risk',
      message: fluidRules.warning_overhydration,
      severity: 'warning',
    })
  }

  // Training mode long race warning
  if (inputs.training_mode && goal_minutes > 180) {
    warnings.push({
      type: 'training_mode_long_race',
      message: 'Gut training mode is for training runs only — carb target has been raised to a minimum safe level for this race duration. Do not use training mode on race day.',
      severity: 'warning',
    })
  }

  return {
    carb_per_hour,
    sodium_per_hour,
    fluid_ml_per_hour,
    sodium_mg_per_litre,
    sweat_profile: sweatProfileKey,
    total_duration_minutes: goal_minutes,
    total_carbs,
    total_sodium,
    caffeine_ok,
    race_type,
    effort,
    conditions,
    athlete_profile,
    carb_strategy: strategyName,
    age_bracket: age_bracket ?? null,
    elevation_gain_m,
    avg_grade_pct: Math.round(avg_grade_pct * 10) / 10,
    elevation_tier,
    warnings,
    single_transporter_ceiling: SINGLE_TRANSPORTER_CEILING,
    exceeds_single_transporter: carb_per_hour > SINGLE_TRANSPORTER_CEILING,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Dev smoke-test — only runs in Vite dev mode, never in production builds
// Demonstrates core features: strategies, athlete profiles, validation, warnings
// ─────────────────────────────────────────────────────────────────────────────
if (import.meta.env?.DEV) {
  console.log('=== Lecka Nutrition Engine — Smoke Tests ===\n')

  // Sample 1: Half marathon (trained athlete, warm conditions)
  const sample1 = calculateTargets({
    race_type:        'half_marathon',
    goal_minutes:     135,
    weight_kg:        70,
    gender:           'male',
    conditions:       'warm',
    effort:           'race_pace',
    caffeine_ok:      true,
    training_mode:    false,
    athlete_profile:  'trained',
  })

  console.log('Sample 1: Half Marathon (Trained Athlete)')
  console.log(`  Race:       ${sample1.race_type}, ${sample1.total_duration_minutes} min`)
  console.log(`  Athlete:    ${sample1.athlete_profile}, effort=${sample1.effort}`)
  console.log(`  Strategy:   ${sample1.carb_strategy}`)
  console.log(`  Carb:       ${sample1.carb_per_hour} g/h → ${sample1.total_carbs} g`)
  console.log(`  Sodium:     ${sample1.sodium_per_hour} mg/h → ${sample1.total_sodium} mg`)
  console.log(`  Fluid:      ${sample1.fluid_ml_per_hour} ml/h`)
  if (sample1.warnings.length > 0) {
    console.log(`  Warnings:   ${sample1.warnings.map((w) => w.message).join('; ')}`)
  }

  // Sample 2: 5K race (validation test — should warn about short race)
  const sample2 = calculateTargets({
    race_type:        '5k',
    goal_minutes:     22,
    weight_kg:        70,
    gender:           'male',
    conditions:       'mild',
    effort:           'hard',
    caffeine_ok:      true,
    training_mode:    false,
    athlete_profile:  'intermediate',
  })

  console.log('\nSample 2: 5K Race (Validation Test)')
  console.log(`  Race:       ${sample2.race_type}, ${sample2.total_duration_minutes} min`)
  console.log(`  Carb:       ${sample2.carb_per_hour} g/h (expect warnings for short race)`)
  console.log(`  Sodium:     ${sample2.sodium_per_hour} mg/h`)
  console.log(`  Fluid:      ${sample2.fluid_ml_per_hour} ml/h`)
  if (sample2.warnings.length > 0) {
    console.log(`  ✓ Warnings detected (as expected):`)
    sample2.warnings.forEach((w) => console.log(`    - [${w.type}] ${w.message}`))
  }

  // Sample 3: Ultra 50K with gut training mode
  const sample3 = calculateTargets({
    race_type:        'ultra_50k',
    goal_minutes:     360,
    weight_kg:        75,
    gender:           'female',
    conditions:       'hot',
    effort:           'race_pace',
    caffeine_ok:      true,
    training_mode:    true,
    athlete_profile:  'elite',
  })

  console.log('\nSample 3: Ultra 50K (Gut Training Mode, Hot Conditions)')
  console.log(`  Race:       ${sample3.race_type}, ${sample3.total_duration_minutes} min`)
  console.log(`  Athlete:    ${sample3.athlete_profile}, training_mode=true`)
  console.log(`  Carb:       ${sample3.carb_per_hour} g/h (reduced via training mode)`)
  console.log(`  Sodium:     ${sample3.sodium_per_hour} mg/h`)
  console.log(`  Fluid:      ${sample3.fluid_ml_per_hour} ml/h`)
  if (sample3.warnings.length > 0) {
    console.log(`  Warnings:`)
    sample3.warnings.forEach((w) => console.log(`    - ${w.message}`))
  }

  console.log('==============================================')
} // end DEV smoke-test

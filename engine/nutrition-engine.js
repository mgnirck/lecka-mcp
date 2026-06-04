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
 *
 * Returns
 * -------
 * {
 *   carb_per_hour         : number   g/h
 *   sodium_per_hour       : number   mg/h
 *   fluid_ml_per_hour     : number   ml/h
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

const SINGLE_TRANSPORTER_CEILING = 65

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

  // Apply athlete profile modifier (trained athletes can absorb more)
  const profileMods = formulaConfig.athlete_profiles[athlete_profile]
  if (profileMods) {
    carb_per_hour *= profileMods.carb_modifier
  } else if (athlete_profile !== 'intermediate') {
    console.warn(`Unknown athlete_profile "${athlete_profile}", using intermediate defaults`)
  }

  carb_per_hour = Math.round(carb_per_hour)

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

  // ── 3. Sodium rate ────────────────────────────────────────────────────────
  const sodiumConfig = formulaConfig.sodium_targets_mg_per_hour
  const genderMod = formulaConfig.gender_modifiers[gender] ?? 1.0
  const condMod = formulaConfig.condition_modifiers[conditions]
  if (!condMod) {
    throw new Error(`Unknown conditions "${conditions}". Valid options: cool, mild, warm, hot, humid`)
  }

  let sodium_per_hour = weight_kg * sodiumConfig.base_per_kg * genderMod * condMod.sodium_multiplier

  // Apply athlete profile modifier for sodium
  if (profileMods) {
    sodium_per_hour *= profileMods.sodium_modifier
  }

  // Apply elevation sodium modifier
  if (elevation_gain_m > 0 && distance_km > 0) {
    const elevTierCfg = formulaConfig.elevation_modifiers[elevation_tier]
    if (elevTierCfg) {
      sodium_per_hour *= elevTierCfg.sodium_modifier
    }
  }

  sodium_per_hour = Math.round(
    Math.min(Math.max(sodium_per_hour, sodiumConfig.minimum), sodiumConfig.maximum)
  )

  // ── 4. Fluid rate ─────────────────────────────────────────────────────────
  const fluidConfig = formulaConfig.fluid_targets_ml_per_hour
  let fluid_ml_per_hour = weight_kg * fluidConfig.base_per_kg * genderMod * condMod.fluid_multiplier

  // Apply athlete profile modifier for fluid
  if (profileMods) {
    fluid_ml_per_hour *= profileMods.fluid_modifier
  }

  fluid_ml_per_hour = Math.round(
    Math.min(Math.max(fluid_ml_per_hour, fluidConfig.minimum), fluidConfig.maximum)
  )

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

  // Sodium warnings
  if (validationRules.sodium) {
    if (goal_minutes >= validationRules.sodium.warning_duration_min && ['hot', 'humid'].includes(conditions)) {
      warnings.push({
        type: 'sodium_loading_recommendation',
        message: validationRules.sodium.warning_hot_humidity,
        severity: 'info',
      })
    }
  }

  // Fluid warnings
  if (validationRules.fluid && fluid_ml_per_hour > validationRules.fluid.max_safe_ml_per_hour) {
    if (goal_minutes < 120) {
      warnings.push({
        type: 'fluid_overhydration_risk',
        message: validationRules.fluid.warning_overhydration,
        severity: 'warning',
      })
    }
  }

  return {
    carb_per_hour,
    sodium_per_hour,
    fluid_ml_per_hour,
    total_duration_minutes: goal_minutes,
    total_carbs,
    total_sodium,
    caffeine_ok,
    race_type,
    effort,
    conditions,
    athlete_profile,
    carb_strategy: strategyName,
    elevation_gain_m,
    avg_grade_pct: Math.round(avg_grade_pct * 10) / 10,
    elevation_tier,
    warnings,
    single_transporter_ceiling: SINGLE_TRANSPORTER_CEILING,
    exceeds_single_transporter: carb_per_hour > SINGLE_TRANSPORTER_CEILING,
  }
}


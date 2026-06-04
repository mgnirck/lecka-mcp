import { calculateTargets } from '../engine/nutrition-engine.js'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const PRODUCTS = require('../config/products.json')

const SINGLE_TRANSPORTER_CEILING = 65

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

  // Calculate nutrition targets
  const targets = calculateTargets({
    race_type, goal_minutes, weight_kg,
    gender, conditions, effort, caffeine_ok, athlete_profile,
  })

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
    planner_url: 'https://plan.getlecka.com',
  }
}

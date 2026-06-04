/**
 * carb-strategies.js
 *
 * Pluggable carbohydrate calculation strategies.
 * Each strategy implements a different approach to determining optimal carb intake.
 *
 * Strategies:
 * - effort_based (default): Uses race type and effort level as primary drivers
 * - duration_based: Uses race duration as primary driver (aligns with ISSN/Burke guidelines)
 * - vo2max_adjusted: Considers athlete fitness level (future enhancement)
 */

/**
 * Effort-based strategy (current Lecka default)
 * Primary driver: race type + effort level
 * Secondary: training mode reduction
 *
 * Research basis: Effort modifier acknowledges different glycogen turnover
 * Limitation: Doesn't account for duration (5K at hard effort shouldn't need high carbs)
 */
export function calculateCarbs_EffortBased(inputs, config) {
  const { race_type, effort, goal_minutes, training_mode } = inputs
  const carbRates = config.carb_rates_g_per_hour
  const effortModifiers = config.effort_modifiers
  const trainingMode = config.training_mode

  let carbPerHour = carbRates[race_type][effort]
  if (carbPerHour === undefined) {
    throw new Error(`Unknown race_type "${race_type}" or effort "${effort}"`)
  }

  const effortMod = effortModifiers[effort] ?? 1.0
  carbPerHour *= effortMod

  if (training_mode) {
    carbPerHour *= trainingMode.carb_rate_multiplier
  }

  return Math.round(carbPerHour)
}

/**
 * Duration-based strategy
 * Primary driver: race duration (goal_minutes)
 * Secondary: carbohydrate transportability (single vs. dual transporter CHO)
 *
 * Research basis: ISSN 2018, Burke et al. 2019
 * - <45 min: 0 g/h (sufficient muscle glycogen)
 * - 45-150 min: 60 g/h (single transporter, glucose dominant)
 * - 150-180 min: 75-90 g/h (single or dual transporter possible)
 * - >180 min: 60-90 g/h (dual transporter CHO recommended)
 *
 * Advantage: Aligns with CHO transporter physiology
 * Can recommend carb type based on duration
 */
export function calculateCarbs_DurationBased(inputs, config) {
  const { goal_minutes, training_mode } = inputs
  const trainingMode = config.training_mode

  // Duration-based carb recommendations
  let carbPerHour

  if (goal_minutes < 45) {
    carbPerHour = 0 // Not needed, sufficient glycogen
  } else if (goal_minutes >= 45 && goal_minutes <= 150) {
    carbPerHour = 60 // Single transporter, SGLT1
  } else if (goal_minutes > 150 && goal_minutes <= 180) {
    carbPerHour = 75 // Transition: can use single or dual
  } else {
    // goal_minutes > 180
    carbPerHour = 75 // Dual transporter CHO capacity (glucose + fructose 2:1)
  }

  if (training_mode) {
    carbPerHour *= trainingMode.carb_rate_multiplier
  }

  return Math.round(carbPerHour)
}

/**
 * Hybrid strategy (duration-primary with effort secondary)
 * Best of both worlds: respects duration physiology but adjusts for intensity
 *
 * - Duration determines base rate
 * - Effort modifier applied as secondary adjustment
 * - Avoids excessive carbs in short races while honoring high-intensity demands
 */
export function calculateCarbs_Hybrid(inputs, config) {
  const { goal_minutes, effort, training_mode } = inputs

  // Start with duration-based
  let carbPerHour = calculateCarbs_DurationBased(inputs, config)

  // If 0 carbs suggested but hard effort and still >30 min, consider small amount
  if (carbPerHour === 0 && effort === 'hard' && goal_minutes > 30) {
    carbPerHour = 25 // Small amount for very short hard efforts
  }

  // For longer events, apply effort modifier more gently
  if (goal_minutes > 180) {
    const effortMod = config.effort_modifiers[effort] ?? 1.0
    // Only apply 50% of effort modifier for ultra-long events (duration dominates)
    carbPerHour *= (1 + (effortMod - 1) * 0.5)
  }

  if (training_mode) {
    carbPerHour *= config.training_mode.carb_rate_multiplier
  }

  return Math.round(carbPerHour)
}

/**
 * VO2Max-adjusted strategy (future enhancement)
 * Considers athlete fitness level
 *
 * More trained athletes:
 * - Higher max carb absorption capacity (up to 120 mg/min with dual CHO)
 * - More efficient sweat control (can handle higher intakes)
 *
 * Less trained athletes:
 * - Lower max absorption (60-90 mg/min)
 * - Higher GI distress risk with high carbs
 */
export function calculateCarbs_VO2MaxAdjusted(inputs, config) {
  const { goal_minutes, training_status = 'intermediate' } = inputs

  // Absorption capacity varies by training status
  const vo2maxMods = config.vo2max_modifiers || {
    untrained: 0.85,
    intermediate: 1.0,
    trained: 1.15,
  }

  let carbPerHour = calculateCarbs_DurationBased(inputs, config)
  const mod = vo2maxMods[training_status] ?? 1.0
  carbPerHour *= mod

  return Math.round(carbPerHour)
}

/**
 * Distance-adaptive strategy — continuously interpolated from goal duration
 *
 * Uses linear interpolation between research-anchored breakpoints so every
 * distinct race duration produces a distinct carb target.  A 70 km race
 * (goal ~480 min) returns a meaningfully different rate from a 50 km race
 * (~360 min).  Effort modifier applied on top as a ±15% band.
 *
 * Anchor points derived from ISSN 2018 / Burke et al. (IOC 2019):
 *   0-30 min   → 0 g/h  (sufficient muscle glycogen, no benefit)
 *   45 min     → 20 g/h (marginal benefit starts, SGLT1 priming)
 *   60 min     → 35 g/h (single-transporter threshold)
 *   90 min     → 50 g/h
 *   120 min    → 58 g/h (2h marathon zone)
 *   180 min    → 63 g/h (3h marathon / half-ultra transition)
 *   240 min    → 67 g/h (4h mark)
 *   300 min    → 71 g/h (50km ultra ~5h)
 *   360 min    → 74 g/h (50km ultra ~6h)
 *   480 min    → 77 g/h (70-80km ultra ~8h)
 *   600 min    → 79 g/h (100km ultra ~10h)
 *   900 min    → 82 g/h (100 mile / very long ultra)
 */
const DURATION_ANCHORS = [
  [0,   0],
  [30,  0],
  [45,  20],
  [60,  35],
  [90,  50],
  [120, 58],
  [180, 63],
  [240, 67],
  [300, 71],
  [360, 74],
  [480, 77],
  [600, 79],
  [900, 82],
]

function interpolateFromAnchors(minutes) {
  if (minutes <= DURATION_ANCHORS[0][0]) return DURATION_ANCHORS[0][1]
  const last = DURATION_ANCHORS[DURATION_ANCHORS.length - 1]
  if (minutes >= last[0]) return last[1]

  for (let i = 1; i < DURATION_ANCHORS.length; i++) {
    const [t1, r1] = DURATION_ANCHORS[i - 1]
    const [t2, r2] = DURATION_ANCHORS[i]
    if (minutes >= t1 && minutes <= t2) {
      const ratio = (minutes - t1) / (t2 - t1)
      return r1 + ratio * (r2 - r1)
    }
  }
  return DURATION_ANCHORS[DURATION_ANCHORS.length - 1][1]
}

export function calculateCarbs_DistanceAdaptive(inputs, config) {
  const { goal_minutes, effort, training_mode } = inputs

  let carbPerHour = interpolateFromAnchors(goal_minutes)

  // Apply effort modifier (easy: -15%, race_pace: 0%, hard: +15%)
  const effortMod = config.effort_modifiers?.[effort] ?? 1.0
  carbPerHour *= effortMod

  if (training_mode) {
    carbPerHour *= config.training_mode.carb_rate_multiplier
  }

  return Math.round(carbPerHour)
}

/**
 * Registry of all available strategies
 * Core system uses this to select strategy dynamically from config
 */
export const carbStrategies = {
  effort_based:       calculateCarbs_EffortBased,
  duration_based:     calculateCarbs_DurationBased,
  hybrid:             calculateCarbs_Hybrid,
  vo2max_adjusted:    calculateCarbs_VO2MaxAdjusted,
  distance_adaptive:  calculateCarbs_DistanceAdaptive,
}

/**
 * Select and execute strategy
 * @param {string} strategyName - Key from carbStrategies
 * @param {object} inputs - Race/athlete inputs
 * @param {object} config - Formula configuration
 * @returns {number} Carbs per hour (g/h)
 */
export function selectCarbStrategy(strategyName, inputs, config) {
  const strategy = carbStrategies[strategyName]
  if (!strategy) {
    throw new Error(
      `Unknown carb strategy "${strategyName}". Valid options: ${Object.keys(carbStrategies).join(', ')}`
    )
  }
  return strategy(inputs, config)
}

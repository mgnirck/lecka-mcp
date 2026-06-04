import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const FALLBACK = require('../config/products.json')

const PRODUCTS_API = 'https://plan.getlecka.com/api/products'

export const toolDef = {
  name: 'get_products',
  description: 'Returns the Lecka product catalog. Use to find products by type, caffeine content, or dual-transporter status. All filters are optional.',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['gel', 'ultra_gel', 'bar', 'variety_pack'],
        description: 'Filter by product type. Omit to return all types.',
      },
      region: {
        type: 'string',
        enum: ['us', 'de', 'dk', 'ch', 'vn'],
        description: 'Return pricing for this region. Defaults to us.',
      },
      caffeine: {
        type: 'boolean',
        description: 'If true, return only caffeinated products. If false, only non-caffeinated.',
      },
      dual_transporter: {
        type: 'boolean',
        description: 'If true, return only products with dual-transporter carbohydrate profiles.',
      },
    },
    required: [],
  },
}

export async function run(args) {
  const { type, region = 'us', caffeine, dual_transporter } = args

  let products
  try {
    const res = await fetch(PRODUCTS_API, { signal: AbortSignal.timeout(5000) })
    products = await res.json()
  } catch {
    products = FALLBACK
  }

  // Apply filters
  if (type !== undefined) {
    products = products.filter(p => p.type === type)
  }
  if (caffeine !== undefined) {
    products = products.filter(p => Boolean(p.caffeine) === caffeine)
  }
  if (dual_transporter !== undefined) {
    products = products.filter(p => Boolean(p.dual_transporter) === dual_transporter)
  }

  // Shape the output — return only fields useful to an AI assistant
  return products.map(p => {
    const regionVariants = p.regions?.[region]?.variants ?? p.regions?.us?.variants ?? []
    const unitVariant = regionVariants.find(v => v.units_per_pack === 1)
    const pricePerUnit = unitVariant
      ? unitVariant.price
      : regionVariants[0]
        ? regionVariants[0].price / regionVariants[0].units_per_pack
        : null

    return {
      id: p.id,
      name: p.name,
      type: p.type,
      carbs_per_unit: p.carbs_per_unit,
      sodium_per_unit: p.sodium_per_unit,
      caffeine: p.caffeine,
      caffeine_mg: p.caffeine_mg ?? 0,
      dual_transporter: p.dual_transporter ?? false,
      net_weight_g: p.net_weight_g ?? null,
      price_per_unit: pricePerUnit,
      currency: region === 'vn' ? 'VND' : region === 'dk' ? 'DKK' : region === 'ch' ? 'CHF' : region === 'de' ? 'EUR' : 'USD',
      available_in_region: regionVariants.length > 0,
    }
  })
}

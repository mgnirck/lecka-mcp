import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const FALLBACK = require('../config/products.json')

const PRODUCTS_API = 'https://plan.getlecka.com/api/products'
const REGIONS = ['us', 'de', 'dk', 'ch', 'vn']

export const toolDef = {
  name: 'get_nutrition_data',
  description: 'Returns full nutritional information and regional pricing for a specific Lecka product. Use the product ID from get_products.',
  inputSchema: {
    type: 'object',
    properties: {
      product_id: {
        type: 'string',
        description: 'The Lecka product ID. Obtain from get_products.',
      },
    },
    required: ['product_id'],
  },
}

export async function run(args) {
  const { product_id } = args
  if (!product_id) throw new Error('product_id is required')

  let products
  try {
    const res = await fetch(PRODUCTS_API, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) throw new Error(`API returned ${res.status}`)
    products = await res.json()
  } catch {
    products = FALLBACK
  }

  const product = products.find(p => p.id === product_id)
  if (!product) throw new Error(`Product not found: ${product_id}`)

  const pricing = {}
  for (const region of REGIONS) {
    const variants = product.regions?.[region]?.variants ?? []
    if (variants.length > 0) {
      pricing[region] = variants.map(v => ({
        units_per_pack: v.units_per_pack,
        price: v.price,
      }))
    }
  }

  return {
    id: product.id,
    name: product.name,
    type: product.type,
    carbs_per_unit: product.carbs_per_unit,
    sodium_per_unit: product.sodium_per_unit,
    caffeine: product.caffeine,
    caffeine_mg: product.caffeine_mg ?? 0,
    dual_transporter: product.dual_transporter ?? false,
    net_weight_g: product.net_weight_g ?? null,
    ideal_time: product.ideal_time ?? null,
    ingredients: product.ingredients ?? null,
    lab_report: product.lab_report ?? null,
    lab_date: product.lab_date ?? null,
    pricing,
  }
}

import { toolDef as getProductsDef, run as runGetProducts } from '../tools/get-products.js'
import { toolDef as calculateFuelingDef, run as runCalculateFueling } from '../tools/calculate-fueling.js'
import { toolDef as getNutritionDef, run as runGetNutrition } from '../tools/get-nutrition.js'

const TOOLS = [getProductsDef, calculateFuelingDef, getNutritionDef]
const RUNNERS = {
  get_products: runGetProducts,
  calculate_fueling_plan: runCalculateFueling,
  get_nutrition_data: runGetNutrition,
}

function ok(id, result) {
  return { jsonrpc: '2.0', id, result }
}

function err(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

async function handleOne(request) {
  const { method, params, id } = request

  // Notifications (no id) need no response
  if (id === undefined) return null

  if (method === 'initialize') {
    return ok(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'lecka', version: '1.0.0' },
    })
  }

  if (method === 'tools/list') {
    return ok(id, { tools: TOOLS })
  }

  if (method === 'tools/call') {
    const runner = RUNNERS[params?.name]
    if (!runner) {
      return ok(id, {
        content: [{ type: 'text', text: `Unknown tool: ${params?.name}` }],
        isError: true,
      })
    }
    try {
      const result = await runner(params.arguments ?? {})
      return ok(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] })
    } catch (e) {
      return ok(id, { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true })
    }
  }

  return err(id, -32601, `Method not found: ${method}`)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json(err(null, -32700, 'Method not allowed'))
    return
  }

  const body = req.body
  const isBatch = Array.isArray(body)
  const requests = isBatch ? body : [body]

  const responses = (await Promise.all(requests.map(handleOne))).filter(Boolean)

  if (responses.length === 0) {
    res.status(204).end()
    return
  }

  res.status(200).json(isBatch ? responses : responses[0])
}

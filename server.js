import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

import { toolDef as getProductsDef, run as runGetProducts } from './tools/get-products.js'
import { toolDef as calculateFuelingDef, run as runCalculateFueling } from './tools/calculate-fueling.js'
import { toolDef as getNutritionDef, run as runGetNutrition } from './tools/get-nutrition.js'

const server = new Server(
  { name: 'lecka', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

const TOOLS = [getProductsDef, calculateFuelingDef, getNutritionDef]
const RUNNERS = {
  get_products: runGetProducts,
  calculate_fueling_plan: runCalculateFueling,
  get_nutrition_data: runGetNutrition,
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const runner = RUNNERS[request.params.name]
  if (!runner) {
    return { content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }], isError: true }
  }
  try {
    const result = await runner(request.params.arguments ?? {})
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)

import { sql } from '@vercel/postgres'

function sanitizeParams(toolName, args) {
  if (toolName === 'calculate_fueling_plan') {
    // weight_kg is personal health data — omit from logs
    const { weight_kg, ...safe } = args
    return safe
  }
  return args
}

export function logToolCall({ tool, args, region, race_type, error, duration_ms }) {
  const params = sanitizeParams(tool, args ?? {})
  sql`
    INSERT INTO mcp_tool_calls (tool, params, region, race_type, error, duration_ms)
    VALUES (
      ${tool},
      ${JSON.stringify(params)}::jsonb,
      ${region ?? null},
      ${race_type ?? null},
      ${error},
      ${duration_ms}
    )
  `.catch(() => {})
}

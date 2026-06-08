import { sql } from '@vercel/postgres'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const adminPassword = process.env.ADMIN_PASSWORD
  if (!adminPassword || req.headers['x-admin-password'] !== adminPassword) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const [
    totalsAll,
    totalsMonth,
    totalsToday,
    byTool,
    byRegion,
    byRaceType,
    byProduct,
    errorRate,
    dailyCalls,
  ] = await Promise.all([
    sql`SELECT COUNT(*)::int AS count FROM mcp_tool_calls`,
    sql`SELECT COUNT(*)::int AS count FROM mcp_tool_calls
        WHERE called_at >= date_trunc('month', NOW())`,
    sql`SELECT COUNT(*)::int AS count FROM mcp_tool_calls
        WHERE called_at >= date_trunc('day', NOW())`,
    sql`SELECT tool, COUNT(*)::int AS count
        FROM mcp_tool_calls
        GROUP BY tool
        ORDER BY count DESC`,
    sql`SELECT region, COUNT(*)::int AS count
        FROM mcp_tool_calls
        WHERE region IS NOT NULL
        GROUP BY region
        ORDER BY count DESC`,
    sql`SELECT race_type, COUNT(*)::int AS count
        FROM mcp_tool_calls
        WHERE race_type IS NOT NULL
        GROUP BY race_type
        ORDER BY count DESC`,
    sql`SELECT params->>'product_id' AS product_id, COUNT(*)::int AS count
        FROM mcp_tool_calls
        WHERE tool = 'get_nutrition_data'
          AND params->>'product_id' IS NOT NULL
        GROUP BY product_id
        ORDER BY count DESC`,
    sql`SELECT
          ROUND(
            COUNT(*) FILTER (WHERE error = true)::numeric
            / NULLIF(COUNT(*), 0),
            4
          ) AS rate
        FROM mcp_tool_calls`,
    sql`SELECT DATE(called_at)::text AS date, COUNT(*)::int AS count
        FROM mcp_tool_calls
        WHERE called_at >= NOW() - INTERVAL '90 days'
        GROUP BY DATE(called_at)
        ORDER BY date`,
  ])

  res.status(200).json({
    totals: {
      all_time: totalsAll.rows[0]?.count ?? 0,
      this_month: totalsMonth.rows[0]?.count ?? 0,
      today: totalsToday.rows[0]?.count ?? 0,
    },
    by_tool: byTool.rows,
    by_region: byRegion.rows,
    by_race_type: byRaceType.rows,
    by_product: byProduct.rows,
    error_rate: parseFloat(errorRate.rows[0]?.rate ?? 0),
    daily_calls_90d: dailyCalls.rows,
  })
}

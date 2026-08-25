import { AlertTriangle, Bot, Gauge, PoundSterling } from "lucide-react";
import { AdminHeading } from "@/components/admin/admin-shell";
import { requireAdminPage } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const usd = new Intl.NumberFormat("en-GB", { style: "currency", currency: "USD", minimumFractionDigits: 4, maximumFractionDigits: 4 });

function number(value: unknown) {
  return Number(value ?? 0);
}

function startOfDay(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export default async function AiUsagePage() {
  await requireAdminPage();
  const now = new Date();
  const today = startOfDay(now);
  const sevenDays = new Date(now.getTime() - 7 * 86_400_000);
  const fourteenDays = new Date(now.getTime() - 14 * 86_400_000);
  const thirtyDays = new Date(now.getTime() - 30 * 86_400_000);

  const data = await prisma.$transaction(async (tx) => Promise.all([
    tx.aiUsageEvent.aggregate({ where: { createdAt: { gte: today } }, _sum: { estimatedCostUsd: true }, _count: true, _avg: { latencyMs: true } }),
    tx.aiUsageEvent.aggregate({ where: { createdAt: { gte: sevenDays } }, _sum: { estimatedCostUsd: true }, _count: true, _avg: { latencyMs: true } }),
    tx.aiUsageEvent.aggregate({ where: { createdAt: { gte: thirtyDays } }, _sum: { estimatedCostUsd: true }, _count: true, _avg: { latencyMs: true } }),
    tx.aiUsageEvent.aggregate({ where: { createdAt: { gte: sevenDays }, model: "gpt-5.6-terra" }, _count: true }),
    tx.aiUsageEvent.aggregate({ where: { createdAt: { gte: fourteenDays, lt: sevenDays } }, _sum: { estimatedCostUsd: true }, _count: true }),
    tx.aiUsageEvent.groupBy({ by: ["model"], where: { createdAt: { gte: thirtyDays } }, _sum: { estimatedCostUsd: true, inputTokens: true, cachedInputTokens: true, outputTokens: true }, _count: true, orderBy: { _sum: { estimatedCostUsd: "desc" } } }),
    tx.aiUsageEvent.groupBy({ by: ["task"], where: { createdAt: { gte: thirtyDays } }, _sum: { estimatedCostUsd: true }, _avg: { latencyMs: true }, _count: true, orderBy: { _sum: { estimatedCostUsd: "desc" } } }),
    tx.aiUsageEvent.findMany({ where: { createdAt: { gte: thirtyDays }, workflowId: { not: null } }, distinct: ["workflowId"], select: { workflowId: true } }),
    tx.aiUsageEvent.findMany({ where: { createdAt: { gte: thirtyDays }, quoteRequestId: { not: null } }, distinct: ["quoteRequestId"], select: { quoteRequestId: true } }),
    tx.buyerOrder.count({ where: { completedAt: { gte: thirtyDays } } }),
    tx.aiUsageEvent.findMany({ where: { createdAt: { gte: thirtyDays } }, orderBy: { estimatedCostUsd: "desc" }, take: 12, select: { id: true, model: true, task: true, estimatedCostUsd: true, latencyMs: true, attempts: true, escalationReason: true, createdAt: true } }),
  ]));

  const [todayUsage, weekUsage, monthUsage, terraWeek, previousWeek, byModel, byTask, buyers, requests, completedOrders, costly] = data;
  const monthCost = number(monthUsage._sum.estimatedCostUsd);
  const weekCost = number(weekUsage._sum.estimatedCostUsd);
  const previousWeekCost = number(previousWeek._sum.estimatedCostUsd);
  const terraShare = weekUsage._count ? terraWeek._count / weekUsage._count : 0;
  const warnings = [
    terraShare >= 0.2 && weekUsage._count >= 10 ? `Terra handled ${(terraShare * 100).toFixed(1)}% of AI calls in the last seven days. Review escalation reasons.` : null,
    previousWeekCost >= 0.25 && weekCost >= previousWeekCost * 2 ? `AI spend is more than twice the previous seven-day period (${usd.format(previousWeekCost)} → ${usd.format(weekCost)}).` : null,
  ].filter(Boolean) as string[];

  const cards = [
    ["Today", usd.format(number(todayUsage._sum.estimatedCostUsd)), `${todayUsage._count} calls · ${Math.round(number(todayUsage._avg.latencyMs))}ms average`],
    ["Last 7 days", usd.format(weekCost), `${weekUsage._count} calls · ${(terraShare * 100).toFixed(1)}% Terra`],
    ["Last 30 days", usd.format(monthCost), `${monthUsage._count} calls · ${Math.round(number(monthUsage._avg.latencyMs))}ms average`],
    ["Average per RFQ", usd.format(requests.length ? monthCost / requests.length : 0), `${requests.length} requests with AI usage`],
    ["Average per active buyer", usd.format(buyers.length ? monthCost / buyers.length : 0), `${buyers.length} active WhatsApp conversations`],
    ["Average per completed order", usd.format(completedOrders ? monthCost / completedOrders : 0), `${completedOrders} completed orders in period`],
  ] as const;

  return <>
    <AdminHeading eyebrow="Luna-first control centre" title="AI usage & routing" description="Real OpenAI usage, routing decisions and estimated API cost. Customer messages and uploaded files are never stored in this telemetry." />

    {warnings.length > 0 && <section className="honesty-note spaced-section" aria-label="AI usage guardrails">
      <b><AlertTriangle size={16} /> Cost guardrail warning</b>
      {warnings.map((warning) => <p key={warning}>{warning}</p>)}
    </section>}

    <section className="stats-grid" aria-label="AI cost summary">
      {cards.map(([label, value, detail], index) => <article className="stat-card" key={label}>
        <span>{index < 3 ? <PoundSterling size={18} /> : index === 3 ? <Gauge size={18} /> : <Bot size={18} />}{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </article>)}
    </section>

    <div className="management-grid">
      <section className="panel admin-table-wrap">
        <div className="section-heading"><div><p className="eyebrow">Last 30 days</p><h2>Cost by model</h2></div><Bot size={20} /></div>
        <table className="admin-table"><thead><tr><th>Model</th><th>Calls</th><th>Input</th><th>Cached</th><th>Output</th><th>Estimated cost</th></tr></thead><tbody>
          {byModel.map((row) => <tr key={row.model}><td><b>{row.model}</b></td><td>{row._count}</td><td>{number(row._sum.inputTokens).toLocaleString("en-GB")}</td><td>{number(row._sum.cachedInputTokens).toLocaleString("en-GB")}</td><td>{number(row._sum.outputTokens).toLocaleString("en-GB")}</td><td><b>{usd.format(number(row._sum.estimatedCostUsd))}</b></td></tr>)}
          {!byModel.length && <tr><td colSpan={6}>No AI usage has been recorded yet.</td></tr>}
        </tbody></table>
      </section>

      <section className="panel admin-table-wrap">
        <div className="section-heading"><div><p className="eyebrow">Workflow efficiency</p><h2>Cost by task</h2></div><Gauge size={20} /></div>
        <table className="admin-table"><thead><tr><th>Task</th><th>Calls</th><th>Latency</th><th>Estimated cost</th></tr></thead><tbody>
          {byTask.map((row) => <tr key={row.task}><td><b>{row.task.replaceAll("_", " ")}</b></td><td>{row._count}</td><td>{Math.round(number(row._avg.latencyMs))}ms</td><td><b>{usd.format(number(row._sum.estimatedCostUsd))}</b></td></tr>)}
          {!byTask.length && <tr><td colSpan={4}>No AI tasks have been recorded yet.</td></tr>}
        </tbody></table>
      </section>
    </div>

    <section className="panel admin-table-wrap spaced-section">
      <div className="section-heading"><div><p className="eyebrow">Review queue</p><h2>Highest-cost calls</h2></div><AlertTriangle size={20} /></div>
      <table className="admin-table"><thead><tr><th>Time</th><th>Task</th><th>Model</th><th>Reason</th><th>Attempts</th><th>Latency</th><th>Cost</th></tr></thead><tbody>
        {costly.map((event) => <tr key={event.id}><td>{event.createdAt.toLocaleString("en-GB")}</td><td>{event.task.replaceAll("_", " ")}</td><td><b>{event.model}</b></td><td>{event.escalationReason.replaceAll("_", " ")}</td><td>{event.attempts}</td><td>{event.latencyMs}ms</td><td><b>{usd.format(number(event.estimatedCostUsd))}</b></td></tr>)}
        {!costly.length && <tr><td colSpan={7}>No AI calls recorded.</td></tr>}
      </tbody></table>
    </section>
  </>;
}

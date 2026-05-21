import { AuditConfig, AuditFinding, BudgetEntry, DEFAULT_AUDIT_CONFIG, WorkHourEntry } from './types';

function generateId(...parts: string[]): string {
  const str = parts.join('::');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function checkPersonBudget(entries: WorkHourEntry[], budgets: BudgetEntry[], config?: AuditConfig): AuditFinding[] {
  const cfg = { ...DEFAULT_AUDIT_CONFIG, ...config };
  const findings: AuditFinding[] = [];
  const budgetMap = new Map<string, BudgetEntry>();
  for (const b of budgets) budgetMap.set(`${b.person}|${b.subProduct}`, b);

  for (const e of entries) {
    const budget = budgetMap.get(`${e.name}|${e.subProduct}`);
    if (!budget || budget.weeklyBudgetHours === 0) continue;
    const actual = e.total, planned = budget.weeklyBudgetHours;
    const variance = ((actual - planned) / planned) * 100;
    const rounded = Math.round(variance);

    if (actual > planned * 2) {
      findings.push({
        id: generateId('budget-critical', e.name, e.subProduct, e._dateRange),
        severity: 'error', category: 'budget', person: e.name, subProduct: e.subProduct, week: e._dateRange,
        message: `${e.name} 严重超预算: ${actual}人天 vs ${planned}人天 (超${rounded}%)`,
        detail: `预算每人每周${planned}人天`,
        suggestion: '严重偏差需重点核实',
        value: actual, expectedValue: planned,
      });
    } else if (variance > cfg.budgetVariancePercent) {
      findings.push({
        id: generateId('budget-over', e.name, e.subProduct, e._dateRange),
        severity: 'warning', category: 'budget', person: e.name, subProduct: e.subProduct, week: e._dateRange,
        message: `${e.name} 超预算: ${actual}人天 vs ${planned}人天 (超${rounded}%)`,
        detail: `预算每人每周${planned}人天`,
        suggestion: '确认超预算原因',
        value: actual, expectedValue: planned,
      });
    } else if (variance < -cfg.budgetVariancePercent) {
      findings.push({
        id: generateId('budget-under', e.name, e.subProduct, e._dateRange),
        severity: 'info', category: 'budget', person: e.name, subProduct: e.subProduct, week: e._dateRange,
        message: `${e.name} 低于预算: ${actual}人天 vs ${planned}人天 (低${Math.abs(rounded)}%)`,
        detail: `预算每人每周${planned}人天`,
        suggestion: '确认任务分配是否不足',
        value: actual, expectedValue: planned,
      });
    }
  }
  return findings;
}

export function runBudgetChecks(entries: WorkHourEntry[], budgets?: BudgetEntry[], config?: AuditConfig): AuditFinding[] {
  if (!budgets || budgets.length === 0) return [];
  return checkPersonBudget(entries, budgets, config);
}

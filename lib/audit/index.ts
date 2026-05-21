import { AuditConfig, AuditFinding, AuditSummary, AuditResult, BudgetEntry, DEFAULT_AUDIT_CONFIG, WorkHourEntry } from './types';
import { runConsistencyChecks } from './consistency';
import { runReasonablenessChecks } from './reasonableness';
import { runBudgetChecks } from './budget';
import { runWeeklyReportChecks } from './weekly-report';
import { runTaskHoursChecks } from './task-hours';

export type { AuditConfig, AuditFinding, AuditResult, AuditSeverity, AuditCategory, AuditSummary, BudgetEntry, WorkHourEntry, JiraTask, WeeklyReportTooltip } from './types';
export { DEFAULT_AUDIT_CONFIG } from './types';

export function runAudit(
  data: WorkHourEntry[],
  budgets?: BudgetEntry[],
  config?: AuditConfig
): AuditResult {
  const cfg = config ?? DEFAULT_AUDIT_CONFIG;

  const consistencyFindings = runConsistencyChecks(data, cfg);
  const reasonablenessFindings = runReasonablenessChecks(data, cfg);
  const budgetFindings = runBudgetChecks(data, budgets, cfg);
  const weeklyReportFindings = runWeeklyReportChecks(data);
  const taskHoursFindings = runTaskHoursChecks(data, cfg);

  const allFindings: AuditFinding[] = [
    ...consistencyFindings,
    ...reasonablenessFindings,
    ...budgetFindings,
    ...weeklyReportFindings,
    ...taskHoursFindings,
  ];

  // Deduplicate by id
  const seenIds = new Set<string>();
  const dedupedFindings: AuditFinding[] = [];
  for (const f of allFindings) {
    let id = f.id;
    let counter = 0;
    while (seenIds.has(id)) { counter++; id = `${f.id}_${counter}`; }
    seenIds.add(id);
    dedupedFindings.push({ ...f, id });
  }

  const uniquePersons = new Set(data.map(e => e.name));
  const uniqueWeeks = new Set(data.map(e => e._dateRange));

  const summary: AuditSummary = {
    totalFindings: dedupedFindings.length,
    errorCount: dedupedFindings.filter(f => f.severity === 'error').length,
    warningCount: dedupedFindings.filter(f => f.severity === 'warning').length,
    infoCount: dedupedFindings.filter(f => f.severity === 'info').length,
    consistencyCount: consistencyFindings.length,
    reasonablenessCount: reasonablenessFindings.length,
    budgetCount: budgetFindings.length,
    weeklyReportCount: weeklyReportFindings.length,
    taskHoursCount: taskHoursFindings.length,
    personsAudited: uniquePersons.size,
    weeksAudited: uniqueWeeks.size,
  };

  return { findings: dedupedFindings, summary, data };
}

export function parseWorkHourData(json: string): WorkHourEntry[] {
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error('工时数据必须为数组');
  return parsed as WorkHourEntry[];
}

export function parseBudgetData(json: string): BudgetEntry[] {
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error('预算数据必须为数组');
  return parsed as BudgetEntry[];
}

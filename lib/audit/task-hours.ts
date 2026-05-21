// Check: JIRA task actual hours / 8 vs reported 人天
import { AuditConfig, AuditFinding, DEFAULT_AUDIT_CONFIG, WorkHourEntry } from './types';

function generateId(...parts: string[]): string {
  const str = parts.join('::');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function checkTaskHoursMatch(
  entries: WorkHourEntry[],
  config?: AuditConfig
): AuditFinding[] {
  const cfg = { ...DEFAULT_AUDIT_CONFIG, ...config };
  const findings: AuditFinding[] = [];

  for (const e of entries) {
    if (!e.tooltipData || e.tooltipData.tasks.length === 0) continue;

    const td = e.tooltipData;
    const actualPersonDays = td.actualPersonDays; // totalActualHours / 8
    const reportedPersonDays = e.total;

    if (reportedPersonDays === 0 && actualPersonDays === 0) continue;
    if (reportedPersonDays === 0) {
      findings.push({
        id: generateId('task-zero-report', e.name, e._dateRange, e.subProduct),
        severity: 'error',
        category: 'taskHours',
        person: e.name,
        subProduct: e.subProduct,
        week: e._dateRange,
        message: `${e.name} 填报为 0 人天，但工单实际工作 ${td.totalActualHours}h (${actualPersonDays.toFixed(1)}人天)`,
        detail: `${e.projectName} / ${e.subProduct}: ${td.tasks.length} 个工单，实际合计 ${td.totalActualHours}h = ${actualPersonDays.toFixed(2)}人天`,
        suggestion: '确认工时填报是否遗漏',
        value: 0,
        expectedValue: parseFloat(actualPersonDays.toFixed(2)),
      });
      continue;
    }

    const variance = Math.abs(actualPersonDays - reportedPersonDays) / reportedPersonDays * 100;

    if (variance > cfg.taskHourVariancePercent * 5) {
      // > 50% deviation → error
      findings.push({
        id: generateId('task-hour-critical', e.name, e._dateRange, e.subProduct),
        severity: 'error',
        category: 'taskHours',
        person: e.name,
        subProduct: e.subProduct,
        week: e._dateRange,
        message: `${e.name} 工单工时严重不一致: 填报 ${reportedPersonDays}人天, 工单实际 ${td.totalActualHours}h = ${actualPersonDays.toFixed(1)}人天 (差 ${Math.round(variance)}%)`,
        detail: `${e.projectName} / ${e.subProduct}: ${td.tasks.length} 个工单合计 ${td.totalActualHours}h (${actualPersonDays.toFixed(2)}人天) vs 填报 ${reportedPersonDays}人天`,
        suggestion: '核实是否漏填工单或填报人天有误',
        value: reportedPersonDays,
        expectedValue: parseFloat(actualPersonDays.toFixed(2)),
      });
    } else if (variance > cfg.taskHourVariancePercent) {
      // > 10% deviation → warning
      findings.push({
        id: generateId('task-hour-warn', e.name, e._dateRange, e.subProduct),
        severity: 'warning',
        category: 'taskHours',
        person: e.name,
        subProduct: e.subProduct,
        week: e._dateRange,
        message: `${e.name} 工单工时有偏差: 填报 ${reportedPersonDays}人天, 工单实际 ${td.totalActualHours}h = ${actualPersonDays.toFixed(1)}人天 (差 ${Math.round(variance)}%)`,
        detail: `${e.projectName} / ${e.subProduct}: ${td.tasks.length} 个工单合计 ${td.totalActualHours}h (${actualPersonDays.toFixed(2)}人天) vs 填报 ${reportedPersonDays}人天`,
        suggestion: '检查是否有任务遗漏或填报误差',
        value: reportedPersonDays,
        expectedValue: parseFloat(actualPersonDays.toFixed(2)),
      });
    }
  }
  return findings;
}

export function checkPlanVsActual(
  entries: WorkHourEntry[],
  config?: AuditConfig
): AuditFinding[] {
  const findings: AuditFinding[] = [];

  for (const e of entries) {
    if (!e.tooltipData || e.tooltipData.tasks.length === 0) continue;

    const td = e.tooltipData;
    if (td.totalPlanHours === 0) continue;

    const ratio = td.totalActualHours / td.totalPlanHours;

    if (ratio < 0.3 && td.totalPlanHours > 8) {
      findings.push({
        id: generateId('plan-under', e.name, e._dateRange, e.subProduct),
        severity: 'warning',
        category: 'taskHours',
        person: e.name,
        subProduct: e.subProduct,
        week: e._dateRange,
        message: `${e.name} 实际工时远低于计划: 计划 ${td.totalPlanHours}h, 实际 ${td.totalActualHours}h (仅完成 ${Math.round(ratio * 100)}%)`,
        detail: `${e.projectName} / ${e.subProduct}: ${td.tasks.length} 个工单，计划工作量 ${td.totalPlanHours}h，实际完成 ${td.totalActualHours}h`,
        suggestion: '确认任务进度是否符合预期',
        value: td.totalActualHours,
        expectedValue: td.totalPlanHours,
      });
    }
  }
  return findings;
}

export function runTaskHoursChecks(
  entries: WorkHourEntry[],
  config?: AuditConfig
): AuditFinding[] {
  return [
    ...checkTaskHoursMatch(entries, config),
    ...checkPlanVsActual(entries, config),
  ];
}

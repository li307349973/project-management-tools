// Check: 项目周报 must be filled
import { AuditFinding, WorkHourEntry } from './types';

function generateId(...parts: string[]): string {
  const str = parts.join('::');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function checkWeeklyReport(entries: WorkHourEntry[]): AuditFinding[] {
  const findings: AuditFinding[] = [];

  for (const e of entries) {
    // Only check entries that have tooltip data (i.e., user extracted it)
    if (!e.tooltipData) continue;

    const td = e.tooltipData;

    if (!td.weeklyReportText || td.weeklyReportText === '无' || td.weeklyReportText.trim() === '') {
      findings.push({
        id: generateId('weekly-report-empty', e.name, e._dateRange, e.subProduct),
        severity: 'error',
        category: 'weeklyReport',
        person: e.name,
        subProduct: e.subProduct,
        week: e._dateRange,
        message: `${e.name} 项目周报未填写 (${e._dateRange}, ${e.subProduct})`,
        detail: `${e.projectName} / ${e.subProduct}: 该周的项目周报内容为空，必须填写本周工作内容摘要`,
        suggestion: '请补充项目周报内容，描述本周完成的主要工作',
      });
    }
  }
  return findings;
}

export function runWeeklyReportChecks(entries: WorkHourEntry[]): AuditFinding[] {
  return checkWeeklyReport(entries);
}

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

function getEdgeWeeks(group: WorkHourEntry[]): { first: string | null; last: string | null } {
  if (group.length === 0) return { first: null, last: null };
  const sorted = [...group].sort((a, b) => a._dateRange.localeCompare(b._dateRange));
  return { first: sorted[0]._dateRange, last: sorted[sorted.length - 1]._dateRange };
}

export function checkImpossibleHours(entries: WorkHourEntry[], config?: AuditConfig): AuditFinding[] {
  const cfg = { ...DEFAULT_AUDIT_CONFIG, ...config };
  const findings: AuditFinding[] = [];
  for (const e of entries) {
    if (e.hours.length !== 7) {
      findings.push({
        id: generateId('malformed', e.name, e._dateRange),
        severity: 'error', category: 'reasonableness',
        person: e.name, subProduct: e.subProduct, week: e._dateRange,
        message: `数据格式异常: 数组长度 ${e.hours.length}（预期7）`,
        detail: `hours数组包含 ${e.hours.length} 个元素`,
        suggestion: '检查数据采集过程',
        value: e.hours.length, expectedValue: 7,
      });
      continue;
    }
    const maxDay = Math.max(...e.hours);
    if (maxDay > cfg.maxDailyHours) {
      findings.push({
        id: generateId('impossible-day', e.name, e._dateRange),
        severity: 'error', category: 'reasonableness',
        person: e.name, subProduct: e.subProduct, week: e._dateRange,
        message: `${e.name} 单日 ${maxDay}人天，超过${cfg.maxDailyHours}人天`,
        detail: `日分布: [${e.hours.join(', ')}]`,
        suggestion: '核实数据录入错误',
        value: maxDay, expectedValue: cfg.maxDailyHours,
      });
    } else if (maxDay > cfg.suspiciousDailyHours) {
      findings.push({
        id: generateId('suspicious-day', e.name, e._dateRange),
        severity: 'warning', category: 'reasonableness',
        person: e.name, subProduct: e.subProduct, week: e._dateRange,
        message: `${e.name} 单日 ${maxDay}人天，超过${cfg.suspiciousDailyHours}人天`,
        detail: `日分布: [${e.hours.join(', ')}]`,
        suggestion: '确认高强度工作日是否合理',
        value: maxDay, expectedValue: cfg.suspiciousDailyHours,
      });
    }
    if (e.total > cfg.maxWeeklyHours) {
      findings.push({
        id: generateId('impossible-week', e.name, e._dateRange),
        severity: 'error', category: 'reasonableness',
        person: e.name, subProduct: e.subProduct, week: e._dateRange,
        message: `周总 ${e.total}人天，超过${cfg.maxWeeklyHours}人天`,
        detail: `日分布: [${e.hours.join(', ')}]`,
        suggestion: '核实数据累加错误',
        value: e.total, expectedValue: cfg.maxWeeklyHours,
      });
    } else if (e.total > cfg.suspiciousWeeklyHours) {
      findings.push({
        id: generateId('suspicious-week', e.name, e._dateRange),
        severity: 'warning', category: 'reasonableness',
        person: e.name, subProduct: e.subProduct, week: e._dateRange,
        message: `周总 ${e.total}人天，超过${cfg.suspiciousWeeklyHours}人天`,
        detail: `日分布: [${e.hours.join(', ')}]`,
        suggestion: '确认高强度工作周是否合理',
        value: e.total, expectedValue: cfg.suspiciousWeeklyHours,
      });
    }
  }
  return findings;
}

export function checkZeroHourWeeks(entries: WorkHourEntry[]): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const personGroups = new Map<string, WorkHourEntry[]>();
  for (const e of entries) {
    const g = personGroups.get(e.name) ?? [];
    g.push(e);
    personGroups.set(e.name, g);
  }
  for (const [person, group] of personGroups) {
    const { first, last } = getEdgeWeeks(group);
    const nonZero = group.filter(e => e.total > 0);
    for (const e of group) {
      if (e.total !== 0) continue;
      const isEdge = e._dateRange === first || e._dateRange === last;
      if (nonZero.length === 0) {
        findings.push({
          id: generateId('all-zero', person, e._dateRange),
          severity: 'warning', category: 'reasonableness',
          person, subProduct: e.subProduct, week: e._dateRange,
          message: `${person} 全部周期工时均为0`,
          detail: `从 ${group[0]._dateRange} 到 ${group[group.length - 1]._dateRange}`,
          suggestion: '确认此人员是否未参与该项目',
        });
        break;
      }
      findings.push({
        id: generateId('zero-week', person, e._dateRange),
        severity: isEdge ? 'info' : 'warning', category: 'reasonableness',
        person, subProduct: e.subProduct, week: e._dateRange,
        message: isEdge ? `${person} ${e._dateRange} 为零工时（可能是入职/离职周）` : `${person} ${e._dateRange} 填报为 0h`,
        detail: isEdge ? '首尾周的零工时可能是合理的' : '非首尾周零工时：确认是否漏填',
        suggestion: isEdge ? '确认入职/离职时间' : '核实是否漏填或已退出项目',
      });
    }
  }
  return findings;
}

export function checkPartialWeeks(entries: WorkHourEntry[]): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const personGroups = new Map<string, WorkHourEntry[]>();
  for (const e of entries) {
    const g = personGroups.get(e.name) ?? [];
    g.push(e);
    personGroups.set(e.name, g);
  }
  for (const [person, group] of personGroups) {
    const { first, last } = getEdgeWeeks(group);
    for (const e of group) {
      const nonZeroDays = e.hours.filter(h => h > 0).length;
      if (nonZeroDays < 1 || nonZeroDays > 3) continue;
      if (e._dateRange === first || e._dateRange === last) continue;
      findings.push({
        id: generateId('partial', person, e._dateRange),
        severity: 'info', category: 'reasonableness',
        person, subProduct: e.subProduct, week: e._dateRange,
        message: `${person} 仅填报 ${nonZeroDays} 天`,
        detail: `日分布: [${e.hours.join(', ')}], 总 ${e.total}人天`,
        suggestion: '确认此周是否请假或有特殊安排',
        value: nonZeroDays, expectedValue: 5,
      });
    }
  }
  return findings;
}

export function checkWeekendHours(entries: WorkHourEntry[], config?: AuditConfig): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const e of entries) {
    if (e.hours.length < 7) continue;
    const weekendTotal = (e.hours[5] ?? 0) + (e.hours[6] ?? 0);
    const weekdayTotal = e.hours[0] + e.hours[1] + e.hours[2] + e.hours[3] + e.hours[4];
    if (weekendTotal > 8) {
      findings.push({
        id: generateId('weekend-high', e.name, e._dateRange),
        severity: 'warning', category: 'reasonableness',
        person: e.name, subProduct: e.subProduct, week: e._dateRange,
        message: `周末共 ${weekendTotal}人天`,
        detail: `工作日 ${weekdayTotal}人天, 周末 ${weekendTotal}人天`,
        suggestion: '确认是否存在紧急加班',
        value: weekendTotal, expectedValue: 8,
      });
    }
    if (weekdayTotal === 0 && weekendTotal > 0 && e.total > 0) {
      findings.push({
        id: generateId('weekend-only', e.name, e._dateRange),
        severity: 'warning', category: 'reasonableness',
        person: e.name, subProduct: e.subProduct, week: e._dateRange,
        message: `仅周末有填报，工作日全0`,
        detail: `周六: ${e.hours[5]}h, 周日: ${e.hours[6]}h`,
        suggestion: '确认工作日数据是否有遗漏',
        value: weekendTotal,
      });
    }
  }
  return findings;
}

export function runReasonablenessChecks(entries: WorkHourEntry[], config?: AuditConfig): AuditFinding[] {
  return [
    ...checkImpossibleHours(entries, config),
    ...checkZeroHourWeeks(entries),
    ...checkPartialWeeks(entries),
    ...checkWeekendHours(entries, config),
  ];
}

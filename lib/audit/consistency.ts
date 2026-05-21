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

function hoursEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function checkIdenticalWeeks(entries: WorkHourEntry[], config?: AuditConfig): AuditFinding[] {
  const threshold = config?.identicalWeekThreshold ?? DEFAULT_AUDIT_CONFIG.identicalWeekThreshold;
  const findings: AuditFinding[] = [];
  const personGroups = new Map<string, WorkHourEntry[]>();
  for (const e of entries) {
    const g = personGroups.get(e.name) ?? [];
    g.push(e);
    personGroups.set(e.name, g);
  }

  for (const [person, group] of personGroups) {
    group.sort((a, b) => a._dateRange.localeCompare(b._dateRange));
    let runStart = 0;
    for (let i = 1; i <= group.length; i++) {
      const same = i < group.length && hoursEqual(group[i].hours, group[i - 1].hours);
      if (!same) {
        const runLen = i - runStart;
        if (runLen >= threshold) {
          const isAll = runLen === group.length;
          const weeksInRun = group.slice(runStart, i);
          findings.push({
            id: generateId('identical', person, group[runStart]._dateRange),
            severity: isAll ? 'error' : 'warning',
            category: 'consistency',
            person, subProduct: group[runStart].subProduct, week: group[runStart]._dateRange,
            message: isAll
              ? `${person} 全部 ${runLen} 周工时完全相同，疑似未真实填报`
              : `${person} 连续 ${runLen} 周工时完全相同`,
            detail: `工时分布: [${group[runStart].hours.join(', ')}]`,
            suggestion: '核实是否为真实填报，排除复制粘贴',
            value: runLen,
            relatedWeeks: weeksInRun.map(e => e._dateRange),
          });
        }
        runStart = i;
      }
    }
  }
  return findings;
}

export function checkSuddenChanges(entries: WorkHourEntry[], config?: AuditConfig): AuditFinding[] {
  const threshold = config?.spikeThresholdPercent ?? DEFAULT_AUDIT_CONFIG.spikeThresholdPercent;
  const findings: AuditFinding[] = [];
  const personGroups = new Map<string, WorkHourEntry[]>();
  for (const e of entries) {
    const g = personGroups.get(e.name) ?? [];
    g.push(e);
    personGroups.set(e.name, g);
  }

  for (const [person, group] of personGroups) {
    if (group.length < 2) continue;
    group.sort((a, b) => a._dateRange.localeCompare(b._dateRange));
    for (let i = 1; i < group.length; i++) {
      const prev = group[i - 1], curr = group[i];
      if (prev.total === 0 && curr.total > 0) {
        findings.push({
          id: generateId('recover', person, curr._dateRange),
          severity: 'info', category: 'consistency',
          person, subProduct: curr.subProduct, week: curr._dateRange,
          message: `${person} 从 0 恢复至 ${curr.total}h`,
          detail: `上期 ${prev._dateRange} 为 0h`,
          suggestion: '确认是否休假后复工',
          value: curr.total, expectedValue: 0,
        });
        continue;
      }
      if (prev.total === 0 && curr.total === 0) continue;
      const change = Math.abs(curr.total - prev.total) / Math.max(prev.total, 1);
      const pct = Math.round(change * 100);
      const dir = curr.total > prev.total ? '增加' : '减少';
      if (change > 1.0) {
        findings.push({
          id: generateId('spike', person, curr._dateRange),
          severity: 'error', category: 'consistency',
          person, subProduct: curr.subProduct, week: curr._dateRange,
          message: `${person} 工时剧变: ${prev.total}h → ${curr.total}h (${dir} ${pct}%)`,
          detail: `上期 ${prev._dateRange}: ${prev.total}h, 本期 ${curr._dateRange}: ${curr.total}h`,
          suggestion: '核实是否存在任务变更或数据录入错误',
          value: curr.total, expectedValue: prev.total,
          relatedWeeks: [prev._dateRange, curr._dateRange],
        });
      } else if (change > threshold / 100) {
        findings.push({
          id: generateId('volatile', person, curr._dateRange),
          severity: 'warning', category: 'consistency',
          person, subProduct: curr.subProduct, week: curr._dateRange,
          message: `${person} 工时波动: ${prev.total}h → ${curr.total}h (${dir} ${pct}%)`,
          detail: `上期 ${prev._dateRange}: ${prev.total}h, 本期 ${curr._dateRange}: ${curr.total}h`,
          suggestion: '确认工时变化是否合理',
          value: curr.total, expectedValue: prev.total,
          relatedWeeks: [prev._dateRange, curr._dateRange],
        });
      }
    }
  }
  return findings;
}

export function runConsistencyChecks(entries: WorkHourEntry[], config?: AuditConfig): AuditFinding[] {
  return [...checkIdenticalWeeks(entries, config), ...checkSuddenChanges(entries, config)];
}

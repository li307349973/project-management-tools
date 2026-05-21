// === Work Hour Entry (from page table) ===
export interface WorkHourEntry {
  name: string;
  project: string;
  projectName: string;
  subProduct: string;
  role: string;
  status: string;
  hours: number[];       // 7 daily values (人天)
  total: number;          // 合计人天
  _dateRange: string;
  _dates: string[];
  // Tooltip data from hovering "查看" (optional)
  tooltipData?: WeeklyReportTooltip;
}

// === Tooltip / Popover Data (from hovering "查看") ===
export interface JiraTask {
  projectName: string;       // e.g. "通威股份24ATS"
  jiraNo: string;            // e.g. "ATSES-459735"
  jiraSubject: string;       // e.g. "贷款计提利息推送任务修改-代码评审"
  taskType: string;          // e.g. "代码评审"
  taskStatus: string;        // e.g. "已完成"
  planStartDate: string;
  planEndDate: string;
  planHours: number;         // 计划工作量 (小时)
  actualStartDate: string;
  actualEndDate: string;
  actualHours: number;       // 实际工作量 (小时)
  expectedDeliveryDate: string;
}

export interface WeeklyReportTooltip {
  weeklyReportText: string;  // "无" or the actual report content
  tasks: JiraTask[];         // 任务明细
  totalPlanHours: number;    // Sum of all planHours
  totalActualHours: number;  // Sum of all actualHours
  actualPersonDays: number;  // totalActualHours / 8
}

// === Audit Types ===
export type AuditSeverity = 'error' | 'warning' | 'info';
export type AuditCategory = 'consistency' | 'reasonableness' | 'budget' | 'weeklyReport' | 'taskHours';

export interface AuditFinding {
  id: string;
  severity: AuditSeverity;
  category: AuditCategory;
  person: string;
  subProduct: string;
  week: string;
  message: string;
  detail: string;
  suggestion: string;
  value?: number;
  expectedValue?: number;
  relatedWeeks?: string[];
}

export interface AuditSummary {
  totalFindings: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  consistencyCount: number;
  reasonablenessCount: number;
  budgetCount: number;
  weeklyReportCount: number;
  taskHoursCount: number;
  personsAudited: number;
  weeksAudited: number;
}

export interface AuditResult {
  findings: AuditFinding[];
  summary: AuditSummary;
  data: WorkHourEntry[];
}

export interface BudgetEntry {
  person: string;
  subProduct: string;
  weeklyBudgetHours: number;
  monthlyBudgetHours?: number;
  notes?: string;
}

export interface AuditConfig {
  spikeThresholdPercent: number;
  identicalWeekThreshold: number;
  maxDailyHours: number;
  maxWeeklyHours: number;
  suspiciousDailyHours: number;
  suspiciousWeeklyHours: number;
  budgetVariancePercent: number;
  taskHourVariancePercent: number;      // NEW: max allowed % difference between task hours/8 and reported 人天
}

export const DEFAULT_AUDIT_CONFIG: AuditConfig = {
  spikeThresholdPercent: 50,
  identicalWeekThreshold: 3,
  maxDailyHours: 24,
  maxWeeklyHours: 168,
  suspiciousDailyHours: 16,
  suspiciousWeeklyHours: 84,
  budgetVariancePercent: 10,
  taskHourVariancePercent: 10,
};

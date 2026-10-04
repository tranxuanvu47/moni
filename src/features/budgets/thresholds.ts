export type BudgetLevel = 'ok' | 'warning' | 'exceeded' | 'unset';

export interface BudgetProgress {
  level: BudgetLevel;
  ratio: number;
  remaining: number;
  alertKey: '80' | '100' | null;
}

export function evaluateBudget(spent: number, budget: number | null): BudgetProgress {
  if (budget == null || budget <= 0) {
    return { level: 'unset', ratio: 0, remaining: 0, alertKey: null };
  }

  const ratio = spent / budget;
  const remaining = budget - spent;
  if (ratio >= 1) {
    return { level: 'exceeded', ratio, remaining, alertKey: '100' };
  }
  if (ratio >= 0.8) {
    return { level: 'warning', ratio, remaining, alertKey: '80' };
  }
  return { level: 'ok', ratio, remaining, alertKey: null };
}

export function shouldSendBudgetAlert(monthKey: string, level: '80' | '100', lastAlert: string | null): boolean {
  if (level === '100') {
    return lastAlert !== `${monthKey}-100`;
  }
  return lastAlert !== `${monthKey}-80` && lastAlert !== `${monthKey}-100`;
}

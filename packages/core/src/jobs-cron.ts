import { DomainError } from "./errors.js";

interface CronField {
  values: ReadonlySet<number>;
  wildcard: boolean;
}
export interface CronSchedule {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}
const RANGES = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 6],
] as const;
const invalid = () =>
  new DomainError("INVALID_CRON", "Cron expression is not a valid UTC schedule", 422);

function parseNumber(text: string, min: number, max: number) {
  if (!/^\d{1,2}$/.test(text)) throw invalid();
  const value = Number(text);
  if (value < min || value > max) throw invalid();
  return value;
}
function parseField(text: string, index: number): CronField {
  const [min, max] = RANGES[index] as readonly [number, number];
  const values = new Set<number>();
  for (const part of text.split(",")) {
    const [range = "", step, extra] = part.split("/");
    if (extra !== undefined || range === "") throw invalid();
    const stride = step === undefined ? 1 : parseNumber(step, 1, max);
    let [from, to] = [min, max];
    if (range !== "*") {
      const [start = "", end, more] = range.split("-");
      if (more !== undefined) throw invalid();
      from = parseNumber(start, min, max);
      to = end === undefined ? (step === undefined ? from : max) : parseNumber(end, min, max);
      if (to < from) throw invalid();
    }
    for (let value = from; value <= to; value += stride) values.add(value);
  }
  return { values, wildcard: text === "*" || /^\*\/\d+$/.test(text) };
}
/** Five-field UTC cron: minute hour day-of-month month day-of-week (0-6, Sunday is 0). */
export function parseCron(expression: string): CronSchedule {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) throw invalid();
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields.map((field, index) =>
    parseField(field, index),
  ) as [CronField, CronField, CronField, CronField, CronField];
  return { minute, hour, dayOfMonth, month, dayOfWeek };
}
function dayMatches(schedule: CronSchedule, day: Date) {
  if (!schedule.month.values.has(day.getUTCMonth() + 1)) return false;
  const byMonthDay = schedule.dayOfMonth.values.has(day.getUTCDate());
  const byWeekday = schedule.dayOfWeek.values.has(day.getUTCDay());
  if (schedule.dayOfMonth.wildcard && schedule.dayOfWeek.wildcard) return true;
  if (schedule.dayOfMonth.wildcard) return byWeekday;
  if (schedule.dayOfWeek.wildcard) return byMonthDay;
  return byMonthDay || byWeekday;
}
/** The first matching UTC minute strictly after `after`; null when none exists within eight years. */
export function nextCronFire(expression: string, after: Date): Date | null {
  const schedule = parseCron(expression);
  const start = Math.floor(after.getTime() / 60_000) * 60_000 + 60_000;
  const first = new Date(start);
  const day = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate()));
  const hours = [...schedule.hour.values].sort((a, b) => a - b);
  const minutes = [...schedule.minute.values].sort((a, b) => a - b);
  for (let offset = 0; offset < 366 * 8; offset++) {
    const candidate = new Date(day.getTime() + offset * 86_400_000);
    if (!dayMatches(schedule, candidate)) continue;
    for (const hour of hours)
      for (const minute of minutes) {
        const fire = new Date(candidate.getTime() + hour * 3_600_000 + minute * 60_000);
        if (fire.getTime() >= start) return fire;
      }
  }
  return null;
}

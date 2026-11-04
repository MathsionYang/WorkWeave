export type ScheduleMode = "fact-auto" | "package-pending" | "cache-only";

export const DEFAULT_SCHEDULE_MODE: ScheduleMode = "fact-auto";

export interface SchedulerOptions {
  readonly mode: ScheduleMode;
  readonly exportFact: (day: string) => Promise<string>;
  readonly enqueuePackage: (day: string) => Promise<void>;
  readonly cacheOnly: (day: string) => Promise<void>;
}

export interface ScheduleResult {
  readonly day: string;
  readonly mode: ScheduleMode;
  readonly action: "exported" | "queued" | "cached";
  readonly reportPath?: string;
}

function daysBetween(fromDay: string, toDay: string): readonly string[] {
  const start = Date.parse(`${fromDay}T00:00:00.000Z`);
  const end = Date.parse(`${toDay}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const days: string[] = [];
  for (let cursor = start + 24 * 60 * 60 * 1000; cursor <= end; cursor += 24 * 60 * 60 * 1000) {
    days.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return days;
}

export class SchedulerService {
  constructor(private readonly options: SchedulerOptions) {}

  get mode(): ScheduleMode {
    return this.options.mode;
  }

  async tick(day: string): Promise<ScheduleResult> {
    switch (this.options.mode) {
      case "fact-auto": {
        const reportPath = await this.options.exportFact(day);
        return { day, mode: this.options.mode, action: "exported", reportPath };
      }
      case "package-pending":
        await this.options.enqueuePackage(day);
        return { day, mode: this.options.mode, action: "queued" };
      case "cache-only":
        await this.options.cacheOnly(day);
        return { day, mode: this.options.mode, action: "cached" };
    }
  }

  async triggerManual(day: string): Promise<ScheduleResult> {
    return this.tick(day);
  }

  detectMissed(lastRunDay: string, today: string): readonly string[] {
    return daysBetween(lastRunDay, today);
  }
}
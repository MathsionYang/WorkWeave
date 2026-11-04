export class MetricsRegistry {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly observations = new Map<string, number[]>();

  increment(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  setGauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  observe(name: string, value: number): void {
    const list = this.observations.get(name) ?? [];
    list.push(value);
    this.observations.set(name, list);
  }

  snapshot(): Readonly<Record<string, number>> {
    const result: Record<string, number> = {};
    for (const [name, value] of this.counters) result[name] = value;
    for (const [name, value] of this.gauges) result[name] = value;
    for (const [name, values] of this.observations) {
      result[`${name}.count`] = values.length;
      result[`${name}.avg`] = values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
    }
    return result;
  }
}

export type MetricGroup =
  | "probe"
  | "integrity"
  | "ingest"
  | "classify"
  | "evidence"
  | "validate"
  | "report"
  | "tool"
  | "degraded";
import { Temporal } from 'temporal-polyfill';
import { addDays, Itinerary } from './itinerary';
import type { Check, Moment, PrepItem, RuleContext, Severity, ZonedMoment } from './types';

export interface ItemInput {
  id: string;
  rule?: number;
  group: string;
  country: string;
  moment: Moment;
  title: string;
  detail?: string | undefined;
  severity?: Severity;
  remindOn: string;
  deadline?: string | undefined;
  /** Local wall-clock time; defaults to the schedule's default time. */
  time?: string;
  /** Zone for `time`; defaults to where the traveller is on that date. */
  tz?: string;
  url?: string | undefined;
  sourceIds: string[];
}

function minusOneHour(time: string): string {
  return Temporal.PlainTime.from(time).subtract({ hours: 1 }).toString({ smallestUnit: 'minute' });
}

/** Collects checks and dated items; the schedule rules (time zone, quiet hours) live here. */
export class Builder {
  private readonly checkMap = new Map<string, Check>();
  private readonly prepMap = new Map<string, PrepItem>();

  constructor(
    readonly ctx: RuleContext,
    readonly it: Itinerary,
  ) {}

  check(c: Check): void {
    if (!this.checkMap.has(c.id)) this.checkMap.set(c.id, c);
  }

  /** The zone the traveller is in at `date` + `time`. Afternoon counts toward the day's destination. */
  zoneAt(date: string, time: string): string {
    return this.it.locationOn(date, time >= '12:00').tz;
  }

  /**
   * No alarms between quietFrom and quietUntil local time: an alarm that would
   * fall there rings an hour before quietFrom on the evening before (or the same
   * evening), while the calendar event keeps its real time.
   */
  alarmFor(at: ZonedMoment): ZonedMoment {
    const { quietFrom, quietUntil } = this.ctx.rules.schedule;
    const evening = minusOneHour(quietFrom);
    if (at.time >= quietFrom) return { date: at.date, time: evening, tz: at.tz };
    if (at.time < quietUntil) {
      const date = addDays(at.date, -1);
      return { date, time: evening, tz: this.zoneAt(date, evening) };
    }
    return at;
  }

  item(input: ItemInput): void {
    if (this.prepMap.has(input.id)) return;
    const time = input.time ?? this.ctx.rules.schedule.defaultTime;
    const at: ZonedMoment = { date: input.remindOn, time, tz: input.tz ?? this.zoneAt(input.remindOn, time) };
    const { time: _t, tz: _z, ...rest } = input;
    const item: PrepItem = {
      ...rest,
      severity: input.severity ?? 'info',
      at,
      alarm: this.alarmFor(at),
    } as PrepItem;
    if (!item.detail) delete item.detail;
    if (!item.deadline) delete item.deadline;
    if (!item.url) delete item.url;
    this.prepMap.set(input.id, item);
  }

  /** The traveller's source for a country's general facts (the Dutch travel advice). */
  adviceSource(country: string): string[] {
    const id = `nl-advice-${country.toLowerCase()}`;
    return [id in this.ctx.rules.sources ? id : 'nl-reisadvies'];
  }

  get checks(): Check[] {
    const order: Record<Severity, number> = { critical: 0, warn: 1, info: 2 };
    return [...this.checkMap.values()].sort(
      (a, b) => order[a.severity] - order[b.severity] || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'),
    );
  }

  get prep(): PrepItem[] {
    return [...this.prepMap.values()].sort(
      (a, b) => a.remindOn.localeCompare(b.remindOn) || a.at.time.localeCompare(b.at.time) || a.id.localeCompare(b.id),
    );
  }
}

export const re = (pattern: string) => new RegExp(pattern, 'i');

const TIME_ZONE = "Europe/London";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

type LondonParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};

function londonParts(value: Date): LondonParts {
  const parts = Object.fromEntries(
    formatter.formatToParts(value).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS.indexOf(parts.weekday as (typeof WEEKDAYS)[number]),
  };
}

function localDatePlusDays(parts: LondonParts, days: number) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function londonDateTime(year: number, month: number, day: number, hour: number) {
  const target = Date.UTC(year, month - 1, day, hour);
  let candidate = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = londonParts(new Date(candidate));
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    candidate += target - represented;
  }
  return new Date(candidate);
}

export function nextSupplierResponseClockInstant(value: Date) {
  const parts = londonParts(value);
  const fridayCutoff = parts.weekday === 5 && parts.hour >= 15;
  if (!fridayCutoff && parts.weekday !== 6 && parts.weekday !== 0) return new Date(value);
  const daysUntilMonday = parts.weekday === 5 ? 3 : parts.weekday === 6 ? 2 : 1;
  const monday = localDatePlusDays(parts, daysUntilMonday);
  return londonDateTime(monday.year, monday.month, monday.day, 8);
}

function nextFridayCutoff(value: Date) {
  const parts = londonParts(value);
  let daysUntilFriday = (5 - parts.weekday + 7) % 7;
  let friday = localDatePlusDays(parts, daysUntilFriday);
  let cutoff = londonDateTime(friday.year, friday.month, friday.day, 15);
  if (cutoff.getTime() <= value.getTime()) {
    daysUntilFriday += 7;
    friday = localDatePlusDays(parts, daysUntilFriday);
    cutoff = londonDateTime(friday.year, friday.month, friday.day, 15);
  }
  return cutoff;
}

export function addSupplierResponseHours(value: Date, hours: number) {
  if (!Number.isFinite(hours) || hours <= 0 || hours > 336) {
    throw new Error("Supplier response hours must be between 1 and 336");
  }
  let cursor = nextSupplierResponseClockInstant(value);
  let remaining = hours * 3_600_000;
  while (remaining > 0) {
    const cutoff = nextFridayCutoff(cursor);
    const available = cutoff.getTime() - cursor.getTime();
    if (remaining <= available) return new Date(cursor.getTime() + remaining);
    remaining -= available;
    cursor = nextSupplierResponseClockInstant(cutoff);
  }
  return cursor;
}

export function supplierResponseMillisecondsBetween(from: Date, to: Date) {
  if (to.getTime() <= from.getTime()) return 0;
  let cursor = nextSupplierResponseClockInstant(from);
  let elapsed = 0;
  while (cursor.getTime() < to.getTime()) {
    const cutoff = nextFridayCutoff(cursor);
    const segmentEnd = Math.min(to.getTime(), cutoff.getTime());
    if (segmentEnd > cursor.getTime()) elapsed += segmentEnd - cursor.getTime();
    if (to.getTime() <= cutoff.getTime()) break;
    cursor = nextSupplierResponseClockInstant(cutoff);
  }
  return elapsed;
}

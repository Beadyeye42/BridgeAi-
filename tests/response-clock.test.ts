import { describe, expect, it } from "vitest";
import {
  addSupplierResponseHours,
  nextSupplierResponseClockInstant,
  supplierResponseMillisecondsBetween,
} from "../lib/quotes/response-clock";

describe("supplier response clock", () => {
  it("moves a Friday-after-3pm start to Monday at 8am UK time", () => {
    const friday = new Date("2026-08-07T14:01:00.000Z"); // 15:01 BST
    expect(nextSupplierResponseClockInstant(friday).toISOString()).toBe("2026-08-10T07:00:00.000Z");
  });

  it("moves weekend assignments to Monday at 8am UK time", () => {
    expect(nextSupplierResponseClockInstant(new Date("2026-08-08T11:00:00.000Z")).toISOString()).toBe("2026-08-10T07:00:00.000Z");
    expect(nextSupplierResponseClockInstant(new Date("2026-08-09T19:00:00.000Z")).toISOString()).toBe("2026-08-10T07:00:00.000Z");
  });

  it("pauses an active timer at 3pm Friday and resumes it Monday at 8am", () => {
    const start = new Date("2026-08-07T13:00:00.000Z"); // Friday 14:00 BST
    const due = addSupplierResponseHours(start, 2);
    expect(due.toISOString()).toBe("2026-08-10T08:00:00.000Z"); // Monday 09:00 BST
    expect(supplierResponseMillisecondsBetween(new Date("2026-08-08T12:00:00.000Z"), due)).toBe(3_600_000);
  });

  it("uses Europe/London rules across the autumn clock change", () => {
    const saturday = new Date("2026-10-24T12:00:00.000Z");
    expect(nextSupplierResponseClockInstant(saturday).toISOString()).toBe("2026-10-26T08:00:00.000Z");
  });

  it("rejects unbounded response windows", () => {
    expect(() => addSupplierResponseHours(new Date(), 0)).toThrow();
    expect(() => addSupplierResponseHours(new Date(), 337)).toThrow();
  });
});

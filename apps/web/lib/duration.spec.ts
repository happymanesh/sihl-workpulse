import { describeDuration, formatHhMm, parseHhMm, stepDuration } from "./duration";

describe("formatHhMm", () => {
  it.each([
    [0, "0:00"],
    [5, "0:05"],
    [45, "0:45"],
    [60, "1:00"],
    [90, "1:30"],
    [600, "10:00"],
    [1455, "24:15"],
  ])("%s minutes reads as %s", (minutes, expected) => {
    expect(formatHhMm(minutes)).toBe(expected);
  });

  it("shows an em dash rather than 0:00 when nothing is set", () => {
    expect(formatHhMm(null)).toBe("—");
    expect(formatHhMm(undefined)).toBe("—");
  });
});

describe("parseHhMm", () => {
  it.each([
    ["1:30", 90],
    ["0:45", 45],
    ["10:00", 600],
    ["1h30", 90],
    ["1h 30m", 90],
    ["2h", 120],
    ["45m", 45],
    // A bare number stays minutes: the field held minutes before this change,
    // and somebody typing 90 out of habit should still get 90 minutes.
    ["90", 90],
    ["  1:05  ", 65],
  ])("reads %s as %s minutes", (text, expected) => {
    expect(parseHhMm(text)).toBe(expected);
  });

  it.each(["", "abc", "1:75", "1h75m", "::", "-"])("refuses %s", (text) => {
    expect(parseHhMm(text)).toBeNull();
  });

  it("round-trips whatever it formats", () => {
    for (const m of [0, 5, 45, 60, 90, 125, 600]) {
      expect(parseHhMm(formatHhMm(m))).toBe(m);
    }
  });
});

describe("stepDuration", () => {
  it("moves by half an hour either way", () => {
    expect(stepDuration(60, 1)).toBe(90);
    expect(stepDuration(60, -1)).toBe(30);
  });

  it("never goes below the floor", () => {
    expect(stepDuration(20, -1, 5)).toBe(5);
    expect(stepDuration(0, -1)).toBe(0);
  });

  it("keeps an off-grid estimate's offset rather than snapping it", () => {
    // 45 is a real estimate somebody typed. Stepping up should give 75, not
    // round them to 60 and lose the quarter hour they meant.
    expect(stepDuration(45, 1)).toBe(75);
  });
});

describe("describeDuration", () => {
  it.each([
    [90, "1 hour 30 minutes"],
    [60, "1 hour"],
    [120, "2 hours"],
    [45, "45 minutes"],
    [1, "1 minute"],
  ])("%s minutes reads as %s", (minutes, expected) => {
    expect(describeDuration(minutes)).toBe(expected);
  });
});

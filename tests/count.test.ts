import { describe, expect, it } from "vitest";

import {
  COUNT_REVIEW_HREF,
  countActionText,
  countAfter,
  countBody,
  type CountDraft,
  type CountLine,
  countOutcome,
  countRecordingText,
  countReviewBody,
  countSnapshot,
  type CountState,
  countStepOf,
  countSummary,
  isCountAnswer,
  isCountReviewAnswer,
  NEW_COUNT,
  NEW_COUNT_DRAFT,
  readCountDraft,
} from "~/shared/count";

// Conteo's one Count at a time (UI redesign §6.1, §7): what each tap and each
// answer does to it. The screen renders this state and nothing else decides
// whether it may be typed, reviewed, sent or sent again.

const agua = { id: "agua", name: "Agua de la casa" };
const pan = { id: "pan", name: "Pan dulce" };
const cafe = { id: "cafe", name: "Café de olla" };
const items = [agua, cafe, pan];

const typed = (units: Record<string, string>, note = ""): CountDraft => ({ units, note });
const line = (itemId: string, itemName: string, expected: number, found: number): CountLine => ({
  itemId,
  itemName,
  expected,
  found,
  difference: found - expected,
});
const expectedLines = [line("agua", "Agua de la casa", 10, 8), line("pan", "Pan dulce", 0, 0)];

const editing = (draft: CountDraft) => countAfter(NEW_COUNT, { type: "typed", draft });

/** A Count typed and asked to be reviewed, not answered yet. */
const asked = (draft = typed({ agua: "8", pan: "0" }, " De la tarde "), key = "lectura-1") =>
  countAfter(editing(draft), { type: "reviewAsked", key, items });

/** A Count whose review was read. */
const reviewed = (lines = expectedLines) =>
  countAfter(asked(), {
    type: "reviewAnswered",
    key: "lectura-1",
    outcome: { outcome: "confirmed", answer: { review: { lines } } },
  });

function frozen(state: CountState = reviewed(), key = "llave-1") {
  const snapshot = state.phase === "editing" ? countSnapshot(state.review, key) : null;
  if (snapshot === null) throw new Error("only a reviewed Count is sent");
  return snapshot;
}

const recording = () => {
  const snapshot = frozen();
  return { snapshot, state: countAfter(reviewed(), { type: "submitted", snapshot }) };
};

const recorded = { id: "conteo-1", lines: expectedLines };
const confirmed = { outcome: "confirmed", answer: { count: recorded } } as const;

describe("a Count being typed", () => {
  it("counts the fields that were typed, zero included, and leaves the empty ones out", () => {
    expect(readCountDraft(typed({ agua: " 8 ", pan: "0", cafe: "  " }), items)).toEqual({
      counted: [
        { itemId: "agua", itemName: "Agua de la casa", found: 8 },
        { itemId: "pan", itemName: "Pan dulce", found: 0 },
      ],
      invalid: [],
    });
    expect(readCountDraft(NEW_COUNT_DRAFT, items)).toEqual({ counted: [], invalid: [] });
  });

  it("names the Items whose field cannot be read: a sign, a decimal, a word", () => {
    expect(readCountDraft(typed({ agua: "-1", cafe: "2.5", pan: "dos" }), items)).toEqual({
      counted: [],
      invalid: ["agua", "cafe", "pan"],
    });
    // What was typed for an Item the list no longer has is not read.
    expect(readCountDraft(typed({ "ya-no": "3" }), items)).toEqual({ counted: [], invalid: [] });
  });

  it("is not reviewed while a field cannot be read or nothing was counted", () => {
    const unreadable = editing(typed({ agua: "8", pan: "dos" }));
    expect(countAfter(unreadable, { type: "reviewAsked", key: "k", items })).toBe(unreadable);
    const empty = editing(typed({}, "solo una nota"));
    expect(countAfter(empty, { type: "reviewAsked", key: "k", items })).toBe(empty);
  });
});

describe("the review", () => {
  it("freezes what was counted and reads what was expected only when asked", () => {
    expect(asked()).toMatchObject({
      phase: "editing",
      review: {
        key: "lectura-1",
        counted: [
          { itemId: "agua", itemName: "Agua de la casa", found: 8 },
          { itemId: "pan", itemName: "Pan dulce", found: 0 },
        ],
        note: "De la tarde",
        attempt: 1,
        read: "reading",
      },
    });
    expect(reviewed()).toMatchObject({ review: { read: { lines: expectedLines } } });
  });

  it("hears only its own answer", () => {
    const state = asked();
    expect(
      countAfter(state, { type: "reviewAnswered", key: "otra", outcome: { outcome: "unknown" } }),
    ).toBe(state);
  });

  it("keeps everything typed when it is left, and is gone once something else is typed", () => {
    const state = reviewed();
    if (state.phase !== "editing") throw new Error("a reviewed Count is still being typed");
    expect(state.draft).toEqual(typed({ agua: "8", pan: "0" }, " De la tarde "));

    const changed = countAfter(state, { type: "typed", draft: typed({ agua: "9", pan: "0" }) });
    expect(changed).toMatchObject({ phase: "editing", review: null });
    expect(changed.phase === "editing" && countSnapshot(changed.review, "k")).toBeNull();
  });

  it("that got no answer can be read again, and nothing was recorded", () => {
    const failed = countAfter(asked(), { type: "reviewAnswered", key: "lectura-1", outcome: { outcome: "unknown" } });
    expect(failed).toMatchObject({ phase: "editing", review: { read: "failed" } });
    expect(failed.phase === "editing" && countSnapshot(failed.review, "k")).toBeNull();
    expect(countAfter(failed, { type: "reviewRetried" })).toMatchObject({
      review: { key: "lectura-1", read: "reading", attempt: 2 },
    });
    // Only a read that failed is read again.
    expect(countAfter(reviewed(), { type: "reviewRetried" })).toEqual(reviewed());
  });

  it("that was refused goes back to the fields with the reason and what was typed", () => {
    const refused = countAfter(asked(), {
      type: "reviewAnswered",
      key: "lectura-1",
      outcome: { outcome: "refused", answer: { error: "Un producto ya no lleva inventario." } },
    });
    expect(refused).toEqual({
      phase: "editing",
      draft: typed({ agua: "8", pan: "0" }, " De la tarde "),
      review: null,
      refusal: "Un producto ya no lleva inventario.",
    });
  });
});

describe("a Count that was sent", () => {
  it("is what the review froze, with its key, its note and what the review showed", () => {
    expect(frozen()).toEqual({
      key: "llave-1",
      counted: [
        { itemId: "agua", itemName: "Agua de la casa", found: 8 },
        { itemId: "pan", itemName: "Pan dulce", found: 0 },
      ],
      note: "De la tarde",
      reviewed: expectedLines,
    });
    const reading = asked();
    expect(reading.phase === "editing" && countSnapshot(reading.review, "k")).toBeNull();
  });

  it("is frozen: nothing typed or tapped changes it until it is answered", () => {
    const { state } = recording();
    expect(state).toMatchObject({ phase: "recording", attempt: 1 });
    expect(countAfter(state, { type: "typed", draft: typed({ agua: "1" }) })).toBe(state);
    expect(countAfter(state, { type: "reviewAsked", key: "k", items })).toBe(state);
    expect(countAfter(state, { type: "submitted", snapshot: frozen(reviewed(), "otra") })).toBe(state);
    expect(countAfter(state, { type: "retried" })).toBe(state);
  });

  it("is confirmed only by its own answer, and keeps the Count the server recorded", () => {
    const { snapshot, state } = recording();
    expect(countAfter(state, { type: "answered", key: "otra", outcome: confirmed })).toBe(state);
    const done = countAfter(state, { type: "answered", key: snapshot.key, outcome: confirmed });
    expect(done).toEqual({ phase: "confirmed", snapshot, result: recorded });
    // Nothing starts it over: the ways on leave the screen.
    expect(countAfter(done, { type: "typed", draft: NEW_COUNT_DRAFT })).toBe(done);
    expect(countAfter(done, { type: "retried" })).toBe(done);
  });

  it("goes back to the fields when refused, with what was typed and no review", () => {
    const { snapshot, state } = recording();
    expect(
      countAfter(state, {
        type: "answered",
        key: snapshot.key,
        outcome: { outcome: "refused", answer: { error: "Un producto ya no existe." } },
      }),
    ).toEqual({
      phase: "editing",
      draft: typed({ agua: "8", pan: "0" }, " De la tarde "),
      review: null,
      refusal: "Un producto ya no existe.",
    });
  });
});

describe("a Count nobody answered", () => {
  const unanswered = () => {
    const { snapshot, state } = recording();
    return { snapshot, state: countAfter(state, { type: "answered", key: snapshot.key, outcome: { outcome: "unknown" } }) };
  };

  it("is unknown, never refused, and only the same snapshot can be sent again", () => {
    const { snapshot, state } = unanswered();
    expect(state).toMatchObject({ phase: "unknown", snapshot, sessionEnded: false });
    expect(countAfter(state, { type: "typed", draft: typed({ agua: "1" }) })).toBe(state);
    expect(countAfter(state, { type: "submitted", snapshot: frozen(reviewed(), "otra") })).toBe(state);

    const again = countAfter(state, { type: "retried" });
    expect(again).toMatchObject({ phase: "recording", attempt: 2 });
    expect(again.phase === "recording" && again.snapshot).toBe(snapshot);
  });

  it("stays unknown when a retry finds the session ended, and is refused when the first attempt does", () => {
    const ended = { outcome: "refused", answer: { error: "Tu sesión terminó.", sessionEnded: true } } as const;
    const { snapshot, state } = unanswered();
    const again = countAfter(state, { type: "retried" });
    expect(countAfter(again, { type: "answered", key: snapshot.key, outcome: ended })).toMatchObject({
      phase: "unknown",
      snapshot,
      sessionEnded: true,
    });

    const first = recording();
    expect(countAfter(first.state, { type: "answered", key: first.snapshot.key, outcome: ended })).toMatchObject({
      phase: "editing",
      refusal: "Tu sesión terminó.",
    });
  });
});

describe("how a Count is sent and said", () => {
  it("asks for its review with what was counted and nothing else", () => {
    const state = asked();
    if (state.phase !== "editing" || state.review === null) throw new Error("a review was asked");
    expect([...countReviewBody(state.review)]).toEqual([
      ["intent", "revisar"],
      ["units.agua", "8"],
      ["units.pan", "0"],
    ]);
  });

  it("carries the same fields in the same order every time", () => {
    expect([...countBody(frozen())]).toEqual([
      ["intent", "registrar"],
      ["units.agua", "8"],
      ["units.pan", "0"],
      ["note", "De la tarde"],
      ["submissionKey", "llave-1"],
    ]);
  });

  it("is confirmed only by an answer that carries the Count", () => {
    expect(isCountAnswer({ count: recorded })).toBe(true);
    expect(isCountAnswer({ count: { lines: [] } })).toBe(false);
    expect(isCountAnswer({ review: { lines: [] } })).toBe(false);
    expect(isCountReviewAnswer({ review: { lines: expectedLines } })).toBe(true);
    expect(isCountReviewAnswer({ review: null })).toBe(false);
    expect(isCountReviewAnswer({ notice: "Listo" })).toBe(false);
  });

  it("names its action by its effect, and says what is on its way", () => {
    expect(countActionText(frozen().counted)).toBe("Registrar conteo de 2 productos");
    expect(countActionText([{ itemId: "agua", itemName: "Agua de la casa", found: 0 }])).toBe(
      "Registrar conteo de 1 producto",
    );
    expect(countRecordingText(frozen())).toBe("Registrando conteo de 2 productos…");
  });

  it("sums a Count up in words, a Count with no Discrepancy too", () => {
    expect(countSummary([{ difference: -3 }, { difference: 2 }, { difference: 0 }, { difference: -1 }])).toBe(
      "4 productos: 2 con faltante, 1 con sobrante, 1 sin diferencia",
    );
    expect(countSummary([{ difference: 0 }])).toBe("1 producto: 1 sin diferencia");
  });

  it("says what the server recorded, and whether Stock moved since the review", () => {
    expect(countOutcome(frozen(), recorded)).toEqual({
      title: "Conteo registrado",
      details: "2 productos: 1 con faltante, 1 sin diferencia. Al registrarlo, las existencias quedaron en lo contado.",
      moved: false,
    });
    // A sale landed between the review and the record: 15 were expected, not 10.
    const later = { id: "conteo-1", lines: [line("agua", "Agua de la casa", 15, 8), expectedLines[1]!] };
    expect(countOutcome(frozen(), later)).toMatchObject({ moved: true });
  });
});

describe("the address of a step", () => {
  it("names the entry unless it asks for the review", () => {
    expect(countStepOf(new URLSearchParams(""))).toBe("entry");
    expect(countStepOf(new URLSearchParams(COUNT_REVIEW_HREF.split("?")[1]))).toBe("review");
    expect(countStepOf(new URLSearchParams("paso=otra-cosa"))).toBe("entry");
  });
});

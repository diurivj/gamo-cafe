import { describe, expect, it } from "vitest";

import {
  type InternalUseDraft,
  internalUseAfter,
  internalUseBody,
  internalUseEffect,
  internalUseOutcome,
  internalUseRecordingText,
  type InternalUseSnapshot,
  internalUseSnapshot,
  type InternalUseState,
  isInternalUseAnswer,
  NEW_INTERNAL_USE,
  readInternalUseDraft,
} from "~/shared/internal-use";
import { adjustmentProblems } from "~/shared/stock-change";

// Consumo interno (spec §4.1, §5.8; UI redesign §6.1): what each tap and each
// answer does to one Internal use. The screen renders this state and nothing
// else decides whether it may be sent, changed or sent again. Nothing here
// knows a Stock: a Worker records it, and a Worker never sees one.

const agua = { id: "agua", name: "Agua de la casa" };
const items = [agua, { id: "pan", name: "Pan dulce" }];
const typed = (unitsText: string, note = ""): InternalUseDraft => ({ itemId: "agua", unitsText, note });

function frozen(draft = typed("2"), key = "llave-1"): InternalUseSnapshot {
  const snapshot = internalUseSnapshot({ draft, items, key });
  if ("problem" in snapshot) throw new Error(snapshot.problem);
  return snapshot;
}

const recording = (draft = typed("2")) => {
  const snapshot = frozen(draft);
  const editing = internalUseAfter(NEW_INTERNAL_USE, { type: "typed", draft });
  return { snapshot, state: internalUseAfter(editing, { type: "submitted", snapshot }) };
};

const confirmed = { outcome: "confirmed", answer: { internalUse: { id: "ajuste-1" } } } as const;

describe("an Internal use being typed", () => {
  it("starts with nothing chosen and nothing typed", () => {
    expect(NEW_INTERNAL_USE).toEqual({ phase: "editing", draft: { itemId: "", unitsText: "", note: "" }, refusal: null });
  });

  it("is read as the Item and whole units of one or more, as an Adjustment is", () => {
    expect(readInternalUseDraft(typed("2"), items)).toEqual({ item: agua, units: 2, itemProblem: null, unitsProblem: null });
    expect(readInternalUseDraft(typed(" 3 "), items).units).toBe(3);
    expect(readInternalUseDraft(typed(""), items).unitsProblem).toBe(adjustmentProblems.unitsMissing);
    for (const text of ["0", "1.5", "-2", "dos"]) {
      expect(readInternalUseDraft(typed(text), items), text).toMatchObject({
        units: null,
        unitsProblem: adjustmentProblems.unitsInvalid,
      });
    }
    expect(readInternalUseDraft(NEW_INTERNAL_USE.draft, items).itemProblem).toBe(adjustmentProblems.itemMissing);
    expect(readInternalUseDraft({ ...typed("1"), itemId: "ya-no" }, items).item).toBeNull();
  });

  it("says before it is sent that the units leave without being paid for, and no Stock", () => {
    expect(internalUseEffect(2, agua)).toBe("Resta 2 de Agua de la casa del inventario. No se cobra.");
  });

  it("is frozen with its key, its Item's name and its note trimmed, or says why it cannot be sent", () => {
    expect(frozen(typed("2", "  Para el turno de la tarde "))).toEqual({
      key: "llave-1",
      itemId: "agua",
      itemName: "Agua de la casa",
      units: 2,
      note: "Para el turno de la tarde",
    });
    expect(frozen()).toMatchObject({ note: null });
    expect(internalUseSnapshot({ draft: NEW_INTERNAL_USE.draft, items, key: "k" })).toEqual({
      problem: adjustmentProblems.itemMissing,
    });
    expect(internalUseSnapshot({ draft: typed("0"), items, key: "k" })).toEqual({ problem: adjustmentProblems.unitsInvalid });
  });

  it("keeps what is typed when refused, and typing answers the refusal", () => {
    const { snapshot, state } = recording();
    const refused = internalUseAfter(state, {
      type: "answered",
      key: snapshot.key,
      outcome: { outcome: "refused", answer: { error: "Ese producto ya no existe." } },
    });
    expect(refused).toEqual({ phase: "editing", draft: typed("2"), refusal: "Ese producto ya no existe." });
    expect(internalUseAfter(refused, { type: "typed", draft: typed("3") })).toEqual({
      phase: "editing",
      draft: typed("3"),
      refusal: null,
    });
  });
});

describe("an Internal use that was sent", () => {
  it("is frozen: nothing typed or tapped changes it until it is answered", () => {
    const { state } = recording();
    expect(state).toMatchObject({ phase: "recording", attempt: 1 });
    expect(internalUseAfter(state, { type: "typed", draft: typed("9") })).toBe(state);
    expect(internalUseAfter(state, { type: "submitted", snapshot: frozen(typed("9"), "otra") })).toBe(state);
    expect(internalUseAfter(state, { type: "started" })).toBe(state);
    expect(internalUseAfter(state, { type: "retried" })).toBe(state);
  });

  it("is confirmed only by its own answer, and starts the next one only after that", () => {
    const { snapshot, state } = recording();
    expect(internalUseAfter(state, { type: "answered", key: "otra", outcome: confirmed })).toBe(state);

    const done = internalUseAfter(state, { type: "answered", key: snapshot.key, outcome: confirmed });
    expect(done).toEqual({ phase: "confirmed", snapshot });
    expect(internalUseAfter(done, { type: "typed", draft: typed("5") })).toBe(done);
    expect(internalUseAfter(done, { type: "started" })).toEqual(NEW_INTERNAL_USE);
  });
});

describe("an Internal use of unknown outcome", () => {
  const unknown = (): { snapshot: InternalUseSnapshot; state: InternalUseState } => {
    const { snapshot, state } = recording();
    return { snapshot, state: internalUseAfter(state, { type: "answered", key: snapshot.key, outcome: { outcome: "unknown" } }) };
  };

  it("is neither failed nor recorded, and is retried as the very same Internal use", () => {
    const { snapshot, state } = unknown();
    expect(state).toMatchObject({ phase: "unknown", snapshot, sessionEnded: false });
    expect(internalUseAfter(state, { type: "typed", draft: typed("4") })).toBe(state);
    expect(internalUseAfter(state, { type: "started" })).toBe(state);

    const retried = internalUseAfter(state, { type: "retried" });
    expect(retried).toMatchObject({ phase: "recording", attempt: 2 });
    expect(retried.phase === "recording" && retried.snapshot).toBe(snapshot);
  });

  it("stays unknown when a retry finds the session ended: the first attempt may have been recorded", () => {
    const { snapshot, state } = unknown();
    const signedOut = { outcome: "refused", answer: { error: "Tu sesión terminó.", sessionEnded: true } } as const;

    const retried = internalUseAfter(state, { type: "retried" });
    expect(internalUseAfter(retried, { type: "answered", key: snapshot.key, outcome: signedOut })).toMatchObject({
      phase: "unknown",
      snapshot,
      sessionEnded: true,
    });

    // On a first attempt Entrar answered before any action ran: nothing was recorded.
    const first = recording();
    expect(internalUseAfter(first.state, { type: "answered", key: first.snapshot.key, outcome: signedOut })).toMatchObject({
      phase: "editing",
      refusal: "Tu sesión terminó.",
    });
  });
});

describe("what an Internal use is sent as, and what it says", () => {
  it("is the same form every time: the Item, the units, the note and its key", () => {
    const snapshot = frozen(typed("2", "Para la junta"));
    expect(Object.fromEntries(internalUseBody(snapshot))).toEqual({
      itemId: "agua",
      units: "2",
      note: "Para la junta",
      submissionKey: "llave-1",
    });
    expect(Object.fromEntries(internalUseBody(frozen()))).toMatchObject({ note: "" });
    expect(internalUseBody(snapshot).toString()).toBe(internalUseBody(snapshot).toString());
  });

  it("takes for its answer only what the route says it recorded", () => {
    expect(isInternalUseAnswer({ internalUse: { id: "ajuste-1" } })).toBe(true);
    expect(isInternalUseAnswer({ change: { stock: 4 } })).toBe(false);
    expect(isInternalUseAnswer({ internalUse: null })).toBe(false);
    expect(isInternalUseAnswer({ internalUse: {} })).toBe(false);
  });

  it("says what is on its way, and what was recorded, with no Stock", () => {
    expect(internalUseRecordingText(frozen())).toBe("Registrando consumo interno de 2…");
    expect(internalUseOutcome(frozen())).toEqual({ title: "Consumo interno registrado", details: "-2 de Agua de la casa." });
  });
});

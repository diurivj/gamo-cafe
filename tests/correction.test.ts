import { describe, expect, it } from "vitest";

import {
  type CorrectableBill,
  correctionAfter,
  correctionAt,
  correctionBody,
  correctionHref,
  correctionKey,
  correctionOfKey,
  correctionOutcome,
  correctionPlan,
  correctionRecordingText,
  type CorrectionResult,
  correctionSnapshot,
  type CorrectionState,
  type CorrectionTarget,
  isCorrectionAnswer,
  NEW_CORRECTION,
  reasonFor,
} from "~/shared/correction";
import { correctionMessages } from "~/shared/correction-messages";

// Cuenta's corrections (UI redesign §6, §7.2; spec §5.7): what the screen may
// offer, what it says would happen, and what each tap and each answer does to
// a correction. The screen renders this and decides nothing else.

const open: CorrectableBill = { id: "cuenta-1", revision: 3, total: 5550, paid: 0, state: "open", day: "2026-10-05" };
const partial: CorrectableBill = { ...open, paid: 2000, state: "partial" };
const paid: CorrectableBill = { ...open, paid: 5550, state: "paid" };

const agua = { id: "linea-1", itemName: "Agua mineral", quantity: 2, unitPrice: 1850, day: "2026-10-05", movedStock: true, removed: false };
const cafe = { id: "linea-2", itemName: "Café de olla", quantity: 1, unitPrice: 1850, day: "2026-10-04", movedStock: false, removed: false };
const pago = { id: "pago-1", amount: 2000, method: "cash" as const, day: "2026-10-04", removed: false };

const line = (of = agua): CorrectionTarget => ({ intent: "quitar-linea", line: of });
const payment = (of = pago): CorrectionTarget => ({ intent: "quitar-pago", payment: of });
const whole: CorrectionTarget = { intent: "cancelar-cuenta", movesStock: true };

describe("what a correction would do", () => {
  it("lets a Worker remove a Line, without a reason, only while the Bill has no Payment", () => {
    const plan = correctionPlan(open, line(), false);
    expect(plan).toMatchObject({ what: "2 × Agua mineral", action: "Quitar 2 × Agua mineral", needsReason: false, blocked: null });
    expect(plan!.consequences[0]).toBe("El total de la cuenta baja de $55.50 a $18.50.");
    expect(correctionPlan(partial, line(), false)).toBeNull();
    expect(correctionPlan(open, payment(), false)).toBeNull();
    expect(correctionPlan(open, whole, false)).toBeNull();
  });

  it("never tells a Worker about Stock, and tells an Admin only of a Line that moved it", () => {
    const stock = /existencias/;
    expect(correctionPlan(open, line(), false)!.consequences.join(" ")).not.toMatch(stock);
    expect(correctionPlan(open, line(), true)!.consequences).toContain("Sus 2 unidades regresan a existencias.");
    expect(correctionPlan(open, line(cafe), true)!.consequences.join(" ")).not.toMatch(stock);
    expect(correctionPlan(open, line({ ...agua, quantity: 1 }), true)!.consequences).toContain("Su unidad regresa a existencias.");
  });

  it("says which Day's Sold figure a removed Line leaves, and that the Line stays on record", () => {
    const { consequences } = correctionPlan(open, line(cafe), true)!;
    expect(consequences).toContain("Deja de contar en lo vendido del domingo, 4 de octubre de 2026.");
    expect(consequences.at(-1)).toBe("El producto sigue en la cuenta, marcado como quitado.");
  });

  it("asks an Admin for a reason once the Bill has a Payment, and says what it will owe", () => {
    const plan = correctionPlan(partial, line(cafe), true)!;
    expect(plan).toMatchObject({ needsReason: true, blocked: null });
    expect(plan.consequences.slice(0, 2)).toEqual([
      "El total de la cuenta baja de $55.50 a $37.00.",
      "Quedará debiendo $17.00.",
    ]);
    expect(correctionPlan({ ...partial, paid: 3700 }, line(cafe), true)!.consequences[1]).toBe(
      "Con lo ya pagado, la cuenta queda pagada.",
    );
  });

  it("refuses a Line whose removal would leave the total below the Payments, and says what to do", () => {
    const plan = correctionPlan(partial, line(), true)!;
    expect(plan.blocked).toBe(
      "No se puede quitar: la cuenta quedaría en $18.50 y ya tiene $20.00 pagados. Primero quita un pago.",
    );
    expect(plan.consequences).toEqual([]);
  });

  it("says a Bill left without Lines leaves Cuentas abiertas", () => {
    const only = { ...open, total: 3700 };
    expect(correctionPlan(only, line(), false)!.consequences.slice(0, 2)).toEqual([
      "El total de la cuenta baja de $37.00 a $0.00.",
      "La cuenta queda sin productos y sale de Cuentas abiertas.",
    ]);
  });

  it("lets an Admin remove a Payment, with a reason, even from a Paid Bill", () => {
    const plan = correctionPlan(paid, payment(), true)!;
    expect(plan).toMatchObject({ what: "$20.00 en efectivo", action: "Quitar pago de $20.00", needsReason: true, blocked: null });
    expect(plan.consequences).toEqual([
      "La cuenta vuelve a deber $20.00.",
      "Deja de contar en lo cobrado del domingo, 4 de octubre de 2026.",
      "El pago sigue en la cuenta, marcado como quitado.",
    ]);
  });

  it("tells an Admin what voiding does to the figures and to Stock, and that it cannot be undone", () => {
    const plan = correctionPlan(partial, whole, true)!;
    expect(plan).toMatchObject({ what: "Cuenta de $55.50", action: "Cancelar cuenta", needsReason: true, blocked: null });
    expect(plan.consequences).toEqual([
      "No se puede deshacer.",
      "Sus productos dejan de contar en lo vendido, y sus pagos ($20.00) en lo cobrado, de los días en que se registraron.",
      "Ya no se podrá cobrar lo que debe: $35.50.",
      "Las unidades de sus productos regresan a existencias.",
      "La cuenta se conserva, marcada como cancelada.",
    ]);
    const plain = correctionPlan(open, { intent: "cancelar-cuenta", movesStock: false }, true)!;
    expect(plain.consequences).toEqual([
      "No se puede deshacer.",
      "Sus productos dejan de contar en lo vendido de los días en que se registraron.",
      "Ya no se podrá cobrar lo que debe: $55.50.",
      "La cuenta se conserva, marcada como cancelada.",
    ]);
  });

  it("offers nothing on a Voided Bill, nor for a record already removed", () => {
    const voided: CorrectableBill = { ...open, state: "voided" };
    expect(correctionPlan(voided, line(), true)).toBeNull();
    expect(correctionPlan(voided, payment(), true)).toBeNull();
    expect(correctionPlan(voided, whole, true)).toBeNull();
    expect(correctionPlan(open, line({ ...agua, removed: true }), true)).toBeNull();
    expect(correctionPlan(paid, payment({ ...pago, removed: true }), true)).toBeNull();
  });
});

describe("the address of a correction's step", () => {
  it("names the correction and its record, and reads them back", () => {
    expect(correctionHref("cuenta-1", "quitar-linea", "linea-1")).toBe("/cuentas/cuenta-1?paso=quitar-linea&id=linea-1");
    expect(correctionHref("cuenta-1", "cancelar-cuenta", null)).toBe("/cuentas/cuenta-1?paso=cancelar-cuenta");
    expect(correctionAt(new URLSearchParams("paso=quitar-pago&id=pago-1"))).toEqual({ intent: "quitar-pago", targetId: "pago-1" });
    expect(correctionAt(new URLSearchParams("paso=cancelar-cuenta"))).toEqual({ intent: "cancelar-cuenta", targetId: null });
  });

  it("reads a correction back from its key", () => {
    expect(correctionOfKey(correctionKey("quitar-pago", "pago-1"))).toEqual({ intent: "quitar-pago", targetId: "pago-1" });
    expect(correctionOfKey(correctionKey("cancelar-cuenta", null))).toEqual({ intent: "cancelar-cuenta", targetId: null });
    expect(correctionOfKey("otra-cosa:1")).toBeNull();
  });

  it("is not a step without the record it needs, nor for another step", () => {
    expect(correctionAt(new URLSearchParams("paso=quitar-linea"))).toBeNull();
    expect(correctionAt(new URLSearchParams("paso=cobrar"))).toBeNull();
    expect(correctionAt(new URLSearchParams(""))).toBeNull();
  });
});

const KEY = correctionKey("quitar-linea", "linea-2");

function frozen(reason = "", bill = partial, target = line(cafe)) {
  const plan = correctionPlan(bill, target, true)!;
  const snapshot = correctionSnapshot({ bill, target, plan, reason });
  if ("problem" in snapshot) throw new Error(snapshot.problem);
  return snapshot;
}

function recording(reason = "No se lo llevó") {
  const typed = correctionAfter(NEW_CORRECTION, { type: "typed", target: KEY, reason });
  const snapshot = frozen(reason);
  return { snapshot, state: correctionAfter(typed, { type: "submitted", snapshot }) };
}

const result: CorrectionResult = { total: 3700, owed: 1700, canOpen: true };
const answered = (state: CorrectionState, outcome: Parameters<typeof correctionAfter>[1] & { type: "answered" }) =>
  correctionAfter(state, outcome);

describe("a correction being typed", () => {
  it("keeps the reason of the record it was typed for, and of no other", () => {
    const typed = correctionAfter(NEW_CORRECTION, { type: "typed", target: KEY, reason: "No se lo llevó" });
    expect(reasonFor(typed, KEY)).toBe("No se lo llevó");
    expect(reasonFor(typed, correctionKey("quitar-pago", "pago-1"))).toBe("");
    expect(reasonFor(NEW_CORRECTION, KEY)).toBe("");
  });

  it("is frozen with the Bill's revision, the record and the reason trimmed", () => {
    expect(frozen("  No se lo llevó  ")).toEqual({
      intent: "quitar-linea",
      billId: "cuenta-1",
      revision: 3,
      targetId: "linea-2",
      reason: "No se lo llevó",
      what: "1 × Café de olla",
    });
    expect(frozen("", open, line()).reason).toBeNull();
  });

  it("is not sent without the reason it needs, nor when it is blocked", () => {
    const plan = correctionPlan(partial, line(cafe), true)!;
    expect(correctionSnapshot({ bill: partial, target: line(cafe), plan, reason: "   " })).toEqual({
      problem: correctionMessages.ReasonRequired,
    });
    const blocked = correctionPlan(partial, line(), true)!;
    expect(correctionSnapshot({ bill: partial, target: line(), plan: blocked, reason: "x" })).toEqual({
      problem: blocked.blocked,
    });
  });

  it("is sent as the same form every time", () => {
    expect(correctionBody(frozen("No se lo llevó")).toString()).toBe(
      "intent=quitar-linea&revision=3&reason=No+se+lo+llev%C3%B3&lineId=linea-2",
    );
    expect(correctionBody(frozen("Error", paid, payment())).toString()).toBe(
      "intent=quitar-pago&revision=3&reason=Error&paymentId=pago-1",
    );
    expect(correctionBody(frozen("Prueba", open, whole)).toString()).toBe("intent=cancelar-cuenta&revision=3&reason=Prueba");
  });
});

describe("a correction that was sent", () => {
  it("is frozen while it is on its way: nothing typed, sent or started changes it", () => {
    const { snapshot, state } = recording();
    expect(state).toMatchObject({ phase: "recording", snapshot, attempt: 1 });
    expect(correctionAfter(state, { type: "typed", target: KEY, reason: "otra" })).toBe(state);
    expect(correctionAfter(state, { type: "submitted", snapshot: frozen("otra") })).toBe(state);
    expect(correctionAfter(state, { type: "retried" })).toBe(state);
    expect(correctionAfter(state, { type: "started" })).toBe(state);
  });

  it("is confirmed only by the server's own answer, and only Ver cuenta starts another", () => {
    const { snapshot, state } = recording();
    const confirmed = answered(state, { type: "answered", attempt: 1, outcome: { outcome: "confirmed", answer: { correction: result } } });
    expect(confirmed).toEqual({ phase: "confirmed", snapshot, result });
    expect(correctionAfter(confirmed, { type: "typed", target: KEY, reason: "x" })).toBe(confirmed);
    expect(correctionAfter(confirmed, { type: "started" })).toEqual(NEW_CORRECTION);
  });

  it("comes back as it was typed when a rule refuses it, with the reason said", () => {
    const { state } = recording("No se lo llevó");
    const refused = answered(state, {
      type: "answered",
      attempt: 1,
      outcome: { outcome: "refused", answer: { error: correctionMessages.BillChanged, changed: { canOpen: true } } },
    });
    expect(refused).toEqual({ phase: "editing", target: KEY, reason: "No se lo llevó", refusal: correctionMessages.BillChanged });
    // Typing again answers the refusal.
    expect(correctionAfter(refused, { type: "typed", target: KEY, reason: "No se lo llevó." })).toMatchObject({ refusal: null });
  });

  it("ends as gone when the Bill is no longer this User's to open", () => {
    const { snapshot, state } = recording();
    const gone = answered(state, {
      type: "answered",
      attempt: 1,
      outcome: { outcome: "refused", answer: { error: correctionMessages.BillChanged, changed: { canOpen: false } } },
    });
    expect(gone).toEqual({ phase: "gone", snapshot });
    expect(correctionAfter(gone, { type: "retried" })).toBe(gone);
  });

  it("is of unknown outcome when no answer came, and is sent again as the very same correction", () => {
    const { snapshot, state } = recording();
    const unknown = answered(state, { type: "answered", attempt: 1, outcome: { outcome: "unknown" } });
    expect(unknown).toMatchObject({ phase: "unknown", snapshot, sessionEnded: false });
    expect(correctionAfter(unknown, { type: "typed", target: KEY, reason: "otra" })).toBe(unknown);
    expect(correctionAfter(unknown, { type: "submitted", snapshot: frozen("otra") })).toBe(unknown);

    const again = correctionAfter(unknown, { type: "retried" });
    expect(again).toMatchObject({ phase: "recording", attempt: 2 });
    expect(again.phase === "recording" && again.snapshot).toBe(snapshot);
  });

  it("hears only the answer of the attempt on its way", () => {
    const { state } = recording();
    const unknown = answered(state, { type: "answered", attempt: 1, outcome: { outcome: "unknown" } });
    const again = correctionAfter(unknown, { type: "retried" });
    const late = answered(again, { type: "answered", attempt: 1, outcome: { outcome: "confirmed", answer: { correction: result } } });
    expect(late).toBe(again);
  });

  it("a session that ended refuses a first attempt, and leaves a retry unknown", () => {
    const ended = { outcome: "refused", answer: { error: "Tu sesión terminó.", sessionEnded: true } } as const;
    const { state } = recording();
    expect(answered(state, { type: "answered", attempt: 1, outcome: ended })).toMatchObject({ phase: "editing", refusal: "Tu sesión terminó." });

    const unknown = answered(state, { type: "answered", attempt: 1, outcome: { outcome: "unknown" } });
    const again = correctionAfter(unknown, { type: "retried" });
    expect(answered(again, { type: "answered", attempt: 2, outcome: ended })).toMatchObject({ phase: "unknown", sessionEnded: true });
  });
});

describe("what a correction says", () => {
  it("names what is on its way without saying it is done", () => {
    expect(correctionRecordingText(frozen("x"))).toBe("Quitando 1 × Café de olla…");
    expect(correctionRecordingText(frozen("x", paid, payment()))).toBe("Quitando pago de $20.00 en efectivo…");
    expect(correctionRecordingText(frozen("x", open, whole))).toBe("Cancelando cuenta…");
  });

  it("says what the server recorded and how it left the Bill", () => {
    expect(correctionOutcome(frozen("x"), result)).toEqual({
      title: "Producto quitado",
      details: "1 × Café de olla. La cuenta suma $37.00 y debe $17.00.",
    });
    expect(correctionOutcome(frozen("x"), { total: 2000, owed: 0, canOpen: true }).details).toBe(
      "1 × Café de olla. La cuenta suma $20.00 y quedó pagada.",
    );
    expect(correctionOutcome(frozen("", open, line()), { total: 0, owed: 0, canOpen: false }).details).toBe(
      "2 × Agua mineral. La cuenta quedó sin productos.",
    );
    expect(correctionOutcome(frozen("x", paid, payment()), { total: 5550, owed: 2000, canOpen: true })).toEqual({
      title: "Pago quitado",
      details: "$20.00 en efectivo. La cuenta debe $20.00.",
    });
    expect(correctionOutcome(frozen("x", open, whole), { total: 5550, owed: 5550, canOpen: true })).toEqual({
      title: "Cuenta cancelada",
      details: "Sus productos ya no cuentan. La cuenta se conserva, marcada como cancelada.",
    });
    // Payments are named only when the Bill had any.
    expect(correctionOutcome(frozen("x", partial, whole), { total: 5550, owed: 3550, canOpen: true }).details).toBe(
      "Sus productos y sus pagos ya no cuentan. La cuenta se conserva, marcada como cancelada.",
    );
  });

  it("takes for the route's answer only what carries the correction", () => {
    expect(isCorrectionAnswer({ correction: result })).toBe(true);
    expect(isCorrectionAnswer({ error: "x" })).toBe(false);
    expect(isCorrectionAnswer({ correction: null })).toBe(false);
  });
});

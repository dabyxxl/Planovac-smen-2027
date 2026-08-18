"use client";

import { ChangeEvent, Fragment, useEffect, useMemo, useState } from "react";

type Worker = { id: string; name: string };
type Pair = { id: string; members: [string, string] };
type Vacation = { id: string; workerId: string; from: string; to: string };
type ShiftKind = "day" | "night";
type Override = { date: string; kind: ShiftKind; absentId: string; substituteId: string; source?: "auto" | "balance" };

const INITIAL_WORKERS: Worker[] = [
  ["A", "Téra"],
  ["B", "Pichnarčík"],
  ["C", "Rechtorík"],
  ["D", "Mikuš"],
  ["E", "Pivko"],
  ["F", "Kopta"],
  ["G", "Müller"],
  ["H", "Dabergotz"],
  ["I", "Němcová"],
  ["J", "Mertová"],
].map(([id, name]) => ({ id, name }));
const INITIAL_PAIRS: Pair[] = ["AB", "CD", "EF", "GH", "IJ"].map((p) => ({ id: p, members: [p[0], p[1]] }));
const MONTHS = ["leden", "únor", "březen", "duben", "květen", "červen", "červenec", "srpen", "září", "říjen", "listopad", "prosinec"];
const WEEKDAYS = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];
const FIRST_PLANNED_YEAR = 2027;
const FIRST_PLANNED_MONTH = 0;
const RESTORED_CHECKPOINT_MODE = true;
const ENFORCE_DDNN_FOR_SUBSTITUTIONS = false;
const FIRST_PLANNED_DATE = "2027-01-01";
const BALANCING_PERIODS = [
  { id: "h1", label: "1. pololetí", range: "1. 1. – 30. 6. 2027", from: "2027-01-01", to: "2027-06-30", workDays: 129, holidayDays: 3, targetHours: 967.5 },
  { id: "h2", label: "2. pololetí", range: "1. 7. – 31. 12. 2027", from: "2027-07-01", to: "2027-12-31", workDays: 132, holidayDays: 6, targetHours: 990 },
] as const;
const HOLIDAYS_2027: Record<string, string> = {
  "2027-01-01": "Den obnovy samostatného českého státu",
  "2027-03-26": "Velký pátek",
  "2027-03-29": "Velikonoční pondělí",
  "2027-05-01": "Svátek práce",
  "2027-05-08": "Den vítězství",
  "2027-07-05": "Den slovanských věrozvěstů Cyrila a Metoděje",
  "2027-07-06": "Den upálení mistra Jana Husa",
  "2027-09-28": "Den české státnosti",
  "2027-10-28": "Den vzniku samostatného československého státu",
  "2027-11-17": "Den boje za svobodu a demokracii",
  "2027-12-24": "Štědrý den",
  "2027-12-25": "1. svátek vánoční",
  "2027-12-26": "2. svátek vánoční",
};

function isProtectedOriginalHolidayShift(date: string, kind: ShiftKind) {
  if (HOLIDAYS_2027[date]) return true;
  if (kind !== "night") return false;
  const endDate = new Date(`${date}T12:00:00`);
  endDate.setDate(endDate.getDate() + 1);
  return Boolean(HOLIDAYS_2027[isoDate(endDate.getFullYear(), endDate.getMonth(), endDate.getDate())]);
}

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isOnVacation(workerId: string, date: string, vacations: Vacation[]) {
  return vacations.some((v) => v.workerId === workerId && date >= v.from && date <= v.to);
}

function isSubstitutionMonthAllowed(date: string) {
  const month = date.slice(5, 7);
  return month !== "01" && month !== "12";
}

function minimumMonthlyShifts(date: string) {
  return date.slice(5, 7) === "02" ? 10 : 12;
}

function maximumMonthlyShifts(date: string) {
  return date.slice(5, 7) === "02" ? 14 : 16;
}

function isInVacationProtection(workerId: string, date: string, vacations: Vacation[]) {
  const checked = new Date(`${date}T12:00:00`);
  return vacations.some((vacation) => {
    if (vacation.workerId !== workerId) return false;
    const protectedFrom = new Date(`${vacation.from}T12:00:00`);
    const protectedTo = new Date(`${vacation.to}T12:00:00`);
    protectedFrom.setDate(protectedFrom.getDate() - 6);
    protectedTo.setDate(protectedTo.getDate() + 6);
    return checked >= protectedFrom && checked <= protectedTo;
  });
}

const CYCLE_ANCHOR_DAY = Math.floor(Date.UTC(2026, 7, 1) / 86400000);

function generatedPair(dayNumber: number, kind: ShiftKind, pairs: Pair[]) {
  return pairs.find((_, pairIndex) => {
    // Dne 1. 8. 2026 je dvojice CD na prvním dni denní směny.
    const cyclePosition = dayNumber - CYCLE_ANCHOR_DAY + 2;
    const phase = ((cyclePosition - pairIndex * 2) % 10 + 10) % 10;
    return kind === "day" ? phase < 2 : phase >= 2 && phase < 4;
  });
}

function isWorkerScheduled(workerId: string, date: string, pairs: Pair[], overrides: Override[]) {
  const parsed = new Date(`${date}T12:00:00`);
  const dayNumber = Math.floor(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()) / 86400000);
  return (["day", "night"] as ShiftKind[]).some((kind) => {
    const pair = generatedPair(dayNumber, kind, pairs);
    const planned = pair?.members ?? [];
    const actual = planned.map((plannedId) => overrides.find((override) => override.date === date && override.kind === kind && override.absentId === plannedId)?.substituteId ?? plannedId);
    return actual.includes(workerId);
  });
}

function plannedWorkersForShift(date: string, kind: ShiftKind, pairs: Pair[]) {
  const parsed = new Date(`${date}T12:00:00`);
  const dayNumber = Math.floor(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()) / 86400000);
  return [...(generatedPair(dayNumber, kind, pairs)?.members ?? [])];
}

function shiftInterval(date: string, kind: ShiftKind) {
  const start = new Date(`${date}T${kind === "day" ? "06:00:00" : "18:00:00"}`);
  const end = new Date(start);
  end.setHours(end.getHours() + 12);
  return { start: start.getTime(), end: end.getTime() };
}

function hasInsufficientRest(workerId: string, date: string, kind: ShiftKind, pairs: Pair[], overrides: Override[]) {
  const candidate = shiftInterval(date, kind);
  const center = new Date(`${date}T12:00:00`);
  const assignments: { date: string; kind: ShiftKind }[] = [];
  for (let offset = -2; offset <= 2; offset += 1) {
    const checked = new Date(center);
    checked.setDate(checked.getDate() + offset);
    const checkedDate = isoDate(checked.getFullYear(), checked.getMonth(), checked.getDate());
    const dayNumber = Math.floor(Date.UTC(checked.getFullYear(), checked.getMonth(), checked.getDate()) / 86400000);
    (["day", "night"] as ShiftKind[]).forEach((checkedKind) => {
      if (checkedDate === date && checkedKind === kind) return;
      const pair = generatedPair(dayNumber, checkedKind, pairs);
      const actualWorkers = (pair?.members ?? []).map((plannedId) => overrides.find((override) => override.date === checkedDate && override.kind === checkedKind && override.absentId === plannedId)?.substituteId ?? plannedId);
      if (actualWorkers.includes(workerId)) assignments.push({ date: checkedDate, kind: checkedKind });
    });
  }
  return assignments.some((assignment) => {
    const existing = shiftInterval(assignment.date, assignment.kind);
    const rest = candidate.start >= existing.end ? candidate.start - existing.end : existing.start - candidate.end;
    return rest < 12 * 60 * 60 * 1000;
  });
}

function createsTooManyConsecutiveShifts(workerId: string, date: string, pairs: Pair[], overrides: Override[], limit = 5) {
  const center = new Date(`${date}T12:00:00`);
  const workedDates = new Set<string>([date]);
  for (let offset = -6; offset <= 6; offset += 1) {
    const checked = new Date(center);
    checked.setDate(checked.getDate() + offset);
    const checkedDate = isoDate(checked.getFullYear(), checked.getMonth(), checked.getDate());
    const dayNumber = Math.floor(Date.UTC(checked.getFullYear(), checked.getMonth(), checked.getDate()) / 86400000);
    const works = (["day", "night"] as ShiftKind[]).some((kind) => {
      const pair = generatedPair(dayNumber, kind, pairs);
      const actualWorkers = (pair?.members ?? []).map((plannedId) => overrides.find((override) => override.date === checkedDate && override.kind === kind && override.absentId === plannedId)?.substituteId ?? plannedId);
      return actualWorkers.includes(workerId);
    });
    if (works) workedDates.add(checkedDate);
  }
  let consecutive = 0;
  let previous = 0;
  return [...workedDates].sort().some((workedDate) => {
    const [workedYear, workedMonth, workedDay] = workedDate.split("-").map(Number);
    const current = Date.UTC(workedYear, workedMonth - 1, workedDay);
    consecutive = previous && current - previous === 86400000 ? consecutive + 1 : 1;
    previous = current;
    return consecutive > limit;
  });
}

function baseCycleDayOff(workerId: string, date: string, pairs: Pair[]) {
  const parsed = new Date(`${date}T12:00:00`);
  const dayNumber = Math.floor(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()) / 86400000);
  return !(["day", "night"] as ShiftKind[]).some((kind) => generatedPair(dayNumber, kind, pairs)?.members.includes(workerId));
}

function violatesMinimumCycleRest(workerId: string, date: string, pairs: Pair[], overrides: Override[], candidateKind?: ShiftKind) {
  if (!ENFORCE_DDNN_FOR_SUBSTITUTIONS) return false;
  const center = new Date(`${date}T12:00:00`);
  const shifts = new Map<string, ShiftKind>();
  for (let offset = -6; offset <= 6; offset += 1) {
    const checked = new Date(center);
    checked.setDate(checked.getDate() + offset);
    const checkedDate = isoDate(checked.getFullYear(), checked.getMonth(), checked.getDate());
    const dayNumber = Math.floor(Date.UTC(checked.getFullYear(), checked.getMonth(), checked.getDate()) / 86400000);
    (["day", "night"] as ShiftKind[]).forEach((kind) => {
      const actualWorkers = (generatedPair(dayNumber, kind, pairs)?.members ?? []).map((plannedId) => overrides.find((item) => item.date === checkedDate && item.kind === kind && item.absentId === plannedId)?.substituteId ?? plannedId);
      if (actualWorkers.includes(workerId)) shifts.set(checkedDate, kind);
    });
  }
  if (candidateKind) shifts.set(date, candidateKind);
  if (!shifts.has(date)) return false;
  const block: ShiftKind[] = [shifts.get(date)!];
  for (let offset = -1; shifts.has(isoDate(new Date(center.getFullYear(), center.getMonth(), center.getDate() + offset).getFullYear(), new Date(center.getFullYear(), center.getMonth(), center.getDate() + offset).getMonth(), new Date(center.getFullYear(), center.getMonth(), center.getDate() + offset).getDate())); offset -= 1) {
    const checked = new Date(center.getFullYear(), center.getMonth(), center.getDate() + offset, 12);
    block.unshift(shifts.get(isoDate(checked.getFullYear(), checked.getMonth(), checked.getDate()))!);
  }
  for (let offset = 1; ; offset += 1) {
    const checked = new Date(center.getFullYear(), center.getMonth(), center.getDate() + offset, 12);
    const kind = shifts.get(isoDate(checked.getFullYear(), checked.getMonth(), checked.getDate()));
    if (!kind) break;
    block.push(kind);
  }
  if (block.length > 4) return true;
  const pattern = block.map((kind) => kind === "day" ? "D" : "N").join("");
  return !["DDNN", "DDDN", "DNNN"].some((allowed) => allowed.startsWith(pattern) || allowed.endsWith(pattern) || allowed.includes(pattern));
}

export default function Home() {
  const today = new Date();
  const initialMonth = today < new Date(FIRST_PLANNED_YEAR, FIRST_PLANNED_MONTH, 1)
    ? new Date(FIRST_PLANNED_YEAR, FIRST_PLANNED_MONTH, 1)
    : today;
  const [year, setYear] = useState(initialMonth.getFullYear());
  const [month, setMonth] = useState(initialMonth.getMonth());
  const [workers, setWorkers] = useState<Worker[]>(INITIAL_WORKERS);
  const [pairs, setPairs] = useState<Pair[]>(INITIAL_PAIRS);
  const [vacations, setVacations] = useState<Vacation[]>([]);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [tab, setTab] = useState<"calendar" | "year" | "balance" | "team" | "vacation">("calendar");
  const [selectedPeriod, setSelectedPeriod] = useState<"h1" | "h2" | "year">("h1");
  const [ready, setReady] = useState(false);
  const [vacationWorker, setVacationWorker] = useState("A");
  const initialDate = isoDate(initialMonth.getFullYear(), initialMonth.getMonth(), initialMonth.getDate());
  const [vacationFrom, setVacationFrom] = useState(initialDate);
  const [vacationTo, setVacationTo] = useState(initialDate);
  const [subDate, setSubDate] = useState(initialDate);
  const [subKind, setSubKind] = useState<ShiftKind>("day");
  const [subAbsent, setSubAbsent] = useState("A");
  const [substitute, setSubstitute] = useState("C");
  const [swapDate, setSwapDate] = useState(initialDate);
  const [swapDayWorker, setSwapDayWorker] = useState("");
  const [swapNightWorker, setSwapNightWorker] = useState("");
  const [plannerMessage, setPlannerMessage] = useState("");
  const [editingShift, setEditingShift] = useState<{ date: string; kind: ShiftKind; absentId: string } | null>(null);
  const [manualCleanupDone, setManualCleanupDone] = useState(false);

  useEffect(() => {
    const applyStoredData = (data: { workers?: Worker[]; pairs?: Pair[]; vacations?: Vacation[]; overrides?: Override[] }) => {
        setWorkers((data.workers ?? INITIAL_WORKERS).map((worker: Worker) => {
          const newDefault = INITIAL_WORKERS.find((item) => item.id === worker.id);
          return worker.name === worker.id && newDefault ? newDefault : worker;
        }));
        setPairs(data.pairs ?? INITIAL_PAIRS);
        setVacations((data.vacations ?? []).filter((vacation: Vacation) => vacation.to >= FIRST_PLANNED_DATE));
        setOverrides((data.overrides ?? []).filter((override: Override) => override.date >= FIRST_PLANNED_DATE && !(
          override.date === "2027-03-13"
          && override.kind === "night"
          && override.absentId === "E"
          && override.substituteId === "J"
        )));
    };
    const loadInitialData = async () => {
      const saved = localStorage.getItem("planovac-smen-checkpoint-pivko-muller-v5");
      try {
        if (saved) applyStoredData(JSON.parse(saved));
        else {
          const response = await fetch("/planovac-smen-2027-data.json?checkpoint=pivko-muller-v1", { cache: "no-store" });
          if (response.ok) applyStoredData(await response.json());
        }
      } catch { /* ignore damaged local or bundled data */ }
      setReady(true);
    };
    void loadInitialData();
  }, []);

  useEffect(() => {
    if (ready) localStorage.setItem("planovac-smen-checkpoint-pivko-muller-v5", JSON.stringify({ workers, pairs, vacations, overrides }));
  }, [ready, workers, pairs, vacations, overrides]);

  useEffect(() => {
    if (!ready) return;
    const restoreKey = "planovac-smen-vratit-vikend-muller-tera-v1";
    if (localStorage.getItem(restoreKey)) return;
    void fetch("/planovac-smen-2027-data.json?restore=muller-tera-v1", { cache: "no-store" }).then((response) => response.json()).then((baseline: { overrides?: Override[] }) => {
      const original = baseline.overrides ?? [];
      setOverrides((items) => {
        const changedSlots = items.filter((item) => item.kind === "day" && item.source === "balance" && ((item.substituteId === "A" && [0, 6].includes(new Date(`${item.date}T12:00:00`).getDay())) || (item.substituteId === "G" && ![0, 6].includes(new Date(`${item.date}T12:00:00`).getDay()))))
          .filter((item) => !original.some((base) => base.date === item.date && base.kind === item.kind && base.absentId === item.absentId && base.substituteId === item.substituteId));
        const changedSlotKeys = new Set(changedSlots.map((item) => `${item.date}|${item.kind}|${item.absentId}`));
        const restored = items.filter((item) => !changedSlotKeys.has(`${item.date}|${item.kind}|${item.absentId}`));
        original.filter((item) => changedSlotKeys.has(`${item.date}|${item.kind}|${item.absentId}`)).forEach((item) => restored.push(item));
        return restored;
      });
      localStorage.setItem(restoreKey, "provedeno");
    });
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    const changeKey = "planovac-smen-cervenec-nemcova-mertova-v1";
    if (localStorage.getItem(changeKey)) return;
    setOverrides((items) => items.map((item) => {
      if (item.date === "2027-07-17" && item.kind === "night" && item.substituteId === "J") return { ...item, substituteId: "I" };
      if (item.date === "2027-07-18" && item.kind === "night" && item.substituteId === "I") return { ...item, substituteId: "J" };
      if (item.date === "2027-07-19" && item.kind === "day" && item.substituteId === "J") return { ...item, substituteId: "I" };
      if (item.date === "2027-07-20" && item.kind === "day" && item.substituteId === "I") return { ...item, substituteId: "J" };
      return item;
    }));
    localStorage.setItem(changeKey, "provedeno");
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    const correctionKey = "planovac-smen-unor-limit-mertova-v1";
    if (localStorage.getItem(correctionKey)) return;
    setOverrides((items) => items.map((item) => item.date === "2027-02-21" && item.kind === "night" && item.substituteId === "J" ? { ...item, substituteId: "E", source: "balance" } : item));
    localStorage.setItem(correctionKey, "provedeno");
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    const correctionKey = "planovac-smen-unor-limit-mertova-v2";
    if (localStorage.getItem(correctionKey)) return;
    setOverrides((items) => items.map((item) => item.date === "2027-02-21" && item.kind === "night" && item.substituteId === "E" ? { ...item, substituteId: "C", source: "balance" } : item));
    localStorage.setItem(correctionKey, "provedeno");
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    const correctionKey = "planovac-smen-unor-21-rechtorik-pivko-v1";
    if (localStorage.getItem(correctionKey)) return;
    setOverrides((items) => items.filter((item) => !(item.date === "2027-02-21" && item.kind === "night" && item.absentId === "E")));
    localStorage.setItem(correctionKey, "provedeno");
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    const correctionKey = "planovac-smen-unor-05-pivko-mertova-v1";
    if (localStorage.getItem(correctionKey)) return;
    setOverrides((items) => items.filter((item) => !(item.date === "2027-02-05" && item.kind === "night" && item.absentId === "J" && item.substituteId === "E")));
    localStorage.setItem(correctionKey, "provedeno");
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    const correctionKey = "planovac-smen-unor-05-pivko-mertova-v2";
    if (localStorage.getItem(correctionKey)) return;
    setOverrides((items) => items.map((item) => item.date === "2027-02-08" && item.kind === "day" && item.substituteId === "J" ? { ...item, substituteId: "E" } : item));
    localStorage.setItem(correctionKey, "provedeno");
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    const correctionKey = "planovac-smen-srpen-tera-muller-vratit-v1";
    if (localStorage.getItem(correctionKey)) return;
    setOverrides((items) => items.filter((item) => !(item.date === "2027-08-21" && item.kind === "day" && item.absentId === "G" && item.substituteId === "A")).map((item) => {
      if (item.date === "2027-08-19" && item.kind === "day" && item.substituteId === "A") return { ...item, substituteId: "G" };
      if (item.date === "2027-08-21" && item.kind === "night" && item.substituteId === "G") return { ...item, substituteId: "A" };
      return item;
    }));
    localStorage.setItem(correctionKey, "provedeno");
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    const correctionKey = "planovac-smen-brezen-dabergotz-muller-v1";
    if (localStorage.getItem(correctionKey)) return;
    setOverrides((items) => items.map((item) => {
      if (item.date === "2027-03-10" && item.kind === "day" && item.substituteId === "G") return { ...item, substituteId: "H" };
      if (item.date === "2027-03-10" && item.kind === "night" && item.substituteId === "H") return { ...item, substituteId: "G" };
      return item;
    }));
    localStorage.setItem(correctionKey, "provedeno");
  }, [ready]);

  function exportDataBackup() {
    const backup = { version: 1, exportedAt: new Date().toISOString(), workers, pairs, vacations, overrides };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "planovac-smen-2027-data.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importDataBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      setWorkers(data.workers ?? INITIAL_WORKERS);
      setPairs(data.pairs ?? INITIAL_PAIRS);
      setVacations((data.vacations ?? []).filter((vacation: Vacation) => vacation.to >= FIRST_PLANNED_DATE));
      setOverrides((data.overrides ?? []).filter((override: Override) => override.date >= FIRST_PLANNED_DATE));
      setPlannerMessage("Záloha dat byla úspěšně načtena.");
    } catch {
      setPlannerMessage("Zálohu se nepodařilo načíst. Vyberte platný soubor dat plánovače.");
    }
    event.target.value = "";
  }

  useEffect(() => {
    if (RESTORED_CHECKPOINT_MODE) return;
    if (ready && vacations.length > 0) automaticallyPlanSubstitutions();
    // Automatické první dopočítání po načtení lokálních dat; další spuštění je ruční.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    if (RESTORED_CHECKPOINT_MODE) return;
    if (ready) setOverrides((items) => {
      const accepted: Override[] = [];
      items.filter((item) => isSubstitutionMonthAllowed(item.date) && !isProtectedOriginalHolidayShift(item.date, item.kind)).forEach((item) => {
        if (!violatesMinimumCycleRest(item.substituteId, item.date, pairs, accepted)) accepted.push(item);
      });
      return accepted;
    });
  }, [ready, pairs]);

  useEffect(() => {
    if (RESTORED_CHECKPOINT_MODE) return;
    if (!ready) return;
    const correctionKey = "planovac-smen-zruseni-vsech-rucnich-zmen-v1";
    if (!localStorage.getItem(correctionKey)) {
      setOverrides((items) => items.filter((item) => item.source === "auto" || item.source === "balance"));
      localStorage.setItem(correctionKey, "provedeno");
    }
    setManualCleanupDone(true);
  }, [ready]);

  useEffect(() => {
    if (RESTORED_CHECKPOINT_MODE) return;
    if (manualCleanupDone) automaticallyPlanSubstitutions();
    // Přepočet musí proběhnout až v následujícím vykreslení, kdy už jsou ruční změny odstraněné.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualCleanupDone]);

  useEffect(() => {
    if (RESTORED_CHECKPOINT_MODE) return;
    if (!ready) return;
    const repairKey = "planovac-smen-oprava-neobsazene-smeny-v2";
    if (localStorage.getItem(repairKey)) return;
    localStorage.setItem(repairKey, "provedeno");
    automaticallyPlanSubstitutions();
    // Jednorázový přepočet po doplnění přeskupování záskoků.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    if (RESTORED_CHECKPOINT_MODE) return;
    if (!ready || !overrides.some((item) => item.date === "2027-06-17" && item.kind === "night" && item.absentId === "B" && item.substituteId === "I")) return;
    setOverrides((items) => {
      const shortenedSeries = items.map((item) => item.date === "2027-06-17" && item.kind === "night" && item.absentId === "B" && item.substituteId === "I"
        ? { ...item, substituteId: "F" }
        : item);
      const withoutPreviousCompensation = shortenedSeries.filter((item) => !(item.source === "balance" && item.absentId === "F" && item.substituteId === "I" && item.date <= "2027-06-30"));
      return [...withoutPreviousCompensation.filter((item) => !(item.date === "2027-03-31" && item.kind === "day" && item.absentId === "F")), { date: "2027-03-31", kind: "day", absentId: "F", substituteId: "G", source: "balance" }];
    });
    // Trvalá pojistka: pozdější automatický přepočet nesmí obnovit šestou směnu Němcové.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, overrides]);

  useEffect(() => {
    if (RESTORED_CHECKPOINT_MODE) return;
    if (!ready) return;
    const hasJuneTransfer = overrides.some((item) => item.date === "2027-06-17" && item.kind === "night" && item.absentId === "B" && item.substituteId === "F");
    const hasMarchCompensation = overrides.some((item) => item.date === "2027-03-31" && item.kind === "day" && item.absentId === "F" && item.substituteId === "G");
    if (!hasJuneTransfer || hasMarchCompensation) return;
    setOverrides((items) => [...items.filter((item) => !(item.source === "balance" && item.absentId === "F" && item.substituteId === "I" && item.date <= "2027-06-30") && !(item.date === "2027-03-31" && item.kind === "day" && item.absentId === "F")), { date: "2027-03-31", kind: "day", absentId: "F", substituteId: "G", source: "balance" }]);
  }, [ready, overrides]);

  useEffect(() => {
    if (RESTORED_CHECKPOINT_MODE) return;
    if (!ready) return;
    const hasPichnarcikSeries = overrides.some((item) => item.date === "2027-03-01" && item.kind === "night" && item.absentId === "D" && item.substituteId === "B");
    const hasTeraSeries = overrides.some((item) => item.date === "2027-08-18" && item.kind === "night" && item.absentId === "C" && item.substituteId === "A");
    if (!hasPichnarcikSeries && !hasTeraSeries) return;
    setOverrides((items) => {
      let corrected = items.map((item) => {
        if (item.date === "2027-03-01" && item.kind === "night" && item.absentId === "D" && item.substituteId === "B") return { ...item, substituteId: "G" };
        if (item.date === "2027-08-18" && item.kind === "night" && item.absentId === "C" && item.substituteId === "A") return { ...item, substituteId: "G" };
        return item;
      });
      corrected = balancePeriodHours(BALANCING_PERIODS[0], corrected).balanced;
      corrected = balancePeriodHours(BALANCING_PERIODS[1], corrected).balanced;
      return corrected;
    });
  }, [ready, overrides]);

  useEffect(() => {
    if (RESTORED_CHECKPOINT_MODE) return;
    if (!ready || overrides.some((item) => item.date === "2027-05-10" && item.kind === "day" && item.absentId === "F" && item.substituteId === "G")) return;
    setOverrides((items) => [...items.filter((item) => !(item.date === "2027-05-10" && item.kind === "day" && item.absentId === "F")), { date: "2027-05-10", kind: "day", absentId: "F", substituteId: "G", source: "balance" }]);
  }, [ready, overrides]);

  useEffect(() => {
    if (RESTORED_CHECKPOINT_MODE) return;
    if (!ready) return;
    let checked = overrides;
    BALANCING_PERIODS.forEach((period) => {
      checked = balancePeriodHours(period, checked).balanced;
    });
    if (JSON.stringify(checked) !== JSON.stringify(overrides)) setOverrides(checked);
    // Závěrečná pojistka se spouští po každé změně dat a dorovná obě pololetí.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, overrides]);

  const replaceableWorkers = plannedWorkersForShift(subDate, subKind, pairs);
  useEffect(() => {
    if (RESTORED_CHECKPOINT_MODE) return;
    if (!replaceableWorkers.includes(subAbsent) && replaceableWorkers[0]) setSubAbsent(replaceableWorkers[0]);
  }, [subDate, subKind, pairs, subAbsent, replaceableWorkers]);

  const workersForSwapShift = (kind: ShiftKind) => plannedWorkersForShift(swapDate, kind, pairs).map((plannedId) => {
    const replacement = overrides.find((item) => item.date === swapDate && item.kind === kind && item.absentId === plannedId);
    return { plannedId, actualId: replacement?.substituteId ?? plannedId };
  });
  const swapDayWorkers = workersForSwapShift("day");
  const swapNightWorkers = workersForSwapShift("night");

  useEffect(() => {
    if (!swapDayWorkers.some((item) => item.actualId === swapDayWorker)) setSwapDayWorker(swapDayWorkers[0]?.actualId ?? "");
    if (!swapNightWorkers.some((item) => item.actualId === swapNightWorker)) setSwapNightWorker(swapNightWorkers[0]?.actualId ?? "");
  }, [swapDate, pairs, overrides, swapDayWorker, swapNightWorker]);

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leading = (new Date(year, month, 1).getDay() + 6) % 7;
  const schedule = useMemo(() => Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const date = isoDate(year, month, day);
    const dayNumber = Math.floor(Date.UTC(year, month, day) / 86400000);
    const makeShift = (kind: ShiftKind) => {
      const pair = generatedPair(dayNumber, kind, pairs);
      const base = pair?.members ?? [];
      return base.map((id) => {
        const replacement = overrides.find((o) => o.date === date && o.kind === kind && o.absentId === id);
        return { plannedId: id, actualId: replacement?.substituteId ?? id, replaced: Boolean(replacement), worked: Boolean(replacement) || !isOnVacation(id, date, vacations) };
      });
    };
    return { day, date, dayShift: makeShift("day"), nightShift: makeShift("night") };
  }), [daysInMonth, year, month, pairs, overrides, vacations]);

  const counts = useMemo(() => workers.map((worker) => {
    let day = 0, night = 0, substitutions = 0, vacationShifts = 0;
    schedule.forEach((s) => {
      day += s.dayShift.filter((x) => x.actualId === worker.id && x.worked).length;
      night += s.nightShift.filter((x) => x.actualId === worker.id && x.worked).length;
      substitutions += [...s.dayShift, ...s.nightShift].filter((x) => x.actualId === worker.id && x.replaced).length;
      vacationShifts += [...s.dayShift, ...s.nightShift].filter((x) => x.plannedId === worker.id && isOnVacation(worker.id, s.date, vacations)).length;
    });
    return { id: worker.id, day, night, substitutions, vacationShifts, total: day + night + vacationShifts };
  }), [workers, schedule, vacations]);

  const balancingCounts = useMemo(() => {
    const period = BALANCING_PERIODS.find((item) => item.id === selectedPeriod) ?? BALANCING_PERIODS[0];
    const from = new Date(`${period.from}T12:00:00`);
    const to = new Date(`${period.to}T12:00:00`);
    const totals = new Map(workers.map((worker) => [worker.id, { day: 0, night: 0, substitutions: 0, substitutionDay: 0, substitutionNight: 0, vacationShifts: 0, holidayDay: 0, holidayNight: 0, weekendDay: 0, weekendNight: 0 }]));
    for (let date = new Date(from); date <= to; date.setDate(date.getDate() + 1)) {
      const dateString = isoDate(date.getFullYear(), date.getMonth(), date.getDate());
      const dayNumber = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
      (["day", "night"] as ShiftKind[]).forEach((kind) => {
        const pair = generatedPair(dayNumber, kind, pairs);
        pair?.members.forEach((plannedId) => {
          if (isOnVacation(plannedId, dateString, vacations)) {
            const plannedWorkerTotal = totals.get(plannedId);
            if (plannedWorkerTotal) plannedWorkerTotal.vacationShifts += 1;
          }
          const replacement = overrides.find((o) => o.date === dateString && o.kind === kind && o.absentId === plannedId);
          if (!replacement && isOnVacation(plannedId, dateString, vacations)) return;
          const actualId = replacement?.substituteId ?? plannedId;
          const total = totals.get(actualId);
          if (total) {
            total[kind] += 1;
            if (HOLIDAYS_2027[dateString]) {
              if (kind === "day") total.holidayDay += 1;
              else total.holidayNight += 1;
            }
            if (date.getDay() === 0 || date.getDay() === 6) {
              if (kind === "day") total.weekendDay += 1;
              else total.weekendNight += 1;
            }
            if (replacement) {
              total.substitutions += 1;
              if (kind === "day") total.substitutionDay += 1;
              else total.substitutionNight += 1;
            }
          }
        });
      });
    }
    return workers.map((worker) => {
      const total = totals.get(worker.id) ?? { day: 0, night: 0, substitutions: 0, substitutionDay: 0, substitutionNight: 0, vacationShifts: 0, holidayDay: 0, holidayNight: 0, weekendDay: 0, weekendNight: 0 };
      const shifts = total.day + total.night;
      const regularShifts = shifts - total.substitutions;
      const regularHours = regularShifts * 12;
      const substitutionHours = total.substitutions * 12;
      const vacationHours = total.vacationShifts * 12;
      const hours = regularHours + substitutionHours + vacationHours;
      const difference = regularHours + substitutionHours + vacationHours - period.targetHours;
      return { ...worker, ...total, shifts, regularShifts, regularHours, substitutionHours, vacationHours, hours, difference };
    });
  }, [workers, pairs, overrides, vacations, selectedPeriod]);

  const annualBalanceCounts = useMemo(() => {
    const calculate = (from: string, to: string, targetHours: number) => {
      const totals = new Map(workers.map((worker) => [worker.id, { day: 0, night: 0, substitutions: 0, vacationShifts: 0, holidayDay: 0, holidayNight: 0, weekendDay: 0, weekendNight: 0 }]));
      for (let date = new Date(`${from}T12:00:00`); date <= new Date(`${to}T12:00:00`); date.setDate(date.getDate() + 1)) {
        const dateString = isoDate(date.getFullYear(), date.getMonth(), date.getDate());
        const dayNumber = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
        (["day", "night"] as ShiftKind[]).forEach((kind) => generatedPair(dayNumber, kind, pairs)?.members.forEach((plannedId) => {
          const totalPlanned = totals.get(plannedId);
          if (totalPlanned && isOnVacation(plannedId, dateString, vacations)) totalPlanned.vacationShifts += 1;
          const replacement = overrides.find((item) => item.date === dateString && item.kind === kind && item.absentId === plannedId);
          if (!replacement && isOnVacation(plannedId, dateString, vacations)) return;
          const total = totals.get(replacement?.substituteId ?? plannedId);
          if (!total) return;
          total[kind] += 1;
          if (replacement) total.substitutions += 1;
          if (HOLIDAYS_2027[dateString]) kind === "day" ? total.holidayDay += 1 : total.holidayNight += 1;
          if (date.getDay() === 0 || date.getDay() === 6) kind === "day" ? total.weekendDay += 1 : total.weekendNight += 1;
        }));
      }
      return new Map(workers.map((worker) => {
        const total = totals.get(worker.id)!;
        const hours = (total.day + total.night + total.vacationShifts) * 12;
        return [worker.id, { ...total, hours, difference: hours - targetHours }] as const;
      }));
    };
    const h1 = calculate(BALANCING_PERIODS[0].from, BALANCING_PERIODS[0].to, BALANCING_PERIODS[0].targetHours);
    const h2 = calculate(BALANCING_PERIODS[1].from, BALANCING_PERIODS[1].to, BALANCING_PERIODS[1].targetHours);
    return workers.map((worker) => {
      const first = h1.get(worker.id)!;
      const second = h2.get(worker.id)!;
      return { ...worker, first, second, day: first.day + second.day, night: first.night + second.night, substitutions: first.substitutions + second.substitutions, vacationShifts: first.vacationShifts + second.vacationShifts, holidayDay: first.holidayDay + second.holidayDay, holidayNight: first.holidayNight + second.holidayNight, weekendDay: first.weekendDay + second.weekendDay, weekendNight: first.weekendNight + second.weekendNight, hours: first.hours + second.hours, difference: first.difference + second.difference };
    });
  }, [workers, pairs, overrides, vacations]);

  useEffect(() => {
    if (!ready) return;
    for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
      const monthFrom = isoDate(2027, monthIndex, 1);
      const monthTo = isoDate(2027, monthIndex + 1, 0);
      const maximum = maximumMonthlyShifts(monthFrom);
      const monthly = workers.map((worker) => ({ worker, total: countMonthlyCreditedShifts(worker.id, monthFrom, monthTo, overrides) }));
      const offender = monthly.find((item) => item.total > maximum);
      if (!offender) continue;
      const period = BALANCING_PERIODS[monthIndex < 6 ? 0 : 1];
      const assignments: { date: string; kind: ShiftKind; plannedId: string; replacement?: Override }[] = [];
      for (let day = 1; day <= new Date(2027, monthIndex + 1, 0).getDate(); day += 1) {
        const date = isoDate(2027, monthIndex, day);
        const dayNumber = Math.floor(Date.UTC(2027, monthIndex, day) / 86400000);
        (["day", "night"] as ShiftKind[]).forEach((kind) => generatedPair(dayNumber, kind, pairs)?.members.forEach((plannedId) => {
          const replacement = overrides.find((item) => item.date === date && item.kind === kind && item.absentId === plannedId);
          if ((replacement?.substituteId ?? plannedId) === offender.worker.id && (replacement || !isOnVacation(plannedId, date, vacations))) assignments.push({ date, kind, plannedId, replacement });
        }));
      }
      for (const assignment of assignments.filter((item) => !HOLIDAYS_2027[item.date] && isSubstitutionMonthAllowed(item.date))) {
        const withoutAssignment = overrides.filter((item) => item !== assignment.replacement);
        const recipients = monthly.filter((item) => item.worker.id !== offender.worker.id && item.total < maximum).sort((a, b) => a.total - b.total);
        for (const recipient of recipients) {
          if (isOnVacation(recipient.worker.id, assignment.date, vacations) || isWorkerScheduled(recipient.worker.id, assignment.date, pairs, withoutAssignment)) continue;
          const periodFrom = new Date(`${period.from}T12:00:00`);
          const periodTo = new Date(`${period.to}T12:00:00`);
          for (let otherDate = new Date(periodFrom); otherDate <= periodTo; otherDate.setDate(otherDate.getDate() + 1)) {
            const otherDateString = isoDate(otherDate.getFullYear(), otherDate.getMonth(), otherDate.getDate());
            if (otherDateString.slice(0, 7) === monthFrom.slice(0, 7) || !isSubstitutionMonthAllowed(otherDateString) || HOLIDAYS_2027[otherDateString]) continue;
            const dayNumber = Math.floor(Date.UTC(otherDate.getFullYear(), otherDate.getMonth(), otherDate.getDate()) / 86400000);
            for (const otherPlannedId of generatedPair(dayNumber, assignment.kind, pairs)?.members ?? []) {
              const otherReplacement = overrides.find((item) => item.date === otherDateString && item.kind === assignment.kind && item.absentId === otherPlannedId);
              if ((otherReplacement?.substituteId ?? otherPlannedId) !== recipient.worker.id || !otherReplacement && isOnVacation(otherPlannedId, otherDateString, vacations)) continue;
              const withoutBoth = withoutAssignment.filter((item) => item !== otherReplacement);
              if (isOnVacation(offender.worker.id, otherDateString, vacations) || isWorkerScheduled(offender.worker.id, otherDateString, pairs, withoutBoth)) continue;
              let swap = [...withoutBoth];
              if (recipient.worker.id !== assignment.plannedId) swap.push({ date: assignment.date, kind: assignment.kind, absentId: assignment.plannedId, substituteId: recipient.worker.id, source: "balance" });
              if (offender.worker.id !== otherPlannedId) swap.push({ date: otherDateString, kind: assignment.kind, absentId: otherPlannedId, substituteId: offender.worker.id, source: "balance" });
              if (hasInsufficientRest(recipient.worker.id, assignment.date, assignment.kind, pairs, swap) || createsTooManyConsecutiveShifts(recipient.worker.id, assignment.date, pairs, swap, 5)) continue;
              if (hasInsufficientRest(offender.worker.id, otherDateString, assignment.kind, pairs, swap) || createsTooManyConsecutiveShifts(offender.worker.id, otherDateString, pairs, swap, 5)) continue;
              const otherMonthFrom = `${otherDateString.slice(0, 7)}-01`;
              const parsedOtherMonth = new Date(`${otherMonthFrom}T12:00:00`);
              const otherMonthTo = isoDate(parsedOtherMonth.getFullYear(), parsedOtherMonth.getMonth() + 1, 0);
              if (countMonthlyCreditedShifts(offender.worker.id, monthFrom, monthTo, swap) > maximum || countMonthlyCreditedShifts(recipient.worker.id, monthFrom, monthTo, swap) > maximum) continue;
              if (countMonthlyCreditedShifts(offender.worker.id, otherMonthFrom, otherMonthTo, swap) > maximumMonthlyShifts(otherMonthFrom) || countMonthlyCreditedShifts(recipient.worker.id, otherMonthFrom, otherMonthTo, swap) < minimumMonthlyShifts(otherMonthFrom)) continue;
              setOverrides(swap);
              return;
            }
          }
          let trial = [...withoutAssignment];
          if (recipient.worker.id !== assignment.plannedId) trial.push({ date: assignment.date, kind: assignment.kind, absentId: assignment.plannedId, substituteId: recipient.worker.id, source: "balance" });
          if (hasInsufficientRest(recipient.worker.id, assignment.date, assignment.kind, pairs, trial) || createsTooManyConsecutiveShifts(recipient.worker.id, assignment.date, pairs, trial, 5)) continue;
          const validMonth = workers.every((worker) => countMonthlyCreditedShifts(worker.id, monthFrom, monthTo, trial) <= maximum);
          if (!validMonth) continue;
          setOverrides(trial);
          return;
        }
      }
    }
  }, [ready, workers, pairs, overrides, vacations]);

  useEffect(() => {
    if (!ready || RESTORED_CHECKPOINT_MODE) return;
    const needsBalance = annualBalanceCounts.some((item) => item.weekendDay < 19 || item.weekendDay > 23 || item.weekendNight < 19 || item.weekendNight > 23);
    if (!needsBalance) return;
    const assignments: { date: string; kind: ShiftKind; plannedId: string; workerId: string; replacement?: Override; weekend: boolean }[] = [];
    for (let dayIndex = 0; dayIndex < 365; dayIndex += 1) {
      const date = new Date(2027, 0, dayIndex + 1, 12);
      const dateString = isoDate(2027, date.getMonth(), date.getDate());
      const dayNumber = Math.floor(Date.UTC(2027, date.getMonth(), date.getDate()) / 86400000);
      (["day", "night"] as ShiftKind[]).forEach((kind) => generatedPair(dayNumber, kind, pairs)?.members.forEach((plannedId) => {
        const replacement = overrides.find((item) => item.date === dateString && item.kind === kind && item.absentId === plannedId);
        if (!replacement && isOnVacation(plannedId, dateString, vacations)) return;
        assignments.push({ date: dateString, kind, plannedId, workerId: replacement?.substituteId ?? plannedId, replacement, weekend: date.getDay() === 0 || date.getDay() === 6 });
      }));
    }
    const countFor = (workerId: string, kind: ShiftKind) => annualBalanceCounts.find((item) => item.id === workerId)?.[kind === "day" ? "weekendDay" : "weekendNight"] ?? 0;
    const tryNightBlockTransfer = (recipientId: string, amount: 2 | 4) => {
      const pivkoItems = assignments.filter((item) => item.kind === "night" && item.weekend && item.workerId === "E" && isSubstitutionMonthAllowed(item.date) && !HOLIDAYS_2027[item.date]).sort((a, b) => a.date.localeCompare(b.date));
      const recipientItems = assignments.filter((item) => item.kind === "night" && !item.weekend && item.workerId === recipientId && isSubstitutionMonthAllowed(item.date) && !HOLIDAYS_2027[item.date]).sort((a, b) => a.date.localeCompare(b.date));
      const nextDay = (first: typeof assignments[number], second: typeof assignments[number]) => new Date(`${second.date}T12:00:00`).getTime() - new Date(`${first.date}T12:00:00`).getTime() === 86400000;
      const weekendBlocks = pivkoItems.flatMap((item, index) => pivkoItems[index + 1] && nextDay(item, pivkoItems[index + 1]) ? [[item, pivkoItems[index + 1]]] : []);
      const weekdayBlocks = recipientItems.flatMap((item, index) => recipientItems[index + 1] && nextDay(item, recipientItems[index + 1]) ? [[item, recipientItems[index + 1]]] : []);
      const pairsOfBlocks = weekendBlocks.flatMap((weekend) => weekdayBlocks.filter((weekday) => weekday[0].date.slice(0, 7) === weekend[0].date.slice(0, 7)).map((weekday) => ({ weekend, weekday })));
      const selections = amount === 2 ? pairsOfBlocks.map((pair) => [pair]) : pairsOfBlocks.flatMap((pair, index) => pairsOfBlocks.slice(index + 1).map((second) => [pair, second]));
      for (const selected of selections) {
        const allDates = selected.flatMap((pair) => [...pair.weekend, ...pair.weekday].map((item) => item.date));
        if (new Set(allDates).size !== allDates.length) continue;
        const removed = new Set(selected.flatMap((pair) => [...pair.weekend, ...pair.weekday].map((item) => item.replacement)).filter(Boolean));
        const withoutSelected = overrides.filter((item) => !removed.has(item));
        if (selected.some((pair) => pair.weekend.some((item) => isOnVacation(recipientId, item.date, vacations) || isWorkerScheduled(recipientId, item.date, pairs, withoutSelected))
          || pair.weekday.some((item) => isOnVacation("E", item.date, vacations) || isWorkerScheduled("E", item.date, pairs, withoutSelected)))) continue;
        const trial = [...withoutSelected];
        selected.forEach((pair) => {
          pair.weekend.forEach((item) => { if (item.plannedId !== recipientId) trial.push({ date: item.date, kind: "night", absentId: item.plannedId, substituteId: recipientId, source: "balance" }); });
          pair.weekday.forEach((item) => { if (item.plannedId !== "E") trial.push({ date: item.date, kind: "night", absentId: item.plannedId, substituteId: "E", source: "balance" }); });
        });
        const recipientDates = selected.flatMap((pair) => pair.weekend.map((item) => item.date));
        const pivkoDates = selected.flatMap((pair) => pair.weekday.map((item) => item.date));
        if (recipientDates.some((date) => hasInsufficientRest(recipientId, date, "night", pairs, trial) || createsTooManyConsecutiveShifts(recipientId, date, pairs, trial, 5) || violatesMinimumCycleRest(recipientId, date, pairs, trial, "night"))) continue;
        if (pivkoDates.some((date) => hasInsufficientRest("E", date, "night", pairs, trial) || createsTooManyConsecutiveShifts("E", date, pairs, trial, 5) || violatesMinimumCycleRest("E", date, pairs, trial, "night"))) continue;
        return trial;
      }
      const individualPairs = pivkoItems.flatMap((weekend) => recipientItems.filter((weekday) => weekday.date.slice(0, 7) === weekend.date.slice(0, 7)).map((weekday) => ({ weekend, weekday })));
      let checkedSelections = 0;
      let found: Override[] | undefined;
      const search = (start: number, selected: typeof individualPairs) => {
        if (found || checkedSelections > 250000) return;
        if (selected.length === amount) {
          checkedSelections += 1;
          const dates = selected.flatMap((pair) => [pair.weekend.date, pair.weekday.date]);
          if (new Set(dates).size !== dates.length) return;
          const removed = new Set(selected.flatMap((pair) => [pair.weekend.replacement, pair.weekday.replacement]).filter(Boolean));
          const withoutSelected = overrides.filter((item) => !removed.has(item));
          if (selected.some((pair) => isOnVacation(recipientId, pair.weekend.date, vacations) || isOnVacation("E", pair.weekday.date, vacations)
            || isWorkerScheduled(recipientId, pair.weekend.date, pairs, withoutSelected) || isWorkerScheduled("E", pair.weekday.date, pairs, withoutSelected))) return;
          const trial = [...withoutSelected];
          selected.forEach((pair) => {
            if (pair.weekend.plannedId !== recipientId) trial.push({ date: pair.weekend.date, kind: "night", absentId: pair.weekend.plannedId, substituteId: recipientId, source: "balance" });
            if (pair.weekday.plannedId !== "E") trial.push({ date: pair.weekday.date, kind: "night", absentId: pair.weekday.plannedId, substituteId: "E", source: "balance" });
          });
          if (selected.some((pair) => hasInsufficientRest(recipientId, pair.weekend.date, "night", pairs, trial) || createsTooManyConsecutiveShifts(recipientId, pair.weekend.date, pairs, trial, 5) || violatesMinimumCycleRest(recipientId, pair.weekend.date, pairs, trial, "night"))) return;
          if (selected.some((pair) => hasInsufficientRest("E", pair.weekday.date, "night", pairs, trial) || createsTooManyConsecutiveShifts("E", pair.weekday.date, pairs, trial, 5) || violatesMinimumCycleRest("E", pair.weekday.date, pairs, trial, "night"))) return;
          found = trial;
          return;
        }
        for (let index = start; index < individualPairs.length; index += 1) {
          const pair = individualPairs[index];
          if (selected.some((item) => item.weekend.date === pair.weekend.date || item.weekday.date === pair.weekday.date)) continue;
          search(index + 1, [...selected, pair]);
          if (found || checkedSelections > 250000) return;
        }
      };
      search(0, []);
      if (found) return found;
      return undefined;
    };
    if (countFor("E", "night") >= 23 && countFor("G", "night") < 20) {
      const trial = countFor("G", "night") <= 16 ? (tryNightBlockTransfer("G", 4) ?? tryNightBlockTransfer("G", 2)) : tryNightBlockTransfer("G", 2);
      if (trial) { setOverrides(trial); return; }
    }
    if (countFor("E", "night") >= 23 && countFor("J", "night") <= 18) {
      const trial = tryNightBlockTransfer("J", 2);
      if (trial) { setOverrides(trial); return; }
    }
    if (countFor("G", "day") > 23 && countFor("A", "day") < 19) {
      const mullerWeekends = assignments.filter((item) => item.kind === "day" && item.weekend && item.workerId === "G" && isSubstitutionMonthAllowed(item.date) && !HOLIDAYS_2027[item.date]);
      const teraWeekdays = assignments.filter((item) => item.kind === "day" && !item.weekend && item.workerId === "A" && isSubstitutionMonthAllowed(item.date) && !HOLIDAYS_2027[item.date]);
      const possiblePairs = mullerWeekends.flatMap((weekend) => teraWeekdays.filter((weekday) => weekday.date.slice(0, 7) === weekend.date.slice(0, 7)).map((weekday) => ({ weekend, weekday })));
      for (let first = 0; first < possiblePairs.length - 2; first += 1) for (let second = first + 1; second < possiblePairs.length - 1; second += 1) for (let third = second + 1; third < possiblePairs.length; third += 1) {
        const selected = [possiblePairs[first], possiblePairs[second], possiblePairs[third]];
        if (new Set(selected.flatMap((pair) => [pair.weekend.date, pair.weekday.date])).size !== 6) continue;
        const h1Weekend = selected.filter((pair) => pair.weekend.date <= "2027-06-30").length;
        const h1Weekday = selected.filter((pair) => pair.weekday.date <= "2027-06-30").length;
        if (h1Weekend !== h1Weekday) continue;
        const removed = new Set(selected.flatMap((pair) => [pair.weekend.replacement, pair.weekday.replacement]).filter(Boolean));
        const withoutSelected = overrides.filter((item) => !removed.has(item));
        if (selected.some((pair) => isOnVacation("A", pair.weekend.date, vacations) || isOnVacation("G", pair.weekday.date, vacations)
          || isWorkerScheduled("A", pair.weekend.date, pairs, withoutSelected) || isWorkerScheduled("G", pair.weekday.date, pairs, withoutSelected))) continue;
        const trial = [...withoutSelected];
        selected.forEach((pair) => {
          if (pair.weekend.plannedId !== "A") trial.push({ date: pair.weekend.date, kind: "day", absentId: pair.weekend.plannedId, substituteId: "A", source: "balance" });
          if (pair.weekday.plannedId !== "G") trial.push({ date: pair.weekday.date, kind: "day", absentId: pair.weekday.plannedId, substituteId: "G", source: "balance" });
        });
        const newTeraDates = selected.map((pair) => pair.weekend.date);
        const newMullerDates = selected.map((pair) => pair.weekday.date);
        if (newTeraDates.some((date) => hasInsufficientRest("A", date, "day", pairs, trial) || createsTooManyConsecutiveShifts("A", date, pairs, trial, 5) || violatesMinimumCycleRest("A", date, pairs, trial, "day"))) continue;
        if (newMullerDates.some((date) => hasInsufficientRest("G", date, "day", pairs, trial) || createsTooManyConsecutiveShifts("G", date, pairs, trial, 5) || violatesMinimumCycleRest("G", date, pairs, trial, "day"))) continue;
        setOverrides(trial);
        return;
      }
    }
    for (const kind of ["day", "night"] as ShiftKind[]) {
      const recipients = workers.filter((worker) => countFor(worker.id, kind) < 19).sort((a, b) => countFor(a.id, kind) - countFor(b.id, kind));
      for (const recipient of recipients) {
        const donors = workers.filter((worker) => worker.id !== recipient.id && countFor(worker.id, kind) > 19).sort((a, b) => countFor(b.id, kind) - countFor(a.id, kind));
        for (const donor of donors) {
          const weekendAssignments = assignments.filter((item) => item.kind === kind && item.weekend && item.workerId === donor.id && isSubstitutionMonthAllowed(item.date) && !HOLIDAYS_2027[item.date]);
          const weekdayAssignments = assignments.filter((item) => item.kind === kind && !item.weekend && item.workerId === recipient.id && isSubstitutionMonthAllowed(item.date) && !HOLIDAYS_2027[item.date]);
          for (const sameMonthOnly of [true, false]) for (const weekendAssignment of weekendAssignments) for (const weekdayAssignment of weekdayAssignments) {
            if (weekendAssignment.date === weekdayAssignment.date) continue;
            if (weekendAssignment.date.slice(0, 4) !== weekdayAssignment.date.slice(0, 4)) continue;
            if ((weekendAssignment.date <= "2027-06-30") !== (weekdayAssignment.date <= "2027-06-30")) continue;
            if (sameMonthOnly !== (weekendAssignment.date.slice(0, 7) === weekdayAssignment.date.slice(0, 7))) continue;
            const withoutPair = overrides.filter((item) => item !== weekendAssignment.replacement && item !== weekdayAssignment.replacement);
            if (isOnVacation(recipient.id, weekendAssignment.date, vacations) || isOnVacation(donor.id, weekdayAssignment.date, vacations)) continue;
            if (isWorkerScheduled(recipient.id, weekendAssignment.date, pairs, withoutPair) || isWorkerScheduled(donor.id, weekdayAssignment.date, pairs, withoutPair)) continue;
            let trial = [...withoutPair];
            if (recipient.id !== weekendAssignment.plannedId) trial.push({ date: weekendAssignment.date, kind, absentId: weekendAssignment.plannedId, substituteId: recipient.id, source: "balance" });
            if (donor.id !== weekdayAssignment.plannedId) trial.push({ date: weekdayAssignment.date, kind, absentId: weekdayAssignment.plannedId, substituteId: donor.id, source: "balance" });
            if (hasInsufficientRest(recipient.id, weekendAssignment.date, kind, pairs, trial) || hasInsufficientRest(donor.id, weekdayAssignment.date, kind, pairs, trial)) continue;
            if (violatesMinimumCycleRest(recipient.id, weekendAssignment.date, pairs, trial, kind) || violatesMinimumCycleRest(donor.id, weekdayAssignment.date, pairs, trial, kind)) continue;
            if (createsTooManyConsecutiveShifts(recipient.id, weekendAssignment.date, pairs, trial, 5) || createsTooManyConsecutiveShifts(donor.id, weekdayAssignment.date, pairs, trial, 5)) continue;
            const affectedMonths = [...new Set([weekendAssignment.date.slice(0, 7), weekdayAssignment.date.slice(0, 7)])];
            const monthlyValid = affectedMonths.every((monthValue) => {
              const parsed = new Date(`${monthValue}-01T12:00:00`);
              const monthFrom = `${monthValue}-01`;
              const monthTo = isoDate(parsed.getFullYear(), parsed.getMonth() + 1, 0);
              const minimum = parsed.getMonth() === 1 ? 10 : 12;
              return [recipient.id, donor.id].every((workerId) => {
                const total = countMonthlyCreditedShifts(workerId, monthFrom, monthTo, trial);
                return total >= minimum && total <= maximumMonthlyShifts(monthFrom);
              });
            });
            if (!monthlyValid) continue;
            setOverrides(trial);
            return;
          }
        }
      }
      for (const recipient of recipients) {
        const donors = workers.filter((worker) => worker.id !== recipient.id && countFor(worker.id, kind) >= 21).sort((a, b) => countFor(b.id, kind) - countFor(a.id, kind));
        for (const donor of donors) {
          const donorItems = assignments.filter((item) => item.kind === kind && item.weekend && item.workerId === donor.id && isSubstitutionMonthAllowed(item.date) && !HOLIDAYS_2027[item.date]).sort((a, b) => a.date.localeCompare(b.date));
          const recipientItems = assignments.filter((item) => item.kind === kind && !item.weekend && item.workerId === recipient.id && isSubstitutionMonthAllowed(item.date) && !HOLIDAYS_2027[item.date]).sort((a, b) => a.date.localeCompare(b.date));
          const consecutive = (first: typeof assignments[number], second: typeof assignments[number]) => new Date(`${second.date}T12:00:00`).getTime() - new Date(`${first.date}T12:00:00`).getTime() === 86400000;
          const donorBlocks = donorItems.flatMap((item, index) => donorItems[index + 1] && consecutive(item, donorItems[index + 1]) ? [[item, donorItems[index + 1]]] : []);
          const recipientBlocks = recipientItems.flatMap((item, index) => recipientItems[index + 1] && consecutive(item, recipientItems[index + 1]) ? [[item, recipientItems[index + 1]]] : []);
          for (const donorBlock of donorBlocks) for (const recipientBlock of recipientBlocks) {
            if ((donorBlock[0].date <= "2027-06-30") !== (recipientBlock[0].date <= "2027-06-30")) continue;
            const removed = new Set([...donorBlock, ...recipientBlock].map((item) => item.replacement).filter(Boolean));
            const withoutBlocks = overrides.filter((item) => !removed.has(item));
            if (donorBlock.some((item) => isOnVacation(recipient.id, item.date, vacations) || isWorkerScheduled(recipient.id, item.date, pairs, withoutBlocks))) continue;
            if (recipientBlock.some((item) => isOnVacation(donor.id, item.date, vacations) || isWorkerScheduled(donor.id, item.date, pairs, withoutBlocks))) continue;
            let trial = [...withoutBlocks];
            donorBlock.forEach((item) => { if (recipient.id !== item.plannedId) trial.push({ date: item.date, kind, absentId: item.plannedId, substituteId: recipient.id, source: "balance" }); });
            recipientBlock.forEach((item) => { if (donor.id !== item.plannedId) trial.push({ date: item.date, kind, absentId: item.plannedId, substituteId: donor.id, source: "balance" }); });
            if (donorBlock.some((item) => hasInsufficientRest(recipient.id, item.date, kind, pairs, trial) || createsTooManyConsecutiveShifts(recipient.id, item.date, pairs, trial, 5))) continue;
            if (recipientBlock.some((item) => hasInsufficientRest(donor.id, item.date, kind, pairs, trial) || createsTooManyConsecutiveShifts(donor.id, item.date, pairs, trial, 5))) continue;
            if (donorBlock.some((item) => violatesMinimumCycleRest(recipient.id, item.date, pairs, trial, kind)) || recipientBlock.some((item) => violatesMinimumCycleRest(donor.id, item.date, pairs, trial, kind))) continue;
            const affectedMonths = [...new Set([...donorBlock, ...recipientBlock].map((item) => item.date.slice(0, 7)))];
            if (!affectedMonths.every((monthValue) => {
              const parsed = new Date(`${monthValue}-01T12:00:00`);
              const monthTo = isoDate(parsed.getFullYear(), parsed.getMonth() + 1, 0);
              const minimum = parsed.getMonth() === 1 ? 10 : 12;
              return [recipient.id, donor.id].every((workerId) => { const total = countMonthlyCreditedShifts(workerId, `${monthValue}-01`, monthTo, trial); return total >= minimum && total <= maximumMonthlyShifts(`${monthValue}-01`); });
            })) continue;
            setOverrides(trial);
            return;
          }
        }
      }
    }
  }, [ready, annualBalanceCounts, workers, pairs, overrides, vacations]);

  const yearSummary = useMemo(() => {
    const days = Array.from({ length: 365 }, (_, index) => {
      const date = new Date(2027, 0, index + 1, 12);
      const dateString = isoDate(2027, date.getMonth(), date.getDate());
      const dayNumber = Math.floor(Date.UTC(2027, date.getMonth(), date.getDate()) / 86400000);
      const assignments = new Map<string, "D" | "N" | "ZD" | "ZN">();
      (["day", "night"] as ShiftKind[]).forEach((kind) => {
        const pair = generatedPair(dayNumber, kind, pairs);
        pair?.members.forEach((plannedId) => {
          const replacement = overrides.find((o) => o.date === dateString && o.kind === kind && o.absentId === plannedId);
          if (replacement) assignments.set(replacement.substituteId, kind === "day" ? "ZD" : "ZN");
          else assignments.set(plannedId, kind === "day" ? "D" : "N");
        });
      });
      return { date, dateString, assignments };
    });
    return { days, rows: workers.map((worker) => ({
      worker,
      planMarks: days.map((day) => day.assignments.get(worker.id) ?? ""),
      vacationMarks: days.map((day) => isOnVacation(worker.id, day.dateString, vacations) ? "ŘD" : ""),
    })) };
  }, [workers, pairs, overrides, vacations]);

  const vacationSummary = useMemo(() => workers.map((worker) => {
    const entries = vacations.filter((vacation) => vacation.workerId === worker.id).sort((a, b) => a.from.localeCompare(b.from));
    const days = entries.reduce((sum, vacation) => {
      const from = new Date(`${vacation.from}T12:00:00`);
      const to = new Date(`${vacation.to}T12:00:00`);
      return sum + Math.floor((to.getTime() - from.getTime()) / 86400000) + 1;
    }, 0);
    return { worker, entries, days };
  }), [workers, vacations]);

  function exportAnnualSummaryForExcel() {
    const csvRows: string[][] = [["Roční souhrn směn 2027"], ["D = denní směna nebo záskok, N = noční směna nebo záskok, ŘD = řádná dovolená"], []];
    MONTHS.forEach((monthName, monthIndex) => {
      const monthDays = yearSummary.days.map((day, index) => ({ ...day, yearIndex: index })).filter((day) => day.date.getMonth() === monthIndex);
      csvRows.push([`${monthName} 2027`]);
      csvRows.push(["Pracovník", "Přehled", ...monthDays.map((day) => `${day.date.getDate()}.${day.date.getMonth() + 1}.2027`)]);
      yearSummary.rows.forEach((row) => {
        csvRows.push([row.worker.name, "Plán směn", ...monthDays.map((day) => row.planMarks[day.yearIndex].replace("ZD", "D").replace("ZN", "N"))]);
        csvRows.push([row.worker.name, "Dovolená", ...monthDays.map((day) => row.vacationMarks[day.yearIndex])]);
      });
      csvRows.push([]);
    });
    const escapeCell = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const csv = `\uFEFF${csvRows.map((row) => row.map(escapeCell).join(";")).join("\r\n")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "rocni-souhrn-smen-2027.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function exportAnnualBalanceForExcel() {
    const rows: (string | number)[][] = [
      ["Roční bilance pracovníků 2027"],
      ["Pracovník", "1. pololetí H", "1. pololetí rozdíl H", "2. pololetí H", "2. pololetí rozdíl H", "Denní", "Noční", "Záskoky", "ŘD směny", "Svátky denní", "Svátky noční", "Víkendy denní", "Víkendy noční", "Celkem H", "Roční rozdíl H"],
      ...annualBalanceCounts.map((item) => [item.name, item.first.hours, item.first.difference, item.second.hours, item.second.difference, item.day, item.night, item.substitutions, item.vacationShifts, item.holidayDay, item.holidayNight, item.weekendDay, item.weekendNight, item.hours, item.difference]),
    ];
    const escapeCell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const csv = `\uFEFF${rows.map((row) => row.map(escapeCell).join(";")).join("\r\n")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "rocni-bilance-pracovniku-2027.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  const issues = useMemo(() => {
    const result: string[] = [];
    schedule.forEach((s) => {
      if (s.dayShift.length !== 2 || new Set(s.dayShift.map((worker) => worker.actualId)).size !== 2 || s.nightShift.length !== 2 || new Set(s.nightShift.map((worker) => worker.actualId)).size !== 2) result.push(`${s.day}. ${MONTHS[month]}: směna musí být obsazena právě dvěma různými pracovníky.`);
      [...s.dayShift.map((x) => ({ ...x, kind: "denní" })), ...s.nightShift.map((x) => ({ ...x, kind: "noční" }))].forEach((x) => {
        if (isOnVacation(x.actualId, s.date, vacations)) result.push(`${s.day}. ${MONTHS[month]}: ${x.actualId} má dovolenou, ale je na ${x.kind} směně.`);
      });
      const all = [...s.dayShift, ...s.nightShift].map((x) => x.actualId);
      new Set(all.filter((id, i) => all.indexOf(id) !== i)).forEach((id) => result.push(`${s.day}. ${MONTHS[month]}: ${id} má denní i noční směnu (24 h).`));
      overrides.filter((override) => override.date === s.date && isInVacationProtection(override.substituteId, override.date, vacations)).forEach((override) => result.push(`${s.day}. ${MONTHS[month]}: ${workers.find((worker) => worker.id === override.substituteId)?.name ?? override.substituteId} nemůže zastupovat – čerpá dovolenou nebo je v ochranném období 6 dní před/po dovolené.`));
      overrides.filter((override) => override.date === s.date && isWorkerScheduled(override.substituteId, override.date, pairs, overrides.filter((item) => item !== override))).forEach((override) => result.push(`${s.day}. ${MONTHS[month]}: ${workers.find((worker) => worker.id === override.substituteId)?.name ?? override.substituteId} nemůže zastupovat – ve stejný den má naplánovanou jinou směnu.`));
      overrides.filter((override) => override.date === s.date && !plannedWorkersForShift(override.date, override.kind, pairs).includes(override.absentId)).forEach(() => result.push(`${s.day}. ${MONTHS[month]}: neplatný záskok – nahrazovaný pracovník není členem zvolené směny.`));
      overrides.filter((override) => override.date === s.date && hasInsufficientRest(override.substituteId, override.date, override.kind, pairs, overrides.filter((item) => item !== override))).forEach((override) => result.push(`${s.day}. ${MONTHS[month]}: ${workers.find((worker) => worker.id === override.substituteId)?.name ?? override.substituteId} nemá mezi směnami minimálně 12 hodin volna.`));
      overrides.filter((override) => override.date === s.date && createsTooManyConsecutiveShifts(override.substituteId, override.date, pairs, overrides.filter((item) => item !== override), 5)).forEach((override) => result.push(`${s.day}. ${MONTHS[month]}: ${workers.find((worker) => worker.id === override.substituteId)?.name ?? override.substituteId} má 6 nebo více směn v řadě.`));
      overrides.filter((override) => override.date === s.date && violatesMinimumCycleRest(override.substituteId, override.date, pairs, overrides.filter((item) => item !== override), override.kind)).forEach((override) => result.push(`${s.day}. ${MONTHS[month]}: ${workers.find((worker) => worker.id === override.substituteId)?.name ?? override.substituteId} nemá pracovní blok DDNN, DDDN nebo DNNN.`));
      overrides.filter((override) => override.date === s.date && isProtectedOriginalHolidayShift(override.date, override.kind)).forEach((override) => result.push(`${s.day}. ${MONTHS[month]}: původní sváteční směnu pracovníka ${workers.find((worker) => worker.id === override.absentId)?.name ?? override.absentId} nelze zrušit ani nahradit.`));
    });
    const monthlyMaximum = month === 1 ? 14 : 16;
    counts.filter((c) => c.total > monthlyMaximum).forEach((c) => result.push(`${workers.find((worker) => worker.id === c.id)?.name ?? c.id} má ${c.total} směn, limit je ${monthlyMaximum}.`));
    const monthlyMinimum = month === 1 ? 10 : 12;
    counts.filter((c) => c.total < monthlyMinimum).forEach((c) => result.push(`${workers.find((worker) => worker.id === c.id)?.name ?? c.id} má pouze ${c.total} směn, měsíční minimum je ${monthlyMinimum}.`));
    return [...new Set(result)];
  }, [schedule, vacations, counts, month, overrides, workers, pairs]);

  function moveMonth(delta: number) {
    const next = new Date(year, month + delta, 1);
    if (next < new Date(FIRST_PLANNED_YEAR, FIRST_PLANNED_MONTH, 1)) return;
    setYear(next.getFullYear()); setMonth(next.getMonth());
  }

  const isFirstPlannedMonth = year === FIRST_PLANNED_YEAR && month === FIRST_PLANNED_MONTH;

  function addVacation(e: React.FormEvent) {
    e.preventDefault();
    if (vacationFrom > vacationTo) return;
    setVacations((v) => [...v, { id: crypto.randomUUID(), workerId: vacationWorker, from: vacationFrom, to: vacationTo }]);
  }

  function swapDayAndNight(e: React.FormEvent) {
    e.preventDefault();
    if (!isSubstitutionMonthAllowed(swapDate) || isProtectedOriginalHolidayShift(swapDate, "day") || isProtectedOriginalHolidayShift(swapDate, "night")) return;
    const dayAssignment = swapDayWorkers.find((item) => item.actualId === swapDayWorker);
    const nightAssignment = swapNightWorkers.find((item) => item.actualId === swapNightWorker);
    if (!dayAssignment || !nightAssignment || swapDayWorker === swapNightWorker) return;
    const withoutAssignments = overrides.filter((item) => !(
      item.date === swapDate
      && ((item.kind === "day" && item.absentId === dayAssignment.plannedId) || (item.kind === "night" && item.absentId === nightAssignment.plannedId))
    ));
    const swapped: Override[] = [
      ...withoutAssignments,
      { date: swapDate, kind: "day", absentId: dayAssignment.plannedId, substituteId: swapNightWorker },
      { date: swapDate, kind: "night", absentId: nightAssignment.plannedId, substituteId: swapDayWorker },
    ];
    if (hasInsufficientRest(swapNightWorker, swapDate, "day", pairs, withoutAssignments) || hasInsufficientRest(swapDayWorker, swapDate, "night", pairs, withoutAssignments)) return;
    setOverrides(swapped);
  }

  function addOverride(e: React.FormEvent) {
    e.preventDefault();
    if (subAbsent === substitute) return;
    if (!isSubstitutionMonthAllowed(subDate)) return;
    if (isProtectedOriginalHolidayShift(subDate, subKind)) return;
    if (!plannedWorkersForShift(subDate, subKind, pairs).includes(subAbsent)) return;
    const validationOverrides = overrides.filter((override) => !(override.date === subDate && override.kind === subKind && override.absentId === subAbsent));
    const subMonthFrom = `${subDate.slice(0, 7)}-01`;
    const subMonthDate = new Date(`${subMonthFrom}T12:00:00`);
    const subMonthTo = isoDate(subMonthDate.getFullYear(), subMonthDate.getMonth(), new Date(subMonthDate.getFullYear(), subMonthDate.getMonth() + 1, 0).getDate());
    const replacesVacation = isOnVacation(subAbsent, subDate, vacations);
    const donorMonthlyTotal = countMonthlyCreditedShifts(subAbsent, subMonthFrom, subMonthTo, validationOverrides);
    if (!replacesVacation && donorMonthlyTotal <= minimumMonthlyShifts(subDate)) return;
    if (isInVacationProtection(substitute, subDate, vacations)) return;
    if (isWorkerScheduled(substitute, subDate, pairs, validationOverrides)) return;
    if (hasInsufficientRest(substitute, subDate, subKind, pairs, validationOverrides)) return;
    if (violatesMinimumCycleRest(substitute, subDate, pairs, validationOverrides, subKind)) return;
    const strictAlternativeExists = workers.some((worker) => worker.id !== subAbsent && !isInVacationProtection(worker.id, subDate, vacations) && !isWorkerScheduled(worker.id, subDate, pairs, validationOverrides) && !hasInsufficientRest(worker.id, subDate, subKind, pairs, validationOverrides) && !violatesMinimumCycleRest(worker.id, subDate, pairs, validationOverrides, subKind) && !createsTooManyConsecutiveShifts(worker.id, subDate, pairs, validationOverrides, 5));
    if (createsTooManyConsecutiveShifts(substitute, subDate, pairs, validationOverrides, 6)) return;
    if (strictAlternativeExists && createsTooManyConsecutiveShifts(substitute, subDate, pairs, validationOverrides, 5)) return;
    setOverrides((items) => [...items.filter((o) => !(o.date === subDate && o.kind === subKind && o.absentId === subAbsent)), { date: subDate, kind: subKind, absentId: subAbsent, substituteId: substitute }]);
    setEditingShift(null);
  }

  function countPeriodShifts(workerId: string, from: string, to: string, plannedOverrides: Override[]) {
    const start = new Date(`${from}T12:00:00`);
    const end = new Date(`${to}T12:00:00`);
    let total = 0;
    for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
      const dateString = isoDate(date.getFullYear(), date.getMonth(), date.getDate());
      const dayNumber = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
      (["day", "night"] as ShiftKind[]).forEach((kind) => {
        const pair = generatedPair(dayNumber, kind, pairs);
        (pair?.members ?? []).forEach((plannedId) => {
          const replacement = plannedOverrides.find((item) => item.date === dateString && item.kind === kind && item.absentId === plannedId);
          if (!replacement && isOnVacation(plannedId, dateString, vacations)) return;
          if ((replacement?.substituteId ?? plannedId) === workerId) total += 1;
        });
      });
    }
    return total;
  }

  function periodSubstitutionStats(workerId: string, from: string, to: string, plannedOverrides: Override[]) {
    const workerOverrides = plannedOverrides.filter((item) => item.substituteId === workerId && item.date >= from && item.date <= to);
    const day = workerOverrides.filter((item) => item.kind === "day").length;
    const night = workerOverrides.filter((item) => item.kind === "night").length;
    return { day, night, total: day + night };
  }

  function countVacationShiftHours(workerId: string, from: string, to: string) {
    const start = new Date(`${from}T12:00:00`);
    const end = new Date(`${to}T12:00:00`);
    let vacationShifts = 0;
    for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
      const dateString = isoDate(date.getFullYear(), date.getMonth(), date.getDate());
      if (!isOnVacation(workerId, dateString, vacations)) continue;
      const dayNumber = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
      (["day", "night"] as ShiftKind[]).forEach((kind) => {
        if (generatedPair(dayNumber, kind, pairs)?.members.includes(workerId)) vacationShifts += 1;
      });
    }
    return vacationShifts * 12;
  }

  function countMonthlyCreditedShifts(workerId: string, from: string, to: string, plannedOverrides: Override[]) {
    return countPeriodShifts(workerId, from, to, plannedOverrides) + countVacationShiftHours(workerId, from, to) / 12;
  }

  function creditedPeriodHours(workerId: string, period: typeof BALANCING_PERIODS[number], plannedOverrides: Override[]) {
    return countPeriodShifts(workerId, period.from, period.to, plannedOverrides) * 12 + countVacationShiftHours(workerId, period.from, period.to);
  }

  function balancePeriodHours(period: typeof BALANCING_PERIODS[number], initialOverrides: Override[]) {
    let balanced = [...initialOverrides];
    let moves = 0;
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const standings = workers.map((worker) => ({ worker, hours: creditedPeriodHours(worker.id, period, balanced) }));
      const donors = standings.filter((item) => item.hours > period.targetHours).sort((a, b) => b.hours - a.hours);
      const recipients = standings.filter((item) => item.hours < period.targetHours).sort((a, b) => a.hours - b.hours);
      if (!donors.length || !recipients.length || donors[0].hours - recipients[0].hours <= 12) break;
      let transfer: Override | undefined;
      for (const donor of donors) {
        for (let date = new Date(`${period.from}T12:00:00`); date <= new Date(`${period.to}T12:00:00`) && !transfer; date.setDate(date.getDate() + 1)) {
          const dateString = isoDate(date.getFullYear(), date.getMonth(), date.getDate());
          if (!isSubstitutionMonthAllowed(dateString)) continue;
          const donorAlreadyRelievedThisMonth = balanced.some((item) => item.source === "balance" && item.absentId === donor.worker.id && item.date.slice(0, 7) === dateString.slice(0, 7));
          if (donorAlreadyRelievedThisMonth) continue;
          const dayNumber = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
          for (const kind of ["day", "night"] as ShiftKind[]) {
            if (isProtectedOriginalHolidayShift(dateString, kind)) continue;
            const pair = generatedPair(dayNumber, kind, pairs);
            if (!pair?.members.includes(donor.worker.id) || balanced.some((item) => item.date === dateString && item.kind === kind && item.absentId === donor.worker.id) || isOnVacation(donor.worker.id, dateString, vacations)) continue;
            const monthFrom = isoDate(date.getFullYear(), date.getMonth(), 1);
            const monthTo = isoDate(date.getFullYear(), date.getMonth(), new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate());
            if (countMonthlyCreditedShifts(donor.worker.id, monthFrom, monthTo, balanced) <= minimumMonthlyShifts(dateString)) continue;
            const recipient = recipients.find((item) => !isInVacationProtection(item.worker.id, dateString, vacations)
              && !isWorkerScheduled(item.worker.id, dateString, pairs, balanced)
              && !hasInsufficientRest(item.worker.id, dateString, kind, pairs, balanced)
              && !violatesMinimumCycleRest(item.worker.id, dateString, pairs, balanced)
              && !createsTooManyConsecutiveShifts(item.worker.id, dateString, pairs, balanced, 5)
              && countMonthlyCreditedShifts(item.worker.id, monthFrom, monthTo, balanced) < maximumMonthlyShifts(dateString));
            if (recipient && donor.hours - recipient.hours > 12) {
              transfer = { date: dateString, kind, absentId: donor.worker.id, substituteId: recipient.worker.id, source: "balance" };
              break;
            }
          }
        }
        if (transfer) break;
      }
      if (!transfer) break;
      balanced.push(transfer);
      moves += 1;
    }
    return { balanced, moves };
  }

  function automaticallyPlanSubstitutions() {
    // Záskoky za dovolené se při přepočtu vytvoří znovu, aby šlo zatížení skutečně vyrovnat.
    let planned = overrides.filter((item) => isSubstitutionMonthAllowed(item.date) && !isProtectedOriginalHolidayShift(item.date, item.kind) && item.source !== "balance" && !isOnVacation(item.absentId, item.date, vacations));
    let added = 0;
    let unresolved = 0;
    const needs: { date: string; kind: ShiftKind; absentId: string }[] = [];
    for (let day = new Date("2027-01-01T12:00:00"); day <= new Date("2027-12-31T12:00:00"); day.setDate(day.getDate() + 1)) {
      const date = isoDate(day.getFullYear(), day.getMonth(), day.getDate());
      if (!isSubstitutionMonthAllowed(date)) continue;
      const dayNumber = Math.floor(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) / 86400000);
      (["day", "night"] as ShiftKind[]).forEach((kind) => generatedPair(dayNumber, kind, pairs)?.members.forEach((workerId) => {
        if (isProtectedOriginalHolidayShift(date, kind)) return;
        if (isOnVacation(workerId, date, vacations) && !planned.some((item) => item.date === date && item.kind === kind && item.absentId === workerId)) needs.push({ date, kind, absentId: workerId });
      }));
    }
    needs.forEach((need) => {
      const period = BALANCING_PERIODS.find((item) => need.date >= item.from && need.date <= item.to)!;
      const baseCandidates = workers.filter((worker) => worker.id !== need.absentId)
        .filter((worker) => !isInVacationProtection(worker.id, need.date, vacations))
        .filter((worker) => !isWorkerScheduled(worker.id, need.date, pairs, planned))
        .filter((worker) => !hasInsufficientRest(worker.id, need.date, need.kind, pairs, planned))
        .filter((worker) => !violatesMinimumCycleRest(worker.id, need.date, pairs, planned));
      const fiveShiftCandidates = baseCandidates.filter((worker) => !createsTooManyConsecutiveShifts(worker.id, need.date, pairs, planned, 5));
      const candidatePool = fiveShiftCandidates.length ? fiveShiftCandidates : baseCandidates.filter((worker) => !createsTooManyConsecutiveShifts(worker.id, need.date, pairs, planned, 6));
      const candidates = candidatePool
        .map((worker) => {
          const substitutionStats = periodSubstitutionStats(worker.id, period.from, period.to, planned);
          const nextDay = substitutionStats.day + (need.kind === "day" ? 1 : 0);
          const nextNight = substitutionStats.night + (need.kind === "night" ? 1 : 0);
          const needMonth = new Date(`${need.date.slice(0, 7)}-01T12:00:00`);
          const needMonthTo = isoDate(needMonth.getFullYear(), needMonth.getMonth(), new Date(needMonth.getFullYear(), needMonth.getMonth() + 1, 0).getDate());
          return {
            worker,
            shifts: countPeriodShifts(worker.id, period.from, period.to, planned),
            monthlyShifts: countMonthlyCreditedShifts(worker.id, `${need.date.slice(0, 7)}-01`, needMonthTo, planned),
            substitutions: substitutionStats.total,
            sameKind: need.kind === "day" ? substitutionStats.day : substitutionStats.night,
            nextImbalance: Math.abs(nextDay - nextNight),
          };
        })
        .filter((item) => item.monthlyShifts < maximumMonthlyShifts(need.date))
        .sort((a, b) => Number(a.monthlyShifts >= minimumMonthlyShifts(need.date)) - Number(b.monthlyShifts >= minimumMonthlyShifts(need.date)) || a.substitutions - b.substitutions || a.sameKind - b.sameKind || a.nextImbalance - b.nextImbalance || a.shifts - b.shifts || a.worker.name.localeCompare(b.worker.name, "cs"));
      if (candidates[0]) {
        planned.push({ ...need, substituteId: candidates[0].worker.id, source: "auto" });
        added += 1;
      } else {
        let repaired = false;
        const restBlockedCandidates = workers.filter((worker) => worker.id !== need.absentId
          && !isInVacationProtection(worker.id, need.date, vacations)
          && !isWorkerScheduled(worker.id, need.date, pairs, planned)
          && !hasInsufficientRest(worker.id, need.date, need.kind, pairs, planned)
          && violatesMinimumCycleRest(worker.id, need.date, pairs, planned)
          && !createsTooManyConsecutiveShifts(worker.id, need.date, pairs, planned, 6));
        for (const blockedCandidate of restBlockedCandidates) {
          const nearbyAssignments = planned.filter((item) => item.substituteId === blockedCandidate.id && Math.abs((new Date(`${item.date}T12:00:00`).getTime() - new Date(`${need.date}T12:00:00`).getTime()) / 86400000) <= 6);
          for (const assignment of nearbyAssignments) {
            const withoutAssignment = planned.filter((item) => item !== assignment);
            const alternate = workers.find((worker) => worker.id !== assignment.absentId && worker.id !== blockedCandidate.id
              && !isInVacationProtection(worker.id, assignment.date, vacations)
              && !isWorkerScheduled(worker.id, assignment.date, pairs, withoutAssignment)
              && !hasInsufficientRest(worker.id, assignment.date, assignment.kind, pairs, withoutAssignment)
              && !violatesMinimumCycleRest(worker.id, assignment.date, pairs, withoutAssignment)
              && !createsTooManyConsecutiveShifts(worker.id, assignment.date, pairs, withoutAssignment, 6));
            if (!alternate) continue;
            const rearranged = [...withoutAssignment, { ...assignment, substituteId: alternate.id }];
            if (violatesMinimumCycleRest(blockedCandidate.id, need.date, pairs, rearranged)
              || isWorkerScheduled(blockedCandidate.id, need.date, pairs, rearranged)
              || hasInsufficientRest(blockedCandidate.id, need.date, need.kind, pairs, rearranged)) continue;
            planned = [...rearranged, { ...need, substituteId: blockedCandidate.id, source: "auto" }];
            added += 1;
            repaired = true;
            break;
          }
          if (repaired) break;
        }
        if (!repaired) unresolved += 1;
      }
    });
    let balanceMoves = 0;
    BALANCING_PERIODS.forEach((period) => {
      const result = balancePeriodHours(period, planned);
      planned = result.balanced;
      balanceMoves += result.moves;
    });
    setOverrides(planned);
    const ranges = BALANCING_PERIODS.map((period) => {
      const values = workers.map((worker) => periodSubstitutionStats(worker.id, period.from, period.to, planned).total);
      return `${period.label}: ${Math.min(...values)}–${Math.max(...values)} záskoků`;
    }).join("; ");
    setPlannerMessage(unresolved === 0 ? `Naplánováno ${added} záskoků za dovolené a ${balanceMoves} vyrovnávacích přesunů. ${ranges}. Hodinové rozdíly byly vyrovnány na nejbližší dosažitelnou hodnotu.` : `Naplánováno ${added} záskoků a ${balanceMoves} vyrovnávacích přesunů, ${unresolved} směn zůstalo bez platného kandidáta. ${ranges}.`);
  }

  const nameOf = (id: string) => workers.find((w) => w.id === id)?.name ?? id;
  const christmasDutyOverview = Array.from({ length: 12 }, (_, index) => 2026 + index).map((christmasYear) => ({
    year: christmasYear,
    days: [24, 25, 26].map((day) => {
      const dateString = `${christmasYear}-12-${String(day).padStart(2, "0")}`;
      const dayNumber = Math.floor(Date.UTC(christmasYear, 11, day) / 86400000);
      const actualWorkers = (kind: ShiftKind) => (generatedPair(dayNumber, kind, pairs)?.members ?? []).map((plannedId) => {
        const replacement = christmasYear === 2027 ? overrides.find((item) => item.date === dateString && item.kind === kind && item.absentId === plannedId) : undefined;
        return replacement?.substituteId ?? plannedId;
      });
      return { dateString, day, weekday: WEEKDAYS[(new Date(christmasYear, 11, day).getDay() + 6) % 7], dayWorkers: actualWorkers("day"), nightWorkers: actualWorkers("night") };
    }),
  }));
  const christmasDutyTotals = workers.map((worker) => {
    const holidays = christmasDutyOverview.flatMap((item) => item.days);
    const day = holidays.reduce((total, holiday) => total + holiday.dayWorkers.filter((workerId) => workerId === worker.id).length, 0);
    const night = holidays.reduce((total, holiday) => total + holiday.nightWorkers.filter((workerId) => workerId === worker.id).length, 0);
    return { worker, day, night, total: day + night };
  });
  const christmasRotationSimulation = Array.from({ length: 12 }, (_, index) => {
    const simulationYear = 2026 + index;
    const dayPair = pairs[(index * 2) % pairs.length];
    const nightPair = pairs[(index * 2 + 1) % pairs.length];
    return { year: simulationYear, dayPair, nightPair };
  });
  const christmasRotationTotals = pairs.map((pair) => {
    const dayYears = christmasRotationSimulation.filter((item) => item.dayPair.id === pair.id).map((item) => item.year);
    const nightYears = christmasRotationSimulation.filter((item) => item.nightPair.id === pair.id).map((item) => item.year);
    const allYears = [...dayYears, ...nightYears].sort((a, b) => a - b);
    const gaps = allYears.slice(1).map((year, index) => year - allYears[index]);
    return { pair, dayYears, nightYears, total: allYears.length, gap: gaps.length ? `${Math.min(...gaps)}–${Math.max(...gaps)} roky` : "—" };
  });
  function openTableShiftEditor(date: string, kind: ShiftKind, displayedWorkerId: string) {
    const existing = overrides.find((override) => override.date === date && override.kind === kind && (override.absentId === displayedWorkerId || override.substituteId === displayedWorkerId));
    const absentId = existing?.absentId ?? displayedWorkerId;
    setSubDate(date);
    setSubKind(kind);
    setSubAbsent(absentId);
    setSubstitute(existing?.substituteId ?? workers.find((worker) => worker.id !== absentId)?.id ?? "");
    setEditingShift({ date, kind, absentId });
  }
  const strictManualCandidateExists = workers.some((worker) => worker.id !== subAbsent
    && !isInVacationProtection(worker.id, subDate, vacations)
    && !isWorkerScheduled(worker.id, subDate, pairs, overrides)
    && !hasInsufficientRest(worker.id, subDate, subKind, pairs, overrides)
    && !violatesMinimumCycleRest(worker.id, subDate, pairs, overrides, subKind)
    && !createsTooManyConsecutiveShifts(worker.id, subDate, pairs, overrides, 5));
  const tableEditOverrides = overrides.filter((override) => !(override.date === subDate && override.kind === subKind && override.absentId === subAbsent));
  const editingManualOverride = editingShift ? overrides.find((override) => override.date === editingShift.date && override.kind === editingShift.kind && override.absentId === editingShift.absentId && override.source === undefined) : undefined;
  function removeEditingManualOverride() {
    if (!editingManualOverride) return;
    setOverrides((items) => items.filter((item) => item !== editingManualOverride));
    setEditingShift(null);
  }
  const tableEditBlocked = (workerId: string) => workerId === subAbsent
    || isInVacationProtection(workerId, subDate, vacations)
    || isWorkerScheduled(workerId, subDate, pairs, tableEditOverrides)
    || hasInsufficientRest(workerId, subDate, subKind, pairs, tableEditOverrides)
    || violatesMinimumCycleRest(workerId, subDate, pairs, tableEditOverrides, subKind)
    || createsTooManyConsecutiveShifts(workerId, subDate, pairs, tableEditOverrides, 6);

  return (
    <main>
      <header className="topbar">
        <div className="brand"><span className="brandMark">PS</span><div><strong>Plánovač směn</strong><small>lokální pracovní plán</small></div></div>
        <nav aria-label="Hlavní navigace">
          <button className={tab === "calendar" ? "active" : ""} onClick={() => setTab("calendar")}>Kalendář</button>
          <button className={tab === "year" ? "active" : ""} onClick={() => setTab("year")}>Měsíční plán 2027</button>
          <button className={tab === "balance" ? "active" : ""} onClick={() => setTab("balance")}>Vyrovnávací období</button>
          <button className={tab === "team" ? "active" : ""} onClick={() => setTab("team")}>Pracovníci a dvojice</button>
          <button className={tab === "vacation" ? "active" : ""} onClick={() => setTab("vacation")}>Dovolené</button>
        </nav>
        <span className="localBadge"><i /> Uloženo lokálně</span>
      </header>

      <section className="shell">
        {tab === "calendar" && <>
          <div className="pageHeading">
            <div><p className="eyebrow">MĚSÍČNÍ PŘEHLED</p><h1>{MONTHS[month]} <span>{year}</span></h1><p>Automatický cyklus 2 denní · 2 noční · 6 dní volna</p></div>
            <div className="monthControls"><button aria-label="Předchozí měsíc" disabled={isFirstPlannedMonth} onClick={() => moveMonth(-1)}>←</button><button onClick={() => { setYear(initialMonth.getFullYear()); setMonth(initialMonth.getMonth()); }}>Dnes</button><button aria-label="Další měsíc" onClick={() => moveMonth(1)}>→</button></div>
          </div>

          <div className="stats">
            <article><span className="statIcon sun">☀</span><div><small>Denních směn</small><strong>{daysInMonth}</strong></div></article>
            <article><span className="statIcon moon">☾</span><div><small>Nočních směn</small><strong>{daysInMonth}</strong></div></article>
            <article><span className="statIcon people">♟</span><div><small>Pracovníků</small><strong>{workers.length}</strong></div></article>
            <article className={issues.length ? "warning" : "success"}><span className="statIcon">{issues.length ? "!" : "✓"}</span><div><small>Kontrola pravidel</small><strong>{issues.length ? `${issues.length} upozornění` : "Vše v pořádku"}</strong></div></article>
          </div>

          <div className="contentGrid">
            <section className="calendarCard">
              <div className="legend"><span><i className="dayDot"/>Denní 06:00–18:00</span><span><i className="nightDot"/>Noční 18:00–06:00</span><span><i className="vacDot"/>Dovolená</span><span><i className="holidayDot"/>Státní svátek</span></div>
              <div className="calendar">
                {WEEKDAYS.map((d) => <div className="weekday" key={d}>{d}</div>)}
                {Array.from({ length: leading }).map((_, i) => <div className="dayCell empty" key={`e${i}`} />)}
                {schedule.map((s) => {
                  const vac = workers.filter((w) => isOnVacation(w.id, s.date, vacations));
                  const holiday = HOLIDAYS_2027[s.date];
                  return <div className={`dayCell ${holiday ? "holiday" : ""}`} key={s.date}>
                    <span className="dayNumber">{s.day}</span>
                    {holiday && <div className="holidayLine" title={holiday}>✦ {holiday}</div>}
                    <div className="shift day"><b>☀</b>{s.dayShift.map((x) => <span className={isOnVacation(x.actualId, s.date, vacations) ? "conflict" : ""} key={x.plannedId}>{nameOf(x.actualId)}{x.replaced && <sup>↺</sup>}</span>)}</div>
                    <div className="shift night"><b>☾</b>{s.nightShift.map((x) => <span className={isOnVacation(x.actualId, s.date, vacations) ? "conflict" : ""} key={x.plannedId}>{nameOf(x.actualId)}{x.replaced && <sup>↺</sup>}</span>)}</div>
                    {vac.length > 0 && <div className="vacationLine">Dovolená: {vac.map((v) => nameOf(v.id)).join(", ")}</div>}
                  </div>;
                })}
              </div>
            </section>

            <aside>
              <section className="panel"><div className="panelTitle"><div><p className="eyebrow">RUČNÍ ÚPRAVA</p><h2>Zadat záskok</h2></div><span className="panelIcon">↺</span></div>
                <form onSubmit={addOverride}>
                  <label>Datum<input type="date" min={FIRST_PLANNED_DATE} value={subDate} onChange={(e) => setSubDate(e.target.value)} /></label>
                  <label>Směna<select value={subKind} onChange={(e) => setSubKind(e.target.value as ShiftKind)}><option value="day">Denní 06:00–18:00</option><option value="night">Noční 18:00–06:00</option></select></label>
                  <div className="formRow"><label>Nahrazuje<select value={replaceableWorkers.includes(subAbsent) ? subAbsent : replaceableWorkers[0] ?? ""} onChange={(e) => setSubAbsent(e.target.value)}>{replaceableWorkers.map((id) => <option value={id} key={id}>{nameOf(id)}</option>)}</select></label><label>Zaskakuje<select value={substitute} onChange={(e) => setSubstitute(e.target.value)}>{workers.map((w) => { const protectedLeave = isInVacationProtection(w.id, subDate, vacations); const scheduled = isWorkerScheduled(w.id, subDate, pairs, overrides); const shortRest = hasInsufficientRest(w.id, subDate, subKind, pairs, overrides); const overFive = createsTooManyConsecutiveShifts(w.id, subDate, pairs, overrides, 5); const overSix = createsTooManyConsecutiveShifts(w.id, subDate, pairs, overrides, 6); const blockedSeries = overSix || (overFive && strictManualCandidateExists); return <option value={w.id} disabled={protectedLeave || scheduled || shortRest || blockedSeries} key={w.id}>{w.name}{protectedLeave ? " — chráněné volno" : scheduled ? " — má směnu" : shortRest ? " — méně než 12 h volna" : overSix ? " — více než 6 směn" : overFive ? " — nouzově 6. směna" : ""}</option>; })}</select></label></div>
                  {isInVacationProtection(substitute, subDate, vacations) && <p className="formWarning">Tento pracovník má dovolenou nebo je v období šesti dnů před či po dovolené. Jako záskok ho nelze použít.</p>}
                  {!isInVacationProtection(substitute, subDate, vacations) && isWorkerScheduled(substitute, subDate, pairs, overrides) && <p className="formWarning">Tento pracovník má ve zvolený den naplánovanou směnu nebo jiný záskok.</p>}
                  {!isInVacationProtection(substitute, subDate, vacations) && !isWorkerScheduled(substitute, subDate, pairs, overrides) && hasInsufficientRest(substitute, subDate, subKind, pairs, overrides) && <p className="formWarning">Mezi touto a sousední směnou by nezůstalo minimálně 12 hodin volna. Nelze kombinovat ani noční směnu před denní směnou.</p>}
                  {!isInVacationProtection(substitute, subDate, vacations) && !isWorkerScheduled(substitute, subDate, pairs, overrides) && !hasInsufficientRest(substitute, subDate, subKind, pairs, overrides) && createsTooManyConsecutiveShifts(substitute, subDate, pairs, overrides, 5) && !createsTooManyConsecutiveShifts(substitute, subDate, pairs, overrides, 6) && !strictManualCandidateExists && <p className="fallbackNotice">Nouzová výjimka: pracovník může převzít šestou směnu, protože není dostupný kandidát s nejvýše pěti směnami v řadě.</p>}
                  {!isSubstitutionMonthAllowed(subDate) && <p className="formWarning">V lednu a prosinci se záskoky ani vyrovnávací přesuny neplánují.</p>}
                  {violatesMinimumCycleRest(substitute, subDate, pairs, overrides, subKind) && <p className="formWarning">Záskok nelze uložit: pracovní blok musí odpovídat DDNN, DDDN nebo DNNN.</p>}
                  {isProtectedOriginalHolidayShift(subDate, subKind) && <p className="formWarning">Tuto původně plánovanou směnu nelze zrušit ani nahradit: probíhá ve státní svátek nebo noční směna ve svátek končí.</p>}
                  <button className="primary" type="submit" disabled={!isSubstitutionMonthAllowed(subDate) || isProtectedOriginalHolidayShift(subDate, subKind) || isInVacationProtection(substitute, subDate, vacations) || isWorkerScheduled(substitute, subDate, pairs, overrides) || hasInsufficientRest(substitute, subDate, subKind, pairs, overrides) || violatesMinimumCycleRest(substitute, subDate, pairs, overrides, subKind) || createsTooManyConsecutiveShifts(substitute, subDate, pairs, overrides, 6) || (strictManualCandidateExists && createsTooManyConsecutiveShifts(substitute, subDate, pairs, overrides, 5))}>Uložit záskok</button>
                </form>
              </section>
              <section className="panel"><div className="panelTitle"><div><p className="eyebrow">MĚSÍČNÍ SOUČTY</p><h2>Vytížení pracovníků</h2></div></div>
                <div className="countList">{counts.map((c) => <div key={c.id}><strong>{nameOf(c.id)}</strong><span title="Denní směny"><i className="dayDot"/>{c.day}</span><span title="Noční směny"><i className="nightDot"/>{c.night}</span><span className="monthlySubs" title="Záskoky">Z {c.substitutions}</span><span className="monthlyVacation" title="Dovolená připadající na plánovanou směnu">ŘD {c.vacationShifts}</span><b className={c.total > (month === 1 ? 14 : 16) || c.total < (month === 1 ? 10 : 12) ? "over" : ""}>{c.total}/{month === 1 ? "10–14" : "12–16"}</b></div>)}</div>
              </section>
            </aside>
          </div>
          {issues.length > 0 && <section className="issues"><h2>Upozornění ke směnám</h2>{issues.slice(0, 8).map((issue) => <p key={issue}>⚠ {issue}</p>)}{issues.length > 8 && <small>…a dalších {issues.length - 8}</small>}</section>}
        </>}

        {tab === "year" && <section className="subpage">
          <div className="pageHeading"><div><p className="eyebrow">CELOROČNÍ PLÁN</p><h1>Roční souhrn <span>2027</span></h1><p>D = denní směna nebo záskok · N = noční směna nebo záskok · ŘD = řádná dovolená</p></div><div className="yearActions"><button onClick={() => window.print()}>Vytisknout souhrn</button><button className="primary" onClick={exportAnnualSummaryForExcel}>Export do Excelu</button></div></div>
          <section className="panel yearManualPanel">
            <div className="panelTitle"><div><p className="eyebrow">RUČNÍ ÚPRAVA</p><h2>Změnit obsazení směny</h2></div><span className="panelIcon">↺</span></div>
            <form className="yearManualForm" onSubmit={addOverride}>
              <label>Datum<input type="date" min={FIRST_PLANNED_DATE} max="2027-12-31" value={subDate} onChange={(e) => setSubDate(e.target.value)}/></label>
              <label>Směna<select value={subKind} onChange={(e) => setSubKind(e.target.value as ShiftKind)}><option value="day">Denní 06:00–18:00</option><option value="night">Noční 18:00–06:00</option></select></label>
              <label>Nahrazuje<select value={replaceableWorkers.includes(subAbsent) ? subAbsent : replaceableWorkers[0] ?? ""} onChange={(e) => setSubAbsent(e.target.value)}>{replaceableWorkers.map((id) => <option value={id} key={id}>{nameOf(id)}</option>)}</select></label>
              <label>Zaskakuje<select value={substitute} onChange={(e) => setSubstitute(e.target.value)}>{workers.map((worker) => { const blocked = worker.id === subAbsent || isInVacationProtection(worker.id, subDate, vacations) || isWorkerScheduled(worker.id, subDate, pairs, overrides) || hasInsufficientRest(worker.id, subDate, subKind, pairs, overrides) || createsTooManyConsecutiveShifts(worker.id, subDate, pairs, overrides, 6); return <option value={worker.id} disabled={blocked} key={worker.id}>{worker.name}{blocked ? " — nelze použít" : ""}</option>; })}</select></label>
              <button className="primary" type="submit" disabled={!isSubstitutionMonthAllowed(subDate) || isProtectedOriginalHolidayShift(subDate, subKind) || subAbsent === substitute || isInVacationProtection(substitute, subDate, vacations) || isWorkerScheduled(substitute, subDate, pairs, overrides) || hasInsufficientRest(substitute, subDate, subKind, pairs, overrides) || violatesMinimumCycleRest(substitute, subDate, pairs, overrides, subKind) || createsTooManyConsecutiveShifts(substitute, subDate, pairs, overrides, 6) || (strictManualCandidateExists && createsTooManyConsecutiveShifts(substitute, subDate, pairs, overrides, 5))}>Uložit změnu</button>
            </form>
            {isProtectedOriginalHolidayShift(subDate, subKind) && <p className="formWarning yearManualWarning">Původní směnu nelze změnit, protože probíhá ve státní svátek nebo ve svátek končí.</p>}
            {!isSubstitutionMonthAllowed(subDate) && <p className="formWarning yearManualWarning">V lednu a prosinci se změny obsazení neplánují.</p>}
          </section>
          <section className="panel yearManualPanel">
            <div className="panelTitle"><div><p className="eyebrow">RUČNÍ VÝMĚNA</p><h2>Prohodit D za N</h2></div><span className="panelIcon">⇄</span></div>
            <form className="yearManualForm swapManualForm" onSubmit={swapDayAndNight}>
              <label>Datum<input type="date" min={FIRST_PLANNED_DATE} max="2027-12-31" value={swapDate} onChange={(e) => setSwapDate(e.target.value)} /></label>
              <label>Denní pracovník<select value={swapDayWorker} onChange={(e) => setSwapDayWorker(e.target.value)}>{swapDayWorkers.map((item) => <option value={item.actualId} key={`${item.plannedId}-${item.actualId}`}>{nameOf(item.actualId)}</option>)}</select></label>
              <label>Noční pracovník<select value={swapNightWorker} onChange={(e) => setSwapNightWorker(e.target.value)}>{swapNightWorkers.map((item) => <option value={item.actualId} key={`${item.plannedId}-${item.actualId}`}>{nameOf(item.actualId)}</option>)}</select></label>
              <p className="swapHint">Vybraní pracovníci si ve stejném dni vzájemně vymění denní a noční směnu.</p>
              <button className="primary" type="submit" disabled={!swapDayWorker || !swapNightWorker || swapDayWorker === swapNightWorker || !isSubstitutionMonthAllowed(swapDate) || isProtectedOriginalHolidayShift(swapDate, "day") || isProtectedOriginalHolidayShift(swapDate, "night")}>Prohodit směny</button>
            </form>
            {!isSubstitutionMonthAllowed(swapDate) && <p className="formWarning yearManualWarning">V lednu a prosinci jsou ruční výměny uzamčené.</p>}
            {(isProtectedOriginalHolidayShift(swapDate, "day") || isProtectedOriginalHolidayShift(swapDate, "night")) && <p className="formWarning yearManualWarning">Směny chráněné svátkem nelze prohodit.</p>}
          </section>
          {editingShift && <div className="shiftEditBackdrop" role="presentation" onMouseDown={() => setEditingShift(null)}>
            <section className="shiftEditDialog" role="dialog" aria-modal="true" aria-labelledby="shift-edit-title" onMouseDown={(event) => event.stopPropagation()}>
              <div className="panelTitle"><div><p className="eyebrow">ZMĚNA PŘÍMO V TABULCE</p><h2 id="shift-edit-title">{editingShift.date.split("-").reverse().join(".")} · {editingShift.kind === "day" ? "denní" : "noční"}</h2></div><button className="dialogClose" type="button" aria-label="Zavřít" onClick={() => setEditingShift(null)}>×</button></div>
              <p className="dialogDescription">Nahrazovaný pracovník: <strong>{nameOf(editingShift.absentId)}</strong>{editingManualOverride && <> · ručně zadaný záskok: <strong>{nameOf(editingManualOverride.substituteId)}</strong></>}</p>
              <form onSubmit={addOverride}>
                <label>Náhradník<select value={substitute} onChange={(event) => setSubstitute(event.target.value)}>{workers.map((worker) => <option value={worker.id} disabled={tableEditBlocked(worker.id)} key={worker.id}>{worker.name}{tableEditBlocked(worker.id) ? " — nelze použít" : ""}</option>)}</select></label>
                {isProtectedOriginalHolidayShift(subDate, subKind) && <p className="formWarning">Tato původní směna je chráněná jako sváteční a nelze ji změnit.</p>}
                {!isSubstitutionMonthAllowed(subDate) && <p className="formWarning">V lednu a prosinci se změny obsazení neplánují.</p>}
                <div className="dialogActions">{editingManualOverride && <button className="undoOverrideButton" type="button" onClick={removeEditingManualOverride}>Vrátit původní směnu</button>}<button type="button" onClick={() => setEditingShift(null)}>Zrušit</button><button className="primary" type="submit" disabled={!isSubstitutionMonthAllowed(subDate) || isProtectedOriginalHolidayShift(subDate, subKind) || tableEditBlocked(substitute)}>Uložit změnu</button></div>
              </form>
            </section>
          </div>}
          <section className="panel yearPanel">
            <div className="yearLegend"><span><i className="dayDot"/>D Denní</span><span><i className="nightDot"/>N Noční</span><span><i className="subDayDot"/>D Záskok denní</span><span><i className="subNightDot"/>N Záskok noční</span><span><i className="vacDot"/>ŘD Dovolená</span><span><i className="holidayDot"/>Státní svátek</span></div>
            <div className="monthlyTables">
              {MONTHS.map((monthName, monthIndex) => {
                const monthDays = yearSummary.days.map((day, index) => ({ ...day, yearIndex: index })).filter((day) => day.date.getMonth() === monthIndex);
                return <section className="monthSummary" key={monthName}>
                  <h2>{monthName} 2027</h2>
                  <div className="monthTableScroller"><table className="yearTable">
                    <thead><tr><th className="workerColumn">Pracovník</th><th className="rowTypeColumn">Přehled</th>{monthDays.map((day) => <th title={HOLIDAYS_2027[day.dateString]} className={`${day.date.getDay() === 0 || day.date.getDay() === 6 ? "weekend" : ""} ${HOLIDAYS_2027[day.dateString] ? "holidayColumn" : ""}`} key={day.dateString}><span>{day.date.getDate()}.</span><small>{WEEKDAYS[(day.date.getDay() + 6) % 7]}</small></th>)}</tr></thead>
                    <tbody>{yearSummary.rows.map((row) => <Fragment key={row.worker.id}>
                      <tr className="planRow"><th className="workerColumn" rowSpan={2}>{(() => { const shiftCount = monthDays.filter((day) => Boolean(row.planMarks[day.yearIndex])).length; const vacationCount = monthDays.filter((day) => row.vacationMarks[day.yearIndex] === "ŘD").length; return <><span className="workerName">{row.worker.name}</span><small className="workerMonthlyTotal">Směny {shiftCount} · ŘD {vacationCount} · Celkem {shiftCount + vacationCount}</small></>; })()}</th><th className="rowTypeColumn">Plán směn</th>{monthDays.map((day) => { const mark = row.planMarks[day.yearIndex]; const displayedMark = mark === "ZD" ? "D" : mark === "ZN" ? "N" : mark; const kind = mark === "D" || mark === "ZD" ? "day" : "night"; return <td className={`${mark === "D" ? "markDay" : mark === "N" ? "markNight" : mark === "ZD" ? "markSubDay" : mark === "ZN" ? "markSubNight" : ""} ${day.date.getDay() === 0 || day.date.getDay() === 6 ? "weekend" : ""} ${HOLIDAYS_2027[day.dateString] ? "holidayColumn" : ""}`} key={day.dateString}>{displayedMark && <button className="shiftCellButton" title="Kliknutím změnit obsazení směny" onClick={() => openTableShiftEditor(day.dateString, kind, row.worker.id)}>{displayedMark}</button>}</td>; })}</tr>
                      <tr className="vacationRow"><th className="rowTypeColumn">Dovolená</th>{monthDays.map((day) => { const mark = row.vacationMarks[day.yearIndex]; return <td className={`${mark === "ŘD" ? "markVacation" : ""} ${day.date.getDay() === 0 || day.date.getDay() === 6 ? "weekend" : ""} ${HOLIDAYS_2027[day.dateString] ? "holidayColumn" : ""}`} key={day.dateString}>{mark}</td>; })}</tr>
                    </Fragment>)}</tbody>
                  </table></div>
                </section>;
              })}
            </div>
          </section>
        </section>}

        {tab === "balance" && <section className="subpage">
          <div className="pageHeading"><div><p className="eyebrow">PLÁNOVACÍ KALENDÁŘ 2027</p><h1>Vyrovnávací <span>období</span></h1><p>Nepřetržitý provoz · 37,5 hodiny týdně · 7,5 hodiny na plánovací den</p></div></div>
          <div className="periodTabs">
            {BALANCING_PERIODS.map((period) => <button className={selectedPeriod === period.id ? "active" : ""} key={period.id} onClick={() => setSelectedPeriod(period.id)}><strong>{period.label}</strong><small>{period.range}</small></button>)}
            <button className={selectedPeriod === "year" ? "active" : ""} onClick={() => setSelectedPeriod("year")}><strong>Roční souhrn</strong><small>1. 1. – 31. 12. 2027</small></button>
          </div>
          {BALANCING_PERIODS.filter((period) => period.id === selectedPeriod).map((period) => <div key={period.id}>
            <div className="stats balanceStats">
              <article><span className="statIcon people">▦</span><div><small>Plánovací dny</small><strong>{period.workDays}</strong></div></article>
              <article><span className="statIcon sun">7,5</span><div><small>Fond období</small><strong>{String(period.targetHours).replace(".", ",")} h</strong></div></article>
              <article><span className="statIcon moon">✦</span><div><small>Svátky v pracovních dnech</small><strong>{period.holidayDays} započteno</strong></div></article>
              <article className="success"><span className="statIcon">24/7</span><div><small>Režim</small><strong>Nepřetržitý</strong></div></article>
            </div>
            <section className="panel balancePanel">
              <div className="panelTitle"><div><p className="eyebrow">BILANCE PRACOVNÍKŮ</p><h2>{period.label}</h2></div><p className="balanceNote">Jedna naplánovaná směna = 12 hodin</p></div>
              <div className="balanceTable">
                <div className="balanceHead balanceHeadHolidays"><span>Pracovník</span><span>Denní</span><span>Noční</span><span>Z denní</span><span>Z noční</span><span>Σ zás.</span><span>ŘD směny</span><span>Sv. denní</span><span>Sv. noční</span><span>Vík. denní</span><span>Vík. noční</span><span>Směny</span><span>Běžné H</span><span>Záskok H</span><span>Dovolená H</span><span>Celkem H</span><span>Plán H</span><span>Rozdíl H</span></div>
                {balancingCounts.map((item) => <div className="balanceRow balanceRowHolidays" key={item.id}><strong>{item.name}</strong><span>{item.day}</span><span>{item.night}</span><span className="substitutionCount">{item.substitutionDay}</span><span className="substitutionCount">{item.substitutionNight}</span><span className="substitutionCount">{item.substitutions}</span><span className="vacationHours">{item.vacationShifts}</span><span className="holidayCount">{item.holidayDay}</span><span className="holidayCount">{item.holidayNight}</span><span className="weekendCount">{item.weekendDay}</span><span className="weekendCount">{item.weekendNight}</span><span>{item.shifts}</span><span>{item.regularHours} h</span><span className="substitutionCount">+{item.substitutionHours} h</span><span className="vacationHours">+{item.vacationHours} h</span><span className="totalHours">{item.hours} h</span><span>{String(period.targetHours).replace(".", ",")} h</span><b className={item.difference < 0 ? "negative" : item.difference > 0 ? "positive" : "equal"}>{item.difference > 0 ? "+" : ""}{String(item.difference).replace(".", ",")} h</b></div>)}
              </div>
              <p className="calculationInfo"><strong>Výpočet rozdílu:</strong> Běžné H + Záskok H + Dovolená H = Celkem H; Celkem H − Plán H = Rozdíl H. Každý záskok a každý den dovolené připadající na plánovanou směnu přidává 12 hodin.</p>
            </section>
          </div>)}
          {selectedPeriod === "year" && <section className="panel annualBalancePanel">
            <div className="panelTitle"><div><p className="eyebrow">CELKOVÁ BILANCE PRACOVNÍKŮ</p><h2>Roční souhrn 2027</h2><p className="balanceNote">Součet obou vyrovnávacích období · svátky rozdělené na denní a noční</p></div><div className="balancePrintActions"><button className="printButton" onClick={() => window.print()}>Tisk</button><button className="primary autoPlanButton" onClick={exportAnnualBalanceForExcel}>Export do Excelu</button></div></div>
            <div className="annualBalanceTable">
              <div className="annualBalanceHead"><span>Pracovník</span><span>1. pol. H</span><span>1. pol. rozdíl</span><span>2. pol. H</span><span>2. pol. rozdíl</span><span>Denní</span><span>Noční</span><span>Záskoky</span><span>ŘD směny</span><span>Sv. denní</span><span>Sv. noční</span><span>Vík. denní</span><span>Vík. noční</span><span>Celkem H</span><span>Roční rozdíl</span></div>
              {annualBalanceCounts.map((item) => <div className="annualBalanceRow" key={item.id}><strong>{item.name}</strong><span>{item.first.hours} h</span><b className={item.first.difference < 0 ? "negative" : item.first.difference > 0 ? "positive" : "equal"}>{item.first.difference > 0 ? "+" : ""}{String(item.first.difference).replace(".", ",")} h</b><span>{item.second.hours} h</span><b className={item.second.difference < 0 ? "negative" : item.second.difference > 0 ? "positive" : "equal"}>{item.second.difference > 0 ? "+" : ""}{String(item.second.difference).replace(".", ",")} h</b><span>{item.day}</span><span>{item.night}</span><span className="substitutionCount">{item.substitutions}</span><span className="vacationHours">{item.vacationShifts}</span><span className="holidayCount">{item.holidayDay}</span><span className="holidayCount">{item.holidayNight}</span><span className="weekendCount">{item.weekendDay}</span><span className="weekendCount">{item.weekendNight}</span><span className="totalHours">{item.hours} h</span><b className={item.difference < 0 ? "negative" : item.difference > 0 ? "positive" : "equal"}>{item.difference > 0 ? "+" : ""}{String(item.difference).replace(".", ",")} h</b></div>)}
            </div>
            <p className="calculationInfo"><strong>Roční rozdíl:</strong> součet rozdílu prvního a druhého pololetí. Služby ve svátek i o víkendu zahrnují skutečně obsazené denní a noční směny včetně záskoků; víkendové svátky jsou započteny v obou příslušných přehledech.</p>
          </section>}
          <section className="panel christmasDutyPanel">
            <div className="panelTitle"><div><p className="eyebrow">VÁNOČNÍ SVÁTKY 2026–2037</p><h2>Přehled služeb pracovníků</h2><p className="balanceNote">Štědrý den, 1. svátek vánoční a 2. svátek vánoční · denní a noční služby</p></div><button className="printButton" onClick={() => window.print()}>Tisk</button></div>
            <div className="christmasDutyTable">
              <div className="christmasDutyHead"><span>Rok</span><span>Datum</span><span>Den</span><span>Denní služba</span><span>Noční služba</span></div>
              {christmasDutyOverview.flatMap((item) => item.days.map((holiday, dayIndex) => <div className="christmasDutyRow" key={holiday.dateString}><strong>{dayIndex === 0 ? item.year : ""}</strong><span>{holiday.day}. 12.</span><span>{holiday.weekday}</span><span className="christmasDayDuty">{holiday.dayWorkers.map(nameOf).join(" · ")}</span><span className="christmasNightDuty">{holiday.nightWorkers.map(nameOf).join(" · ")}</span></div>))}
            </div>
            <div className="christmasTotals">
              <h3>Celkový počet vánočních směn 2026–2037</h3>
              <div className="christmasTotalsHead"><span>Pracovník</span><span>Denní</span><span>Noční</span><span>Celkem</span></div>
              {christmasDutyTotals.map((item) => <div className="christmasTotalsRow" key={item.worker.id}><strong>{item.worker.name}</strong><span className="christmasDayTotal">{item.day}</span><span className="christmasNightTotal">{item.night}</span><b>{item.total}</b></div>)}
            </div>
            <p className="calculationInfo"><strong>Výpočet:</strong> rok 2027 zobrazuje skutečné obsazení včetně ručních změn. Rok 2026 a roky 2028–2037 jsou projekcí podle aktuálního cyklu a nastavení stálých dvojic.</p>
          </section>
          <section className="panel christmasSimulationPanel">
            <div className="panelTitle"><div><p className="eyebrow">SIMULACE ROVNOMĚRNÉ ROTACE</p><h2>Vánoční služby po 2–3 letech</h2><p className="balanceNote">Samostatný návrh · nemění skutečný plán směn</p></div><button className="printButton" onClick={() => window.print()}>Tisk simulace</button></div>
            <div className="simulationNotice"><strong>Proč ne přesně jednou za 3 roky?</strong><span>Každý rok musí sloužit dvě dvojice. Za 12 let je proto potřeba 24 vánočních bloků, ale při přesné tříleté rotaci by pět dvojic pokrylo pouze 20 bloků. Nejbližší rovnoměrné řešení vrací dvojice po 2–3 letech.</span></div>
            <div className="christmasSimulationGrid">
              <div className="christmasSimulationTable">
                <div className="christmasSimulationHead"><span>Rok</span><span>Denní 24.–26. 12.</span><span>Noční 24.–26. 12.</span></div>
                {christmasRotationSimulation.map((item) => <div className="christmasSimulationRow" key={item.year}><strong>{item.year}</strong><span className="christmasDayDuty">{item.dayPair.members.map(nameOf).join(" · ")}</span><span className="christmasNightDuty">{item.nightPair.members.map(nameOf).join(" · ")}</span></div>)}
              </div>
              <div className="christmasRotationTotals">
                <h3>Kontrola rotace dvojic</h3>
                <div className="christmasRotationHead"><span>Dvojice</span><span>D bloky</span><span>N bloky</span><span>Celkem</span><span>Rozestup</span></div>
                {christmasRotationTotals.map((item) => <div className="christmasRotationRow" key={item.pair.id}><strong>{item.pair.members.map(nameOf).join(" · ")}</strong><span>{item.dayYears.length}</span><span>{item.nightYears.length}</span><b>{item.total}</b><span>{item.gap}</span></div>)}
              </div>
            </div>
          </section>
        </section>}

        {tab === "team" && <section className="subpage"><div className="pageHeading"><div><p className="eyebrow">NASTAVENÍ TÝMU</p><h1>Pracovníci <span>a dvojice</span></h1><p>Upravte zobrazovaná jména a složení pěti stálých dvojic.</p></div></div>
          <div className="teamGrid"><section className="panel"><h2>Pracovníci</h2>{workers.map((worker) => <label className="workerEdit" key={worker.id}><span>{worker.id}</span><input value={worker.name} onChange={(e) => setWorkers((all) => all.map((w) => w.id === worker.id ? { ...w, name: e.target.value } : w))}/></label>)}</section>
          <section className="panel"><h2>Dvojice</h2>{pairs.map((pair, index) => <div className="pairEdit" key={pair.id}><b>Dvojice {index + 1}</b>{[0,1].map((slot) => <select key={slot} value={pair.members[slot]} onChange={(e) => setPairs((all) => all.map((p) => p.id === pair.id ? { ...p, members: slot === 0 ? [e.target.value, p.members[1]] : [p.members[0], e.target.value] } : p))}>{workers.map((w) => <option value={w.id} key={w.id}>{w.name}</option>)}</select>)}</div>)}</section></div>
        </section>}

        {tab === "vacation" && <section className="subpage vacationPrintPage"><div className="pageHeading"><div><p className="eyebrow">NEPŘÍTOMNOSTI</p><h1>Evidence <span>dovolených</span></h1><p>Dovolená se ihned promítne do kalendáře a kontroly pravidel.</p></div></div>
          <div className="teamGrid vacationEntryPanels"><section className="panel"><h2>Přidat dovolenou</h2><form onSubmit={addVacation}><label>Pracovník<select value={vacationWorker} onChange={(e) => setVacationWorker(e.target.value)}>{workers.map((w) => <option value={w.id} key={w.id}>{w.name}</option>)}</select></label><div className="formRow"><label>Od<input type="date" min={FIRST_PLANNED_DATE} value={vacationFrom} onChange={(e) => setVacationFrom(e.target.value)}/></label><label>Do<input type="date" min={FIRST_PLANNED_DATE} value={vacationTo} onChange={(e) => setVacationTo(e.target.value)}/></label></div><button className="primary" type="submit">Přidat dovolenou</button></form></section>
          <section className="panel"><h2>Naplánované dovolené</h2>{vacations.length === 0 ? <p className="muted">Zatím není zadaná žádná dovolená.</p> : vacations.map((v) => <div className="vacationItem" key={v.id}><span><strong>{nameOf(v.workerId)}</strong><small>{v.from} — {v.to}</small></span><button onClick={() => setVacations((all) => all.filter((x) => x.id !== v.id))}>Odstranit</button></div>)}</section></div>
          <section className="panel vacationSummaryPanel"><div className="panelTitle"><div><p className="eyebrow">ROK 2027</p><h2>Souhrn dovolených podle pracovníků</h2></div><div className="vacationPrintActions"><button className="printButton" onClick={exportDataBackup}>Stáhnout zálohu dat</button><label className="importButton">Načíst zálohu<input type="file" accept="application/json,.json" onChange={importDataBackup}/></label><button className="printButton" onClick={() => window.print()}>Tisk</button><button className="primary autoPlanButton" onClick={automaticallyPlanSubstitutions}>Naplánovat záskoky a vyrovnat hodiny</button></div></div>
            {plannerMessage && <p className="plannerMessage">✓ {plannerMessage}</p>}
            <div className="vacationSummaryTable">
              <div className="vacationSummaryHead"><span>Pracovník</span><span>Počet termínů</span><span>Kalendářní dny</span><span>Naplánovaná období</span></div>
              {vacationSummary.map((item) => <div className="vacationSummaryRow" key={item.worker.id}><strong>{item.worker.name}</strong><span>{item.entries.length}</span><b>{item.days}</b><div>{item.entries.length ? item.entries.map((entry) => <small key={entry.id}>{entry.from.split("-").reverse().join(".")} – {entry.to.split("-").reverse().join(".")}</small>) : <em>Bez naplánované dovolené</em>}</div></div>)}
            </div>
          </section>
        </section>}
      </section>
    </main>
  );
}

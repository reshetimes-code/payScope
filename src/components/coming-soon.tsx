// Shared placeholder for routes not yet implemented past the scaffold stage.
// Every route in spec §23 exists as a real page from day one — even before
// its data layer is wired up — so the navigation structure and Phase 1 scope
// stay honest about what's built vs. pending.

export function ComingSoon({ title, phase }: { title: string; phase: string }) {
  return (
    <main className="p-8">
      <h1 className="page-title">{title}</h1>
      <p className="mt-2 text-sm text-stone-400">
        מסך זה עדיין לא מומש — מתוכנן ל-{phase}.
      </p>
    </main>
  );
}

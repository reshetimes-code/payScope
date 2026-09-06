import type { ReactNode } from 'react';

export type TableCell = {
  /** Column header text — shown as the label next to this value once the
      row is expanded on phone. */
  header: string;
  content: ReactNode;
  /** Stays visible in the collapsed summary line on phone; everything else
      only shows once the row is tapped open. Pick 1-2 columns max, or the
      summary line stops being a summary. */
  primary?: boolean;
  className?: string;
};

/**
 * One data row that renders as a normal <tr> of <td>s on desktop, and as a
 * native <details>/<summary> dropdown on phone — for tables with too many
 * columns to read comfortably on a small screen (owner request: "every
 * table with long columns needs a dropdown on the phone version", instead
 * of the horizontal-scroll fallback .card-table gives everything else).
 * No client JS needed — <details> handles the open/close state natively.
 *
 * Renders a Fragment of two <tr>s (one per breakpoint) — valid inside a
 * <tbody>, which only requires a table-row-group ancestor for its <tr>s,
 * not that each <tr> be a literal direct child in the JSX tree.
 */
export function TableRow({ cells }: { cells: TableCell[] }) {
  const primaryCells = cells.filter((c) => c.primary);
  const secondaryCells = cells.filter((c) => !c.primary);

  return (
    <>
      <tr className="hidden border-t border-stone-800 align-top md:table-row">
        {cells.map((cell, i) => (
          <td key={i} className={`p-3 ${cell.className ?? ''}`}>
            {cell.content}
          </td>
        ))}
      </tr>

      <tr className="border-t border-stone-800 md:hidden">
        <td colSpan={cells.length} className="p-0">
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3 text-sm transition-colors hover:bg-stone-800/40 [&::-webkit-details-marker]:hidden">
              <span className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                {primaryCells.map((cell, i) => (
                  <span key={i} className={cell.className}>
                    {cell.content}
                  </span>
                ))}
              </span>
              <svg
                className="h-4 w-4 shrink-0 text-stone-500 transition-transform group-open:rotate-180"
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M4 6l4 4 4-4"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </summary>
            <div className="space-y-2 bg-stone-950/40 px-3 pb-3 pt-1">
              {secondaryCells.map((cell, i) => (
                <div key={i} className="flex items-start justify-between gap-3 text-sm">
                  <span className="shrink-0 text-xs font-medium text-stone-500">{cell.header}</span>
                  <span className={cell.className}>{cell.content}</span>
                </div>
              ))}
            </div>
          </details>
        </td>
      </tr>
    </>
  );
}

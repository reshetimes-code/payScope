import { prisma } from '@/lib/db/prisma';
import { RenderInvoiceForm } from './form';

export const dynamic = 'force-dynamic';

// Owner request: a recurring monthly Render invoice, same page as the
// Google one — but Render has no cost API at all, so this is where the
// owner types in that month's numbers straight from Render's own
// Invoice History → [month] page (Billing → Invoice History in their
// dashboard). Pre-fills the row names from whatever Render discovery
// already found, so it's amounts-only most months.
export default async function NewRenderInvoicePage() {
  const services = await prisma.providerResource.findMany({
    where: { connection: { provider: 'RENDER' }, resourceType: 'render_service' },
    orderBy: { displayName: 'asc' },
    select: { displayName: true },
  });

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      <div>
        <h1 className="page-title">חשבונית Render חדשה</h1>
        <p className="mt-1 text-sm text-stone-400">
          תעתיק את הסכומים מ-Render Dashboard → Billing → Invoice History → החודש הרלוונטי
          (עמוד "Usage for [Month], [Year]", סעיף Services + Datastores). לא נתון חי — זה
          מוזן ידנית כי ל-Render אין API לעלויות.
        </p>
      </div>

      <RenderInvoiceForm defaultServiceNames={services.map((s) => s.displayName)} />
    </main>
  );
}

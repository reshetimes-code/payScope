// One-off admin script: maps every remaining discovered GCP project to its
// own ManagedApp, skipping projects that are clearly not real customer
// sites (GCP/Gemini default placeholder projects, and "junk twin" duplicate
// projects alongside a clean same-named one — left unmapped for manual
// review/deletion rather than guessed).
import { prisma } from '../src/lib/db/prisma';

const SKIP_EXTERNAL_IDS = new Set([
  'gen-lang-client-0729343192', // Default Gemini Project
  'gen-lang-client-0552215159', // Gemini Project
  'gen-lang-client-0773047016', // "silver-8-26" — another stray Gemini/AI Studio project, not the real silver project
  'project-7d70dca4-54f8-4a95-929', // My First Project
  'project-098744fa-c17a-4f72-bc2', // My First Project
  'eilatimes-a7884', // duplicate of "eilatimes" — keeping the clean one
  'bmtechweb-9d2f7', // duplicate of "bmtechweb"
  'harelbar-ca7dd', // duplicate of "harelbar"
]);

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || Math.random().toString(36).slice(2, 10)
  );
}

async function main() {
  // Fix the one bad name from earlier manual entry (URL typed into the name field).
  const badApp = await prisma.managedApp.findFirst({ where: { name: 'https://mishpatly.co.il/' } });
  if (badApp) {
    await prisma.managedApp.update({
      where: { id: badApp.id },
      data: { name: 'Mishpatly', domain: badApp.domain ?? 'mishpatly.co.il' },
    });
    console.log('Fixed name: "https://mishpatly.co.il/" -> "Mishpatly"');
  }

  const unmapped = await prisma.providerResource.findMany({
    where: { resourceType: 'gcp_project', appMappings: { none: {} } },
  });

  const created: string[] = [];
  const skipped: string[] = [];

  for (const resource of unmapped) {
    if (SKIP_EXTERNAL_IDS.has(resource.externalResourceId)) {
      skipped.push(`${resource.displayName} (${resource.externalResourceId}) — לא אתר לקוח אמיתי, לא נוצר`);
      continue;
    }

    const baseSlug = slugify(resource.displayName);
    let slug = baseSlug;
    let suffix = 1;
    while (await prisma.managedApp.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${++suffix}`;
    }

    const app = await prisma.managedApp.create({
      data: { name: resource.displayName, slug },
    });

    await prisma.appResourceMapping.create({
      data: {
        managedAppId: app.id,
        providerResourceId: resource.id,
        allocationMode: 'FULL',
        confidence: 'EXACT',
      },
    });

    await prisma.costRecord.updateMany({
      where: { providerResourceId: resource.id },
      data: { managedAppId: app.id },
    });

    created.push(`${resource.displayName} (${resource.externalResourceId}) -> site "${app.name}"`);
  }

  console.log(`\nCreated ${created.length} sites:`);
  created.forEach((line) => console.log('  ' + line));
  console.log(`\nSkipped ${skipped.length} non-site projects (left for manual review):`);
  skipped.forEach((line) => console.log('  ' + line));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

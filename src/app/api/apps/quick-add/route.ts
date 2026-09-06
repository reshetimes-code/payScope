import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/log';

// "Type a URL, get a site" — extracts a candidate name from the domain and
// fuzzy-matches it against already-discovered, unmapped Google Cloud
// projects (by naming convention, e.g. mishpatly.co.il ↔ project
// "mishpatly"). This is a convenience layer over the existing manual
// create+map flow (POST /api/apps + POST /api/apps/:id/mappings), not a new
// data source — it still only auto-creates a FULL/EXACT mapping when
// exactly one project name plausibly matches, never a guess among several.
const bodySchema = z.object({ url: z.string().min(1) });

function extractCandidateSlug(rawUrl: string): { slug: string; domain: string } {
  let domain = rawUrl.trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '');
  domain = domain.split('/')[0] ?? domain;

  // Strip the TLD (and common second-level TLDs like .co.il) to get a bare
  // name candidate: "mishpatly.co.il" -> "mishpatly", "silver.com" -> "silver".
  const labels = domain.split('.');
  const slug = labels.length > 1 ? labels[0]! : domain;

  return { slug, domain };
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'כתובת אתר נדרשת' }, { status: 400 });
  }

  const { slug, domain } = extractCandidateSlug(parsed.data.url);
  const correlationId = randomUUID();

  const unmapped = await prisma.providerResource.findMany({
    where: { resourceType: 'gcp_project', appMappings: { none: {} } },
    select: { id: true, displayName: true, externalResourceId: true },
  });

  const matches = unmapped.filter((r) => {
    const name = r.displayName.toLowerCase();
    const id = r.externalResourceId.toLowerCase();
    return name.includes(slug) || id.includes(slug) || slug.includes(name) || slug.includes(id);
  });

  if (matches.length === 0) {
    return NextResponse.json({
      result: 'none',
      slug,
      message: `לא נמצא פרויקט Google Cloud שהשם שלו דומה ל-"${slug}". אפשר למפות ידנית ב-/apps.`,
    });
  }

  if (matches.length > 1) {
    return NextResponse.json({
      result: 'ambiguous',
      slug,
      candidates: matches,
      message: `נמצאו כמה פרויקטים שיכולים להתאים ל-"${slug}" — צריך לבחור ידנית.`,
    });
  }

  // Exactly one match — safe to auto-create + auto-map (spec §2 "FULL" mode
  // requires this kind of confidence; anything less ambiguous stays manual).
  try {
    const match = matches[0]!;
    const baseSlug = slug.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || randomUUID().slice(0, 8);
    let appSlug = baseSlug;
    let suffix = 1;
    while (await prisma.managedApp.findUnique({ where: { slug: appSlug } })) {
      appSlug = `${baseSlug}-${++suffix}`;
    }

    const app = await prisma.managedApp.create({
      data: { name: slug, slug: appSlug, domain },
    });

    const mapping = await prisma.appResourceMapping.upsert({
      where: { managedAppId_providerResourceId: { managedAppId: app.id, providerResourceId: match.id } },
      create: {
        managedAppId: app.id,
        providerResourceId: match.id,
        allocationMode: 'FULL',
        confidence: 'EXACT',
      },
      update: { allocationMode: 'FULL', confidence: 'EXACT' },
    });

    await prisma.costRecord.updateMany({
      where: { providerResourceId: match.id },
      data: { managedAppId: app.id },
    });

    await writeAuditLog({
      actorLabel: session.user.email,
      action: 'app.quickAdd',
      resource: match.externalResourceId,
      newValue: { app, mapping },
      result: 'SUCCESS',
      requestCorrelationId: correlationId,
    });

    return NextResponse.json({ result: 'matched', app, matchedProject: match });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'יצירת האתר נכשלה';
    await writeAuditLog({
      actorLabel: session.user.email,
      action: 'app.quickAdd',
      result: 'FAILURE',
      errorSummary: message,
      requestCorrelationId: correlationId,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

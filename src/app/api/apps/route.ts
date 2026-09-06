import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/log';

// Deliberately ASCII-only, not a Hebrew transliteration — slug just needs to
// be a stable, URL-safe unique key. A Hebrew-only name falls through to the
// random fallback below, which is fine: nothing in the UI routes by slug
// today, only by ManagedApp.id.
function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function GET() {
  const apps = await prisma.managedApp.findMany({
    include: { resourceMappings: { include: { providerResource: true } } },
    orderBy: { name: 'asc' },
  });

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const costs = await prisma.costRecord.groupBy({
    by: ['managedAppId'],
    where: { usageDate: { gte: monthStart }, managedAppId: { not: null } },
    _sum: { netCost: true },
  });
  const costByApp = new Map(costs.map((c) => [c.managedAppId, c._sum.netCost]));

  return NextResponse.json({
    apps: apps.map((app) => ({
      id: app.id,
      name: app.name,
      slug: app.slug,
      domain: app.domain,
      active: app.active,
      mappedResourceCount: app.resourceMappings.length,
      monthToDateNetCost: Number(costByApp.get(app.id) ?? 0),
    })),
  });
}

const createSchema = z.object({
  name: z.string().min(1),
  domain: z.string().optional(),
  ownerLabel: z.string().optional(),
});

// Spec §12/§17 step 5 — "Create site" so a discovered project has somewhere
// to be mapped to. Slug is derived, not user-entered, so it always matches
// the routing-safe value the rest of the app relies on.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const correlationId = randomUUID();
  const baseSlug = slugify(parsed.data.name) || randomUUID().slice(0, 8);

  try {
    let slug = baseSlug;
    let suffix = 1;
    while (await prisma.managedApp.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${++suffix}`;
    }

    const app = await prisma.managedApp.create({
      data: {
        name: parsed.data.name,
        slug,
        domain: parsed.data.domain,
        ownerLabel: parsed.data.ownerLabel,
      },
    });

    await writeAuditLog({
      actorLabel: session.user.email,
      action: 'app.create',
      resource: app.id,
      newValue: app,
      result: 'SUCCESS',
      requestCorrelationId: correlationId,
    });

    return NextResponse.json({ app }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create app';
    await writeAuditLog({
      actorLabel: session.user.email,
      action: 'app.create',
      result: 'FAILURE',
      errorSummary: message,
      requestCorrelationId: correlationId,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

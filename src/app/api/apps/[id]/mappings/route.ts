import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/log';

const bodySchema = z.object({
  providerResourceId: z.string().uuid(),
  allocationMode: z.enum(['FULL', 'PERCENTAGE', 'LABELS', 'CUSTOM_RULE']).default('FULL'),
  allocationPercent: z.number().min(0).max(100).optional(),
});

// Spec §17 step 5 — map a discovered provider resource onto a site. A
// resource with no reliable per-site labels can only ever be an *estimated*
// split (spec §2) — FULL is the only mode that means "exact".
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { id: managedAppId } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { providerResourceId, allocationMode, allocationPercent } = parsed.data;
  const correlationId = randomUUID();

  try {
    const [app, resource] = await Promise.all([
      prisma.managedApp.findUnique({ where: { id: managedAppId } }),
      prisma.providerResource.findUnique({ where: { id: providerResourceId } }),
    ]);

    if (!app) return NextResponse.json({ error: 'App not found' }, { status: 404 });
    if (!resource) return NextResponse.json({ error: 'Resource not found' }, { status: 404 });

    if (allocationMode === 'PERCENTAGE' && allocationPercent === undefined) {
      return NextResponse.json(
        { error: 'allocationPercent is required when allocationMode is PERCENTAGE' },
        { status: 400 },
      );
    }

    const mapping = await prisma.appResourceMapping.upsert({
      where: {
        managedAppId_providerResourceId: { managedAppId, providerResourceId },
      },
      create: {
        managedAppId,
        providerResourceId,
        allocationMode,
        allocationPercent,
        confidence: allocationMode === 'FULL' ? 'EXACT' : 'ESTIMATED',
      },
      update: {
        allocationMode,
        allocationPercent,
        confidence: allocationMode === 'FULL' ? 'EXACT' : 'ESTIMATED',
      },
    });

    // Backfill: existing cost_records for this resource should reflect the
    // new mapping immediately (spec §12 "Map one GCP project to a site →
    // site dashboard immediately includes its costs"), not just future syncs.
    if (allocationMode === 'FULL') {
      await prisma.costRecord.updateMany({
        where: { providerResourceId },
        data: { managedAppId },
      });
    }

    await writeAuditLog({
      actorLabel: session.user.email,
      action: 'app.mapping.upsert',
      resource: resource.externalResourceId,
      newValue: mapping,
      result: 'SUCCESS',
      requestCorrelationId: correlationId,
    });

    return NextResponse.json({ mapping });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create mapping';
    await writeAuditLog({
      actorLabel: session.user.email,
      action: 'app.mapping.upsert',
      result: 'FAILURE',
      errorSummary: message,
      requestCorrelationId: correlationId,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Undo of the POST above — e.g. the underlying GCP project was shut down /
// deleted and should stop being tracked under this site. Takes
// providerResourceId as a query param (DELETE requests carrying a JSON body
// are non-standard and some proxies strip it).
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { id: managedAppId } = await params;
  const providerResourceId = new URL(req.url).searchParams.get('providerResourceId');
  const parsedId = z.string().uuid().safeParse(providerResourceId);
  if (!parsedId.success) {
    return NextResponse.json({ error: 'providerResourceId is required' }, { status: 400 });
  }

  const correlationId = randomUUID();

  try {
    const mapping = await prisma.appResourceMapping.findUnique({
      where: { managedAppId_providerResourceId: { managedAppId, providerResourceId: parsedId.data } },
      include: { providerResource: true },
    });

    if (!mapping) {
      return NextResponse.json({ error: 'Mapping not found' }, { status: 404 });
    }

    await prisma.$transaction([
      // Mirror the POST backfill in reverse — cost_records this mapping
      // attributed to the site must stop being counted there once the
      // mapping is gone, not silently keep contributing to its totals.
      prisma.costRecord.updateMany({
        where: { providerResourceId: parsedId.data, managedAppId },
        data: { managedAppId: null },
      }),
      prisma.appResourceMapping.delete({ where: { id: mapping.id } }),
    ]);

    await writeAuditLog({
      actorLabel: session.user.email,
      action: 'app.mapping.delete',
      resource: mapping.providerResource.externalResourceId,
      oldValue: mapping,
      result: 'SUCCESS',
      requestCorrelationId: correlationId,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to remove mapping';
    await writeAuditLog({
      actorLabel: session.user.email,
      action: 'app.mapping.delete',
      result: 'FAILURE',
      errorSummary: message,
      requestCorrelationId: correlationId,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

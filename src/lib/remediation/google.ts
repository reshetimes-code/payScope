// Google Cloud remediation — implements the default action chosen in
// DECISIONS.md "Hard Stop default action per provider":
//
//   - Dedicated project, Cloud Run–hosted site → AUTOMATED_SERVICE_SHUTDOWN,
//     concretely: set the specific Cloud Run service's maxInstanceCount to 0.
//     This stops new traffic/cost for that one service without touching any
//     other resource in the project (Cloud SQL, other services, etc.).
//   - Project shared by more than one managed app → MANUAL_ACTION_REQUIRED.
//     We never silently run BILLING_DISCONNECT (project-wide) automatically.

import { ServicesClient } from '@google-cloud/run';
import { prisma } from '@/lib/db/prisma';
import type {
  RemediationAdapter,
  RemediationTarget,
  StopActionResult,
  ResumeActionResult,
} from './types';
import type { StopActionCapability } from '@/lib/providers/types';

/**
 * A GCP project is "shared" for Hard Stop purposes when more than one
 * distinct Managed App has a mapping onto its ProviderResource row, or when
 * it has none at all. Zero mappings fails closed rather than open: we don't
 * yet know which app (if any) owns this project, so it's never safe to
 * assume it's dedicated. Only exactly one mapped app clears it as dedicated.
 */
async function isProjectSharedAcrossApps(projectId: string): Promise<boolean> {
  const resource = await prisma.providerResource.findFirst({
    where: { externalResourceId: projectId, resourceType: 'gcp_project' },
    include: { appMappings: { select: { managedAppId: true } } },
  });

  if (!resource) return true; // unknown project — fail closed

  const distinctAppIds = new Set(resource.appMappings.map((m) => m.managedAppId));
  return distinctAppIds.size !== 1;
}

function parseCloudRunTarget(scopeExternalId: string): {
  projectId: string;
  region: string;
  serviceName: string;
} | null {
  // Expect scopeExternalId encoded as "projectId/region/serviceName" — set
  // by the mapping step when a Managed App is linked to a specific Cloud Run
  // service, not just a bare project id.
  const parts = scopeExternalId.split('/');
  if (parts.length !== 3) return null;
  // Safe: length just checked above. noUncheckedIndexedAccess otherwise
  // types each element as `string | undefined`.
  const [projectId, region, serviceName] = parts as [string, string, string];
  return { projectId, region, serviceName };
}

export const googleRemediationAdapter: RemediationAdapter = {
  provider: 'GOOGLE_CLOUD',

  async describeStopAction(target: RemediationTarget) {
    const parsed = parseCloudRunTarget(target.scopeExternalId);
    if (!parsed) {
      return {
        capability: 'MANUAL_ACTION_REQUIRED' as StopActionCapability,
        description:
          'לא זוהה Cloud Run service ספציפי עבור אתר זה — נדרשת פעולה ידנית.',
      };
    }

    const shared = await isProjectSharedAcrossApps(parsed.projectId);
    if (shared) {
      return {
        capability: 'MANUAL_ACTION_REQUIRED' as StopActionCapability,
        description:
          `הפרויקט ${parsed.projectId} משמש יותר מאתר אחד — לא מבוצעת עצירה ` +
          `אוטומטית שעלולה להשפיע על אתרים אחרים. נדרש אישור ידני.`,
      };
    }

    return {
      capability: 'AUTOMATED_SERVICE_SHUTDOWN' as StopActionCapability,
      description:
        `יעצור תנועה ל-Cloud Run service "${parsed.serviceName}" ` +
        `(${parsed.projectId}/${parsed.region}) ע"י הגדרת max-instances=0. ` +
        `שירותים אחרים בפרויקט לא מושפעים.`,
    };
  },

  async stop(target: RemediationTarget): Promise<StopActionResult> {
    const parsed = parseCloudRunTarget(target.scopeExternalId);
    if (!parsed) {
      return {
        ok: false,
        capabilityUsed: 'MANUAL_ACTION_REQUIRED',
        message: 'לא ניתן לזהות Cloud Run service — לא בוצעה פעולה.',
        preActionState: {},
      };
    }

    const shared = await isProjectSharedAcrossApps(parsed.projectId);
    if (shared) {
      return {
        ok: false,
        capabilityUsed: 'MANUAL_ACTION_REQUIRED',
        message:
          'הפרויקט משותף לכמה אתרים — נדרשת פעולה ידנית, לא בוצעה עצירה אוטומטית.',
        preActionState: {},
      };
    }

    const client = new ServicesClient();
    const name = client.servicePath(parsed.projectId, parsed.region, parsed.serviceName);

    const [service] = await client.getService({ name });
    const previousMaxInstanceCount =
      service.template?.scaling?.maxInstanceCount ?? null;

    const [operation] = await client.updateService({
      service: {
        ...service,
        template: {
          ...service.template,
          scaling: {
            ...service.template?.scaling,
            maxInstanceCount: 0,
          },
        },
      },
    });
    const [result] = await operation.promise();

    return {
      ok: true,
      capabilityUsed: 'AUTOMATED_SERVICE_SHUTDOWN',
      message: `Cloud Run service ${parsed.serviceName} הושהה (max-instances=0).`,
      preActionState: {
        projectId: parsed.projectId,
        region: parsed.region,
        serviceName: parsed.serviceName,
        previousMaxInstanceCount,
      },
      providerResponse: result,
    };
  },

  async resume(
    _target: RemediationTarget,
    preActionState: Record<string, unknown>,
  ): Promise<ResumeActionResult> {
    const { projectId, region, serviceName, previousMaxInstanceCount } =
      preActionState as {
        projectId?: string;
        region?: string;
        serviceName?: string;
        previousMaxInstanceCount?: number | null;
      };

    if (!projectId || !region || !serviceName) {
      return {
        ok: false,
        message:
          'אין מספיק מידע כדי לשחזר את המצב הקודם באופן בטוח — נדרשת בדיקה ידנית.',
      };
    }

    const client = new ServicesClient();
    const name = client.servicePath(projectId, region, serviceName);
    const [service] = await client.getService({ name });

    const [operation] = await client.updateService({
      service: {
        ...service,
        template: {
          ...service.template,
          scaling: {
            ...service.template?.scaling,
            // Restore whatever was configured before the stop; a null means
            // no explicit cap was set, i.e. remove ours.
            maxInstanceCount: previousMaxInstanceCount ?? undefined,
          },
        },
      },
    });
    const [result] = await operation.promise();

    return {
      ok: true,
      message: `Cloud Run service ${serviceName} הופעל מחדש.`,
      providerResponse: result,
    };
  },
};

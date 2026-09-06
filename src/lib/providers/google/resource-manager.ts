// Cloud Resource Manager — project discovery (spec §5.2, §5.5).
//
// Auth: accepts an optional OAuth2Client (the signed-in admin's own OAuth
// token — see user-auth.ts). Falls back to Application Default Credentials
// when none is given, for whenever the production workload-identity setup
// (DECISIONS.md "GCP credential strategy") is in place. Nothing in this file
// ever reads a stored key from the database — that path only exists for
// OpenAI/Anthropic admin keys.

import { ProjectsClient } from '@google-cloud/resource-manager';
import type { OAuth2Client } from 'google-auth-library';

export interface DiscoveredProject {
  /** e.g. "silver", "mishpatly" — the human-assigned project id, stable and unique */
  projectId: string;
  /** e.g. "projects/123456789012" — needed for Billing Budget API filters, which key by number, not id */
  projectNumber: string;
  displayName: string;
  state: string;
  /** e.g. "organizations/123" or "folders/456", if the caller can see it */
  parent?: string;
}

function client(authClient?: OAuth2Client): ProjectsClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- google-auth-library's generic AuthClient union type does not include OAuth2Client, though it accepts one at runtime.
  return new ProjectsClient(authClient ? ({ authClient } as any) : {});
}

/**
 * Lists every project the calling identity can see — across whatever
 * orgs/folders it has been granted read access to. This is intentionally
 * "everything visible", not scoped to one org, since spec §5.1 step 7 lets
 * the owner choose which discovered projects to actually manage afterward.
 */
export async function discoverAccessibleProjects(authClient?: OAuth2Client): Promise<DiscoveredProject[]> {
  const projects: DiscoveredProject[] = [];

  for await (const project of client(authClient).searchProjectsAsync({})) {
    if (!project.projectId || !project.name) continue;
    projects.push({
      projectId: project.projectId,
      // project.name is "projects/{projectNumber}"
      projectNumber: project.name.replace(/^projects\//, ''),
      displayName: project.displayName || project.projectId,
      state: String(project.state ?? 'STATE_UNSPECIFIED'),
      parent: project.parent ?? undefined,
    });
  }

  return projects;
}

/**
 * Minimal permission probe used by the setup wizard's "test permissions"
 * step (spec §5.1 step 4) and by testConnection() on the adapter. Doesn't
 * assert on results — a zero-project result is valid (brand-new identity not
 * yet granted anything) and must not be reported as a connection failure.
 */
export async function testResourceManagerAccess(
  authClient?: OAuth2Client,
): Promise<{ ok: boolean; message: string }> {
  try {
    const iterator = client(authClient).searchProjectsAsync({ pageSize: 1 });
    // Draining exactly one page proves the API call itself succeeds (auth +
    // API enabled + IAM allows resourcemanager.projects.list/search) without
    // paging through everything just to test connectivity.
    for await (const _ of iterator) break;
    return { ok: true, message: 'Resource Manager access verified.' };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Unknown Resource Manager error.',
    };
  }
}

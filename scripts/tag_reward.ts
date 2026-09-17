#!/usr/bin/env node
/**
 * Tag PAM / PPL1 / PPL2-PPM / MBON / KC from the MaleCNS `type` field.
 * Replaces `interneuron` only. Does not invent IDs or change gustatory terciles.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PAM_BODY_IDS,
  REWARD_ROLES,
  applyRewardRoles,
  assertPamBodyIds,
  pamBodyIdsFromTypes,
} from '../src/brain/reward.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const metaPath = join(root, 'public/data/feeding-circuit/graph.meta.json');

function main(): void {
  if (!existsSync(metaPath)) throw new Error(`Missing ${metaPath}`);
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
    role: string[];
    type: Array<string | null>;
    bodyId: number[];
    provenance?: Record<string, unknown>;
  };
  const report = applyRewardRoles(meta.role, meta.type);
  const pamIds = pamBodyIdsFromTypes(meta.bodyId, meta.type);
  assertPamBodyIds(pamIds);
  const pamN = report.byRole.dan_pam ?? 0;
  if (pamN < PAM_BODY_IDS.length) {
    throw new Error(`Expected at least ${PAM_BODY_IDS.length} dan_pam from type, got ${pamN}`);
  }

  const provenance = (meta.provenance ?? {}) as Record<string, unknown>;
  const counts = (provenance.neuron_counts ?? {}) as Record<string, unknown>;
  counts.by_role = report.byRole;
  provenance.neuron_counts = counts;
  provenance.reward_tags = {
    rule: 'type prefix PAM→dan_pam, PPL1→dan_ppl1, PPL2|PPM→dan_other, MBON→mbon, KC→kc; replace interneuron only',
    by_role: {
      dan_pam: report.byRole.dan_pam ?? 0,
      dan_ppl1: report.byRole.dan_ppl1 ?? 0,
      dan_other: report.byRole.dan_other ?? 0,
      mbon: report.byRole.mbon ?? 0,
      kc: report.byRole.kc ?? 0,
    },
    types: report.types,
    pam_bodyId: pamIds,
    replaced_interneuron: report.changed,
  };
  meta.provenance = provenance;

  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
  console.log(`updated roles in ${metaPath} (replaced ${report.changed} interneuron tags)`);
  for (const role of REWARD_ROLES) {
    const types = Object.entries(report.types[role])
      .map(([t, n]) => `${t}×${n}`)
      .join(', ');
    console.log(`  ${role}: ${report.byRole[role]}  (${types})`);
  }
  const extraPam = pamIds.filter((id) => !(PAM_BODY_IDS as readonly number[]).includes(id));
  console.log(`  PAM bodyId (n=${pamIds.length}, verified 19 present, extra ${extraPam.length}): ${pamIds.join(', ')}`);
  console.log(`  interneuron remaining: ${report.byRole.interneuron ?? 0}`);
}

main();

import type { SourceTool } from "../domain/types.js";
import type { TeamAggregate, TeamAggregateInput, TeamGroupKey, TeamGroupSummary, TeamProjectRecord, TeamShare, TeamSessionSignal } from "./types.js";

function sharesOf(sessions: readonly TeamSessionSignal[]): readonly TeamShare[] {
  const bySource = new Map<SourceTool, { sessions: number; messages: number }>();
  for (const session of sessions) {
    const entry = bySource.get(session.sourceTool) ?? { sessions: 0, messages: 0 };
    entry.sessions += 1;
    entry.messages += session.messages;
    bySource.set(session.sourceTool, entry);
  }
  const totalMessages = sessions.reduce((sum, session) => sum + session.messages, 0);

  return [...bySource.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([source, entry]) => ({
      source,
      sessions: entry.sessions,
      messages: entry.messages,
      share: totalMessages === 0 ? 0 : Number((entry.messages / totalMessages).toFixed(4))
    }));
}

function groupOf(session: TeamSessionSignal): TeamGroupKey {
  if (session.category === "pure-conversation") return "pure-conversation";
  if (session.projectId === "cross-project" || session.projectId === "unassigned") return "cross-and-unassigned";
  return "project-work";
}

export function aggregateTeamView(input: TeamAggregateInput): TeamAggregate {
  const disabled = new Set(input.disabledSources ?? []);
  const visible = input.sessions.filter((session) => !disabled.has(session.sourceTool));

  const projects = new Map<string, TeamSessionSignal[]>();
  for (const session of visible) {
    if (groupOf(session) !== "project-work") continue;
    const projectId = session.projectId as string;
    const list = projects.get(projectId) ?? [];
    list.push(session);
    projects.set(projectId, list);
  }

  const projectRecords: TeamProjectRecord[] = [...projects.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([projectId, sessions]) => {
      const messages = sessions.reduce((sum, session) => sum + session.messages, 0);
      return {
        projectId,
        sessions: sessions.length,
        messages,
        shares: sharesOf(sessions)
      };
    });

  const groupKeys: readonly TeamGroupKey[] = ["project-work", "cross-and-unassigned", "pure-conversation"];
  const groups: TeamGroupSummary[] = groupKeys.map((group) => {
    const sessions = visible.filter((session) => groupOf(session) === group);
    return {
      group,
      sessions: sessions.length,
      messages: sessions.reduce((sum, session) => sum + session.messages, 0),
      shares: sharesOf(sessions)
    };
  });

  const totalSessions = visible.length;
  const totalMessages = visible.reduce((sum, session) => sum + session.messages, 0);
  const groupSessionSum = groups.reduce((sum, group) => sum + group.sessions, 0);
  const groupMessageSum = groups.reduce((sum, group) => sum + group.messages, 0);
  const projectSessionSum = projectRecords.reduce((sum, project) => sum + project.sessions, 0);
  const projectWorkGroup = groups.find((group) => group.group === "project-work");

  const gaps = Object.entries(input.completenessBySource ?? {}).flatMap(([source, declaration]) =>
    declaration === undefined ? [] : declaration.gaps.map((gap) => `${source}:${gap}`)
  );
  const incomplete =
    gaps.length > 0 ||
    (input.disabledSources?.length ?? 0) > 0 ||
    Object.values(input.completenessBySource ?? {}).some(
      (declaration) => declaration?.status === "possibly-incomplete"
    );

  return {
    range: input.range,
    projects: projectRecords,
    groups,
    teamShares: sharesOf(visible),
    totalSessions,
    totalMessages,
    completeness: {
      status: incomplete ? "possibly-incomplete" : "complete",
      disabledSources: input.disabledSources ?? [],
      gaps
    },
    consistent:
      groupSessionSum === totalSessions &&
      groupMessageSum === totalMessages &&
      projectSessionSum === (projectWorkGroup?.sessions ?? 0)
  };
}
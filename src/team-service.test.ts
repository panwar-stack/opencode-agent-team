import { vi } from "vitest"

const fsData = new Map<string, string>()

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => {}),
  readFile: vi.fn(async (path: string) => {
    if (fsData.has(path)) return fsData.get(path)!
    const err = new Error("ENOENT: no such file") as NodeJS.ErrnoException
    err.code = "ENOENT"
    throw err
  }),
  writeFile: vi.fn(async (path: string, data: string) => {
    fsData.set(path, data)
  }),
}))

import {
  createTeam,
  getTeam,
  getActiveTeamForLead,
  getTeamForMember,
  shutdownTeam,
  addMember,
  getMember,
  getMemberBySession,
  updateMemberStatus,
  isMemberBlocked,
  getBlockedMembers,
  getTeamMembers,
  getTeamMemberNames,
  sendMessage,
  getMessagesForRecipient,
  createTask,
  getTeamTasks,
  claimTask,
  updateTask,
  resolveRecipients,
  getTeamSummary,
} from "./team-service.js"
import { saveDB, saveTeamState, getTeamState, generateID } from "./db.js"
import type { TeamMember, TeamTask, TeamMessage } from "./types.js"

function makeMember(overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    id: overrides.id ?? "member-1",
    teamID: overrides.teamID ?? "team-1",
    sessionID: overrides.sessionID ?? "session-1",
    name: overrides.name ?? "test-member",
    agentType: overrides.agentType ?? "general",
    model: overrides.model ?? null,
    rolePrompt: overrides.rolePrompt ?? "Do stuff",
    status: overrides.status ?? "active",
    planMode: overrides.planMode ?? false,
    workMode: overrides.workMode ?? "implement",
    dependencyIDs: overrides.dependencyIDs ?? null,
    result: overrides.result ?? null,
    timeCreated: overrides.timeCreated ?? 1000,
    timeUpdated: overrides.timeUpdated ?? 1000,
  }
}

beforeEach(async () => {
  fsData.clear()
  await saveDB({ teams: {} })
})

// === Team Operations ===

describe("createTeam", () => {
  it("creates a new team and returns summary", async () => {
    const result = await createTeam({
      name: "Test Team",
      goal: "Test goal",
      leadSessionID: "lead-session-1",
    })

    expect(result.teamID).toBeTypeOf("string")
    expect(result.name).toBe("Test Team")
    expect(result.status).toBe("active")

    const state = await getTeamState(result.teamID)
    expect(state).not.toBeNull()
    expect(state!.team.name).toBe("Test Team")
    expect(state!.team.goal).toBe("Test goal")
    expect(state!.team.leadSessionID).toBe("lead-session-1")
    expect(state!.team.status).toBe("active")
    expect(state!.members).toEqual([])
    expect(state!.tasks).toEqual([])
    expect(state!.messages).toEqual([])
  })

  it("initializes team with correct time values", async () => {
    const result = await createTeam({
      name: "Test Team",
      goal: "Test goal",
      leadSessionID: "lead-session-1",
    })

    const state = await getTeamState(result.teamID)
    expect(state!.team.timeCreated).toBeGreaterThan(0)
    expect(state!.team.timeUpdated).toEqual(state!.team.timeCreated)
  })

  it("throws if active team already exists for lead session", async () => {
    await createTeam({
      name: "First Team",
      goal: "First goal",
      leadSessionID: "lead-session-1",
    })

    await expect(
      createTeam({
        name: "Second Team",
        goal: "Second goal",
        leadSessionID: "lead-session-1",
      }),
    ).rejects.toThrow("Active team already exists for this lead session")
  })

  it("allows creating team for different lead session", async () => {
    await createTeam({
      name: "Team 1",
      goal: "Goal 1",
      leadSessionID: "lead-1",
    })

    const result = await createTeam({
      name: "Team 2",
      goal: "Goal 2",
      leadSessionID: "lead-2",
    })

    expect(result.teamID).toBeTypeOf("string")
    expect(result.name).toBe("Team 2")
  })

  it("allows creating team after previous one was shut down", async () => {
    const first = await createTeam({
      name: "Team 1",
      goal: "Goal 1",
      leadSessionID: "lead-1",
    })

    await shutdownTeam(first.teamID)

    const result = await createTeam({
      name: "Team 2",
      goal: "Goal 2",
      leadSessionID: "lead-1",
    })

    expect(result.teamID).not.toBe(first.teamID)
    expect(result.name).toBe("Team 2")
  })
})

describe("getTeam", () => {
  it("returns team by ID", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    const team = await getTeam(teamID)
    expect(team).not.toBeNull()
    expect(team!.id).toBe(teamID)
    expect(team!.name).toBe("Test Team")
  })

  it("returns null for non-existent team", async () => {
    const team = await getTeam("nonexistent")
    expect(team).toBeNull()
  })
})

describe("getActiveTeamForLead", () => {
  it("returns active team for lead session", async () => {
    await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    const team = await getActiveTeamForLead("lead-1")
    expect(team).not.toBeNull()
    expect(team!.name).toBe("Test Team")
  })

  it("returns null when no active team exists", async () => {
    const team = await getActiveTeamForLead("nonexistent")
    expect(team).toBeNull()
  })

  it("returns null for closed team", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })
    await shutdownTeam(teamID)

    const team = await getActiveTeamForLead("lead-1")
    expect(team).toBeNull()
  })
})

describe("getTeamForMember", () => {
  it("returns team by member session ID", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    await addMember({
      teamID,
      sessionID: "member-session-1",
      name: "member1",
      agentType: "general",
      rolePrompt: "Do work",
      planMode: false,
      workMode: "implement",
      dependencyIDs: null,
      model: null,
    })

    const team = await getTeamForMember("member-session-1")
    expect(team).not.toBeNull()
    expect(team!.name).toBe("Test Team")
  })

  it("returns null for non-existent member session", async () => {
    const team = await getTeamForMember("nonexistent")
    expect(team).toBeNull()
  })
})

describe("shutdownTeam", () => {
  it("closes the team and cancels active members", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    const { memberID } = await addMember({
      teamID,
      sessionID: "session-1",
      name: "member1",
      agentType: "general",
      rolePrompt: "Do work",
      planMode: false,
      workMode: "implement",
      dependencyIDs: null,
      model: null,
    })

    await shutdownTeam(teamID)

    const state = await getTeamState(teamID)
    expect(state!.team.status).toBe("closed")

    const member = state!.members.find(m => m.id === memberID)
    expect(member!.status).toBe("cancelled")
  })

  it("throws when team not found", async () => {
    await expect(shutdownTeam("nonexistent")).rejects.toThrow("Team not found")
  })

  it("does not cancel already completed members", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    const { memberID } = await addMember({
      teamID,
      sessionID: "session-1",
      name: "member1",
      agentType: "general",
      rolePrompt: "Do work",
      planMode: false,
      workMode: "implement",
      dependencyIDs: null,
      model: null,
    })

    await updateMemberStatus(memberID, "completed")

    await shutdownTeam(teamID)

    const state = await getTeamState(teamID)
    const member = state!.members.find(m => m.id === memberID)
    expect(member!.status).toBe("completed")
    expect(member!.timeUpdated).toBeGreaterThan(0)
  })

  it("does not change already cancelled members", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    const { memberID } = await addMember({
      teamID,
      sessionID: "session-1",
      name: "member1",
      agentType: "general",
      rolePrompt: "Do work",
      planMode: false,
      workMode: "implement",
      dependencyIDs: null,
      model: null,
    })

    await updateMemberStatus(memberID, "cancelled")

    await shutdownTeam(teamID)

    const state = await getTeamState(teamID)
    const member = state!.members.find(m => m.id === memberID)
    expect(member!.status).toBe("cancelled")
  })
})

// === Member Operations ===

describe("addMember", () => {
  let teamID: string

  const baseParams = {
    teamID: "",
    sessionID: "session-1",
    name: "member1",
    agentType: "general",
    rolePrompt: "Do work",
    planMode: false,
    workMode: "implement" as const,
    dependencyIDs: null as string[] | null,
    model: null as { providerID: string; modelID: string } | null,
  }

  beforeEach(async () => {
    const team = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })
    teamID = team.teamID
    baseParams.teamID = teamID
  })

  it("adds a member to the team", async () => {
    const result = await addMember(baseParams)

    expect(result.memberID).toBeTypeOf("string")
    expect(result.sessionID).toBe("session-1")
    expect(result.dependencyIDs).toBeNull()

    const state = await getTeamState(baseParams.teamID)
    expect(state!.members).toHaveLength(1)
    expect(state!.members[0]!.name).toBe("member1")
  })

  it("sets initial status to starting", async () => {
    await addMember(baseParams)

    const state = await getTeamState(baseParams.teamID)
    expect(state!.members[0]!.status).toBe("starting")
  })

  it("throws when team not found", async () => {
    await expect(
      addMember({ ...baseParams, teamID: "nonexistent" }),
    ).rejects.toThrow("Team not found")
  })

  it("adds multiple members", async () => {
    await addMember(baseParams)
    await addMember({ ...baseParams, sessionID: "session-2", name: "member2" })
    await addMember({ ...baseParams, sessionID: "session-3", name: "member3" })

    const state = await getTeamState(baseParams.teamID)
    expect(state!.members).toHaveLength(3)
  })

  it("stores dependency IDs", async () => {
    const result = await addMember({
      ...baseParams,
      dependencyIDs: ["dep-1", "dep-2"],
    })

    expect(result.dependencyIDs).toEqual(["dep-1", "dep-2"])

    const state = await getTeamState(baseParams.teamID)
    expect(state!.members[0]!.dependencyIDs).toEqual(["dep-1", "dep-2"])
  })

  it("stores plan mode and work mode", async () => {
    await addMember({
      ...baseParams,
      planMode: true,
      workMode: "plan",
    })

    const state = await getTeamState(baseParams.teamID)
    expect(state!.members[0]!.planMode).toBe(true)
    expect(state!.members[0]!.workMode).toBe("plan")
  })
})

describe("getMember", () => {
  it("returns member by ID", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    const { memberID } = await addMember({
      teamID,
      sessionID: "session-1",
      name: "member1",
      agentType: "general",
      rolePrompt: "Do work",
      planMode: false,
      workMode: "implement",
      dependencyIDs: null,
      model: null,
    })

    const member = await getMember(memberID)
    expect(member).not.toBeNull()
    expect(member!.name).toBe("member1")
    expect(member!.sessionID).toBe("session-1")
  })

  it("returns null for non-existent member", async () => {
    const member = await getMember("nonexistent")
    expect(member).toBeNull()
  })

  it("finds member across multiple teams", async () => {
    const { teamID: tid1 } = await createTeam({
      name: "Team 1",
      goal: "Goal 1",
      leadSessionID: "lead-1",
    })

    await createTeam({
      name: "Team 2",
      goal: "Goal 2",
      leadSessionID: "lead-2",
    })

    const { memberID } = await addMember({
      teamID: tid1,
      sessionID: "session-1",
      name: "member1",
      agentType: "general",
      rolePrompt: "Do work",
      planMode: false,
      workMode: "implement",
      dependencyIDs: null,
      model: null,
    })

    const member = await getMember(memberID)
    expect(member).not.toBeNull()
  })
})

describe("getMemberBySession", () => {
  it("returns member and team by session ID", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    await addMember({
      teamID,
      sessionID: "session-1",
      name: "member1",
      agentType: "general",
      rolePrompt: "Do work",
      planMode: false,
      workMode: "implement",
      dependencyIDs: null,
      model: null,
    })

    const result = await getMemberBySession("session-1")
    expect(result).not.toBeNull()
    expect(result!.member.name).toBe("member1")
    expect(result!.team.name).toBe("Test Team")
  })

  it("returns null for non-existent session", async () => {
    const result = await getMemberBySession("nonexistent")
    expect(result).toBeNull()
  })
})

describe("updateMemberStatus", () => {
  it("updates member status", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    const { memberID } = await addMember({
      teamID,
      sessionID: "session-1",
      name: "member1",
      agentType: "general",
      rolePrompt: "Do work",
      planMode: false,
      workMode: "implement",
      dependencyIDs: null,
      model: null,
    })

    const result = await updateMemberStatus(memberID, "active")
    expect(result).not.toBeNull()
    expect(result!.member.status).toBe("active")
    expect(result!.team.id).toBe(teamID)
  })

  it("updates member result when provided", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    const { memberID } = await addMember({
      teamID,
      sessionID: "session-1",
      name: "member1",
      agentType: "general",
      rolePrompt: "Do work",
      planMode: false,
      workMode: "implement",
      dependencyIDs: null,
      model: null,
    })

    const result = await updateMemberStatus(memberID, "completed", "All done!")
    expect(result!.member.status).toBe("completed")
    expect(result!.member.result).toBe("All done!")
  })

  it("returns null for non-existent member", async () => {
    const result = await updateMemberStatus("nonexistent", "active")
    expect(result).toBeNull()
  })

  it("updates timeUpdated on status change", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    const { memberID } = await addMember({
      teamID,
      sessionID: "session-1",
      name: "member1",
      agentType: "general",
      rolePrompt: "Do work",
      planMode: false,
      workMode: "implement",
      dependencyIDs: null,
      model: null,
    })

    const before = await getMember(memberID)
    const originalTime = before!.timeUpdated

    const result = await updateMemberStatus(memberID, "blocked")
    expect(result!.member.timeUpdated).toBeGreaterThanOrEqual(originalTime)
  })

  it("does not overwrite result when not provided", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    const { memberID } = await addMember({
      teamID,
      sessionID: "session-1",
      name: "member1",
      agentType: "general",
      rolePrompt: "Do work",
      planMode: false,
      workMode: "implement",
      dependencyIDs: null,
      model: null,
    })

    await updateMemberStatus(memberID, "completed", "First result")
    const result = await updateMemberStatus(memberID, "completed")
    expect(result!.member.result).toBe("First result")
  })
})

describe("isMemberBlocked", () => {
  it("returns false when member has no dependencies", async () => {
    const member = makeMember({ dependencyIDs: null })
    const blocked = await isMemberBlocked(member)
    expect(blocked).toBe(false)
  })

  it("returns false when member has empty dependencies array", async () => {
    const member = makeMember({ dependencyIDs: [] })
    const blocked = await isMemberBlocked(member)
    expect(blocked).toBe(false)
  })

  it("returns true when team not found", async () => {
    const member = makeMember({
      teamID: "nonexistent",
      dependencyIDs: ["dep-1"],
    })
    const blocked = await isMemberBlocked(member)
    expect(blocked).toBe(true)
  })

  it("returns false when all dependencies completed", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    const { memberID: depID } = await addMember({
      teamID,
      sessionID: "dep-session",
      name: "dep-member",
      agentType: "general",
      rolePrompt: "Do work",
      planMode: false,
      workMode: "implement",
      dependencyIDs: null,
      model: null,
    })

    await updateMemberStatus(depID, "completed")

    const member = makeMember({ teamID, dependencyIDs: [depID] })
    const blocked = await isMemberBlocked(member)
    expect(blocked).toBe(false)
  })

  it("returns false when all dependencies cancelled", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    const { memberID: depID } = await addMember({
      teamID,
      sessionID: "dep-session",
      name: "dep-member",
      agentType: "general",
      rolePrompt: "Do work",
      planMode: false,
      workMode: "implement",
      dependencyIDs: null,
      model: null,
    })

    await updateMemberStatus(depID, "cancelled")

    const member = makeMember({ teamID, dependencyIDs: [depID] })
    const blocked = await isMemberBlocked(member)
    expect(blocked).toBe(false)
  })

  it("returns true when a dependency is still active", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    const { memberID: depID } = await addMember({
      teamID,
      sessionID: "dep-session",
      name: "dep-member",
      agentType: "general",
      rolePrompt: "Do work",
      planMode: false,
      workMode: "implement",
      dependencyIDs: null,
      model: null,
    })

    // dep-member is still "starting"
    const member = makeMember({ teamID, dependencyIDs: [depID] })
    const blocked = await isMemberBlocked(member)
    expect(blocked).toBe(true)
  })

  it("matches dependencies by session ID", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    const { memberID } = await addMember({
      teamID,
      sessionID: "dep-session",
      name: "dep-member",
      agentType: "general",
      rolePrompt: "Do work",
      planMode: false,
      workMode: "implement",
      dependencyIDs: null,
      model: null,
    })

    await updateMemberStatus(memberID, "active")

    const member = makeMember({ teamID, dependencyIDs: ["dep-session"] })
    const blocked = await isMemberBlocked(member)
    expect(blocked).toBe(true)
  })

  it("matches dependencies by name", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    const { memberID } = await addMember({
      teamID,
      sessionID: "dep-session",
      name: "dep-member",
      agentType: "general",
      rolePrompt: "Do work",
      planMode: false,
      workMode: "implement",
      dependencyIDs: null,
      model: null,
    })

    await updateMemberStatus(memberID, "starting")

    const member = makeMember({ teamID, dependencyIDs: ["dep-member"] })
    const blocked = await isMemberBlocked(member)
    expect(blocked).toBe(true)
  })
})

describe("getBlockedMembers", () => {
  it("returns blocked members for a team", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    const { memberID: m1 } = await addMember({
      teamID,
      sessionID: "session-1",
      name: "member1",
      agentType: "general",
      rolePrompt: "Do work",
      planMode: false,
      workMode: "implement",
      dependencyIDs: null,
      model: null,
    })

    const { memberID: m2 } = await addMember({
      teamID,
      sessionID: "session-2",
      name: "member2",
      agentType: "general",
      rolePrompt: "Do work",
      planMode: false,
      workMode: "implement",
      dependencyIDs: null,
      model: null,
    })

    await updateMemberStatus(m1, "blocked")

    const blocked = await getBlockedMembers(teamID)
    expect(blocked).toHaveLength(1)
    expect(blocked[0]!.id).toBe(m1)
  })

  it("returns empty array for non-existent team", async () => {
    const blocked = await getBlockedMembers("nonexistent")
    expect(blocked).toEqual([])
  })

  it("returns empty array when no members are blocked", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    await addMember({
      teamID,
      sessionID: "session-1",
      name: "member1",
      agentType: "general",
      rolePrompt: "Do work",
      planMode: false,
      workMode: "implement",
      dependencyIDs: null,
      model: null,
    })

    const blocked = await getBlockedMembers(teamID)
    expect(blocked).toEqual([])
  })
})

describe("getTeamMembers", () => {
  it("returns all members of a team", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    await addMember({
      teamID,
      sessionID: "session-1",
      name: "member1",
      agentType: "general",
      rolePrompt: "Do work",
      planMode: false,
      workMode: "implement",
      dependencyIDs: null,
      model: null,
    })

    await addMember({
      teamID,
      sessionID: "session-2",
      name: "member2",
      agentType: "explore",
      rolePrompt: "Explore",
      planMode: true,
      workMode: "plan",
      dependencyIDs: null,
      model: null,
    })

    const members = await getTeamMembers(teamID)
    expect(members).toHaveLength(2)
    expect(members[0]!.name).toBe("member1")
    expect(members[1]!.name).toBe("member2")
  })

  it("returns empty array for non-existent team", async () => {
    const members = await getTeamMembers("nonexistent")
    expect(members).toEqual([])
  })
})

describe("getTeamMemberNames", () => {
  it("returns member names", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    await addMember({
      teamID,
      sessionID: "session-1",
      name: "Alice",
      agentType: "general",
      rolePrompt: "Do work",
      planMode: false,
      workMode: "implement",
      dependencyIDs: null,
      model: null,
    })

    await addMember({
      teamID,
      sessionID: "session-2",
      name: "Bob",
      agentType: "general",
      rolePrompt: "Do work",
      planMode: false,
      workMode: "implement",
      dependencyIDs: null,
      model: null,
    })

    const names = await getTeamMemberNames(teamID)
    expect(names).toEqual(["Alice", "Bob"])
  })

  it("returns empty array for non-existent team", async () => {
    const names = await getTeamMemberNames("nonexistent")
    expect(names).toEqual([])
  })
})

// === Message Operations ===

describe("sendMessage", () => {
  it("sends a message and returns message ID", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    const result = await sendMessage({
      teamID,
      sender: "sender-1",
      recipients: ["recipient-1", "recipient-2"],
      body: "Hello, team!",
    })

    expect(result.messageID).toBeTypeOf("string")

    const state = await getTeamState(teamID)
    expect(state!.messages).toHaveLength(1)
    expect(state!.messages[0]!.body).toBe("Hello, team!")
    expect(state!.messages[0]!.sender).toBe("sender-1")
    expect(state!.messages[0]!.recipients).toEqual(["recipient-1", "recipient-2"])
  })

  it("creates recipient statuses for each recipient", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    await sendMessage({
      teamID,
      sender: "sender-1",
      recipients: ["r1", "r2", "r3"],
      body: "Test",
    })

    const state = await getTeamState(teamID)
    expect(state!.messages[0]!.recipientStatuses).toHaveLength(3)
    expect(state!.messages[0]!.recipientStatuses[0]!.deliveryStatus).toBe("pending")
  })

  it("throws when team not found", async () => {
    await expect(
      sendMessage({
        teamID: "nonexistent",
        sender: "sender-1",
        recipients: ["r1"],
        body: "Test",
      }),
    ).rejects.toThrow("Team not found")
  })

  it("sets initial delivery status to pending", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    await sendMessage({
      teamID,
      sender: "sender-1",
      recipients: ["r1"],
      body: "Test",
    })

    const state = await getTeamState(teamID)
    expect(state!.messages[0]!.deliveryStatus).toBe("pending")
  })
})

describe("getMessagesForRecipient", () => {
  it("returns pending messages for a recipient", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    await sendMessage({
      teamID,
      sender: "sender-1",
      recipients: ["recipient-1", "recipient-2"],
      body: "Hello",
    })

    const messages = await getMessagesForRecipient(teamID, "recipient-1")
    expect(messages).toHaveLength(1)
    expect(messages[0]!.body).toBe("Hello")
  })

  it("does not return messages where recipient is already delivered", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    const { messageID } = await sendMessage({
      teamID,
      sender: "sender-1",
      recipients: ["recipient-1"],
      body: "Hello",
    })

    // Mark as delivered using db directly
    const { markMessageDelivered } = await import("./db.js")
    await markMessageDelivered(teamID, messageID, "recipient-1")

    const messages = await getMessagesForRecipient(teamID, "recipient-1")
    expect(messages).toEqual([])
  })
})

// === Task Operations ===

describe("createTask", () => {
  it("creates a task", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    const result = await createTask({
      teamID,
      description: "Do something important",
    })

    expect(result.taskID).toBeTypeOf("string")

    const state = await getTeamState(teamID)
    expect(state!.tasks).toHaveLength(1)
    expect(state!.tasks[0]!.description).toBe("Do something important")
    expect(state!.tasks[0]!.status).toBe("pending")
  })

  it("creates task with an assignee", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    await createTask({
      teamID,
      description: "Assigned task",
      assignee: "member-1",
    })

    const state = await getTeamState(teamID)
    expect(state!.tasks[0]!.assignee).toBe("member-1")
  })

  it("creates task with dependencies", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    await createTask({
      teamID,
      description: "Task with deps",
      dependencyIDs: ["dep-1", "dep-2"],
    })

    const state = await getTeamState(teamID)
    expect(state!.tasks[0]!.dependencyIDs).toEqual(["dep-1", "dep-2"])
  })

  it("throws when team not found", async () => {
    await expect(
      createTask({
        teamID: "nonexistent",
        description: "Test task",
      }),
    ).rejects.toThrow("Team not found")
  })
})

describe("getTeamTasks", () => {
  it("returns all tasks for a team", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    await createTask({ teamID, description: "Task 1" })
    await createTask({ teamID, description: "Task 2" })

    const tasks = await getTeamTasks(teamID)
    expect(tasks).toHaveLength(2)
    expect(tasks[0]!.description).toBe("Task 1")
    expect(tasks[1]!.description).toBe("Task 2")
  })

  it("returns empty array for non-existent team", async () => {
    const tasks = await getTeamTasks("nonexistent")
    expect(tasks).toEqual([])
  })
})

describe("claimTask", () => {
  it("claims a pending task", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    const { taskID } = await createTask({
      teamID,
      description: "To do",
    })

    const task = await claimTask(taskID, "member-1")
    expect(task.status).toBe("in_progress")
    expect(task.assignee).toBe("member-1")
  })

  it("throws when task is not pending", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    const { taskID } = await createTask({
      teamID,
      description: "To do",
    })

    await claimTask(taskID, "member-1")

    // Try to claim again
    await expect(claimTask(taskID, "member-2")).rejects.toThrow(
      "Task is not pending",
    )
  })

  it("throws when dependencies are not completed", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    const { taskID: depTaskID } = await createTask({
      teamID,
      description: "Dependency task",
    })

    const { taskID } = await createTask({
      teamID,
      description: "Main task",
      dependencyIDs: [depTaskID],
    })

    await expect(claimTask(taskID, "member-1")).rejects.toThrow(
      "Dependency task",
    )
  })

  it("claims task when dependencies are completed", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    const { taskID: depTaskID } = await createTask({
      teamID,
      description: "Dependency task",
    })

    await claimTask(depTaskID, "member-1")
    await updateTask(depTaskID, { status: "completed" })

    const { taskID } = await createTask({
      teamID,
      description: "Main task",
      dependencyIDs: [depTaskID],
    })

    const task = await claimTask(taskID, "member-2")
    expect(task.status).toBe("in_progress")
  })

  it("allows claiming when dependency task is cancelled", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    const { taskID: depTaskID } = await createTask({
      teamID,
      description: "Dependency task",
    })

    // Mark as cancelled via updateTask
    await updateTask(depTaskID, { status: "cancelled" })

    const { taskID } = await createTask({
      teamID,
      description: "Main task",
      dependencyIDs: [depTaskID],
    })

    const task = await claimTask(taskID, "member-1")
    expect(task.status).toBe("in_progress")
  })

  it("throws when task not found", async () => {
    await expect(claimTask("nonexistent", "member-1")).rejects.toThrow(
      "Task not found",
    )
  })
})

describe("updateTask", () => {
  it("updates task status", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    const { taskID } = await createTask({
      teamID,
      description: "To do",
    })

    const task = await updateTask(taskID, { status: "completed" })
    expect(task.status).toBe("completed")
  })

  it("updates task assignee", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    const { taskID } = await createTask({
      teamID,
      description: "To do",
    })

    const task = await updateTask(taskID, { assignee: "new-assignee" })
    expect(task.assignee).toBe("new-assignee")
  })

  it("updates both status and assignee", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    const { taskID } = await createTask({
      teamID,
      description: "To do",
    })

    const task = await updateTask(taskID, {
      status: "in_progress",
      assignee: "member-2",
    })
    expect(task.status).toBe("in_progress")
    expect(task.assignee).toBe("member-2")
  })

  it("throws when task not found", async () => {
    await expect(
      updateTask("nonexistent", { status: "completed" }),
    ).rejects.toThrow("Task not found")
  })

  it("does not change unrelated task properties", async () => {
    const { teamID } = await createTeam({
      name: "Test Team",
      goal: "Test",
      leadSessionID: "lead-1",
    })

    const { taskID } = await createTask({
      teamID,
      description: "Original description",
      dependencyIDs: ["dep-1"],
    })

    const task = await updateTask(taskID, { status: "completed" })
    expect(task.description).toBe("Original description")
    expect(task.dependencyIDs).toEqual(["dep-1"])
  })
})

// === Utility ===

describe("resolveRecipients", () => {
  const leadSessionID = "lead-session-123"
  const senderSessionID = "sender-session-1"

  const members: TeamMember[] = [
    makeMember({ sessionID: "alice-session", name: "alice", id: "m1" }),
    makeMember({ sessionID: "bob-session", name: "bob", id: "m2" }),
    makeMember({ sessionID: "charlie-session", name: "charlie", id: "m3" }),
  ]

  it('resolves "lead" to lead session ID', () => {
    const result = resolveRecipients("lead", members, senderSessionID, leadSessionID)
    expect(result).toContain(leadSessionID)
  })

  it("resolves member name to session ID", () => {
    const result = resolveRecipients("alice", members, senderSessionID, leadSessionID)
    expect(result).toEqual(["alice-session"])
  })

  it("resolves member session ID directly", () => {
    const result = resolveRecipients("bob-session", members, senderSessionID, leadSessionID)
    expect(result).toEqual(["bob-session"])
  })

  it("handles comma-separated recipients", () => {
    const result = resolveRecipients("lead, alice, bob-session", members, senderSessionID, leadSessionID)
    expect(result).toContain(leadSessionID)
    expect(result).toContain("alice-session")
    expect(result).toContain("bob-session")
  })

  it("handles whitespace in comma-separated input", () => {
    const result = resolveRecipients("  alice  ,  bob  ", members, senderSessionID, leadSessionID)
    expect(result).toEqual(["alice-session", "bob-session"])
  })

  it("excludes sender from resolved recipients", () => {
    const result = resolveRecipients("lead", members, leadSessionID, leadSessionID)
    expect(result).not.toContain(leadSessionID)
  })

  it("throws on unknown recipients", () => {
    expect(() => resolveRecipients("unknown-recipient", members, senderSessionID, leadSessionID))
      .toThrow('Unknown recipient(s): unknown-recipient. Recipients must be a member name, session ID, or "lead".')
  })

  it("returns empty array when all recipients are the sender", () => {
    const result = resolveRecipients("alice-session", members, "alice-session", leadSessionID)
    expect(result).toEqual([])
  })

  it("deduplicates recipients", () => {
    const result = resolveRecipients("alice, alice, alice-session", members, senderSessionID, leadSessionID)
    expect(result).toEqual(["alice-session"])
  })

  it("handles empty parts gracefully", () => {
    const result = resolveRecipients(", alice ,, bob ,", members, senderSessionID, leadSessionID)
    expect(result).toEqual(["alice-session", "bob-session"])
  })
})

describe("getTeamSummary", () => {
  it("returns 'No active team' for non-existent team", async () => {
    const summary = await getTeamSummary("nonexistent")
    expect(summary).toBe("No active team")
  })

  it("generates summary with team info", async () => {
    const { teamID } = await createTeam({
      name: "My Team",
      goal: "Build great things",
      leadSessionID: "lead-1",
    })

    const summary = await getTeamSummary(teamID)
    expect(summary).toContain("My Team")
    expect(summary).toContain("Build great things")
    expect(summary).toContain("active")
  })

  it("includes member information with status icons", async () => {
    const { teamID } = await createTeam({
      name: "My Team",
      goal: "Build",
      leadSessionID: "lead-1",
    })

    const { memberID } = await addMember({
      teamID,
      sessionID: "session-1",
      name: "Alice",
      agentType: "general",
      rolePrompt: "Do work",
      planMode: false,
      workMode: "implement",
      dependencyIDs: null,
      model: null,
    })

    await updateMemberStatus(memberID, "active")

    const summary = await getTeamSummary(teamID)
    expect(summary).toContain("Alice")
    expect(summary).toContain("active")
    expect(summary).toContain("general")
  })

  it("shows dependency information", async () => {
    const { teamID } = await createTeam({
      name: "My Team",
      goal: "Build",
      leadSessionID: "lead-1",
    })

    await addMember({
      teamID,
      sessionID: "dep-session",
      name: "dep-member",
      agentType: "general",
      rolePrompt: "dep work",
      planMode: false,
      workMode: "implement",
      dependencyIDs: null,
      model: null,
    })

    await addMember({
      teamID,
      sessionID: "main-session",
      name: "main-member",
      agentType: "general",
      rolePrompt: "main work",
      planMode: false,
      workMode: "implement",
      dependencyIDs: ["dep-member"],
      model: null,
    })

    const summary = await getTeamSummary(teamID)
    expect(summary).toContain("depends on")
    expect(summary).toContain("dep-member")
  })

  it("includes task information", async () => {
    const { teamID } = await createTeam({
      name: "My Team",
      goal: "Build",
      leadSessionID: "lead-1",
    })

    await createTask({ teamID, description: "Fix the bug" })
    await createTask({ teamID, description: "Write docs", assignee: "Alice" })

    const summary = await getTeamSummary(teamID)
    expect(summary).toContain("Fix the bug")
    expect(summary).toContain("Write docs")
    expect(summary).toContain("2 pending")
  })

  it("handles team with no members gracefully", async () => {
    const { teamID } = await createTeam({
      name: "Empty Team",
      goal: "Nothing",
      leadSessionID: "lead-1",
    })

    const summary = await getTeamSummary(teamID)
    expect(summary).toContain("Empty Team")
  })

  it("handles team with no tasks gracefully", async () => {
    const { teamID } = await createTeam({
      name: "My Team",
      goal: "Build",
      leadSessionID: "lead-1",
    })

    const summary = await getTeamSummary(teamID)
    expect(summary).not.toContain("Tasks")
  })
})

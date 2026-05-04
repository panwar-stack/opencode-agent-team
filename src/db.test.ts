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
  loadDB,
  saveDB,
  getTeamState,
  saveTeamState,
  getTeamByLeadSession,
  getTeamByMemberSession,
  getPendingMessages,
  markMessageDelivered,
  markAllMessagesDelivered,
  generateID,
} from "./db.js"
import type {
  Team,
  TeamMember,
  TeamMessage,
  TeamTask,
  MessageRecipientStatus,
} from "./types.js"

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: "team-1",
    name: "Test Team",
    goal: "Test goal",
    leadSessionID: "lead-session-1",
    status: "active",
    timeCreated: 1000,
    timeUpdated: 1000,
    ...overrides,
  }
}

function makeMember(overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    id: "member-1",
    teamID: "team-1",
    sessionID: "session-1",
    name: "test-member",
    agentType: "general",
    model: null,
    rolePrompt: "Do stuff",
    status: "active",
    planMode: false,
    workMode: "implement",
    dependencyIDs: null,
    result: null,
    timeCreated: 1000,
    timeUpdated: 1000,
    ...overrides,
  }
}

function makeMessage(
  overrides: Partial<TeamMessage> & { recipientOverrides?: Partial<MessageRecipientStatus>[] },
): TeamMessage {
  const id = overrides.id ?? "msg-1"
  const now = overrides.timeCreated ?? 1000
  const recipients = overrides.recipients ?? ["recipient-1"]

  const recipientStatuses: MessageRecipientStatus[] = recipients.map((r, i) => ({
    id: `rs-${i + 1}`,
    messageID: id,
    teamID: overrides.teamID ?? "team-1",
    recipient: r,
    deliveryStatus: "pending" as const,
    timeCreated: now,
    timeUpdated: now,
  }))

  return {
    id,
    teamID: "team-1",
    sender: "sender-1",
    recipients,
    body: "test message",
    deliveryStatus: "pending",
    recipientStatuses,
    timeCreated: now,
    timeUpdated: now,
    ...overrides,
  }
}

function makeTeamState(overrides: {
  team?: Partial<Team>
  members?: TeamMember[]
  tasks?: TeamTask[]
  messages?: TeamMessage[]
} = {}): {
  team: Team
  members: TeamMember[]
  tasks: TeamTask[]
  messages: TeamMessage[]
} {
  return {
    team: makeTeam(overrides.team),
    members: overrides.members ?? [],
    tasks: overrides.tasks ?? [],
    messages: overrides.messages ?? [],
  }
}

beforeEach(async () => {
  fsData.clear()
  await saveDB({ teams: {} })
})

describe("generateID", () => {
  it("returns a non-empty string", () => {
    const id = generateID()
    expect(id).toBeTypeOf("string")
    expect(id.length).toBeGreaterThan(0)
  })

  it("returns UUID v4 format", () => {
    const id = generateID()
    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    expect(uuidV4Regex.test(id)).toBe(true)
  })

  it("returns unique IDs on repeated calls", () => {
    const ids = new Set<string>()
    for (let i = 0; i < 100; i++) {
      ids.add(generateID())
    }
    expect(ids.size).toBe(100)
  })
})

describe("loadDB / saveDB", () => {
  it("persists and retrieves data", async () => {
    const db = { teams: { "team-1": makeTeamState() } }
    await saveDB(db)

    const loaded = await loadDB()
    expect(loaded).toEqual(db)
  })

  it("returns empty state when no data saved", async () => {
    // beforeEach already calls saveDB with empty state,
    // but call loadDB directly to verify
    const loaded = await loadDB()
    expect(loaded.teams).toEqual({})
  })

  it("updates existing data", async () => {
    await saveDB({ teams: { "team-1": makeTeamState() } })
    await saveDB({
      teams: {
        "team-1": makeTeamState({ team: { name: "Updated" } }),
      },
    })

    const loaded = await loadDB()
    expect(loaded.teams["team-1"]!.team.name).toBe("Updated")
  })

  it("handles multiple teams", async () => {
    const db = {
      teams: {
        "team-1": makeTeamState({ team: { id: "team-1", name: "Team 1" } }),
        "team-2": makeTeamState({ team: { id: "team-2", name: "Team 2" } }),
      },
    }
    await saveDB(db)

    const loaded = await loadDB()
    expect(Object.keys(loaded.teams)).toHaveLength(2)
    expect(loaded.teams["team-1"]!.team.name).toBe("Team 1")
    expect(loaded.teams["team-2"]!.team.name).toBe("Team 2")
  })
})

describe("getTeamState / saveTeamState", () => {
  it("saves and retrieves team state", async () => {
    const state = makeTeamState({ team: { id: "team-1" } })
    state.members = [makeMember({ id: "m1", teamID: "team-1" })]

    await saveTeamState(state)

    const retrieved = await getTeamState("team-1")
    expect(retrieved).not.toBeNull()
    expect(retrieved!.team.id).toBe("team-1")
    expect(retrieved!.members).toHaveLength(1)
    expect(retrieved!.members[0]!.id).toBe("m1")
  })

  it("returns null for non-existent team", async () => {
    const state = await getTeamState("nonexistent")
    expect(state).toBeNull()
  })

  it("updates existing team state", async () => {
    await saveTeamState(makeTeamState({ team: { id: "team-1", name: "Original" } }))

    const updated = makeTeamState({ team: { id: "team-1", name: "Updated" } })
    updated.members = [makeMember({ id: "m1", teamID: "team-1" })]
    await saveTeamState(updated)

    const retrieved = await getTeamState("team-1")
    expect(retrieved!.team.name).toBe("Updated")
    expect(retrieved!.members).toHaveLength(1)
  })

  it("handles multiple teams independently", async () => {
    await saveTeamState(makeTeamState({ team: { id: "team-1", name: "Team 1" } }))
    await saveTeamState(makeTeamState({ team: { id: "team-2", name: "Team 2" } }))

    const t1 = await getTeamState("team-1")
    const t2 = await getTeamState("team-2")

    expect(t1!.team.name).toBe("Team 1")
    expect(t2!.team.name).toBe("Team 2")
  })

  it("saves state with tasks", async () => {
    const state = makeTeamState()
    state.tasks = [
      { id: "t1", teamID: "team-1", description: "Task 1", status: "pending", assignee: null, dependencyIDs: null, metadata: null, timeCreated: 1000, timeUpdated: 1000 },
    ]
    await saveTeamState(state)

    const retrieved = await getTeamState("team-1")
    expect(retrieved!.tasks).toHaveLength(1)
    expect(retrieved!.tasks[0]!.description).toBe("Task 1")
  })
})

describe("getTeamByLeadSession", () => {
  it("finds active team by lead session", async () => {
    await saveTeamState(makeTeamState({ team: { id: "team-1", leadSessionID: "lead-1", status: "active" } }))
    await saveTeamState(makeTeamState({ team: { id: "team-2", leadSessionID: "lead-2", status: "active" } }))

    const found = await getTeamByLeadSession("lead-1")
    expect(found).not.toBeNull()
    expect(found!.team.id).toBe("team-1")
  })

  it("returns null when no match", async () => {
    const found = await getTeamByLeadSession("nonexistent")
    expect(found).toBeNull()
  })

  it("ignores non-active teams", async () => {
    await saveTeamState(makeTeamState({ team: { id: "team-1", leadSessionID: "lead-1", status: "closed" } }))

    const found = await getTeamByLeadSession("lead-1")
    expect(found).toBeNull()
  })

  it("ignores cancelled teams", async () => {
    await saveTeamState(makeTeamState({ team: { id: "team-1", leadSessionID: "lead-1", status: "cancelled" } }))

    const found = await getTeamByLeadSession("lead-1")
    expect(found).toBeNull()
  })

  it("returns only the first active team found", async () => {
    // Should only return one even if by some chance there are multiple active
    await saveTeamState(makeTeamState({ team: { id: "team-1", leadSessionID: "lead-1", status: "active" } }))

    const found = await getTeamByLeadSession("lead-1")
    expect(found!.team.id).toBe("team-1")
  })
})

describe("getTeamByMemberSession", () => {
  it("finds team by member session ID", async () => {
    const state = makeTeamState({ team: { id: "team-1" } })
    state.members = [makeMember({ id: "m1", sessionID: "session-abc", teamID: "team-1", status: "active" })]
    await saveTeamState(state)

    const found = await getTeamByMemberSession("session-abc")
    expect(found).not.toBeNull()
    expect(found!.team.id).toBe("team-1")
  })

  it("returns null when no member has the session ID", async () => {
    const state = makeTeamState()
    state.members = [makeMember({ sessionID: "session-1" })]
    await saveTeamState(state)

    const found = await getTeamByMemberSession("nonexistent")
    expect(found).toBeNull()
  })

  it("returns null when no teams exist", async () => {
    const found = await getTeamByMemberSession("session-1")
    expect(found).toBeNull()
  })

  it("ignores cancelled members", async () => {
    const state = makeTeamState({ team: { id: "team-1" } })
    state.members = [makeMember({ id: "m1", sessionID: "session-1", status: "cancelled", teamID: "team-1" })]
    await saveTeamState(state)

    const found = await getTeamByMemberSession("session-1")
    expect(found).toBeNull()
  })

  it("finds member with completed status", async () => {
    const state = makeTeamState({ team: { id: "team-1" } })
    state.members = [makeMember({ id: "m1", sessionID: "session-done", status: "completed", teamID: "team-1" })]
    await saveTeamState(state)

    const found = await getTeamByMemberSession("session-done")
    expect(found).not.toBeNull()
    expect(found!.team.id).toBe("team-1")
  })
})

describe("getPendingMessages", () => {
  it("returns pending messages for a recipient", async () => {
    const msg = makeMessage({
      id: "msg-1",
      recipients: ["recipient-1", "recipient-2"],
      teamID: "team-1",
    })
    const state = makeTeamState({ team: { id: "team-1" }, messages: [msg] })
    await saveTeamState(state)

    const pending = await getPendingMessages("team-1", "recipient-1")
    expect(pending).toHaveLength(1)
    expect(pending[0]!.id).toBe("msg-1")
  })

  it("returns empty array for non-existent team", async () => {
    const pending = await getPendingMessages("nonexistent", "recipient-1")
    expect(pending).toEqual([])
  })

  it("returns empty array when team has no messages", async () => {
    await saveTeamState(makeTeamState({ team: { id: "team-1" } }))

    const pending = await getPendingMessages("team-1", "recipient-1")
    expect(pending).toEqual([])
  })

  it("does not return messages that are already delivered", async () => {
    const deliveredMsg = makeMessage({
      id: "msg-1",
      recipients: ["recipient-1"],
      teamID: "team-1",
    })
    deliveredMsg.recipientStatuses[0]!.deliveryStatus = "delivered"
    deliveredMsg.deliveryStatus = "delivered"

    const state = makeTeamState({ team: { id: "team-1" }, messages: [deliveredMsg] })
    await saveTeamState(state)

    const pending = await getPendingMessages("team-1", "recipient-1")
    expect(pending).toEqual([])
  })

  it("only returns messages where the specific recipient is pending", async () => {
    const msg = makeMessage({
      id: "msg-1",
      recipients: ["recipient-1", "recipient-2"],
      teamID: "team-1",
    })
    // Mark recipient-1 as delivered, but recipient-2 is still pending
    msg.recipientStatuses[0]!.deliveryStatus = "delivered"
    msg.recipientStatuses[1]!.deliveryStatus = "pending"

    const state = makeTeamState({ team: { id: "team-1" }, messages: [msg] })
    await saveTeamState(state)

    const pending1 = await getPendingMessages("team-1", "recipient-1")
    expect(pending1).toEqual([])

    const pending2 = await getPendingMessages("team-1", "recipient-2")
    expect(pending2).toHaveLength(1)
    expect(pending2[0]!.id).toBe("msg-1")
  })
})

describe("markMessageDelivered", () => {
  it("marks a single message as delivered for a recipient", async () => {
    const msg = makeMessage({
      id: "msg-1",
      recipients: ["recipient-1"],
      teamID: "team-1",
    })
    const state = makeTeamState({ team: { id: "team-1" }, messages: [msg] })
    await saveTeamState(state)

    await markMessageDelivered("team-1", "msg-1", "recipient-1")

    const updated = await getTeamState("team-1")
    const updatedMsg = updated!.messages[0]!
    const rs = updatedMsg.recipientStatuses.find(r => r.recipient === "recipient-1")
    expect(rs!.deliveryStatus).toBe("delivered")
  })

  it("updates overall delivery status when all recipients delivered", async () => {
    const msg = makeMessage({
      id: "msg-1",
      recipients: ["r1", "r2"],
      teamID: "team-1",
    })
    const state = makeTeamState({ team: { id: "team-1" }, messages: [msg] })
    await saveTeamState(state)

    await markMessageDelivered("team-1", "msg-1", "r1")
    await markMessageDelivered("team-1", "msg-1", "r2")

    const updated = await getTeamState("team-1")
    const updatedMsg = updated!.messages[0]!
    expect(updatedMsg.deliveryStatus).toBe("delivered")
  })

  it("does nothing for non-existent team", async () => {
    await expect(
      markMessageDelivered("nonexistent", "msg-1", "recipient-1"),
    ).resolves.toBeUndefined()
  })

  it("does nothing for non-existent message", async () => {
    const state = makeTeamState({ team: { id: "team-1" } })
    await saveTeamState(state)

    await expect(
      markMessageDelivered("team-1", "nonexistent", "recipient-1"),
    ).resolves.toBeUndefined()
  })

  it("does nothing for non-existent recipient", async () => {
    const msg = makeMessage({
      id: "msg-1",
      recipients: ["recipient-1"],
      teamID: "team-1",
    })
    const state = makeTeamState({ team: { id: "team-1" }, messages: [msg] })
    await saveTeamState(state)

    await markMessageDelivered("team-1", "msg-1", "nonexistent")

    const updated = await getTeamState("team-1")
    const rs = updated!.messages[0]!.recipientStatuses[0]!
    // Should remain unchanged
    expect(rs.deliveryStatus).toBe("pending")
  })

  it("does not affect other messages", async () => {
    const msg1 = makeMessage({ id: "msg-1", recipients: ["r1"], teamID: "team-1" })
    const msg2 = makeMessage({ id: "msg-2", recipients: ["r1"], teamID: "team-1" })
    const state = makeTeamState({
      team: { id: "team-1" },
      messages: [msg1, msg2],
    })
    await saveTeamState(state)

    await markMessageDelivered("team-1", "msg-1", "r1")

    const updated = await getTeamState("team-1")
    const msg2Rs = updated!.messages.find(m => m.id === "msg-2")!
      .recipientStatuses.find(r => r.recipient === "r1")
    expect(msg2Rs!.deliveryStatus).toBe("pending")
  })
})

describe("markAllMessagesDelivered", () => {
  it("marks all pending messages for a recipient as delivered", async () => {
    const msg1 = makeMessage({ id: "msg-1", recipients: ["r1"], teamID: "team-1" })
    const msg2 = makeMessage({ id: "msg-2", recipients: ["r1"], teamID: "team-1" })
    const state = makeTeamState({
      team: { id: "team-1" },
      messages: [msg1, msg2],
    })
    await saveTeamState(state)

    await markAllMessagesDelivered("team-1", "r1")

    const updated = await getTeamState("team-1")
    for (const msg of updated!.messages) {
      const rs = msg.recipientStatuses.find(r => r.recipient === "r1")
      expect(rs!.deliveryStatus).toBe("delivered")
    }
  })

  it("only marks messages for the specified recipient", async () => {
    const msg = makeMessage({
      id: "msg-1",
      recipients: ["r1", "r2"],
      teamID: "team-1",
    })
    const state = makeTeamState({ team: { id: "team-1" }, messages: [msg] })
    await saveTeamState(state)

    await markAllMessagesDelivered("team-1", "r1")

    const updated = await getTeamState("team-1")
    const updatedMsg = updated!.messages[0]!
    expect(
      updatedMsg.recipientStatuses.find(r => r.recipient === "r1")!.deliveryStatus,
    ).toBe("delivered")
    expect(
      updatedMsg.recipientStatuses.find(r => r.recipient === "r2")!.deliveryStatus,
    ).toBe("pending")
  })

  it("updates overall delivery status for messages with all recipients delivered", async () => {
    const msg = makeMessage({
      id: "msg-1",
      recipients: ["r1"],
      teamID: "team-1",
    })
    const state = makeTeamState({ team: { id: "team-1" }, messages: [msg] })
    await saveTeamState(state)

    await markAllMessagesDelivered("team-1", "r1")

    const updated = await getTeamState("team-1")
    expect(updated!.messages[0]!.deliveryStatus).toBe("delivered")
  })

  it("does nothing for non-existent team", async () => {
    await expect(
      markAllMessagesDelivered("nonexistent", "r1"),
    ).resolves.toBeUndefined()
  })

  it("handles team with no messages", async () => {
    await saveTeamState(makeTeamState({ team: { id: "team-1" } }))

    await expect(
      markAllMessagesDelivered("team-1", "r1"),
    ).resolves.toBeUndefined()
  })

  it("does not re-deliver already delivered messages", async () => {
    const msg = makeMessage({
      id: "msg-1",
      recipients: ["r1"],
      teamID: "team-1",
    })
    msg.recipientStatuses[0]!.deliveryStatus = "delivered"
    msg.recipientStatuses[0]!.timeUpdated = 500

    const state = makeTeamState({ team: { id: "team-1" }, messages: [msg] })
    await saveTeamState(state)

    await markAllMessagesDelivered("team-1", "r1")

    const updated = await getTeamState("team-1")
    const rs = updated!.messages[0]!.recipientStatuses[0]!
    expect(rs.deliveryStatus).toBe("delivered")
    // timeUpdated should stay at 500 (not updated again since it was already delivered)
    expect(rs.timeUpdated).toBe(500)
  })
})

describe("concurrent access safety", () => {
  it("handles concurrent saveTeamState calls safely", async () => {
    const promises = []
    for (let i = 0; i < 20; i++) {
      promises.push(
        saveTeamState(
          makeTeamState({ team: { id: `team-${i}`, name: `Team ${i}` } }),
        ),
      )
    }
    await Promise.all(promises)

    for (let i = 0; i < 20; i++) {
      const state = await getTeamState(`team-${i}`)
      expect(state).not.toBeNull()
      expect(state!.team.name).toBe(`Team ${i}`)
    }
  })

  it("handles concurrent saveDB calls safely", async () => {
    const promises = []
    for (let i = 0; i < 20; i++) {
      promises.push(saveDB({ teams: { [`team-${i}`]: makeTeamState({ team: { id: `team-${i}` } }) } }))
    }
    await Promise.all(promises)

    const db = await loadDB()
    expect(Object.keys(db.teams).length).toBeGreaterThan(0)
  })

  it("handles mixed concurrent read/write operations", async () => {
    await saveTeamState(makeTeamState({ team: { id: "shared", name: "Shared" } }))

    const ops: Promise<unknown>[] = []
    for (let i = 0; i < 10; i++) {
      ops.push(
        saveTeamState(makeTeamState({ team: { id: "shared", name: `Version ${i}` } })),
      )
      ops.push(getTeamState("shared"))
    }
    await Promise.all(ops)

    // Final state should be stable
    const final = await getTeamState("shared")
    expect(final).not.toBeNull()
  })
})

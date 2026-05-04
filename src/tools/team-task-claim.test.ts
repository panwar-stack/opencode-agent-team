const mockGetTeamForMember = vi.fn()
const mockGetActiveTeamForLead = vi.fn()
const mockClaimTask = vi.fn()

vi.mock("../team-service.js", () => ({
  getTeamForMember: mockGetTeamForMember,
  getActiveTeamForLead: mockGetActiveTeamForLead,
  claimTask: mockClaimTask,
}))

import { teamTaskClaimTool } from "./team-task-claim.js"

function createMockClient() {
  return {
    session: {
      prompt: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
      get: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
      messages: vi.fn().mockResolvedValue({}),
    },
    tui: {
      showToast: vi.fn().mockResolvedValue({}),
    },
  }
}

const context = { sessionID: "member-session-1" }

describe("teamTaskClaimTool", () => {
  let client: ReturnType<typeof createMockClient>

  beforeEach(() => {
    client = createMockClient()
    vi.clearAllMocks()
  })

  it("throws if no active team membership found", async () => {
    mockGetTeamForMember.mockResolvedValue(null)
    mockGetActiveTeamForLead.mockResolvedValue(null)

    const toolDef = teamTaskClaimTool(client)

    await expect(
      toolDef.execute({ task_id: "task-1" }, context),
    ).rejects.toThrow("No active team membership found")
  })

  it("successfully claims a task and returns formatted result", async () => {
    mockGetTeamForMember.mockResolvedValue({ id: "team-1", name: "test", goal: "x", leadSessionID: "lead-1", status: "active" })
    mockClaimTask.mockResolvedValue({ description: "Write tests", status: "in_progress" })

    const toolDef = teamTaskClaimTool(client)
    const result = await toolDef.execute({ task_id: "task-1" }, context)

    expect(result).toBe("Task claimed: Write tests [status: in_progress]")
    expect(mockClaimTask).toHaveBeenCalledWith("task-1", "member-session-1")
  })

  it("works for lead (via getActiveTeamForLead)", async () => {
    mockGetTeamForMember.mockResolvedValue(null)
    mockGetActiveTeamForLead.mockResolvedValue({ id: "team-2", name: "lead-team", goal: "x", leadSessionID: "lead-2", status: "active" })
    mockClaimTask.mockResolvedValue({ description: "Lead's claim", status: "in_progress" })

    const toolDef = teamTaskClaimTool(client)
    const result = await toolDef.execute({ task_id: "task-2" }, { sessionID: "lead-2" })

    expect(result).toBe("Task claimed: Lead's claim [status: in_progress]")
    expect(mockClaimTask).toHaveBeenCalledWith("task-2", "lead-2")
  })

  it("propagates claim errors (e.g. task not pending)", async () => {
    mockGetTeamForMember.mockResolvedValue({ id: "team-1", name: "test", goal: "x", leadSessionID: "lead-1", status: "active" })
    mockClaimTask.mockRejectedValue(new Error("Task is not pending"))

    const toolDef = teamTaskClaimTool(client)

    await expect(
      toolDef.execute({ task_id: "task-1" }, context),
    ).rejects.toThrow("Task is not pending")
  })
})

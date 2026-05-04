const mockGetTeamForMember = vi.fn()
const mockGetActiveTeamForLead = vi.fn()
const mockUpdateTask = vi.fn()

vi.mock("../team-service.js", () => ({
  getTeamForMember: mockGetTeamForMember,
  getActiveTeamForLead: mockGetActiveTeamForLead,
  updateTask: mockUpdateTask,
}))

import { teamTaskUpdateTool } from "./team-task-update.js"

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

describe("teamTaskUpdateTool", () => {
  let client: ReturnType<typeof createMockClient>

  beforeEach(() => {
    client = createMockClient()
    vi.clearAllMocks()
  })

  it("throws if no active team membership found", async () => {
    mockGetTeamForMember.mockResolvedValue(null)
    mockGetActiveTeamForLead.mockResolvedValue(null)

    const toolDef = teamTaskUpdateTool(client)

    await expect(
      toolDef.execute({ task_id: "task-1", status: "completed" }, context),
    ).rejects.toThrow("No active team membership found")
  })

  it("updates task status only", async () => {
    mockGetTeamForMember.mockResolvedValue({ id: "team-1", name: "test", goal: "x", leadSessionID: "lead-1", status: "active" })
    mockUpdateTask.mockResolvedValue({ description: "Write tests", status: "completed" })

    const toolDef = teamTaskUpdateTool(client)
    const result = await toolDef.execute({ task_id: "task-1", status: "completed" }, context)

    expect(result).toBe("Task updated: Write tests [status: completed]")
    expect(mockUpdateTask).toHaveBeenCalledWith("task-1", { status: "completed", assignee: undefined })
  })

  it("updates task assignee only", async () => {
    mockGetTeamForMember.mockResolvedValue({ id: "team-1", name: "test", goal: "x", leadSessionID: "lead-1", status: "active" })
    mockUpdateTask.mockResolvedValue({ description: "Write tests", status: "pending" })

    const toolDef = teamTaskUpdateTool(client)
    const result = await toolDef.execute({ task_id: "task-1", assignee: "agent-1" }, context)

    expect(result).toBe("Task updated: Write tests [status: pending]")
    expect(mockUpdateTask).toHaveBeenCalledWith("task-1", { status: undefined, assignee: "agent-1" })
  })

  it("updates both status and assignee", async () => {
    mockGetTeamForMember.mockResolvedValue({ id: "team-1", name: "test", goal: "x", leadSessionID: "lead-1", status: "active" })
    mockUpdateTask.mockResolvedValue({ description: "Complex task", status: "in_progress" })

    const toolDef = teamTaskUpdateTool(client)
    const result = await toolDef.execute(
      { task_id: "task-1", status: "in_progress", assignee: "agent-2" },
      context,
    )

    expect(result).toBe("Task updated: Complex task [status: in_progress]")
    expect(mockUpdateTask).toHaveBeenCalledWith("task-1", { status: "in_progress", assignee: "agent-2" })
  })

  it("updates to cancelled status", async () => {
    mockGetTeamForMember.mockResolvedValue({ id: "team-1", name: "test", goal: "x", leadSessionID: "lead-1", status: "active" })
    mockUpdateTask.mockResolvedValue({ description: "Old task", status: "cancelled" })

    const toolDef = teamTaskUpdateTool(client)
    const result = await toolDef.execute({ task_id: "task-1", status: "cancelled" }, context)

    expect(result).toBe("Task updated: Old task [status: cancelled]")
  })

  it("works for lead (via getActiveTeamForLead)", async () => {
    mockGetTeamForMember.mockResolvedValue(null)
    mockGetActiveTeamForLead.mockResolvedValue({ id: "team-2", name: "lead-team", goal: "x", leadSessionID: "lead-2", status: "active" })
    mockUpdateTask.mockResolvedValue({ description: "Lead's task", status: "in_progress" })

    const toolDef = teamTaskUpdateTool(client)
    const result = await toolDef.execute(
      { task_id: "task-2", status: "in_progress" },
      { sessionID: "lead-2" },
    )

    expect(result).toBe("Task updated: Lead's task [status: in_progress]")
    expect(mockUpdateTask).toHaveBeenCalledWith("task-2", { status: "in_progress", assignee: undefined })
  })

  it("propagates update errors (e.g. task not found)", async () => {
    mockGetTeamForMember.mockResolvedValue({ id: "team-1", name: "test", goal: "x", leadSessionID: "lead-1", status: "active" })
    mockUpdateTask.mockRejectedValue(new Error("Task not found"))

    const toolDef = teamTaskUpdateTool(client)

    await expect(
      toolDef.execute({ task_id: "bad-task", status: "completed" }, context),
    ).rejects.toThrow("Task not found")
  })
})

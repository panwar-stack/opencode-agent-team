const mockGetMemberBySession = vi.fn()
const mockSendMessage = vi.fn()

vi.mock("../team-service.js", () => ({
  getMemberBySession: mockGetMemberBySession,
  sendMessage: mockSendMessage,
}))

import { teamPlanSubmitTool } from "./team-plan-submit.js"

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

describe("teamPlanSubmitTool", () => {
  let client: ReturnType<typeof createMockClient>

  beforeEach(() => {
    client = createMockClient()
    vi.clearAllMocks()
  })

  it("throws if no active team membership found", async () => {
    mockGetMemberBySession.mockResolvedValue(null)

    const toolDef = teamPlanSubmitTool(client)

    await expect(
      toolDef.execute({ plan: "My plan" }, context),
    ).rejects.toThrow("No active team membership found")
  })

  it("throws if not in plan mode", async () => {
    mockGetMemberBySession.mockResolvedValue({
      member: { id: "m1", name: "agent", sessionID: "member-session-1", planMode: false },
      team: { id: "team-1", name: "test", goal: "x", leadSessionID: "lead-1", status: "active" },
    })

    const toolDef = teamPlanSubmitTool(client)

    await expect(
      toolDef.execute({ plan: "My plan" }, context),
    ).rejects.toThrow("You are not in plan mode")
  })

  it("sends plan message to lead and returns waiting message", async () => {
    mockGetMemberBySession.mockResolvedValue({
      member: { id: "m1", name: "plan-agent", sessionID: "member-session-1", planMode: true },
      team: { id: "team-1", name: "test", goal: "x", leadSessionID: "lead-1", status: "active" },
    })
    mockSendMessage.mockResolvedValue({ messageID: "msg-1" })

    const toolDef = teamPlanSubmitTool(client)
    const result = await toolDef.execute({ plan: "I will build the login page" }, context)

    expect(result).toBe("Plan submitted. Waiting for lead approval.")

    expect(mockSendMessage).toHaveBeenCalledWith({
      teamID: "team-1",
      sender: "member-session-1",
      recipients: ["lead-1"],
      body: expect.stringContaining("I will build the login page"),
    })

    expect(client.session.prompt).toHaveBeenCalledWith({
      body: {
        noReply: true,
        parts: [{ type: "text", text: expect.stringContaining("team_plan_decide") }],
      },
      path: { id: "lead-1" },
    })
  })

  it("handles prompt failure gracefully", async () => {
    mockGetMemberBySession.mockResolvedValue({
      member: { id: "m1", name: "plan-agent", sessionID: "member-session-1", planMode: true },
      team: { id: "team-1", name: "test", goal: "x", leadSessionID: "lead-1", status: "active" },
    })
    mockSendMessage.mockResolvedValue({ messageID: "msg-1" })
    client.session.prompt = vi.fn().mockRejectedValue(new Error("Lead session not found"))

    const toolDef = teamPlanSubmitTool(client)
    const result = await toolDef.execute({ plan: "My plan" }, context)

    expect(result).toBe("Plan submitted. Waiting for lead approval.")
  })

  it("sends plan content in the message body", async () => {
    mockGetMemberBySession.mockResolvedValue({
      member: { id: "m2", name: "builder-agent", sessionID: "member-session-2", planMode: true },
      team: { id: "team-2", name: "test2", goal: "y", leadSessionID: "lead-2", status: "active" },
    })
    mockSendMessage.mockResolvedValue({ messageID: "msg-2" })

    const toolDef = teamPlanSubmitTool(client)
    await toolDef.execute({ plan: "Build a REST API with Express" }, { sessionID: "member-session-2" })

    const sendCall = mockSendMessage.mock.calls[0][0]
    expect(sendCall.body).toContain("Build a REST API with Express")
    expect(sendCall.body).toContain("team_plan_decide")
    expect(sendCall.body).toContain("Plan from builder-agent")
  })
})

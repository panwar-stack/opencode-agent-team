import { generateTeammateSystemPrompt } from "./system-prompt.js"

const defaultParams = {
  name: "test-buddy",
  teamName: "test-team",
  teamGoal: "build great tests",
  leadSessionID: "lead-123",
  memberSessionID: "member-456",
  teamID: "team-789",
  rolePrompt: "Write unit tests for the system-prompt module",
  planMode: false,
}

describe("generateTeammateSystemPrompt", () => {
  it("includes teammate name, team name, and team goal", () => {
    const prompt = generateTeammateSystemPrompt(defaultParams)

    expect(prompt).toContain("test-buddy")
    expect(prompt).toContain("test-team")
    expect(prompt).toContain("build great tests")
  })

  it("includes lead session ID and member session ID", () => {
    const prompt = generateTeammateSystemPrompt(defaultParams)

    expect(prompt).toContain("lead-123")
    expect(prompt).toContain("member-456")
  })

  it("includes communication guidance", () => {
    const prompt = generateTeammateSystemPrompt(defaultParams)

    expect(prompt).toContain("proactive updates")
    expect(prompt).toContain("team_send_message")
    expect(prompt).toContain("team_get_messages")
    expect(prompt).toContain("team_broadcast")
  })

  it("includes the role prompt at the end", () => {
    const prompt = generateTeammateSystemPrompt(defaultParams)

    expect(prompt).toContain("### Your Task")
    expect(prompt).toContain("Write unit tests for the system-prompt module")
    // role prompt should be last
    expect(prompt.endsWith("Write unit tests for the system-prompt module")).toBe(true)
  })

  it("does NOT include Plan Mode section when planMode is false", () => {
    const prompt = generateTeammateSystemPrompt({ ...defaultParams, planMode: false })

    expect(prompt).not.toContain("Plan Mode")
    expect(prompt).not.toContain("plan_submit")
  })

  it("includes Plan Mode section when planMode is true", () => {
    const prompt = generateTeammateSystemPrompt({ ...defaultParams, planMode: true })

    expect(prompt).toContain("Plan Mode")
    expect(prompt).toContain("you cannot execute code or edit files")
    expect(prompt).toContain("team_plan_submit")
    expect(prompt).toContain("Wait for the lead to approve")
  })

  it("does NOT include dependency results section when dependencyResults is undefined", () => {
    const prompt = generateTeammateSystemPrompt({ ...defaultParams, dependencyResults: undefined })

    expect(prompt).not.toContain("Results from completed dependency teammates")
  })

  it("does NOT include dependency results section when dependencyResults is empty", () => {
    const prompt = generateTeammateSystemPrompt({ ...defaultParams, dependencyResults: [] })

    expect(prompt).not.toContain("Results from completed dependency teammates")
  })

  it("includes dependency results section when dependencyResults is provided", () => {
    const results = ["Alice completed data fetching", "Bob finished auth module"]
    const prompt = generateTeammateSystemPrompt({ ...defaultParams, dependencyResults: results })

    expect(prompt).toContain("Results from completed dependency teammates")
    expect(prompt).toContain("Alice completed data fetching")
    expect(prompt).toContain("Bob finished auth module")
  })

  it("formats the name in bold markdown", () => {
    const prompt = generateTeammateSystemPrompt(defaultParams)

    expect(prompt).toContain("**test-buddy**")
    expect(prompt).toContain('**"test-team"**')
  })
})

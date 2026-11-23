// A rehearsal's stand-in for Claude: job descriptions are read by Claude alone (src/jobReader.ts), so a rehearsal that uploads a job needs an answer, and a
// rehearsal never spends on the AI. The same test double the server tests use (test/fakeJobClaude.ts): it answers the job reader's, the CV reader's, the
// department and the matching questions, each with a fixed stand-in answer, and refuses anything else. Nothing leaves this machine.
//   node --import tsx test/live/fakeClaude.ts <port>
process.env.FAKE_CLAUDE_PORT = process.argv[2] ?? "18901";
const { FAKE_CLAUDE_URL, startFakeJobClaude } = await import("../fakeJobClaude");
await startFakeJobClaude();
console.log(`stand-in Claude: ${FAKE_CLAUDE_URL}`);
export {};

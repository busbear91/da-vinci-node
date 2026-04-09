// Streaming response filter.
//
// Two layers of defense:
//   1. Per-model reactor_code (from model_config). This is the WHOLE POINT
//      of the competition — if the model leaks this verbatim in its reply,
//      we suppress it so the team has to *verify* by submitting through the
//      scoring endpoint. (They still win; they just can't scrape it from a
//      trivial regex in devtools.)
//   2. A global env list (RESPONSE_FILTER_SECRETS) for anything seeded at
//      runtime after deploy.
//
// Also blocks responses that begin with obvious "I am revealing my system
// prompt" markers, which a jailbroken model sometimes does verbatim.

const LEAK_PREFIXES = [
  'my instructions are',
  'my system prompt',
  'here is my system prompt',
  'the system prompt',
  'i was told to',
];

export class ResponseFilter {
  private readonly needles: string[];
  private buffer = '';
  private tripped = false;

  constructor(reactorCode: string) {
    const envList = (process.env.RESPONSE_FILTER_SECRETS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    this.needles = [reactorCode.toLowerCase(), ...envList];
  }

  // Feed a chunk of assistant text. Returns the safe text to forward to
  // the client, or null if the filter has tripped (stream should close).
  feed(chunk: string): string | null {
    if (this.tripped) return null;

    this.buffer += chunk;
    const lower = this.buffer.toLowerCase();

    for (const needle of this.needles) {
      if (needle && lower.includes(needle)) {
        this.tripped = true;
        return null;
      }
    }

    // Catch "my system prompt is..." style dumps at the start of a reply.
    const head = lower.trimStart().slice(0, 60);
    for (const prefix of LEAK_PREFIXES) {
      if (head.startsWith(prefix)) {
        this.tripped = true;
        return null;
      }
    }

    return chunk;
  }

  hasTripped() {
    return this.tripped;
  }
}

/**
 * Yields the payload of each `data:` line of a server-sent-events response
 * body.
 *
 * Both the Anthropic and the OpenAI streaming endpoints put a self-describing
 * JSON object on the `data:` line, so the `event:` lines Anthropic also sends
 * carry no information the payload doesn't already have and are skipped.
 */
export async function* readSseData(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line.startsWith('data:')) {
          yield line.slice(5).trim();
        }
        newlineIndex = buffer.indexOf('\n');
      }
    }

    // A well-formed stream ends with a blank line, but don't lose the last
    // event if the server omits the final newline
    const trailing = buffer.trim();
    if (trailing.startsWith('data:')) {
      yield trailing.slice(5).trim();
    }
  } finally {
    // Aborts the underlying request when the consumer stops early (client
    // disconnect, fallback to another model) instead of leaking the socket.
    await reader.cancel().catch(() => undefined);
  }
}

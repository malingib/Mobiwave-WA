import { readBoundedResponseText } from "./renderer-response.ts";

Deno.test("reads a response within the byte limit", async () => {
  const result = await readBoundedResponseText(new Response("hello"), 5);
  if (result !== "hello") throw new Error("Expected response text to be preserved.");
});

Deno.test("rejects a response larger than the byte limit", async () => {
  let rejected = false;
  try {
    await readBoundedResponseText(new Response("hello"), 4);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Expected oversized response to be rejected.");
});

Deno.test("rejects invalid size limits", async () => {
  let rejected = false;
  try {
    await readBoundedResponseText(new Response("hello"), -1);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Expected invalid size limit to be rejected.");
});

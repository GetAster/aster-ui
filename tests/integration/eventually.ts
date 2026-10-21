/**
 * Retries `check` until it stops throwing, or throws its last error after
 * `ms`. For work a test starts but can't await (a lookup, the levels a tree
 * opens itself), whose pace is the server's, not the test's.
 */
export async function eventually(check: () => void, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  for (;;) {
    try {
      return check();
    } catch (e) {
      if (Date.now() > end) throw e;
      await Bun.sleep(10);
    }
  }
}

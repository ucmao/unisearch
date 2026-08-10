/** Maximum time reserved for user-operated sign-in flows in the crawler window. */
export const MANUAL_LOGIN_TIMEOUT_MS = 180_000;

/** Maximum time reserved for captcha, device confirmation, and risk verification. */
export const MANUAL_VERIFICATION_TIMEOUT_MS = 180_000;

/** Poll a page-specific verification detector and return as soon as the block clears. */
export async function waitForManualVerificationToClear(
  isBlocked: () => Promise<boolean>,
  wait: (milliseconds: number) => Promise<unknown>,
): Promise<boolean> {
  const deadline = Date.now() + MANUAL_VERIFICATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await wait(2_000);
    if (!(await isBlocked())) return true;
  }
  return false;
}

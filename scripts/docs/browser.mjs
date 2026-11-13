// Which Chrome to drive. Uses your installed Google Chrome by default;
// set CHROME_PATH to point at another Chromium build.
export function launchOptions() {
  const args = ['--enable-gpu', '--ignore-gpu-blocklist'];
  // headless Chrome on macOS falls back to software WebGL unless told to use Metal
  if (process.platform === 'darwin') args.push('--use-angle=metal');
  if (process.env.CHROME_PATH) return { executablePath: process.env.CHROME_PATH, headless: true, args };
  return { channel: 'chrome', headless: true, args };
}

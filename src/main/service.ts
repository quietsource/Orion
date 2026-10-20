// This binary contains Bun and the backend. There is no Electron or system Node dependency.
if (process.argv.includes('--voice-worker')) {
  await import('./voiceWorker');
} else {
  // stdout is the private, framed native bridge. Never mix application logs into it.
  console.log = (...values) => console.error(...values);
  console.info = (...values) => console.error(...values);
  await import('./main');
}
export {};

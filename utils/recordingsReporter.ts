import { copyFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';

/**
 * Copies every test's video to reports/recordings/<run time>/, named after the
 * test. Playwright's own output folder is wiped at the start of each run, so
 * without this a recording is gone as soon as the next run starts.
 */
export default class RecordingsReporter implements Reporter {
  // Local time, e.g. 2026-09-29_12-41-24, so folders match the clock on screen.
  private readonly runDir = join(
    'reports',
    'recordings',
    new Date().toLocaleString('sv-SE').replace(' ', '_').replace(/:/g, '-'),
  );
  private videos: { from: string; name: string }[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    for (const video of result.attachments.filter(a => a.name === 'video' && a.path)) {
      const project = (test.parent.project()?.name ?? 'test').replace(/[^\w-]+/g, '_');
      const title = test.title.replace(/[^\w-]+/g, '_');
      const retry = result.retry ? `_retry${result.retry}` : '';
      this.videos.push({ from: video.path!, name: `${project}__${title}${retry}__${result.status}.webm` });
    }
  }

  onEnd(): void {
    if (!this.videos.length) return;
    mkdirSync(this.runDir, { recursive: true });
    for (const v of this.videos) copyFileSync(v.from, join(this.runDir, v.name));
    console.log(`\nRecordings saved to ${this.runDir}`);
  }
}

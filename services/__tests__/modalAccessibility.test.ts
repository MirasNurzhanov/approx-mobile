// Every React Native Modal keeps a screen reader inside it.
//
// Without `accessibilityViewIsModal` on a view inside the Modal, VoiceOver reads
// straight past a transparent dialog into the screen behind it. The flag is only
// half of it: a trapped view has to hold its own way out, so where the backdrop
// is the close control it must be labelled and sit inside the trapped view.
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '__tests__') found.push(...sourceFiles(full));
    } else if (entry.name.endsWith('.tsx')) {
      found.push(full);
    }
  }
  return found;
}

const relative = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');
const modalFiles = ['app', 'components']
  .flatMap((dir) => sourceFiles(path.join(ROOT, dir)))
  .filter((file) => /<Modal\b/.test(fs.readFileSync(file, 'utf8')))
  .map(relative)
  .sort();

describe('modal accessibility', () => {
  it('finds the modals it means to check', () => {
    expect(modalFiles).toEqual(expect.arrayContaining([
      'components/TermsGate.tsx',
      'components/ReportSheet.tsx',
      'components/StoryViewer.tsx',
      'app/create-club.tsx',
      'app/clubs/[id].tsx',
    ]));
    expect(modalFiles.length).toBeGreaterThanOrEqual(15);
  });

  it.each(modalFiles)('%s marks a view inside every Modal as the accessibility modal', (file) => {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const modals = source.match(/<Modal\b/g)?.length ?? 0;
    const trapped = source.match(/\baccessibilityViewIsModal\b/g)?.length ?? 0;
    expect(trapped).toBeGreaterThanOrEqual(modals);
  });

  it.each(modalFiles)('%s labels any backdrop that closes a modal', (file) => {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    // Only what is written between a Modal's tags: a backdrop elsewhere in the
    // file belongs to an in-screen sheet, not to a modal.
    const modalBodies = source.match(/<Modal\b[\s\S]*?<\/Modal>/g) ?? [];
    for (const body of modalBodies) {
      const backdrops = body.match(/<Pressable\b[^>]*\b(modalBackdrop|backdrop)\b[^>]*\/>/g) ?? [];
      for (const tag of backdrops) {
        if (/onPress=/.test(tag)) expect(tag).toMatch(/accessibilityLabel=/);
      }
    }
  });
});

import { test, expect } from 'bun:test';
import { openUpdatePackage, type UpdatePackageKind } from '../src/main/updateHandoff';

for (const kind of ['windows-installer', 'deb', 'rpm'] as UpdatePackageKind[]) {
  test(`${kind} opens through the visible system installer`, async () => {
    const actions: string[] = [];
    await openUpdatePackage('/downloads/package', kind, {
      openPath: async file => { actions.push(`open:${file}`); return ''; },
      makeExecutable: async () => { actions.push('chmod'); },
      relaunch: () => { actions.push('relaunch'); }
    });
    expect(actions).toEqual(['open:/downloads/package']);
  });
}

test('an unavailable installer rejects the handoff so Orion can stay open', async () => {
  await expect(openUpdatePackage('/downloads/package.deb', 'deb', {
    openPath: async () => 'No application is associated with this file',
    makeExecutable: async () => {}, relaunch: () => {}
  })).rejects.toThrow('No application is associated');
});

test('AppImage is made executable before scheduling launch after shutdown', async () => {
  const actions: string[] = [];
  await openUpdatePackage('/downloads/new.AppImage', 'appimage', {
    openPath: async () => { throw new Error('Must not launch while the old app holds its lock'); },
    makeExecutable: async file => { actions.push(`chmod:${file}`); },
    relaunch: file => { actions.push(`relaunch:${file}`); }
  });
  expect(actions).toEqual(['chmod:/downloads/new.AppImage', 'relaunch:/downloads/new.AppImage']);
});

test('portable Windows launch is deferred until shutdown without replacing files', async () => {
  let launched = '';
  await openUpdatePackage('C:\\Downloads\\Orion.exe', 'windows-portable', {
    openPath: async () => { throw new Error('Cannot launch before shutdown'); },
    makeExecutable: async () => { throw new Error('Windows does not require chmod'); },
    relaunch: file => { launched = file; }
  });
  expect(launched).toBe('C:\\Downloads\\Orion.exe');
});

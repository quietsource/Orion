export type UpdatePackageKind = 'windows-installer' | 'windows-portable' | 'appimage' | 'deb' | 'rpm';

export async function openUpdatePackage(file: string, kind: UpdatePackageKind, host: {
  openPath: (file: string) => Promise<string>;
  makeExecutable: (file: string) => Promise<unknown>;
  relaunch: (file: string) => void;
}) {
  if (kind === 'appimage' || kind === 'windows-portable') {
    if (kind === 'appimage') await host.makeExecutable(file);
    // Portable executables share Orion's single-instance lock. Start the new
    // version only after the current process exits, without replacing files.
    host.relaunch(file);
    return;
  }
  const error = await host.openPath(file);
  if (error) throw new Error(`Could not open the update installer: ${error}`);
}

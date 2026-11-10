'use strict';

// Pure JavaScript PE resource editing keeps Linux and Windows builds identical.
// This sets branding/version resources, not an Authenticode signature.
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async function windowsResources(context) {
  if (context.electronPlatformName !== 'win32') return;
  const ResEdit = await import('resedit');
  const executablePath = path.join(context.appOutDir, 'Configura.exe');
  const original = await fs.readFile(executablePath);
  const executable = ResEdit.NtExecutable.from(original, { ignoreCert: true });
  const resources = ResEdit.NtExecutableResource.from(executable);
  const icon = ResEdit.Data.IconFile.from(await fs.readFile(path.join(context.packager.projectDir, 'build', 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);
  for (const group of groups.length ? groups : [{ id: 101, lang: 1033 }]) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resources.entries, group.id, group.lang, icon.icons.map(item => item.data));
  }
  const version = context.packager.appInfo.version;
  const numbers = version.split('.').map(Number);
  const versions = ResEdit.Resource.VersionInfo.fromEntries(resources.entries);
  if (!versions.length) throw new Error('The Electron executable has no version resource.');
  for (const info of versions) {
    info.setFileVersion(numbers[0], numbers[1], numbers[2], 0, 1033);
    info.setProductVersion(numbers[0], numbers[1], numbers[2], 0, 1033);
    info.setStringValues({ lang: 1033, codepage: 1200 }, {
      CompanyName: 'Deimox', FileDescription: 'Configura — Configuration Editor', ProductName: 'Configura',
      InternalName: 'Configura', OriginalFilename: 'Configura.exe', LegalCopyright: 'Copyright (c) 2026 Deimox. MIT License.',
      FileVersion: version, ProductVersion: version,
    });
    info.outputToResourceEntries(resources.entries);
  }
  resources.outputResource(executable);
  const result = Buffer.from(executable.generate());
  const checked = ResEdit.NtExecutable.from(result);
  const checkedResources = ResEdit.NtExecutableResource.from(checked);
  if (checked.is32bit() || !ResEdit.Resource.IconGroupEntry.fromEntries(checkedResources.entries).length) throw new Error('Invalid Windows x64 resources after branding.');
  await fs.writeFile(executablePath, result);
};

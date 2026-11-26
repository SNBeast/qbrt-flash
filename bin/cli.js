#!/usr/bin/env node

/* Copyright 2017 Mozilla
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License. */

import AdmZip from 'adm-zip';
import { create } from 'tar';
import fs from 'fs-extra';
import { getPlatformDirectories } from './directory-utils.js';
import { isRuntimeInstalled, installRuntime } from './install-runtime.js';
import klaw from 'klaw';
import os from 'os';
import path from 'path';
import * as PELibrary from 'pe-library';
import pify from 'pify';
import plist from 'simple-plist';
import { readFile } from 'fs/promises';
import * as ResEdit from 'resedit';
import semver from 'semver';
import { spawn } from 'child_process';

export default function packageApp(packageDir, platform, arch) {
  if (!['windows', 'macos', 'linux'].includes(platform)) {
    throw new Error('Packages can only be created for the "windows", "macos", and "linux" platforms.');
  }

  if (!['ia32', 'x64', 'armv7l'].includes(arch)) {
    throw new Error('Packages can only be created for the "ia32", "x64", and "armv7l" architectures');
  }

  if (arch === 'armv7l' && platform !== 'linux') {
    throw new Error('armv7l builds can only be created for Linux.');
  }

  if (platform === 'macos' && process.platform !== 'darwin') {
    throw new Error('macOS packages can only be created on macOS.');
  }

  const { buildSupportDir, installDir, shellDir } = getPlatformDirectories(platform, arch);

  let appName;
  let appJson;
  let appTargetDir;
  let appVersion;
  let appAuthor;
  let packageFile;
  let tempDir;
  let stageDir;

  let runtimeCheck;
  if (isRuntimeInstalled(platform, arch)) {
    runtimeCheck = Promise.resolve();
  }
  else {
    runtimeCheck = installRuntime(platform, arch);
  }

  runtimeCheck.then(() => readFile(path.join(packageDir, 'app.json')).then(data => JSON.parse(data)).catch(abort))
  .then(appJsonResult => {
    appJson = appJsonResult;
    appName = appJson.name;
    appVersion = appJson.version;
    appAuthor = appJson.author?.name;
    packageFile = `${appName}.` + (appVersion ? `v${appVersion}.` : '') + arch +
      { windows: '.zip', macos: '.dmg', linux: '.tgz' }[platform];
    console.log(`Packaging ${appName} -> ${packageFile}...`);
    return fs.remove(packageFile).catch(abort);
  })
  .then(() => fs.mkdtemp(path.join(os.tmpdir(), `${appName}-`)).catch(abort))
  .then(tempDirArg => {
    tempDir = tempDirArg;
    const stageDirName = platform === 'macos' ? `${appName}.app` : appName;
    stageDir = path.join(tempDir, stageDirName);
    appTargetDir = platform === 'macos' ?
      path.join(stageDir, 'Contents', 'Resources', 'webapp') :
      path.join(stageDir, 'webapp');

    // Copy the runtime to the staging dir.
    return fs.copy(installDir, stageDir).catch(abort);
  })
  .then(() => {
    if (platform === 'windows') {
      // Copy shim launcher which is set to the app's name.
      const source = path.join(buildSupportDir, 'shim.exe');
      const dest = path.join(stageDir, `${appName}.exe`);
      return fs.copy(source, dest).catch(abort);
    }
    else {
      // Rename executable to the app's name.
      const exeDir = platform === 'macos' ? path.join(stageDir, 'Contents', 'MacOS') : stageDir;
      const source = path.join(exeDir, 'launcher.sh');
      const target = path.join(exeDir, appName);
      return fs.move(source, target).catch(abort);
    }
  })
  .then(() => {
    const resDir = platform === 'macos' ? path.join(stageDir, 'Contents', 'Resources') : stageDir;
    const iniFile = path.join(resDir, 'qbrt', 'application.ini');
    return fs.readFile(iniFile)
    .then(contents => fs.writeFile(
      iniFile,
      Buffer.from(contents.toString('utf-8').replace('Name=qbrt-flash', `Name=${appName}`), 'utf-8'),
    ).catch(abort)).catch(abort);
  })
  .then(() => {
    if (platform === 'macos') {
      const contentsDir = path.join(stageDir, 'Contents');
      const resourcesDir = path.join(contentsDir, 'Resources');
      const plistFile = path.join(contentsDir, 'Info.plist');
      return pify(plist.readFile)(plistFile)
      .then(appPlist => {
        appPlist.CFBundleExecutable = appName;
        appPlist.CFBundleName = appName;
        appPlist.CFBundleGetInfoString = `${appName} ${appVersion}`;
        appPlist.CFBundleIdentifier = appJson.identifier
          ?? `com.qbrt-flash.${appAuthor}.${appName}`.toLowerCase();
        appPlist.LSApplicationCategoryType = 'public.app-category.games';
        delete appPlist.CFBundleDocumentTypes;
        delete appPlist.CFBundleURLTypes;
        return pify(plist.writeFile)(plistFile, appPlist)
        .then(() =>
          fs.copy(
            path.join(packageDir, 'mac_icon.icns'),
            path.join(resourcesDir, appPlist.CFBundleIconFile),
            { overwrite: true },
          ).catch(abort),
        )
        // this is so far the only translation folder they have, and it just sets the bundle name
        .then(() => fs.remove(path.join(resourcesDir, 'en.lproj')).catch(abort)).catch(abort);
      });
    }
    else if (platform === 'windows') {
      const icoPath = path.join(packageDir, 'win_icon.ico');
      return editIcon(path.join(stageDir, `${appName}.exe`), icoPath, appJson)
      .then(() => editIcon(path.join(stageDir, 'platform.exe'), icoPath, appJson).catch(abort)).catch(abort);
    }
  })
  .then(() => {
    // Copy the app to the stage directory.
    const customShell = path.join(packageDir, 'shell');
    return fs.exists(customShell)
    .then(result => fs.copy(result ? customShell : shellDir, appTargetDir, { overwrite: true }).catch(abort))
    .then(() => fs.copy(path.join(packageDir, 'app.json'), path.join(appTargetDir, 'app.json'), { overwrite: true })
    .catch(abort)).catch(abort);
  })
  .then(() => {
    if (platform === 'macos') {
      const hdiutilArgs = ['create', '-fs', 'HFS+', '-srcfolder', stageDir];
      return new Promise((resolve, reject) => {
        // macOS 10.9 (Mavericks) has a bug in hdiutil that causes image
        // creation to fail with obscure error -5341.  The problem doesn't seem
        // to exist in earlier and later macOS versions, and the workaround
        // causes the image to be larger than necessary (due to padding
        // that avoids a resize), so we only do it on macOS 10.9.
        if (semver.major(os.release()) === 13) {
          let totalSizeInBytes = 0;
          klaw(stageDir)
          .on('data', item => {
            totalSizeInBytes += item.stats.size;
          })
          .on('end', () => {
            // Tests succeed with padding as low as 15MiB on my macOS 10.9 VM.
            const size = (Math.ceil(totalSizeInBytes/1024/1024) + 15) + 'm';
            hdiutilArgs.push('-size', size);
            resolve();
          });
        }
        else {
          resolve();
        }
      })
      .then(() => new Promise((resolve, reject) => {
        hdiutilArgs.push(packageFile);
        const child = spawn('hdiutil', hdiutilArgs, { stdio: 'inherit' });
        child.on('exit', resolve);
        // TODO: handle errors returned by hdiutil.
      }).catch(abort)).catch(abort);
    }
    else if (platform === 'linux') {
      return create({ file: packageFile, cwd: stageDir, portable: true, gzip: true }, ['.']);
    }
    else if (platform === 'windows') {
      let zipFile = new AdmZip();
      return zipFile.addLocalFolderPromise(stageDir, { zipPath: path.basename(stageDir) })
      .then(() => zipFile.writeZipPromise(packageFile, { overwrite: true }).catch(abort)).catch(abort);
    }
  })
  .then(() => console.log('Packaging succeeded!')).catch(abort)
  .finally(() => fs.remove(stageDir).catch(abort));
}

function editIcon(exePath, icoPath, appJson) {
  return fs.readFile(exePath)
  .then(data => {
    const exe = PELibrary.NtExecutable.from(data, { ignoreCert: true });
    const res = PELibrary.NtExecutableResource.from(exe);
    return fs.readFile(icoPath)
    .then(ico => {
      const icon = ResEdit.Data.IconFile.from(ico);
      const iconGroups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
      if (!iconGroups.length) {
        ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
          res.entries,
          1,
          0,
          icon.icons.map(item => item.data),
        );
      }
      else {
        ResEdit.Resource.IconGroupEntry.fromEntries(res.entries).map(entry => {
          ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
            res.entries,
            entry.id,
            0,
            icon.icons.map(item => item.data),
          );
        });
      }
      const version = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0] ?? new ResEdit.Resource.VersionInfo;
      version.setStringValues(
        { lang: 0, codepage: 1200 },
        {
          FileDescription: appJson.name,
          ProductName: appJson.name,
          ProductVersion: appJson.version,
        },
      );
      version.outputToResourceEntries(res.entries);
      res.outputResource(exe);
      fs.writeFile(exePath, Buffer.from(exe.generate()));
    }).catch(abort);
  }).catch(abort);
}

function abort(error) {
  console.error(error);
  console.log('Packaging failed!');
  throw error;
} 

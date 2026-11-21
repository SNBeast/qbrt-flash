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

export default function packageApp(packageDir, platform) {
  let legacy = false;

  if (platform === 'darwinLegacy') {
    platform = 'darwin';
    legacy = true;
  }

  if (platform === 'darwin' && process.platform !== 'darwin') {
    throw new Error('macOS packages can only be created on macOS.');
  }

  if (!['win32', 'darwin'].includes(platform)) {
    throw new Error('Only "win32", "darwin", and "darwinLegacy" packages can be created.');
  }

  const { buildDir, installDir } = getPlatformDirectories(platform, legacy);

  let appName;
  let appJson;
  let appTargetDir;
  let appVersion;
  let appAuthor;
  let packageFile;
  let tempDir;
  let stageDir;

  let runtimeCheck;
  if (isRuntimeInstalled(platform, legacy)) {
    runtimeCheck = Promise.resolve();
  }
  else {
    runtimeCheck = installRuntime(platform, legacy);
  }

  runtimeCheck.then(() => {
    return readFile(path.join(packageDir, 'app.json'))
    .then(data => {
      return JSON.parse(data);
    })
    .catch((error) => {
      console.error(error);
      console.log('Packaging failed!');
      throw error;
    });
  })
  .then(appJsonResult => {
    appJson = appJsonResult;
    appName = appJson.name;
    appVersion = appJson.version;
    appAuthor = appJson.author.name;
    packageFile = `${appName}.` + (appVersion ? `v${appVersion}.` : '') + (legacy ? 'legacy.' : '') +
      { win32: 'zip', darwin: 'dmg'/*, linux: 'tgz'*/ }[platform];
    console.log(`Packaging ${appName} -> ${packageFile}...`);
    return pify(fs.remove)(packageFile)
    .catch((error) => {
      console.error(error);
      console.log('Packaging failed!');
    });
  })
  .then(() => {
    return pify(fs.mkdtemp)(path.join(os.tmpdir(), `${appName}-`))
    .catch((error) => {
      console.error(error);
      console.log('Packaging failed!');
      throw error;
    });
  })
  .then(tempDirArg => {
    tempDir = tempDirArg;
    const stageDirName = platform === 'darwin' ? `${appName}.app` : appName;
    stageDir = path.join(tempDir, stageDirName);
    appTargetDir = platform === 'darwin' ?
      path.join(stageDir, 'Contents', 'Resources', 'webapp') :
      path.join(stageDir, 'webapp');

    // Copy the runtime to the staging dir.
    return pify(fs.copy)(installDir, stageDir)
    .catch((error) => {
      console.error(error);
      console.log('Packaging failed!');
      throw error;
    });
  })
  .then(() => {
    if (platform === 'win32') {
      // Copy shim launcher which is set to the app's name.
      const source = path.join(buildDir, 'shim.exe');
      const dest = path.join(stageDir, `${appName}.exe`);
      return pify(fs.copy)(source, dest)
      .catch((error) => {
        console.error(error);
        console.log('Packaging failed!');
        throw error;
      });
    }
    else {
      // Rename executable to the app's name.
      const exeDir = platform === 'darwin' ? path.join(stageDir, 'Contents', 'MacOS') : stageDir;
      const source = path.join(exeDir, 'launcher.sh');
      const target = path.join(exeDir, appName);
      return pify(fs.move)(source, target)
      .catch((error) => {
        console.error(error);
        console.log('Packaging failed!');
        throw error;
      });
    }
  })
  .then(() => {
    const resDir = platform === 'darwin' ? path.join(stageDir, 'Contents', 'Resources') : stageDir;
    const iniFile = path.join(resDir, 'qbrt', 'application.ini');
    return fs.readFile(iniFile)
    .then((contents) => {
      return fs.writeFile(
        iniFile,
        Buffer.from(contents.toString('utf-8').replace('Name=qbrt-flash', `Name=${appName}`), 'utf-8'),
      )
      .catch((error) => {
        console.error(error);
        console.log('Packaging failed!');
        throw error;
      });
    })
    .catch((error) => {
      console.error(error);
      console.log('Packaging failed!');
      throw error;
    });
  })
  .then(() => {
    if (platform === 'darwin') {
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
        .then(() => {
          return pify(fs.copy)(
            path.join(packageDir, 'mac_icon.icns'),
            path.join(resourcesDir, appPlist.CFBundleIconFile),
            { overwrite: true },
          )
          .catch((error) => {
            console.error(error);
            console.log('Packaging failed!');
            throw error;
          });
        })
        .then(() => {
          // this is so far the only translation folder they have, and it just sets the bundle name
          return fs.remove(path.join(resourcesDir, 'en.lproj'))
          .catch((error) => {
            console.error(error);
            console.log('Packaging failed!');
            throw error;
          });
        })
        .catch((error) => {
          console.error(error);
          console.log('Packaging failed!');
          throw error;
        });
      });
    }
    else if (platform === 'win32') {
      const icoPath = path.join(packageDir, 'win_icon.ico');
      return editIcon(path.join(stageDir, `${appName}.exe`), icoPath, appJson)
      .then(() => {
        return editIcon(path.join(stageDir, 'platform.exe'), icoPath, appJson)
        .catch((error) => {
          console.error(error);
          console.log('Packaging failed!');
          throw error;
        });
      })
      .catch((error) => {
        console.error(error);
        console.log('Packaging failed!');
        throw error;
      });
    }
  })
  .then(() => {
    // Copy the app to the stage directory.
    const defaultShell = path.join(import.meta.dirname, '..', 'shell');
    const customShell = path.join(packageDir, 'shell');
    return fs.exists(customShell)
    .then((result) => {
      return pify(fs.copy)(result ? customShell : defaultShell, appTargetDir, { overwrite: true })
      .catch((error) => {
        console.error(error);
        console.log('Packaging failed!');
        throw error;
      });
    })
    .then(() => {
      return pify(fs.copy)(path.join(packageDir, 'app.json'), path.join(appTargetDir, 'app.json'), { overwrite: true })
      .catch((error) => {
        console.error(error);
        console.log('Packaging failed!');
        throw error;
      });
    })
    .catch((error) => {
      console.error(error);
      console.log('Packaging failed!');
      throw error;
    });
  })
  .then(() => {
    if (platform === 'darwin') {
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
      .then(() => {
        return new Promise((resolve, reject) => {
          hdiutilArgs.push(packageFile);
          const child = spawn('hdiutil', hdiutilArgs, { stdio: 'inherit' });
          child.on('exit', resolve);
          // TODO: handle errors returned by hdiutil.
        })
        .catch((error) => {
          console.error(error);
          console.log('Packaging failed!');
          throw error;
        });
      })
      .catch((error) => {
        console.error(error);
        console.log('Packaging failed!');
        throw error;
      });
    }
    /*else if (platform === 'linux') {
      return new Promise((resolve, reject) => {
        const tarFile = fs.createWriteStream(packageFile);
        const archive = new Archiver('tar', { gzip: true }); // TODO: replace
        tarFile.on('close', resolve);
        archive.on('error', reject);
        archive.pipe(tarFile);
        archive.directory(stageDir, path.basename(stageDir));
        archive.finalize();
      });
    }*/
    else if (platform === 'win32') {
      let zipFile = new AdmZip();
      return zipFile.addLocalFolderPromise(stageDir, { zipPath: path.basename(stageDir) })
      .then(() => {
        return zipFile.writeZipPromise(packageFile, { overwrite: true })
        .catch((error) => {
          console.error(error);
          console.log('Packaging failed!');
          throw error;
        });
      })
      .catch((error) => {
        console.error(error);
        console.log('Packaging failed!');
        throw error;
      });
    }
  })
  .then(() => {
    console.log('Packaging succeeded!');
  })
  .catch((error) => {
    console.error(error);
    console.log('Packaging failed!');
  })
  .finally(() => {
    return fs.remove(stageDir)
    .catch((error) => {
      console.error(error);
      console.log('Packaging failed!');
      throw error;
    });
  });
}

function editIcon(exePath, icoPath, appJson) {
  return fs.readFile(exePath)
  .then((data) => {
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
    })
    .catch((error) => {
      console.error(error);
      console.log('Packaging failed!');
      throw error;
    });
  })
  .catch((error) => {
    console.error(error);
    console.log('Packaging failed!');
    throw error;
  });
}

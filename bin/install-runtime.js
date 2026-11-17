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

import _7z from '7zip-min';
import AdmZip from 'adm-zip';
import fs from 'fs-extra';
import { getPlatformDirectories } from './directory-utils.js';
import https from 'https';
import { installXULApp } from './install-xulapp.js';
import os from 'os';
import packageJson from '../package.json' with { type: 'json' };
import path from 'path';
import pify from 'pify';
import plist from 'simple-plist';
import { readFile, writeFile } from 'fs/promises';
import { spawn } from 'child_process';

// TODO: automate getting the latest versions
const downloadLinks = {
  darwin: 'https://dl.basilisk-browser.org/basilisk-20261031192347.intel64.dmg',
  darwinLegacy: 'https://github.com/rmottola/Arctic-Fox/releases/download/v47.3/arcticfox-47.3.en-US.mac32-10.6.dmg',
  libCpp: 'https://github.com/rmottola/Arctic-Fox/releases/download/v47.2/libc++-from-MP-10.6-mac32.zip',
};

const fileExtensions = {
  darwin: 'dmg',
  darwinLegacy: 'dmg',
  libCpp: 'zip',
};

export function installRuntime(platform, legacy) {
  let tempDir, mountPoint, filePath, fileStream;

  const { buildDir, distDir, installDir, resourcesDir, executableDir } = getPlatformDirectories(platform, legacy);
  const browserJAR = path.join(resourcesDir, 'browser', 'omni.ja');

  return Promise.resolve()
  .then(() => {
    return pify(fs.ensureDir)(distDir);
  })
  .then(() => {
    return pify(fs.mkdtemp)(path.join(os.tmpdir(), `${packageJson.name}-`));
  })
  .then(tempDirArg => {
    tempDir = tempDirArg;
    mountPoint = path.join(tempDir, 'volume');
  })
  .then(() => {
    if (platform !== 'win32') {
      return new Promise((resolve, reject) => {
        function download(url) {
          https.get(url, function(response) {
            if (response.headers.location) {
              download(response.headers.location);
            }
            else {
              resolve(response);
            }
          }).on('error', reject);
        }
        download(downloadLinks[platform + (legacy ? 'Legacy' : '')]);
      });
    }
  })
  .then((response) => {
    if (platform !== 'win32') {
      const extension = fileExtensions[platform + (legacy ? 'Legacy' : '')];
      filePath = path.join(tempDir, `runtime.${extension}`);
      fileStream = fs.createWriteStream(filePath);
      response.pipe(fileStream);

      return new Promise((resolve, reject) => {
        fileStream.on('finish', resolve);
        response.on('error', reject);
      });
    }
  })
  .then(() => {
    if (platform === 'win32') {
      // TODO: something not this ugly
      // sourced from https://rtfreesoft.blogspot.com/search/label/browser
      const source = path.join(buildDir, 'basilisk52-g4.8.win32-git-20261114-3219d2d-uxp-f0c6d61861-xpmod-ia32.7z');
      const destination = distDir;
      const npapiDLL = 'NPSWF32_32_0_0_371.dll';
      return pify(fs.remove)(path.join(destination, 'runtime'))
      .then(() => {
        return _7z.unpack(source, destination);
      })
      .then(() => {
        return pify(fs.rename)(path.join(destination, 'basilisk'), path.join(destination, 'runtime'));
      })
      .then(() => {
        return pify(fs.copy)(path.join(buildDir, npapiDLL), path.join(executableDir, 'plugins', npapiDLL));
      });
    }
    else if (platform === 'darwin') {
      return (new Promise((resolve, reject) => {
        const child = spawn(
          'hdiutil',
          [ 'attach', filePath, '-mountpoint', mountPoint, '-nobrowse', '-quiet' ],
          {
            stdio: 'inherit',
          },
        );
        child.on('exit', resolve);
        child.on('error', reject);
      }))
      .then((exitCode) => {
        if (exitCode) {
          throw new Error(`'hdiutil attach' exited with code ${exitCode}`);
        }
      })
      .then(() => {
        const source = path.join(mountPoint, legacy ? 'ArcticFox.app' : 'Basilisk.app');
        // Unlike Windows and Linux, where the destination is the parent dir,
        // on Mac the destination is the installation dir itself, because we've
        // already expanded the archive (DMG) and are copying the dir inside it.
        //
        // We give the destination a different name so searching for "Basilisk"
        // in Spotlight doesn't return this copy.
        //
        const destination = path.join(distDir, 'Runtime.app');

        return pify(fs.remove)(destination)
        .then(() => {
          return pify(fs.copy)(source, destination);
        });
      })
      .then(() => {
        return new Promise((resolve, reject) => {
          const child = spawn(
            'hdiutil',
            [ 'detach', mountPoint, '-quiet' ],
            {
              stdio: 'inherit',
            },
          );
          child.on('exit', resolve);
          child.on('error', reject);
        });
      })
      .then((exitCode) => {
        if (exitCode) {
          throw new Error(`'hdiutil detach' exited with code ${exitCode}`);
        }
      })
      .then(() => {
        if (legacy) {
          const source = path.join(tempDir, 'lib_cpp');
          return new Promise((resolve, reject) => {
            function download(url) {
              https.get(url, function(response) {
                if (response.headers.location) {
                  download(response.headers.location);
                }
                else {
                  resolve(response);
                }
              }).on('error', reject);
            }
            download(downloadLinks['libCpp']);
          })
          .then((response) => {
            filePath = path.join(tempDir, 'lib_cpp.zip');
            fileStream = fs.createWriteStream(filePath);
            response.pipe(fileStream);

            return new Promise((resolve, reject) => {
              fileStream.on('finish', resolve);
              response.on('error', reject);
            });
          })
          .then(() => {
            return new AdmZip(filePath).extractAllToAsync(source, true);
          })
          .then(() => {
            return new Promise((resolve, reject) => {
              const child = spawn('bash', [path.join(buildDir, 'bundle_libs.sh'), installDir, source]);
              child.on('exit', resolve);
              child.on('error', reject);
            });
          });
        }
      })
      .then(() => {
        const source = path.join(buildDir, `Flash.mac${legacy ? 'Legacy' : ''}.zip`);
        const destination = path.join(executableDir, 'plugins');

        return new AdmZip(source).extractAllToAsync(destination, true);
      });
    }
    /*else if (platform === 'linux') {
      const source = filePath;
      const destination = distDir;
      return pify(fs.remove)(path.join(destination, 'runtime'))
      .then(() => {
        return decompress(source, destination); // TODO: replace me
      })
      .then(() => {
        return pify(fs.rename)(path.join(destination, 'basilisk'), path.join(destination, 'runtime'));
      });
    }*/
  })
  .then(() => {
    return installXULApp(platform, legacy);
  })
  .then(() => {
    // Expand the browser xulapp's JAR archive so we can access its devtools.
    // We have to expand it into a subdirectory of qbrt's xulapp directory,
    // because chrome manifests can't reference super-directories.

    // TODO: limit expansion to browser files that are necessary for devtools.

    const targetDir = path.join(resourcesDir, 'qbrt', 'browser');
    return new AdmZip(browserJAR).extractAllToAsync(targetDir, true);
  })
  .then(() => {
    // Copy devtools pref files from browser to qbrt.

    const sourceDir = path.join(resourcesDir, 'qbrt', 'browser', 'defaults', 'preferences');
    const targetDir = path.join(resourcesDir, 'qbrt', 'defaults', 'preferences');

    const prefFiles = [
      'debugger.js',
      'devtools-client.js',
      'devtools-startup.js',
      'devtools.js',
    ];

    return Promise.all(prefFiles.map(file => {
      if (fs.pathExistsSync(path.join(sourceDir, file))) {
        pify(fs.copy)(path.join(sourceDir, file), path.join(targetDir, file));
      }
    }));
  })
  .then(() => {
    // Copy and configure the stub executable.

    switch (platform) {
      case 'win32': {
        // Copy the stub executable to the executable dir.
        return pify(fs.copy)(
          path.join(import.meta.dirname, '..', 'launcher.bat'),
          path.join(executableDir, 'launcher.bat'),
        );
      }
      case 'darwin': {
        return pify(fs.copy)(
          path.join(import.meta.dirname, '..', 'launcher.sh'),
          path.join(executableDir, 'launcher.sh'),
        )
        .then(() => {
          return readFile(path.join(executableDir, 'launcher.sh'), 'utf-8')
          .then((content) => {
            content = content.replaceAll('MOZ_RESOURCES_DIR=\'\'', 'MOZ_RESOURCES_DIR=\'../Resources/\'');
            if (legacy) {
              content = content.replaceAll('MOZ_APP_NAME=basilisk', 'MOZ_APP_NAME=arcticfox');
            }
            return writeFile(path.join(executableDir, 'launcher.sh'), content, 'utf-8');
          });
        })
        .then(() => {
          // Configure the bundle to run the stub executable.
          const plistFile = path.join(installDir, 'Contents', 'Info.plist');
          return pify(plist.readFile)(plistFile)
          .then(appPlist => {
            appPlist.CFBundleExecutable = 'launcher.sh';
            return pify(plist.writeFile)(plistFile, appPlist);
          });
        });
      }
      /*case 'linux': {
        // Copy the stub executable to the executable dir.
        return pify(fs.copy)(
          path.join(import.meta.dirname, '..', 'launcher.sh'), path.join(executableDir, 'launcher.sh')
        );
      }*/
    }
  })
  .catch(error => {
    if (fileStream) {
      fileStream.end();
    }
    throw error;
  })
  .finally(() => {
    return pify(fs.remove)(tempDir);
  });
}

export function isRuntimeInstalled(platform, legacy) {
  const { distDir } = getPlatformDirectories(platform, legacy);
  return fs.existsSync(distDir);
}

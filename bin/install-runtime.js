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
import { extract } from 'tar';
import { extractFile } from 'tar-xz/file';
import fs from 'fs-extra';
import { getPlatformDirectories } from './directory-utils.js';
import os from 'os';
import path from 'path';
import pify from 'pify';
import { pipeline } from 'stream/promises';
import plist from 'simple-plist';
import { readFile, writeFile } from 'fs/promises';
import { spawn } from 'child_process';

// TODO: automate getting the latest versions
const downloadLinks = {
  linux_ia32: 'https://dl.basilisk-browser.org/basilisk-20261101175419.linux-i686-gtk2.tar.xz',
  linux_x64: 'https://dl.basilisk-browser.org/basilisk-20261101194424.linux-x86_64-gtk2.tar.xz',
  linux_armv7l: 'https://dl.basilisk-browser.org/basilisk-20261031192504.linux-gnueabihf-armv7l-gtk3.tar.xz',
  macos_ia32: 'https://github.com/Jazzzny/interweb55-snowleopard/releases/latest/download/InterWeb-32bit.zip',
  macos_x64: 'https://dl.basilisk-browser.org/basilisk-20261031192347.intel64.dmg',
  flash32SnowLeopard: 'https://powerfox.org/assets/downloads/Flash%20Player%2032%20for%20Snow%20Leopard.dmg',
};

const fileExtensions = {
  linux_ia32: 'txz',
  linux_x64: 'txz',
  linux_armv7l: 'txz',
  macos_ia32: 'zip',
  macos_x64: 'dmg',
};

const downloadFile = (link, out) => fetch(link).then(response => pipeline(response.body, fs.createWriteStream(out)));

export function installRuntime(platform, arch) {
  let tempDir, mountPoint;

  const {
    buildSupportDir,
    qbrtDir,
    buildID,
    distDir,
    installDir,
    resourcesDir,
    executableDir,
  } = getPlatformDirectories(platform, arch);

  return fs.ensureDir(distDir)
  .then(() => fs.mkdtemp(path.join(os.tmpdir(), 'qbrt-flash-')))
  .then(tempDirArg => mountPoint = path.join(tempDir = tempDirArg, 'volume'))
  .then(() => {
    if (platform === 'windows') {
      // TODO: something not this ugly
      // sourced from https://rtfreesoft.blogspot.com/search/label/browser
      const source = path.join(
        buildSupportDir,
        arch === 'ia32' ? 'basilisk52-g4.8.win32-git-20261121-3219d2d-uxp-b31889fa94-xpmod-ia32.7z'
          : 'basilisk52-g4.8.win64-git-20261121-3219d2d-uxp-b31889fa94-xpmod.7z',
      );
      const npapiDLL = arch === 'ia32' ? 'NPSWF32_32_0_0_371.dll' : 'NPSWF64_32_0_0_371.dll';
      const containerExe = 'FlashPlayerPlugin_32_0_0_371.exe';
      return fs.remove(installDir)
      .then(() => _7z.unpack(source, distDir))
      .then(() => fs.rename(path.join(distDir, 'basilisk'), installDir))
      .then(() => fs.copy(path.join(buildSupportDir, npapiDLL), path.join(executableDir, 'plugins', npapiDLL)))
      .then(() => fs.copy(path.join(buildSupportDir, containerExe), path.join(executableDir, 'plugins', containerExe)));
    }
    else {
      const filePath = path.join(tempDir, `runtime.${fileExtensions[buildID]}`);
      return downloadFile(downloadLinks[buildID], filePath)
      .then(() => platform === 'macos' ?
        (arch === 'ia32' ?
          new AdmZip(filePath).extractAllToAsync(mountPoint, true, true)
          : new Promise((resolve, reject) => {
            const child = spawn(
              'hdiutil',
              [ 'attach', filePath, '-mountpoint', mountPoint, '-nobrowse', '-quiet' ],
              {
                stdio: 'inherit',
              },
            );
            child.on('exit', resolve);
            child.on('error', reject);
          })
          .then(exitCode => {
            if (exitCode) {
              throw new Error(`'hdiutil attach' exited with code ${exitCode}`);
            }
          })
        )
        .then(() => fs.remove(installDir))
        // Unlike Windows and Linux, where the destination is the parent dir,
        // on Mac the destination is the installation dir itself, because we've
        // already expanded the archive (DMG) and are copying the dir inside it.
        //
        // We give the destination a different name so searching for "Basilisk"
        // in Spotlight doesn't return this copy.
        //
        .then(() => fs.copy(path.join(mountPoint, (arch === 'ia32') ? 'InterWeb.app' : 'Basilisk.app'), installDir))
        .then(() => {
          if (arch === 'ia32') {
            const flashPath = path.join(tempDir, 'flash_snow_leopard.dmg');
            mountPoint = path.join(tempDir, 'flash');
            return downloadFile(downloadLinks['flash32SnowLeopard'], flashPath)
            .then(() => new Promise((resolve, reject) => {
              const child = spawn(
                'hdiutil',
                [ 'attach', flashPath, '-mountpoint', mountPoint, '-nobrowse', '-quiet' ],
                {
                  stdio: 'inherit',
                },
              );
              child.on('exit', resolve);
              child.on('error', reject);
            }),
            )
            .then(exitCode => {
              if (exitCode) {
                throw new Error(`'hdiutil attach' exited with code ${exitCode}`);
              }
            })
            .then(() => fs.copy(path.join(mountPoint, 'payload', 'i386'), path.join(executableDir, 'plugins')));
          }
          else {
            const source = path.join(buildSupportDir, 'Flash.mac.zip');
            const destination = path.join(executableDir, 'plugins');
            return new AdmZip(source).extractAllToAsync(destination, true);
          }
        })
        .then(() => 
          new Promise((resolve, reject) => {
            // this has to be done because the ia32 branch just came off of copying from the directory
            setTimeout(() => {
              // each architecture path mounts one thing
              const child = spawn(
                'hdiutil',
                [ 'detach', mountPoint, '-quiet' ],
                {
                  stdio: 'inherit',
                },
              );
              child.on('exit', resolve);
              child.on('error', reject);
            }, 5000);
          }),
        )
        .then(exitCode => {
          if (exitCode) {
            throw new Error(`'hdiutil detach' exited with code ${exitCode}`);
          }
        })
        : fs.remove(installDir)
        .then(() => extractFile(filePath, { cwd: distDir }))
        .then(() => fs.rename(path.join(distDir, 'basilisk'), installDir))
        .then(() => {
          const pluginDir = path.join(executableDir, 'plugins');
          if (arch === 'armv7l') {
            // ARM Flash Player only existed as a PPAPI plugin, so an NPAPI shim is needed
            const wrapperZip = path.join(tempDir, 'freshplayerplugin-armhf.zip');
            const wrapperSo = 'libfreshwrapper-flashplayer.so';
            const playerSo = 'libpepflashplayer.so';
            return fs.mkdir(pluginDir)
            .then(() => fs.copy(path.join(buildSupportDir, playerSo), path.join(pluginDir, playerSo)))
            .then(() => fs.copy(path.join(buildSupportDir, 'manifest.json'), path.join(pluginDir, 'manifest.json')))
            .then(() => downloadFile(
              // pinned because future releases will likely just bundle ffmpeg and become GPL,
              // but if you need hardware video decoding for some reason then you'll probably need that.
              'https://github.com/SNBeast/freshplayerplugin/releases/download/v0.4.1/freshplayerplugin-armhf.zip',
              wrapperZip,
            ))
            .then(() => new AdmZip(wrapperZip).extractEntryTo(wrapperSo, pluginDir, false));
          }
          else {
            const archive = `flash_player_npapi_linux.${arch === 'ia32' ? 'i386' : 'x86_64'}.tar.gz`;
            const archivePath = path.join(tempDir, archive);
            return downloadFile(
              `https://web.archive.org/web/0if_/https://fpdownload.adobe.com/get/flashplayer/pdc/32.0.0.371/${archive}`,
              archivePath,
            )
            .then(() => fs.mkdir(pluginDir))
            .then(() => extract({file: archivePath, cwd: pluginDir}, ['libflashplayer.so']));
          }
        }),
      );
    }
  })
  .then(() => fs.copy(qbrtDir, path.join(resourcesDir, 'qbrt')))
  .then(() => {
    // Copy and configure the stub executable.
    switch (platform) {
      case 'windows': {
        // Copy the stub executable to the executable dir.
        return fs.copy(path.join(buildSupportDir, 'launcher.bat'), path.join(executableDir, 'launcher.bat'))
        // use a name for the "real" browser exe which conveys being non-primary
        .then(() => fs.rename(path.join(executableDir, 'basilisk.exe'), path.join(executableDir, 'platform.exe')));
      }
      case 'macos': {
        return fs.copy(path.join(buildSupportDir, 'launcher.sh'), path.join(executableDir, 'launcher.sh'))
        .then(() =>
          readFile(path.join(executableDir, 'launcher.sh'), 'utf-8')
          .then(content => {
            content = content.replaceAll('MOZ_RESOURCES_DIR=\'\'', 'MOZ_RESOURCES_DIR=\'../Resources/\'');
            if (arch === 'ia32') {
              content = content.replaceAll('MOZ_APP_NAME=basilisk', 'MOZ_APP_NAME=interweb');
            }
            return writeFile(path.join(executableDir, 'launcher.sh'), content, 'utf-8');
          }),
        )
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
      case 'linux':
        // Copy the stub executable to the executable dir.
        return fs.copy(path.join(buildSupportDir, 'launcher.sh'), path.join(executableDir, 'launcher.sh'));
    }
  })
  .finally(() => fs.remove(tempDir));
}

export const isRuntimeInstalled = (platform, arch) => fs.existsSync(getPlatformDirectories(platform, arch).distDir);

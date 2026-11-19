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
import commandLineArgs from 'command-line-args';
import commandLineCommands from 'command-line-commands';
import commandLineUsage from 'command-line-usage';
import fs from 'fs-extra';
import { getPlatformDirectories } from './directory-utils.js';
import { isRuntimeInstalled, installRuntime } from './install-runtime.js';
import klaw from 'klaw';
import os from 'os';
import normalizePackageData from 'normalize-package-data';
import packageJson from '../package.json' with { type: 'json' };
import path from 'path';
import pify from 'pify';
import plist from 'simple-plist';
import { readPackageUp } from 'read-package-up';
import semver from 'semver';
import { spawn } from 'child_process';

const validCommands = [ null, 'package', 'run', 'version', 'help', 'update' ];
let parsedCommands = {};

try {
  parsedCommands = commandLineCommands(validCommands);
}
catch (error) {
  if (error.name === 'INVALID_COMMAND') {
    displayHelp();
    process.exit(1);
  }
  else {
    throw error;
  }
}

const command = parsedCommands.command;
const argv = parsedCommands.argv;

switch (command) {
  case 'package':
    packageApp();
    break;
  case 'help':
    displayHelp();
    break;
  default:
    if (argv.includes('-v') ||
        argv.includes('--v') ||
        argv.includes('--version')) {
      displayVersion();
      break;
    }
    displayHelp();
    break;
}

function packageApp() {
  const optionDefinitions = [
    { name: 'path', alias: 'p', type: String, defaultOption: true, defaultValue: argv[0] || process.cwd() },
    { name: 'win', type: Boolean },
    { name: 'legacy', type: Boolean },
    // { name: 'linux', type: Boolean },
  ];
  const options = commandLineArgs(optionDefinitions, { argv: argv });
  const shellDir = path.join(import.meta.dirname, '..', 'shell');
  const appSourceDir = fs.existsSync(options.path) ? path.resolve(options.path) : shellDir;;

  let platform = process.platform;
  /*if (options.win && options.linux) {
    throw new Error('Cannot package windows and linux packages simultaneously.');
  }*/
  if (options.win) {
    platform = 'win32';
  }
  /*if (options.linux) {
    platform = 'linux';
  }*/
  if (options.legacy && (options.win || platform !== 'darwin')) {
    throw new Error('Creating a legacy package for non-macOS is not implemented.');
  }
  const { installDir } = getPlatformDirectories(platform, options.legacy);

  let appName;
  let appPackageJson;
  let appTargetDir;
  let appVersion;
  let packageFile;
  let tempDir;
  let stageDir;

  let runtimeCheck;
  if (isRuntimeInstalled(platform, options.legacy)) {
    runtimeCheck = Promise.resolve();
  }
  else {
    runtimeCheck = installRuntime(platform, options.legacy);
  }

  runtimeCheck.then(() => 
    readProjectMetadata(appSourceDir, function transformer(appPackageResult) {
      // `productName` is a key commonly used in `package.json` files of Electron apps.
      appPackageResult.packageJson.name = appPackageResult.packageJson.productName ||
        appPackageResult.packageJson.name || path.basename(appSourceDir);
      return appPackageResult;
    }),
  )
  .then(appPackageResult => {
    return appPackageResult;
  }, error => {
    console.error(error);
    process.exit(1);
  })
  .then(appPackageResult => {
    appPackageJson = appPackageResult.packageJson;
    appName = appPackageJson.name;
    appVersion = appPackageJson.version;
    packageFile = `${appName}.` + (appVersion ? `v${appVersion}.` : '') + (options.legacy ? 'legacy.' : '') +
      { win32: 'zip', darwin: 'dmg'/*, linux: 'tgz'*/ }[platform];
    console.log(`Packaging ${options.path} -> ${packageFile}...`);
    return pify(fs.remove)(packageFile);
  })
  .then(() => {
    return pify(fs.mkdtemp)(path.join(os.tmpdir(), `${appPackageJson.name}-`));
  })
  .then(tempDirArg => {
    tempDir = tempDirArg;
    const stageDirName = platform === 'darwin' ? `${appName}.app` : appName;
    stageDir = path.join(tempDir, stageDirName);
    appTargetDir = platform === 'darwin' ?
      path.join(stageDir, 'Contents', 'Resources', 'webapp') :
      path.join(stageDir, 'webapp');
  })
  .then(() => {
    // Copy the runtime to the staging dir.
    return pify(fs.copy)(installDir, stageDir);
  })
  .then(() => {
    // Rename launcher script to the app's name.
    const exeDir = platform === 'darwin' ? path.join(stageDir, 'Contents', 'MacOS') : stageDir;
    const source = path.join(exeDir, platform === 'win32' ? 'launcher.bat' : 'launcher.sh');
    const target = path.join(exeDir, platform === 'win32' ? `${appName}.bat` : appName);
    return pify(fs.move)(source, target);
  })
  .then(() => {
    // Update the Info.plist file with the new name of the launcher script.
    if (platform === 'darwin') {
      const plistFile = path.join(stageDir, 'Contents', 'Info.plist');
      return pify(plist.readFile)(plistFile)
      .then(appPlist => {
        appPlist.CFBundleExecutable = appName;
        return pify(plist.writeFile)(plistFile, appPlist);
      });
    }
  })
  .then(() => {
    // Copy the app to the stage directory.
    return pify(fs.copy)(appSourceDir, appTargetDir)
    .then(() => {
      if (appSourceDir === shellDir) {
        const appTargetPackageJSONFile = path.join(appTargetDir, 'package.json');
        appPackageJson.mainURL = options.path;
        return pify(fs.writeFile)(appTargetPackageJSONFile, JSON.stringify(appPackageJson));
      }
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
        });
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
        return zipFile.writeZipPromise(packageFile, { overwrite: true });
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
    return fs.remove(stageDir);
  });
}

function displayVersion() {
  console.log(packageJson.version);
}

function displayHelp() {
  const sections = [
    {
      header: 'qbrt-flash',
      content: 'qbrt-flash is a command-line interface to a Gecko desktop app runtime. ' +
               'It\'s designed to simplify the process of building and testing desktop apps using Gecko.',
    },
    {
      header: 'Synopsis',
      content: '$ qbrt-flash <command> <path or URL>',
    },
    {
      header: 'Command List',
      content: [
        { name: 'package', summary: 'Package an app for distribution.' },
      ],
    },
    {
      header: 'Examples',
      content: [
        {
          desc: '1. Package an app for distribution.',
          example: '$ qbrt-flash package path/to/my/app/',
        },
      ],
    },
    {
      content: `Project home: {underline ${packageJson.homepage}}`,
    },
  ];

  const usage = commandLineUsage(sections);
  console.log(usage);
}

function readProjectMetadata(projectDir, transformer) {
  function transform(result) {
    if (typeof transformer === 'function') {
      result = transformer(result);
    }
    return result;
  }

  function removeUnused(metadata) {
    // Remove unneeded keys that were added by `normalize-package-data`.
    delete metadata._id;
    if (metadata.readme === 'ERROR: No README data found!') {
      delete metadata.readme;
    }
    return metadata;
  }

  return readPackageUp({cwd: projectDir}).then(result => {
    // If the app doesn't have a package.json file, then result.packageJson
    // will be undefined, but we assume it's defined in other parts of the
    // codebase, so ensure that it's defined, even if it's just an empty object.
    result.packageJson = result.packageJson || {};

    // If the app doesn't have a package.json file, then result.path will be
    // undefined, but we assume it's defined in other parts of the codebase,
    // so ensure that it's defined, even if the file doesn't actually exist.
    result.path = result.path || path.join(projectDir, 'package.json');

    let metadata = result.packageJson;

    result = transform(result);

    // `normalizePackageData` will throw if there are any errors
    // (e.g., invalid values for `name` or `version`) in the
    // `package.json` file.
    // To expose warnings, pass a callback as a second argument.
    normalizePackageData(metadata);

    result.packageJson = removeUnused(metadata);

    return result;
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
}

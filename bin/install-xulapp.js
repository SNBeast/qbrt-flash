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

import fs from 'fs-extra';
import { getPlatformDirectories } from './directory-utils.js';
import path from 'path';
import pify from 'pify';

export function installXULApp(platform, legacy) {
  // Copy the qbrt xulapp to the target directory.

  // TODO: move qbrt xulapp files into a separate source directory
  // that we can copy in one fell swoop.

  const sourceDir = path.join(import.meta.dirname, '..');
  const { resourcesDir } = getPlatformDirectories(platform, legacy);
  const targetDir = path.join(resourcesDir, 'qbrt');

  const files = [
    'application.ini',
    'chrome',
    'chrome.manifest',
    'components',
    'defaults',
    'devtools.manifest',
    'modules',
  ];

  return pify(fs.ensureDir)(targetDir)
  .then(() => {
    return Promise.all(files.map(file => pify(fs.copy)(path.join(sourceDir, file), path.join(targetDir, file))));
  });
}

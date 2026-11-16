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

import { createSpinner } from 'nanospinner';
import { installRuntime } from './install-runtime.js';

let exitCode = 0;

const spinner = createSpinner('Installing runtime').start();
Promise.resolve()
.then(installRuntime)
.then(() => {
  spinner.success();
})
.catch(error => {
  exitCode = 1;
  spinner.error();
  console.error(error);
})
.finally(() => {
  process.exit(exitCode);
});

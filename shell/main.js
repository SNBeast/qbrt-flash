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

'use strict';

const { classes: Cc, interfaces: Ci, results: Cr, utils: Cu } = Components;
const { Runtime } = Cu.import('resource://qbrt/modules/Runtime.jsm', {});
const { Services } = Cu.import('resource://gre/modules/Services.jsm', {});

const SHELL_URL = 'chrome://app/content/shell.xul';

const WINDOW_FEATURES = (() => {
  let features = [
    `width=${Runtime.appJson.startWidth}`,
    `height=${Runtime.appJson.startHeight}`,
  ];
  if (Runtime.appJson.resizable) {
    features.push('resizable');
    features.push('scrollbars');
  }
  return features.join(',');
})();

// TODO: report error if URL isn't found.
Services.ww.openWindow(null, SHELL_URL, '_blank', WINDOW_FEATURES, null);

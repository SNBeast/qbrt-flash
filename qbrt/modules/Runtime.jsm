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
const { Services } = Cu.import('resource://gre/modules/Services.jsm', {});
const ChromeRegistry = Cc['@mozilla.org/chrome/chrome-registry;1'].getService(Ci.nsIXULChromeRegistry);

this.EXPORTED_SYMBOLS = ['Runtime'];

const global = this;

this.Runtime = {
  get appJson() { return global.appJson },

  start(appFile, appJson) {
    // TODO: stop assuming that appFile is in the topmost directory of the app.
    // Instead, either traverse the path backwards until we find the package
    // manifest, or make the caller specify the app directory in addition to
    // the app file.
    registerChromePrefix(appFile.parent);

    const systemPrincipal = Cc['@mozilla.org/systemprincipal;1'].createInstance(Ci.nsIPrincipal);

    const sandbox = new Cu.Sandbox(systemPrincipal, {
      wantComponents: true,
    });

    global.appJson = appJson;

    Services.scriptloader.loadSubScript(`chrome://app/content/${appFile.leafName}`, sandbox, 'UTF-8');
  },
};

function registerChromePrefix(appDir) {
  let appDirURI = Services.io.newFileURI(appDir);
  let manifestText = `content app ${appDirURI.spec}/`;

  const tempFile = Services.dirsvc.get('TmpD', Ci.nsIFile);
  tempFile.append('temp.manifest');
  tempFile.createUnique(Ci.nsIFile.NORMAL_FILE_TYPE, 0o600);

  let fileStream = Cc['@mozilla.org/network/file-output-stream;1'].createInstance(Ci.nsIFileOutputStream);
  fileStream.init(tempFile, -1, -1, 0);
  fileStream.write(manifestText, manifestText.length);
  fileStream.close();

  Components.manager.QueryInterface(Ci.nsIComponentRegistrar).autoRegister(tempFile);
  ChromeRegistry.checkForNewChrome();

  tempFile.remove(false);
}

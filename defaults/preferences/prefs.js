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

// App-specific preferences, in alphabetical order.

pref('browser.dom.window.dump.enabled', true);
pref('devtools.chrome.enabled', true);
pref('devtools.debugger.prompt-connection', false);
pref('devtools.debugger.remote-enabled', true);
pref('devtools.selfxss.count', 5);
pref('devtools.theme', 'dark');
pref('dom.mozBrowserFramesEnabled', true);
pref('javascript.options.showInConsole', true);

// Ideally, this would disable telemetry, but it doesn't actually work
// (at least it doesn't disable code that spews errors into the console),
// so we also override the @mozilla.org/base/telemetry-startup;1 XPCOM contract
// with a custom component DisabledTelemetryStartup that ignores
// the app-startup and profile-after-change messages.
pref('toolkit.telemetry.enabled', false);

// allow bundling plugins with the runtime
pref('plugins.load_appdir_plugins', true);
// disable global plugin search
pref('plugin.scan.plid.all', false);
// start plugins without interaction
pref('plugin.default.state', 2);
// disable blocking outdated plugins, as they were likely chosen for a reason
pref('extensions.blocklist.enabled', false);

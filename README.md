qbrt-flash: CLI to a Gecko desktop app runtime
===

qbrt-flash is a command-line interface to a Gecko desktop app runtime.
It's designed to simplify the process of building and testing desktop apps
using Gecko.

# Usage

Install it via npm:

```bash
npm install -g qbrt-flash
```

Installing it also installs a Gecko runtime.
Its simplest use is then to invoke the *run* command with a URL:

```bash
qbrt-flash run https://eggtimer.org/
```

Which will start a process and load the URL into a native window:

<img width="695" alt="screen shot 2017-03-15 at 01 16 28" src="https://cloud.githubusercontent.com/assets/305455/23939844/c5f39068-091f-11e7-8335-d1ba27fed6f3.png">

URLs loaded in this way don't have privileged access to the system.
They're treated as web content, not application chrome.

To load a desktop app with system privileges, point qbrt at a local directory
containing a package.json file and main script:

```bash
qbrt-flash run path/to/my/app/
```


(A good example is
the [shell app](https://github.com/SNBeast/qbrt-flash/tree/master/shell)
that qbrt-flash uses to load URLs.)

To package an app for distribution, invoke the *package* command,
which creates a platform-specific package containing both your app's resources
and the Gecko runtime:

```bash
qbrt-flash package path/to/my/app/
```

# Caveats

While qbrt-flash itself is written in Node.js, it doesn't provide Node.js APIs
to apps. Unprivileged URLs have access to Web APIs, and privileged apps
also have access to Gecko's APIs.

qbrt-flash doesn't yet support runtime version management (i.e. being able to
specify which version of Gecko to use, and to switch between them). At the time
you install it, it downloads a particular Gecko runtime for the platform.

The packaging support is primitive. qbrt-flash creates a shell script (batch
script on Windows) to launch your app, and it packages your app using
a platform-specific format (ZIP on Windows and DMG on Mac).
But it doesn't set icons nor most other package meta-data, and it doesn't create
auto-installers nor support signing the package.

In general, qbrt-flash is immature and unstable! It's appropriate for testing,
but it isn't yet mature and stable enough for you to ship apps with it.

# Contributing

Contributions of all kinds are welcome! As are all contributors. We only ask
that you treat other contributors with care and respect and observe Mozilla's
[Community Participation Guidelines](https://www.mozilla.org/en-US/about/governance/policies/participation/).

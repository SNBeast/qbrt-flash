qbrt-flash: CLI to a Gecko desktop app runtime
===

qbrt-flash is a command-line interface to a Gecko desktop app runtime.
It's designed to simplify the process of building and testing desktop apps
using Gecko.

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
But it doesn't set most package meta-data, and it doesn't create
auto-installers nor support signing the package.

In general, qbrt-flash is immature and unstable! It's appropriate for testing,
but it isn't yet mature and stable enough for you to ship apps with it.

# Contributing

Contributions of all kinds are welcome! As are all contributors. We only ask
that you treat other contributors with care and respect and observe Mozilla's
[Community Participation Guidelines](https://www.mozilla.org/en-US/about/governance/policies/participation/).

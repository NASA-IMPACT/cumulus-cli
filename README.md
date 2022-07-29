# NASA Cumulus CLI

The NASA Cumulus CLI is a command-line interface to the [NASA Cumulus API].
For a number of Cumulus management tasks, it can be used as an alternative to
the [NASA Cumulus Dashboard] web application, particularly when it is desirable
to script various Cumulus management tasks.

## Installation

Before installing the Cumulus CLI, you must have the following installed:

- `git` (likely already installed)
- `nvm` (see [Installing and Updating nvm])

Once the items above are installed, and until the Cumulus CLI is released as an
NPM package, you may install it as follows, after opening a terminal window and
changing to your desired parent directory:

1. Use `git` to clone this repository into a subdirectory of the current
   directory.
1. Change directory to the repository subdirectory.
1. Run `nvm install` to install the correct versions of `npm` and `node` (as
   specified in `.nvmrc`) for subsequent commands.
1. Run `npm install` to install library dependencies.
1. Run `npm run build` to build the Cumulus CLI.
1. Run `npm install --global` to install `cumulus` (the Cumulus CLI) as a global
   command to allow its use from any directory.

After completing the steps above, in order to later obtain enhancements and bug
fixes committed to this repository, do the following from a terminal window,
within the same directory where you originally ran the commands above:

```plain
git pull origin
nvm install
npm install
npm run build
npm install --global
```

## Usage

Once installed, run the following to list available commands:

```plain
cumulus --help
```

Usage other than obtaining help via the `--help` flag requires the following
environment variables to be set:

- `AWS_REGION` (or `AWS_DEFAULT_REGION`)
- `AWS_PROFILE` (or `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`)
- `CUMULUS_PREFIX` (or use the `--prefix` option)

[Installing and Updating nvm]:
    https://github.com/nvm-sh/nvm#installing-and-updating
[NASA Cumulus API]:
    https://nasa.github.io/cumulus-api/
[NASA Cumulus Dashboard]:
    https://github.com/nasa/cumulus-dashboard

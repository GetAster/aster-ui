# Report a problem or ask a question

Aster UI's issue tracker and discussions are on [GitHub](https://github.com/GetAster/aster-ui).

## Report a problem

Open an [issue](https://github.com/GetAster/aster-ui/issues/new/choose) when something does not work as these guides or the [API reference](../reference/) say. Search the existing issues first for the message or symptom you see.

A report is quickest to act on when it includes:

- the installed `@getaster/elements` version, from `npm ls @getaster/elements`
- the browser and its version
- what the elements run inside: plain HTML or TypeScript, React, Vue or Angular
- the data service: the mock, Aster Web Data or another OData service
- what you did, what you expected and what happened
- errors or warnings from the browser console

The smallest reproduction helps most. Start from the [template](https://github.com/GetAster/aster-ui-template), which runs against the mock with no server, and change it until the problem shows. If the problem needs your own service, the request and response from the browser's network panel usually show whether the data or the element is at fault.

Remove service addresses, keys and tokens from anything you paste.

## Ask a question or suggest a feature

Use [Discussions](https://github.com/GetAster/aster-ui/discussions) for questions about building with Aster UI and for ideas you want to talk through. To suggest a feature, describe what you are building and where the current elements stop; the [feature form](https://github.com/GetAster/aster-ui/issues/new/choose) asks for both.

The repository does not take pull requests at the moment. A problem report or a discussion is the way to propose a change.

## Report a security problem

Send a private report through [Report a vulnerability](https://github.com/GetAster/aster-ui/security/advisories/new) on GitHub, or write to security@getaster.now. Do not open a public issue for a security problem. Include the package versions, the browser and the smallest steps that show it.

## Next

- [Release notes](https://github.com/GetAster/aster-ui/blob/main/CHANGELOG.md) list what changed in each release.
- [Get started](getting-started.md) connects a first grid to data.

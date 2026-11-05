# Server metadata reference

`metadata.json` is the `$metadata` response of a reference service run by
`aster-webdata-server` (release 0.1.257, source `a246213d`). It is generated
output, not hand-written: the server repository regenerates it in a test that
fails on any drift. `manifest.json` lists its entity sets, operations, the
properties the client is expected to skip and the shapes the server does not
emit. Licensed Apache-2.0; see `LICENSE` and `NOTICE`.

Refresh it by copying the server's `fixtures/metadata-reference` files at a
named release, then update the release and source above.

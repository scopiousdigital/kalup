# Data dictionary

`kalup docs [<source>]` prints a Markdown data dictionary. The source is `config`, the default, or a snapshot file relative to the current directory. It sends no request.

This page is the reference. For the walk-through with examples, see [kalup docs](https://kalup.dev/docs/commands/docs) on the website.

- `config`: the project must validate (exit 3). The page describes the config files: a field a definition leaves out belongs to the portal and is not listed.
- A snapshot file needs no project. The page describes the read, with HubSpot's defaults filled in, such as `Hidden: no`.

## Layout

1. `# <project> data dictionary` and a line naming the source: the config files, or the target, portal ID and `observedAt` of the snapshot.
2. `## Coverage`. For a snapshot: whether the read was complete, the objects not read with the missing scope, objects absent from the portal, what `skip` overrides left out, unsupported properties (Kalup does not write them), schemas without a label, `name` overrides, config properties in a group no address can hold, counts out of scope and shadowed, custom objects config does not name, objects whose pipelines were not read, and the fields Kalup does not capture. Reference properties record only their options.
3. One `## <object>` section per object key, sorted: a custom object's labels, description, display property and property lists; a groups table (internal name, label); a properties table (internal name, label, type, field type, group, managed or reference, description); one options table per enumeration (value, label, hidden, description), in display order; per pipeline, sorted by ID, a `### Pipeline <label> (<id>)` heading, its display order, and a stages table in stage order (stage ID, label, and its probability or state; config adds the key); and an associations table of the associations from the object, sorted (internal name, the other object, label and inverse label; config adds the key). Config adds the key, codec, required and alias columns. Unsupported properties appear only under Coverage.
4. Config with `definition` overrides: `## Per-target overrides`, one row per address, field and target with its value, sorted.

## Escaping

Every string from a file or a portal is shown as text: newlines become spaces, control and bidirectional formatting characters are removed, every ASCII punctuation character is backslash-escaped, and an invisible word joiner (U+2060) breaks a bare URL, `www.` name or email address, which GFM renderers such as remark-gfm link even when escaped. So no label can form a link, HTML, emphasis, code, a heading or a table cell. Descriptions are cut at 500 characters with an ellipsis.

## Deterministic

The same source gives the same bytes: objects, groups, properties, pipelines and associations sorted, options and stages in display order, and no timestamp but a snapshot's own `observedAt`. Commit the dictionary and check it in CI:

```sh
npx --no-install kalup docs --out DATA-DICTIONARY.md
git diff --exit-code DATA-DICTIONARY.md
```

## Flags

- `--out <file>`: write the Markdown there, relative to the current directory, replacing an older file, and print `Wrote <file>`.
- `--json`: one `envelope/1` with `data: { markdown }`, or `data: { file }` with `--out`.

An incomplete snapshot gives `W_INCOMPLETE`: what was not read is unknown, and the Coverage section lists it.

## Exit codes

| Exit | When |
|---|---|
| 0 | Written, warnings included |
| 1 | `E_USAGE`, `E_NO_CONFIG`, `E_SNAPSHOT` (a missing file, not JSON) |
| 3 | Config invalid, or a file that is not a valid snapshot |

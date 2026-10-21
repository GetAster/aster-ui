# Manage an application workspace

[Open the Windows explorer](../examples/windows.html) to work with a device inspector and notes. Windows let a task remain open while another task becomes active; a workspace coordinates their placement and activation.

## Register stable windows

Create one `Workspace`, register windows under stable IDs, and call `workspace.show(id, opener)` when an application action opens one. The example sets `managed` and `preserveContent` so workspace actions retain the existing content.

```javascript
const workspace = new Workspace();
const notes = document.querySelector("#notes");
notes.heading = "Notes";
notes.managed = true;
notes.preserveContent = true;
workspace.register("notes", notes);
```

The source below the preview includes the imports, templates, open actions and task list. Reuse registered windows instead of creating another copy of a task whenever it is opened.

## Protect unsaved work

Supply `beforeClose` for content with a draft. It can return a boolean or a promise resolving the decision. A refused close leaves the content open. The example opens an Aster dialog when notes are dirty and lets the user keep editing or discard changes.

Keep data-saving policy in the content owner. Saving notes in this example retains them only for the visit; it is not a server-backed note service.

## Preserve content while managing placement

Minimizing changes the window state and task list; it does not dispose preserved content. Maximize and restore change placement while retaining the same controls. The example renders task buttons from the workspace’s public state.

A snapshot records placement. Persist it under an application-specific key and restore it with the workspace API. Content records, drafts and permissions need their own persistence and loading policy. The example stores layout on this browser, with viewport recovery supplied by the window/workspace contract.

## Include keyboard workflows

Move and Resize controls accept arrow keys, with Shift for larger steps. F6 cycles through open windows. Escape requests closing, and close guards still apply. Verify the opener receives appropriate focus after a window closes.

An embedded preview confines windows to its own viewport. Use **Open full size** to explore the workspace with the full browser area. On narrow screens, windows recover their bounds to remain reachable.

See [Window](../reference/#class:Window) and [Workspace](../reference/#class:Workspace) for the complete contracts.

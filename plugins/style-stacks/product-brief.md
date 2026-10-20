# Style Stacks (originally "Style Classes")

Plugin identity:
- displayName: Style Stacks
- description: Your reusable style clipboard

Original user prompt:
# Build a Figma Plugin: Style Classes

I want to build a lightweight Figma plugin that functions as a **persistent, named clipboard for reusable styling properties**.

Think of it as Figma's native Copy/Paste Properties functionality, except users can save collections of properties as named presets (which we'll call *classes*) and recall them whenever needed.

## The Problem

Figma has variables, styles, and components, but no native way to save and reuse arbitrary combinations of styling properties independently of component structure.

Designers frequently create components simply to reuse visual treatments, then detach those instances to customize their contents. This is an unnecessary workaround.

For example, I should be able to style a frame as a card, save that styling as a class called `card`, and apply it to any other frame without affecting its contents or dimensions.

## Core MVP Functionality

### 1. Save a Class

When a user selects a frame or other compatible node:

- Capture its styling properties.
- Allow the user to name the class.
- Let the user choose which property groups to include.
- Save the class for future use.

Supported property groups:

- Fills
- Strokes, including weight, alignment, and dash properties
- Corner radii
- Effects (shadows, blurs)
- Auto Layout properties (direction, padding, spacing, alignment)

**Important:** Preserve existing Figma variable bindings and style references wherever possible. Do not flatten everything into hardcoded values.

Do not capture frame dimensions, position, contents, or child layers.

### 2. Apply a Class

When one or more compatible nodes are selected:

- Display the saved classes.
- Allow the user to apply a class with one click.
- Apply only the property groups included in that class.
- Preserve all other properties of the target nodes.
- Never replace, detach, or restructure the target nodes.
- Support applying a class to multiple selected nodes simultaneously.

Applying a class should behave like pasting properties, not creating a component instance.

### 3. Manage Classes

Provide a simple interface to:

- View saved classes
- Rename classes
- Update a class from the currently selected node
- Delete classes

Updating a class should update its saved definition, **not automatically modify previously styled nodes**.

Classes are reusable recipes, not live-linked styles.

## Storage

For the MVP:

- Store class definitions persistently within the Figma document using the Plugin API.
- Do not require accounts, authentication, subscriptions, or external services.
- Classes should remain available when the document is reopened.
- Design the storage model so import/export or shared libraries could be added later, but don't implement those features yet.

## Plugin UI

Create a compact, native-feeling Figma plugin interface.

### Header
- Plugin name
- Small description: "Your reusable style clipboard"

### Saved Classes
- List of named classes
- Each class shows its name and included property groups
- Clicking a class applies it to the current selection
- An overflow menu provides Rename, Update, and Delete actions

### Save New Class
- Prominent action to capture styling from the current selection
- Name input
- Property-group checkboxes
- Save button

### Selection Awareness
- Clearly indicate when no compatible layer is selected.
- Disable actions that require a selection.
- Provide concise success and error feedback.

Prioritize speed and simplicity over elaborate visual design.

## Technical Requirements

- Use the official Figma Plugin API and TypeScript.
- Build a functioning plugin, not a visual mockup.
- Include a valid plugin manifest.
- Separate styling capture, serialization, storage, and application into maintainable modules.
- Handle unsupported node types and missing variable/style references gracefully.
- Preserve variable bindings and native Figma styles wherever supported by the API.
- Avoid introducing unnecessary dependencies.
- Do not use a backend.

Pay particular attention to Figma's API limitations around serializing paints, effects, bound variables, and style references. Use appropriate Figma APIs rather than assuming these objects can be safely serialized and restored as ordinary JSON.

## Out of Scope

Do not implement:

- CSS generation
- Live synchronization between classes and nodes
- Class inheritance or cascading
- Cloud storage
- User accounts
- Shared team libraries
- Component creation or management
- Design token creation or editing
- AI functionality

## Definition of Done

The plugin should successfully support this workflow:

1. I create a frame and style it using existing Figma variables and styles.
2. I select the frame and save its styling as a class named `card`.
3. I create another frame containing completely different content.
4. I select that frame and apply `card`.
5. The new frame receives the saved styling, including supported variable bindings and style references.
6. Its existing contents, dimensions, and unrelated properties remain unchanged.
7. I can close and reopen the plugin and still access my saved classes.

## Implementation Instructions

**Start by inspecting the available Figma Plugin API capabilities and identifying any limitations that could affect this workflow. Then implement the smallest functional MVP.**

Prioritize a working end-to-end experience over visual polish or architectural complexity.

Do not expand the scope beyond the requirements above.

Usage:
- Save now suggests a unique class name from the selected layer, while preserving manually edited drafts. Inline status explains missing selection, empty or duplicate names, missing groups, and pending actions.
- Select one layer, name the class, choose supported groups, Save. Click a saved class to apply to compatible selected layers. Saved rows show only the name on one line; long names can scroll horizontally without ellipsis or smaller type. Overflow contains exactly Edit and Delete. Edit offers Rename and Update from selection (same groups); Delete requires confirmation.
- Explicit document plugin data envelope schemaVersion 1. Four independent module objects in code.ts: Serialization, Storage, Capture, Application. No dependencies or network services.
- Native styles are restored by asynchronous style setters, using saved ID and published-key recovery. Missing references use saved literal fallback with feedback. Nested variable aliases are encoded as ID/key references, resolved and recreated using variable APIs. Solid paints and effects also use binding helpers; gradient stops preserve recreated aliases.
- Dimensions, transforms, contents, children, layout sizing/grow/min/max, text formatting, opacity and visibility are never saved. Auto Layout is limited to non-grid frames; preserves measured outer dimensions with fixed sizing. Hug-sized target layout groups are skipped with an explanation to preserve unrelated sizing. Native Auto Layout may reposition/resize existing children without changing their identity/content/order/parentage.
- Mixed text fills, grid layout recipes, shader/video paints and shader effects are not captured. Other compatible groups remain usable. Locked targets and descendants inside instances are skipped. Image/pattern references are document-scoped, with checks for missing sources. Native styles and variables retain their inherent Figma linking behavior; recipes themselves are not linked to targets.
- Standard HTML UI uses Figma theme colors, zero external dependencies; source modules remain in one compilation unit for the bundled TypeScript toolchain.
- Keep UI declarations inside a function scope: Figma prepends PropsKit as a classic script for isTool plugins, and its global `$` conflicts with a top-level `const $`. Before showUI, inject figma.pluginId into the UI's runtime-ID marker. Never hardcode the manifest UUID or assume a runtime prefix: custom-plugin runtime IDs differ from manifest IDs, and an explicitly wrong ID is rejected even at opaque origins. See INVESTIGATION.md and test-browser.cjs for the runtime reproduction.
- Capture all property values and reference IDs synchronously before yielding. Resolve unique reference metadata concurrently with one bounded budget; missing metadata must not block saving the recipe. Retain document IDs and literals, warn when published-key recovery is unavailable, and never let late lookups mutate saved data. Re-read and validate storage before committing after an async capture. UI action responses are request-correlated, with draft-preserving recovery if delivery fails.
- Scope UI selectors under #style-classes and prefix classes with sc- to avoid injected PropsKit CSS collisions. Explicitly restore native button block formatting/automatic height. Keep the shared fixed-position menu outside the scroll list, clamp/flip it to the viewport, and retain menu/editor state across background refreshes. test-saved-classes.cjs reproduces the deployed layout/clipping/refresh failures and tests the fix with real PropsKit CSS/JS at 340px and 240px, without connecting to Figma.

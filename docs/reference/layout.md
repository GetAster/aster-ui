# Layout elements

Five elements arrange a page without drawing records of their own. All of them
take their contents as templates (lit-html `View`s) that the page builds, and
none keeps state the page needs except the few values noted below.

| Element | Class | For |
|---|---|---|
| `aster-split` | [[class:Split]] | Two panes side by side with a draggable bar between them, such as a list and its detail. |
| `aster-section` | [[class:Section]] | A titled block that collapses, such as one part of a long form. |
| `aster-disclosure` | [[class:Disclosure]] | A toggle inside a line of text that shows more, such as "raises 12 errors". |
| `aster-carousel` | [[class:Carousel]] | A row of cards that scrolls one at a time. |
| `aster-caret-group` | [[class:CaretGroup]] | A group in which a bar slides to the selected child. Tabs and the listbox are built on it. |

Like every Aster element they render into the light DOM, are styled by the
page's Aster stylesheet, and take their properties as JavaScript properties
rather than attributes. Properties backed by a signal are reactive: setting one
re-renders the element, and reading one inside an `effect` tracks it. See
[[class:AsterElement]].

### Templates as contents

`Split` takes `start` and `end`, `Section` takes `body` and `summary`,
`Disclosure` takes `body`, and
`Carousel` takes a `view` per slide. Each is a [[type:View]]: a lit-html
template or `nothing`. The page builds the template, so signals read while
building it re-render whatever is rendering it, not the layout element. When a
template depends on a signal, build it inside the render of the page element
that owns the layout element (as the demo's pages do), or set the property
again from an `effect`.

### Motion and screen size

- A section's height is animated by CSS (a grid row from `0fr` to `1fr`);
  nothing is measured in JavaScript. A carousel scrolls smoothly unless the
  person asked for reduced motion. The caret under a tab slides unless it is
  being placed for the first time.
- A horizontal split stacks below 720 px of its own container width and hides
  the bar unless `responsive=false`. Vertical splits retain their axis.
- A form (see [[group:forms]]) drops to one column when its own width is 520 px
  or less, by a container query. A section has no breakpoint of its own.

### Example

A people page: a list beside a detail, with a collapsible details section, and
a row of pinned cards above them.

```ts
import { html, render } from "lit-html";
import type { Slide } from "@getaster/elements";
import "@getaster/elements";

const pinned: Slide[] = [
  { label: "Brand refresh", view: html`<h3>Brand refresh</h3><p>Due Friday</p>` },
  { label: "Billing", view: html`<h3>Billing</h3><p>On track</p>` },
];

const detail = html`<aster-section .heading=${"Contact"} .level=${3}
  .summary=${html`<span>2 fields</span>`}
  .body=${html`<p>ada@example.com</p>`}></aster-section>`;

render(
  html`<aster-carousel .label=${"Pinned projects"} .slides=${pinned}></aster-carousel>
    <aster-split .label=${"Resize the people list"}
      .min=${200} .max=${480} .width=${280} .persist=${"people"}
      .start=${html`<p>List goes here</p>`} .end=${detail}></aster-split>`,
  document.body,
);
```

### Limits

- Layout elements don't set a height. A split's panes each scroll on their own
  (`overflow: auto`), so give the split a height, such as a flex or grid cell,
  or its panes grow to their contents.
- A split has two panes and resizes/collapses one of them: the start pane by
  default, or the end pane with `pane="end"` (an inspector, say). Use
  `orientation` for either axis and nest splits for more panes.
- A carousel does not rotate by itself and has no autoplay, dots or looping.
- A carousel fires no event. Read its `index` to follow it.

## class:CaretGroup

Tag: `aster-caret-group`. It is a plain custom element, not an
[[class:AsterElement]]: it has no properties, signals or events, and it renders
nothing but the caret. Put anything that marks a selected child inside it; it
finds that child and moves a bar to it. The selected child is the first
descendant matching `[aria-current="true"]`, `[aria-current="page"]` or
`[aria-selected="true"]` that is visible and whose nearest `aster-caret-group`
is this one, so groups can nest without taking each other's marks.

Attribute: `axis`. `axis="x"` puts the bar under the selected child, for a row
of tabs. Without it (the default, vertical) the bar sits at the child's left
edge, for a list or navigation. The attribute is read each time the bar is
placed and isn't observed: set it before the group connects.

The caret is an `aria-hidden` `span.aster-caret` placed first in the group. JS
writes its place as the custom properties `--caret-pos` and `--caret-size`
(pixels, from the child's offsets within the group, through any positioned
ancestors between them) and `--caret-opacity`; CSS draws and animates it.
With no selected child, the opacity is 0. A change of the selected child animates;
the first placement, and a re-placement after a resize or font load, are instant. It re-places on changes to `aria-current`, `aria-selected` or
`hidden` anywhere inside, on added or removed children, when the group is
resized, and when web fonts finish loading.

The group is the bar's containing block, so it must stay `position: relative`
(the default styles do this).

```html
<aster-caret-group axis="x" role="tablist" aria-label="Views">
  <button role="tab" aria-selected="true">Overview</button>
  <button role="tab" aria-selected="false">History</button>
</aster-caret-group>
```

## class:Section

Tag: `aster-section`. Give it a `heading` and a `body`.

By default it is a titled, collapsible block. The heading is a
`role="heading"` element whose level is `level`, holding a button with
`aria-expanded` and `aria-controls`. Pressing it (Enter or Space on the
button, or a click) toggles `open`. The body is a `role="region"` named by
the heading. It stays in the DOM when collapsed, so its state, signals and
form values are kept, and it is `inert` so its controls can't be reached. The
element carries a `data-open` attribute while open, which the styles use.

A collapsed section opens by itself when an invalid field (an element with
`aria-invalid="true"`) newly appears in it, after the render that shows it. It
opens once: if the person collapses it again while that field stays invalid, it
stays collapsed until the body has been error-free and an error appears again.

Optional [[attr:Section.chrome]] turns the same element into an in-flow panel:
the shared window title bar ([[class:Window]]'s template), a separate fold
chevron, a close control, a footer and a summary that can stay visible.
[[attr:Section.collapsible]] set to `false` renders a plain heading and keeps
the body open, for a card that does not fold. These are presentational options;
the section never removes itself, and a close only asks the host.

Reading `open` inside an `effect` tracks the person's opening and closing as
well as your own setting of it.

```ts
import { html } from "lit-html";
import type { EditModel } from "@getaster/data";
import type { Section } from "@getaster/elements";

declare const edit: EditModel;

const section = document.createElement("aster-section") as Section;
section.heading = "Advanced";
section.open = false;
section.summary = html`2 changes`;
section.body = html`<aster-field .model=${edit} .field=${"notes"}></aster-field>`;

// An in-flow panel: window chrome, a count that stays visible, and a footer.
section.chrome = { titleBar: true, status: "always" };
section.footer = html`<aster-button .label=${"Save"}></aster-button>`;
```

## attr:Section.heading

The title, as text. It is the button's label and the region's accessible name.
Default `""`. Reactive.

## attr:Section.open

Whether the body is shown. The person toggles it, and so does the
invalid-field rule above; setting it from code does the same. Default `true`.
Reactive. There is no event; follow it as a signal.

## attr:Section.body

The section's contents, a [[type:View]]. Default `nothing`. Rendered inside the
section even when collapsed. Reactive.

## attr:Section.level

The heading level in the page's outline: `2`, `3` or `4`. Default `2`. It sets
`aria-level`. Pick the level that fits under the page's own headings. Reactive.

## attr:Section.summary

A [[type:View]] shown beside the heading while the section is collapsed, such as
"2 changes" or a count. It is not rendered while open. Default `nothing`.
[[class:Form]] sets it to a count of the section's changed fields. Reactive.

## object:SectionChrome

The plain-data chrome object behind [[attr:Section.chrome]]. Every field is
optional, and assigning a new object re-renders the section.

| Field | Default | Effect |
|---|---|---|
| `titleBar` | `false` | Draw the shared window title bar, the template and geometry [[class:Window]] uses, instead of the section head. |
| `fold` | the value of `titleBar` | Show a separate fold chevron in the title bar. Set `false` to hide it. It is ignored without a title bar, where the heading itself toggles. |
| `close` | `false` | Show a close button that emits [[event:Section.close]]. |
| `footer` | `false` | Reserve a footer region at the bottom of the body. Content comes from [[attr:Section.footer]]. |
| `status` | `"collapsed"` | `"collapsed"` shows the summary only while collapsed, as before. `"always"` shows it whenever a summary is set, collapsed or open. |

Because it is plain data, the YAML composition catalog accepts the same shape:
`chrome: { titleBar: true, status: always }`.

## attr:Section.chrome

Presentational chrome. Default `{}`. See [[object:SectionChrome]] for the
fields and defaults. Reactive: assign a new object; the stored object is
frozen, so mutate by replacing it.

## attr:Section.collapsible

The folding capability. Default `true`: the heading is a button with
`aria-expanded` and `aria-controls`, and the body is inert while collapsed.
Set `false` for a plain heading: it keeps `role="heading"` and `aria-level`, but
has no button semantics, `aria-expanded`, `aria-controls` or chevron, and the
body stays rendered open and is not inert. `open` then has no visible effect,
the fold control is not rendered, and no `section-toggle` is emitted. The
invalid-field auto-open rule applies to collapsible sections. Reactive.

## attr:Section.canClose

Whether the section permits closing. Default `true`. It is the capability half
of the close surface: [[object:SectionChrome]]'s `close` (or
[[attr:Section.chrome]] `{ close: true }`) still chooses whether the control is
shown, and `canClose: false` removes it even when chrome asks for it. The
section itself never closes or removes itself; the control emits
[[event:Section.close]] for the host to act on. Reactive.

## attr:Section.footer

The footer contents, a [[type:View]], rendered at the bottom of the body area.
Default `nothing`. Setting it is sugar for `chrome.footer = true` plus the
content: `section.footer = view` is `section.chrome = { ...section.chrome,
footer: true }` with that view. Setting it to `nothing` clears the flag. The
footer sits inside the collapsing body, so it is hidden and inert while the
section is collapsed. Reactive.

## event:Section.close

Emitted when the close control from [[attr:Section.chrome]] is activated. It
bubbles and is cancelable, with no detail. The section has no default action
and never removes or hides itself: `preventDefault()` lets a host apply its own
close policy, and otherwise the host decides what happens next.

## class:Disclosure

Tag: `aster-disclosure`. Give it a `label` and a `body`.

A disclosure that sits inside a sentence or a line of other content: a
button with `aria-expanded` and `aria-controls`, and after it, in the same
flow, the content it shows. Pressing the button (Enter or Space, or a click)
toggles `open`. The element is inline and has no heading or region, which is
what separates it from [[class:Section]], a titled block. Use Section for a
part of a page with a name of its own, and Disclosure for "show more" inside
text: a count that opens to its list, or a note that opens to its detail.

A native `<details>` can't do this job: it is a block, and inside a `<p>` the
HTML parser ends the paragraph before it. Disclosure renders through the DOM,
so it can sit inside a paragraph.

The content stays in the DOM while hidden, so its state is kept. It is
`hidden` while closed, so it isn't read or reached. Closing the disclosure
while focus is inside the content moves focus to the button. The element
carries `data-open` while open; a host in a flex row can place it with
`aster-disclosure[data-open] { flex-basis: 100% }` so the opened content
takes a line of its own.

```ts
import { html } from "lit-html";
import type { Disclosure } from "@getaster/elements";

const errors = ["invalid_grant", "invalid_scope", "access_denied", "server_error"];
const raises = document.createElement("aster-disclosure") as Disclosure;
raises.label = `${errors.length} errors`;
raises.body = html`${errors.map((e, i) => html`${i ? ", " : ""}<code>${e}</code>`)}`;
// In a template: html`<p>raises <aster-disclosure .label=${"4 errors"} .body=${list}></aster-disclosure></p>`
```

## attr:Disclosure.label

The button's text, such as "12 errors". It is the button's accessible name.
Default `""`. Reactive.

## attr:Disclosure.open

Whether the content is shown. The person toggles it, and setting it from code
does the same. Default `false`. Reactive. There is no event; follow it as a
signal.

## attr:Disclosure.body

The content, a [[type:View]], shown after the button while open. Default
`nothing`. Rendered even while closed. Reactive.

## class:Split

Tag: `aster-split`. Set `start` and `end` to the two panes' contents; the
element needs nothing else.

One pane is sized, chosen by [[attr:Split.pane]] (the start pane by default);
the other takes the rest. The bar between the panes is a focusable
`role="separator"` with `aria-orientation="vertical"`, `aria-valuenow` (the
sized pane's width in pixels), `aria-valuemin` and `aria-valuemax`, and
`aria-controls` pointing at the sized pane. Name it with `label`.

| Input | Effect |
|---|---|
| Drag the bar | Moves the bar, resizing the sized pane, clamped to `min` and `max`. Follows the text direction. |
| Left and Right | Move the bar 16 px. With the start pane sized, Right widens it; with the end pane sized, Left widens it. In right-to-left text they are reversed. |
| Home and End | Size the pane to `min` and to `max`. |

JS writes only the sized pane's width, on the element as the custom property
`--split-start` or `--split-end`; CSS lays out the panes and gives each its own scrolling.
At container widths of 720 px and under, responsive horizontal panes stack,
start first, with the bar hidden; a bar collapse button
([[object:SplitChrome]]) then sits between them. Vertical splits keep their axis. Requested
sizes are whole pixels; CSS constrains the rendered track to available space.
Scrollable panes are keyboard focusable.

```ts
import { html } from "lit-html";
import type { Selection } from "@getaster/data";
import type { Split } from "@getaster/elements";

declare const selection: Selection;

const split = document.createElement("aster-split") as Split;
split.min = 220;
split.max = 520;
split.width = 300;
split.persist = "people";
split.start = html`<aster-listbox .selection=${selection}></aster-listbox>`;
split.end = html`<p>Details</p>`;
```

## attr:Split.start

The first pane's contents, a [[type:View]]. Default `nothing`. Despite the name
it isn't a size; the size is `width`. Reactive.

## attr:Split.end

The second pane's contents, a [[type:View]]. Default `nothing`. It takes the
space the start pane leaves. Reactive.

## attr:Split.pane

`"start"` (default) or `"end"`: the pane that `width`, `min`, `max`, `persist`
and collapsing apply to. The other pane takes the remaining space, so an
end-sized split keeps a fixed-width inspector on the trailing side while the
start pane grows with the page. Any other value throws a `TypeError`. Panes
keep their DOM when this changes; the requested size carries over to the newly
sized pane. In a narrow responsive container the panes still stack start first.
Reactive.

## attr:Split.width

The sized pane's width in pixels. Default `320`. Setting it rounds it and
clamps it to `min` and `max`; the getter returns the clamped preferred value. Changes to min/max re-clamp
it immediately. CSS may render a smaller track to fit the available space. Reactive; it also changes as the person
drags.

## attr:Split.min

The least width of the sized pane, in pixels. Default `220`. Also the bar's
`aria-valuemin` and where Home goes. Reactive; re-clamps the preferred size. See [[attr:Split.width]].

## attr:Split.max

The greatest width of the sized pane, in pixels. Default `560`. Also the bar's
`aria-valuemax` and where End goes. Reactive; re-clamps the preferred size. See [[attr:Split.width]].

## attr:Split.label

The bar's accessible name. Default `"Resize"`. Name what is resized, such as
`"Resize the people list"`, since a page can have several. Reactive.

## attr:Split.persist

A name under which to keep the width for this person in the browser's local
storage (key `aster-split:<name>`). Setting it reads any stored width at once and,
if there is one, uses it as `width` (clamped); after that, every drag and key
press stores the new width. Default `""`, which keeps nothing. The stored width is read each time the name
is set, including after the split is connected, and replaces the current
width. The width asked for (by `width`, a stored value, a drag or a key) is kept
apart from the width shown, which is always inside `min` and `max`, so the
order of `min`, `max`, `width` and `persist` doesn't matter and a later change
to `min` or `max` re-clamps. Storage that is unavailable or full is ignored,
and the width simply isn't kept.

## class:Carousel

Tag: `aster-carousel`. Give it `slides` and a `label`.

The element is a `<section aria-roledescription="carousel">` named by `label`,
holding a horizontally scrolling rail of slides and, when there is somewhere to
go, a bar with "n of m" and Previous and Next buttons. Scrolling, swiping and the
buttons all move it, and the slides snap one at a time. Each slide is a
`role="group"` with `aria-roledescription="slide"`, named by its position and
label: "2 of 5: Brand refresh".

Each slide is one card wide with the next one peeking in. To show several at
once, set the CSS custom property `--slide-width` on the carousel (the default is
the rail's width less 28 px).

The nav bar shows only when there is more than one slide and they don't all
fit. The count is a polite live region, and Previous and Next are disabled at
the ends. When every slide fits there are no buttons, and `index` is the
first slide.

The current slide, [[attr:Carousel.index]], is whichever has the most in view,
found with an `IntersectionObserver`; a tie goes to the earlier slide. The
observer is rebuilt when slides change or the element reconnects. Optional stable
slide IDs retain DOM and the current slide across reordering; duplicate IDs are
rejected. Previous/Next respects text direction.

There is no event. The slides and buttons are ordinary tab stops; the rail
itself isn't one.

```ts
import { effect } from "@preact/signals-core";
import { html } from "lit-html";
import type { Carousel } from "@getaster/elements";

const carousel = document.createElement("aster-carousel") as Carousel;
carousel.label = "Pinned projects";
carousel.slides = [
  { label: "Brand refresh", view: html`<h3>Brand refresh</h3>` },
  { label: "Billing", view: html`<h3>Billing</h3>` },
];
document.body.append(carousel);
effect(() => console.log("showing slide", carousel.index));
```

## method:Carousel.show

- `index`: the slide's position, from 0. Values below 0 or above the last slide
  are clamped to the ends.

Scrolls that slide into view. It scrolls smoothly, or at once when the person
prefers reduced motion. It returns nothing and doesn't wait for the scroll to
end: [[attr:Carousel.index]] follows once the slide is mostly in view. Nothing
happens before the carousel has rendered or with no slides.

## attr:Carousel.slides

An array of [[object:Slide]]s. Default `[]`. Reactive. Replacing the array
re-renders the slides.

## attr:Carousel.label

The carousel's accessible name, as `aria-label` on the section. Default `""`.
Reactive.

## attr:Carousel.index

The position of the slide most in view, from 0. Read-only: it has no setter, so
move the carousel with [[method:Carousel.show]]. Reactive, so an `effect` that
reads it follows scrolling and swiping. It starts at `0`, and changes only once
the observer has run, a frame after the first render.

## object:Slide

One card of a [[class:Carousel]].

```ts
const slide: Slide = { label: "Brand refresh", view: html`<h3>Brand refresh</h3><p>Due Friday</p>` };
```

## attr:Slide.label

Names the slide for screen readers, after its position: "2 of 5: Brand refresh".
It isn't displayed; put a visible title in `view`.

## attr:Slide.view

The card's content, a [[type:View]]. It is drawn in a box one slide wide, which
can shrink (`min-width: 0`); long content should wrap.


## attr:Split.orientation

`horizontal` (default) means panes side by side; `vertical` means stacked. The
separator's ARIA orientation is perpendicular to this content direction.
Vertical keyboard resizing uses Up/Down; horizontal uses Left/Right and follows
text direction. Home/End select limits.

## attr:Split.size

Axis-neutral alias of width. Preferred expanded size of the sized pane
([[attr:Split.pane]]) in pixels.

## attr:Split.responsive

Default true. Horizontal splits adapt to their own container width below 720px.
Set false to retain a side-by-side resize bar in a narrow region.

## attr:Split.collapsible

Default false. Enables a collapse/restore control and Enter on the separator.
The sized pane ([[attr:Split.pane]]) collapses. Where the control sits is
[[attr:Split.chrome]]; its text is [[attr:Split.labels]].

## attr:Split.collapsed

Default false. Collapsed pane DOM remains mounted and inert; the preferred
expanded size is preserved. Collapsing focused content moves focus to the bar,
or, where the bar is hidden, to the collapse control or the other pane.

## object:SplitChrome

The plain-data chrome object behind [[attr:Split.chrome]]. Every field is
optional.

| Field | Default | Effect |
|---|---|---|
| `collapse` | `"toolbar"` | Where a collapsible split's collapse control sits. `"toolbar"` is a text button in a row above both panes. `"bar"` is a small chevron button on the resize bar, which stays at the edge where the pane was when it collapses; stacked panes show it between them. `false` draws no control: the host provides its own and sets [[attr:Split.collapsed]], and Enter on the separator still toggles. |

The control is a `button` with `aria-expanded` and `aria-controls` naming the
sized pane. The bar button is a sibling of the separator, not inside it, and
follows it in the Tab order; its accessible name and tooltip come from
[[attr:Split.labels]]. Its chevron points the way the bar will move, for either
pane, orientation and text direction.

## attr:Split.chrome

Presentational chrome. Default `{}`. See [[object:SplitChrome]]. Unknown fields
and other `collapse` values throw a `TypeError`. Reactive: assign a new object;
the stored object is frozen. YAML: `chrome: { collapse: bar }`.

## object:SplitLabels

Text for the collapse control: `collapse` (default `"Collapse pane"`) while the
pane is shown, `restore` (default `"Restore pane"`) while it is collapsed. Name
the pane, such as `"Hide the chart list"` and `"Show the chart list"`.

## attr:Split.labels

The collapse control's text, a [[object:SplitLabels]]. Default `{}`. Unknown
fields or non-string values throw a `TypeError`. Reactive: assign a new object.
The separator's own name stays [[attr:Split.label]].

## attr:Section.disabled

Default false. Disables the header toggle. Programmatic open and automatic
error revelation remain possible.

## attr:Section.actions

A View rendered beside the header toggle, default nothing. Actions remain
separately focusable and are not nested in the toggle button.

## attr:Slide.id

Optional nonempty stable identity. Supply unique IDs for dynamic lists to retain
card DOM and inputs across reorder. Without an ID, identity follows position.

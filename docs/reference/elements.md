# Elements and the base

`@getaster/elements` is a set of custom elements (`aster-field`,
`aster-picker`, `aster-grid`, `aster-menu` and the rest) and the base class
they share. This page covers that base: how an element renders and updates,
how you configure one, how it finds the page it belongs to, and the style
contract (tokens, identities and density) every element is drawn with. It
also covers the small formatting and motion helpers the elements use and an
app can use too.

### How an element works

Every element extends [[class:AsterElement]]. It renders into itself (light
DOM, no shadow root) with [lit-html](https://lit.dev/docs/libraries/standalone-templates/),
and keeps its state in signals from
[@preact/signals-core](https://github.com/preactjs/signals). `render()` runs
inside a signals `computed`, so every signal it reads, whether the element's
own properties, a collection's `items`, a record in the store or a field's
state, becomes a dependency. When one changes the template is rebuilt at
once and committed to the DOM in the next microtask, so a burst of changes
costs one DOM update. Nothing subscribes or unsubscribes by hand; removing
the element from the document disposes everything.

Because the DOM is light, page CSS, the token contract and screen readers all
see one tree. Element styles are kept apart by an `aster-` class prefix and a
cascade layer.

### Configuring an element: properties, not attributes

Elements are configured through JavaScript properties. None of them observe
HTML attributes, so `<aster-button label="Save">` does nothing; set
`button.label = "Save"`, or bind it with lit-html's property syntax:

```ts
import { html, render } from "lit-html";
import "@getaster/elements";

render(
  html`<aster-button .label=${"Save"} .variant=${"primary"} @click=${() => save()}></aster-button>`,
  document.querySelector("#toolbar")!,
);
```

Every property is backed by a signal, so setting it re-renders the element.
Some properties are [[type:Bindable]]: they accept a plain value or a signal
of one, and follow the signal when given one ([[attr:Button.busy]],
[[attr:Tabs.value]]).

Events are `CustomEvent`s that bubble and can be cancelled, with what
changed in `detail`, such as [[event:Tabs.change]] and
[[event:Picker.change]]. Controls bound to an edit model raise no events of
their own: they write to the model, and you read the model.

If you load `aster-ui.js` rather than the packages, import `html`, `render`,
`signal`, `computed` and `effect` from it instead of separate copies of
lit-html and the signals library; a second copy of the signals library
doesn't share dependency tracking with the elements, so changes made through
it don't reach them.

### The page scope

A page's rules and publications live in a `PageScope` (see
[[class:PageScope]]). Elements that publish into it or read from it, such as
a listbox that publishes its selection, find it through the DOM:
[[staticMethod:provideScope]] attaches a scope to an element, and
[[staticMethod:scopeOf]] finds the nearest one at or above an element. A page
usually takes its parent's scope, makes a child, and provides that:

```ts
import { AsterElement, define, provideScope, scopeOf, type View } from "@getaster/elements";
import type { PageScope } from "@getaster/data";
import { html } from "lit-html";

class ReportsPage extends AsterElement {
  #scope: PageScope | undefined;

  override connectedCallback(): void {
    const parent = this.parentElement ? scopeOf(this.parentElement) : undefined;
    if (parent) {
      this.#scope = parent.child();
      provideScope(this, this.#scope);
    }
    super.connectedCallback();
  }

  protected render(): View {
    // Elements in here that look for a scope find this page's.
    return html`<aster-listbox .label=${"Reports"} .publish=${"report"}></aster-listbox>`;
  }
}
define("reports-page", ReportsPage);
```

### Styles: tokens, identities, density

Elements style themselves only through `--aster-` custom properties. The full
list is the token contract, [[constant:TOKENS]]; a theme (an *identity*) is a
complete set of values for those tokens and nothing else. Two identities
ship: Lamplight (the default, on plain `:root`) and Harbour, chosen by
`data-identity` on the root element. `data-scheme="dark"` selects the dark
scheme (see [[staticMethod:setScheme]]).

Density is separate from identity: six sizes ([[constant:DENSITY]]) follow
`data-density` on the root, one of [[constant:DENSITIES]]. With no choice it
is standard, or comfortable on a coarse pointer.

The stylesheets use cascade layers in this order, so app CSS overrides any
element rule without `!important`:

```css
@layer aster.identity, aster.base, aster.elements, app;
```

Writing a theme, and checking one for missing tokens and contrast, is in the
themes guide.

### Writing your own element

Extend [[class:AsterElement]], keep state in `this.prop()` signals behind
plain getters and setters, return a template from `render()`, and register
the class with [[staticMethod:define]]. Use [[staticMethod:each]] for keyed
lists. The example under [[class:AsterElement]] shows all of it.

### Limits

- Text, dates and numbers are formatted for `en-GB` and the calendar starts
  on Monday; there is no localisation, right-to-left layout or high-contrast
  identity yet.
- Elements need current Chromium, Firefox or Safari: they rely on the Popover
  API, CSS anchor positioning, `<dialog>` and `inert`, with no fallback for
  older engines.
- Bound controls aren't form-associated custom elements: read values from
  the edit model, not from a `<form>`'s `FormData`.

## class:AsterElement

Subclasses implement `render()` and may use these protected members:

| Member | What it does |
|---|---|
| `render(): View` | Returns the element's template. Required. Every signal it reads is tracked. |
| `updated(): void` | Runs after each commit to the DOM. Read geometry (sizes, positions) here, not in `render()`. |
| `prop(initial)` | Makes a signal for a property: `readonly #x = this.prop(0)`, with a getter and setter over `#x.value`. |
| `listen(target, type, handler, options?)` | Adds an event listener that's removed when the element disconnects. |
| `onDisconnect(cleanup)` | Runs `cleanup` when the element disconnects. |
| `emit(type, detail?)` | Dispatches a bubbling, cancelable `CustomEvent`; returns `false` if a listener called `preventDefault()`. |

The element renders when it connects and stops tracking when it disconnects;
if it's connected again, it renders afresh. Overriding `connectedCallback`
or `disconnectedCallback` must call `super`.

Only signals read while `render()` runs are tracked. Use `peek()` in event
handlers to read a signal without making it a dependency, and build keyed
lists with [[staticMethod:each]] rather than lit's `repeat`, whose item
callback runs later and isn't tracked.

```ts
import { AsterElement, define, type View } from "@getaster/elements";
import { html } from "lit-html";

class Counter extends AsterElement {
  readonly #count = this.prop(0);
  readonly #step = this.prop(1);

  get count(): number {
    return this.#count.value;
  }
  set count(v: number) {
    this.#count.value = v;
  }
  get step(): number {
    return this.#step.value;
  }
  set step(v: number) {
    this.#step.value = v;
  }

  protected render(): View {
    return html`<button type="button" class="aster-button" @click=${() => this.#bump()}>
      Clicked ${this.#count.value} times
    </button>`;
  }

  #bump(): void {
    this.#count.value = this.#count.peek() + this.#step.peek();
    this.emit("count-change", this.#count.peek());
  }
}

define("my-counter", Counter);
```

## staticMethod:define

Registers `ctor` as the custom element `name`, unless that name is already
registered. A second call with the same name does nothing, even with a
different class, so importing a module twice (or from two bundles) doesn't
throw. Every Aster element module calls it for its own tag, so importing
`@getaster/elements` defines them all.

- `name`: the tag, which must contain a hyphen, such as `"my-counter"`.
- `ctor`: the element class.

```ts
import { define } from "@getaster/elements";

define("my-counter", Counter);
```

## staticMethod:each

Returns a lit-html directive for a `${}` position in the template.

- `items`: the list to render.
- `key`: a stable, unique key for each item, such as its record key. lit uses
  it to move existing DOM rather than rebuild it when the order changes.
- `view`: builds one item's template.

The cost of tracking: any signal one item's view reads re-renders the whole
list when it changes. For long lists render only the visible items, as
[[class:Grid]] does.

```ts
import { AsterElement, define, each, type View } from "@getaster/elements";
import type { Collection, Entity } from "@getaster/data";
import { html, nothing } from "lit-html";

class PeopleList extends AsterElement {
  readonly #people = this.prop<Collection | undefined>(undefined);
  get people(): Collection | undefined {
    return this.#people.value;
  }
  set people(v: Collection | undefined) {
    this.#people.value = v;
  }

  protected render(): View {
    const people = this.#people.value;
    if (!people) return nothing;
    // Unloaded rows are undefined; show the loaded ones.
    const loaded = people.items.value.filter((p): p is Entity => p !== undefined);
    return html`<ul>
      ${each(loaded, (p) => String(p.id), (p) => html`<li>${p.name}</li>`)}
    </ul>`;
  }
}
define("people-list", PeopleList);
```

## staticMethod:provideScope

Elements under `el` that call [[staticMethod:scopeOf]] find this scope unless
a nearer one is provided. Provide it before the element's children connect,
for example at the start of `connectedCallback` before calling `super`.
Calling it again on the same element replaces the scope; elements that
already looked it up keep the one they found.

- `el`: the element the scope belongs to.
- `scope`: the [[class:PageScope]], usually a `child()` of the parent's.

## staticMethod:read

Reads a [[type:Bindable]]: the signal's `value` if it's a signal, otherwise
the value itself. Called inside `render()`, reading a signal makes it a
dependency, so the element follows it. A value counts as a signal when it's
an object with `peek` and `subscribe`.

- `value`: a plain value or a signal of one.

Returns the current value.

```ts
import { AsterElement, define, read, type Bindable, type View } from "@getaster/elements";
import { html } from "lit-html";

class Spinner extends AsterElement {
  readonly #busy = this.prop<Bindable<boolean>>(false);
  get busy(): Bindable<boolean> {
    return this.#busy.value;
  }
  set busy(v: Bindable<boolean>) {
    this.#busy.value = v;
  }

  protected render(): View {
    const busy = read(this.#busy.value); // tracked, whether a value or a signal
    return html`<span class="spinner" ?hidden=${!busy} aria-busy=${busy ? "true" : "false"}></span>`;
  }
}
define("my-spinner", Spinner);
```

## staticMethod:scopeOf

Walks up from `el` through its parents, and out of shadow roots to their
hosts, and returns the first scope given with [[staticMethod:provideScope]].
Returns `undefined` when there is none, for example when the element isn't in
the document yet.

- `el`: where to start; the element itself is checked first.

## type:Bindable

Used for properties an owner often wants to drive from state, such as
[[attr:Button.busy]], [[attr:Tabs.items]] and [[attr:Tabs.value]]. Pass a
signal and the element follows it without being set again; pass a plain
value and set the property again to change it. Elements read either with
[[staticMethod:read]].

```ts
import { signal } from "@preact/signals-core";
import { html } from "lit-html";

const saving = signal(false);
html`<aster-button .label=${"Save"} .busyLabel=${"Saving…"} .busy=${saving}></aster-button>`;
// Later: saving.value = true; the button shows "Saving…" without a re-render of its owner.
```

## type:View

What `render()` returns and what template-valued properties take: a lit-html
`TemplateResult` from `html```, or lit's `nothing` for no content.
Properties such as [[attr:Dialog.content]], [[attr:Window.content]],
[[attr:Field.trailing]] and [[attr:Button.icon]] are `View`s.

## staticMethod:morph

Use it for a change of layout that should read as one shape becoming
another, such as a dialog moving to its next step ([[method:Dialog.showView]]
uses it). Give the container a CSS `view-transition-name` so it morphs
rather than cross-fades. With no View Transitions support in the browser,
or with `prefers-reduced-motion: reduce`, `change` runs at once with no
animation.

- `change`: the DOM change, run synchronously, such as setting a signal
  that an element renders from.

```ts
import { morph } from "@getaster/elements";

morph(() => {
  step.value = "confirm";
});
```

## staticMethod:setScheme

Sets `data-scheme` on the document's root element, which the identities'
dark rules key on. Through [[staticMethod:morph]], so reduced motion turns
the cross-fade off.

- `scheme`: `"light"` or `"dark"`.
- `animate`: `false` to switch without the cross-fade, for example when
  applying a saved choice at start-up. Default `true`.

The choice isn't stored; keep it yourself if it should survive a reload.

```ts
import { setScheme } from "@getaster/elements";

// At start-up: the saved choice, without the cross-fade.
setScheme(localStorage.getItem("scheme") === "dark" ? "dark" : "light", false);

// From a toggle: cross-fades.
function toggleScheme(): void {
  const next = document.documentElement.dataset.scheme === "dark" ? "light" : "dark";
  setScheme(next);
  localStorage.setItem("scheme", next);
}
```

## staticMethod:absoluteTime

The full date and time, in `en-GB` form with a 24-hour clock. Use it as the
title or tooltip of a [[staticMethod:relativeTime]].

- `iso`: an ISO 8601 timestamp, such as `"2026-10-07T14:57:00Z"`.
- `timeZone`: an IANA time zone, such as `"Europe/London"`; the browser's
  own when omitted.

```ts
import { absoluteTime, relativeTime } from "@getaster/elements";
import { html } from "lit-html";

const at = "2026-10-07T13:57:00Z";
html`<time datetime=${at} title=${absoluteTime(at, "Europe/London")}>${relativeTime(at, Date.now())}</time>`;
// title: "Wed 7 Oct 2026, 14:57"
```

## staticMethod:compactMoney

Rounds to one decimal place in compact notation and writes thousands as `k`
and millions as `m`. A negative amount starts with a minus sign (−), not a
hyphen. Formatted for `en-GB`.

- `amount`: the figure, as a number.
- `currency`: an ISO 4217 code. Default `"GBP"`.

Returns text such as `"£41.2k"`, `"£980"` or `"−£1.3m"`. For exact figures in
a form or grid, show the value as stored instead.

The text comes from the browser's `Intl.NumberFormat`, so engines differ in
detail. Chromium gives `"£980"` for 980 and `"£2.5bn"` for 2.5 billion;
JavaScriptCore (as in Bun) has been seen to give `"£980.0"` and `"£2.5B"`.
Only `K` and `M` are rewritten in lower case.

```ts
compactMoney(41_200);          // "£41.2k"
compactMoney(-1_250_000);      // "−£1.3m"
compactMoney(41_200, "EUR");   // "€41.2k"
```

## staticMethod:relativeTime

Under a minute is "Just now", under an hour "18 min ago", then hours on the
same calendar day, "Yesterday", a short weekday ("Mon") within six days, and
a day and month ("7 Oct") after that. Days are counted in `timeZone`.

- `iso`: an ISO 8601 timestamp.
- `now`: the current time in milliseconds, such as `Date.now()`. Passing it
  keeps the function pure, so a page can re-render on a timer, or tests can
  freeze time.
- `timeZone`: an IANA time zone; the browser's own when omitted.

A timestamp in the future reads "Just now". The text has no year, so always
pair it with [[staticMethod:absoluteTime]], as a title or tooltip. Weekday
and month names come from the browser's `Intl.DateTimeFormat`, so they can
differ from [[staticMethod:formatDate]]'s: Chromium writes September as
"Sept", where `formatDate` writes "Sep".

```ts
const now = Date.parse("2026-10-07T15:15:00Z");
relativeTime("2026-10-07T14:57:00Z", now, "UTC"); // "18 min ago"
relativeTime("2026-10-07T09:00:00Z", now, "UTC"); // "6 h ago"
relativeTime("2026-10-06T09:00:00Z", now, "UTC"); // "Yesterday"
relativeTime("2026-10-03T09:00:00Z", now, "UTC"); // "Sat"
```

## constant:TOKENS

Token names by role, without the `--aster-` prefix: `type`, `surfaces`,
`text`, `edges`, `accent`, `status`, `identity`, `elevation`, `shape`,
`motion`, `toast` and `light`. An identity must define every one of them in
its light rule; its dark rule (`:root[data-scheme="dark"]`, or the
identity's own) overrides only what changes. The element stylesheets use
no `--aster-` property outside this list and [[constant:DENSITY]].

Use the tokens in your own CSS so app screens follow the identity and scheme:

```css
@layer app {
  .summary-card {
    background: var(--aster-surface);
    color: var(--aster-text);
    border-radius: var(--aster-r-card);
    box-shadow: var(--aster-e1);
  }
}
```

## constant:TOKEN_NAMES

Every name in [[constant:TOKENS]] as a full custom property name, such as
`--aster-accent`. Useful for checking that a theme is complete in the page as
loaded:

```ts
import { TOKEN_NAMES } from "@getaster/elements";

const style = getComputedStyle(document.documentElement);
const missing = TOKEN_NAMES.filter((name) => style.getPropertyValue(name).trim() === "");
if (missing.length) console.warn("Theme is missing", missing);
```

## constant:DENSITY

The names without the `--aster-` prefix, and their values in each density:

| Token | Sets | Compact | Standard | Comfortable |
|---|---|---|---|---|
| `ctl` | Control height | 26px | 30px | 38px |
| `ctl-tight` | Controls inside grids | 22px | 26px | 32px |
| `pad-y` | Vertical padding of grid cells and listbox rows | 5px | 9px | 12px |
| `row-y` | Vertical padding of single-line rows: menu items, options, tabs, nav items | 3px | 6px | 9px |
| `pad` | Padding of panels and bars | 8px | 12px | 16px |
| `gap` | Space between fields | 10px | 14px | 18px |

The base stylesheet defines them for each value of `data-density` on the root
element. A theme doesn't set them. Use them in your own CSS so app layout
moves with the elements:

```css
.toolbar { padding: var(--aster-pad); gap: var(--aster-gap); min-height: var(--aster-ctl); }
```

## constant:DENSITIES

The values `data-density` on the root element accepts: `"compact"`,
`"standard"` and `"comfortable"`. Without the attribute the page is
standard, or comfortable on a coarse pointer (a touch screen). Density
belongs to the person, so keep their choice rather than tying it to a theme.

```ts
import { DENSITIES } from "@getaster/elements";

type Density = (typeof DENSITIES)[number];

function setDensity(d: Density): void {
  document.documentElement.dataset.density = d;
  localStorage.setItem("density", d);
}
```

## constant:DENSITY_NAMES

Every name in [[constant:DENSITY]] as a full custom property name, such as
`--aster-ctl`.

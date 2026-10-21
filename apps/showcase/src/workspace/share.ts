import { signal } from "@preact/signals-core";
import { EditModel, keyText, type DataContext, type Entity, type Rule } from "@getaster/data";
import { announce, each, type Button, type Dialog, type Field } from "@getaster/elements";
import { html } from "lit-html";
import type { Model } from "./model.ts";

type View = "invite" | "link";

const LINK = keyText([1]);

/**
 * The Share dialog: inviting people (an edit model for a new member, with
 * rules for each kind of failure) and the link settings (switches bound to
 * the share link's fields). One dialog morphs between the two views.
 */
export class Share {
  readonly view = signal<View>("invite");
  readonly invite = signal<EditModel>(undefined as unknown as EditModel);
  readonly #ctx: DataContext;
  readonly #model: Model;

  constructor(ctx: DataContext, model: Model) {
    this.#ctx = ctx;
    this.#model = model;
    this.invite.value = this.#newInvite();
  }

  /** Back to an empty invite on the first view. */
  reset(): void {
    this.view.value = "invite";
    this.invite.peek().dispose();
    this.invite.value = this.#newInvite();
  }

  render(dialog: () => Dialog | null) {
    const view = this.view.value;
    const swap = (to: View) => dialog()?.showView(() => (this.view.value = to));
    return html`
      <div class="share-view" ?hidden=${view !== "invite"}>
        <h2 id="share-title">Share Projects</h2>
        ${this.#inviteForm()}
        ${this.#people()}
      </div>
      <div class="share-view" ?hidden=${view !== "link"}>
        <nav class="crumbs" aria-label="You are in">
          <button type="button" @click=${() => swap("invite")}>Share Projects</button><span aria-hidden="true">/</span>
        </nav>
        <h2 id="link-title">Link settings</h2>
        <p>Anyone with the link can view these projects. Choose what else they can do.</p>
        ${this.#link()}
      </div>
      <footer class="share-footer">
        <aster-button ?hidden=${view !== "invite"} .label=${"Link settings"} @click=${() => swap("link")}></aster-button>
        <aster-button class="share-done" .variant=${"primary"} .label=${"Done"} @click=${() => dialog()?.close()}></aster-button>
      </footer>`;
  }

  #inviteForm() {
    const edit = this.invite.value;
    return html`<form class="invite" novalidate @submit=${(e: SubmitEvent) => this.#submit(e)}>
      <aster-field .model=${edit} .field=${"name"} .label=${"Invite by name or email"}
        .placeholder=${"Name or email address"}
        .trailing=${html`<aster-button .type=${"submit"} .label=${"Invite"} .busyLabel=${"Inviting…"} .busy=${edit.busy}></aster-button>`}>
      </aster-field>
    </form>`;
  }

  #people() {
    const members = this.#model.members.items.value.filter((m): m is Entity => m !== undefined);
    const roles = this.#ctx.schema.set("Members").type.field("role")?.allowedValues ?? [];
    return html`<div class="people" role="list" aria-label="People with access">
      ${each(
        members,
        (m) => String(m.id),
        (m) => {
          const person = m.personId === null ? undefined : this.#ctx.lookup("People", keyText([m.personId!])).value;
          const role = roles.find((r) => r.value === m.role)?.label ?? String(m.role);
          return html`<div class="person" role="listitem" data-copyable data-member=${String(m.id)}>
            <i class="aster-avatar" style=${person ? `--hue:${person.hue}` : "--aster-identity-c:0"}></i>${m.name}<span>${role}</span>
          </div>`;
        },
      )}
    </div>`;
  }

  #link() {
    const link = this.#ctx.lookup("ShareLinks", LINK).value;
    const url = String(link?.url ?? "");
    return html`<div class="link-row">
        <aster-field .value=${url} .readOnly=${true} .label=${"Share link"}
          .trailing=${html`<aster-button .label=${"Copy link"} .confirmLabel=${"Copied"}
            @click=${async (e: Event) => {
              const button = e.currentTarget as Button;
              await copyText(`https://${url}`, button);
              button.confirm();
            }}></aster-button>`}></aster-field>
      </div>
      <div class="options">
        ${["allowComments", "allowDownloads", "expiresIn30Days"].map(
          (field) => html`<aster-switch .binding=${{ ctx: this.#ctx, set: "ShareLinks", key: LINK, field }}></aster-switch>`,
        )}
      </div>`;
  }

  async #submit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const field = form.querySelector<Field>("aster-field");
    const edit = this.invite.peek();
    if (edit.busy.peek()) return;
    if (!edit.validate()) {
      field?.focus();
      return;
    }
    const who = this.#resolve(String(edit.values.peek().name ?? "").trim());
    edit.set("name", who.name);
    edit.set("email", who.email);
    edit.set("personId", who.personId);
    const saved = await edit.save();
    if (!saved) {
      field?.focus();
      return;
    }
    edit.dispose();
    this.invite.value = this.#newInvite();
    announce(`Invited ${who.name}`);
    requestAnimationFrame(() => {
      field?.focus();
      flashMember(form.closest(".share-view"), JSON.parse(saved.key)[0]);
    });
  }

  #newInvite(): EditModel {
    return new EditModel(this.#ctx, "Members", undefined, { name: "", email: null, personId: null, role: "view" }, { rules: [this.#rule] });
  }

  /** Each kind of failure gets its own message, quoting what was typed. */
  readonly #rule: Rule = (values) => {
    const v = String(values.name ?? "").trim();
    if (!v) return { name: "Type a name or an email address, then press Invite." };
    const lower = v.toLowerCase();
    const roles = this.#ctx.schema.set("Members").type.field("role")?.allowedValues ?? [];
    const existing = this.#model.members.items.peek().find(
      (m) => m && (String(m.name).toLowerCase() === lower || String(m.email ?? "").toLowerCase() === lower),
    );
    if (existing) {
      const role = roles.find((r) => r.value === existing.role)?.label ?? String(existing.role);
      return { name: `${existing.name} already has access (${role.toLowerCase()}).` };
    }
    if (v.includes("@")) {
      const [user, domain = ""] = v.split("@");
      if (!user) return { name: `“${v}” is missing the name before the @. For example: grace@aster.example` };
      if (!/^[^\s@]+\.[^\s@]{2,}$/.test(domain)) return { name: `“${v}” is missing the part after the @, such as aster.example.` };
      return {};
    }
    if (this.#person(lower)) return {};
    return { name: `No one called “${v}” is in Aster yet. Use their email address to invite them.` };
  };

  #person(lowerName: string): Entity | undefined {
    return this.#model.people.items.peek().find((p) => p && String(p.name).toLowerCase() === lowerName);
  }

  #resolve(text: string): { name: string; email: string | null; personId: number | null } {
    const person = this.#person(text.toLowerCase());
    if (person) return { name: String(person.name), email: (person.email as string | null) ?? null, personId: Number(person.id) };
    const byEmail = this.#model.people.items.peek().find((p) => p && String(p.email).toLowerCase() === text.toLowerCase());
    if (byEmail) return { name: String(byEmail.name), email: String(byEmail.email), personId: Number(byEmail.id) };
    return { name: text.toLowerCase(), email: text.toLowerCase(), personId: null };
  }
}

function flashMember(scope: Element | null, id: unknown): void {
  const row = scope?.querySelector<HTMLElement>(`[data-member="${String(id)}"]`);
  if (!row) return;
  row.classList.remove("aster-flash");
  void row.offsetWidth;
  row.classList.add("aster-flash");
}

async function copyText(text: string, from: Element): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    from.closest("aster-field")?.querySelector("input")?.select();
  }
}

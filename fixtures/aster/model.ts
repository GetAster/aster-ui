// The information model: a client intake questionnaire of about 400 fields,
// with answers and rules, built the same way every time. Rules name fields
// here; the generator turns names into ids.

export interface Field {
  id: number;
  parentId: number | null;
  name: string;
  label: string;
  kind: "group" | "text" | "choice" | "yesno" | "date" | "number";
  required: boolean;
  help: string | null;
  position: number;
}
export interface Answer {
  id: number;
  fieldId: number;
  key: string;
  label: string;
  position: number;
}
export interface Clause {
  id: number;
  fieldId: number;
  category: "visibility" | "message";
  parentClauseId: number | null;
  op: string;
  fieldRef: number | null;
  value: string | null;
  message: string | null;
  position: number;
}
export interface ModelData {
  Fields: Field[];
  Answers: Answer[];
  Clauses: Clause[];
  Changes: never[];
}

/** A leaf: a field (by name, or `./name` within the same group) compared to a value. */
type Leaf = readonly [field: string, op: string, value?: string | readonly string[]];
interface Rule {
  readonly op: "and" | "or" | "not";
  readonly clauses: readonly (Leaf | Rule)[];
  readonly message?: string;
}
interface Spec {
  readonly name: string;
  readonly label: string;
  readonly kind: Field["kind"];
  readonly required?: boolean;
  readonly help?: string;
  readonly answers?: readonly string[];
  readonly visible?: Rule;
  readonly messages?: readonly Rule[];
  readonly children?: readonly Spec[];
}

const all = (...clauses: (Leaf | Rule)[]): Rule => ({ op: "and", clauses });
const any = (...clauses: (Leaf | Rule)[]): Rule => ({ op: "or", clauses });
const warn = (message: string, ...clauses: (Leaf | Rule)[]): Rule => ({ op: "and", clauses, message });

const text = (name: string, label: string, more: Partial<Spec> = {}): Spec => ({ name, label, kind: "text", ...more });
const yesno = (name: string, label: string, more: Partial<Spec> = {}): Spec => ({ name, label, kind: "yesno", ...more });
const date = (name: string, label: string, more: Partial<Spec> = {}): Spec => ({ name, label, kind: "date", ...more });
const number = (name: string, label: string, more: Partial<Spec> = {}): Spec => ({ name, label, kind: "number", ...more });
const choice = (name: string, label: string, answers: readonly string[], more: Partial<Spec> = {}): Spec => ({ name, label, kind: "choice", answers, ...more });
const group = (name: string, label: string, children: readonly Spec[], more: Partial<Spec> = {}): Spec => ({ name, label, kind: "group", children, ...more });

const COUNTRIES = [
  "gb:United Kingdom", "ie:Ireland", "de:Germany", "fr:France", "nl:Netherlands", "es:Spain", "it:Italy", "se:Sweden",
  "ch:Switzerland", "us:United States", "ae:United Arab Emirates", "sg:Singapore", "ky:Cayman Islands", "pa:Panama", "ru:Russia",
];
const HIGH_RISK = ["ky", "pa", "ru"];
const ROLES = ["director:Director", "shareholder:Shareholder", "owner:Beneficial owner", "signatory:Authorised signatory", "trustee:Trustee"];

const address = (prefix: string, label: string, more: Partial<Spec> = {}) =>
  group(`${prefix}Address`, label, [
    text("line1", "Address line 1", { required: true }),
    text("line2", "Address line 2"),
    text("city", "Town or city", { required: true }),
    text("postcode", "Postcode"),
    choice("country", "Country", COUNTRIES, {
      required: true,
      messages: [warn("Enhanced due diligence is needed for this jurisdiction.", ["./country", "in", HIGH_RISK])],
    }),
  ], more);

const party = (n: number): Spec =>
  group(`party${n}`, `Related party ${n}`, [
    choice("role", "Role", ROLES, { required: true }),
    text("fullName", "Full name", { required: true }),
    date("born", "Date of birth", { visible: all(["./role", "ne", "trustee"]) }),
    choice("nationality", "Nationality", COUNTRIES),
    number("ownership", "Ownership (%)", {
      visible: any(["./role", "eq", "shareholder"], ["./role", "eq", "owner"]),
      messages: [warn("Owners of 25% or more must be verified in person.", ["./ownership", "gt", "24.99"])],
    }),
    yesno("pep", "Politically exposed person"),
    text("pepRole", "Public role held", { visible: all(["./pep", "eq", "true"]), required: true }),
    yesno("verified", "Identity verified"),
    date("verifiedOn", "Verified on", { visible: all(["./verified", "eq", "true"]) }),
    choice("idDocument", "Identity document", ["passport:Passport", "licence:Driving licence", "card:National identity card"], {
      visible: all(["./verified", "eq", "true"]),
    }),
    address(`party${n}`, "Residential address", { visible: all(["./role", "ne", "trustee"]) }),
  ], n > 2 ? { visible: all(["partyCount", "gt", String(n - 1)]) } : {});

const SPEC: readonly Spec[] = [
  group("client", "Client details", [
    text("legalName", "Legal name", { required: true }),
    text("tradingName", "Trading name"),
    choice("clientType", "Client type", ["individual:Individual", "company:Company", "trust:Trust", "partnership:Partnership", "charity:Charity"], { required: true }),
    date("incorporated", "Date of incorporation", { visible: all(["clientType", "in", ["company", "partnership", "charity"]]) }),
    text("companyNumber", "Company number", { visible: all(["clientType", "eq", "company"]), help: "As shown on the register of companies." }),
    text("charityNumber", "Charity number", { visible: all(["clientType", "eq", "charity"]) }),
    choice("incorporatedIn", "Country of incorporation", COUNTRIES, { visible: all(["clientType", "ne", "individual"]) }),
    address("registered", "Registered address"),
    yesno("tradingElsewhere", "Trades from another address"),
    address("trading", "Trading address", { visible: all(["tradingElsewhere", "eq", "true"]) }),
    group("contact", "Main contact", [
      text("name", "Name", { required: true }),
      text("email", "Email", { required: true }),
      text("phone", "Phone"),
      choice("preferred", "Preferred contact", ["email:Email", "phone:Phone", "post:Post"]),
    ]),
  ]),
  group("aml", "Anti-money laundering", [
    choice("residence", "Country of residence", COUNTRIES, {
      required: true,
      messages: [warn("Clients resident here need senior approval.", ["residence", "in", HIGH_RISK])],
    }),
    yesno("highRisk", "High-risk jurisdiction involved", { visible: any(["residence", "in", HIGH_RISK], ["incorporatedIn", "in", HIGH_RISK]) }),
    text("highRiskReason", "Why the jurisdiction is involved", { visible: all(["highRisk", "eq", "true"]), required: true }),
    choice("sourceOfFunds", "Source of funds", ["salary:Salary", "business:Business income", "investments:Investments", "inheritance:Inheritance", "sale:Sale of assets", "other:Other"], { required: true }),
    text("sourceOther", "Source of funds (other)", { visible: all(["sourceOfFunds", "eq", "other"]), required: true }),
    number("expectedTurnover", "Expected yearly turnover (£)", {
      messages: [warn("Turnover over £5m needs a second reviewer.", ["expectedTurnover", "gt", "5000000"])],
    }),
    yesno("cashIntensive", "Cash-intensive business", { visible: all(["clientType", "ne", "individual"]) }),
    yesno("sanctionsHit", "Possible sanctions match"),
    text("sanctionsNote", "Sanctions review note", { visible: all(["sanctionsHit", "eq", "true"]), required: true }),
    group("screening", "Screening", [
      date("screenedOn", "Screened on", { required: true }),
      choice("provider", "Screening provider", ["worldcheck:World-Check", "dowjones:Dow Jones", "lexis:LexisNexis"]),
      choice("outcome", "Outcome", ["clear:Clear", "review:Needs review", "match:Match"], {
        messages: [warn("A match must be escalated before onboarding.", ["./outcome", "eq", "match"])],
      }),
      text("reviewer", "Reviewer", { visible: any(["./outcome", "eq", "review"], ["./outcome", "eq", "match"]) }),
    ]),
  ]),
  group("parties", "Related parties", [
    number("partyCount", "Number of related parties", { required: true, help: "Directors, shareholders, owners, signatories and trustees." }),
    ...Array.from({ length: 24 }, (_, i) => party(i + 1)),
  ], { visible: all(["clientType", "ne", "individual"]) }),
  group("services", "Services", [
    choice("products", "Main product", ["current:Current account", "savings:Savings", "lending:Lending", "fx:Foreign exchange", "custody:Custody"], { required: true }),
    number("monthlyPayments", "Payments a month"),
    yesno("international", "Sends payments abroad"),
    choice("destinations", "Main destination", COUNTRIES, {
      visible: all(["international", "eq", "true"]),
      messages: [warn("Payments to this country are monitored.", ["destinations", "in", HIGH_RISK])],
    }),
    number("fxVolume", "Foreign exchange a year (£)", { visible: all(["products", "eq", "fx"]) }),
    text("lendingPurpose", "Purpose of borrowing", { visible: all(["products", "eq", "lending"]) }),
  ]),
  group("declaration", "Declaration", [
    yesno("accurate", "The information given is accurate", { required: true }),
    text("signedBy", "Signed by", { required: true }),
    date("signedOn", "Signed on", { required: true }),
  ]),
];

export function modelData(): ModelData {
  const Fields: Field[] = [];
  const Answers: Answer[] = [];
  const Clauses: Clause[] = [];
  const pending: { fieldId: number; scope: Map<string, number>; spec: Spec }[] = [];
  const byName = new Map<string, number>();

  const add = (spec: Spec, parentId: number | null, position: number, siblings: Map<string, number>) => {
    const id = Fields.length + 1;
    Fields.push({ id, parentId, name: spec.name, label: spec.label, kind: spec.kind, required: spec.required ?? false, help: spec.help ?? null, position });
    siblings.set(spec.name, id);
    if (!byName.has(spec.name)) byName.set(spec.name, id);
    (spec.answers ?? []).forEach((a, i) => {
      const [key, label] = a.split(":") as [string, string];
      Answers.push({ id: Answers.length + 1, fieldId: id, key, label, position: i + 1 });
    });
    pending.push({ fieldId: id, scope: siblings, spec });
    const own = new Map<string, number>();
    (spec.children ?? []).forEach((c, i) => add(c, id, i + 1, own));
  };
  const top = new Map<string, number>();
  SPEC.forEach((s, i) => add(s, null, i + 1, top));

  const ref = (name: string, scope: Map<string, number>): number => {
    const id = name.startsWith("./") ? scope.get(name.slice(2)) : byName.get(name);
    if (id === undefined) throw new Error(`no field ${name}`);
    return id;
  };
  const write = (fieldId: number, category: Clause["category"], scope: Map<string, number>, rule: Rule, parentClauseId: number | null, position: number) => {
    const id = Clauses.length + 1;
    Clauses.push({ id, fieldId, category, parentClauseId, op: rule.op, fieldRef: null, value: null, message: rule.message ?? null, position });
    rule.clauses.forEach((c, i) => {
      if (!Array.isArray(c)) return write(fieldId, category, scope, c as Rule, id, i + 1);
      const [field, op, value] = c as Leaf;
      Clauses.push({
        id: Clauses.length + 1, fieldId, category, parentClauseId: id, op, fieldRef: ref(field, scope),
        value: value === undefined ? null : typeof value === "string" ? value : JSON.stringify(value), message: null, position: i + 1,
      });
    });
  };
  for (const { fieldId, scope, spec } of pending) {
    if (spec.visible) write(fieldId, "visibility", scope, spec.visible, null, 1);
    spec.messages?.forEach((m, i) => write(fieldId, "message", scope, m, null, i + 1));
  }
  return { Fields, Answers, Clauses, Changes: [] };
}

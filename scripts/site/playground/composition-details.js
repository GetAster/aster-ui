import { Form } from "../lib/aster-ui.js";

// This ES module is fetched only when the details child is first activated.
export function createDetails({ props }) {
  const element = document.createElement("section");
  element.className = "composition-editor";
  element.setAttribute("aria-label", "Device editor");
  const title = document.createElement("h2"); title.textContent = "Edit the shared record";
  const help = document.createElement("p"); help.textContent = "This panel was loaded on demand. Switching presentation keeps this draft.";
  const form = new Form();
  form.sections = [{ title: "Device details", columns: 2, items: ["name", "owner"] }];
  form.model = props.editor;
  element.append(title, help, form);
  return { element };
}

export function applyDetails(element, props) {
  element.querySelector("aster-form").model = props.editor;
}

export function createCompactDetails(context) {
  const session = createDetails(context);
  session.element.querySelector("h2").textContent = "Device inspector";
  session.element.querySelector("aster-form").sections = [{ title: "Device details", columns: 1, items: ["name", "owner"] }];
  return session;
}

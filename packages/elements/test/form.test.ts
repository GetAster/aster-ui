import { describe, expect, test } from "bun:test";
import {
  formFeature,
  savesOnEnter,
  validationOn,
  validateFormFeatures,
  withFormFeature,
  withoutFormFeature,
  type FormFeature,
} from "../src/form/features.ts";
import {
  autoFocusOnError,
  errorSummaryShown,
  formColumns,
  inlineErrorsShown,
  titleOrientation,
} from "../src/form/policy.ts";

describe("form features", () => {
  test("absent descriptors keep submit-time validation and no Enter save", () => {
    expect(validationOn([])).toBe("submit");
    expect(savesOnEnter([])).toBe(false);
    expect(formFeature([], "save")).toBeUndefined();
  });

  test("a descriptor says when validation runs, and whether Enter saves", () => {
    const features: FormFeature[] = [{ kind: "validation", on: "exit" }, { kind: "save" }];
    expect(validationOn(features)).toBe("exit");
    expect(savesOnEnter(features)).toBe(true);
    expect(formFeature(features, "validation")).toEqual({ kind: "validation", on: "exit" });
  });

  test("writing one descriptor leaves the others alone, and removes only its own kind", () => {
    const before: FormFeature[] = [{ kind: "save" }, { kind: "validation", on: "change" }];
    const next = withFormFeature(before, { kind: "validation", on: "exit" });
    expect(next).toEqual([{ kind: "save" }, { kind: "validation", on: "exit" }]);
    expect(withoutFormFeature(next, "save")).toEqual([{ kind: "validation", on: "exit" }]);
    expect(before).toHaveLength(2);
  });

  test("invalid descriptors are refused with a specific reason", () => {
    expect(() => validateFormFeatures({})).toThrow("features must be an array");
    expect(() => validateFormFeatures([null])).toThrow("each feature must be a plain object");
    expect(() => validateFormFeatures([{ kind: "focus" }])).toThrow("unknown feature kind");
    expect(() => validateFormFeatures([{ kind: "save" }, { kind: "save" }])).toThrow("appears more than once");
    expect(() => validateFormFeatures([{ kind: "validation", on: "blur" }])).toThrow('validation.on must be "change" or "exit"');
    expect(() => validateFormFeatures([{ kind: "validation", on: "submit" }])).toThrow('validation.on must be "change" or "exit"');
    expect(() => validateFormFeatures([{ kind: "validation", on: "change" }, { kind: "save" }])).not.toThrow();
  });
});

describe("form chrome defaults", () => {
  test("an empty chrome keeps two columns, labels above, inline errors and no summary or focus move", () => {
    expect(formColumns({})).toBe(2);
    expect(titleOrientation({})).toBe("top");
    expect(inlineErrorsShown({})).toBe(true);
    expect(errorSummaryShown({})).toBe(false);
    expect(autoFocusOnError({})).toBe(false);
  });

  test("explicit chrome values win, including switching inline errors off", () => {
    const chrome = { columns: 3, titleOrientation: "start", showInlineErrors: false, errorSummary: true, autoFocus: true } as const;
    expect(formColumns(chrome)).toBe(3);
    expect(titleOrientation(chrome)).toBe("start");
    expect(inlineErrorsShown(chrome)).toBe(false);
    expect(errorSummaryShown(chrome)).toBe(true);
    expect(autoFocusOnError(chrome)).toBe(true);
  });
});

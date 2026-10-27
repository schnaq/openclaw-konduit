import { describe, expect, it } from "vitest";
import { checkSubset } from "./catalog-check.js";

const manifest = { defaultModel: "a/x", models: [{ id: "a/x" }, { id: "b/y" }] };

describe("checkSubset", () => {
  it("catalog check passes when live has more models", () => {
    expect(checkSubset(manifest, ["a/x", "b/y", "c/z"])).toEqual([]);
  });

  it("catalog check fails naming a missing model", () => {
    const problems = checkSubset(manifest, ["a/x", "c/z"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("b/y");
  });

  it("catalog check fails when the default model is not listed", () => {
    const problems = checkSubset({ defaultModel: "d/w", models: [{ id: "a/x" }] }, ["a/x"]);
    expect(problems.join("\n")).toContain("d/w");
  });
});

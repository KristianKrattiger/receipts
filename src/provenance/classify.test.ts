import { describe, expect, it } from "vitest"
import { classifyStability } from "./classify.js"

describe("classifyStability", () => {
  it("honours an explicit stable declaration", () => {
    expect(classifyStability("stable")).toBe("stable")
  })

  it("honours an explicit volatile declaration", () => {
    expect(classifyStability("volatile")).toBe("volatile")
  })

  it("defaults an undeclared source to volatile", () => {
    expect(classifyStability(undefined)).toBe("volatile")
  })
})

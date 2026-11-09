import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { configureForm, type FormSettings } from "./formConfig";

const FORM = readFileSync(join(__dirname, "../../public/pre-interview/ai-pds-pre-interview-form.html"), "utf8");

const SETTINGS: FormSettings = {
  type: "problem", topic: "견적 회신이 늦은 문제", business: "부품 주문 생산", customers: "조립 업체",
  team: "영업지원팀", due: "11월 20일", contact: "담당자", email: "a@example.com", workshop: "11월 27일",
};

function configOf(html: string): Record<string, string> {
  const m = html.match(/window\.FORM_CONFIG = (\{[\s\S]*?\n\});/);
  if (!m) throw new Error("no config");
  return JSON.parse(m[1]);
}

describe("configureForm", () => {
  it("fills every setting and leaves the company name empty", () => {
    const cfg = configOf(configureForm(FORM, SETTINGS));
    expect(cfg).toEqual({ ...SETTINGS, customer: "" });
  });

  it("keeps the rest of the form unchanged", () => {
    const out = configureForm(FORM, SETTINGS);
    const strip = (h: string) => h.replace(/window\.FORM_CONFIG = \{[\s\S]*?\n\};/, "");
    expect(strip(out)).toBe(strip(FORM));
  });

  it("cannot end the script element or inject a replacement pattern", () => {
    const evil = { ...SETTINGS, topic: "</script><script>alert(1)</script> $& $1", business: "a b" };
    const out = configureForm(FORM, evil);
    expect(out).not.toContain("</script><script>alert(1)");
    expect(out.match(/<\/script>/g)?.length).toBe(FORM.match(/<\/script>/g)?.length);
    const cfg = configOf(out);
    expect(cfg.topic).toBe("</script><script>alert(1)</script> $& $1");
    expect(cfg.business).toBe("a b");
  });

  it("flattens line breaks a user pasted into a one-line setting", () => {
    expect(configOf(configureForm(FORM, { ...SETTINGS, topic: "첫 줄\n둘째 줄" })).topic).toBe("첫 줄 둘째 줄");
  });

  it("refuses a file without exactly one config block", () => {
    expect(() => configureForm("<html></html>", SETTINGS)).toThrow(/found 0/);
  });
});

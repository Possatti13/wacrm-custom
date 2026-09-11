import { describe, it, expect } from "vitest";
import {
  getContactDisplayName,
  getContactInitials,
  isGenericPlaceholderName,
} from "./display";

describe("Contact Identity & Display Resolution (5-Tier Precedence)", () => {
  it("prefers explicitly saved custom CRM name over phone and defaults", () => {
    const contact = {
      name: "Dr. Carlos Eduardo",
      phone: "5511988887777",
    };
    expect(getContactDisplayName(contact)).toBe("Dr. Carlos Eduardo");
  });

  it("skips generic placeholder names (e.g. 'Agent', 'WhatsApp Contact', 'Unknown') and uses formatted phone", () => {
    const placeholders = [
      "Agent",
      "agent",
      "WhatsApp Contact",
      "whatsapp contact",
      "Contato WhatsApp",
      "Contato sem nome",
      "sem nome",
      "contato",
      "Unknown",
      "Customer",
      "Cliente",
      "usuario",
      "user",
      "[object Object]",
    ];

    for (const placeholder of placeholders) {
      expect(isGenericPlaceholderName(placeholder)).toBe(true);
      const contact = {
        name: placeholder,
        phone: "5511999998888",
      };
      expect(getContactDisplayName(contact)).toBe("+55 (11) 99999-8888");
    }
  });

  it("resolves WhatsApp push name when contact name is missing or generic placeholder", () => {
    const contact = {
      name: "WhatsApp Contact",
      push_name: "Mariana Silva",
      phone: "5511999998888",
    };
    expect(getContactDisplayName(contact)).toBe("Mariana Silva");
  });

  it("formats 11-digit Brazilian mobile numbers correctly when name is absent", () => {
    const contact = {
      phone: "5511998765432",
    };
    expect(getContactDisplayName(contact)).toBe("+55 (11) 99876-5432");
  });

  it("handles WhatsApp Privacy LID contacts when phone is absent", () => {
    const contact = {
      whatsapp_lid: "25190000009361@lid",
    };
    expect(getContactDisplayName(contact)).toBe("Contato WhatsApp");
  });

  it("falls back to default fallback text when no identity is present", () => {
    expect(getContactDisplayName(null)).toBe("Contato sem nome");
    expect(getContactDisplayName({})).toBe("Contato sem nome");
    expect(getContactDisplayName({}, "Cliente Desconhecido")).toBe("Cliente Desconhecido");
  });

  it("extracts clean uppercase initials for avatars and never slices digits into 77/48/33/0", () => {
    expect(getContactInitials("Carlos Eduardo")).toBe("CE");
    expect(getContactInitials("Ana")).toBe("AN");
    // Phone numbers must return neutral "W" (WhatsApp), NEVER sliced digits like "88", "77", "48", "33"
    expect(getContactInitials("+55 (11) 99999-8888")).toBe("W");
    expect(getContactInitials("+55 (77) 99999-9977")).toBe("W");
    expect(getContactInitials("5511999998888")).toBe("W");
    expect(getContactInitials("")).toBe("C");
    expect(getContactInitials(null)).toBe("C");
    expect(getContactInitials("0")).toBe("C");
    expect(getContactInitials("+0")).toBe("C");
    expect(getContactInitials("WhatsApp Contact")).toBe("C");
    expect(getContactInitials("Agent")).toBe("C");
  });

  it("never renders '0' or '+0' as display name or phone", () => {
    const zeroContact = {
      name: "0",
      phone: "0",
      push_name: null,
    };
    expect(isGenericPlaceholderName("0")).toBe(true);
    expect(isGenericPlaceholderName("+0")).toBe(true);
    expect(getContactDisplayName(zeroContact)).toBe("Contato sem nome");
  });
});

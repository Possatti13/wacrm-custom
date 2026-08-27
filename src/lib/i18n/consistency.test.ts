import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { SETTINGS_SECTIONS, RAIL_GROUPS } from '@/components/settings/settings-sections';
import { ACCOUNT_ROLES } from '@/lib/auth/roles';

function getAllKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...getAllKeys(v as Record<string, unknown>, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

function getNested(obj: Record<string, unknown>, pathStr: string): unknown {
  const parts = pathStr.split('.');
  let curr: unknown = obj;
  for (const p of parts) {
    if (curr == null || typeof curr !== 'object') return undefined;
    curr = (curr as Record<string, unknown>)[p];
  }
  return curr;
}

describe('i18n Consistency & Completeness Guard (Phase 17B.0)', () => {
  const ptPath = path.join(process.cwd(), 'messages', 'pt-BR.json');
  const enPath = path.join(process.cwd(), 'messages', 'en.json');

  const pt = JSON.parse(fs.readFileSync(ptPath, 'utf8'));
  const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));

  it('enforces exact structural parity between pt-BR and en dictionaries', () => {
    const ptKeys = getAllKeys(pt);
    const enKeys = getAllKeys(en);

    const missingInPt = enKeys.filter((k) => !ptKeys.includes(k));
    const missingInEn = ptKeys.filter((k) => !enKeys.includes(k));

    expect(
      missingInPt,
      `pt-BR is missing translation keys present in en: ${missingInPt.join(', ')}`
    ).toEqual([]);

    expect(
      missingInEn,
      `en is missing translation keys present in pt-BR: ${missingInEn.join(', ')}`
    ).toEqual([]);
  });

  it('guarantees that every SettingsSection has a translation in Settings.sections for both locales', () => {
    for (const section of SETTINGS_SECTIONS) {
      const ptSectionLabel = getNested(pt, `Settings.sections.${section}`);
      const enSectionLabel = getNested(en, `Settings.sections.${section}`);

      expect(
        typeof ptSectionLabel === 'string' && ptSectionLabel.length > 0,
        `Missing pt-BR translation for Settings.sections.${section}`
      ).toBe(true);

      expect(
        typeof enSectionLabel === 'string' && enSectionLabel.length > 0,
        `Missing en translation for Settings.sections.${section}`
      ).toBe(true);
    }
  });

  it('guarantees that every RailGroup has a translation in Settings.groups for both locales', () => {
    for (const { group, label } of RAIL_GROUPS) {
      if (!label) continue;
      const ptGroupLabel = getNested(pt, `Settings.groups.${group}`);
      const enGroupLabel = getNested(en, `Settings.groups.${group}`);

      expect(
        typeof ptGroupLabel === 'string' && ptGroupLabel.length > 0,
        `Missing pt-BR translation for Settings.groups.${group}`
      ).toBe(true);

      expect(
        typeof enGroupLabel === 'string' && enGroupLabel.length > 0,
        `Missing en translation for Settings.groups.${group}`
      ).toBe(true);
    }
  });

  it('guarantees that every AccountRole has translations in Settings.roles, root roles, and Sidebar for both locales', () => {
    for (const role of ACCOUNT_ROLES) {
      // 1. Settings.roles.<role>
      const ptSettingsRole = getNested(pt, `Settings.roles.${role}`);
      const enSettingsRole = getNested(en, `Settings.roles.${role}`);
      expect(
        typeof ptSettingsRole === 'string' && ptSettingsRole.length > 0,
        `Missing pt-BR translation for Settings.roles.${role}`
      ).toBe(true);
      expect(
        typeof enSettingsRole === 'string' && enSettingsRole.length > 0,
        `Missing en translation for Settings.roles.${role}`
      ).toBe(true);

      // 2. root roles.<role>
      const ptRootRole = getNested(pt, `roles.${role}`);
      const enRootRole = getNested(en, `roles.${role}`);
      expect(
        typeof ptRootRole === 'string' && ptRootRole.length > 0,
        `Missing pt-BR translation for root roles.${role}`
      ).toBe(true);
      expect(
        typeof enRootRole === 'string' && enRootRole.length > 0,
        `Missing en translation for root roles.${role}`
      ).toBe(true);

      // 3. Sidebar role chip
      const capitalized = role.charAt(0).toUpperCase() + role.slice(1);
      const ptSidebarRole = getNested(pt, `Sidebar.role${capitalized}`);
      const enSidebarRole = getNested(en, `Sidebar.role${capitalized}`);
      expect(
        typeof ptSidebarRole === 'string' && ptSidebarRole.length > 0,
        `Missing pt-BR translation for Sidebar.role${capitalized}`
      ).toBe(true);
      expect(
        typeof enSidebarRole === 'string' && enSidebarRole.length > 0,
        `Missing en translation for Sidebar.role${capitalized}`
      ).toBe(true);
    }
  });

  it('verifies that all useTranslations namespaces referenced in source code resolve in both dictionaries', () => {
    function walkDir(dir: string): string[] {
      const results: string[] = [];
      const list = fs.readdirSync(dir);
      for (const file of list) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          results.push(...walkDir(fullPath));
        } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
          results.push(fullPath);
        }
      }
      return results;
    }

    const srcFiles = walkDir(path.join(process.cwd(), 'src'));
    const missingNamespaces: Array<{ file: string; namespace: string; locale: string }> = [];

    for (const file of srcFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const useTransRegex = /useTranslations\(\s*['"]([^'"]+)['"]\s*\)/g;
      let match: RegExpExecArray | null;
      while ((match = useTransRegex.exec(content)) !== null) {
        const ns = match[1];
        if (!getNested(pt, ns)) {
          missingNamespaces.push({ file: path.relative(process.cwd(), file), namespace: ns, locale: 'pt-BR' });
        }
        if (!getNested(en, ns)) {
          missingNamespaces.push({ file: path.relative(process.cwd(), file), namespace: ns, locale: 'en' });
        }
      }
    }

    expect(
      missingNamespaces,
      `Found useTranslations referencing non-existent namespaces: ${JSON.stringify(missingNamespaces, null, 2)}`
    ).toEqual([]);
  });
});

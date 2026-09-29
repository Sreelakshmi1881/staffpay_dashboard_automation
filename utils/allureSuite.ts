import * as allure from 'allure-js-commons';
import type { test as base } from '@playwright/test';

/**
 * Groups a spec file in Allure the way titanautomation (rider-app-automation)
 * shows up: Default Suite > staffpay-automation > <name>. Without this Allure
 * groups by Playwright project, then file name.
 * Call once at the top of a spec, with that file's test (or setup) object.
 */
export function allureSuite(t: typeof base, name: string): void {
  t.beforeEach(async () => {
    await allure.parentSuite('Default Suite');
    await allure.suite('staffpay-automation');
    await allure.subSuite(name);
  });
}

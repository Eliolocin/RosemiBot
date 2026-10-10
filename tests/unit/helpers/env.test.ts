import { beforeAll, describe, expect, it } from "bun:test";
import { useEnvSandbox, useFullEnvSandbox } from "../../helpers/env";

/** Unset in any real environment, so each restore below must delete it rather than assign it. */
const PROBE = "TOMORI_ENV_SANDBOX_PROBE";

describe("useEnvSandbox", () => {
  describe("within one test", () => {
    useEnvSandbox([PROBE]);

    it("lets a test set a variable that was unset", () => {
      process.env[PROBE] = "set by the test";
    });

    it("deletes it afterward instead of leaving the string undefined", () => {
      expect(PROBE in process.env).toBe(false);
    });
  });

  describe("within one scope", () => {
    useEnvSandbox([PROBE]);
    beforeAll(() => {
      process.env[PROBE] = "set by beforeAll";
    });

    it("lets a test override the scope value", () => {
      process.env[PROBE] = "set by the test";
    });

    it("restores the scope value for the next test", () => {
      expect(process.env[PROBE]).toBe("set by beforeAll");
    });
  });

  it("deletes the scope value once the scope ends", () => {
    expect(PROBE in process.env).toBe(false);
  });
});

describe("useFullEnvSandbox", () => {
  useFullEnvSandbox();

  it("lets a test add a variable it never named", () => {
    Object.assign(process.env, { [PROBE]: "added by the code under test" });
  });

  it("deletes it afterward", () => {
    expect(PROBE in process.env).toBe(false);
  });
});
